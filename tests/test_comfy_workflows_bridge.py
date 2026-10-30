"""見込み: 保存境界と対応欄だけを検査すれば、ComfyUIの実行判定を重複せず原グラフと参照順を保てる。
合格: 版競合・不正対応を拒否し、候補ごとに指定欄だけを更新する。確認範囲: 一時保存先と模擬object_info。通信・モデル生成・画質は対象外。
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
    # 見込み: API外形を保存境界で確かめれば編集画面JSONを誤登録しない。合格: UI形式・空graph・class_type/inputs不備を拒否。範囲: JSON構造のみ。
    def test_rejects_editor_json_and_bad_node_envelopes(self):
        examples = [{'nodes': [], 'links': []}, {}, {'1': {'inputs': {}}},
                    {'1': {'class_type': 'Text', 'inputs': []}}, {'1': {'class_type': '', 'inputs': {}}}]
        for graph in examples:
            with self.subTest(graph=graph), self.assertRaisesRegex(ValueError, 'API形式'):
                workflows.validate_definition({**definition(), 'graph': graph})

    # 見込み: graph内部の解釈をComfyUIへ任せれば独自の接続判定で登録を妨げない。合格: 欠損・不正port・循環を変更せず保存可能。範囲: 定義のみ、実行可否は未検証。
    def test_link_details_and_cycles_are_deferred_to_comfyui(self):
        for link in (['missing', 0], ['text', -1], ['text', True], ['text'], [1, 0]):
            body = definition()
            body['graph']['sample']['inputs']['positive'] = link
            with self.subTest(link=link):
                self.assertEqual(workflows.validate_definition(body), body)
        body = definition()
        body['graph']['text']['inputs']['loop'] = ['sample', 0]
        self.assertEqual(workflows.validate_definition(body), body)

    # 見込み: 対応を補完しなければ作者が選んだ受け渡し先を保てる。合格: 欠落・リンク先指定・重複・存在しない欄を拒否。範囲: 定義の保存境界。
    def test_bindings_must_be_explicit_unique_literal_sinks(self):
        changes = [lambda b: b.pop('prompt_mode'), lambda b: b.update(prompt=[]), lambda b: b.update(seed=[]),
                   lambda b: b.update(prompt=[sink('sample', 'positive')]),
                   lambda b: b.update(seed=[sink('sample', 'seed'), sink('sample', 'seed')]),
                   lambda b: b.update(prompt=[sink('missing', 'text')]), lambda b: b.update(prompt=[sink('text', 'gone')]),
                   lambda b: b.update(images=[[]]),
                   lambda b: b.update(images=[[sink('text', 'text')]])]
        for change in changes:
            body = definition()
            change(body['binding'])
            with self.subTest(binding=body['binding']), self.assertRaises(ValueError):
                workflows.validate_definition(body)

    # 見込み: 差し替え前のplaceholder型は実際の送信値を決めない。合格: null/bool/配列/辞書を登録でき、bind後は指定した文字列と整数になる。範囲: 保存と変換のみ。
    def test_placeholder_types_do_not_restrict_bound_values(self):
        body = definition()
        body['graph']['text']['inputs']['text'] = None
        body['graph']['sample']['inputs'].update(seed=True, width={'placeholder': 512}, height=[768])
        body['graph']['image-1']['inputs']['image'] = {'placeholder': 'input.png'}
        saved = workflows.validate_definition(body)
        self.assertEqual(saved, body)
        bound = workflows.bind_graph(saved, '指示', ['uploaded.png'], 42, 480, 320)
        self.assertEqual(bound['text']['inputs']['text'], '指示')
        self.assertEqual({key: bound['sample']['inputs'][key] for key in ('seed', 'width', 'height')},
                         {'seed': 42, 'width': 480, 'height': 320})
        self.assertEqual(bound['image-1']['inputs']['image'], 'uploaded.png')

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

    # 見込み: 保存済み定義を使う5候補は毎回の全検証が不要。合格: 定義/JSON/runtime再検証0、graph複製5回、異なる5seedと元定義不変。範囲: binder、実送信は未実施。
    def test_five_candidate_bindings_do_not_repeat_definition_validation(self):
        body = workflows.validate_definition(definition())
        before = deepcopy(body)
        with patch.object(workflows, 'validate_definition', side_effect=AssertionError('定義再検証')) as validate, \
                patch.object(workflows, '_json_copy', side_effect=AssertionError('JSON再検証')) as json_copy, \
                patch.object(workflows, 'validate_runtime', side_effect=AssertionError('runtime再検証')) as runtime, \
                patch.object(workflows, 'deepcopy', wraps=deepcopy) as copy_graph:
            workflows.validate_request(body, 1)
            candidates = [workflows.bind_graph(body, '指示', ['uploaded.png'], seed, 480, 320) for seed in range(5)]
        validate.assert_not_called()
        json_copy.assert_not_called()
        runtime.assert_not_called()
        self.assertEqual(copy_graph.call_count, 5)
        self.assertTrue(all(call.args[0] is body['graph'] for call in copy_graph.call_args_list))
        self.assertEqual([candidate['sample']['inputs']['seed'] for candidate in candidates], list(range(5)))
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
    # 見込み: アップロード予定名は現在の画像一覧になくても利用できる。合格: 2形式の画像enumで事前拒否せず通信0回。範囲: 模擬object_info、実uploadは未実施。
    def test_valid_upload_placeholder_does_not_require_upload_or_network(self):
        with patch('socket.socket', side_effect=AssertionError('通信は禁止')):
            self.assertEqual(workflows.validate_runtime(definition(), object_info()), [])
        info = object_info()
        info['Load']['input']['required']['image'] = ['COMBO', {'options': [], 'image_upload': True}]
        self.assertEqual(workflows.validate_runtime(definition(), info), [])

    # 見込み: 差込先と選択出力の消失は送信前に示せる。合格: Text/Save不在、対応input不在を場所付きerrorにする。範囲: 模擬object_info照合。
    def test_missing_bound_nodes_inputs_and_selected_output_are_reported(self):
        for class_name, node_id in (('Text', 'text'), ('Save', 'save')):
            info = object_info()
            del info[class_name]
            with self.subTest(class_name=class_name):
                errors = workflows.validate_runtime(definition(), info)
                self.assertEqual(len(errors), 1)
                self.assertIn(f'ノード{node_id}', errors[0])
                self.assertIn('ありません', errors[0])
        info = object_info()
        del info['Text']['input']['required']['text']
        errors = workflows.validate_runtime(definition(), info)
        self.assertEqual(len(errors), 1)
        self.assertIn('入力textがComfyUIの入力仕様にありません', errors[0])

    # 見込み: 差込先の型判定はComfyUIに任せれば独自の型固定で拒否しない。合格: union/INT/IMAGE/enum/wrapped型も存在照合を通る。範囲: 模擬仕様、実行可否は未検証。
    def test_bound_input_types_are_deferred_to_comfyui(self):
        for class_name, input_name, spec in [('Text', 'text', ['INT']), ('Sample', 'seed', ['STRING']),
                                             ('Load', 'image', [['placeholder-1.png'], {}]), ('Load', 'image', ['IMAGE']),
                                             ('Text', 'text', ['STRING,INT']), ('Text', 'text', [[['wrapped']], {}])]:
            info = object_info()
            info[class_name]['input']['required'][input_name] = spec
            with self.subTest(spec=spec):
                self.assertEqual(workflows.validate_runtime(definition(), info), [])

    # 見込み: 保存graphのリンク型とportの解釈はComfyUIへ委譲する。合格: IMAGE→MODELと範囲外portで独自errorを出さない。範囲: 模擬object_info、実行は未実施。
    def test_link_type_and_port_are_deferred_to_comfyui(self):
        body = definition()
        body['graph']['sample']['inputs']['model'] = ['image-1', 0]
        self.assertEqual(workflows.validate_runtime(body, object_info()), [])
        body['graph']['sample']['inputs']['model'] = ['model', 1]
        self.assertEqual(workflows.validate_runtime(body, object_info()), [])

    # 見込み: 無関係な枝や値を検査しなければcustom nodeの値表現を妨げない。合格: 未導入枝・必須欠落・enum/型/範囲/wrapped multiselectで拒否せず元graph不変。範囲: 模擬仕様。
    def test_unbound_branches_and_values_are_deferred_to_comfyui(self):
        body = definition()
        body['graph']['model']['inputs']['model_name'] = 'missing.safetensors'
        body['graph']['sample']['inputs']['sampler'] = 'unknown-sampler'
        del body['graph']['text']['inputs']['unchanged']
        body['graph']['sample']['inputs'].update(typo=True, custom_float=100, choices=[['red', 'blue']])
        body['graph']['unused'] = {'class_type': 'Uninstalled', 'inputs': {'union_value': {'value': 'text'}}}
        info = object_info()
        del info['Model']
        info['Sample']['input']['optional'].update(
            custom_float=['FLOAT', {'min': 0, 'max': 1}],
            choices=[['red', 'blue'], {'multiselect': True}])
        before = deepcopy(body)
        saved = workflows.validate_definition(body)
        self.assertEqual(workflows.validate_runtime(saved, info), [])
        self.assertEqual(body, before)
        self.assertEqual(saved, before)

    # 見込み: history出力を型から推測しなければcustom出力を妨げない。合格: output_node/IMAGE属性がなくても選択nodeがあれば通る。範囲: 模擬仕様、画像取得は別確認。
    def test_selected_output_does_not_require_inferred_image_capability(self):
        body = definition()
        body['binding']['output'] = {'node': 'sample', 'index': 0}
        self.assertEqual(workflows.validate_runtime(body, object_info()), [])
        body['binding']['output'] = {'node': 'save', 'index': 63}
        info = object_info()
        info['Save'] = {}
        self.assertEqual(workflows.validate_runtime(body, info), [])

    # 見込み: 動的inputはrootの存在だけ確認すれば細部をComfyUIへ任せられる。合格: nested差込先を通し、root不在だけ拒否。範囲: 模擬dynamic schema、展開は未実施。
    def test_dynamic_bound_inputs_check_only_the_declared_root(self):
        body, info = definition(), object_info()
        text = body['graph']['text']['inputs'].pop('text')
        body['graph']['text']['inputs']['group.generated.text'] = text
        body['binding']['prompt'] = [sink('text', 'group.generated.text')]
        body = workflows.validate_definition(body)
        info['Text']['input']['required'] = {'group': ['COMFY_AUTOGROW_V3', {'template': {}}]}
        self.assertEqual(workflows.validate_runtime(body, info), [])
        info['Text']['input']['required'] = {}
        errors = workflows.validate_runtime(body, info)
        self.assertEqual(len(errors), 1)
        self.assertIn('group.generated.textがComfyUIの入力仕様にありません', errors[0])

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
