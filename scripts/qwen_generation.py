"""Immutable, owner-scoped Qwen jobs; no LLM/server start and no manuscript writes."""
from __future__ import annotations
import base64
import fcntl
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from generation_store import JobStore, canonical, checked_id, sha256, text, validate_png, MAX_PNG, directory_fd, remove_tree_at

from image_generation_lock import hold_generation_lease, validate_generation_fd

PROFILE = 'qwen-image-2.1-owner-v1'
# Read-only compatibility for saved jobs; never use this profile for new execution.
LEGACY_SETTINGS = {'resolution': 1024, 'steps': 40, 'cfg': 1.0, 'seed': 260921, 'sampler': 'euler', 'scheduler': 'simple'}
TURBO_MODEL = 'qwen_image_2.1_turbo_int8_convrot.safetensors'
SETTINGS = {
    'resolution': 1024, 'steps': 8, 'cfg': 1.0, 'seed': 260921, 'sampler': 'euler',
    'scheduler': 'official-fixed-sigmas',
    'diffusion_model': TURBO_MODEL,
    'sigmas': [1.0, .978453, .95418, .926626, .89508, .845148, .704534, .414568, 0.0],
    'vae_device': 'cpu', 'mps_limit_gib': 16,
    'minimum_start_available_gib': 21, 'minimum_available_gib': 6, 'maximum_swap_increase_gib': 1,
}
NATIVE_SKETCH_SETTINGS = {**SETTINGS, 'resolution': 768, 'require_transparency': True}
SKETCH_SETTINGS = {**NATIVE_SKETCH_SETTINGS, 'transparency_mode': 'alpha-pass-v1'}
DEFAULT_ROOT = Path(__file__).resolve().parents[1] / '.local-generation' / 'qwen'
DEFAULT_LAB = Path(__file__).resolve().parents[2] / 'qwen-image-2.1-lab'
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
        if body in FIXED_ARTWORK:
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


def dimensions(width, height, resolution=1024):
    if any(isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 16384 for v in (width, height)):
        raise ValueError('キャンバスの寸法が不正です')
    ratio = width / height
    size = [max(32, round(math.sqrt(resolution * resolution * r) / 32) * 32) for r in (ratio, 1 / ratio)]
    if max(size) > 4096:
        raise ValueError('キャンバスが細長すぎます。縦横比を調整してください')
    return size


def png(encoded):
    if not isinstance(encoded, str) or not encoded.startswith('data:image/png;base64,') or len(encoded) > MAX_PNG * 4 // 3 + 100:
        raise ValueError('参照画像は20MiB以内のPNGで指定してください')
    raw = base64.b64decode(encoded.split(',', 1)[1], validate=True)
    validate_png(raw)
    return raw


def validate_transparency(raw):
    """Do not publish an opaque or empty model output as a transparent character."""
    import io
    from PIL import Image
    with Image.open(io.BytesIO(raw)) as image:
        if image.mode != 'RGBA':
            raise ValueError('生成画像に透過情報がありません。生成原本はrender.pngに保持しています')
        histogram = image.getchannel('A').histogram()
        count = image.width * image.height
        transparent = sum(histogram[:16]) / count
        opaque = sum(histogram[240:]) / count
        if transparent < .01 or opaque < .01:
            raise ValueError('人物と透過背景を確認できませんでした。生成原本はrender.pngに保持しています')
        return {'transparent_fraction': transparent, 'opaque_fraction': opaque,
                'alpha_min': next(i for i, n in enumerate(histogram) if n),
                'alpha_max': next(i for i in range(255, -1, -1) if histogram[i])}


def apply_generated_alpha(color_raw, alpha_raw):
    """Keep the finished drawing's RGB bytes; use only the extraction pass's alpha."""
    import io
    from PIL import Image
    validate_transparency(alpha_raw)
    with Image.open(io.BytesIO(color_raw)) as color, Image.open(io.BytesIO(alpha_raw)) as matte:
        if color.size != matte.size:
            raise ValueError('背景透過の寸法が完成画と一致しません')
        result = color.convert('RGBA')
        result.putalpha(matte.getchannel('A'))
        output = io.BytesIO()
        result.save(output, format='PNG')
        return output.getvalue()


def keys(value, maximum=1):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(k, str) or not k or len(k) > 200 for k in value) \
            or len(set(value)) != len(value):
        raise ValueError('人物の対応が不正です')
    return value


def normalize(body):
    if body.get('profile') != PROFILE or body.get('mode') not in ('new', 'paint', 'sketch'):
        raise ValueError('Qwen生成の指定が不正です')
    owner = text(body.get('owner_key'), '描画対象', 100)
    if not re.fullmatch(r'page|panel|background|figure-\d+|bubble-\d+', owner):
        raise ValueError('描画対象が不正です')
    overlay = body.get('overlay')
    page, panel = body.get('page_number'), body.get('panel_id')
    if not isinstance(overlay, bool) or any(isinstance(v, bool) or not isinstance(v, int) for v in (page, panel)) \
            or page < 1 or (panel != 0 if overlay or owner == 'page' else panel < 1) \
            or (overlay and owner in ('page', 'panel', 'background')):
        raise ValueError('ページとコマの指定が不正です')
    width, height = body.get('width'), body.get('height')
    output_size = dimensions(width, height)
    character_limit = 10 if owner in ('page', 'panel') else 1
    character_keys = keys(body.get('character_keys'), character_limit)
    if character_keys and not (owner.startswith('figure-') or owner in ('page', 'panel')):
        raise ValueError('人物以外のあたりに人物資料は割り当てられません')
    if body['mode'] == 'sketch' and (not owner.startswith('figure-') or not character_keys):
        raise ValueError('ネームのラフ生成には登場人物の指定が必要です')
    literal_text = body.get('literal_text', [])
    if not isinstance(literal_text, list) or len(literal_text) > 100 or (literal_text and owner not in ('page', 'panel')):
        raise ValueError('ページに描く文字の指定が不正です')
    for item in literal_text:
        text(item, 'ページに描く文字', 500)
    settings = SKETCH_SETTINGS if body['mode'] == 'sketch' else SETTINGS
    references = body.get('references')
    if not isinstance(references, list) or len(references) > 9:
        raise ValueError('参照資料は最大9枚です')
    refs, images = [], {}
    input_size = None
    if body['mode'] in ('paint', 'sketch'):
        source_key = 'sketch_image' if body['mode'] == 'sketch' else 'paint_image'
        if ('paint_image' if source_key == 'sketch_image' else 'sketch_image') in body:
            raise ValueError('描画画像とネームのラフを同時には指定できません')
        raw = png(body.get(source_key))
        input_width, input_height = validate_png(raw)
        if body['mode'] == 'paint' and abs(input_width * height - input_height * width) > width + height:
            raise ValueError('描画画像とキャンバスの縦横比が一致しません')
        # The sketch owns its framing; the manuscript's placement box is independent.
        output_size = dimensions(input_width, input_height, settings['resolution'])
        input_size = [input_width, input_height]
        images['image-1.png'] = raw
        refs.append({'file': 'image-1.png', 'role': body['mode'], 'label': 'ネームの人物ラフ' if body['mode'] == 'sketch' else '描画画像',
                     'character_keys': [], 'sha256': sha256(raw)})
    else:
        if 'paint_image' in body or 'sketch_image' in body:
            raise ValueError('通常生成に描画画像は渡せません')
    if 'correction_image' in body:
        raw = png(body['correction_image'])
        correction_size = list(validate_png(raw))
        if input_size and correction_size != input_size:
            raise ValueError('参照画像と修正用レイヤーの寸法が一致しません')
        if not input_size:
            output_size = dimensions(*correction_size, settings['resolution'])
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
        raw = png(reference.get('image'))
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
    if owner in ('page', 'panel'):
        value['literal_text'] = literal_text
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
    if value.get('owner_key') in ('page', 'panel'):
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
    def __init__(self, root=None, lab=None):
        self.store = JobStore(Path(root or DEFAULT_ROOT))
        self.lab = Path(lab or os.environ.get('NYAMURU_QWEN_LAB_ROOT', DEFAULT_LAB)).absolute()
        self.thread_lock = threading.RLock()

    def preflight(self, settings=None):
        model = (SETTINGS if settings is None else settings).get('diffusion_model')
        if model != TURBO_MODEL:
            raise ValueError('Turboへの切り替え前の生成設定です。新しい生成を準備してください')
        models = ['diffusion_models/' + model, *MODELS[1:]]
        required = [self.lab / '.venv/bin/python', self.lab / 'runtime/ComfyUI/comfy_extras/nodes_qwen.py'] + [self.lab / 'models' / m for m in models]
        if any(not p.is_file() for p in required):
            raise ValueError('Qwen-Image-2.1の実行環境またはモデルが見つかりません')

    def load(self, job_id):
        raw = self.store.read(job_id, 'request.json')
        if sha256(raw) != self.store.read(job_id, 'request.sha256', 64).decode():
            raise ValueError('Qwen入力のSHA-256が一致しません')
        value = json.loads(raw)
        expected = (SKETCH_SETTINGS, NATIVE_SKETCH_SETTINGS) if value.get('mode') == 'sketch' else (SETTINGS, LEGACY_SETTINGS)
        if value.get('profile') != PROFILE or value.get('mode') not in ('new', 'paint', 'sketch') or value.get('settings') not in expected:
            raise ValueError('Qwenジョブの形式が一致しません')
        return value

    def payload(self, job_id, include_image=True):
        value = self.load(job_id)
        event = self.store.latest(job_id)
        result = {'job_id': job_id, 'profile': PROFILE, 'status': event['status'], 'error': event.get('error', ''),
                  'request_sha256': sha256(canonical(value)), 'label': value['label'],
                  'width': value['output_size'][0], 'height': value['output_size'][1],
                  'file_name': f'qwen_{job_id}.png',
                  'created_at': (self.store.root / job_id / 'request.json').stat().st_mtime,
                  **{k: value[k] for k in ('document_key', 'page_number', 'panel_id', 'overlay', 'owner_key')}}
        if event['status'] == 'succeeded' and include_image:
            raw = self.verified_output(job_id, value)
            result.update(image='data:image/png;base64,' + base64.b64encode(raw).decode(), image_sha256=sha256(raw), file_name=f'qwen_{job_id}.png')
        return result

    def verified_output(self, job_id, value):
        raw = self.store.read(job_id, 'output.png', MAX_PNG)
        meta = self.store.json(job_id, 'output.json')
        if sha256(raw) != meta['sha256'] or meta['request_sha256'] != sha256(canonical(value)) or list(validate_png(raw)) != value['output_size']:
            raise ValueError('Qwen出力の寸法またはSHA-256が一致しません')
        return raw

    def prepare(self, body, translate):
        """Keep the immutable source and English prompt before allowing LLM suspension."""
        job_id = checked_id(body.get('job_id'))
        value, images = normalize(body)
        with self.thread_lock, self.store.lock():
            if not self.store.create(job_id):
                if self.load(job_id) != value:
                    raise ValueError('同じジョブIDに異なる入力を送れません')
                if self.store.latest(job_id)['status'] == 'prepared':
                    self.load_english(job_id)
                return self.payload(job_id)
            self.store.write_once(job_id, 'request.json', canonical(value))
            self.store.write_once(job_id, 'request.sha256', sha256(canonical(value)).encode())
            for name, raw in images.items():
                self.store.write_once(job_id, name, raw)
            self.store.event(job_id, 'preparing')
            try:
                self.preflight(value['settings'])
                english = translate(value)
                validate_english(value, english)
                raw = canonical(english)
                self.store.write_once(job_id, 'generation-prompt.json', raw)
                self.store.write_once(job_id, 'generation-prompt.sha256', sha256(raw).encode())
                self.load_english(job_id)
                self.store.event(job_id, 'prepared')
            except Exception as exc:
                self.store.event(job_id, 'failed', str(exc))
                raise
            return self.payload(job_id)

    def load_english(self, job_id):
        raw = self.store.read(job_id, 'generation-prompt.json')
        if sha256(raw) != self.store.read(job_id, 'generation-prompt.sha256', 64).decode():
            raise ValueError('保存した英訳のSHA-256が一致しません')
        english = json.loads(raw)
        validate_english(self.load(job_id), english)
        return english

    def submit(self, body):
        job_id = checked_id(body.get('job_id'))
        token = body.get('image_session_token')
        with hold_generation_lease(token) as lease_fd, self.thread_lock, self.store.lock():
            value = self.load(job_id)
            if body.get('request_sha256') != sha256(canonical(value)):
                raise ValueError('準備した生成入力と一致しません')
            self.load_english(job_id)
            if self.store.latest(job_id)['status'] != 'prepared':
                return self.payload(job_id)
            if any(ref['role'] == 'canvas' for ref in value['references']):
                raise ValueError('自動追加の空画像を含む生成入力です。新しい生成を準備してください')
            self.preflight(value['settings'])
            # Persist intent before spawning; uncertain outcomes never replay a UUID.
            self.store.write_once(job_id, 'submission-intent.json', canonical({'job_id': job_id, 'request_sha256': sha256(canonical(value))}))
            self.store.event(job_id, 'queued')
            try:
                process = subprocess.Popen([str(self.lab / '.venv/bin/python'), str(Path(__file__).resolve()), '--run', job_id,
                                  '--root', str(self.store.root), '--lab', str(self.lab),
                                  '--image-lease-fd', str(lease_fd), '--image-session-token', token],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True, close_fds=True, pass_fds=(lease_fd,))
                self.store.write_once(job_id, 'launch.json', canonical({'pid': process.pid, 'at': time.time()}))
            except Exception as exc:
                self.store.event(job_id, 'failed', str(exc))
            return self.payload(job_id)

    def reconcile(self, body):
        with self.thread_lock, self.store.lock():
            return self._reconcile(body)

    def _reconcile(self, body):
        job_id = checked_id(body.get('job_id'))
        event = self.store.latest(job_id)
        if event['status'] in ('queued', 'running', 'outcome_unknown'):
            try:
                self.verified_output(job_id, self.load(job_id))
                self.store.event(job_id, 'succeeded')
                return self.payload(job_id)
            except FileNotFoundError:
                pass
            try:
                try:
                    launch = self.store.json(job_id, 'launch.json')
                except FileNotFoundError:
                    launch = self.store.json(job_id, 'execution.json')
                command = subprocess.run(['ps', '-p', str(launch['pid']), '-o', 'command='], capture_output=True, text=True, timeout=5).stdout
                if time.time() - launch['at'] > 10 and not (str(Path(__file__).resolve()) in command and f'--run {job_id}' in command):
                    if self.store.latest(job_id)['status'] in ('queued', 'running'):
                        self.store.event(job_id, 'outcome_unknown', '実行プロセスが終了しました。自動再生成は行いません。保存先のログを確認してください')
            except FileNotFoundError:
                # The request may have been saved but never launched. Never replay it.
                if time.time() - (self.store.root / job_id / 'request.json').stat().st_mtime > 30:
                    self.store.event(job_id, 'outcome_unknown', '実行記録を確認できません。自動再生成は行いません')
        return self.payload(job_id)

    def list(self, body):
        document_key = text(body.get('document_key'), '作品キー', 500)
        scope = body.get('scope', 'owner')
        if scope not in ('owner', 'work'):
            raise ValueError('生成履歴の範囲が不正です')
        jobs = []
        with self.thread_lock, self.store.lock():
            for job_id in self.store.ids():
                try:
                    value = self.load(job_id)
                    if value['document_key'] == document_key and (scope == 'work' or all(
                            value.get(k) == body.get(k) for k in ('page_number', 'panel_id', 'overlay', 'owner_key'))):
                        jobs.append(self.payload(job_id, include_image=False))
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
            digest = item.get('request_sha256')
            if job_id in [target[0] for target in targets] or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
                raise ValueError('削除する生成履歴のIDまたはSHA-256が不正です')
            targets.append((job_id, digest))
        with self.thread_lock, self.store.lock(), directory_fd(self.store.root) as root_fd:
            lock = os.open('.execution.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
            try:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as exc:
                    raise ValueError('画像生成が実行中です。完了してから削除してください') from exc
                # Validate the whole selection before removing any directory.
                for job_id, digest in targets:
                    try:
                        os.stat(job_id, dir_fd=root_fd, follow_symlinks=False)
                    except FileNotFoundError:
                        continue  # A repeated, already completed deletion is harmless.
                    value = self.load(job_id)
                    if value['document_key'] != document_key or sha256(canonical(value)) != digest:
                        raise ValueError('削除する生成履歴の作品または入力が一致しません')
                    if self.store.latest(job_id)['status'] not in ('prepared', 'succeeded', 'failed'):
                        raise ValueError('実行中または結果未確定の生成は削除できません。生成状況を確認してください')
                for job_id, _digest in targets:
                    remove_tree_at(root_fd, job_id)
                os.fsync(root_fd)
            finally:
                os.close(lock)
        return {'document_key': document_key, 'deleted_job_ids': [job_id for job_id, _digest in targets]}

    def run(self, job_id, lease_fd, token):
        # Only one job holds the accelerator, even across bridge restarts.
        lock = None
        try:
            validate_generation_fd(token, lease_fd)
            value = self.load(job_id)
            self.load_english(job_id)
            lock = os.open(self.store.root / '.execution.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise ValueError('別のQwen生成が実行中です。完了してから実行してください') from exc
            if self.store.latest(job_id)['status'] != 'queued':
                return
            self.preflight(value['settings'])
            for ref in value['references']:
                if sha256(self.store.read(job_id, ref['file'], MAX_PNG)) != ref['sha256']:
                    raise ValueError('参照画像のSHA-256が一致しません')
            self.store.write_once(job_id, 'execution.json', canonical({'pid': os.getpid(), 'at': time.time()}))
            self.store.event(job_id, 'running')
            directory = self.store.root / job_id
            alpha_pass = value['settings'].get('transparency_mode') == 'alpha-pass-v1'
            phases = ('encode', 'sample', 'decode') + (('alpha-encode', 'alpha-sample', 'alpha-decode') if alpha_pass else ())
            for phase in phases:
                with (directory / f'{phase}.log').open('xb') as log:
                    try:
                        subprocess.run([str(self.lab / '.venv/bin/python'), str(Path(__file__).with_name('qwen_generation_phase.py')),
                                        phase, str(directory), str(self.lab), str(lease_fd), token], check=True, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT, timeout=7200, pass_fds=(lock, lease_fd))
                    except subprocess.CalledProcessError as exc:
                        if exc.returncode == 75:
                            raise ValueError('画像生成のメモリ上限に達しました。他のモデルの処理が終わってから新しい生成を実行してください') from exc
                        raise
            raw = self.store.read(job_id, 'render.png', MAX_PNG)
            if list(validate_png(raw)) != value['output_size']:
                raise ValueError('Qwenの出力寸法がキャンバスと一致しません')
            sources = {}
            if alpha_pass:
                alpha_raw = self.store.read(job_id, 'alpha-render.png', MAX_PNG)
                sources = {'color_source_sha256': sha256(raw), 'alpha_source_sha256': sha256(alpha_raw),
                           'transparency_mode': 'alpha-pass-v1'}
                raw = apply_generated_alpha(raw, alpha_raw)
            transparency = validate_transparency(raw) if value['settings'].get('require_transparency') else None
            self.store.write_once(job_id, 'output.png', raw)
            self.store.write_once(job_id, 'output.json', canonical({'sha256': sha256(raw), 'request_sha256': sha256(canonical(value)),
                                                                 **sources, **({'transparency': transparency} if transparency else {})}))
            self.store.event(job_id, 'succeeded')
        except Exception as exc:
            self.store.event(job_id, 'failed', str(exc))
        finally:
            if lock is not None:
                os.close(lock)
            os.close(lease_fd)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--lab', required=True)
    parser.add_argument('--image-lease-fd', type=int, required=True)
    parser.add_argument('--image-session-token', required=True)
    args = parser.parse_args()
    QwenGenerationService(args.root, args.lab).run(checked_id(args.run), args.image_lease_fd, args.image_session_token)
