"""見込み: workerのresetと回収処理が完了したidle時だけ解放を確認する。
合格: 他ジョブ不変、token冪等、失敗時にreleasedを返さない。
範囲: 本体拡張と偽のComfyUIモジュール。実モデル・GPU/MPS回収は未確認。
"""

import asyncio
import importlib.util
from pathlib import Path
import sys
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


TOKEN = "12345678-1234-4234-8234-123456789abc"
OTHER = "87654321-4321-4321-8321-123456789abc"
EXTENSION = Path(__file__).parents[1] / "comfyui_extensions/nyamuru_memory_release/__init__.py"


class Queue:
    def __init__(self):
        self.mutex = threading.RLock()
        self.not_empty = threading.Condition(self.mutex)
        self.running = []
        self.pending = []
        self.flags = {}
        self.flag_calls = []
        self.task_counter = 0

    def get_tasks_remaining(self):
        with self.mutex:
            return len(self.running) + len(self.pending)

    def set_flag(self, name, value):
        if not self.mutex._is_owned():
            raise AssertionError("flags must be set under the queue lock")
        self.flags[name] = value
        self.flag_calls.append((name, value))


class Routes:
    def __init__(self):
        self.handlers = {}

    def route(self, method, path):
        def register(handler):
            if (method, path) in self.handlers:
                raise AssertionError("duplicate route")
            self.handlers[method, path] = handler
            return handler
        return register

    def get(self, path):
        return self.route("GET", path)

    def post(self, path):
        return self.route("POST", path)


class Request:
    def __init__(self, body=None, remote="127.0.0.1"):
        self.body, self.remote = body, remote

    async def json(self):
        return self.body


class MemoryReleaseTests(unittest.TestCase):
    def setUp(self):
        self.queue = Queue()
        self.server = SimpleNamespace(prompt_queue=self.queue, routes=Routes())
        self.events = []
        events = self.events

        class Executor:
            def __init__(executor, server):
                executor.server = server
                executor.fail_reset = False
                executor.reset_calls = 0
                executor.reset()

            def reset(executor):
                events.append("reset")
                executor.reset_calls += 1
                if executor.fail_reset:
                    raise RuntimeError("reset failure")
                executor.caches = object()
                return "original-result"

        self.executor_class = Executor
        self.models = ModuleType("comfy.model_management")
        self.models.current_loaded_models = []
        self.models.soft_empty_cache = lambda: self.events.append("empty_cache")
        self.web = SimpleNamespace(json_response=lambda body, status=200: SimpleNamespace(body=body, status=status))
        aiohttp = ModuleType("aiohttp")
        aiohttp.web = self.web
        execution = ModuleType("execution")
        execution.PromptExecutor = Executor
        comfy = ModuleType("comfy")
        comfy.model_management = self.models
        server = ModuleType("server")
        server.PromptServer = SimpleNamespace(instance=self.server)
        modules = {"memory_release_under_test.print_png": SimpleNamespace(NyamuruSavePrintPNG=object),
                   "aiohttp": aiohttp, "execution": execution, "comfy": comfy,
                   "comfy.model_management": self.models, "server": server}
        spec = importlib.util.spec_from_file_location("memory_release_under_test", EXTENSION)
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, modules):
            spec.loader.exec_module(self.module)
        self.observer = getattr(Executor, "_nyamuru_memory_release_observer")
        self.observer.collect = lambda: self.events.append("gc")
        self.executor = Executor(self.server)
        self.events.clear()

    def worker_release(self):
        """Simulate installed main.py's unload -> reset order, without models."""
        flags = self.queue.flags.copy()
        self.queue.flags.clear()
        if flags.get("unload_models"):
            self.models.current_loaded_models.clear()
        if flags.get("free_memory"):
            return self.executor.reset()

    def call(self, method, path, body=None, remote="127.0.0.1"):
        return asyncio.run(self.server.routes.handlers[method, path](Request(body, remote)))

    # 見込み: HTTP受付とflags消費を完了と区別すれば回収前の復帰を防げる。
    # 合格: reset以前はpending、reset→GC→cache解放後だけreleased。範囲: worker順序の模擬。
    def test_release_requires_original_reset_gc_and_device_cache_clear(self):
        self.models.current_loaded_models.append(object())
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
        self.assertEqual(self.events, [])
        self.assertEqual(self.queue.flags, {"unload_models": True, "free_memory": True})
        self.queue.flags.clear()
        self.models.current_loaded_models.clear()
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
        self.assertEqual(self.executor.reset(), "original-result")
        self.assertEqual(self.events, ["reset", "gc", "empty_cache"])
        result = self.observer.request(TOKEN)
        self.assertEqual(result, {"protocol": 1, "token": TOKEN, "state": "released", "queue_idle": True,
                                  "loaded_model_count": 0})

    # 見込み: 同token再照会を冪等にすれば毎pollで解放処理を再予約しない。
    # 合格: pending/releasedの反復でもflags設定は最初の2件だけ。範囲: 模擬queue。
    def test_pending_and_released_polls_do_not_repeat_flags(self):
        for _ in range(3):
            self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
        self.assertEqual(len(self.queue.flag_calls), 2)
        self.worker_release()
        for _ in range(3):
            self.assertEqual(self.observer.request(TOKEN)["state"], "released")
        self.assertEqual(len(self.queue.flag_calls), 2)

    # 見込み: 初回flag通知をworkerが取り逃してもpending pollの通知で起床できる。
    # 合格: 同token/別tokenとも条件変数へ通知するがflags設定回数は増えない。範囲: 偽queue通知。
    def test_pending_polls_wake_waiter_without_rearming_flags(self):
        self.observer.request(TOKEN)
        with patch.object(self.queue.not_empty, "notify", wraps=self.queue.not_empty.notify) as notify:
            self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
            self.assertEqual(self.observer.request(OTHER)["state"], "busy")
        self.assertEqual(notify.call_count, 2)
        self.assertEqual(len(self.queue.flag_calls), 2)

    # 見込み: 他の解放tokenに保留中の所有権を奪わせない。
    # 合格: 別tokenはbusy、元tokenとflags不変。範囲: 模擬request。
    def test_another_token_cannot_replace_pending_release(self):
        self.observer.request(TOKEN)
        result = self.observer.request(OTHER)
        self.assertEqual(result["state"], "busy")
        self.assertEqual(result["error"], "another_release_pending")
        self.assertEqual(self.observer.record["token"], TOKEN)
        self.assertEqual(len(self.queue.flag_calls), 2)

    # 見込み: 実行・待機のどちらが存在してもそのジョブを変更しない。
    # 合格: busy、flagsゼロ、両キューの内容不変。範囲: 偽ジョブ2件。
    def test_active_queue_is_never_cleared_interrupted_or_released(self):
        self.queue.running = [{"id": "other-running"}]
        self.queue.pending = [{"id": "other-pending"}]
        result = self.observer.request(TOKEN)
        self.assertEqual(result["state"], "busy")
        self.assertEqual(self.queue.flag_calls, [])
        self.assertEqual(self.queue.running, [{"id": "other-running"}])
        self.assertEqual(self.queue.pending, [{"id": "other-pending"}])
        self.assertIsNone(self.observer.record)

    # 見込み: resetとの間に他ジョブが来ても、完了を偽らず後のidleで回復できる。
    # 合格: busy→idleで一度再arm→worker処理後released。範囲: flags消費後の競合を模擬。
    def test_busy_after_reset_rearms_when_idle(self):
        self.observer.request(TOKEN)
        self.queue.pending.append({"id": "other"})
        self.worker_release()
        self.assertEqual(self.observer.record["state"], "busy")
        self.assertEqual(self.queue.pending, [{"id": "other"}])
        self.assertNotIn("gc", self.events)
        self.queue.pending.clear()
        self.queue.task_counter += 1
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
        self.assertEqual(len(self.queue.flag_calls), 4)
        self.worker_release()
        self.assertEqual(self.observer.request(TOKEN)["state"], "released")

    # 見込み: 解放確認後に完了した別ジョブの実行キャッシュも再回収する。
    # 合格: loadedが空でもtask_counter変化でpendingに戻り、新resetを要求。範囲: 新実行の模擬。
    def test_completed_new_job_invalidates_old_confirmation_even_with_no_loaded_models(self):
        self.observer.request(TOKEN)
        self.worker_release()
        self.assertEqual(self.observer.request(TOKEN)["state"], "released")
        self.queue.task_counter += 1
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
        self.assertEqual(len(self.queue.flag_calls), 4)

    # 見込み: loaded modelsの残存があれば空キューだけでは解放完了にしない。
    # 合格: reset後もモデルが残ればbusy、次のidle要求で再arm。範囲: 偽model一覧。
    def test_loaded_models_prevent_confirmation(self):
        self.observer.request(TOKEN)
        self.models.current_loaded_models.append(object())
        self.executor.reset()
        self.assertEqual(self.observer.record["state"], "busy")
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")
        self.assertEqual(len(self.models.current_loaded_models), 1)

    # 見込み: constructorのresetは既存実行キャッシュの解放を証明しない。
    # 合格: pending中に新executorを作ってもGC・ackなし。範囲: 偽executor constructor。
    def test_constructor_reset_does_not_acknowledge(self):
        self.observer.request(TOKEN)
        self.executor_class(self.server)
        self.assertEqual(self.events, ["reset"])
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")

    # 見込み: 別serverのexecutor初期化で自serverの解放をackしない。
    # 合格: 別server reset後もpending、追加GCなし。範囲: 同classの別instance。
    def test_other_server_reset_does_not_acknowledge(self):
        self.observer.request(TOKEN)
        other_executor = self.executor_class(SimpleNamespace())
        other_executor.reset()
        self.assertNotIn("gc", self.events)
        self.assertEqual(self.observer.request(TOKEN)["state"], "pending")

    # 見込み: 元resetの失敗を隠さず、完了状態を作らない。
    # 合格: 元例外を再送出しtokenはfailed、GC未実行。範囲: reset故障注入。
    def test_original_reset_failure_is_failed_and_propagated(self):
        self.observer.request(TOKEN)
        self.executor.fail_reset = True
        with self.assertRaisesRegex(RuntimeError, "reset failure"):
            self.executor.reset()
        result = self.observer.request(TOKEN)
        self.assertEqual(result["state"], "failed")
        self.assertIn("cache_reset_failed", result["error"])
        self.assertNotIn("gc", self.events)

    # 見込み: GCとdevice cacheのどちらが失敗しても復帰を許可しない。
    # 合格: 各故障でfailedを返し、同token pollは再予約しない。範囲: 回収関数を模擬。
    def test_collection_and_device_cache_failures_never_confirm(self):
        def fail():
            raise RuntimeError("cleanup failure")

        for which in ("gc", "device"):
            with self.subTest(which=which):
                self.setUp()
                self.observer.request(TOKEN)
                if which == "gc":
                    self.observer.collect = fail
                else:
                    self.models.soft_empty_cache = fail
                self.executor.reset()
                self.assertEqual(self.observer.request(TOKEN)["state"], "failed")
                self.assertEqual(len(self.queue.flag_calls), 2)

    # 見込み: reset後の確認をqueue mutex内で行えば確認中のjob取得と競合しない。
    # 合格: 回収待機中に別threadがqueueへ入れず、解放後に追加し次要求はbusy。範囲: 偽queue並行試験。
    def test_confirmation_holds_queue_mutex(self):
        entered, finish, attempted, appended = (threading.Event() for _ in range(4))
        errors = []

        def collect():
            if not self.queue.mutex._is_owned():
                raise AssertionError("confirmation must hold the queue lock")
            entered.set()
            if not finish.wait(2):
                raise RuntimeError("test timed out")

        def reset():
            try:
                self.executor.reset()
            except BaseException as exc:
                errors.append(exc)

        def enqueue():
            attempted.set()
            with self.queue.mutex:
                self.queue.pending.append({"id": "other"})
                appended.set()

        self.observer.collect = collect
        self.observer.request(TOKEN)
        worker = threading.Thread(target=reset)
        submitter = threading.Thread(target=enqueue)
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            submitter.start()
            self.assertTrue(attempted.wait(1))
            self.assertFalse(appended.wait(0.05))
        finally:
            finish.set()
            worker.join(2)
            if submitter.ident is not None:
                submitter.join(2)
        self.assertEqual(errors, [])
        self.assertFalse(worker.is_alive())
        self.assertFalse(submitter.is_alive())
        self.assertTrue(appended.is_set())
        self.assertEqual(self.observer.request(TOKEN)["state"], "busy")

    # 見込み: 二重importでもフックとrouteを増やさず元resetを一度だけ呼ぶ。
    # 合格: installが同observerを返し関数identity不変、reset回数が1増加。範囲: 偽server。
    def test_install_is_idempotent(self):
        reset = self.executor_class.reset
        observer = self.module.install(self.server, self.executor_class, self.models, self.web)
        self.assertIs(observer, self.observer)
        self.assertIs(reset, self.executor_class.reset)
        before = self.executor.reset_calls
        self.executor.reset()
        self.assertEqual(self.executor.reset_calls, before + 1)
        self.assertEqual(len(self.server.routes.handlers), 2)

    # 見込み: 能力確認は純粋な読取で、LAN直通や不正tokenは変更を起こさない。
    # 合格: capabilities=1、非loopback403、不正body400、flagsなし。範囲: 本体HTTP handlersの模擬要求。
    def test_routes_validate_loopback_and_token_without_mutation(self):
        result = self.call("GET", "/nyamuru/memory/capabilities")
        self.assertEqual(result.body, {"protocol": 1})
        self.assertEqual(self.call("GET", "/nyamuru/memory/capabilities", remote="192.168.1.5").status, 403)
        for body in [{"token": "bad"}, {"token": TOKEN, "extra": True}, [], {"token": TOKEN.upper()}]:
            with self.subTest(body=body):
                self.assertEqual(self.call("POST", "/nyamuru/memory/release", body).status, 400)
        self.assertEqual(self.call("POST", "/nyamuru/memory/release", {"token": TOKEN}, remote="remote.invalid").status, 403)
        self.assertEqual(self.queue.flag_calls, [])
        accepted = self.call("POST", "/nyamuru/memory/release", {"token": TOKEN}, remote="::1")
        self.assertEqual(accepted.status, 200)
        self.assertEqual(accepted.body["state"], "pending")


if __name__ == "__main__":
    unittest.main()
