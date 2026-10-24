import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from hermes_qwen import request_file, preview, supplied_english, result, run_job
from qwen_generation import QwenGenerationService


class HermesQwenTests(unittest.TestCase):
    def request(self, folder, **extra):
        path = Path(folder) / 'request.json'
        path.write_text(json.dumps({'job_id': str(uuid4()), 'prompt': 'A blue teapot.', **extra}))
        return request_file(path)

    def test_prompt_preserved_and_unsupported_parameters_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            body = self.request(folder)
            output = preview(body)
            self.assertEqual(output['request']['prompt'], body['prompt'])
            self.assertIn(body['prompt'], output['generation_prompt'])
            self.assertNotIn('transparent', output['generation_prompt'])
            with self.assertRaisesRegex(ValueError, 'Unsupported'):
                self.request(folder, steps=1)
            with self.assertRaisesRegex(ValueError, '日本語'):
                preview(self.request(folder, prompt='青いやかん'))

    def test_saved_job_rejects_changed_input_under_same_uuid(self):
        with tempfile.TemporaryDirectory() as folder:
            service = QwenGenerationService(Path(folder).resolve() / 'jobs')
            body = self.request(folder)
            with patch.object(service, 'preflight'):
                first = service.prepare(body, supplied_english)
                self.assertEqual(first['status'], 'prepared')
                self.assertEqual(service.prepare(body, supplied_english)['job_id'], first['job_id'])
                with self.assertRaisesRegex(ValueError, '異なる入力'):
                    service.prepare({**body, 'prompt': 'A red teapot.'}, supplied_english)

    def test_uncertain_job_is_not_submitted_again(self):
        for status in ('running', 'queued', 'outcome_unknown', 'failed'):
            service = Mock()
            service.store.root = Path('/unused')
            service.payload.return_value = {'status': status}
            with self.assertRaisesRegex(ValueError, 'do not resubmit'):
                run_job(service, 'job', 'token')
            service.submit.assert_not_called()

    def test_job_failure_after_submit_is_an_error_even_when_worker_exited_zero(self):
        service = Mock()
        service.store.root = Path('/unused')
        service.payload.return_value = {'status': 'prepared', 'request_sha256': 'hash'}
        service.reconcile.return_value = {'status': 'failed', 'error': 'model failed'}
        with self.assertRaisesRegex(ValueError, 'model failed'):
            run_job(service, 'job', 'token')
        service.submit.assert_called_once_with({'job_id': 'job', 'request_sha256': 'hash', 'image_session_token': 'token'})

    def test_completed_image_is_verified_before_returning_its_path(self):
        service = Mock()
        service.store.root = Path('/unused')
        service.payload.return_value = {'status': 'succeeded'}
        service.verified_output.side_effect = ValueError('output SHA-256 mismatch')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            result(service, 'job')


if __name__ == '__main__':
    unittest.main()
