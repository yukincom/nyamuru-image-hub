"""Immutable, owner-scoped Qwen jobs; no LLM/server start and no manuscript writes."""
from __future__ import annotations
from difflib import SequenceMatcher
import base64
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from generation_store import JobStore, canonical, checked_id, sha256, text, validate_png, MAX_PNG, directory_fd, remove_tree_at

from image_generation_lock import hold_generation_lease, validate_generation_fd
from comfy_client import ComfyClient, ComfyOutputError, ComfySubmissionUnknown, ComfyRejected
from comfy_generation import ComfySaveError
from comfy_workflows import WorkflowStore, validate_runtime, validate_request

PROFILE = 'qwen-image-2.1-owner-v1'
SAVE_FAILURE_EXIT_CODE = 74
TURBO_MODEL = 'qwen_image_2.1_turbo_int8_convrot.safetensors'
SETTINGS = {
    'resolution': 1024, 'steps': 8, 'cfg': 1.0, 'seed': 260921, 'sampler': 'euler',
    'scheduler': 'official-fixed-sigmas',
    'diffusion_model': TURBO_MODEL,
    'sigmas': [1.0, .978453, .95418, .926626, .89508, .845148, .704534, .414568, 0.0],
    'vae_device': 'cpu', 'mps_limit_gib': 16,
}
NATIVE_SKETCH_SETTINGS = {**SETTINGS, 'resolution': 768}
SKETCH_SETTINGS = {**NATIVE_SKETCH_SETTINGS, 'transparency_mode': 'code-white-v1'}
DEFAULT_ROOT = Path(__file__).resolve().parents[1] / '.local-generation' / 'qwen'

MODELS = ['diffusion_models/' + TURBO_MODEL,
          'text_encoders/qwen3vl_8b_int8_convrot.safetensors', 'vae/qwen_image_2.1_vae_bf16.safetensors']

# Fixed translations, not a Qwen shot-size standard. Do not invent crop boundaries.
FRAMING_PROMPTS = {
    'long': 'long shot.',
    'full': 'full-body shot.',
    'knee-up': 'knee-up shot.',
    'waist-up': 'waist-up shot.',
    'bust-up': 'chest-up shot.',
    'shoulder-up': 'shoulders-up shot.',
    'face': 'close-up of the face.',
    'face-detail': 'extreme close-up of the face.',
    'close-up': 'close-up.',
    'hand': 'close-up of the specified hand area.',
    'foot': 'close-up of the specified foot area.',
    'part': 'detail shot of the specified body part.',
}
FRAMING_ALIASES = {
    'ロングショット': 'long', 'ロング': 'long',
    '全身': 'full', 'フルショット': 'full',
    '膝から上': 'knee-up', 'ニーショット': 'knee-up',
    '腰から上': 'waist-up', 'ウエストアップ': 'waist-up',
    '胸から上': 'bust-up', 'バストアップ': 'bust-up',
    '肩から上': 'shoulder-up', 'アップ': 'shoulder-up',
    '顔': 'face', '顔アップ': 'face',
    '大アップ': 'face-detail', 'ビッグクローズアップ': 'face-detail',
    'クローズアップ': 'close-up', 'クロースアップ': 'close-up', 'クロース・アップ': 'close-up',
    '手': 'hand', '足': 'foot', '身体の一部': 'part',
}
FRAMING_LINE = re.compile(
    r'^[ \t]*描写範囲[ \t]*(?:は|[：:])[ \t]*(?P<label>[^。\r\n]+?)[ \t]*(?:。|(?=\r?$))'
    r'(?:[ \t]*(?:頭頂から胸までを画面に収めた構図で描く。|指定した範囲を画面に収めた構図で描く。))?',
    re.MULTILINE,
)


def split_framing_prompt(prompt):
    """Remove explicit, supported framing lines before translation; preserve all other prose."""
    framing = []

    def extract(match):
        shot = FRAMING_ALIASES.get(match['label'].strip())
        if shot is None:
            return match[0]
        framing.append(shot)
        return ''

    remaining = FRAMING_LINE.sub(extract, prompt)
    if len(set(framing)) > 1:
        raise ValueError('描写範囲が複数指定されています。カットを1種類に揃えてください')
    return (remaining.strip(), FRAMING_PROMPTS[framing[0]]) if framing else (prompt, '')


CONTENT_ROOT = Path(__file__).resolve().parents[1] / 'src' / 'content'
MANGA_FORMATS = json.loads((CONTENT_ROOT / 'manga-formats.json').read_text(encoding='utf-8'))
FORMAT_LABELS = {label: item['en'] for item in MANGA_FORMATS
                 for label in (item['ja'], item['ja'].removesuffix('漫画'), item['en'])}
FIXED_ARTWORK = {item['ja']: item['en'].lower()
                 for item in json.loads((CONTENT_ROOT / 'artwork-translations.json').read_text(encoding='utf-8'))
                 if '{{' not in item['ja'] and not re.search(r'[\u3040-\u30ff\u3400-\u9fff]', item['en'])}
FIXED_ARTWORK['文字・吹き出し・背景の風景は加えない。'] = 'Do not add text, speech balloons, or background scenery.'
LETTERING_STYLES = json.loads((CONTENT_ROOT / 'handwritten-styles.json').read_text(encoding='utf-8'))
LETTERING_ENGLISH = {field: {item['en'] for item in LETTERING_STYLES[key]}
                     for field, key in (('pen', 'pens'), ('expression', 'expressions'))}
FIXED_LETTERING_LINE = re.compile(
    r'Lettering (?P<field>pen|expression|style)(?: for (?:panel [0-9]+|page foreground), text [1-9][0-9]*)?: (?P<value>.+)\.')
HANDWRITTEN_TRANSLATIONS = {**FIXED_ARTWORK, **{item['ja']: item['en'] for item in
    json.loads((CONTENT_ROOT / 'handwritten-prompt-translations.json').read_text(encoding='utf-8'))}}
TRANSPARENT_SUBJECT = '背景・文字・吹き出しは加えず、外側は透明にする。'
BACKGROUND_LABELS = {
    '透過': 'transparent background.', '透明': 'transparent background.',
    '背景透過': 'transparent background.', '透明背景': 'transparent background.',
    '白': 'white background.', '白背景': 'white background.',
    '不透明': 'opaque background.',
}
FIXED_OPTION_LINE = re.compile(
    r'^[ \t]*(?P<field>出力形式|背景)[ \t]*(?:は|[：:])[ \t]*'
    r'(?P<label>[^。\r\n]+?)[ \t]*(?:。|(?=\r?$))', re.MULTILINE)


def is_fixed_lettering_line(line):
    match = FIXED_LETTERING_LINE.fullmatch(line.strip())
    if not match:
        return False
    if match['field'] == 'style':
        return all(value in LETTERING_ENGLISH['expression'] for value in match['value'].split('; '))
    return match['value'] in LETTERING_ENGLISH[match['field']]


def prepare_handwritten_prompt(value):
    """Compile known UI instructions; authored text and free instructions remain verbatim."""
    prompt = value['prompt']
    literal = value['literal_text'][0]
    if literal not in prompt:
        raise ValueError('ページに描く文字が生成指示から欠落しています')
    token = '__NYAMURU_HANDWRITTEN_TEXT__'
    while token in prompt:
        token = '_' + token
    protected = {}
    def opaque(text):
        key = token + str(len(protected)) + '__'
        protected[key] = text
        return key
    authored = value.get('handwritten_prompt', {})
    original = authored.get('confirmation', prompt)
    description = authored.get('description', '')
    description_start = original.find('描き方：' + description) + 4 if description and '描き方：' + description in original else -1
    description_end = description_start + len(description)
    before, after = original.splitlines(keepends=True), prompt.splitlines(keepends=True)
    before_offsets, after_offsets = [0], [0]
    for line in before:
        before_offsets.append(before_offsets[-1] + len(line))
    for line in after:
        after_offsets.append(after_offsets[-1] + len(line))
    spans = []
    # Line provenance preserves separate edits and unchanged fixed lines between them.
    for tag, a, b, c, d in SequenceMatcher(None, [line.rstrip('\r\n') for line in before], [line.rstrip('\r\n') for line in after], autojunk=False).get_opcodes():
        if tag != 'equal':
            for index in range(c, d):
                start = after_offsets[index] + (4 if after[index].startswith('描き方：') else 0)
                spans.append((start, after_offsets[index + 1]))
        elif description_start >= 0:
            for old_index, new_index in zip(range(a, b), range(c, d)):
                start, end = max(before_offsets[old_index], description_start), min(before_offsets[old_index + 1], description_end)
                if start < end:
                    offset = after_offsets[new_index] - before_offsets[old_index]
                    spans.append((start + offset, min(end + offset, after_offsets[new_index + 1])))
    merged = []
    for start, end in sorted(spans):
        if start >= end:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    for start, end in reversed(merged):
        prompt = prompt[:start] + opaque(prompt[start:end]) + prompt[end:]
    block = 'text:\n' + literal
    if block in prompt:
        prompt = prompt.replace(block, 'text:\n' + opaque(literal))
    elif literal in prompt:
        prompt = prompt.replace(literal, opaque(literal))
    # Opaque spans remain separate so an appended note cannot hide a preceding fixed line.
    def translate_fragment(fragment):
        paragraphs = []
        for paragraph in re.split(r'(\n[ \t]*\n)', fragment):
            if not paragraph.strip():
                paragraphs.append(paragraph)
                continue
            if paragraph.strip() in HANDWRITTEN_TRANSLATIONS:
                paragraphs.append(HANDWRITTEN_TRANSLATIONS[paragraph.strip()])
                continue
            lines = []
            for raw_line in paragraph.splitlines(keepends=True):
                line = raw_line.rstrip('\r\n')
                ending = raw_line[len(line):]
                body = line.strip()
                translated = HANDWRITTEN_TRANSLATIONS.get(body)
                if translated is not None:
                    lines.append(translated + ending)
                    continue
                match = FIXED_OPTION_LINE.fullmatch(body)
                if match and match['field'] == '出力形式' and match['label'].strip() in FORMAT_LABELS:
                    lines.append(f"Output format: {FORMAT_LABELS[match['label'].strip()]}.")
                elif body in ('文字の組み方向：縦書き', '文字の組み方向：横書き'):
                    lines.append('Text orientation: ' + ('vertical.' if body.endswith('縦書き') else 'horizontal.'))
                elif body in ('読み方向：右から左', '読み方向：左から右'):
                    lines.append('Reading direction: ' + ('right to left.' if body.endswith('右から左') else 'left to right.'))
                elif body.startswith('ペン：') and (pen := next((item for item in LETTERING_STYLES['pens'] if item['ja'] == body[3:]), None)):
                    lines.append(f"Lettering pen: {pen['en']}.")
                elif body.startswith('表現：') and all(label in {item['ja'] for item in LETTERING_STYLES['expressions']} for label in body[3:].split('、')):
                    selected = body[3:].split('、')
                    lines.append('Lettering style: ' + '; '.join(item['en'] for item in LETTERING_STYLES['expressions'] if item['ja'] in selected) + '.')
                elif body.startswith('書体：'):
                    lines.append('Font family: ' + body[3:])
                elif body.startswith('文字の太さ：'):
                    lines.append('Font weight: ' + body[6:])
                elif body.startswith('描き方：'):
                    lines.append('Lettering instructions: ' + line[line.index('描き方：') + 4:])
                elif (size := re.fullmatch(r'出力キャンバス：幅(\d+) × 高さ(\d+) px。(?:原稿上の配置サイズ：幅([\d.]+) × 高さ([\d.]+) mm。)?文字全体をこの縦横比の範囲内に収めてください。', body)):
                    lines.append(f'Output canvas: {size[1]} × {size[2]} px. ' +
                                 (f'Manuscript placement: {size[3]} × {size[4]} mm. ' if size[3] else '') +
                                 'Fit all of the lettering within this aspect ratio.')
                else:
                    lines.append(line)
                lines[-1] += ending
            paragraphs.append(''.join(lines))
        return ''.join(paragraphs)

    chunks = re.split('(' + '|'.join(re.escape(key) for key in protected) + ')', prompt) if protected else [prompt]
    compiled = ''.join(protected[chunk] if chunk in protected else translate_fragment(chunk) for chunk in chunks)
    return {'prompt': compiled,
            'references': [{'file': ref['file'], 'label': {'paint': 'Drawing reference', 'correction': 'Correction layer',
                            'style': 'Style reference'}.get(ref.get('role'), 'Reference') + f' {index}'}
                           for index, ref in enumerate(value['references'], 1)],
            'request_sha256': sha256(canonical(value))}


def split_fixed_generation_prompt(prompt, *, extract_framing=True):
    """Use the editor's shared dictionaries; leave arbitrary author prose to translation."""
    remaining, framing = split_framing_prompt(prompt) if extract_framing else (prompt, '')
    fixed = [framing] if framing else []
    selected = {}

    def select(field, english):
        if field in selected and selected[field] != english:
            raise ValueError(f'{field}が複数指定されています。1種類に揃えてください')
        selected[field] = english

    def extract_option(match):
        field, label = match['field'], match['label'].strip()
        english = (FORMAT_LABELS if field == '出力形式' else BACKGROUND_LABELS).get(label)
        if english is None:
            return match[0]
        if field not in selected:
            fixed.append(f'output format: {english}.' if field == '出力形式' else english)
        select(field, english)
        return ''

    remaining = FIXED_OPTION_LINE.sub(extract_option, remaining)
    lines = []
    for line in remaining.splitlines(keepends=True):
        body = line.strip()
        if is_fixed_lettering_line(body):
            # Preserve the authored English and its text target; never ask the LLM to rewrite it.
            fixed.append(body)
        elif body in FIXED_ARTWORK:
            if body == TRANSPARENT_SUBJECT:
                select('背景', 'transparent background.')
            fixed.append(FIXED_ARTWORK[body])
        elif body in ('背景透過', '背景透過。', '透明背景', '透明背景。'):
            select('背景', 'transparent background.')
            fixed.append('transparent background.')
        elif re.fullmatch(r'(?:人物|小道具)：[^\r\n]+。' + re.escape(TRANSPARENT_SUBJECT), body):
            # Previously opened prompts put the fixed clause after the dynamic subject name.
            select('背景', 'transparent background.')
            fixed.append(FIXED_ARTWORK[TRANSPARENT_SUBJECT])
            lines.append(line.replace(TRANSPARENT_SUBJECT, ''))
        else:
            lines.append(line)
    return (''.join(lines).strip(), ' '.join(dict.fromkeys(fixed))) if fixed else (prompt, '')


def three_image_workflow(value):
    return value.get('workflow', {}).get('binding', {}).get('prompt_mode') == 'qwen-three-images'


def direct_workflow_prompt(value):
    if three_image_workflow(value):
        color = value['settings']['chroma_key']['color']
        return value['prompt'] + f'\nUniform solid {color} background.'
    return value['prompt']


def dimensions(width, height, resolution=1024, *, fixed_size=None):
    if any(isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 16384 for v in (width, height)):
        raise ValueError('キャンバスの寸法が不正です')
    if fixed_size is not None:
        # The selected workflow owns its output dimensions; the canvas still owns placement.
        return list(fixed_size)
    ratio = width / height
    size = [max(32, round(math.sqrt(resolution * resolution * r) / 32) * 32) for r in (ratio, 1 / ratio)]
    if max(size) > 4096:
        raise ValueError('キャンバスが細長すぎます。縦横比を調整してください')
    return size


def png(encoded):
    if not isinstance(encoded, str) or not encoded.startswith('data:image/png;base64,') or len(encoded) > MAX_PNG * 4 // 3 + 100:
        raise ValueError('参照画像は20MiB以内のPNGで指定してください')
    raw = base64.b64decode(encoded.split(',', 1)[1], validate=True)
    return raw, validate_png(raw)


def keys(value, maximum=1):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(k, str) or not k or len(k) > 200 for k in value) \
            or len(set(value)) != len(value):
        raise ValueError('人物の対応が不正です')
    return value


def validate_generation_subject(value):
    """Only authored handwritten lettering may use a bubble-owned generation job."""
    bubble = bool(re.fullmatch(r'bubble-\d+', value.get('owner_key', '')))
    kind = value.get('content_kind')
    if bubble:
        literals = value.get('literal_text')
        if kind not in ('handwritten', 'typeset') or not isinstance(literals, list) or len(literals) != 1:
            raise ValueError('吹き出し単品は生成できません。描き文字を選択してください')
        text(literals[0], '描き文字の本文', 500)
        if not literals[0].strip():
            raise ValueError('描き文字の本文を入力してください')
    elif kind is not None:
        raise ValueError('描き文字の生成対象が不正です')


def normalize(body, *, fixed_size=None):
    if body.get('profile') != PROFILE or body.get('mode') not in ('new', 'paint', 'sketch'):
        raise ValueError('Qwen生成の指定が不正です')
    owner = text(body.get('owner_key'), '描画対象', 100)
    if not re.fullmatch(r'page|panel|background|figure-\d+|bubble-\d+', owner):
        raise ValueError('描画対象が不正です')
    validate_generation_subject(body)
    handwritten = body.get('content_kind') in ('handwritten', 'typeset')
    overlay = body.get('overlay')
    page, panel = body.get('page_number'), body.get('panel_id')
    if not isinstance(overlay, bool) or any(isinstance(v, bool) or not isinstance(v, int) for v in (page, panel)) \
            or page < 1 or (panel != 0 if overlay or owner == 'page' else panel < 1) \
            or (overlay and owner in ('page', 'panel', 'background')):
        raise ValueError('ページとコマの指定が不正です')
    width, height = body.get('width'), body.get('height')
    output_size = dimensions(width, height, fixed_size=fixed_size)
    character_limit = 10 if owner in ('page', 'panel') else 1
    character_keys = keys(body.get('character_keys'), character_limit)
    if character_keys and not (owner.startswith('figure-') or owner in ('page', 'panel')):
        raise ValueError('人物以外のあたりに人物資料は割り当てられません')
    if body['mode'] == 'sketch' and (not owner.startswith('figure-') or not character_keys):
        raise ValueError('ネームのラフ生成には登場人物の指定が必要です')
    literal_text = body.get('literal_text', [])
    if not isinstance(literal_text, list) or len(literal_text) > 100 or (literal_text and owner not in ('page', 'panel') and not handwritten):
        raise ValueError('ページに描く文字の指定が不正です')
    for item in literal_text:
        text(item, 'ページに描く文字', 500)
    settings = dict(SKETCH_SETTINGS if body['mode'] == 'sketch' else SETTINGS)
    if body.get('candidate_count') == 5:
        settings['candidate_count'] = 5
        if owner.startswith('figure-'):
            settings['transparency_mode'] = 'code-white-v1'
    references = body.get('references')
    if not isinstance(references, list) or len(references) > 9:
        raise ValueError('参照資料は最大9枚です')
    refs, images = [], {}
    input_size = None
    if body['mode'] in ('paint', 'sketch'):
        source_key = 'sketch_image' if body['mode'] == 'sketch' else 'paint_image'
        if ('paint_image' if source_key == 'sketch_image' else 'sketch_image') in body:
            raise ValueError('描画画像とネームのラフを同時には指定できません')
        raw, (input_width, input_height) = png(body.get(source_key))
        if body['mode'] == 'paint' and abs(input_width * height - input_height * width) > width + height:
            raise ValueError('描画画像とキャンバスの縦横比が一致しません')
        # The sketch owns its framing; the manuscript's placement box is independent.
        output_size = dimensions(input_width, input_height, settings['resolution'], fixed_size=fixed_size)
        input_size = [input_width, input_height]
        images['image-1.png'] = raw
        refs.append({'file': 'image-1.png', 'role': body['mode'], 'label': 'ネームの人物ラフ' if body['mode'] == 'sketch' else '描画画像',
                     'character_keys': [], 'sha256': sha256(raw)})
    else:
        if 'paint_image' in body or 'sketch_image' in body:
            raise ValueError('通常生成に描画画像は渡せません')
    if 'correction_image' in body:
        raw, correction_size = png(body['correction_image'])
        correction_size = list(correction_size)
        if input_size and correction_size != input_size:
            raise ValueError('参照画像と修正用レイヤーの寸法が一致しません')
        if not input_size:
            output_size = dimensions(*correction_size, settings['resolution'], fixed_size=fixed_size)
        name = f'image-{len(refs) + 1}.png'
        images[name] = raw
        refs.append({'file': name, 'role': 'correction', 'label': '局所修正の書き込み・マスク',
                     'character_keys': [], 'sha256': sha256(raw)})
    if len(refs) + len(references) > 10:
        raise ValueError('設定画と選択レイヤーは合計10枚までです')
    for index, reference in enumerate(references, len(refs) + 1):
        if not isinstance(reference, dict):
            raise ValueError('参照資料が不正です')
        assigned = keys(reference.get('character_keys'), character_limit)
        if any(k not in character_keys for k in assigned):
            raise ValueError('参照資料と人物が一致しません')
        raw, _ = png(reference.get('image'))
        name = f'image-{index}.png'
        images[name] = raw
        refs.append({'file': name, 'role': 'identity' if assigned else 'style',
                     'label': text(reference.get('label'), '資料名', 500), 'character_keys': assigned, 'sha256': sha256(raw)})
    if any(not any(k in r['character_keys'] for r in refs) for k in character_keys):
        raise ValueError('指定した登場人物の資料がありません')
    value = {'profile': PROFILE, 'document_key': text(body.get('document_key'), '作品キー', 500),
             'page_number': page, 'panel_id': panel, 'overlay': overlay, 'owner_key': owner,
             'label': text(body.get('label'), '対象名', 500), 'mode': body['mode'],
             'width': width, 'height': height, 'input_size': input_size, 'output_size': output_size,
             'prompt': text(body.get('prompt'), '生成指示'), 'character_keys': character_keys,
             'references': refs, 'settings': json.loads(json.dumps(settings))}
    if owner in ('page', 'panel') or handwritten:
        value['literal_text'] = literal_text
    if handwritten:
        value['content_kind'] = body['content_kind']
        if 'handwritten_prompt' in body:
            authored = body['handwritten_prompt']
            if not isinstance(authored, dict):
                raise ValueError('描き文字の確認指示が不正です')
            value['handwritten_prompt'] = {'confirmation': text(authored.get('confirmation'), '描き文字の確認指示')}
            if authored.get('description') is not None:
                value['handwritten_prompt']['description'] = text(authored['description'], '描き方', required=False)
    return value, images



def validate_english(value, english):
    if not isinstance(english, dict) or english.get('request_sha256') != sha256(canonical(value)):
        raise ValueError('英訳と元の生成入力が一致しません')
    refs = english.get('references')
    if not isinstance(refs, list) or len(refs) != len(value['references']) \
            or any(not isinstance(ref, dict) or ref.get('file') != source['file'] for ref, source in zip(refs, value['references'])):
        raise ValueError('英訳の参照資料が元の入力と一致しません')
    prompt = english.get('prompt')
    text(prompt, '英訳', 40_000)
    if value.get('content_kind') in ('handwritten', 'typeset'):
        if any(literal not in prompt for literal in value.get('literal_text', [])):
            raise ValueError('ページに描く文字が生成指示から欠落しています')
        if english != prepare_handwritten_prompt(value):
            raise ValueError('描き文字の生成指示が定型文・原文と一致しません')
        return
    if value.get('owner_key') in ('page', 'panel') or value.get('content_kind') in ('handwritten', 'typeset'):
        # Only explicitly authored on-page text may stay Japanese. Instructions
        # and reference labels still obey the existing English-only contract.
        for literal in value.get('literal_text', []):
            if literal not in prompt:
                raise ValueError('ページに描く文字が生成指示から欠落しています')
        for literal in sorted(set(value.get('literal_text', [])), key=len, reverse=True):
            prompt = prompt.replace(literal, '')
    for content in [prompt] + [ref.get('label') for ref in refs]:
        text(content, '英訳', 40_000)
        if re.search(r'[\u3040-\u30ff\u3400-\u9fff]', content):
            raise ValueError('英訳に日本語が残っています')


class QwenGenerationService:
    def __init__(self, root=None, *, workflows=None, endpoint=None, client_factory=ComfyClient):
        self.store = JobStore(Path(root or DEFAULT_ROOT))
        self.workflows = workflows or WorkflowStore()
        self.endpoint = endpoint or os.environ.get('NYAMURU_COMFYUI_URL', 'http://127.0.0.1:8188')
        self.client_factory = client_factory
        self._workers = {}
        self._save_failures = {}

    def _latest(self, job_id):
        if job_id in self._save_failures:
            return {'status': 'failed', 'error': self._save_failures[job_id]}
        return self.store.latest(job_id)

    def _record_save_failure(self, job_id, message):
        # The job event can share the same full/unwritable disk as the image.
        # Keep a live bridge notification even when that event cannot be saved.
        self._save_failures[job_id] = message
        try:
            self.store.event(job_id, 'failed', message)
        except OSError:
            return
        self._save_failures.pop(job_id, None)

    def _reap_workers(self):
        for job_id, process in list(self._workers.items()):
            code = process.poll()
            if code is None:
                continue
            del self._workers[job_id]
            if code == SAVE_FAILURE_EXIT_CODE:
                try:
                    failed = self._latest(job_id)['status'] == 'failed'
                except FileNotFoundError:
                    # A terminal job may have been deleted just before its child exited.
                    continue
                except OSError:
                    failed = False
                if not failed:
                    self._record_save_failure(job_id, '画像のローカル保存に失敗しました。保存できた候補は保持しています')

    def preflight(self, workflow, endpoint=None):
        client = self.client_factory(endpoint or self.endpoint)
        client.system_stats()
        errors = validate_runtime(workflow, client.object_info())
        if errors:
            raise ValueError('ワークフローを利用できません: ' + ' / '.join(errors))
        if not client.memory_release_available():
            raise ValueError('ComfyUIにニャムルのモデル解放確認拡張を追加し、ComfyUIを起動し直してください')

    def load(self, job_id):
        return self.store.json(job_id, 'request.json')

    def payload(self, job_id, include_image=True, *, value=None, output=None):
        value = self.load(job_id) if value is None else value
        event = self._latest(job_id)
        result = {'job_id': job_id, 'profile': PROFILE, 'status': event['status'], 'error': event.get('error', ''),
                  'request_sha256': sha256(canonical(value)), 'label': value['label'],
                  'width': value['output_size'][0], 'height': value['output_size'][1],
                  'file_name': f'qwen_{job_id}.png',
                  'created_at': (self.store.root / job_id / 'request.json').stat().st_mtime,
                  **{k: value[k] for k in ('document_key', 'page_number', 'panel_id', 'overlay', 'owner_key')}}
        if 'workflow' in value:
            result.update(workflow_id=value['workflow']['id'], workflow_name=value['workflow']['name'],
                          workflow_version=value['workflow']['version'], comfyui_url=value['comfyui_url'],
                          candidate_seeds=value['candidate_seeds'])
            try:
                result['generation_prompt'] = self.store.read(job_id, 'conditioning-prompt.txt').decode('utf-8')
            except FileNotFoundError:
                pass
        count = value['settings'].get('candidate_count', 1)
        if count > 1:
            result['requires_cutout'] = value['settings'].get('transparency_mode') in ('code-white-v1', 'chroma-key-v1')
        if include_image and count > 1 and event['status'] != 'succeeded':
            result['candidates'] = [dict(index=i, seed=value['settings']['seed'] + i - 1,
                image='data:image/png;base64,' + base64.b64encode(self.store.read(job_id, f'candidate-{i}.png')).decode())
                for i in range(1, count + 1) if (self.store.root / job_id / f'candidate-{i}.png').exists()]
        if event['status'] == 'succeeded' and (include_image or three_image_workflow(value)):
            if count > 1:
                try:
                    result['selected_candidate'] = self.store.json(job_id, 'selection.json')['index']
                except FileNotFoundError:
                    if not include_image:
                        return result
                    result['candidates'] = [dict(index=i, seed=value['settings']['seed'] + i - 1,
                        image='data:image/png;base64,' + base64.b64encode(self.store.read(job_id, f'candidate-{i}.png')).decode())
                        for i in range(1, count + 1)]
                    return result
            if three_image_workflow(value):
                result.update(width=value['width'], height=value['height'])
            if not include_image:
                return result
            raw = self.read_output(job_id) if output is None else output
            result.update(image='data:image/png;base64,' + base64.b64encode(raw).decode())
        return result

    def select(self, body):
        """Only an explicit user choice creates the final image; no model or LLM."""
        job_id = checked_id(body.get('job_id'))
        index = body.get('candidate_index')
        with self.store.lock():
            value = self.load(job_id)
            count = value['settings'].get('candidate_count', 1)
            if self._latest(job_id)['status'] != 'succeeded' or type(index) is not int or not 1 <= index <= count or count == 1:
                raise ValueError('完成した候補から1枚選んでください')
            try:
                selected = self.store.json(job_id, 'selection.json')['index']
            except FileNotFoundError:
                selected = None
            if selected is not None:
                if selected != index:
                    raise ValueError('この生成では採用する画像を決定済みです')
                return self.payload(job_id, value=value)
            raw = self.store.read(job_id, f'candidate-{index}.png')
            if value['settings'].get('transparency_mode') == 'chroma-key-v1':
                from qwen_background import remove_chroma_background
                size = (value['width'], value['height']) if three_image_workflow(value) else None
                raw = remove_chroma_background(raw, value['settings']['chroma_key'], output_size=size)
            elif value['settings'].get('transparency_mode') == 'code-white-v1':
                from qwen_background import remove_white_background
                raw = remove_white_background(raw)
            self.store.write_once(job_id, 'output.png', raw)
            self.store.write_once(job_id, 'selection.json', canonical({'index': index}))
            return self.payload(job_id, value=value, output=raw)

    def read_output(self, job_id):
        return self.store.read(job_id, 'output.png')

    def normalize_request(self, body):
        """Resolve a selected definition once, keeping a prior job snapshot on retries."""
        job_id = checked_id(body.get('job_id'))
        workflow_id = body.get('workflow_id')
        if not workflow_id:
            raise ValueError('環境設定 → モデルで、使用するComfyUIワークフローを選んでください')
        try:
            previous = self.load(job_id)
        except FileNotFoundError:
            previous = None
        workflow = previous['workflow'] if previous and previous.get('workflow', {}).get('id') == workflow_id else self.workflows.get(workflow_id)
        if body.get('workflow_version') is not None and body['workflow_version'] != workflow['version']:
            raise ValueError('ワークフローが更新されました。生成画面を開き直してください')
        value, images = normalize(body, fixed_size=workflow['binding']['fixed_size'])
        validate_request(workflow, len(value['references']))
        endpoint = body.get('comfyui_url') or self.endpoint
        endpoint = self.client_factory(endpoint).endpoint
        value.update(workflow=workflow, comfyui_url=endpoint)
        value['settings'] = {'seed': SETTINGS['seed'], 'candidate_count': 5}
        value['candidate_seeds'] = [SETTINGS['seed'] + i for i in range(5)]
        if three_image_workflow(value):
            if not value['owner_key'].startswith('figure-') or value['mode'] != 'new' or len(value['character_keys']) != 1 or [
                ref['role'] for ref in value['references']
            ] != ['style', 'identity', 'style']:
                raise ValueError('人物3枚参照には、ネーム・人物設定画1枚・3Dポーズを順に指定してください')
            if value['width'] * value['height'] > 100_000_000:
                raise ValueError('採用する画像の寸法が大きすぎます')
        if value['owner_key'].startswith('figure-') and workflow['binding']['prompt_mode'] in ('qwen', 'qwen-three-images'):
            color = body.get('chroma_key_color', '#00FF00')
            if color not in ('#00FF00', '#0000FF', '#FF00FF'):
                raise ValueError('背景色は緑・青・マゼンタから選んでください')
            value['settings'].update(transparency_mode='chroma-key-v1',
                chroma_key={'color': color, 'similarity': .08, 'blend': .12, 'despill': True})
        elif body.get('chroma_key_color') is not None:
            raise ValueError('クロマキー背景色はQwen用の人物ワークフローだけに指定できます')
        return value, images

    def prepare(self, body, translate):
        """Keep the immutable source and final prompt before allowing LLM suspension."""
        job_id = checked_id(body.get('job_id'))
        value, images = self.normalize_request(body)
        workflow = value['workflow']
        if not (self.store.root / job_id / 'request.json').exists():
            self.preflight(workflow, value['comfyui_url'])
        with self.store.lock():
            if not self.store.create(job_id):
                if self.load(job_id) != value:
                    raise ValueError('同じジョブIDに異なる入力を送れません')
                return self.payload(job_id, value=value)
            self.store.write_once(job_id, 'request.json', canonical(value))
            for name, raw in images.items():
                self.store.write_once(job_id, name, raw)
            self.store.event(job_id, 'preparing')
            try:
                if workflow['binding']['prompt_mode'] in ('plain', 'qwen-three-images'):
                    english = {'prompt': value['prompt'], 'references': [{'file': r['file'], 'label': r['label']} for r in value['references']]}
                    final_prompt = direct_workflow_prompt(value)
                else:
                    english = prepare_handwritten_prompt(value) if value.get('content_kind') in ('handwritten', 'typeset') else translate(value)
                    from qwen_generation_phase import generation_prompt
                    final_prompt = generation_prompt(value, english)
                raw = canonical(english)
                self.store.write_once(job_id, 'generation-prompt.json', raw)
                self.store.write_once(job_id, 'conditioning-prompt.txt', final_prompt.encode('utf-8'))
                self.store.event(job_id, 'prepared')
            except Exception as exc:
                self.store.event(job_id, 'failed', str(exc))
                raise
            return self.payload(job_id, value=value)

    def load_english(self, job_id):
        return self.store.json(job_id, 'generation-prompt.json')

    def submit(self, body):
        job_id = checked_id(body.get('job_id'))
        token = body.get('image_session_token')
        with hold_generation_lease(token) as lease_fd, self.store.lock():
            self._reap_workers()
            value = self.load(job_id)
            if body.get('request_sha256') != sha256(canonical(value)):
                raise ValueError('準備した生成入力と一致しません')
            if self._latest(job_id)['status'] != 'prepared':
                return self.payload(job_id, value=value)
            if 'workflow' not in value:
                raise ValueError('ワークフローを選んで新しい生成を準備してください')
            # Persist intent before spawning; uncertain outcomes never replay a UUID.
            self.store.write_once(job_id, 'submission-intent.json', canonical({'job_id': job_id, 'request_sha256': sha256(canonical(value))}))
            self.store.event(job_id, 'queued')
            try:
                process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--run', job_id,
                                  '--root', str(self.store.root),
                                  '--image-lease-fd', str(lease_fd), '--image-session-token', token],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True, close_fds=True, pass_fds=(lease_fd,))
                self._workers[job_id] = process
                self.store.write_once(job_id, 'launch.json', canonical({'pid': process.pid, 'at': time.time()}))
            except Exception as exc:
                self.store.event(job_id, 'failed', str(exc))
            return self.payload(job_id, value=value)

    def reconcile(self, body):
        with self.store.lock():
            self._reap_workers()
            return self._reconcile(body)

    def cancel(self, body):
        """Stop only this job's accepted IDs; the worker will submit no further candidates."""
        job_id = checked_id(body.get('job_id'))
        with self.store.lock():
            value = self.load(job_id)
            event = self._latest(job_id)
            if event['status'] in ('succeeded', 'failed'):
                return self.payload(job_id, value=value)
            if event['status'] == 'prepared':
                self.store.event(job_id, 'failed', '生成を取り消しました')
                return self.payload(job_id, value=value)
            if not (self.store.root / job_id / 'cancel-request.json').exists():
                self.store.write_once(job_id, 'cancel-request.json', canonical({'requested': True}))
            from comfy_generation import read_optional
            client = self.client_factory(value['comfyui_url'])
            for index in range(1, value['settings']['candidate_count'] + 1):
                intent = read_optional(self.store, job_id, f'api-intent-{index}.json')
                if not intent:
                    continue
                accepted = read_optional(self.store, job_id, f'api-accepted-{index}.json')
                prompt_id = accepted['prompt_id'] if accepted else client.find_prompt(intent['correlation_id'])
                if prompt_id:
                    receipt = client.cancel(prompt_id)
                    if not receipt.get('supported'):
                        raise ValueError('このComfyUIは対象IDを指定した取消しに対応していません。全体停止は行っていません')
                    if receipt.get('cancelled'):
                        try:
                            self.store.write_once(job_id, f'api-cancelled-{index}.json', canonical(receipt))
                        except FileExistsError:
                            pass
            return self.payload(job_id, value=value)

    def _reconcile(self, body):
        job_id = checked_id(body.get('job_id'))
        value = self.load(job_id)
        event = self._latest(job_id)
        if event['status'] in ('queued', 'running', 'outcome_unknown'):
            try:
                if value['settings'].get('candidate_count', 1) > 1:
                    self.store.read(job_id, 'candidates.json')
                    output = None
                else:
                    output = self.read_output(job_id)
                self.store.event(job_id, 'succeeded')
                return self.payload(job_id, value=value, output=output)
            except FileNotFoundError:
                pass
            try:
                try:
                    launch = self.store.json(job_id, 'launch.json')
                except FileNotFoundError:
                    launch = self.store.json(job_id, 'execution.json')
                command = subprocess.run(['ps', '-p', str(launch['pid']), '-o', 'command='], capture_output=True, text=True, timeout=5).stdout
                if time.time() - launch['at'] > 10 and not (str(Path(__file__).resolve()) in command and f'--run {job_id}' in command):
                    if 'workflow' in value:
                        from comfy_generation import reconcile_candidates
                        try:
                            state = reconcile_candidates(self, job_id)
                            self.store.event(job_id, state, '' if state == 'succeeded' else '送信済み候補を照合しました。未完了の候補は自動再送しません')
                        except ComfySaveError as exc:
                            self._record_save_failure(job_id, str(exc))
                        except ComfyOutputError as exc:
                            self.store.event(job_id, 'failed', str(exc))
                        except (OSError, ValueError) as exc:
                            self.store.event(job_id, 'outcome_unknown', str(exc))
                    elif self._latest(job_id)['status'] in ('queued', 'running'):
                        self.store.event(job_id, 'outcome_unknown', '実行プロセスが終了しました。自動再生成は行いません')
            except FileNotFoundError:
                # The request may have been saved but never launched. Never replay it.
                if time.time() - (self.store.root / job_id / 'request.json').stat().st_mtime > 30:
                    self.store.event(job_id, 'outcome_unknown', '実行記録を確認できません。自動再生成は行いません')
        return self.payload(job_id, value=value)

    def list(self, body):
        document_key = text(body.get('document_key'), '作品キー', 500)
        scope = body.get('scope', 'owner')
        if scope not in ('owner', 'work'):
            raise ValueError('生成履歴の範囲が不正です')
        jobs = []
        with self.store.lock():
            self._reap_workers()
            for job_id in self.store.ids():
                try:
                    value = self.load(job_id)
                    if value['document_key'] == document_key and (scope == 'work' or all(
                            value.get(k) == body.get(k) for k in ('page_number', 'panel_id', 'overlay', 'owner_key'))):
                        jobs.append(self.payload(job_id, include_image=False, value=value))
                except (ValueError, OSError):
                    continue
        return {'jobs': sorted(jobs, key=lambda job: (job['created_at'], job['job_id']), reverse=True)}

    def delete(self, body):
        """Permanently remove only the explicitly selected jobs and all their generated files."""
        document_key = text(body.get('document_key'), '作品キー', 500)
        selected = body.get('jobs')
        if not isinstance(selected, list) or not 1 <= len(selected) <= 1000:
            raise ValueError('削除する生成履歴を1〜1000件選んでください')
        targets = []
        for item in selected:
            if not isinstance(item, dict):
                raise ValueError('削除する生成履歴が不正です')
            job_id = checked_id(item.get('job_id'))
            if job_id not in targets:
                targets.append(job_id)
        with self.store.lock(), directory_fd(self.store.root) as root_fd:
            self._reap_workers()
            # Validate the whole selection before removing any directory.
            for job_id in targets:
                try:
                    os.stat(job_id, dir_fd=root_fd, follow_symlinks=False)
                except FileNotFoundError:
                    continue  # A repeated, already completed deletion is harmless.
                value = self.load(job_id)
                if value['document_key'] != document_key:
                    raise ValueError('削除する生成履歴の作品が一致しません')
                if self._latest(job_id)['status'] not in ('prepared', 'succeeded', 'failed'):
                    raise ValueError('実行中または結果未確定の生成は削除できません。生成状況を確認してください')
            for job_id in targets:
                remove_tree_at(root_fd, job_id)
                self._save_failures.pop(job_id, None)
            os.fsync(root_fd)
        return {'document_key': document_key, 'deleted_job_ids': targets}

    def run(self, job_id, lease_fd, token):
        # The inherited session lease keeps Gemma suspended until all phases exit.
        try:
            validate_generation_fd(token, lease_fd)
            value = self.load(job_id)
            with self.store.lock():
                if self._latest(job_id)['status'] != 'queued':
                    return
                self.store.write_once(job_id, 'execution.json', canonical({'pid': os.getpid(), 'at': time.time()}))
                self.store.event(job_id, 'running')
            from comfy_generation import run_candidates
            run_candidates(self, job_id, lease_fd)
            self.store.event(job_id, 'succeeded')
        except ComfySaveError as exc:
            self._record_save_failure(job_id, str(exc))
            return SAVE_FAILURE_EXIT_CODE
        except ComfySubmissionUnknown as exc:
            self.store.event(job_id, 'outcome_unknown', str(exc))
        except Exception as exc:
            try:
                ledger = json.loads(os.pread(lease_fd, 1024 * 1024, 0))
                uncertain = any(not item.get('terminal') for item in ledger.get('api_submissions', []))
            except (OSError, ValueError):
                uncertain = True
            self.store.event(job_id, 'outcome_unknown' if uncertain else 'failed', str(exc))
        finally:
            os.close(lease_fd)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--image-lease-fd', type=int, required=True)
    parser.add_argument('--image-session-token', required=True)
    args = parser.parse_args()
    sys.exit(QwenGenerationService(args.root).run(checked_id(args.run), args.image_lease_fd, args.image_session_token))
