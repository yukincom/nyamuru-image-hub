"""Headless adapter to the same Qwen job service used by Nyamuru."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import sys
import time

from generation_store import canonical, checked_id, sha256, MAX_PNG
from qwen_generation import QwenGenerationService, PROFILE, MODELS, SETTINGS, normalize, validate_english, direct_workflow_prompt
from qwen_generation_phase import generation_prompt


def request_file(path):
    path = Path(path).resolve()
    source = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(source, dict):
        raise ValueError('Request must be a JSON object')
    allowed = {'job_id', 'prompt', 'width', 'height', 'label', 'document_key', 'page_number',
               'panel_id', 'overlay', 'owner_key', 'mode', 'character_keys', 'references',
               'paint_image', 'sketch_image', 'correction_image', 'literal_text', 'workflow_id', 'workflow_version', 'comfyui_url', 'chroma_key_color', 'candidate_count'}
    if set(source) - allowed:
        raise ValueError('Unsupported request fields: ' + ', '.join(sorted(set(source) - allowed)))

    def image(value):
        if not isinstance(value, str):
            raise ValueError('Image must be a PNG path or data URL')
        if value.startswith('data:'):
            return value
        image_path = path.parent / value
        if image_path.stat().st_size > MAX_PNG:
            raise ValueError('Image exceeds the Qwen input limit')
        return 'data:image/png;base64,' + base64.b64encode(image_path.read_bytes()).decode()

    body = {'profile': PROFILE, 'document_key': 'hermes-single-image', 'page_number': 1,
            'panel_id': 1, 'overlay': False, 'owner_key': 'background', 'label': 'Hermes image',
            'mode': 'new', 'width': 1024, 'height': 1024, 'character_keys': [], 'references': [], **source}
    checked_id(body.get('job_id'))
    for key in ('paint_image', 'sketch_image', 'correction_image'):
        if key in body:
            body[key] = image(body[key])
    if not isinstance(body['references'], list):
        raise ValueError('references must be a list')
    references = []
    for ref in body['references']:
        if not isinstance(ref, dict) or set(ref) - {'image', 'label', 'character_keys'}:
            raise ValueError('Each reference needs image, label and optional character_keys')
        references.append({**ref, 'image': image(ref.get('image')), 'character_keys': ref.get('character_keys', [])})
    body['references'] = references
    return body


def supplied_english(value):
    # Hermes supplies English directly; keep its content, without another LLM call.
    result = {'request_sha256': sha256(canonical(value)), 'prompt': value['prompt'],
              'references': [{'file': ref['file'], 'label': ref['label']} for ref in value['references']]}
    # These source labels are assigned by normalize(), not written by Hermes.
    source_labels = {'paint': 'Source painted image', 'sketch': 'Source character sketch',
                     'correction': 'Local edit annotations or mask'}
    for source, ref in zip(value['references'], result['references']):
        if source['role'] in source_labels:
            ref['label'] = source_labels[source['role']]
    validate_english(value, result)
    return result


def preview(body, service=None):
    service = service or QwenGenerationService()
    value, _ = service.normalize_request(body)
    prompt = generation_prompt(value, supplied_english(value)) if value['workflow']['binding']['prompt_mode'] == 'qwen' else direct_workflow_prompt(value)
    return {'job_id': body['job_id'], 'request': value, 'generation_prompt': prompt}


def result(service, job_id):
    payload = service.payload(job_id, include_image=False)
    payload['job_directory'] = str(service.store.root / job_id)
    if payload['status'] == 'succeeded':
        directory = service.store.root / job_id
        if (directory / 'output.png').exists():
            payload['image_path'] = str(directory / 'output.png')
        else:
            payload['candidate_paths'] = [str(directory / f'candidate-{i}.png') for i in range(1, 6)]
            payload['selection_required'] = True
    return payload


def run_job(service, job_id, token, sleep=time.sleep):
    payload = result(service, job_id)
    if payload['status'] == 'succeeded':
        return payload
    if payload['status'] != 'prepared':
        raise ValueError(f"Job is {payload['status']}; inspect it, do not resubmit")
    service.submit({'job_id': job_id, 'request_sha256': payload['request_sha256'], 'image_session_token': token})
    previous = None
    while True:
        payload = service.reconcile({'job_id': job_id})
        status = payload['status']
        if status != previous:
            print(json.dumps({'job_id': job_id, 'status': status}), file=sys.stderr, flush=True)
            previous = status
        if status == 'succeeded':
            return result(service, job_id)
        if status not in ('queued', 'running'):
            raise ValueError(f"Job {status}: {payload.get('error', '')}; do not resubmit")
        sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['catalog', 'preview', 'prepare', 'status', 'run', 'select', 'cancel'])
    parser.add_argument('--request', type=Path)
    parser.add_argument('--job')
    parser.add_argument('--candidate', type=int)
    parser.add_argument('--image-session-token')
    args = parser.parse_args()
    service = QwenGenerationService()
    if args.command == 'catalog':
        output = {'ok': True, 'execution': 'comfyui-api', 'workflows': service.workflows.list(),
                  'default_endpoint': service.endpoint, 'commands': ['preview', 'prepare', 'generate', 'status', 'select', 'cancel'],
                  'comfyui_server_required': True}
    elif args.command in ('preview', 'prepare'):
        if not args.request:
            parser.error('--request is required')
        body = request_file(args.request)
        if args.command == 'preview':
            output = preview(body, service)
        else:
            service.prepare(body, supplied_english)
            output = result(service, body['job_id'])
    else:
        job_id = checked_id(args.job)
        if args.command == 'run':
            if not args.image_session_token:
                parser.error('Run generation through hermes_qwen.mjs generate')
            output = run_job(service, job_id, args.image_session_token)
        elif args.command == 'select':
            service.select({'job_id': job_id, 'candidate_index': args.candidate})
            output = result(service, job_id)
        elif args.command == 'cancel':
            service.cancel({'job_id': job_id})
            output = result(service, job_id)
        else:
            service.reconcile({'job_id': job_id})
            output = result(service, job_id)
    print(json.dumps(output, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
