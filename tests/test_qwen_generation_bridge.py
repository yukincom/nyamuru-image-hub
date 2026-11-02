"""見込み: ComfyUIへの移行後も入力・指示・履歴の所有を保てる。
合格: 選択した定義と参照を保存し、失敗時は再送せず5候補から明示選択する。
範囲: 実PNG/保存/プロンプト構築、APIとworker起動は模擬。実推論の品質は未検証。
"""
import base64
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
from qwen_generation import QwenGenerationService, PROFILE, normalize, dimensions, SETTINGS, SKETCH_SETTINGS, NATIVE_SKETCH_SETTINGS, validate_english, prepare_handwritten_prompt
from generation_store import canonical, sha256
from image_generation_lock import create_generation_lease, hold_generation_lease, validate_generation_fd
from comfy_client import ComfyRejected
from comfy_workflows import WorkflowStore
from test_comfy_generation_bridge import API, definition
try:
    from PIL import Image
except ImportError:
    Image = None


def encoded(size=(540, 1000)):
    buffer = io.BytesIO()
    Image.new('RGBA', size, (0, 0, 0, 0)).save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


LEGACY_SETTINGS = {'resolution': 1024, 'steps': 40, 'cfg': 1.0, 'seed': 260921, 'sampler': 'euler', 'scheduler': 'simple'}


def body():
    return dict(job_id=str(uuid4()), profile=PROFILE, document_key='["series","episode"]', page_number=1,
                panel_id=1, overlay=False, owner_key='figure-0', label='人物', mode='new',
                width=540, height=1000, prompt='正面を向く人物', character_keys=['character-1'],
                references=[dict(label='三面図', character_keys=['character-1'], image=encoded())])


def translate(value):
    return dict(request_sha256=sha256(canonical(value)), prompt='A person facing forward.',
                references=[dict(file=r['file'], label=f'Reference {i}') for i, r in enumerate(value['references'])])


class QwenPreflightTest(unittest.TestCase):
    # 見込み: 登録定義とAPIの実装情報を照合すれば、ローカルlabなしで利用可否を判定できる。
    # 合格: 有効定義は通り、ノード欠落/解放拡張なしは拒否。範囲: API応答は固定、HTTP/モデルなし。
    def test_registered_workflow_checks_runtime_nodes_and_release_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            workflows = WorkflowStore(root / 'workflows')
            workflow = workflows.save(definition(1, 'qwen'))
            api = API()
            service = QwenGenerationService(root / 'jobs', workflows=workflows, client_factory=lambda endpoint: api)
            service.preflight(workflow)
            with patch.object(api, 'object_info', return_value={}):
                with self.assertRaisesRegex(ValueError, 'ワークフローを利用できません'):
                    service.preflight(workflow)
            api.extension = False
            with self.assertRaisesRegex(ValueError, '解放確認拡張'):
                service.preflight(workflow)
            self.assertEqual(api.calls, [])


@unittest.skipIf(Image is None, 'Pillow required')
class QwenJobsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.leases = self.root / 'leases'
        self.token = str(uuid4())
        create_generation_lease(self.token, self.leases)
        self.workflows = WorkflowStore(self.root / 'workflows')
        self.api = API()
        self.service = QwenGenerationService(self.root / 'jobs', workflows=self.workflows, client_factory=lambda endpoint: self.api)
        self.request = body()
        self.bind_workflow()
        for target, replacement in (
            ('qwen_generation.hold_generation_lease', partial(hold_generation_lease, root=self.leases)),
            ('qwen_generation.validate_generation_fd', partial(validate_generation_fd, root=self.leases)),
            # Popen is synthetic; PID 123 must never inspect a resident process.
            ('qwen_generation.identity', lambda pid: None),
        ):
            patcher = patch(target, replacement); patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(self.service, 'preflight'); patcher.start(); self.addCleanup(patcher.stop)
        # Fail closed if any test accidentally launches a production runtime.
        patcher = patch('qwen_generation.subprocess.Popen', return_value=Mock(pid=123))
        self.spawn = patcher.start(); self.addCleanup(patcher.stop)

    def bind_workflow(self):
        count = len(self.request['references']) + sum(key in self.request for key in ('paint_image', 'sketch_image', 'correction_image'))
        current = self.workflows.get(self.request['workflow_id']) if self.request.get('workflow_id') else None
        if current is None or len(current['binding']['images']) != count:
            current = self.workflows.save(definition(count, 'qwen'))
            self.request.update(workflow_id=current['id'], workflow_version=current['version'])

    def prepare(self):
        self.bind_workflow()
        return self.service.prepare(self.request, translate)

    def submit(self, prepared=None):
        prepared = prepared or self.prepare()
        return self.service.submit(dict(job_id=prepared['job_id'], request_sha256=prepared['request_sha256'], image_session_token=self.token))

    def output(self):
        value = self.service.load(self.request['job_id'])
        raw = base64.b64decode(encoded(tuple(value['output_size'])).split(',')[1])
        self.service.store.write_once(self.request['job_id'], 'output.png', raw)
        if value['settings'].get('candidate_count', 1) > 1:
            self.service.store.write_once(self.request['job_id'], 'selection.json', canonical({'index': 1}))
            self.service.store.write_once(self.request['job_id'], 'candidates.json', canonical({'count': 5}))
        return raw

    # 見込み: PNG検査で得た寸法を再利用すれば二重decodeは不要。
    # 合格: 原画/修正/設定画の3枚を各1回検査し、入力寸法・原本を保持。範囲: 実PNG、推論なし。
    def test_each_input_png_is_validated_once(self):
        from generation_store import validate_png
        self.request.update(mode='paint', paint_image=encoded(), correction_image=encoded())
        with patch('qwen_generation.validate_png', wraps=validate_png) as validate:
            value, images = normalize(self.request)
        self.assertEqual(validate.call_count, 3)
        self.assertEqual(value['input_size'], [540, 1000])
        self.assertEqual([ref['role'] for ref in value['references']], ['paint', 'correction', 'identity'])
        raw = base64.b64decode(self.request['paint_image'].split(',')[1])
        self.assertEqual(images['image-1.png'], raw)

    # 見込み: 固定寸法を先に選べば、細長い配置枠や参照比率に不要な生成寸法制限を掛けない。
    # 合格: new/paint/sketchで8000x100の枠を受理し出力512x768・5seed・キー色を保持。不正な枠寸法は拒否。
    # 範囲: prepareと実PNG保存、接続/起動はsetUpの模擬。原稿上の配置や実推論は未検証。
    def test_fixed_output_dimensions_precede_canvas_and_source_ratio(self):
        for mode in ('new', 'paint', 'sketch'):
            with self.subTest(mode=mode):
                self.request = body()
                self.request.update(mode=mode, width=8000, height=100)
                if mode != 'new':
                    self.request[f'{mode}_image'] = encoded((3200, 40))
                self.bind_workflow()
                fixed = self.workflows.get(self.request['workflow_id'])
                fixed['binding'].update(width=[], height=[], fixed_size=[512, 768])
                fixed['graph']['p']['inputs'].update(width=512, height=768)
                saved = self.workflows.save({**fixed, 'expected_version': fixed['version']})
                self.request['workflow_version'] = saved['version']
                prepared = self.prepare()
                value = self.service.load(prepared['job_id'])
                self.assertEqual(value['output_size'], [512, 768])
                self.assertEqual([value['width'], value['height']], [8000, 100])
                self.assertEqual(value['candidate_seeds'], list(range(SETTINGS['seed'], SETTINGS['seed'] + 5)))
                self.assertEqual(value['settings']['transparency_mode'], 'chroma-key-v1')
                self.assertEqual(value['settings']['chroma_key']['color'], '#00FF00')
                with self.assertRaisesRegex(ValueError, 'キャンバスの寸法が不正'):
                    self.service.normalize_request({**self.request, 'width': False})

    # 見込み: 選択したグラフと版を保存すれば生成モードごとの参照・寸法を保てる。
    # 合格: 3モードとも定義/5seed固定、lab設定を持たずsubmit後も入力不変。範囲: 実保存、起動は模擬。
    def test_all_new_jobs_persist_workflow_snapshot_and_existing_mode_behaviour(self):
        for mode in ('new', 'paint', 'sketch'):
            with self.subTest(mode=mode):
                self.request = body()
                self.request['mode'] = mode
                if mode != 'new':
                    self.request[f'{mode}_image'] = encoded()
                prepared = self.prepare()
                value = self.service.load(prepared['job_id'])
                self.assertEqual(value['workflow'], self.workflows.get(self.request['workflow_id']))
                self.assertEqual(value['settings']['candidate_count'], 5)
                self.assertEqual(value['candidate_seeds'], list(range(SETTINGS['seed'], SETTINGS['seed'] + 5)))
                self.assertNotIn('diffusion_model', value['settings'])
                self.assertNotIn('steps', value['settings'])
                self.assertEqual(value['output_size'], dimensions(540, 1000, 768 if mode == 'sketch' else 1024))
                self.assertEqual(value['settings']['transparency_mode'], 'chroma-key-v1')
                self.assertEqual(value['settings']['chroma_key']['color'], '#00FF00')
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
                self.assertEqual(base64.b64decode(result['image'].split(',', 1)[1]), output)
                self.assertEqual(self.submit(prepared)['status'], 'succeeded')
                self.assertIn(job_id, [item['job_id'] for item in self.service.list(self.request)['jobs']])
                self.assertEqual(store.read(job_id, 'request.json'), source)
                self.assertEqual(store.read(job_id, 'generation-prompt.json'), english)
                self.assertEqual(self.service.delete(self.deletion(prepared))['deleted_job_ids'], [job_id])

    # 見込み: ラフの切抜き寸法は原稿枠から独立し、APIジョブでもその縦横比を保つ。
    # 合格: 原本2枚・800x736・5候補・キー色を保存。範囲: 実PNG/保存、起動は模擬。
    def test_sketch_keeps_its_own_crop_aspect_and_workflow_contract(self):
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
        saved = self.service.load(self.request['job_id'])
        self.assertEqual(saved['output_size'], [800, 736])
        self.assertEqual(saved['settings']['candidate_count'], 5)
        self.assertEqual(saved['settings']['transparency_mode'], 'chroma-key-v1')
        self.assertEqual(self.submit(prepared)['status'], 'queued')

    def test_sketch_requires_bound_character_and_exactly_one_guide(self):
        self.request.update(mode='sketch', sketch_image=encoded())
        for update in ({'character_keys': []}, {'owner_key': 'background'}, {'paint_image': encoded()}, {'references': []}):
            with self.subTest(update=list(update)):
                with self.assertRaises(ValueError):
                    normalize({**self.request, **update})
        with self.assertRaises(ValueError):
            normalize({**self.request, 'mode': 'new'})

    def test_existing_native_sketch_job_remains_readable_without_rewriting_it(self):
        self.request.update(mode='sketch', sketch_image=encoded())
        value, _ = normalize(self.request)
        value['settings'] = NATIVE_SKETCH_SETTINGS
        self.service.store.create(self.request['job_id'])
        self.service.store.write_once(self.request['job_id'], 'request.json', canonical(value))
        self.service.store.write_once(self.request['job_id'], 'request.sha256', sha256(canonical(value)).encode())
        self.assertEqual(self.service.load(self.request['job_id']), value)

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

    def test_panel_and_page_jobs_preserve_each_character_reference_and_composition(self):
        for owner, panel_id in [('panel', 1), ('page', 0)]:
            for mode in ('new', 'paint'):
                with self.subTest(owner=owner, mode=mode):
                    self.request = body()
                    self.request.update(owner_key=owner, panel_id=panel_id, mode=mode,
                                        character_keys=['character-1', 'character-2'])
                    self.request['references'].append(dict(label='二人の衣装',
                        character_keys=['character-2', 'character-1'], image=encoded((120, 80))))
                    if mode == 'paint':
                        self.request['paint_image'] = encoded()
                    prepared = self.prepare()
                    value = self.service.load(prepared['job_id'])
                    refs = value['references']
                    offset = 1 if mode == 'paint' else 0
                    self.assertEqual((prepared['owner_key'], prepared['panel_id'], prepared['overlay']), (owner, panel_id, False))
                    self.assertEqual(value['character_keys'], ['character-1', 'character-2'])
                    self.assertEqual([ref['character_keys'] for ref in refs[offset:]],
                                     [['character-1'], ['character-2', 'character-1']])
                    self.assertEqual([ref['role'] for ref in refs], ['paint'] * offset + ['identity', 'identity'])
                    sources = ([self.request['paint_image']] if offset else []) + [ref['image'] for ref in self.request['references']]
                    for source, ref in zip(sources, refs):
                        raw = base64.b64decode(source.split(',')[1])
                        self.assertEqual(self.service.store.read(prepared['job_id'], ref['file']), raw)
                        self.assertEqual(ref['sha256'], sha256(raw))
                    self.assertEqual(value['output_size'], dimensions(540, 1000))
                    self.assertFalse(value['settings'].get('require_transparency', False))
                    self.assertNotIn('transparency_mode', value['settings'])
                    self.assertEqual(self.service.list(self.request)['jobs'][0]['job_id'], prepared['job_id'])
                    self.assertEqual(self.submit(prepared)['status'], 'queued')

    def test_panel_and_page_require_their_own_scope_coordinates(self):
        for owner, panel_id, overlay in [('panel', 0, False), ('panel', 1, True), ('panel', 0, True),
                                         ('page', 1, False), ('page', 0, True), ('page', -1, False)]:
            with self.subTest(owner=owner, panel_id=panel_id, overlay=overlay), self.assertRaisesRegex(ValueError, 'ページとコマ'):
                normalize({**self.request, 'owner_key': owner, 'panel_id': panel_id, 'overlay': overlay})
        # The existing page-overlay figure route still uses panel_id=0.
        value, _ = normalize({**self.request, 'panel_id': 0, 'overlay': True})
        self.assertEqual((value['owner_key'], value['panel_id'], value['overlay']), ('figure-0', 0, True))

    def test_group_character_bindings_are_unique_bounded_and_complete(self):
        characters = [f'character-{i}' for i in range(10)]
        request = {**self.request, 'owner_key': 'panel', 'character_keys': characters,
                   'references': [dict(label='集合設定画', character_keys=characters, image=encoded())]}
        value, _ = normalize(request)
        self.assertEqual(value['character_keys'], characters)
        self.assertEqual(value['references'][0]['character_keys'], characters)
        for update in ({'character_keys': characters + ['eleventh']},
                       {'character_keys': ['character-1', 'character-1']},
                       {'character_keys': ['character-1', {}]},
                       {'references': []},
                       {'references': [dict(label='一人のみ', character_keys=characters[:-1], image=encoded())]},
                       {'references': [dict(label='別人', character_keys=['unknown'], image=encoded())]},
                       {'references': [dict(label='重複', character_keys=['character-1', 'character-1'], image=encoded())]}):
            with self.subTest(update=update.keys()), self.assertRaises(ValueError):
                normalize({**request, **update})

    def test_group_extension_keeps_individual_character_limits_and_sketch_scope(self):
        for owner, characters in [('figure-0', ['character-1', 'character-2']),
                                  ('background', ['character-1']), ('bubble-0', ['character-1'])]:
            with self.subTest(owner=owner), self.assertRaises(ValueError):
                normalize({**self.request, 'owner_key': owner, 'character_keys': characters})
        for owner, panel_id in [('panel', 1), ('page', 0)]:
            request = {**self.request, 'owner_key': owner, 'panel_id': panel_id}
            value, images = normalize({**request, 'character_keys': [], 'references': []})
            self.assertEqual(value['references'], [])
            self.assertEqual(images, {})
            with self.subTest(owner=owner), self.assertRaisesRegex(ValueError, '登場人物の指定'):
                normalize({**request, 'mode': 'sketch', 'sketch_image': encoded()})

    def test_group_composition_keeps_total_image_budget_and_aspect_validation(self):
        self.request.update(owner_key='panel', mode='paint', paint_image=encoded())
        self.request['references'] *= 9
        value, images = normalize(self.request)
        self.assertEqual(len(images), 10)
        self.assertEqual(value['references'][0]['role'], 'paint')
        with self.assertRaisesRegex(ValueError, '合計10枚'):
            normalize({**self.request, 'correction_image': encoded()})
        with self.assertRaisesRegex(ValueError, '縦横比'):
            normalize({**self.request, 'paint_image': encoded((200, 200))})

    def test_group_literal_text_is_preserved_with_multiple_characters(self):
        for owner, panel_id in [('panel', 1), ('page', 0)]:
            with self.subTest(owner=owner):
                self.request.update(owner_key=owner, panel_id=panel_id, literal_text=['こんにちは'],
                                    character_keys=['character-1', 'character-2'])
                self.request['references'][0]['character_keys'] = self.request['character_keys']
                value, _ = normalize(self.request)
                self.assertEqual(value['literal_text'], ['こんにちは'])
                english = {**translate(value), 'prompt': 'Draw two people saying "こんにちは".'}
                validate_english(value, english)
                with self.assertRaisesRegex(ValueError, '欠落'):
                    validate_english(value, translate(value))
                with self.assertRaisesRegex(ValueError, '日本語'):
                    validate_english(value, {**english, 'prompt': english['prompt'] + ' 赤い服'})
                english['references'][0]['label'] = '人物設定画'
                with self.assertRaisesRegex(ValueError, '日本語'):
                    validate_english(value, english)
        with self.assertRaisesRegex(ValueError, '描く文字'):
            normalize({**body(), 'literal_text': ['こんにちは']})

    def test_handwritten_subject_requires_one_literal_and_preserves_it_through_translation(self):
        literal = 'ド  ン！\nドン'
        request = {**self.request, 'owner_key': 'bubble-0', 'character_keys': [], 'references': [],
                   'content_kind': 'handwritten', 'literal_text': [literal], 'prompt': '描く文字：' + literal}
        value, _ = normalize(request)
        self.assertEqual(value['content_kind'], 'handwritten')
        self.assertEqual(value['literal_text'], [literal])
        english = prepare_handwritten_prompt(value)
        validate_english(value, english)
        with self.assertRaisesRegex(ValueError, '欠落'):
            validate_english(value, translate(value))
        for change in ({'content_kind': None}, {'literal_text': []}, {'literal_text': ['a', 'b']},
                       {'literal_text': ['   ']}, {'owner_key': 'background'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                normalize({**request, **change})

    def test_saved_page_job_with_old_panel_id_remains_readable_without_rewriting(self):
        value, _ = normalize(self.request)
        value.update(owner_key='page', character_keys=[], references=[], literal_text=[])
        job_id, store = self.request['job_id'], self.service.store
        raw = canonical(value)
        store.create(job_id)
        store.write_once(job_id, 'request.json', raw)
        store.write_once(job_id, 'request.sha256', sha256(raw).encode())
        store.event(job_id, 'prepared')
        self.assertEqual(self.service.load(job_id), value)
        self.assertEqual(self.service.payload(job_id)['panel_id'], 1)
        self.assertEqual(self.service.list({**self.request, 'owner_key': 'page'})['jobs'][0]['job_id'], job_id)
        self.assertEqual(store.read(job_id, 'request.json'), raw)

    def test_correction_is_separate_and_keeps_source_mask_identity_order(self):
        self.request.update(mode='paint', paint_image=encoded(), correction_image=encoded())
        value, images = normalize(self.request)
        self.assertEqual([ref['role'] for ref in value['references']], ['paint', 'correction', 'identity'])
        for field, index in [('paint_image', 1), ('correction_image', 2)]:
            self.assertEqual(images[f'image-{index}.png'], base64.b64decode(self.request[field].split(',')[1]))
        self.assertEqual(value['references'][1]['character_keys'], [])
        prepared = self.prepare()
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

    # 見込み: UIの実行状態と保存した準備完了状態で開始を管理する。
    # 合格: 未準備・session未開始は子processゼロ。範囲: 実service、モデル起動だけ模擬。
    def test_missing_session_and_unprepared_job_do_not_launch(self):
        prepared = self.prepare()
        with self.assertRaises(ValueError):
            self.service.submit(dict(job_id=prepared['job_id'], request_sha256=prepared['request_sha256']))
        self.service.store.event(prepared['job_id'], 'preparing')
        self.assertEqual(self.submit(prepared)['status'], 'preparing')
        self.spawn.assert_not_called()

    # 見込み/合格: 書込中断したジョブはpreparingのまま返し、生成しない。範囲: 実保存・模擬起動。
    def test_incomplete_preparation_never_claims_saved_english(self):
        value, images = self.service.normalize_request(self.request)
        store = self.service.store
        store.create(self.request['job_id'])
        store.write_once(self.request['job_id'], 'request.json', canonical(value))
        store.write_once(self.request['job_id'], 'request.sha256', sha256(canonical(value)).encode())
        self.assertEqual(self.prepare()['status'], 'preparing')
        self.spawn.assert_not_called()

    # 見込み: API拒否は終端としてleaseへ記録し、後続候補へ進まない。
    # 合格: POST1回、terminal記録1件、failed、候補2未送信。範囲: 実lease/保存、API拒否は模擬。
    def test_api_rejection_keeps_session_lease_and_stops_candidates(self):
        self.submit()
        with hold_generation_lease(self.token, self.leases) as fd:
            with patch.object(self.api, 'submit', side_effect=ComfyRejected('node rejected')) as submit:
                self.service.run(self.request['job_id'], os.dup(fd), self.token)
            submit.assert_called_once()
            ledger = json.loads(os.pread(fd, 1024 * 1024, 0))
            self.assertEqual(len(ledger['api_submissions']), 1)
            self.assertTrue(ledger['api_submissions'][0]['terminal'])
        self.assertEqual(self.service.payload(self.request['job_id'])['status'], 'failed')
        self.assertFalse((self.service.store.root / self.request['job_id'] / 'api-intent-2.json').exists())

    # 見込み: 正規leaseがないworkerは外部APIへ進まず、復帰可能とも断定しない。
    # 合格: API呼出し0回、outcome_unknown。範囲: 無関係なFDと実worker境界、APIは模擬。
    def test_missing_process_lease_stops_before_comfy_start(self):
        self.submit()
        with open(self.root / 'unrelated', 'w+') as stream:
            self.service.run(self.request['job_id'], os.dup(stream.fileno()), self.token)
        self.assertEqual(self.api.calls, [])
        self.assertEqual(self.api.uploads, [])
        self.assertEqual(self.service.payload(self.request['job_id'])['status'], 'outcome_unknown')

    # 見込み/合格: 採用画像と候補完了記録から結果を回収し、再生成しない。範囲: 実保存・固定PNG。
    def test_output_recovers_without_regeneration_or_hash_sidecar(self):
        prepared = self.prepare(); self.submit(prepared)
        raw = self.output()
        result = self.service.reconcile(self.request)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(base64.b64decode(result['image'].split(',', 1)[1]), raw)
        self.assertNotEqual(result['width'], result['height'])
        self.assertEqual(self.submit(prepared)['status'], 'succeeded')
        self.assertEqual(self.spawn.call_count, 1)

    # 見込み: worker消失後に受付記録だけ残っても同じ候補を再送しない。
    # 合格: 相関IDが未発見ならunknown、worker起動1回、API送信0回。範囲: process照合とAPIは模擬。
    def test_stale_job_unknown_without_respawn(self):
        with patch('qwen_generation.time.time', return_value=1): self.submit()
        self.service.store.write_once(self.request['job_id'], 'api-intent-1.json',
            canonical({'correlation_id': str(uuid4()), 'seed': SETTINGS['seed']}))
        with patch('qwen_generation.subprocess.run', return_value=Mock(stdout='')):
            self.assertEqual(self.service.reconcile(self.request)['status'], 'outcome_unknown')
        self.assertEqual(self.spawn.call_count, 1)
        self.assertEqual(self.api.calls, [])

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
        restarted = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
        self.assertEqual([job['job_id'] for job in restarted.list(self.request)['jobs']], [other['job_id']])
        with self.assertRaises(FileNotFoundError): restarted.reconcile({'job_id': prepared['job_id']})
        for name, content in before.items():
            self.assertEqual((other_dir / name).read_bytes(), content)
        self.spawn.assert_not_called()

    # 見込み/合格: 作品とジョブ範囲だけを確認し、選択外を消さない。内容hashは不要。範囲: 一時フォルダの実削除。
    def test_delete_validates_entire_batch_before_removing_any_job(self):
        prepared = self.prepare()
        self.request['job_id'] = str(uuid4())
        second = self.prepare()
        request = self.deletion(prepared, second)
        invalid = json.loads(json.dumps(request)); invalid['jobs'][1]['job_id'] = '../outside'
        with self.assertRaises(ValueError): self.service.delete(invalid)
        with self.assertRaises(ValueError): self.service.delete({**request, 'document_key': 'another-work'})
        with self.assertRaises(ValueError): self.service.delete({**request, 'jobs': [{'job_id': '../outside', 'request_sha256': 'a'*64}]})
        self.assertEqual(len(self.service.list(self.request)['jobs']), 2)
        result = self.service.delete(request)
        self.assertEqual(result['deleted_job_ids'], [prepared['job_id'], second['job_id']])
        self.assertEqual(self.service.list(self.request)['jobs'], [])

    # 見込み/合格: UIと同じ保存statusで実行中の削除を拒否し、failed後のみ削除。範囲: 実保存。
    def test_delete_rejects_active_uncertain_jobs(self):
        prepared = self.prepare(); request = self.deletion(prepared)
        for status in ('preparing', 'queued', 'running', 'outcome_unknown'):
            self.service.store.event(prepared['job_id'], status)
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, '結果未確定'):
                self.service.delete(request)
            self.assertEqual(self.service.store.latest(prepared['job_id'])['status'], status)
        self.service.store.event(prepared['job_id'], 'failed')
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



class HandwrittenPromptPreparationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        self.workflows = WorkflowStore(root / 'workflows')
        self.api = API()
        self.service = QwenGenerationService(root / 'jobs', workflows=self.workflows, client_factory=lambda endpoint: self.api)
        self.workflow = self.workflows.save(definition(0, 'qwen'))
        patcher = patch.object(self.service, 'preflight')
        patcher.start()
        self.addCleanup(patcher.stop)

    # 見込み: 実frontendの確認文は固定英訳で準備できる。合格: 本文以外CJKなし、表現1行、参照は同順、翻訳callbackゼロ。範囲: TS→Python実コード、画像/モデルのみ模擬。
    def test_handwritten_frontend_prompt_is_prepared_without_a_translator(self):
        program = """
import {createEmptyWorkspaceDocument} from './src/lib/workspaceStartup.ts';
import {paintScene} from './src/lib/paintDocument.ts';
import {buildQwenGenerationPlan,qwenGenerationPrompt,qwenGenerationPayload} from './src/lib/qwenGeneration.ts';
const {manga}=createEmptyWorkspaceDocument();
manga.pages[0].panels=[{id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[{text:'かぁぁ',shape:'handwritten',bbox:{x:10,y:10,w:30,h:20},lettering_pen:'fineliner-01',lettering_expressions:['freehand','energetic']}]}];
const results=[];
for(const shape of ['handwritten','typeset']){
manga.pages[0].panels[0].bubbles[0].shape=shape;
manga.pages[0].panels[0].bubbles[0].text_style={font:'Test Serif',fontWeight:700};
const owner=paintScene(manga.pages[0].panels[0],100,[]).owners.find(o=>o.kind==='bubble');
const plan=buildQwenGenerationPlan(manga,0,0,false,owner);
results.push(...[false,true].map(correction=>qwenGenerationPayload({...plan,prompt:qwenGenerationPrompt(plan,undefined,correction?{kind:'paint'}:undefined),handwrittenPrompt:{...plan.handwrittenPrompt,confirmation:qwenGenerationPrompt(plan,undefined,correction?{kind:'paint'}:undefined)}},[])));
}
console.log(JSON.stringify(results));
"""
        result = subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', program], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
        for source in json.loads(result.stdout):
            self.request = {**source, 'job_id': str(uuid4()), 'workflow_id': self.workflow['id'], 'workflow_version': self.workflow['version']}
            translator = Mock(side_effect=AssertionError('Gemma must not be called'))
            prepared = self.service.prepare(self.request, translator)
            english = self.service.load_english(prepared['job_id'])
            translator.assert_not_called()
            if source['content_kind'] == 'handwritten':
                self.assertIn('Lettering pen: 0.1 mm fineliner.', english['prompt'])
                self.assertIn('Lettering style: freehand strokes; energetic strokes.', english['prompt'])
                self.assertEqual(english['prompt'].count('Lettering style:'), 1)
            else:
                self.assertIn('Subject: typeset text', english['prompt'])
                self.assertIn('Font family: Test Serif', english['prompt'])
                self.assertIn('Font weight: 700', english['prompt'])
                self.assertNotIn('Lettering pen:', english['prompt'])
            self.assertNotRegex(english['prompt'].replace('かぁぁ', ''), r'[\u3040-\u30ff\u3400-\u9fff]')
            self.assertIn('Output canvas:', english['prompt'])
            value = self.service.load(prepared['job_id'])
            validate_english(value, english)
            with self.assertRaisesRegex(ValueError, '一致'):
                validate_english(value, {**english, 'prompt': english['prompt'] + ' Add another word.'})

    # 見込み/合格: 日本語の自由入力・改行・原文は保持し、既知語を含む本文も書き換えない。範囲: 定型準備のみ、モデルなし。
    def test_handwritten_free_instructions_and_literal_are_verbatim(self):
        literal = 'ペン：筆ペン\nかぁぁ'
        free = '細く、柔らかく\nペン：万年筆\n表現：かすれ\n\n  余韻を残す'
        value = {'content_kind':'handwritten', 'literal_text':[literal], 'prompt':f'text:\n{literal}\n\n描き方：{free}\n\nペン：筆ペン',
                 'references':[{'file':'image-1.png','role':'style','label':'日本語の資料名'}], 'handwritten_prompt':{'description':free}}
        english = prepare_handwritten_prompt(value)
        self.assertIn('text:\n' + literal, english['prompt'])
        self.assertIn('Lettering instructions: ' + free, english['prompt'])
        self.assertIn('Lettering pen: brush pen.', english['prompt'])
        self.assertEqual(english['references'], [{'file':'image-1.png','label':'Style reference 1'}])
        validate_english(value, english)
        original = 'text:\nかぁぁ\n\nペン：ミリペン　0.1'
        addition = '\n\nペン：万年筆\n表現：かすれ'
        edited = {'content_kind':'handwritten','literal_text':['かぁぁ'],'references':[], 'prompt':original+addition, 'handwritten_prompt':{'confirmation':original}}
        compiled = prepare_handwritten_prompt(edited)['prompt']
        self.assertIn('Lettering pen: 0.1 mm fineliner.', compiled)
        self.assertTrue(compiled.endswith(addition))
        original = 'text:\nかぁぁ\n\n描き方：柔らかく\nペン：万年筆\n\nペン：筆ペン\n表現：かすれ'
        edited = {**edited, 'prompt':original.replace('柔らかく','強く')+addition, 'handwritten_prompt':{'confirmation':original,'description':'柔らかく\nペン：万年筆'}}
        compiled = prepare_handwritten_prompt(edited)['prompt']
        self.assertIn('Lettering instructions: 強く\nペン：万年筆', compiled)
        self.assertIn('Lettering pen: brush pen.', compiled)
        self.assertIn('Lettering style: broken, scratchy strokes.', compiled)
        self.assertTrue(compiled.endswith(addition))



if __name__ == '__main__': unittest.main()
