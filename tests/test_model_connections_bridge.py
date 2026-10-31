"""見込み: 選択した登録と接続先の読取確認なら、生成や別の選択を起こさず可否を返せる。
合格: ID/版/URLを保持し未確認・接続・定義可否を区別。範囲: 実service/handlerと模擬client。実サーバー・モデルなし。
"""
from copy import deepcopy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from comfy_client import ComfyClient, normalize_endpoint
from nyamuru_model_connections import comfy_endpoint, image_generation_connections
from nyamuru_bridge_http import BridgeHandler

WORKFLOW_ID = 'e679ae9f-8769-4c90-8dfb-4a946f34aa18'


def definition():
    return {
        'id': WORKFLOW_ID, 'name': '作者のワークフロー', 'version': 3,
        'graph': {
            'text': {'class_type': 'Text', 'inputs': {'prompt': '原文', 'seed': 1, 'width': 512, 'height': 512}},
            'save': {'class_type': 'SaveImage', 'inputs': {'images': ['text', 0]}},
        },
        'binding': {**{key: [{'node': 'text', 'input': key}] for key in ('prompt', 'seed', 'width', 'height')},
                    'images': [], 'output': {'node': 'save', 'index': 0}, 'prompt_mode': 'plain', 'fixed_size': None},
    }


def object_info():
    return {
        'Text': {'input': {'required': {'prompt': ['STRING'], 'seed': ['INT'], 'width': ['INT'], 'height': ['INT']}}, 'output': ['IMAGE']},
        'SaveImage': {'input': {'required': {'images': ['IMAGE']}}, 'output': [], 'output_node': True},
    }


class ModelConnectionsTests(unittest.TestCase):
    def setUp(self):
        self.definition = definition()
        self.client = Mock(spec=ComfyClient)
        self.client.system_stats.return_value = {'system': {'comfyui_version': 'fixture'}, 'devices': []}
        self.client.object_info.return_value = object_info()
        self.client.memory_release_available.return_value = True
        def client_factory(endpoint):
            self.client.endpoint = normalize_endpoint(endpoint)
            return self.client
        self.qwen = SimpleNamespace(client_factory=Mock(side_effect=client_factory),
                                    workflows=Mock(get=Mock(return_value=self.definition)),
                                    preflight=Mock(), prepare=Mock(), submit=Mock())
        self.comfy = SimpleNamespace(endpoint='http://127.0.0.1:8188')

    def assert_no_generation(self):
        for name in ('upload_image', 'submit', 'cancel', 'release_models'):
            getattr(self.client, name).assert_not_called()
        self.qwen.preflight.assert_not_called()
        self.qwen.prepare.assert_not_called()
        self.qwen.submit.assert_not_called()

    # 見込み: check未指定なら保存定義の紹介だけで接続済みとしない。
    # 合格: ID/版3とavailable=false、client読取/生成0回、元定義/既定URL不変。範囲: service＋固定store。
    def test_selected_definition_without_probe_is_not_reported_available(self):
        before = deepcopy(self.definition)
        result = image_generation_connections({'workflow_id': WORKFLOW_ID}, self.qwen, self.comfy)
        self.qwen.workflows.get.assert_called_once_with(WORKFLOW_ID)
        self.assertEqual({key: result['workflow'][key] for key in ('id', 'name', 'version')},
                         {key: before[key] for key in ('id', 'name', 'version')})
        self.assertFalse(result['workflow']['available'])
        self.assertEqual(result['comfyui']['status'], 'unchecked')
        self.assertFalse(result['memory_release']['available'])
        self.assertEqual(self.client.method_calls, [])
        self.assertEqual(self.definition, before)
        self.assertEqual(self.comfy.endpoint, 'http://127.0.0.1:8188')
        self.assert_no_generation()

    # 見込み: 選択なしで接続しても固定Qwenへ自動選択しない。
    # 合格: workflow=null、check時だけsystem_stats1回、object_info/生成0回。範囲: 選択なしのservice。
    def test_no_selection_remains_none_even_when_server_is_connected(self):
        unchecked = image_generation_connections({}, self.qwen, self.comfy)
        self.assertIsNone(unchecked['workflow'])
        self.assertEqual(self.client.method_calls, [])
        result = image_generation_connections({'check_comfyui': True}, self.qwen, self.comfy)
        self.assertIsNone(result['workflow'])
        self.assertEqual(result['comfyui']['status'], 'connected')
        self.qwen.workflows.get.assert_not_called()
        self.client.system_stats.assert_called_once_with()
        self.client.object_info.assert_not_called()
        self.client.memory_release_available.assert_not_called()
        self.assert_no_generation()

    # 見込み: 明示登録とURLの仕様照合なら、確認が生成や設定変更を起こさない。
    # 合格: 別ポートを正規化、ID/版保持、3読取だけでavailable=true、既定URL不変。範囲: 模擬client＋実validator。
    def test_explicit_probe_checks_selected_graph_and_release_capability_without_submission(self):
        result = image_generation_connections({'workflow_id': WORKFLOW_ID, 'comfyui_url': 'http://localhost:8199/',
                                                'check_comfyui': True}, self.qwen, self.comfy)
        self.qwen.client_factory.assert_called_once_with('http://localhost:8199/')
        self.assertEqual(result['comfyui']['endpoint'], 'http://127.0.0.1:8199')
        self.assertEqual(result['comfyui']['status'], 'connected')
        self.assertEqual(result['comfyui']['version'], 'fixture')
        self.assertEqual(result['workflow']['id'], WORKFLOW_ID)
        self.assertEqual(result['workflow']['version'], 3)
        self.assertTrue(result['workflow']['available'])
        self.assertTrue(result['memory_release']['available'])
        self.assertIn('実生成は未確認', result['workflow']['message'])
        self.assertEqual([call[0] for call in self.client.method_calls], ['system_stats', 'object_info', 'memory_release_available'])
        self.assertEqual(self.comfy.endpoint, 'http://127.0.0.1:8188')
        self.assert_no_generation()

    # 見込み: サーバー接続と必要nodeの有無は別条件である。
    # 合格: Text欠落はconnectedを維持しavailable=false、該当nodeを表示、生成0回。範囲: 模擬object_info。
    def test_connected_server_does_not_imply_workflow_availability(self):
        info = object_info()
        del info['Text']
        self.client.object_info.return_value = info
        result = image_generation_connections({'workflow_id': WORKFLOW_ID, 'check_comfyui': True}, self.qwen, self.comfy)
        self.assertEqual(result['comfyui']['status'], 'connected')
        self.assertFalse(result['workflow']['available'])
        self.assertIn('Text', result['workflow']['message'])
        self.assert_no_generation()

    # 見込み: 解放確認なしの構成を利用可能としない。
    # 合格: 拡張なしはconnected/available=false、原因表示、解放要求/生成0回。範囲: capability固定応答。
    def test_missing_release_observer_keeps_workflow_unavailable(self):
        self.client.memory_release_available.return_value = False
        result = image_generation_connections({'workflow_id': WORKFLOW_ID, 'check_comfyui': True}, self.qwen, self.comfy)
        self.assertEqual(result['comfyui']['status'], 'connected')
        self.assertFalse(result['workflow']['available'])
        self.assertFalse(result['memory_release']['available'])
        self.assertIn('解放確認拡張', result['workflow']['message'])
        self.assert_no_generation()

    # 見込み: 通信/応答検査の失敗を接続成功に読み替えない。
    # 合格: OSError/ValueErrorはunavailable、定義ID保持、生成0回。範囲: 模擬client例外。
    def test_failed_connection_probe_returns_unavailable_without_fallback(self):
        for error in (OSError('接続を確認できません'), ValueError('応答形式が不正です')):
            with self.subTest(error=error):
                self.client.system_stats.side_effect = error
                result = image_generation_connections({'workflow_id': WORKFLOW_ID, 'check_comfyui': True}, self.qwen, self.comfy)
                self.assertEqual(result['comfyui']['status'], 'unavailable')
                self.assertEqual(result['workflow']['id'], WORKFLOW_ID)
                self.assertFalse(result['workflow']['available'])
                self.assertEqual(result['workflow']['message'], str(error))
        self.client.object_info.assert_not_called()
        self.assert_no_generation()

    # 見込み: JSON objectだけではsystem_statsの構造は保証されない。
    # 合格: system/devices/版の不正型は例外漏れでなくunavailable、生成0回。範囲: serviceへ届く固定JSON値。
    def test_malformed_stats_never_report_connected(self):
        for stats in ({}, {'system': None, 'devices': []}, {'system': {}, 'devices': None},
                      {'system': {'comfyui_version': 7}, 'devices': []}):
            with self.subTest(stats=stats):
                self.client.system_stats.return_value = stats
                result = image_generation_connections({'workflow_id': WORKFLOW_ID, 'check_comfyui': True}, self.qwen, self.comfy)
                self.assertEqual(result['comfyui']['status'], 'unavailable')
                self.assertFalse(result['workflow']['available'])
        self.client.object_info.assert_not_called()
        self.assert_no_generation()

    # 見込み: loopback境界を共通clientでも保持する。
    # 合格: remote/資格情報/path/不正portをAPI読取前に拒否、IPv6 loopback受理。範囲: 実URL正規化、HTTPなし。
    def test_rejects_remote_credential_path_and_invalid_port_before_network(self):
        for url in ['https://localhost:8188', 'http://192.168.1.1:8188', 'http://example.com',
                    'http://localhost.evil.test', 'http://user:password@localhost:8188',
                    'http://localhost:8188/path', 'http://localhost:8188/?key=secret',
                    'http://localhost:8188/#fragment', 'http://localhost:0',
                    'http://localhost:65536', 'http://localhost:bad', 'http://local\nhost:8188']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                image_generation_connections({'comfyui_url': url, 'check_comfyui': True}, self.qwen, self.comfy)
        self.assertEqual(self.client.method_calls, [])
        self.assertEqual(comfy_endpoint('http://[::1]:8188/'), 'http://[::1]:8188')
        self.assert_no_generation()

    # 見込み: truthy値で確認を開始せず、未知操作も実行しない。
    # 合格: 不明key/非bool check/非文字列URLはclient作成前に拒否。範囲: payload境界。
    def test_unknown_operations_and_invalid_payload_types_are_rejected(self):
        invalid = [{'submit': True}, *({'check_comfyui': value} for value in ('true', 1, None, [])),
                   *({'comfyui_url': value} for value in (None, False, 0, []))]
        for body in invalid:
            with self.subTest(body=body), self.assertRaises(ValueError):
                image_generation_connections(body, self.qwen, self.comfy)
        self.qwen.client_factory.assert_not_called()
        self.assert_no_generation()

    # 見込み: 既存handlerなら選択情報を同じserviceで照合しOrigin制限も保持する。
    # 合格: 許可要求はID/版3、外部Originはbody読取前403、生成0回。範囲: handler直呼出し、socketなし。
    def test_http_route_reuses_existing_services_and_enforces_origin(self):
        handler = object.__new__(BridgeHandler)
        handler.path = '/api/image-generation/connections'
        handler.headers = {}
        handler.server = SimpleNamespace(state=SimpleNamespace(qwen_jobs=self.qwen, panel_drafts=self.comfy))
        handler.read_json = Mock(return_value={'workflow_id': WORKFLOW_ID, 'check_comfyui': True})
        handler.send_json = Mock()
        handler.do_POST()
        self.assertEqual(handler.send_json.call_args.args[0], 200)
        self.assertEqual(handler.send_json.call_args.args[1]['workflow']['id'], WORKFLOW_ID)
        self.assertEqual(handler.send_json.call_args.args[1]['workflow']['version'], 3)
        self.assertTrue(handler.send_json.call_args.args[1]['workflow']['available'])
        self.assert_no_generation()
        handler.headers = {'Origin': 'https://other.test'}
        handler.read_json.reset_mock()
        self.qwen.client_factory.reset_mock()
        handler.do_POST()
        self.assertEqual(handler.send_json.call_args.args[0], 403)
        handler.read_json.assert_not_called()
        self.qwen.client_factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
