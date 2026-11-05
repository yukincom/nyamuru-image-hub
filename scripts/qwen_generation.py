"""Immutable, owner-scoped Qwen jobs; no LLM/server start and no manuscript writes."""

from __future__ import annotations

import base64
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from generation_store import JobStore, canonical, checked_id, sha256, text, validate_png, MAX_PNG
from image_generation_lock import hold_generation_lease, validate_generation_fd, record_generation_job
from shared_llm_process import identity
from comfy_client import ComfyClient, ComfyOutputError, ComfySubmissionUnknown
from comfy_generation import ComfySaveError
from comfy_workflows import WorkflowStore, install_qwen_defaults, negative_prompt_nodes, validate_request

from generation_job_results import PROFILE, SAVE_FAILURE_EXIT_CODE, DEFAULT_ROOT, GenerationJobResults
from generation_prompt_inputs import (
    TURBO_MODEL,
    SETTINGS,
    NATIVE_SKETCH_SETTINGS,
    SKETCH_SETTINGS,
    MODELS,
    CONTENT_ROOT,
    FRAMING_PROMPTS,
    FRAMING_ALIASES,
    FRAMING_LINE,
    split_framing_prompt,
    MANGA_FORMATS,
    FORMAT_LABELS,
    FIXED_ARTWORK,
    LETTERING_STYLES,
    LETTERING_ENGLISH,
    FIXED_LETTERING_LINE,
    HANDWRITTEN_TRANSLATIONS,
    TRANSPARENT_SUBJECT,
    BACKGROUND_LABELS,
    FIXED_OPTION_LINE,
    is_fixed_lettering_line,
    prepare_handwritten_prompt,
    split_fixed_generation_prompt,
    three_image_workflow,
    direct_workflow_prompt,
    dimensions,
    keys,
    validate_generation_subject,
    validate_english,
)


def png(encoded, *, native_size=False):
    if not isinstance(encoded, str) or not encoded.startswith('data:image/png;base64,') or len(encoded) > MAX_PNG * 4 // 3 + 100:
        raise ValueError('参照画像は20MiB以内のPNGで指定してください')
    raw = base64.b64decode(encoded.split(',', 1)[1], validate=True)
    return raw, validate_png(raw, native_size=native_size)


def normalize(body, *, fixed_size=None, native_size=False):
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
    output_size = dimensions(width, height, fixed_size=[width,height] if native_size else fixed_size)
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
        raw, _ = png(reference.get('image'), native_size=native_size)
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


class QwenGenerationService(GenerationJobResults):
    def __init__(self, root=None, *, workflows=None, endpoint=None, client_factory=ComfyClient):
        self.store = JobStore(Path(root or DEFAULT_ROOT))
        self.workflows = workflows or WorkflowStore()
        if workflows is None and root is None:
            install_qwen_defaults(self.workflows)
        self.endpoint = endpoint or os.environ.get('NYAMURU_COMFYUI_URL', 'http://127.0.0.1:8188')
        self.client_factory = client_factory
        self._workers = {}
        self._save_failures = {}

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
        value, images = normalize(body, fixed_size=workflow['binding']['fixed_size'], native_size=workflow['binding']['prompt_mode']=='qwen-three-images')
        validate_request(workflow, len(value['references']))
        endpoint = body.get('comfyui_url') or self.endpoint
        endpoint = self.client_factory(endpoint).endpoint
        value.update(workflow=workflow, comfyui_url=endpoint)
        if 'negative_prompt' in body:
            negative = body['negative_prompt']
            if not isinstance(negative, str) or len(negative) > 12000:
                raise ValueError('ネガティブプロンプトは12000文字以内で入力してください')
            if not negative_prompt_nodes(workflow):
                raise ValueError('このワークフローにネガティブプロンプトの入力はありません')
            value['negative_prompt'] = negative
        value['settings'] = {'seed': SETTINGS['seed'], 'candidate_count': 5}
        value['candidate_seeds'] = [SETTINGS['seed'] + i for i in range(5)]
        if three_image_workflow(value):
            if not value['owner_key'].startswith('figure-') or value['mode'] != 'new' or len(value['character_keys']) != 1 or [
                ref['role'] for ref in value['references']
            ] != ['style', 'identity', 'style']:
                raise ValueError('人物3枚参照には、3Dポーズ・人物設定画1枚・ネームを順に指定してください')
            dpi = body.get('dpi')
            if isinstance(dpi, bool) or not isinstance(dpi, (float,int)) or not math.isfinite(dpi) or not 1 <= dpi <= 10000:
                raise ValueError('原稿のdpiを指定してください')
            value['dpi'] = dpi
            from PIL import Image
            import io
            with Image.open(io.BytesIO(images[value['references'][0]['file']])) as pose:
                has_alpha = 'A' in pose.getbands() or 'transparency' in pose.info
                frame_size = tuple(value['output_size'])
                # Output is 60% of the manuscript, while image1 remains the 20% reference.
                preview_size = tuple(max(1, round(side / 3)) for side in frame_size)
                if pose.size not in (frame_size, preview_size) or (has_alpha and pose.convert('RGBA').getchannel('A').getextrema()[0] != 255):
                    raise ValueError('image1にはコマに対応する不透明な3Dプレビューを指定してください')
            polygon = body.get('clip_polygon')
            if polygon is not None:
                if not isinstance(polygon,list) or not 3 <= len(polygon) <= 1024 or any(
                    not isinstance(pt,list) or len(pt)!=2 or any(type(x) not in (float,int) or not math.isfinite(x) or abs(x)>2 for x in pt) for pt in polygon):
                    raise ValueError('生成対象のコマ枠が不正です')
                value['clip_polygon'] = polygon
            if value['width'] * value['height'] > 100_000_000:
                raise ValueError('採用する画像の寸法が大きすぎます')
        if value['owner_key'].startswith('figure-') and workflow['binding']['prompt_mode'] in ('qwen', 'qwen-three-images'):
            color = body.get('chroma_key_color', '#00FF00')
            if color not in ('#00FF00', '#0000FF', '#FF00FF'):
                raise ValueError('背景色は緑・青・マゼンタから選んでください')
            value['settings'].update(transparency_mode='chroma-key-v1',
                chroma_key={'color': color, 'similarity': .08, 'blend': .12, 'despill': True})
            if body.get('candidate_cutout') is True:
                value['settings']['candidate_cutout'] = True
        elif body.get('chroma_key_color') is not None:
            raise ValueError('クロマキー背景色はQwen用の人物ワークフローだけに指定できます')
        return value, images

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
                record_generation_job(lease_fd, job_id, self.store.root)
                process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--run', job_id,
                                  '--root', str(self.store.root),
                                  '--image-lease-fd', str(lease_fd), '--image-session-token', token],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True, close_fds=True, pass_fds=(lease_fd,))
                self._workers[job_id] = process
                stamp = identity(process.pid)
                if stamp:
                    record_generation_job(lease_fd, job_id, self.store.root,
                        worker={'pid': process.pid, 'identity': stamp})
                self.store.write_once(job_id, 'launch.json', canonical({'pid': process.pid, 'at': time.time()}))
            except Exception as exc:
                self.store.event(job_id, 'failed', str(exc))
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

    def run(self, job_id, lease_fd, token):
        # The inherited session lease keeps Gemma suspended until all phases exit.
        try:
            validate_generation_fd(token, lease_fd)
            value = self.load(job_id)
            with self.store.lock():
                record_generation_job(lease_fd, job_id, self.store.root,
                    worker={'pid': os.getpid(), 'identity': identity(os.getpid())})
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
