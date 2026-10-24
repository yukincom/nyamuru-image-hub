import importlib.util
import io
import os
from pathlib import Path
import signal
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from uuid import uuid4
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch, Mock
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from image_generation_lock import create_generation_lease, hold_generation_lease, close_generation_lease, activate_generation_lease

spec = importlib.util.spec_from_file_location('shared_llm_process', Path(__file__).parents[1] / 'scripts/shared_llm_process.py')
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class SharedLlmTests(unittest.TestCase):
    def test_native_args_keep_spaces_json_empty_arguments_and_environment(self):
        args = ['/path with spaces/python', '/priority server.py', '--model', 'org/huihui',
                '--chat-template-args', '{"enable_thinking": false}', '']
        data = len(args).to_bytes(4, sys.byteorder) + b'/real/python\0\0\0' + b'\0'.join(os.fsencode(x) for x in args)
        data += b'\0PATH=/existing path/bin\0SETTING=a=b c\0EMPTY=\0\0'
        actual, env = session.parse_procargs(data)
        self.assertEqual(actual, args)
        self.assertEqual(env, {'PATH': '/existing path/bin', 'SETTING': 'a=b c', 'EMPTY': ''})

    def test_changed_pid_identity_is_never_signalled(self):
        with patch.object(session, 'identity', return_value=(42, 2)), patch.object(session.os, 'kill') as kill:
            with self.assertRaisesRegex(session.SessionError, '入れ替わった'):
                session.stop_original({'pid': 42, 'identity': (42, 1)}, 8080)
            kill.assert_not_called()

    def test_waits_for_actual_process_exit_not_just_a_closed_listener(self):
        saved = {'pid': 42, 'identity': (42, 1)}
        sleeps = []
        with patch.object(session, 'identity', side_effect=[(42, 1), (42, 1), None]), \
                patch.object(session, 'listener', side_effect=[42, None]), patch.object(session.os, 'kill') as kill:
            session.stop_original(saved, 8080, sleep=sleeps.append)
            kill.assert_called_once_with(42, signal.SIGTERM)
            self.assertEqual(sleeps, [0.1])

    def test_session_stops_without_inspecting_comfy_and_restores_after_lease_closes(self):
        events = []
        saved = {"original": True}
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot', return_value=saved), \
                patch.object(session, 'stop_original', side_effect=lambda *_: events.append('stop')), \
                patch.object(session, 'restart', side_effect=lambda *args: events.append('restart')), \
                patch.object(session, 'emit', side_effect=lambda state, **kw: events.append(state)), \
                patch.object(session.sys, 'stdin', io.StringIO('')):
            self.assertEqual(session.run_session(8080, '/tmp/log', lease_root=root), 0)
        self.assertEqual(events, ['stop', 'paused', 'restart', 'restored'])

    def test_originally_off_never_starts_llm(self):
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot') as snapshot, patch.object(session, 'restart') as restart, \
                patch.object(session, 'emit') as emit, patch.object(session.sys, 'stdin', io.StringIO('resume\n')):
            self.assertEqual(session.run_session(8080, '/tmp/log', restore=False, lease_root=root), 0)
            snapshot.assert_not_called(); restart.assert_not_called()
            emit.assert_called_with('restored', was_running=False)

    def test_stop_failure_still_recovers_original(self):
        saved = {'original': True}
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot', return_value=saved), \
                patch.object(session, 'stop_original', side_effect=session.SessionError('停止失敗')), \
                patch.object(session, 'restart') as restart, patch.object(session, 'emit') as emit:
            self.assertEqual(session.run_session(8080, '/tmp/log', lease_root=root), 1)
            restart.assert_called_once_with(saved, 8080, '/tmp/log')
            emit.assert_called_once_with('error', message='停止失敗')

    def test_restart_does_not_overwrite_new_listener_or_duplicate_old_process(self):
        saved = {'pid': 42, 'identity': (42, 1)}
        with patch.object(session, 'identity', return_value=(42, 1)), patch.object(session.subprocess, 'Popen') as start:
            session.restart(saved, 8080, '/tmp/log')
            start.assert_not_called()
        with patch.object(session, 'identity', return_value=None), patch.object(session, 'listener', return_value=99), \
                patch.object(session.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(session.SessionError, '別のLLM'):
                session.restart(saved, 8080, '/tmp/log')
            start.assert_not_called()

    def test_slow_sigterm_keeps_waiting_then_restarts(self):
        with tempfile.TemporaryDirectory() as root:
            saved = {'pid': 42, 'identity': (42, 1), 'stop_requested': True,
                     'args': ['/test/python', '--json', '{"a": false}'], 'env': {'x': 'y'}, 'cwd': root, 'streams': {}}
            child = Mock(pid=99); child.poll.return_value = None
            sleeps = []
            with patch.object(session, 'identity', side_effect=[(42, 1), (42, 1), None]), \
                    patch.object(session, 'listener', side_effect=[None, 99]), \
                    patch.object(session, 'restored_ready', return_value=True), \
                    patch.object(session.subprocess, 'Popen', return_value=child) as start:
                session.restart(saved, 8080, str(Path(root) / 'log'), sleep=sleeps.append)
                self.assertEqual(sleeps, [0.5, 0.5])
                self.assertEqual(start.call_args.args[0], saved['args'])
                self.assertEqual(start.call_args.kwargs['env'], saved['env'])

    def test_submission_is_disabled_until_stop_confirmation(self):
        with tempfile.TemporaryDirectory() as root:
            token = str(uuid4())
            create_generation_lease(token, root, active=False)
            with self.assertRaises(ValueError):
                with hold_generation_lease(token, root): self.fail('LLM still stopping')
            activate_generation_lease(token, root)
            with hold_generation_lease(token, root) as fd: self.assertGreaterEqual(fd, 3)

    def test_surviving_comfy_grandchild_keeps_barrier_after_worker_exits(self):
        with tempfile.TemporaryDirectory() as root:
            token = str(uuid4())
            create_generation_lease(token, root)
            released = Path(root) / 'release'
            child_code = 'import pathlib,time,sys; flag=pathlib.Path(sys.argv[1]);\nwhile not flag.exists(): time.sleep(.02)'
            parent_code = 'import subprocess,sys; subprocess.Popen([sys.executable,"-c",sys.argv[1],sys.argv[2]],pass_fds=(int(sys.argv[3]),),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)'
            with hold_generation_lease(token, root) as fd:
                parent = subprocess.Popen([sys.executable, '-c', parent_code, child_code, str(released), str(fd)], pass_fds=(fd,))
            parent.wait(timeout=5)
            closed = threading.Event()
            def finish():
                close_generation_lease(token, root); closed.set()
            waiter = threading.Thread(target=finish)
            waiter.start()
            try:
                self.assertFalse(closed.wait(timeout=.1))
            finally:
                released.touch()
                waiter.join(timeout=5)
            self.assertTrue(closed.is_set())

    def test_closing_lease_waits_for_submitting_bridge_and_blocks_late_submissions(self):
        with tempfile.TemporaryDirectory() as root:
            token = str(uuid4())
            create_generation_lease(token, root)
            entered = threading.Event(); release = threading.Event(); closed = threading.Event()
            def submit():
                with hold_generation_lease(token, root):
                    entered.set(); release.wait(timeout=5)
            def finish():
                close_generation_lease(token, root); closed.set()
            submitting = threading.Thread(target=submit); submitting.start()
            self.assertTrue(entered.wait(timeout=5))
            finishing = threading.Thread(target=finish); finishing.start()
            self.assertFalse(closed.wait(timeout=0.05))
            release.set(); submitting.join(timeout=5); finishing.join(timeout=5)
            self.assertTrue(closed.is_set())
            with self.assertRaisesRegex(ValueError, '利用が終了'):
                with hold_generation_lease(token, root): self.fail('late submission')


@unittest.skipUnless(sys.platform == 'darwin' or sys.platform.startswith('linux'), 'native process snapshots need macOS or Linux')
class SharedLlmNativeTests(unittest.TestCase):
    def test_exact_launch_restored_after_parent_input_closes_and_images_finish(self):
        """Real processes on ephemeral ports; no model, user service, or network outside localhost."""
        with tempfile.TemporaryDirectory(prefix='comic llm restore ') as directory:
            root = Path(directory)
            script = root / 'fixture server.py'
            script.write_text('''import os, sys, json\nfrom http.server import BaseHTTPRequestHandler, HTTPServer\nclass Handler(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200); self.end_headers(); self.wfile.write(json.dumps({"object":"list","data":[{"id":"fixture","object":"model"}]}).encode())\n def log_message(self,*args): pass\nwith open("launches.jsonl","a") as log: log.write(json.dumps({"argv":sys.argv,"env":os.environ.get("CIH_RESTORE_TEST"),"cwd":os.getcwd()})+"\\n")\nHTTPServer(("127.0.0.1",int(sys.argv[1])),Handler).serve_forever()\n''')
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            token = str(uuid4())
            leases = root / 'leases'
            wrapper = root / 'guardian.py'
            wrapper.write_text('import sys\nsys.path.insert(0, '+repr(str(Path(session.__file__).parent))+')\nfrom shared_llm_process import run_session\nraise SystemExit(run_session(int(sys.argv[1]),sys.argv[2],token=sys.argv[3],lease_root=sys.argv[4]))\n')
            log = open(root / 'server.log', 'ab')
            original = subprocess.Popen([sys.executable, str(script), str(port), '{"keep space": false}', ''],
                cwd=root, env={**os.environ, 'CIH_RESTORE_TEST': 'exact value = unchanged'}, stdout=log, stderr=log)
            guardian = None
            worker = None
            try:
                for _ in range(100):
                    if session.restored_ready(port): break
                    time.sleep(0.05)
                self.assertTrue(session.restored_ready(port))
                captured = session.snapshot(port)
                self.assertEqual(captured['args'][-2:], ['{"keep space": false}', ''])
                guardian = subprocess.Popen([sys.executable, str(wrapper), str(port), str(root / 'fallback.log'), token, str(leases)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                self.assertEqual(json.loads(guardian.stdout.readline())['state'], 'paused')
                original.wait(timeout=5)
                with hold_generation_lease(token, leases) as fd:
                    # This process represents ComfyUI and survives release of the HTTP submission lock.
                    worker = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read()'],
                        stdin=subprocess.PIPE, pass_fds=(fd,))
                guardian.stdin.close()
                time.sleep(0.3)
                self.assertIsNone(session.listener(port))
                self.assertIsNone(guardian.poll())
                worker.stdin.close(); worker.wait(timeout=5)
                final = json.loads(guardian.stdout.readline())
                self.assertEqual(final, {'state': 'restored', 'was_running': True})
                self.assertEqual(guardian.wait(timeout=10), 0)
                replay = session.snapshot(port)
                self.assertNotEqual(replay['pid'], original.pid)
                self.assertEqual(replay['args'], captured['args'])
                self.assertEqual(replay['env'], captured['env'])
                self.assertEqual(replay['cwd'], captured['cwd'])
                launches = [json.loads(line) for line in (root / 'launches.jsonl').read_text().splitlines()]
                self.assertEqual(len(launches), 2)
                self.assertEqual(launches[0], launches[1])
            finally:
                if worker is not None:
                    if not worker.stdin.closed: worker.stdin.close()
                    worker.wait(timeout=5)
                if guardian is not None:
                    if not guardian.stdin.closed: guardian.stdin.close()
                    guardian.wait(timeout=15)
                    guardian.stdout.close(); guardian.stderr.close()
                pid = session.listener(port)
                if pid is not None:
                    # This port was allocated solely for the fixture above.
                    os.kill(pid, signal.SIGTERM)
                if original.poll() is None: original.terminate()
                original.wait(timeout=5)
                log.close()


if __name__ == '__main__':
    unittest.main()
