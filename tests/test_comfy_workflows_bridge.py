"""見込み: 明示した対応だけを保存・反映すれば原グラフと参照順を保てる。
合格: 版競合・不正対応を拒否し、指定欄だけを更新する。確認範囲: 一時保存先と模擬object_info。通信・モデル生成・画質は対象外。
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import comfy_workflows as workflows


def sink(node, name):
    return {'node': node, 'input': name}


def definition(reference_count=1, fixed=False):
    graph = {
        'text': {'class_type': 'Text', 'inputs': {'text': '初期文', 'unchanged': '原文を保持'}, '_meta': {'title': '作者の名前'}},
        'model': {'class_type': 'Model', 'inputs': {'model_name': 'available.safetensors'}},
        'sample': {'class_type': 'Sample', 'inputs': {'model': ['model', 0], 'positive': ['text', 0],
                   'seed': 11, 'width': 512, 'height': 768, 'sampler': 'euler'}},
        'save': {'class_type': 'Save', 'inputs': {'images': ['sample', 0], 'filename_prefix': 'authored-output'}},
    }
    image_bindings = []
    for index in range(reference_count):
        node = f'image-{index + 1}'
        graph[node] = {'class_type': 'Load', 'inputs': {'image': f'placeholder-{index + 1}.png'}}
        graph['sample']['inputs'][f'reference_{index + 1}'] = [node, 0]
        image_bindings.append([sink(node, 'image')])
    return {'name': '登録するグラフ', 'graph': graph, 'binding': {
        'prompt': [sink('text', 'text')], 'seed': [sink('sample', 'seed')],
        'width': [] if fixed else [sink('sample', 'width')],
        'height': [] if fixed else [sink('sample', 'height')],
        'images': image_bindings, 'output': {'node': 'save', 'index': 0},
        'prompt_mode': 'plain', 'fixed_size': [512, 768] if fixed else None,
    }}


def object_info():
    return {
        'Text': {'input': {'required': {'text': ['STRING', {}], 'unchanged': ['STRING', {}]}}, 'output': ['CONDITIONING']},
        'Model': {'input': {'required': {'model_name': [['available.safetensors'], {}]}}, 'output': ['MODEL']},
        'Sample': {'input': {'required': {'model': ['MODEL'], 'positive': ['CONDITIONING'], 'seed': ['INT', {'min': 0}],
                   'width': ['INT', {'min': 32, 'max': 4096}], 'height': ['INT', {'min': 32, 'max': 4096}],
                   'sampler': ['COMBO', {'options': ['euler', 'heun']}]},
                   'optional': {f'reference_{i}': ['IMAGE'] for i in range(1, 11)}}, 'output': ['IMAGE']},
        'Load': {'input': {'required': {'image': [['already-uploaded.png'], {'image_upload': True}]}}, 'output': ['IMAGE', 'MASK']},
        'Save': {'input': {'required': {'images': ['IMAGE'], 'filename_prefix': ['STRING', {}]}, 'hidden': {'prompt': 'PROMPT'}},
                 'output': [], 'output_node': True},
    }


class DefinitionTests(unittest.TestCase):
    # 見込み: API形式だけを受け付ければ編集画面JSONを誤実行しない。合格: UI形式・不正node・欠損接続を拒否。範囲: JSON構造検証のみ。
    def test_rejects_editor_json_bad_nodes_and_broken_links(self):
        examples = [{'nodes': [], 'links': []}, {'1': {'inputs': {}}}, {'1': {'class_type': 'Text', 'inputs': []}}]
        for graph in examples:
            with self.subTest(graph=graph), self.assertRaisesRegex(ValueError, 'API形式'):
                workflows.validate_definition({**definition(), 'graph': graph})
        for link in (['missing', 0], ['text', -1], ['text', True], ['text'], [1, 0]):
            body = definition()
            body['graph']['sample']['inputs']['positive'] = link
            with self.subTest(link=link), self.assertRaisesRegex(ValueError, '接続先'):
                workflows.validate_definition(body)

    # 見込み: 循環は実行前に発見できる。合格: 2ノードの循環を拒否し、通常DAGは通る。範囲: 静的グラフのみ。
    def test_rejects_cycles(self):
        body = definition()
        body['graph']['text']['inputs']['loop'] = ['sample', 0]
        with self.assertRaisesRegex(ValueError, '循環'):
            workflows.validate_definition(body)
        self.assertEqual(workflows.validate_definition(definition())['binding'], definition()['binding'])

    # 見込み: 対応を補完しなければ作者が選んだ受け渡し先を保てる。合格: 欠落・リンク先指定・重複・非整数を拒否。範囲: 定義の検証。
    def test_bindings_must_be_explicit_unique_literal_sinks(self):
        changes = [lambda b: b.pop('prompt_mode'), lambda b: b.update(prompt=[]), lambda b: b.update(seed=[]),
                   lambda b: b.update(prompt=[sink('sample', 'positive')]),
                   lambda b: b.update(seed=[sink('sample', 'seed'), sink('sample', 'seed')]),
                   lambda b: b.update(prompt=[sink('missing', 'text')]), lambda b: b.update(images=[[]]),
                   lambda b: b.update(images=[[sink('text', 'text')]])]
        for change in changes:
            body = definition()
            change(body['binding'])
            with self.subTest(binding=body['binding']), self.assertRaises(ValueError):
                workflows.validate_definition(body)
        body = definition()
        body['graph']['sample']['inputs']['seed'] = True
        with self.assertRaises(ValueError):
            workflows.validate_definition(body)

    # 見込み: 寸法方式を一つに限定すれば固定画像を任意サイズと誤認しない。合格: 対応片方・二重指定・範囲外を拒否。範囲: 定義と数値境界。
    def test_dimensions_and_output_bounds(self):
        for changes in ({'height': []}, {'fixed_size': [512, 768]}, {'output': {'node': 'save', 'index': 64}},
                        {'output': {'node': 'save', 'index': True}}, {'output': {'node': 'gone', 'index': 0}}):
            body = definition()
            body['binding'].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                workflows.validate_definition(body)
        for fixed in (None, [31, 512], [512, 4097], [512.0, 768], [True, 768]):
            body = definition(fixed=True)
            body['binding']['fixed_size'] = fixed
            with self.subTest(fixed=fixed), self.assertRaises(ValueError):
                workflows.validate_definition(body)
        body = definition(fixed=True)
        body['binding']['output']['index'] = 63
        self.assertEqual(workflows.validate_definition(body)['binding']['fixed_size'], [512, 768])

    # 見込み: JSON以外や非有限数を保存前に拒否する。合格: NaN・tuple・非文字列keyは失敗。範囲: 定義のシリアライズ境界。
    def test_rejects_non_json_values(self):
        for value in (float('nan'), float('inf'), (1, 2), {3: 'value'}):
            body = definition()
            body['graph']['text']['_meta']['invalid'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                workflows.validate_definition(body)

    # 見込み: 枚数を明示すれば参照を捨てたり補ったりしない。合格: 0/1/3/10枚は一致時のみ通り、不足・超過を拒否。範囲: request検証。
    def test_exact_reference_count(self):
        for count in (0, 1, 3, 10):
            body = definition(count)
            workflows.validate_request(body, count)
            for wrong in (count + 1, -1, True):
                with self.subTest(count=count, wrong=wrong), self.assertRaises(ValueError):
                    workflows.validate_request(body, wrong)
        with self.assertRaises(ValueError):
            workflows.validate_definition(definition(11))

    # 見込み: 対応欄だけを更新すれば資料順と作者のモデル設定を保持できる。合格: 複数sinkへ同値、画像順一致、他値・元定義不変。範囲: 純粋なグラフ変換。
    def test_bind_graph_preserves_unmapped_values_and_order(self):
        body = definition(3)
        body['graph']['text2'] = deepcopy(body['graph']['text'])
        body['binding']['prompt'].append(sink('text2', 'text'))
        body['graph']['image-copy'] = deepcopy(body['graph']['image-2'])
        body['binding']['images'][1].append(sink('image-copy', 'image'))
        before = deepcopy(body)
        filenames = ['job/pose.png', 'job/character.png', 'job/expression.png']
        bound = workflows.bind_graph(body, '  作者の文\n「日本語」  ', filenames, 9007199254740991, 480, 320)
        expected = deepcopy(before['graph'])
        for node in ('text', 'text2'):
            expected[node]['inputs']['text'] = '  作者の文\n「日本語」  '
        expected['sample']['inputs'].update(seed=9007199254740991, width=480, height=320)
        for index, filename in enumerate(filenames, 1):
            expected[f'image-{index}']['inputs']['image'] = filename
        expected['image-copy']['inputs']['image'] = filenames[1]
        self.assertEqual(bound, expected)
        self.assertEqual(body, before)
        bound['text']['_meta']['title'] = '変更'
        self.assertEqual(body, before)

    # 見込み: 固定寸法の欄は変更しない。合格: requested寸法が異なっても元の幅高さを保持し、seedの範囲外は拒否。範囲: binderの境界。
    def test_fixed_size_is_not_rewritten_and_values_are_bounded(self):
        body = definition(0, fixed=True)
        bound = workflows.bind_graph(body, '指示', [], 0, 1024, 1024)
        self.assertEqual([bound['sample']['inputs'][field] for field in ('width', 'height')], [512, 768])
        for seed in (-1, True, 2**53):
            with self.subTest(seed=seed), self.assertRaises(ValueError):
                workflows.bind_graph(body, '指示', [], seed, 512, 768)
        for width, height in ((31, 512), (512, 4097), (512.0, 768)):
            with self.subTest(width=width, height=height), self.assertRaises(ValueError):
                workflows.bind_graph(definition(0), '指示', [], 1, width, height)


class RuntimeTests(unittest.TestCase):
    # 見込み: アップロード予定名は現在の画像一覧になくても利用できる。合格: 対応済み画像だけenum検査を保留し、通信0回で検証成功。範囲: 模擬object_info。
    def test_valid_upload_placeholder_does_not_require_upload_or_network(self):
        with patch('socket.socket', side_effect=AssertionError('通信は禁止')):
            self.assertEqual(workflows.validate_runtime(definition(), object_info()), [])
        info = object_info()
        info['Load']['input']['required']['image'] = ['COMBO', {'options': [], 'image_upload': True}]
        self.assertEqual(workflows.validate_runtime(definition(), info), [])

    # 見込み: 必要node/inputの変更を送信前に示せる。合格: 消失node、未知入力、必須欠落それぞれ場所付きerror。範囲: 模擬仕様照合。
    def test_missing_nodes_inputs_and_required_fields(self):
        info = object_info()
        del info['Model']
        self.assertTrue(any('model' in error and 'ありません' in error for error in workflows.validate_runtime(definition(), info)))
        body = definition()
        body['graph']['sample']['inputs']['typo'] = 1
        del body['graph']['text']['inputs']['unchanged']
        errors = workflows.validate_runtime(body, object_info())
        self.assertTrue(any('typo' in error for error in errors))
        self.assertTrue(any('unchanged' in error for error in errors))

    # 見込み: literalの見た目だけで型を決めずobject_infoを照合する。合格: prompt/seed/画像の誤型と非upload enumを拒否。範囲: 模擬仕様照合。
    def test_mapped_runtime_types_are_checked(self):
        for class_name, input_name, spec in [('Text', 'text', ['INT']), ('Sample', 'seed', ['STRING']),
                                             ('Load', 'image', [['placeholder-1.png'], {}]), ('Load', 'image', ['IMAGE'])]:
            info = object_info()
            info[class_name]['input']['required'][input_name] = spec
            with self.subTest(spec=spec):
                self.assertTrue(any(input_name in error and '必要' in error for error in workflows.validate_runtime(definition(), info)))

    # 見込み: 保存グラフの接続型とportが現node仕様と異なれば停止できる。合格: IMAGE→MODELと範囲外portを拒否。範囲: 模擬object_info。
    def test_link_type_and_port_are_checked(self):
        body = definition()
        body['graph']['sample']['inputs']['model'] = ['image-1', 0]
        self.assertTrue(any('接続の型' in error for error in workflows.validate_runtime(body, object_info())))
        body['graph']['sample']['inputs']['model'] = ['model', 1]
        self.assertTrue(any('出力1' in error for error in workflows.validate_runtime(body, object_info())))

    # 見込み: モデル未導入や固定値の誤りを検出し、勝手に候補へ置換しない。合格: model/sampler enumと数値型を場所付き拒否、原グラフ不変。範囲: 固定メニュー。
    def test_unavailable_models_and_other_literal_values_are_reported(self):
        body = definition()
        body['graph']['model']['inputs']['model_name'] = 'missing.safetensors'
        body['graph']['sample']['inputs']['sampler'] = 'unknown-sampler'
        body['graph']['text']['inputs']['unchanged'] = 1
        before = deepcopy(body)
        errors = workflows.validate_runtime(body, object_info())
        for name in ('model_name', 'sampler', 'unchanged'):
            self.assertTrue(any(name in error for error in errors), errors)
        self.assertEqual(body, before)

    # 見込み: 非対応のoutputを完成画像と誤認しない。合格: 非output nodeは拒否、画像位置63はport数に拘らず許可。範囲: history画像位置の静的契約。
    def test_output_must_be_image_capable_output_node(self):
        body = definition()
        body['binding']['output'] = {'node': 'sample', 'index': 0}
        self.assertTrue(any('出力ノード' in error for error in workflows.validate_runtime(body, object_info())))
        body['binding']['output'] = {'node': 'save', 'index': 63}
        self.assertEqual(workflows.validate_runtime(body, object_info()), [])

    # 見込み: V3の明示Autogrow名を展開すればQwenの画像接続を照合できる。合格: 3接続が通り、未定義名と不足minimumを拒否。範囲: installed schema形式の固定fixture。
    def test_autogrow_image_links_are_validated(self):
        body, info = definition(3), object_info()
        sample = body['graph']['sample']['inputs']
        for index in range(1, 4):
            sample[f'images.image_{index}'] = sample.pop(f'reference_{index}')
        info['Sample']['input']['optional'] = {}
        info['Sample']['input']['required']['images'] = ['COMFY_AUTOGROW_V3', {'template': {
            'input': {'required': {'image': ['IMAGE', {}]}}, 'names': ['image_1', 'image_2', 'image_3'], 'min': 3}}]
        self.assertEqual(workflows.validate_runtime(body, info), [])
        sample['images.image_4'] = sample.pop('images.image_3')
        errors = workflows.validate_runtime(body, info)
        self.assertTrue(any('image_3' in error for error in errors))
        self.assertTrue(any('image_4' in error for error in errors))

    # 見込み: 未取得・壊れた仕様は利用可能としない。合格: 例外でなくerror一覧を返す。範囲: 不正object_infoの境界。
    def test_missing_or_malformed_object_info_returns_errors(self):
        self.assertTrue(workflows.validate_runtime(definition(), None))
        info = object_info()
        info['Text']['input'] = []
        self.assertTrue(workflows.validate_runtime(definition(), info))


class ExampleTests(unittest.TestCase):
    # 見込み: 枚数別API例は同じ契約で登録・バインドできる。合格: 0/1/3/10の順序・固定8区間・標準backendを保持。範囲: 配布JSON、モデル未実行。
    def test_qwen_examples_keep_explicit_references_and_sampling_settings(self):
        root = Path(__file__).resolve().parents[1] / 'examples' / 'comfyui'
        for count in (0, 1, 3, 10):
            with self.subTest(count=count):
                graph = json.loads((root / f'qwen-turbo-{count}-refs.api.json').read_text())
                binding = json.loads((root / f'qwen-turbo-{count}-refs.binding.json').read_text())
                body = workflows.validate_definition({'name': f'Qwen {count}枚', 'graph': graph, 'binding': binding})
                names = [f'uploaded/reference-{index + 1}.png' for index in range(count)]
                result = workflows.bind_graph(body, '全参照を順番どおり使う。', names, 42, 480, 320)
                for index, filename in enumerate(names, 1):
                    load_node, port = result['6']['inputs'][f'images.image_{index}']
                    self.assertEqual(port, 0)
                    self.assertEqual(result[load_node]['inputs']['image'], filename)
                self.assertEqual(len(binding['images']), count)
                self.assertEqual(len([key for key in result['6']['inputs'] if key.startswith('images.')]), count)
                self.assertEqual(result['10']['inputs']['cfg'], 1)
                self.assertEqual(result['10']['inputs']['noise_seed'], 42)
                self.assertEqual(result['8']['inputs']['sampler_name'], 'euler')
                self.assertEqual([float(value) for value in result['9']['inputs']['sigmas'].split(',')],
                                 [1.0, .978453, .95418, .926626, .89508, .845148, .704534, .414568, 0.0])
                self.assertEqual(result['2']['inputs']['device'], 'cpu')
                self.assertEqual(result['3']['inputs']['attention'], 'pytorch attention')
                self.assertEqual(result['7']['inputs'], {'width': 480, 'height': 320, 'batch_size': 1})


class StoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / 'workflows'
        self.store = workflows.WorkflowStore(self.root)

    # 見込み: 登録IDと版を照合すれば別端末の変更を無言で失わない。合格: v1→v2、古い更新/削除を拒否、正しい解除だけ成功。範囲: 一時ファイルのCRUD。
    def test_crud_and_optimistic_versions(self):
        self.assertEqual(self.store.list(), [])
        self.assertFalse(self.root.exists())
        first = self.store.save(definition())
        self.assertEqual(first['version'], 1)
        self.assertEqual(workflows.WorkflowStore(self.root).get(first['id']), first)
        updated = self.store.save({**first, 'expected_version': 1, 'name': '更新後'})
        self.assertEqual((updated['id'], updated['version']), (first['id'], 2))
        for operation in (lambda: self.store.save({**first, 'expected_version': 1}), lambda: self.store.delete(first['id'], 1)):
            with self.assertRaisesRegex(ValueError, '更新されています'):
                operation()
        self.assertEqual(self.store.list(), [updated])
        self.assertEqual(self.store.delete(first['id'], 2), updated)
        self.assertEqual(self.store.list(), [])
        with self.assertRaises(FileNotFoundError):
            self.store.get(first['id'])

    # 見込み: 保存済み版の指定を必須にすればblind writeを避けられる。合格: updateの欠落/非整数と存在しないIDを拒否。範囲: store受付。
    def test_update_requires_existing_id_and_version(self):
        first = self.store.save(definition())
        for version in (None, True, 0, '1'):
            with self.subTest(version=version), self.assertRaises(ValueError):
                self.store.save({**first, 'expected_version': version})
        with self.assertRaises(FileNotFoundError):
            self.store.save({**definition(), 'id': str(uuid4()), 'expected_version': 1})
        self.assertEqual(self.store.get(first['id']), first)

    # 見込み: store instanceごとの操作も共通lockで直列化できる。合格: 同じv1へ同時更新した2操作の片方だけ成功し最終v2。範囲: 2thread・2store、一時ファイル。
    def test_concurrent_store_instances_do_not_overwrite_newer_version(self):
        first = self.store.save(definition())
        barrier = threading.Barrier(2)
        def update(name):
            barrier.wait(timeout=5)
            try:
                return workflows.WorkflowStore(self.root).save({**first, 'expected_version': 1, 'name': name})
            except ValueError as error:
                return str(error)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(update, ['端末A', '端末B']))
        successful = [result for result in results if isinstance(result, dict)]
        self.assertEqual(len(successful), 1)
        self.assertEqual(successful[0]['version'], 2)
        self.assertEqual(self.store.get(first['id']), successful[0])

    # 見込み: 一時ファイルを完成後に置換すれば中断時も元の版を読める。合格: 部分write失敗後v1とbyte列を保持しpending残存0。範囲: write失敗の模擬。
    def test_partial_write_failure_preserves_previous_definition(self):
        first = self.store.save(definition())
        previous = (self.root / f"{first['id']}.json").read_bytes()
        real_write, writes = workflows.os.write, 0
        def interrupted(fd, raw):
            nonlocal writes
            writes += 1
            if writes == 1:
                return real_write(fd, raw[:5])
            raise OSError('disk full')
        with patch.object(workflows.os, 'write', interrupted), self.assertRaises(OSError):
            self.store.save({**first, 'expected_version': 1, 'name': '途中'})
        self.assertEqual((self.root / f"{first['id']}.json").read_bytes(), previous)
        self.assertEqual(self.store.get(first['id']), first)
        self.assertFalse(list(self.root.glob('.pending-*')))

    # 見込み: UUIDだけをファイル名に使えば外部pathへ操作しない。合格: 全CRUDでpath/不正IDを拒否しroot未作成。範囲: 受付前の境界。
    def test_path_injection_is_rejected_before_storage(self):
        for identifier in ('../outside', '/tmp/test', 'a/b', '', None, 'A' * 36):
            for operation in (lambda: self.store.get(identifier), lambda: self.store.delete(identifier, 1),
                              lambda: self.store.save({**definition(), 'id': identifier, 'expected_version': 1})):
                with self.subTest(identifier=identifier), self.assertRaises(ValueError):
                    operation()
        self.assertFalse(self.root.exists())

    # 見込み: IDが正しくてもsymlinkを辿らなければ外部ファイルを保てる。合格: 読取/更新/解除/一覧が失敗し外部byte不変。範囲: 一時symlink。
    def test_symlink_entries_are_not_followed(self):
        first = self.store.save(definition())
        path = self.root / f"{first['id']}.json"
        outside = self.root.parent / 'outside.json'
        raw = path.read_bytes()
        outside.write_bytes(raw)
        path.unlink()
        path.symlink_to(outside)
        for operation in (lambda: self.store.get(first['id']), lambda: self.store.list(), lambda: self.store.delete(first['id'], 1),
                          lambda: self.store.save({**first, 'expected_version': 1})):
            with self.assertRaises(OSError):
                operation()
        self.assertEqual(outside.read_bytes(), raw)
        self.assertTrue(path.is_symlink())

    # 見込み: ファイル名と内容IDを照合すれば別登録を取り違えない。合格: 内容IDの差替えをget/listで拒否。範囲: 保存破損の模擬。
    def test_stored_identity_must_match_filename(self):
        first = self.store.save(definition())
        path = self.root / f"{first['id']}.json"
        path.write_text(json.dumps({**first, 'id': str(uuid4())}), encoding='utf-8')
        for operation in (lambda: self.store.get(first['id']), lambda: self.store.list()):
            with self.assertRaisesRegex(ValueError, 'IDまたは版'):
                operation()


if __name__ == '__main__':
    unittest.main()
