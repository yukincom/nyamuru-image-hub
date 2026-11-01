"""ComfyUI execution adapter for the existing owner-scoped generation job store."""
from __future__ import annotations

import time
import io
import json
from pathlib import Path
from uuid import UUID, uuid5

from comfy_client import ComfyClient, ComfyOutputError, ComfyRejected, ComfySubmissionUnknown
from comfy_workflows import bind_graph, QWEN_FIGURE_ID
from generation_store import canonical
from image_generation_lock import record_api_submission


class ComfySaveError(OSError):
    """ComfyUI completed, but its retrieved result could not be saved locally."""


def save_candidates_manifest(store, job_id, count):
    try:
        store.write_once(job_id, 'candidates.json', canonical({'count': count}))
    except OSError as exc:
        raise ComfySaveError(f'画像のローカル保存に失敗しました（候補の完了記録）: {exc}') from exc


def submission_id(job_id, index):
    return str(uuid5(UUID(job_id), f'candidate-{index}'))


def read_optional(store, job_id, name):
    try:
        return store.json(job_id, name)
    except FileNotFoundError:
        return None


def collect_candidate(service, job_id, index, client, *, submission=None, value=None):
    """Reconcile only an already submitted candidate. Never sends a prompt."""
    store = service.store
    if submission is None:
        # Recovery reads persisted state once. A running worker already owns this state.
        intent = read_optional(store, job_id, f'api-intent-{index}.json')
        if intent is None:
            return 'not_submitted'
        if read_optional(store, job_id, f'api-rejected-{index}.json'):
            return 'failed'
        submission = dict(intent)
        accepted = read_optional(store, job_id, f'api-accepted-{index}.json')
        if accepted:
            submission['prompt_id'] = accepted['prompt_id']
    prompt_id = submission.get('prompt_id')
    if not prompt_id:
        prompt_id = client.find_prompt(submission['correlation_id'])
        if not prompt_id:
            return 'unknown'
        store.write_once(job_id, f'api-accepted-{index}.json', canonical({'prompt_id': prompt_id}))
        submission['prompt_id'] = prompt_id
    result = client.prompt_state(prompt_id)
    if result['state'] == 'unknown' and result.get('missing') is True:
        cancelled = read_optional(store, job_id, f'api-cancelled-{index}.json')
        if cancelled and cancelled.get('prompt_id') == prompt_id and cancelled.get('cancelled') is True:
            return 'failed'
    if result['state'] == 'succeeded':
        value = service.load(job_id) if value is None else value
        path = store.root / job_id / f'candidate-{index}.png'
        if not path.exists():
            raw = client.get_image(result['history'], value['workflow']['binding']['output'])
            from PIL import Image
            try:
                with Image.open(io.BytesIO(raw)) as image:
                    if image.format != 'PNG' or getattr(image, 'is_animated', False) or list(image.size) != value['output_size']:
                        raise ComfyOutputError('ワークフローの完成画像は準備した寸法の静止PNGにしてください')
                    if 'dpi' in value:
                        density = image.info.get('dpi')
                        if not isinstance(density,tuple) or len(density)!=2 or not all(
                                isinstance(d,(int,float)) and abs(d-value['dpi']) <= .02 for d in density):
                            raise ComfyOutputError('完成画像の印刷解像度が原稿と一致しません')
            except ComfyOutputError:
                raise
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as exc:
                # Only parsing the received bytes is a definitive image error.
                # Transport failures and local saving failures are classified separately.
                raise ComfyOutputError('ワークフローの完成画像を静止PNGとして読み取れません') from exc
            try:
                store.write_once(job_id, path.name, raw)
            except OSError as exc:
                raise ComfySaveError(f'画像のローカル保存に失敗しました（候補{index}）: {exc}') from exc
        return 'succeeded'
    if result['state'] == 'failed':
        return 'failed'
    return result['state']


def reconcile_candidates(service, job_id, client=None):
    """Restore retrieved results after bridge/worker loss without submitting missing work."""
    value = service.load(job_id)
    client = client or service.client_factory(value['comfyui_url'])
    states = []
    for index in range(1, value['settings']['candidate_count'] + 1):
        if (service.store.root / job_id / f'candidate-{index}.png').exists():
            states.append('succeeded')
        else:
            states.append(collect_candidate(service, job_id, index, client, value=value))
    if all(state == 'succeeded' for state in states):
        if not (service.store.root / job_id / 'candidates.json').exists():
            save_candidates_manifest(service.store, job_id, len(states))
        return 'succeeded'
    if any(state in ('queued', 'running') for state in states):
        return 'running'
    if 'unknown' in states:
        return 'outcome_unknown'
    return 'failed'


def desktop_workflow_for_job(definition, graph):
    """Embed the submitted inputs, so opening a candidate in Desktop restores the actual job."""
    if definition.get('id') != QWEN_FIGURE_ID:
        return None
    examples = Path(__file__).resolve().parents[1]/'examples'/'comfyui'
    base = 'nyamuru_qwen_turbo_3images'
    if definition['graph'] != json.loads((examples/f'{base}.api.json').read_text()):
        return None
    workflow = json.loads((examples/f'{base}.json').read_text())
    for node in workflow['nodes']:
        inputs = graph[str(node['id'])]['inputs']
        for index, name in enumerate(node.get('widgets_values_named', {})):
            if name in inputs and not isinstance(inputs[name],list):
                node['widgets_values_named'][name] = inputs[name]
                node['widgets_values'][index] = inputs[name]
    return workflow


def run_candidates(service, job_id, lease_fd, *, sleep=time.sleep, now=time.monotonic):
    store, value = service.store, service.load(job_id)
    client = service.client_factory(value['comfyui_url'])
    uploads = read_optional(store, job_id, 'api-uploads.json')
    if uploads is None:
        # A single ordered upload is reused by all five executions.
        uploads = [client.upload_image(store.read(job_id, ref['file']), f'nyamuru-{job_id}-{ref["file"]}')
                   for ref in value['references']]
        store.write_once(job_id, 'api-uploads.json', canonical(uploads))
    prompt = store.read(job_id, 'conditioning-prompt.txt').decode('utf-8')
    for index, seed in enumerate(value['candidate_seeds'], 1):
        if (store.root / job_id / 'cancel-request.json').exists():
            raise ValueError('生成を取り消しました。取得済みの候補は保持しています')
        correlation = submission_id(job_id, index)
        graph = bind_graph(value['workflow'], prompt, uploads, seed, *value['output_size'], negative_prompt=value.get('negative_prompt'), dpi=value.get('dpi'))
        # Both intent records precede POST. A lost reply is never an excuse to replay.
        intent = {'correlation_id': correlation, 'seed': seed}
        submission = dict(intent)
        recorded_prompt_id = None
        store.write_once(job_id, f'api-intent-{index}.json', canonical(intent))
        record_api_submission(lease_fd, value['comfyui_url'], correlation,
                              cancel_record=store.root / job_id / f'api-cancelled-{index}.json')
        if (store.root / job_id / 'cancel-request.json').exists():
            store.write_once(job_id, f'api-rejected-{index}.json', canonical({'error': 'cancelled_before_submission'}))
            record_api_submission(lease_fd, value['comfyui_url'], correlation, terminal=True)
            raise ValueError('生成を取り消しました')
        try:
            ui = desktop_workflow_for_job(value['workflow'], graph)
            prompt_id = client.submit(graph, correlation, workflow=ui) if ui else client.submit(graph, correlation)
            store.write_once(job_id, f'api-accepted-{index}.json', canonical({'prompt_id': prompt_id}))
            record_api_submission(lease_fd, value['comfyui_url'], correlation, prompt_id=prompt_id)
            submission['prompt_id'] = recorded_prompt_id = prompt_id
        except ComfyRejected as exc:
            store.write_once(job_id, f'api-rejected-{index}.json', canonical({'error': str(exc)}))
            record_api_submission(lease_fd, value['comfyui_url'], correlation, terminal=True)
            raise
        except ComfySubmissionUnknown:
            store.event(job_id, 'outcome_unknown', '受付応答を確認できません。送信済みIDを照合しています。再送はしません')
        deadline = now() + 7200
        while True:
            try:
                if (store.root / job_id / 'cancel-request.json').exists():
                    active_id = submission.get('prompt_id') or client.find_prompt(correlation)
                    if active_id and not read_optional(store, job_id, f'api-cancelled-{index}.json'):
                        cancelled = client.cancel(active_id)
                        if cancelled.get('cancelled'):
                            try:
                                store.write_once(job_id, f'api-cancelled-{index}.json', canonical(cancelled))
                            except FileExistsError:
                                pass
                state = collect_candidate(service, job_id, index, client, submission=submission, value=value)
                if submission.get('prompt_id') != recorded_prompt_id:
                    recorded_prompt_id = submission['prompt_id']
                    record_api_submission(lease_fd, value['comfyui_url'], correlation, prompt_id=recorded_prompt_id)
            except ComfySaveError as exc:
                try:
                    record_api_submission(lease_fd, value['comfyui_url'], correlation,
                                          prompt_id=submission.get('prompt_id'), terminal=True)
                except (OSError, ValueError) as ledger_error:
                    # A full disk can also prevent the terminal ledger write.
                    # Preserve the saving failure; the guardian still observes ComfyUI.
                    raise ComfySaveError(f'{exc}（生成終了の記録も保存できません: {ledger_error}）') from exc
                raise
            except ComfyOutputError as exc:
                record_api_submission(lease_fd, value['comfyui_url'], correlation,
                                      prompt_id=submission.get('prompt_id'), terminal=True)
                raise ComfyOutputError(f'候補{index}: {exc}') from exc
            except (OSError, ValueError) as exc:
                store.event(job_id, 'outcome_unknown', str(exc))
                raise
            if state in ('succeeded', 'failed'):
                record_api_submission(lease_fd, value['comfyui_url'], correlation, terminal=True)
                if state == 'failed':
                    raise ValueError(f'候補{index}のComfyUI処理が失敗しました。取得済みの候補は保持しています')
                break
            if now() >= deadline:
                raise ComfySubmissionUnknown(correlation)
            sleep(1)
    save_candidates_manifest(store, job_id, len(value['candidate_seeds']))
