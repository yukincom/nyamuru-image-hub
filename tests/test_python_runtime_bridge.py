"""Model-free checks for process, image and request ownership."""
import base64
import io
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import nyamuru_local_bridge as bridge
import nyamuru_vision_state as vision_state


class WorkerRuntimeTest(unittest.TestCase):
    def tearDown(self):
        bridge.WORKER_SHUTDOWN_EVENT.clear()
        bridge.terminate_active_workers()

    def test_real_child_returns_json_and_is_reaped(self):
        created = []
        popen = subprocess.Popen
        def spawn(*args, **kwargs):
            child = popen(*args, **kwargs)
            created.append(child)
            return child
        with patch.object(bridge.subprocess, 'Popen', side_effect=spawn):
            result = bridge.run_worker_process(
                [sys.executable, '-c', 'import json,sys; print(json.dumps({"ok":True,"result":json.load(sys.stdin)}))'],
                request={'text': '日本語'}, temporary_paths=[], engine='test', timeout_seconds=5,
            )
        self.assertEqual(result, {'text': '日本語'})
        self.assertEqual(created[0].poll(), 0)
        self.assertTrue(all(stream.closed for stream in (created[0].stdin, created[0].stdout, created[0].stderr)))
        self.assertNotIn(created[0], bridge.ACTIVE_WORKERS)

    def test_protocol_accepts_mlx_logs_but_rejects_non_object(self):
        for output, logs, expected in [('[]', False, None), ('diagnostic\n{"ok":true,"result":{"a":1}}', True, {'a': 1})]:
            with self.subTest(output=output):
                call = lambda: bridge.run_worker_process(
                    [sys.executable, '-c', 'print(' + repr(output) + ')'], request={},
                    temporary_paths=[], engine='test', timeout_seconds=5, allow_log_lines=logs,
                )
                if expected is None:
                    with self.assertRaisesRegex(RuntimeError, '解釈'):
                        call()
                else:
                    self.assertEqual(call(), expected)

    def test_timeout_kill_and_unexpected_communication_failure_close_resources(self):
        for error in (subprocess.TimeoutExpired('test', 1), OSError('pipe failure')):
            with self.subTest(error=type(error).__name__):
                process = Mock(returncode=None, stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO())
                process.poll.return_value = None
                process.communicate.side_effect = error
                process.wait.side_effect = [subprocess.TimeoutExpired('test', 2), -9]
                with patch.object(bridge.subprocess, 'Popen', return_value=process), self.assertRaises(type(error)):
                    bridge.run_worker_process(['test'], request={}, temporary_paths=[], engine='test', timeout_seconds=1)
                process.terminate.assert_called_once()
                process.kill.assert_called_once()
                self.assertEqual(process.wait.call_count, 2)
                self.assertTrue(process.stdout.closed)
                self.assertNotIn(process, bridge.ACTIVE_WORKERS)

    def test_shutdown_race_reaps_a_child_started_just_before_registration(self):
        process = Mock(returncode=None, stdin=None, stdout=None, stderr=None)
        process.poll.return_value = None
        def spawn(*_args, **_kwargs):
            bridge.WORKER_SHUTDOWN_EVENT.set()
            return process
        with patch.object(bridge.subprocess, 'Popen', side_effect=spawn), self.assertRaisesRegex(RuntimeError, '終了処理中'):
            bridge.run_worker_process(['test'], request={}, temporary_paths=[], engine='test', timeout_seconds=1)
        process.terminate.assert_called_once()
        process.wait.assert_called_once()
        process.communicate.assert_not_called()
        self.assertNotIn(process, bridge.ACTIVE_WORKERS)

    def test_shutdown_registry_owns_every_reference_file(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / str(index) for index in range(2)]
            for path in paths:
                path.write_bytes(b'test')
            process = Mock()
            process.poll.return_value = 0
            bridge.register_worker(process, paths)
            self.assertEqual(bridge.ACTIVE_WORKERS[process], tuple(paths))
            bridge.terminate_active_workers()
            self.assertFalse(any(path.exists() for path in paths))
            self.assertNotIn(process, bridge.ACTIVE_WORKERS)

    def test_launch_and_partial_image_write_failures_remove_all_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / 'model'
            model.mkdir()
            (model / 'config.json').write_text('{}')
            temporary_file = tempfile.NamedTemporaryFile
            def create(**kwargs):
                return temporary_file(dir=root, **kwargs)
            for images, failure in (([b'one', b'two'], OSError), ([b'one', object()], TypeError)):
                with self.subTest(failure=failure.__name__), patch.object(bridge.tempfile, 'NamedTemporaryFile', side_effect=create), \
                        patch.object(bridge.subprocess, 'Popen', side_effect=OSError('launch failed')), self.assertRaises(failure):
                    bridge.run_mlx_vlm_worker(
                        python=Path(sys.executable), model=model, worker_name='local_character_reference_worker.py',
                        image_bytes=images, request_payload={}, temporary_prefix='runtime-test-',
                    )
                self.assertEqual(list(root.glob('runtime-test-*')), [])


class BridgeMemoryTest(unittest.TestCase):
    def state(self, root):
        return bridge.LocalVisionState(root, Path(sys.executable), root / 'detector', root / 'ocr',
                                       series_root=root, image_hub_root=root)

    def test_wd_uses_one_shot_child_with_the_same_python_as_its_availability_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            state = self.state(Path(directory))
            with patch.object(state, 'wd_expression_available', return_value=True), \
                    patch.object(vision_state, 'run_local_worker', return_value={'hints': []}) as worker:
                self.assertEqual(state.expression_tagging(b'image'), {'hints': []})
                self.assertEqual(worker.call_args.kwargs['python'], Path(sys.executable))
                self.assertEqual(worker.call_args.kwargs['engine'], 'wd-expression')
                self.assertEqual(worker.call_args.kwargs['image_bytes'], b'image')
            self.assertFalse(hasattr(state, '_wd_expression_tagger'))
            with patch.object(state, 'wd_expression_available', return_value=True), \
                    patch.object(vision_state, 'run_local_worker', side_effect=RuntimeError('optional model unavailable')), \
                    patch.object(bridge.sys, 'stderr', io.StringIO()):
                self.assertEqual(state.expression_tagging(b'image'), {})

    # 通常の人物照合・単独演技で、人物と顔は1枚ずつ別の引数で渡し、顔だけの時は二重送信しない。
    # 実HTTPハンドラ・一時ファイルまで通し、模擬workerで画像順、顔だけのWD、終了時の回収を調べる。実画像判定は行わない。
    def test_face_pixels_survive_both_readers_without_duplicate_images(self):
        import nyamuru_worker_runtime as runner_module
        roi = [0.1, 0.2, 0.4, 0.5]
        full = [0, 0, 1, 1]
        def image_data(data):
            return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").touch()
            state = self.state(root)
            state.vlm_model = root
            state.vlm_python = Path(sys.executable)
            for reader in ("figure-performance", "character-match"):
                for bbox, face, expected in [(roi, b"face", [b"person", b"face"]),
                                             (full, None, [b"person"]), (None, None, [b"person"])]:
                    with self.subTest(reader=reader, bbox=bbox):
                        request = {"image": image_data(b"person"), "current_size": "bust-up", "candidates": []}
                        if bbox is not None:
                            request["face_bbox"] = bbox
                        if face is not None:
                            request["face_image"] = image_data(face)
                        files = []
                        def intercept(command, **kwargs):
                            self.assertTrue(state.analysis_lock.locked())
                            self.assertNotIn("image", request)
                            self.assertNotIn("face_image", request)
                            files.extend(Path(command[i + 1]) for i, word in enumerate(command) if word == "--image")
                            self.assertEqual([f.read_bytes() for f in files], expected)
                            self.assertEqual(kwargs["request"].get("face_bbox"), bbox)
                            return {"suggested_action": "Standing.", "suggested_size": "bust-up", "analysis": {}}
                        handler = bridge.BridgeHandler.__new__(bridge.BridgeHandler)
                        handler.server = SimpleNamespace(state=state)
                        handler.path = f"/api/{reader}/analyze"
                        handler.allowed_origin = lambda: None
                        handler.read_json = lambda: request
                        handler.send_json = Mock()
                        with patch.object(state, "vlm_available", return_value=True), patch.object(
                                state, "expression_tagging", return_value={}) as wd, patch.object(
                                runner_module, "run_worker_process", side_effect=intercept):
                            handler.do_POST()
                        self.assertEqual(handler.send_json.call_args.args[0], 200)
                        self.assertEqual(len(files), len(expected))
                        self.assertFalse(any(path.exists() for path in files))
                        if bbox is None:
                            wd.assert_not_called()
                        else:
                            wd.assert_called_once_with(face or b"person")

    # 別画像のない局所bboxや位置のない別画像は顔の対応を保証できない。模擬入力でworker・WDに届く前の拒否を確認する。
    def test_face_image_must_match_its_declared_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            state = self.state(Path(directory))
            with patch.object(state, "expression_tagging") as wd:
                for face, box in ((b"face", None), (None, [0.2, 0.2, 0.5, 0.5]), (b"", [0, 0, 1, 1]),
                                  (b"face", [0.8, 0.5, 0.2, 1])):
                    with self.subTest(box=box), self.assertRaises(ValueError):
                        state.expression_worker_fields(b"person", face, box)
                wd.assert_not_called()

    def test_batch_stops_loading_at_existing_total_limit_without_base64(self):
        class LargeImage:
            def __len__(self):
                return 40 * 1024 * 1024
        with tempfile.TemporaryDirectory() as directory:
            state = self.state(Path(directory))
            with patch.object(state, 'vlm_available', return_value=True), \
                    patch.object(state.series_catalogs, 'read_character_image', side_effect=lambda *_: {'found': True, 'image_bytes': LargeImage()}) as read, \
                    patch.object(state.series_catalogs, 'load_character_image', side_effect=AssertionError('no Base64')), \
                    patch.object(state, 'character_reference_auxiliary') as auxiliary, \
                    self.assertRaisesRegex(ValueError, '80MB'):
                state.analyze_character_reference_set('series', 'character', [f'image-{index:064x}' for index in range(12)], '')
            self.assertEqual(read.call_count, 3)
            auxiliary.assert_not_called()

    def test_all_analysis_handlers_hold_one_lock_and_release_base64_before_inference(self):
        lock = threading.Lock()
        for path, method in [('layout', 'analyze'), ('figure-performance', 'analyze_figure_performance'),
                             ('character-reference', 'analyze_character_reference'), ('character-match', 'analyze_character_match')]:
            with self.subTest(path=path):
                body = {'image': 'data:image/png;base64,aW1hZ2U=', 'rotation_override_degrees': 0}
                def inference(*args):
                    self.assertTrue(lock.locked())
                    self.assertNotIn('image', body)
                    self.assertEqual(args[0], b'image')
                    return {'ok': True}
                handler = bridge.BridgeHandler.__new__(bridge.BridgeHandler)
                handler.server = SimpleNamespace(state=SimpleNamespace(analysis_lock=lock, **{method: inference}))
                handler.path = f'/api/{path}/analyze'
                handler.allowed_origin = lambda: None
                handler.read_json = lambda: body
                handler.send_json = Mock()
                handler.do_POST()
                handler.send_json.assert_called_once_with(200, {'ok': True})
                self.assertFalse(lock.locked())


if __name__ == '__main__':
    unittest.main()
