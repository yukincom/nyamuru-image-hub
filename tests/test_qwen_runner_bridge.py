"""The manual verifier must not leave the normal UI's session barrier behind."""
from contextlib import ExitStack, redirect_stdout
from functools import partial
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

spec = importlib.util.spec_from_file_location('qwen_smoke_runner', Path(__file__).with_name('run_qwen_sketch_smoke.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerLeaseTest(unittest.TestCase):
    def exercise(self, *, status='succeeded', worker_error=False, close_error=False):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as patches:
            root = Path(directory)
            leases = root / 'leases'
            unrelated = runner.create_generation_lease(str(uuid4()), root=leases, active=False)
            before = unrelated.read_bytes()
            request = root / 'request.json'
            translation = root / 'english.json'
            request.write_text('{}')
            translation.write_text('{}')
            service = Mock()
            service.store.root = root / 'jobs'
            service.prepare.return_value = {'request_sha256': 'test-hash'}
            service.payload.return_value = {'status': status}

            def execute(job_id, fd, token):
                os.close(fd)
                if worker_error:
                    raise RuntimeError('worker failed')

            service.run.side_effect = execute
            patches.enter_context(patch.object(runner, 'QwenGenerationService', return_value=service))
            patches.enter_context(patch.object(runner, 'create_generation_lease', partial(runner.create_generation_lease, root=leases)))
            patches.enter_context(patch.object(runner, 'hold_generation_lease', partial(runner.hold_generation_lease, root=leases)))
            closer = Mock(side_effect=RuntimeError('close failed')) if close_error else partial(runner.close_generation_lease, root=leases)
            patches.enter_context(patch.object(runner, 'close_generation_lease', closer))
            patches.enter_context(patch.dict(sys.modules, {
                'psutil': SimpleNamespace(virtual_memory=lambda: SimpleNamespace(available=64 * 2**30)),
                'PIL': SimpleNamespace(Image=None),
            }))
            patches.enter_context(patch.object(sys, 'argv', ['runner', '--execute', '--request-file', str(request),
                                                          '--translation-file', str(translation), '--output-dir', str(root / 'out')]))
            with redirect_stdout(io.StringIO()):
                if close_error or worker_error:
                    with self.assertRaisesRegex(RuntimeError, 'close failed' if close_error else 'worker failed'):
                        runner.main()
                elif status != 'succeeded':
                    with self.assertRaises(SystemExit):
                        runner.main()
                else:
                    runner.main()
            self.assertEqual(unrelated.read_bytes(), before)
            remaining = set(leases.glob('*.json')) - {unrelated}
            self.assertEqual(len(remaining), 1 if close_error else 0)
            if close_error:
                self.assertTrue(json.loads(remaining.pop().read_text())['active'])

    def test_success_cleans_only_its_own_lease(self):
        self.exercise()

    def test_failed_result_cleans_lease(self):
        self.exercise(status='failed')

    def test_worker_exception_cleans_lease(self):
        self.exercise(worker_error=True)

    def test_failed_close_retains_barrier(self):
        self.exercise(close_error=True)
