"""Generation prompt fields, framing and lettering options used to prepare image requests."""

from __future__ import annotations

from difflib import SequenceMatcher
import json
import math
import re
from pathlib import Path
from generation_store import canonical, sha256, text


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
MODELS = ['diffusion_models/' + TURBO_MODEL,
          'text_encoders/qwen3vl_8b_int8_convrot.safetensors', 'vae/qwen_image_2.1_vae_bf16.safetensors']
# Fixed translations, not a Qwen shot-size standard. Do not invent crop boundaries.
CONTENT_ROOT = Path(__file__).resolve().parents[1] / 'src' / 'content'
FRAMING_PROMPTS = json.loads((CONTENT_ROOT / 'figure-framing.json').read_text(encoding='utf-8'))
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
        base = re.sub(r'\nUniform solid #(00FF00|0000FF|FF00FF) background\.$', '', value['prompt'])
        if color != '#00FF00':
            name, rgb = {'#0000FF': ('blue', '0, 0, 255'), '#FF00FF': ('magenta', '255, 0, 255')}[color]
            base = base.replace('solid chroma green (#00FF00, RGB 0, 255, 0) background.',
                                f'solid chroma {name} ({color}, RGB {rgb}) background.')
            base = base.replace('with solid bright chroma green (#00FF00) right up',
                                f'with solid bright chroma {name} ({color}) right up')
        return base + f'\nUniform solid {color} background.'
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
