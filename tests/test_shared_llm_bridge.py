"""見込み: guardianは生成完了と通常終了を分け、自身が止めたLLMだけ復帰する。
合格: 通常終了は復帰0回、生成完了は外部終了後に復帰し、後片付け済みの予約を解放する。
範囲: 局所ケースは実leaseとmock。Native/孫processのケースだけ別途実processを使う。
"""
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
from unittest.mock import patch, Mock, ANY
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

    # 見込み: 明示した生成完了だけで復帰すれば、通常終了と混同しない。
    # 合格: resume受信後に停止→lease終了→外部終了待ち→復帰、最後に記録除去。範囲: 実lease、プロセスとAPIは模擬。
    def test_session_stops_without_inspecting_comfy_and_restores_after_lease_closes(self):
        events = []
        saved = {"original": True}
        token = str(uuid4())
        def stop(*_):
            saved['stop_requested'] = True
            events.append('stop')
        def close(*args):
            events.append('close')
            return close_generation_lease(*args)
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot', return_value=saved), \
                patch.object(session, 'stop_original', side_effect=stop), \
                patch.object(session, 'close_generation_lease', side_effect=close), \
                patch('image_generation_lock.await_api_release', side_effect=lambda *args, **kw: events.append('external-wait')), \
                patch.object(session, 'restart', side_effect=lambda *args, **kwargs: events.append('restart')), \
                patch.object(session, 'emit', side_effect=lambda state, **kw: events.append(state)), \
                patch.object(session.sys, 'stdin', io.StringIO('resume\n')):
            self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 0)
            self.assertFalse((Path(root) / f'{token}.json').exists())
        self.assertEqual(events, ['stop', 'paused', 'close', 'external-wait', 'restart', 'restored'])

    # 見込み: 通常終了と完了指示なしの切断は、後片付けだけに限定できる。
    # 合格: shutdown/EOFとも外部終了を待って記録除去、再起動0回・復帰false。範囲: 実lease、入力とLLMプロセスは模擬。
    def test_shutdown_and_unrequested_eof_clean_up_without_restoring(self):
        for command in ('shutdown\n', ''):
            with self.subTest(command=command), tempfile.TemporaryDirectory() as root:
                token = str(uuid4()); saved = {}
                def stop(*_): saved['stop_requested'] = True
                with patch.object(session, 'snapshot', return_value=saved), \
                        patch.object(session, 'stop_original', side_effect=stop), \
                        patch.object(session, 'restart') as restart, \
                        patch('image_generation_lock.await_api_release') as cleanup, \
                        patch.object(session, 'emit') as emit, \
                        patch.object(session.sys, 'stdin', io.StringIO(command)):
                    self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 0)
                cleanup.assert_called_once(); restart.assert_not_called()
                emit.assert_called_with('restored', was_running=False)
                self.assertFalse((Path(root) / f'{token}.json').exists())

    # 見込み: 画像終了待ち中の通常終了は、先に届いたresumeより優先できる。
    # 合格: 実pipeへresume後shutdownを送り、待機後の再起動0回・記録除去。範囲: 実pipe/lease、画像終了待ちとLLMは模擬。
    def test_shutdown_during_image_cleanup_supersedes_resume(self):
        read_fd, write_fd = os.pipe()
        try:
            with os.fdopen(read_fd) as stream, tempfile.TemporaryDirectory() as root:
                os.write(write_fd, b'resume\n')
                token = str(uuid4()); saved = {}
                def stop(*_): saved['stop_requested'] = True
                with patch.object(session, 'snapshot', return_value=saved), \
                        patch.object(session, 'stop_original', side_effect=stop), \
                        patch.object(session, 'restart') as restart, patch.object(session, 'emit'), \
                        patch('image_generation_lock.await_api_release', side_effect=lambda *a, **kw: os.write(write_fd, b'shutdown\n')), \
                        patch.object(session.sys, 'stdin', stream):
                    self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 0)
                restart.assert_not_called()
                self.assertFalse((Path(root) / f'{token}.json').exists())
        finally:
            os.close(write_fd)

    def test_originally_off_never_starts_llm(self):
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot') as snapshot, patch.object(session, 'restart') as restart, \
                patch.object(session, 'emit') as emit, patch.object(session.sys, 'stdin', io.StringIO('resume\n')):
            self.assertEqual(session.run_session(8080, '/tmp/log', restore=False, lease_root=root), 0)
            snapshot.assert_not_called(); restart.assert_not_called()
            emit.assert_called_with('restored', was_running=False)

    # 見込み: 起動情報の取得失敗は停止責任を生まず、後続の予約を塞がない。
    # 合格: 開始エラー、停止・復帰0回、記録除去。同tokenの次利用が成功。範囲: 実lease、情報取得だけ故障を模擬。
    def test_snapshot_failure_reports_error_and_releases_marker(self):
        token = str(uuid4())
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot', side_effect=session.SessionError('開始情報を取得できません')) as snapshot, \
                patch.object(session, 'stop_original') as stop, patch.object(session, 'restart') as restart, \
                patch.object(session, 'emit') as emit, patch.object(session.sys, 'stdin', io.StringIO('')):
            self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 1)
            emit.assert_called_once_with('error', message='開始情報を取得できません')
            self.assertFalse((Path(root) / f'{token}.json').exists())
            self.assertEqual(session.run_session(8080, '/tmp/log', restore=False, token=token, lease_root=root), 0)
            snapshot.assert_called_once_with(8080)
            stop.assert_not_called()
            restart.assert_not_called()
            self.assertFalse((Path(root) / f'{token}.json').exists())

    # 見込み: 停止要求前にPIDが入れ替わっても、元のLLMを勝手に復帰しない。
    # 合格: 開始エラーを返し、再起動0回でlease記録を除去する。範囲: 実lease、停止要求前の入替りを模擬。
    def test_stop_refused_before_signal_does_not_restart_and_releases_marker(self):
        saved = {'pid': 42, 'identity': (42, 1)}
        token = str(uuid4())
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot', return_value=saved), \
                patch.object(session, 'stop_original', side_effect=session.SessionError('停止前に入れ替わりました')), \
                patch.object(session, 'restart') as restart, patch.object(session, 'emit') as emit:
            self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 1)
            restart.assert_not_called()
            emit.assert_called_once_with('error', message='停止前に入れ替わりました')
            self.assertFalse((Path(root) / f'{token}.json').exists())

    # 見込み: 自身が停止要求を出した後のtimeoutでは、復帰責任を保持する。
    # 合格: 復帰1回を完了して記録を除去し、元の開始エラーを返す。範囲: 実lease、停止と復帰のプロセス操作は模擬。
    def test_stop_timeout_after_own_signal_recovers_and_releases_marker(self):
        saved = {'original': True}
        token = str(uuid4())
        def stop(*_):
            saved['stop_requested'] = True
            raise session.SessionError('停止失敗')
        with tempfile.TemporaryDirectory() as root, \
                patch.object(session, 'snapshot', return_value=saved), \
                patch.object(session, 'stop_original', side_effect=stop), \
                patch.object(session, 'restart') as restart, patch.object(session, 'emit') as emit, \
                patch.object(session.sys, 'stdin', io.StringIO('resume\n')):
            self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 1)
            restart.assert_called_once_with(saved, 8080, '/tmp/log', should_restore=ANY)
            emit.assert_called_once_with('error', message='停止失敗')
            self.assertFalse((Path(root) / f'{token}.json').exists())

    # 見込み: 外部終了待ちや復帰が未解決なら、開始失敗後も予約を残す。
    # 合格: 後片付けエラーとinactive記録を保持し、外部待機失敗なら復帰0回。範囲: 実lease、待機・復帰の障害は模擬。
    def test_unresolved_cleanup_keeps_marker_and_reports_cleanup_error(self):
        for failed_step in ('external-wait', 'restart'):
            with self.subTest(failed_step=failed_step), tempfile.TemporaryDirectory() as root:
                token = str(uuid4())
                saved = {}
                failure = session.SessionError('復帰未完了')
                def stop(*_):
                    saved['stop_requested'] = True
                    raise session.SessionError('開始失敗')
                with patch.object(session, 'snapshot', return_value=saved), \
                        patch.object(session, 'stop_original', side_effect=stop), \
                        patch('image_generation_lock.await_api_release', side_effect=failure if failed_step == 'external-wait' else None), \
                        patch.object(session, 'restart', side_effect=failure if failed_step == 'restart' else None) as restart, \
                        patch.object(session, 'emit') as emit, \
                        patch.object(session.sys, 'stdin', io.StringIO('resume\n')):
                    self.assertEqual(session.run_session(8080, '/tmp/log', token=token, lease_root=root), 1)
                emit.assert_called_once_with('error', message='復帰未完了')
                self.assertFalse(json.loads((Path(root) / f'{token}.json').read_text())['active'])
                self.assertEqual(restart.call_count, 0 if failed_step == 'external-wait' else 1)

    # 見込み: 自身の停止要求があっても別listenerへ割り込まず、元processも重複起動しない。
    # 合格: どちらも起動0回、停止後の別listenerはエラー。範囲: restart本体、PID照合と起動は模擬。
    def test_restart_does_not_overwrite_new_listener_or_duplicate_old_process(self):
        saved = {'pid': 42, 'identity': (42, 1)}
        with patch.object(session, 'identity', return_value=(42, 1)), patch.object(session.subprocess, 'Popen') as start:
            session.restart(saved, 8080, '/tmp/log')
            start.assert_not_called()
        saved['stop_requested'] = True
        with patch.object(session, 'identity', return_value=None), patch.object(session, 'listener', return_value=99), \
                patch.object(session.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(session.SessionError, '別のLLM'):
                session.restart(saved, 8080, '/tmp/log')
            start.assert_not_called()

    # 見込み: 元PIDの消失・入替りだけでは、LLMを再起動する権限は生じない。
    # 合格: 自身の停止要求がなければPID・listener照合も起動も0回。範囲: restart本体、プロセス状態と起動は模擬。
    def test_restart_never_starts_without_own_stop_request(self):
        saved = {'pid': 42, 'identity': (42, 1)}
        for current in (None, (42, 2)):
            with self.subTest(current=current), patch.object(session, 'identity', return_value=current) as identity, \
                    patch.object(session, 'listener', return_value=None) as listener, \
                    patch.object(session.subprocess, 'Popen') as start:
                session.restart(saved, 8080, '/tmp/log')
                identity.assert_not_called()
                listener.assert_not_called()
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

    # 見込み: 復帰直前・起動中の終了要求にも従えば、終了後にLLMを残さない。
    # 合格: 起動前はPopen0回、起動後は自身のchildだけ終了確認し復帰false。範囲: restart本体、終了要求・PID照合・起動は模擬。
    def test_shutdown_prevents_launch_or_stops_only_the_new_child(self):
        for stage in ('before-launch', 'during-startup'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as root:
                saved = {'pid': 42, 'identity': (42, 1), 'stop_requested': True,
                         'args': ['/fixture/python'], 'env': {}, 'cwd': root, 'streams': {}}
                allow = iter([True, False] if stage == 'before-launch' else [True, True, True, False])
                child = Mock(pid=99)
                with patch.object(session, 'identity', return_value=None), \
                        patch.object(session, 'listener', return_value=None), \
                        patch.object(session.subprocess, 'Popen', return_value=child) as start:
                    self.assertFalse(session.restart(saved, 8080, str(Path(root) / 'log'), should_restore=lambda: next(allow)))
                if stage == 'before-launch':
                    start.assert_not_called(); child.terminate.assert_not_called()
                else:
                    start.assert_called_once(); child.terminate.assert_called_once(); child.wait.assert_called_once_with(timeout=5)

    # 見込み: 接続確認中の終了も成功応答より優先すれば、通常終了後にLLMを残さない。
    # 合格: 接続成功でもshutdownを再読、自身のchildを終了し復帰false。範囲: 実pipe、接続と子プロセスは模擬。
    def test_shutdown_during_ready_check_stops_restored_child(self):
        read_fd, write_fd = os.pipe()
        try:
            with os.fdopen(read_fd) as stream, tempfile.TemporaryDirectory() as root:
                os.write(write_fd, b'resume\n')
                commands = session.SessionCommands(stream); commands.wait()
                saved = {'pid': 42, 'identity': (42, 1), 'stop_requested': True,
                         'args': ['/fixture/python'], 'env': {}, 'cwd': root, 'streams': {}}
                child = Mock(pid=99); child.poll.return_value = None
                def ready(_port):
                    os.write(write_fd, b'shutdown\n')
                    return True
                with patch.object(session, 'identity', return_value=None), \
                        patch.object(session, 'listener', side_effect=[None, 99]), \
                        patch.object(session, 'restored_ready', side_effect=ready), \
                        patch.object(session.subprocess, 'Popen', return_value=child):
                    self.assertFalse(session.restart(saved, 8080, str(Path(root) / 'log'), should_restore=commands.allows_restore))
                child.terminate.assert_called_once(); child.wait.assert_called_once_with(timeout=5)
        finally:
            os.close(write_fd)

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
    # 見込み: 明示resumeなら、画像処理終了後に元の起動条件を復元できる。
    # 合格: resume後に同じargv/env/cwdで復帰、画像処理中は未起動。範囲: 一時portの模擬HTTPと実子プロセス、実モデルなし。
    def test_exact_launch_restored_after_explicit_resume_and_images_finish(self):
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
                guardian.stdin.write('resume\n'); guardian.stdin.flush(); guardian.stdin.close()
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
                for _ in range(100):
                    if session.listener(port) is None: break
                    time.sleep(0.05)
                self.assertIsNone(session.listener(port))


if __name__ == '__main__':
    unittest.main()
