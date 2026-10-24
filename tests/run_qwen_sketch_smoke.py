"""Opt-in real Turbo verification through the app's immutable job service.

Uses already installed models and the user-approved, isolated experiment inputs.
By default English is supplied explicitly. --plan-file --translate tests the existing
local prompt translator too, without changing its model or resident service.
--request-file --translate accepts a saved app request for other editing cases.
--translation-file reuses a saved English prompt; the service verifies its request hash.
Never starts/stops a resident service or writes to the artist's asset directory.
"""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from generation_store import canonical, sha256
from image_generation_lock import create_generation_lease, hold_generation_lease, close_generation_lease
from qwen_generation import QwenGenerationService, PROFILE


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--plan-file', type=Path)
    inputs.add_argument('--request-file', type=Path)
    parser.add_argument('--output-dir', type=Path)
    translators = parser.add_mutually_exclusive_group()
    translators.add_argument('--translate', action='store_true')
    translators.add_argument('--translation-file', type=Path)
    parser.add_argument('--pose', choices=['cw90', 'running'], default='cw90')
    args = parser.parse_args()
    if not args.execute:
        parser.error('Real image generation requires --execute')
    if args.request_file and not (args.translate or args.translation_file):
        parser.error('--request-file requires --translate or --translation-file so the old sketch prompt cannot be reused')
    if args.translate and not (args.plan_file or args.request_file):
        parser.error('--translate requires --plan-file or --request-file')
    import psutil
    if psutil.virtual_memory().available < 21 * 2**30:
        raise SystemExit('Less than 21 GiB available; no generation started. Resident services stay untouched.')
    from PIL import Image
    lab = ROOT.parent / 'qwen-image-2.1-lab'
    experiment = lab / 'experiments/20261012-koyuki-sketch-poses'
    def encoded(path):
        with Image.open(path) as source:
            image = source.convert('RGBA')
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            stream = io.BytesIO(); image.save(stream, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()
    job_id, token = str(uuid4()), str(uuid4())
    if args.request_file:
        body = json.loads(args.request_file.read_text())
        if not isinstance(body, dict):
            parser.error('--request-file must contain an app request object')
        body['job_id'] = job_id
    else:
        body = dict(job_id=job_id, profile=PROFILE, document_key='qwen-storyboard-verification-20261012',
                page_number=1, panel_id=1, overlay=False, owner_key='figure-0', label='小雪・透過確認',
                width=540, height=1000, mode='sketch', character_keys=['koyuki'],
                prompt='モノクロ漫画。目線はつま先に向ける。険しい表情、冷や汗。背景は白。',
                sketch_image=encoded(experiment / ('rotation-cw90/04-upside-down-cw90.png' if args.pose == 'cw90' else 'inputs/02-running-cutoff.png')),
                references=[dict(label='小雪・全身資料', character_keys=['koyuki'],
                                 image=encoded(experiment / 'inputs/character-sheet.png'))])
    if args.plan_file:
        body['prompt'] = json.loads(args.plan_file.read_text())['sketchPrompt']
    def english(value):
        original = json.loads((experiment / 'gaze-to-toes/case.json').read_text())['cases'][0]['prompt']
        return dict(request_sha256=sha256(canonical(value)),
                    prompt=original,
                    references=[dict(file=r['file'], label='Rough storyboard pose' if i == 0 else 'Koyuki character sheet')
                                for i, r in enumerate(value['references'])])
    service = QwenGenerationService()
    translator = english
    if args.translate:
        from nyamuru_panel_actions import PanelActionSuggester, DEFAULT_PANEL_ACTION_LLM_URL, SHARED_PANEL_ACTION_LLM_MODEL
        translator = PanelActionSuggester(DEFAULT_PANEL_ACTION_LLM_URL, SHARED_PANEL_ACTION_LLM_MODEL).translate_image_generation_prompt
    elif args.translation_file:
        saved_english = json.loads(args.translation_file.read_text())
        translator = lambda value: saved_english
    prepared = service.prepare(body, translator)
    out = args.output_dir or ROOT / '.local-generation/qwen-storyboard-verification'
    out.mkdir(parents=True, exist_ok=True)
    record = out / f'{job_id}.json'
    record.write_text(json.dumps({'job_id': job_id, 'pose': None if args.request_file else args.pose,
                                 'request_file': str(args.request_file) if args.request_file else None,
                                 'started_at': time.time(),
                                 'translation': 'live local translator' if args.translate else 'saved English' if args.translation_file else 'explicit test English',
                                 'translation_file': str(args.translation_file) if args.translation_file else None,
                                 'request_sha256': prepared['request_sha256']}, indent=2))
    print(json.dumps({'job_id': job_id, 'directory': str(service.store.root / job_id)}), flush=True)
    lease = create_generation_lease(token)
    try:
        with hold_generation_lease(token) as fd:
            # Same queued worker path as submit, without an unobserved background launcher.
            service.store.event(job_id, 'queued')
            service.run(job_id, os.dup(fd), token)
        result = service.payload(job_id)
        print(json.dumps({k: v for k, v in result.items() if k != 'image'}, ensure_ascii=False), flush=True)
        record.write_text(json.dumps({**json.loads(record.read_text()), 'finished_at': time.time(),
                                     'result': {k: v for k, v in result.items() if k != 'image'}}, ensure_ascii=False, indent=2))
        if result['status'] != 'succeeded':
            raise SystemExit(1)
    finally:
        close_generation_lease(token)
        # This foreground runner has no resident-LLM restoration to await.
        # Retaining the closed lease would block the normal UI's next session.
        lease.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
