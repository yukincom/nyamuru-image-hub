import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import URLError
from urllib.request import ProxyHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from nyamuru_agent_connection import NoRedirect
from nyamuru_model_connections import comfy_endpoint, image_generation_connections
from nyamuru_bridge_http import BridgeHandler


class ModelConnectionsTests(unittest.TestCase):
    def setUp(self):
        self.qwen = SimpleNamespace(preflight=Mock())
        self.comfy = SimpleNamespace(endpoint='http://127.0.0.1:8188')

    def test_runtime_check_uses_existing_preflight_without_network_or_endpoint_mutation(self):
        with patch('nyamuru_model_connections.build_opener') as opener:
            result = image_generation_connections({}, self.qwen, self.comfy)
        self.qwen.preflight.assert_called_once_with()
        opener.assert_not_called()
        self.assertTrue(result['qwen']['available'])
        self.assertEqual(result['qwen']['runtime'], 'ComfyUI Python')
        self.assertEqual(result['qwen']['entrypoint'], 'generate_selected')
        self.assertEqual([item['role'] for item in result['qwen']['models']], ['generation', 'text_encoder', 'vae'])
        self.assertIn('turbo', result['qwen']['models'][0]['file'])
        self.assertEqual(result['comfyui']['status'], 'unchecked')
        self.assertEqual(self.comfy.endpoint, 'http://127.0.0.1:8188')

    def test_missing_runtime_is_not_reported_as_available(self):
        self.qwen.preflight.side_effect = ValueError('private path')
        result = image_generation_connections({}, self.qwen, self.comfy)
        self.assertFalse(result['qwen']['available'])
        self.assertNotIn('private', json.dumps(result))

    def test_explicit_connection_probe_only_reads_system_stats(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(json.dumps({'system': {'comfyui_version': 'fixture'}, 'devices': []}).encode())
        with patch('nyamuru_model_connections.build_opener', return_value=opener) as factory:
            result = image_generation_connections({'comfyui_url': 'http://localhost:8199/', 'check_comfyui': True}, self.qwen, self.comfy)
        opener.open.assert_called_once_with('http://localhost:8199/system_stats', timeout=3)
        self.assertIsInstance(factory.call_args.args[0], ProxyHandler)
        self.assertEqual(factory.call_args.args[0].proxies, {})
        self.assertIsInstance(factory.call_args.args[1], NoRedirect)
        self.assertEqual(result['comfyui']['status'], 'connected')
        self.assertEqual(result['comfyui']['version'], 'fixture')
        self.assertEqual(self.comfy.endpoint, 'http://127.0.0.1:8188', 'existing generation jobs keep their endpoint')

    def test_unavailable_invalid_and_oversized_responses_never_report_connected(self):
        for response in [URLError('private detail'), b'{}', b'invalid', b'x' * (64 * 1024 + 1), b'{"system":{},"devices":null}']:
            opener = Mock()
            if isinstance(response, Exception):
                opener.open.side_effect = response
            else:
                opener.open.return_value = io.BytesIO(response)
            with self.subTest(response=str(response)[:30]), patch('nyamuru_model_connections.build_opener', return_value=opener):
                result = image_generation_connections({'check_comfyui': True}, self.qwen, self.comfy)
                self.assertEqual(result['comfyui']['status'], 'unavailable')
                self.assertNotIn('private detail', json.dumps(result))

    def test_rejects_remote_credential_path_and_invalid_port_before_network(self):
        for url in ['https://localhost:8188', 'http://192.168.1.1:8188', 'http://example.com',
                    'http://localhost.evil.test', 'http://user:password@localhost:8188',
                    'http://localhost:8188/path', 'http://localhost:8188/?key=secret',
                    'http://localhost:8188/#fragment', 'http://localhost:0',
                    'http://localhost:65536', 'http://localhost:bad', 'http://local\nhost:8188']:
            with self.subTest(url=url), patch('nyamuru_model_connections.build_opener') as opener:
                with self.assertRaises(ValueError):
                    image_generation_connections({'comfyui_url': url, 'check_comfyui': True}, self.qwen, self.comfy)
                opener.assert_not_called()
        self.assertEqual(comfy_endpoint('http://[::1]:8188/'), 'http://[::1]:8188')

    def test_unknown_operations_and_non_boolean_probe_are_rejected(self):
        for body in [{'submit': True}, {'check_comfyui': 'true'}, {'comfyui_url': None}]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                image_generation_connections(body, self.qwen, self.comfy)

    def test_http_route_reuses_existing_services_and_enforces_origin(self):
        handler = object.__new__(BridgeHandler)
        handler.path = '/api/image-generation/connections'
        handler.headers = {}
        handler.server = SimpleNamespace(state=SimpleNamespace(qwen_jobs=self.qwen, panel_drafts=self.comfy))
        handler.read_json = Mock(return_value={})
        handler.send_json = Mock()
        with patch('nyamuru_model_connections.build_opener') as opener:
            handler.do_POST()
        self.assertEqual(handler.send_json.call_args.args[0], 200)
        self.assertTrue(handler.send_json.call_args.args[1]['qwen']['available'])
        opener.assert_not_called()
        handler.headers = {'Origin': 'https://other.test'}
        handler.read_json.reset_mock()
        handler.do_POST()
        self.assertEqual(handler.send_json.call_args.args[0], 403)
        handler.read_json.assert_not_called()


if __name__ == '__main__':
    unittest.main()
