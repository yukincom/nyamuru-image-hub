import base64
import fcntl
from functools import partial
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from types import SimpleNamespace
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from qwen_generation import QwenGenerationService, PROFILE, normalize, dimensions, SETTINGS, LEGACY_SETTINGS, SKETCH_SETTINGS, NATIVE_SKETCH_SETTINGS, validate_transparency, apply_generated_alpha
from generation_store import canonical, sha256
from image_generation_lock import create_generation_lease, hold_generation_lease, validate_generation_fd
try:
    from PIL import Image
except ImportError:
    Image = None


def encoded(size=(540, 1000)):
    buffer = io.BytesIO()
    Image.new('RGBA', size, (0, 0, 0, 0)).save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


def body():
    return dict(job_id=str(uuid4()), profile=PROFILE, document_key='["series","episode"]', page_number=1,
                panel_id=1, overlay=False, owner_key='figure-0', label='人物', mode='new',
                width=540, height=1000, prompt='正面を向く人物', character_keys=['character-1'],
                references=[dict(label='三面図', character_keys=['character-1'], image=encoded())])


def translate(value):
    return dict(request_sha256=sha256(canonical(value)), prompt='A person facing forward.',
                references=[dict(file=r['file'], label=f'Reference {i}') for i, r in enumerate(value['references'])])


class QwenPreflightTest(unittest.TestCase):
    def test_only_turbo_and_shared_assets_are_required_for_every_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            lab = Path(directory)
            service = QwenGenerationService(lab / 'jobs', lab)
            for name in ('.venv/bin/python', 'runtime/ComfyUI/comfy_extras/nodes_qwen.py',
                         'models/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors',
                         'models/text_encoders/qwen3vl_8b_int8_convrot.safetensors',
                         'models/vae/qwen_image_2.1_vae_bf16.safetensors'):
                path = lab / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            for settings in (None, SETTINGS, SKETCH_SETTINGS, NATIVE_SKETCH_SETTINGS):
                with self.subTest(settings=settings):
                    service.preflight(settings)
            turbo = lab / 'models/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors'
            turbo.rename(turbo.with_name('qwen_image_2.1_int8_convrot.safetensors'))
            with self.assertRaisesRegex(ValueError, 'モデルが見つかりません'):
                service.preflight()
            with self.assertRaisesRegex(ValueError, '新しい生成を準備'):
                service.preflight(LEGACY_SETTINGS)


@unittest.skipIf(Image is None, 'Pillow required')
class QwenJobsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.leases = self.root / 'leases'
        self.token = str(uuid4())
        create_generation_lease(self.token, self.leases)
        self.service = QwenGenerationService(self.root / 'jobs', self.root / 'fake-lab')
        self.request = body()
        for target, replacement in (
            ('qwen_generation.hold_generation_lease', partial(hold_generation_lease, root=self.leases)),
            ('qwen_generation.validate_generation_fd', partial(validate_generation_fd, root=self.leases)),
        ):
            patcher = patch(target, replacement); patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(self.service, 'preflight'); patcher.start(); self.addCleanup(patcher.stop)
        # Fail closed if any test accidentally launches a production runtime.
        patcher = patch('qwen_generation.subprocess.Popen', return_value=Mock(pid=123))
        self.spawn = patcher.start(); self.addCleanup(patcher.stop)

    def prepare(self):
        return self.service.prepare(self.request, translate)

    def submit(self, prepared=None):
        prepared = prepared or self.prepare()
        return self.service.submit(dict(job_id=prepared['job_id'], request_sha256=prepared['request_sha256'], image_session_token=self.token))

    def output(self):
        value = self.service.load(self.request['job_id'])
        raw = base64.b64decode(encoded(tuple(value['output_size'])).split(',')[1])
        self.service.store.write_once(self.request['job_id'], 'output.png', raw)
        self.service.store.write_once(self.request['job_id'], 'output.json', canonical(dict(sha256=sha256(raw), request_sha256=sha256(canonical(value)))))
        return raw

    def test_all_new_jobs_persist_turbo_sampling_and_existing_mode_behaviour(self):
        for mode in ('new', 'paint', 'sketch'):
            with self.subTest(mode=mode):
                self.request = body()
                self.request['mode'] = mode
                if mode != 'new':
                    self.request[f'{mode}_image'] = encoded()
                prepared = self.prepare()
                value = self.service.load(prepared['job_id'])
                settings = value['settings']
                self.assertEqual(settings['diffusion_model'], 'qwen_image_2.1_turbo_int8_convrot.safetensors')
                self.assertEqual((settings['steps'], settings['cfg'], settings['sampler']), (8, 1, 'euler'))
                self.assertEqual(settings['sigmas'], [1.0, .978453, .95418, .926626, .89508, .845148, .704534, .414568, 0.0])
                self.assertEqual(settings['scheduler'], 'official-fixed-sigmas')
                self.assertEqual(settings['resolution'], 768 if mode == 'sketch' else 1024)
                self.assertEqual(value['output_size'], dimensions(540, 1000, settings['resolution']))
                self.assertEqual(settings['vae_device'], 'cpu')
                self.assertEqual(settings['minimum_start_available_gib'], 21)
                self.assertEqual(settings['minimum_available_gib'], 6)
                self.assertEqual(settings['maximum_swap_increase_gib'], 1)
                self.assertEqual(settings.get('require_transparency', False), mode == 'sketch')
                self.assertEqual(settings.get('transparency_mode'), 'alpha-pass-v1' if mode == 'sketch' else None)
                self.assertEqual(self.submit(prepared)['status'], 'queued')
                self.assertEqual(self.service.load(prepared['job_id']), value)

    def test_saved_base_jobs_keep_history_and_images_but_cannot_launch(self):
        for mode in ('new', 'paint'):
            with self.subTest(mode=mode):
                self.request = body()
                self.request['mode'] = mode
                if mode == 'paint':
                    self.request['paint_image'] = encoded()
                value, _ = normalize(self.request)
                value['settings'] = LEGACY_SETTINGS
                job_id, store = self.request['job_id'], self.service.store
                store.create(job_id)
                source = canonical(value)
                store.write_once(job_id, 'request.json', source)
                store.write_once(job_id, 'request.sha256', sha256(source).encode())
                english = canonical(translate(value))
                store.write_once(job_id, 'generation-prompt.json', english)
                store.write_once(job_id, 'generation-prompt.sha256', sha256(english).encode())
                store.event(job_id, 'prepared')
                prepared = self.service.payload(job_id)
                with patch.object(self.service, 'preflight', wraps=partial(QwenGenerationService.preflight, self.service)):
                    with self.assertRaisesRegex(ValueError, '新しい生成を準備'):
                        self.submit(prepared)
                self.spawn.assert_not_called()
                self.assertFalse((store.root / job_id / 'submission-intent.json').exists())
                self.assertEqual(self.service.payload(job_id)['status'], 'prepared')
                with self.assertRaisesRegex(ValueError, '異なる入力'):
                    self.prepare()
                output = self.output()
                store.event(job_id, 'succeeded')
                result = self.service.reconcile({'job_id': job_id})
                self.assertEqual(result['image_sha256'], sha256(output))
                self.assertEqual(self.submit(prepared)['status'], 'succeeded')
                self.assertIn(job_id, [item['job_id'] for item in self.service.list(self.request)['jobs']])
                self.assertEqual(store.read(job_id, 'request.json'), source)
                self.assertEqual(store.read(job_id, 'generation-prompt.json'), english)
                self.assertEqual(self.service.delete(self.deletion(prepared))['deleted_job_ids'], [job_id])

    def test_sketch_keeps_its_own_crop_aspect_and_uses_verified_turbo_profile(self):
        self.request.update(mode='sketch', sketch_image=encoded((544, 496)))
        value, images = normalize(self.request)
        self.assertEqual(value['input_size'], [544, 496])
        self.assertEqual(value['output_size'], [800, 736])
        self.assertEqual(value['settings'], SKETCH_SETTINGS)
        self.assertEqual([r['role'] for r in value['references']], ['sketch', 'identity'])
        self.assertEqual(images['image-1.png'], base64.b64decode(self.request['sketch_image'].split(',')[1]))
        self.assertEqual(images['image-2.png'], base64.b64decode(self.request['references'][0]['image'].split(',')[1]))
        value['settings']['sigmas'][0] = 42
        self.assertEqual(SKETCH_SETTINGS['sigmas'][0], 1)
        prepared = self.prepare()
        self.assertEqual(prepared['status'], 'prepared')
        self.assertEqual(self.service.load(self.request['job_id'])['settings'], SKETCH_SETTINGS)
        self.assertEqual(self.submit(prepared)['status'], 'queued')

    def test_sketch_requires_bound_character_and_exactly_one_guide(self):
        self.request.update(mode='sketch', sketch_image=encoded())
        for update in ({'character_keys': []}, {'owner_key': 'background'}, {'paint_image': encoded()}, {'references': []}):
            with self.subTest(update=list(update)):
                with self.assertRaises(ValueError):
                    normalize({**self.request, **update})
        with self.assertRaises(ValueError):
            normalize({**self.request, 'mode': 'new'})

    def test_alpha_pass_uses_only_mask_alpha_preserving_all_finished_rgb_pixels(self):
        color = Image.new('RGB', (64, 64), 'white')
        color.paste((20, 40, 80), (16, 16, 48, 48))
        mask = Image.new('RGBA', (64, 64), (255, 0, 255, 0))
        mask.paste((0, 255, 0, 255), (16, 16, 48, 48))
        source = io.BytesIO(); color.save(source, format='PNG')
        alpha = io.BytesIO(); mask.save(alpha, format='PNG')
        raw = apply_generated_alpha(source.getvalue(), alpha.getvalue())
        with Image.open(io.BytesIO(raw)) as output:
            self.assertEqual(output.convert('RGB').tobytes(), color.tobytes())
            self.assertEqual(output.getchannel('A').tobytes(), mask.getchannel('A').tobytes())
        mismatch = io.BytesIO(); mask.resize((32, 32)).save(mismatch, format='PNG')
        with self.assertRaisesRegex(ValueError, '寸法'):
            apply_generated_alpha(source.getvalue(), mismatch.getvalue())

    def test_existing_native_sketch_job_remains_readable_without_rewriting_it(self):
        self.request.update(mode='sketch', sketch_image=encoded())
        value, _ = normalize(self.request)
        value['settings'] = NATIVE_SKETCH_SETTINGS
        self.service.store.create(self.request['job_id'])
        self.service.store.write_once(self.request['job_id'], 'request.json', canonical(value))
        self.service.store.write_once(self.request['job_id'], 'request.sha256', sha256(canonical(value)).encode())
        self.assertEqual(self.service.load(self.request['job_id']), value)

    def test_transparency_retains_opaque_white_clothes_and_rejects_opaque_or_empty_output(self):
        image = Image.new('RGBA', (64, 64), (255, 255, 255, 0))
        image.paste((255, 255, 255, 255), (16, 16, 48, 48))
        stream = io.BytesIO(); image.save(stream, format='PNG')
        report = validate_transparency(stream.getvalue())
        self.assertEqual(report['transparent_fraction'], .75)
        self.assertEqual(report['opaque_fraction'], .25)
        self.assertEqual(image.getpixel((32, 32)), (255, 255, 255, 255))
        for mode, alpha in (('RGBA', 255), ('RGBA', 0), ('RGBA', 128), ('RGB', None)):
            stream = io.BytesIO()
            Image.new(mode, (32, 32), (255, 255, 255, alpha) if alpha is not None else 'white').save(stream, format='PNG')
            with self.assertRaises(ValueError):
                validate_transparency(stream.getvalue())

    def test_new_and_paint_reference_order_dimensions(self):
        value, images = normalize(self.request)
        self.assertEqual([r['role'] for r in value['references']], ['identity'])
        self.assertEqual(list(images), ['image-1.png'])
        self.assertEqual(images['image-1.png'], base64.b64decode(self.request['references'][0]['image'].split(',')[1]))
        self.assertIsNone(value['input_size'])
        self.assertEqual(value['output_size'], dimensions(540, 1000))
        self.request.update(mode='paint', paint_image=encoded(), width=1080, height=2000)
        value, images = normalize(self.request)
        self.assertEqual(value['references'][0]['role'], 'paint')
        self.assertEqual([r['role'] for r in value['references']], ['paint', 'identity'])
        self.assertEqual(value['input_size'], [540, 1000])
        self.assertEqual(value['output_size'], dimensions(540, 1000))
        self.assertEqual(images['image-1.png'], base64.b64decode(self.request['paint_image'].split(',')[1]))

    def test_two_selected_images_stay_two_and_do_not_set_output_size(self):
        self.request['references'].append(dict(label='顔', character_keys=['character-1'], image=encoded((120, 80))))
        value, images = normalize(self.request)
        self.assertEqual(len(value['references']), 2)
        self.assertEqual(list(images), ['image-1.png', 'image-2.png'])
        for source, ref in zip(self.request['references'], value['references']):
            self.assertEqual(images[ref['file']], base64.b64decode(source['image'].split(',')[1]))
            self.assertEqual(ref['label'], source['label'])
        self.assertEqual(value['output_size'], dimensions(540, 1000))

    def test_correction_is_separate_and_keeps_source_mask_identity_order(self):
        self.request.update(mode='paint', paint_image=encoded(), correction_image=encoded())
        value, images = normalize(self.request)
        self.assertEqual([ref['role'] for ref in value['references']], ['paint', 'correction', 'identity'])
        for field, index in [('paint_image', 1), ('correction_image', 2)]:
            self.assertEqual(images[f'image-{index}.png'], base64.b64decode(self.request[field].split(',')[1]))
        self.assertEqual(value['references'][1]['character_keys'], [])
        prepared = self.service.prepare(self.request, translate)
        self.assertEqual(self.service.load(prepared['job_id'])['references'], value['references'])
        with self.assertRaisesRegex(ValueError, '寸法が一致'):
            normalize({**self.request, 'correction_image': encoded((200, 200))})

    def test_correction_without_reference_uses_annotated_canvas_aspect(self):
        self.request['correction_image'] = encoded((200, 300))
        value, images = normalize(self.request)
        self.assertEqual([ref['role'] for ref in value['references']], ['correction', 'identity'])
        self.assertEqual(value['output_size'], dimensions(200, 300))
        self.assertEqual(len(images), 2)

    def test_correction_and_source_count_towards_ten_image_limit(self):
        self.request.update(mode='paint', paint_image=encoded(), correction_image=encoded())
        self.request['references'] *= 8
        value, images = normalize(self.request)
        self.assertEqual(len(images), 10)
        self.assertEqual(value['references'][-1]['file'], 'image-10.png')
        with self.assertRaisesRegex(ValueError, '合計10枚'):
            normalize({**self.request, 'references': self.request['references'] + self.request['references'][:1]})

    def test_background_without_references_does_not_create_an_image(self):
        value, images = normalize({**self.request, 'owner_key': 'background', 'character_keys': [], 'references': []})
        self.assertEqual(images, {})
        self.assertEqual(value['references'], [])
        self.assertIsNone(value['input_size'])
        self.assertEqual(value['output_size'], dimensions(540, 1000))

    def test_prepared_legacy_canvas_job_cannot_be_newly_submitted(self):
        value, images = normalize(self.request)
        value['references'].insert(0, dict(file='old-canvas.png', role='canvas', label='出力キャンバス', character_keys=[], sha256='0'*64))
        store, job_id = self.service.store, self.request['job_id']
        store.create(job_id)
        store.write_once(job_id, 'request.json', canonical(value))
        store.write_once(job_id, 'request.sha256', sha256(canonical(value)).encode())
        raw = canonical(translate(value))
        store.write_once(job_id, 'generation-prompt.json', raw)
        store.write_once(job_id, 'generation-prompt.sha256', sha256(raw).encode())
        store.event(job_id, 'prepared')
        with self.assertRaisesRegex(ValueError, '新しい生成を準備'):
            self.submit(self.service.payload(job_id))
        self.spawn.assert_not_called()
        self.assertEqual(self.service.payload(job_id)['status'], 'prepared')

    def test_wrong_missing_and_excess_references_rejected(self):
        for refs in ([], self.request['references'] * 10, [dict(label='bad', character_keys=['other'], image=encoded())]):
            with self.subTest(refs=len(refs)), self.assertRaises(ValueError): normalize({**self.request, 'references': refs})

    def test_english_saved_before_launch_and_immutable_replay(self):
        prepared = self.prepare()
        self.assertEqual(prepared['status'], 'prepared')
        self.spawn.assert_not_called()
        english = self.service.load_english(self.request['job_id'])
        self.assertEqual(english['prompt'], 'A person facing forward.')
        self.assertEqual(self.service.load(self.request['job_id'])['prompt'], self.request['prompt'])
        result = self.submit(prepared)
        self.assertEqual(result['status'], 'queued')
        self.assertEqual(self.submit(prepared), result)
        self.assertEqual(self.spawn.call_count, 1)
        self.assertEqual(len(self.spawn.call_args.kwargs['pass_fds']), 1)
        with patch('qwen_generation.subprocess.Popen') as spawn:
            self.assertEqual(self.prepare()['status'], 'queued')
            spawn.assert_not_called()
        self.request['prompt'] = 'Other'
        with self.assertRaises(ValueError): self.prepare()

    def test_failed_translation_or_disk_write_never_launches_and_never_retries(self):
        for failed_step in ('translation', 'storage'):
            self.request['job_id'] = str(uuid4())
            translator = Mock(side_effect=ValueError('translation failed')) if failed_step == 'translation' else Mock(side_effect=translate)
            original = self.service.store.write_once
            def write(job, name, raw):
                if failed_step == 'storage' and name == 'generation-prompt.json': raise OSError('disk full')
                original(job, name, raw)
            with patch.object(self.service.store, 'write_once', side_effect=write):
                with self.assertRaises((ValueError, OSError)): self.service.prepare(self.request, translator)
            self.assertEqual(self.service.prepare(self.request, translator)['status'], 'failed')
            self.assertEqual(translator.call_count, 1)
        self.spawn.assert_not_called()

    def test_no_unprepared_or_tampered_prompt_launch(self):
        prepared = self.prepare()
        with self.assertRaises(ValueError): self.service.submit(dict(job_id=prepared['job_id'], request_sha256=prepared['request_sha256']))
        path = self.service.store.root / prepared['job_id'] / 'generation-prompt.json'
        path.write_text('{}')
        with self.assertRaises(ValueError): self.submit(prepared)
        self.spawn.assert_not_called()

    def test_incomplete_preparation_never_claims_saved_english(self):
        value, images = normalize(self.request)
        store = self.service.store
        store.create(self.request['job_id'])
        store.write_once(self.request['job_id'], 'request.json', canonical(value))
        store.write_once(self.request['job_id'], 'request.sha256', sha256(canonical(value)).encode())
        with self.assertRaises(FileNotFoundError): self.prepare()
        self.spawn.assert_not_called()

    def test_phase_failure_inherits_both_locks_and_stops_sequence(self):
        self.submit()
        with hold_generation_lease(self.token, self.leases) as fd:
            with patch('qwen_generation.subprocess.run', side_effect=RuntimeError('encode failed')) as run:
                self.service.run(self.request['job_id'], os.dup(fd), self.token)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(len(run.call_args.kwargs['pass_fds']), 2)
        self.assertEqual(self.service.payload(self.request['job_id'])['status'], 'failed')

    def test_memory_guard_stops_before_alpha_and_reports_actionable_error(self):
        self.request.update(mode='sketch', sketch_image=encoded())
        self.submit()
        with hold_generation_lease(self.token, self.leases) as fd:
            with patch('qwen_generation.subprocess.run', side_effect=subprocess.CalledProcessError(75, 'phase')) as run:
                self.service.run(self.request['job_id'], os.dup(fd), self.token)
            self.assertEqual(run.call_count, 1)
        result = self.service.payload(self.request['job_id'])
        self.assertEqual(result['status'], 'failed')
        self.assertIn('メモリ上限', result['error'])
        self.assertFalse((self.service.store.root / self.request['job_id'] / 'output.png').exists())

    def test_missing_process_lease_fails_before_comfy_start(self):
        self.submit()
        with open(self.root / 'unrelated', 'w+') as stream:
            with patch('qwen_generation.subprocess.run') as run:
                self.service.run(self.request['job_id'], os.dup(stream.fileno()), self.token)
            run.assert_not_called()
        self.assertEqual(self.service.payload(self.request['job_id'])['status'], 'failed')

    def test_output_recovers_without_regeneration_and_tampering_rejected(self):
        prepared = self.prepare(); self.submit(prepared)
        raw = self.output()
        result = self.service.reconcile(self.request)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['image_sha256'], sha256(raw))
        self.assertNotEqual(result['width'], result['height'])
        self.assertEqual(self.submit(prepared)['status'], 'succeeded')
        self.assertEqual(self.spawn.call_count, 1)
        (self.service.store.root / self.request['job_id'] / 'output.png').write_bytes(raw+b'bad')
        with self.assertRaises(ValueError): self.service.payload(self.request['job_id'])

    def test_stale_job_unknown_without_respawn(self):
        with patch('qwen_generation.time.time', return_value=1): self.submit()
        with patch('qwen_generation.subprocess.run', return_value=Mock(stdout='')):
            self.assertEqual(self.service.reconcile(self.request)['status'], 'outcome_unknown')
        self.assertEqual(self.spawn.call_count, 1)

    def deletion(self, *jobs):
        return dict(document_key=self.request['document_key'], jobs=[dict(job_id=job['job_id'], request_sha256=job['request_sha256']) for job in jobs])

    def test_delete_removes_all_generated_files_and_history_without_touching_other_jobs(self):
        prepared = self.prepare()
        self.output()
        self.service.store.event(prepared['job_id'], 'succeeded')
        directory = self.service.store.root / prepared['job_id']
        (directory / 'conditioning.pt').write_bytes(b'conditioning')
        (directory / 'latent.pt').write_bytes(b'latent')
        (directory / 'decode.log').write_text('log')
        (directory / 'nested').mkdir(); (directory / 'nested' / 'render.png').write_bytes(b'png')
        original = self.root / 'original-reference.png'; original.write_bytes(b'original')
        (directory / 'external-link').symlink_to(original)
        self.request['job_id'] = str(uuid4())
        other = self.prepare(); other_dir = self.service.store.root / other['job_id']
        before = {p.name: p.read_bytes() for p in other_dir.iterdir()}
        request = self.deletion(prepared)
        result = self.service.delete(request)
        self.assertEqual(result['deleted_job_ids'], [prepared['job_id']])
        self.assertFalse(directory.exists())
        self.assertEqual(original.read_bytes(), b'original')
        self.assertEqual(self.service.delete(request), result)
        restarted = QwenGenerationService(self.service.store.root, self.service.lab)
        self.assertEqual([job['job_id'] for job in restarted.list(self.request)['jobs']], [other['job_id']])
        with self.assertRaises(FileNotFoundError): restarted.reconcile({'job_id': prepared['job_id']})
        for name, content in before.items():
            self.assertEqual((other_dir / name).read_bytes(), content)
        self.spawn.assert_not_called()

    def test_delete_validates_entire_batch_before_removing_any_job(self):
        prepared = self.prepare()
        self.request['job_id'] = str(uuid4())
        second = self.prepare()
        request = self.deletion(prepared, second)
        invalid = json.loads(json.dumps(request)); invalid['jobs'][1]['request_sha256'] = '0'*64
        with self.assertRaises(ValueError): self.service.delete(invalid)
        with self.assertRaises(ValueError): self.service.delete({**request, 'document_key': 'another-work'})
        with self.assertRaises(ValueError): self.service.delete(self.deletion(prepared, prepared))
        with self.assertRaises(ValueError): self.service.delete({**request, 'jobs': [{'job_id': '../outside', 'request_sha256': 'a'*64}]})
        self.assertEqual(len(self.service.list(self.request)['jobs']), 2)
        result = self.service.delete(request)
        self.assertEqual(result['deleted_job_ids'], [prepared['job_id'], second['job_id']])
        self.assertEqual(self.service.list(self.request)['jobs'], [])

    def test_delete_rejects_active_uncertain_jobs_and_a_live_execution_lock(self):
        prepared = self.prepare(); request = self.deletion(prepared)
        for status in ('preparing', 'queued', 'running', 'outcome_unknown'):
            self.service.store.event(prepared['job_id'], status)
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, '結果未確定'):
                self.service.delete(request)
            self.assertEqual(self.service.store.latest(prepared['job_id'])['status'], status)
        self.service.store.event(prepared['job_id'], 'failed')
        with (self.service.store.root / '.execution.lock').open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, '実行中'): self.service.delete(request)
        self.service.delete(request)
        self.assertFalse((self.service.store.root / prepared['job_id']).exists())

    def test_work_history_includes_other_panels_and_pages_but_not_other_works(self):
        first = self.prepare()
        self.request.update(job_id=str(uuid4()), page_number=2, panel_id=3, owner_key='figure-1')
        second = self.prepare()
        work = self.request['document_key']
        self.request.update(job_id=str(uuid4()), document_key='other-work')
        self.prepare()
        self.request['document_key'] = work
        self.assertEqual([item['job_id'] for item in self.service.list(self.request)['jobs']], [second['job_id']])
        jobs = self.service.list({**self.request, 'scope': 'work'})['jobs']
        self.assertEqual([job['job_id'] for job in jobs], [second['job_id'], first['job_id']])
        self.assertEqual((jobs[0]['page_number'], jobs[0]['panel_id']), (2, 3))
        self.assertEqual(jobs[0]['file_name'], f"qwen_{second['job_id']}.png")
        self.assertNotIn('image', jobs[0])
        with self.assertRaises(ValueError): self.service.list({**self.request, 'scope': 'all-users'})

    def test_delete_http_contract_uses_existing_origin_gate(self):
        from nyamuru_bridge_http import BridgeHandler
        prepared = self.prepare(); self.output()
        self.service.store.event(prepared['job_id'], 'succeeded')
        raw = canonical(self.deletion(prepared))
        for origin, expected in [('https://untrusted.example', 403), ('http://127.0.0.1:4321', 200)]:
            handler = object.__new__(BridgeHandler)
            handler.headers = {'Content-Length': str(len(raw)), 'Content-Type': 'application/json', 'Origin': origin}
            handler.rfile, handler.wfile = io.BytesIO(raw), io.BytesIO()
            handler.path = '/api/qwen-generation/delete'
            handler.server = SimpleNamespace(state=SimpleNamespace(qwen_jobs=self.service))
            statuses = []
            handler.send_response = statuses.append
            handler.send_header = lambda *args: None
            handler.end_headers = lambda: None
            handler.do_POST()
            self.assertEqual(statuses, [expected])
            if expected == 200:
                response = json.loads(handler.wfile.getvalue())
                self.assertEqual(response['deleted_job_ids'], [prepared['job_id']])
                self.assertFalse((self.service.store.root / prepared['job_id']).exists())
            else:
                self.assertEqual(self.service.payload(prepared['job_id'])['status'], 'succeeded')

if __name__ == '__main__': unittest.main()
