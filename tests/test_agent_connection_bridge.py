import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from nyamuru_agent_connection import connection_status, NoRedirect


class AgentConnectionTests(unittest.TestCase):
    def fake(self, responses):
        class Opener:
            def open(self, url, timeout):
                value = responses[url.rsplit('/', 1)[-1]]
                if isinstance(value, Exception):
                    raise value
                return io.BytesIO(json.dumps(value).encode())
        return patch('nyamuru_agent_connection.build_opener', return_value=Opener())

    def test_loaded_gguf_name_is_reported_without_private_path(self):
        with self.fake({'models': {'data': [{'id': 'default_model'}]},
                        'props': {'model_path': '/private/example/gemma-4-test.gguf'}}):
            self.assertEqual(connection_status('http://127.0.0.1:8080/v1/chat/completions'),
                             {'connected': True, 'model': 'gemma-4-test'})

    def test_ordinary_model_id_needs_no_props_request(self):
        with self.fake({'models': {'data': [{'id': 'local/model-name'}]}}):
            self.assertEqual(connection_status('http://localhost:8080/v1/chat/completions'),
                             {'connected': True, 'model': 'model-name'})

    def test_offline_and_malformed_are_disconnected(self):
        for value in (OSError('offline'), {}, [], {'data': []}):
            with self.fake({'models': value}):
                self.assertEqual(connection_status('http://127.0.0.1:8080/v1/chat/completions'),
                                 {'connected': False, 'model': ''})

    def test_only_direct_local_http_is_accepted(self):
        for url in ('https://localhost/v1/chat/completions', 'http://example.com/v1/chat/completions',
                    'http://name:password@localhost:8080/v1/chat/completions'):
            with self.assertRaises(ValueError):
                connection_status(url)
        self.assertIsNone(NoRedirect().redirect_request(None, None, None, None, None))


if __name__ == '__main__':
    unittest.main()
