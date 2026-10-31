"""見込み: 3枚の役割と生成範囲を分ければ、ネームの縦横比にかかわらず原稿に合わせて採用できる。
合格: 5送信の差はseedのみ。採用したPNGが指定寸法で背景透過。範囲: 実登録・保存・PNG、ComfyUI応答と入力資料は模擬。
"""
import base64
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from comfy_generation import run_candidates
from comfy_workflows import WorkflowStore, validate_definition, validate_request
from hermes_qwen import preview
from qwen_generation import PROFILE, QwenGenerationService
from PIL import Image

EXAMPLES = ROOT / 'examples' / 'comfyui'
NAME = 'nyamuru_qwen_turbo_3images'
POSITIVE = ('Black-and-white manga.\n'
            'Facial expression and emotional nuance from <image1>.\n'
            'Character design and drawing style from <image2>.\n'
            'Detailed body pose, including hand and limb positions, from <image3>.')
NEGATIVE = ('text, speech bubbles, panel borders, background scenery, extra people, collage, '
            'multiple views, 3D mannequin, skeleton guides, joint markers, signature, watermark')


def read_definition():
    return {'name': NAME,
            'graph': json.loads((EXAMPLES / f'{NAME}.api.json').read_text()),
            'binding': json.loads((EXAMPLES / f'{NAME}.binding.json').read_text())}


def png(color):
    buffer = io.BytesIO()
    Image.new('RGB', (64, 64), color).save(buffer, format='PNG')
    return buffer.getvalue()


def data_url(raw):
    return 'data:image/png;base64,' + base64.b64encode(raw).decode()


class ThreeImageWorkflowTests(unittest.TestCase):
    # 見込み: 専用定義の変更を3入力に限定すれば既存のモデル・接続を保てる。
    # 合格: 固定positive/negative/CFG2以外が基準グラフと一致。範囲: API定義のみ、Desktop保存UIやモデル品質は未確認。
    def test_only_approved_prompt_and_cfg_change(self):
        definition = validate_definition(read_definition())
        expected = json.loads((EXAMPLES / 'qwen-turbo-3-refs.api.json').read_text())
        expected['6']['inputs'].update(prompt=POSITIVE, negative_prompt=NEGATIVE)
        expected['10']['inputs']['cfg'] = 2
        self.assertEqual(definition['graph'], expected)
        self.assertEqual(definition['binding']['prompt_mode'], 'qwen-three-images')
        self.assertEqual(definition['binding']['output'], {'node': '12', 'index': 0})
        self.assertEqual(definition['graph']['10']['inputs']['negative'], ['6', 1])
        for index, node in enumerate(('21', '22', '23'), 1):
            self.assertEqual(definition['binding']['images'][index - 1], [{'node': node, 'input': 'image'}])
            self.assertEqual(definition['graph']['6']['inputs'][f'images.image_{index}'], [node, 0])

    # 見込み: 3資料を共用しseedのみを変えれば、選択まで無加工の5候補を保持できる。
    # 合格: upload3回、5グラフの差はseedのみ、選んだ3番の背景は透明・中央色は3番・318×159。範囲: 模擬APIと実PNG、実推論を除く。
    def test_five_seeds_and_exact_selected_png(self):
        raw_images = [png(color) for color in ('red', 'green', 'blue')]
        api = Mock(endpoint='http://127.0.0.1:8188')
        api.upload_image.side_effect = lambda _raw, name: 'input/' + name
        api.submit.side_effect = lambda _graph, correlation: correlation
        api.prompt_state.return_value = {'state': 'succeeded', 'history': {'fixture': True}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            workflows = WorkflowStore(root / 'workflows')
            definition = workflows.save(read_definition())
            snapshot = deepcopy(definition)
            service = QwenGenerationService(root / 'jobs', workflows=workflows, client_factory=lambda endpoint: api)
            request = {'job_id': str(uuid4()), 'profile': PROFILE, 'document_key': 'test',
                'page_number': 1, 'panel_id': 1, 'overlay': False, 'owner_key': 'figure-0',
                'label': '人物名は生成文に追加しない', 'mode': 'new', 'width': 318, 'height': 159,
                'prompt': POSITIVE, 'character_keys': ['character-1'],
                'references': [
                    {'label': 'ネームの表情', 'character_keys': [], 'image': data_url(raw_images[0])},
                    {'label': '人物設定画', 'character_keys': ['character-1'], 'image': data_url(raw_images[1])},
                    {'label': '3Dの詳細ポーズ', 'character_keys': [], 'image': data_url(raw_images[2])}],
                'workflow_id': definition['id'], 'workflow_version': definition['version']}
            translate = Mock(side_effect=AssertionError('固定英文で翻訳を呼ばない'))
            job_id = request['job_id']
            with patch.object(service, 'preflight'):
                prepared = service.prepare(request, translate)
            translate.assert_not_called()
            final_prompt = POSITIVE + '\nUniform solid #00FF00 background.'
            self.assertEqual(prepared['generation_prompt'], final_prompt)
            self.assertEqual(preview(request, service)['generation_prompt'], final_prompt)
            value = service.load(job_id)
            self.assertEqual(value['output_size'], [1440, 736])
            self.assertEqual(value['settings']['transparency_mode'], 'chroma-key-v1')
            samples = []
            for i in range(1, 6):
                canvas = Image.new('RGB', (1440, 736), '#00FF00')
                canvas.paste((20*i, 0, 0), (360, 184, 1080, 552))
                with io.BytesIO() as stream:
                    canvas.save(stream, 'PNG')
                    samples.append(stream.getvalue())
            api.get_image.side_effect = samples
            with patch('comfy_generation.record_api_submission'):
                run_candidates(service, job_id, 0)
            service.store.event(job_id, 'succeeded')
            self.assertEqual([call.args[0] for call in api.upload_image.call_args_list], raw_images)
            names = ['input/' + call.args[1] for call in api.upload_image.call_args_list]
            graphs = [call.args[0] for call in api.submit.call_args_list]
            seeds = [graph['10']['inputs']['noise_seed'] for graph in graphs]
            self.assertEqual(seeds, list(range(260921, 260926)))
            for graph in graphs:
                expected = deepcopy(snapshot['graph'])
                expected['6']['inputs']['prompt'] = final_prompt
                expected['10']['inputs']['noise_seed'] = graph['10']['inputs']['noise_seed']
                expected['7']['inputs'].update(width=1440, height=736)
                for node, name in zip(('21', '22', '23'), names, strict=True):
                    expected[node]['inputs']['image'] = name
                self.assertEqual(graph, expected)
            candidates = service.payload(job_id)
            self.assertNotIn('image', candidates)
            self.assertEqual([c['image'] for c in candidates['candidates']], list(map(data_url, samples)))
            selected = service.select({'job_id': job_id, 'candidate_index': 3})
            self.assertEqual((selected['width'], selected['height']), (318, 159))
            summary = service.payload(job_id, include_image=False)
            self.assertEqual((summary['selected_candidate'], summary['width'], summary['height']), (3, 318, 159))
            self.assertNotIn('image', summary)
            saved = service.read_output(job_id)
            self.assertEqual(selected['image'], data_url(saved))
            with Image.open(io.BytesIO(saved)) as adopted:
                self.assertEqual((adopted.mode, adopted.size), ('RGBA', (318, 159)))
                self.assertEqual(adopted.getpixel((0, 0))[3], 0)
                self.assertEqual(adopted.getpixel((159, 79)), (60, 0, 0, 255))
            self.assertEqual(workflows.get(definition['id']), snapshot)
            with self.assertRaises(ValueError):
                service.normalize_request({**request, 'job_id': str(uuid4()), 'references': list(reversed(request['references'][:2])) + request['references'][2:]})

    # 見込み: 3枚ちょうどに限定すれば、不足画像の複製や余分な資料の黙示削除を避けられる。
    # 合格: 3枚は受理、0/1/2/4/10枚は拒否。範囲: 登録定義の枚数検査、画像の意味判定は対象外。
    def test_missing_or_extra_images_are_rejected(self):
        definition = read_definition()
        validate_request(definition, 3)
        for count in (0, 1, 2, 4, 10):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, '参照画像は3枚'):
                validate_request(definition, count)


if __name__ == '__main__':
    unittest.main()
