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
from comfy_generation import desktop_workflow_for_job, run_candidates
from comfy_workflows import (WorkflowStore, validate_definition, validate_request, install_qwen_defaults,
                             QWEN_FIGURE_ID, QWEN_STANDARD_PREFIX)
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


def png(color, size=(64,64)):
    buffer = io.BytesIO()
    Image.new('RGB', size, color).save(buffer, format='PNG')
    return buffer.getvalue()


def data_url(raw):
    return 'data:image/png;base64,' + base64.b64encode(raw).decode()


class ThreeImageWorkflowTests(unittest.TestCase):
    # 見込み: 初期登録を一度だけ行えば、人物専用・通常編集を使い分けても手動設定を上書きしない。
    # 合格: 専用定義と通常2枚の接続、既存登録、削除後の再起動を確認。範囲: 一時フォルダーの本物の登録処理、推論なし。
    def test_defaults_provision_the_requested_graph_without_replacing_saved_choices(self):
        with tempfile.TemporaryDirectory() as directory:
            store = WorkflowStore(Path(directory).resolve())
            custom = store.save({**read_definition(), 'name': 'カスタム'})
            install_qwen_defaults(store)
            preset = store.get(QWEN_FIGURE_ID)
            self.assertEqual(preset['graph'], read_definition()['graph'])
            double = store.get(QWEN_STANDARD_PREFIX + '000000000002')
            self.assertEqual(double['binding']['prompt_mode'], 'qwen')
            self.assertEqual(double['graph']['6']['inputs']['images.image_2'], ['22', 0])
            self.assertNotIn('images.image_3', double['graph']['6']['inputs'])
            store.delete(double['id'], double['version'])
            install_qwen_defaults(store)
            self.assertEqual(store.get(custom['id']), custom)
            self.assertEqual(store.get(preset['id']), preset)
            self.assertNotIn(double['id'], [item['id'] for item in store.list()])

    # 見込み: 同梱旧版だけを更新する。合格: カスタム名保持、2回目は更新なし、削除済みは復活しない。実ストアのみ。
    def test_installed_previous_preset_is_updated_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = WorkflowStore(Path(tmp).resolve())
            old = read_definition()
            old['graph'] = json.loads((EXAMPLES/'qwen-turbo-3-refs.api.json').read_text())
            old['binding'] = json.loads((EXAMPLES/'qwen-turbo-3-refs.binding.json').read_text())
            old['binding']['prompt_mode'] = 'qwen-three-images'
            old['graph']['6']['inputs'].update(prompt=POSITIVE,negative_prompt=NEGATIVE)
            old['graph']['10']['inputs']['cfg'] = 2
            old['name'] = '作品の設定'
            store.save(old,initial_id=QWEN_FIGURE_ID)
            (Path(tmp)/'.bundled-qwen-1').touch()
            install_qwen_defaults(store)
            new = store.get(QWEN_FIGURE_ID)
            self.assertEqual((new['name'],new['version']), ('作品の設定',2))
            self.assertEqual(new['graph'],read_definition()['graph'])
            install_qwen_defaults(store)
            self.assertEqual(new,store.get(QWEN_FIGURE_ID))
            store.delete(QWEN_FIGURE_ID,2)
            install_qwen_defaults(store)
            self.assertEqual(store.list(),[])

    # 見込み: DesktopとAPIが同じ接続なら、原寸ポーズが出力を決定し、負の指示もCFG2で効く。
    # 合格: UIリンクをたどりAPI全リンクと照合、参照の余白・原寸クロップ・正負とCFGを確認。範囲: 配布する両グラフ、推論なし。
    def test_desktop_and_api_use_the_same_native_size_graph(self):
        definition = validate_definition(read_definition())
        graph = definition['graph']
        ui = json.loads((EXAMPLES/f'{NAME}.json').read_text())
        nodes = {str(n['id']):n for n in ui['nodes']}
        links = {n:(str(src),slot) for n,src,slot,*_ in ui['links']}
        for key, n in graph.items():
            self.assertEqual(nodes[key]['type'], n['class_type'])
            for port in nodes[key]['inputs']:
                if port['link'] is not None:
                    self.assertEqual(n['inputs'][port['name']], list(links[port['link']]))
            for field,val in n['inputs'].items():
                if not isinstance(val,list):
                    self.assertEqual(nodes[key]['widgets_values_named'][field], val)
        self.assertEqual(graph['6']['inputs']['resolution'], 0)
        self.assertEqual(graph['6']['inputs']['prompt'], POSITIVE+'\nUniform solid #00FF00 background.')
        self.assertEqual(graph['6']['inputs']['negative_prompt'], NEGATIVE)
        self.assertEqual(graph['10']['inputs']['cfg'], 2)
        self.assertEqual(graph['12']['inputs']['images'], ['38',0])
        self.assertEqual(graph['38']['inputs']['width'], ['34',0])
        self.assertEqual(graph['34']['inputs']['image'], ['23',0])

    # 見込み: 3資料を共用しseedのみを変えれば、選択まで無加工の5候補を保持できる。
    # 合格: 編集したnegativeと固定positiveが別入力へ届き、upload3回、5グラフの差はseedのみ、選んだ3番の背景は透明・中央色は3番・318×159。範囲: 模擬APIと実PNG、実推論を除く。
    def test_five_seeds_and_exact_selected_png(self):
        raw_images = [png('red',(359,450)), png('green',(2101,123)), png('blue',(318,159))]
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
                'label': '人物名は生成文に追加しない', 'mode': 'new', 'width': 318, 'height': 159, 'dpi':600, 'clip_polygon':[[0,0],[1,0],[0,1]],
                'prompt': POSITIVE, 'character_keys': ['character-1'],
                'references': [
                    {'label': 'ネームの表情', 'character_keys': [], 'image': data_url(raw_images[0])},
                    {'label': '人物設定画', 'character_keys': ['character-1'], 'image': data_url(raw_images[1])},
                    {'label': '3Dの詳細ポーズ', 'character_keys': [], 'image': data_url(raw_images[2])}],
                'negative_prompt': 'test exclusions', 'workflow_id': definition['id'], 'workflow_version': definition['version']}
            translate = Mock(side_effect=AssertionError('固定英文で翻訳を呼ばない'))
            job_id = request['job_id']
            with patch.object(service, 'preflight'):
                prepared = service.prepare(request, translate)
            translate.assert_not_called()
            final_prompt = POSITIVE + '\nUniform solid #00FF00 background.'
            self.assertEqual(prepared['generation_prompt'], final_prompt)
            self.assertEqual(preview(request, service)['generation_prompt'], final_prompt)
            value = service.load(job_id)
            self.assertEqual(value['output_size'], [318, 159])
            self.assertEqual(value['settings']['transparency_mode'], 'chroma-key-v1')
            samples = []
            for i in range(1, 6):
                canvas = Image.new('RGB', (318,159), '#00FF00')
                canvas.paste((20*i, 0, 0), (15,15,300,146))
                with io.BytesIO() as stream:
                    canvas.save(stream, 'PNG', dpi=(600,600))
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
                expected['6']['inputs'].update(prompt=final_prompt, negative_prompt='test exclusions')
                expected['10']['inputs']['noise_seed'] = graph['10']['inputs']['noise_seed']
                expected['12']['inputs']['dpi'] = 600
                for node, name in zip(('21', '22', '23'), names, strict=True):
                    expected[node]['inputs']['image'] = name
                self.assertEqual(graph, expected)
            ui = desktop_workflow_for_job({**snapshot,'id':QWEN_FIGURE_ID},graphs[-1])
            actual = {node['id']:node.get('widgets_values_named',{}) for node in ui['nodes']}
            self.assertEqual([actual[n]['image'] for n in (21,22,23)],names)
            self.assertEqual(actual[6]['prompt'],final_prompt)
            self.assertEqual(actual[6]['negative_prompt'],'test exclusions')
            self.assertEqual((actual[10]['cfg'],actual[10]['noise_seed'],actual[12]['dpi']),(2,seeds[-1],600))
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
                self.assertEqual(adopted.getpixel((15,15)), (60, 0, 0, 255))
                self.assertEqual(adopted.getpixel((280,139))[3], 0)
                self.assertAlmostEqual(adopted.info['dpi'][0],600,delta=.02)
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
