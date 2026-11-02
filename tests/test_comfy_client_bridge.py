"""見込み: 明示したジョブ・出力だけを扱い、受付不明を再送しない。
合格: URL境界、照合、対象取消、解放確認の契約を満たす。
範囲: 本体clientと模擬HTTP応答。実ComfyUI・モデル・GPU動作は対象外。
"""

import base64
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit


SPEC = importlib.util.spec_from_file_location("comfy_client_test_module", Path(__file__).parents[1] / "scripts/comfy_client.py")
client_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(client_module)
ComfyClient = client_module.ComfyClient
TOKEN = "12345678-1234-4234-8234-123456789abc"
OTHER = "87654321-4321-4321-8321-123456789abc"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=")
IDLE = {"queue_running": [], "queue_pending": []}


class Response:
    def __init__(self, value, status=200):
        self.body = io.BytesIO(value if isinstance(value, bytes) else json.dumps(value).encode())
        self.status = status

    def read(self, size=-1):
        return self.body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.body.close()


class FakeOpener:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def open(self, request, timeout):
        self.calls.append(request)
        result = self.responder(request)
        if isinstance(result, Exception):
            raise result
        return Response(result)


def error(status, detail=None):
    return HTTPError("http://127.0.0.1:8188/prompt", status, "test response", {},
                     io.BytesIO(json.dumps(detail or {}).encode()))


def item(prompt_id, correlation=TOKEN):
    return [0, prompt_id, {"some-node": {"class_type": "Example", "inputs": {}}},
            {"nyamuru_submission_id": correlation}, ["some-node"]]


class ComfyClientTests(unittest.TestCase):
    def client(self, responder):
        client = ComfyClient("http://127.0.0.1:8188")
        client._opener = FakeOpener(responder)
        return client

    # 見込み: URLをoriginに限定すれば外部接続・別pathへ到達しない。
    # 合格: 正規化結果一致、不正URL全件が通信前に拒否。範囲: URL処理のみ。
    def test_endpoint_normalization_and_rejection(self):
        self.assertEqual(ComfyClient("http://LOCALHOST:8188/").endpoint, "http://127.0.0.1:8188")
        self.assertEqual(ComfyClient("http://[::1]:8188/").endpoint, "http://[::1]:8188")
        for endpoint in ["https://localhost:8188", "http://example.com", "http://127.0.0.1.evil",
                         "http://user@localhost", "http://localhost/a", "http://localhost?x=1",
                         "http://localhost?", "http://localhost#", "http://localhost:0",
                         "http://localhost:65536", "http://localhost:", "http://localhost\\evil",
                         "http://localhost\n", "http://127.1", "http://[::1%25en0]", "//localhost"]:
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                ComfyClient(endpoint)

    # 見込み: 環境proxyとredirectを無効化すればloopback境界が保たれる。
    # 合格: 空proxy handlerと拒否handlerを使用し転送が例外。範囲: transport設定、実通信なし。
    def test_proxy_environment_and_redirects_are_not_followed(self):
        with patch.dict(os.environ, {"http_proxy": "http://remote.invalid:9999"}), \
                patch.object(client_module, "build_opener") as build:
            ComfyClient("http://localhost:8188")
        proxy, redirects = build.call_args.args
        self.assertEqual(proxy.proxies, {})
        with self.assertRaises(client_module.ComfyError):
            redirects.redirect_request(None, None, 302, "Found", {}, "https://remote.invalid/")

    # 見込み: 確認APIは読取だけでモデルを実行しない。
    # 合格: 対応する3つのGETのみ。範囲: 模擬JSON応答。
    def test_readonly_endpoints(self):
        client = self.client(lambda request: {"ok": True})
        self.assertEqual(client.system_stats(), {"ok": True})
        self.assertEqual(client.object_info(), {"ok": True})
        client._opener.responder = lambda request: {}
        self.assertEqual(client.history(TOKEN), {})
        self.assertEqual([(r.method, urlsplit(r.full_url).path) for r in client._opener.calls],
                         [("GET", "/system_stats"), ("GET", "/object_info"), ("GET", "/history/" + TOKEN)])

    # 見込み: サーバー返却名を使い、上書きせず参照順を呼出側で保てる。
    # 合格: multipartに同一bytes・input・overwrite=false、subfolder付き名を返す。範囲: 模擬upload。
    def test_upload_returns_actual_name_and_preserves_bytes(self):
        client = self.client(lambda request: {"name": "reference (1).png", "subfolder": "nyamuru/job", "type": "input"})
        name = client.upload_image(PNG, "reference.png")
        self.assertEqual(name, "nyamuru/job/reference (1).png")
        request = client._opener.calls[0]
        self.assertEqual(urlsplit(request.full_url).path, "/upload/image")
        self.assertIn(PNG, request.data)
        self.assertIn(b'name="type"\r\n\r\ninput', request.data)
        self.assertIn(b'name="overwrite"\r\n\r\nfalse', request.data)
        self.assertIn("multipart/form-data; boundary=", request.get_header("Content-type"))

    # 見込み: ファイル名・応答subfolderを検証すればパス横断を受け入れない。
    # 合格: 入力横断は送信ゼロ、返却横断も例外。範囲: 模擬upload。
    def test_upload_rejects_unsafe_names_and_returned_paths(self):
        client = self.client(lambda request: {"name": "safe.png", "subfolder": "../escape", "type": "input"})
        for name in ["../a.png", "a/b.png", 'a".png', "a\r\n.png"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                client.upload_image(PNG, name)
        self.assertEqual(client._opener.calls, [])
        with self.assertRaises(client_module.ComfyError):
            client.upload_image(PNG, "safe.png")

    # 見込み: 相関UUIDを送信前に固定すると返答IDが変わっても追跡できる。
    # 合格: exact graphを一度送信、3か所のUUID一致、返却IDを採用。範囲: 模擬受付。
    def test_submission_keeps_graph_and_correlation(self):
        graph = {"save:任意/3": {"class_type": "SaveImage", "inputs": {"images": ["source", 0]}}}
        before = copy.deepcopy(graph)
        client = self.client(lambda request: {"prompt_id": OTHER})
        self.assertEqual(client.submit(graph, TOKEN), OTHER)
        sent = json.loads(client._opener.calls[0].data)
        self.assertEqual(sent, {"prompt": graph, "prompt_id": TOKEN, "client_id": TOKEN,
                                "extra_data": {"nyamuru_submission_id": TOKEN}})
        self.assertEqual(graph, before)
        self.assertEqual(len(client._opener.calls), 1)

    # 見込み: 受付後に応答が失われても、再送せずキューから実IDを回収できる。
    # 合格: POSTは1回のみ、メタデータの一致するIDを返す。他ジョブ不変。範囲: 故障を模擬。
    def test_lost_submission_response_is_reconciled_without_resend(self):
        jobs = [item("unrelated", OTHER)]
        original = copy.deepcopy(jobs)

        def respond(request):
            path = urlsplit(request.full_url).path
            if request.method == "POST":
                jobs.append(item("server-assigned"))
                return URLError("response lost after acceptance")
            return {"queue_running": [], "queue_pending": jobs} if path == "/queue" else {}

        client = self.client(respond)
        with self.assertRaises(client_module.ComfySubmissionUnknown) as raised:
            client.submit({"arbitrary-id": {"inputs": {}, "class_type": "Test"}}, TOKEN)
        self.assertEqual(raised.exception.correlation_id, TOKEN)
        self.assertEqual(client.find_prompt(TOKEN), "server-assigned")
        self.assertEqual(sum(r.method == "POST" for r in client._opener.calls), 1)
        self.assertEqual(jobs[0], original[0])

    # 見込み: bridge再開後も履歴に残る相関値で照合できる。
    # 合格: キューから履歴への移行でも実IDを返す。範囲: 新規clientと模擬履歴。
    def test_restart_finds_completed_history_by_correlation(self):
        client = self.client(lambda request: IDLE if urlsplit(request.full_url).path == "/queue"
                             else {OTHER: {"prompt": item(OTHER)}})
        self.assertEqual(client.find_prompt(TOKEN), OTHER)
        self.assertTrue(all(r.method == "GET" for r in client._opener.calls))

    # 見込み: 重複照合を勝手に一つ選ばず、履歴消去を失敗と決めつけない。
    # 合格: 複数IDは例外、見つからない場合None。範囲: 模擬queue/history。
    def test_ambiguous_and_missing_correlation(self):
        client = self.client(lambda request: {"queue_running": [], "queue_pending": [item("a"), item("b")]}
                             if urlsplit(request.full_url).path == "/queue" else {})
        with self.assertRaises(client_module.ComfyError):
            client.find_prompt(TOKEN)
        client._opener.responder = lambda request: IDLE if urlsplit(request.full_url).path == "/queue" else {}
        self.assertIsNone(client.find_prompt(TOKEN))

    # 見込み: 明示的な検証拒否と、サーバーが受け付け得た障害を区別する。
    # 合格: 400はRejected、500/不正応答はUnknown、各POST1回。範囲: 模擬HTTP。
    def test_rejection_and_uncertain_acceptance_are_distinct(self):
        for reply, expected in [(error(400, {"error": {"type": "invalid_prompt"}}), client_module.ComfyRejected),
                                (error(500), client_module.ComfySubmissionUnknown),
                                (b"not json", client_module.ComfySubmissionUnknown),
                                ({}, client_module.ComfySubmissionUnknown)]:
            with self.subTest(expected=expected):
                client = self.client(lambda request, value=reply: value)
                with self.assertRaises(expected):
                    client.submit({"x": {}}, TOKEN)
                self.assertEqual(len(client._opener.calls), 1)

    # 見込み: 有効でないローカル入力は受付不明にならず送信前に止まる。
    # 合格: UUID/NaN不正でValueError、通信なし。範囲: 入力検証。
    def test_invalid_submission_stays_local(self):
        client = self.client(lambda request: {})
        for graph, token in [({"x": {}}, "not-a-uuid"), ({"x": float("nan")}, TOKEN), ({}, TOKEN)]:
            with self.subTest(token=token), self.assertRaises(ValueError):
                client.submit(graph, token)
        self.assertEqual(client._opener.calls, [])

    # 見込み: キュー所属と明示的完了を分ければ受付だけで成功にしない。
    # 合格: queued/running/succeeded/failed/unknownが各証拠に対応。範囲: 模擬状態。
    def test_prompt_states_require_actual_state_evidence(self):
        cases = [({"queue_running": [], "queue_pending": [item(TOKEN)]}, {}, "queued"),
                 ({"queue_running": [item(TOKEN)], "queue_pending": []}, {}, "running"),
                 (IDLE, {"status": {"status_str": "success", "completed": True}}, "succeeded"),
                 (IDLE, {"status": {"status_str": "error", "completed": False}}, "failed"),
                 (IDLE, {"status": {"status_str": "success", "completed": False}, "outputs": {"x": {}}}, "unknown"),
                 (IDLE, None, "unknown")]
        for queue, record, expected in cases:
            with self.subTest(expected=expected):
                client = self.client(lambda request, q=queue, r=record: q if urlsplit(request.full_url).path == "/queue"
                                     else ({TOKEN: r} if r else {}))
                self.assertEqual(client.prompt_state(TOKEN)["state"], expected)

    # 見込み: 中断・実行エラーは明示失敗、観測障害はunknownとして区別する。
    # 合格: エラー本文を保持し、切断はunknown。範囲: 模擬履歴と切断。
    def test_execution_error_and_observation_failure(self):
        history = {TOKEN: {"status": {"messages": [["execution_error", {"exception_message": "node failed"}]]}}}
        client = self.client(lambda request: IDLE if urlsplit(request.full_url).path == "/queue" else history)
        self.assertEqual(client.prompt_state(TOKEN)["error"], "node failed")
        client._opener.responder = lambda request: URLError("offline")
        self.assertEqual(client.prompt_state(TOKEN)["state"], "unknown")

    # 見込み: 正常に観測した不在だけを区別すれば、取消しの誤終端化を防げる。
    # 合格: 正常不在だけmissing=true、通信・不正・別ID・未完了履歴では付けず再試行0回。範囲: 実client、HTTPは模擬。
    def test_missing_prompt_requires_successful_queue_and_history_observations(self):
        cases = [(IDLE, {}, True, 1),
                 (URLError('queue offline'), {}, False, 0),
                 (IDLE, URLError('history offline'), False, 1),
                 ({'queue_running': None, 'queue_pending': []}, {}, False, 0),
                 (IDLE, {TOKEN: None}, False, 1),
                 (IDLE, {OTHER: {}}, False, 1),
                 (IDLE, {TOKEN: {}}, False, 1),
                 (IDLE, {TOKEN: {'status': {'status_str': 'success', 'completed': False}}}, False, 1)]
        for queue, history, missing, history_reads in cases:
            with self.subTest(queue=queue, history=history):
                client = self.client(lambda request, q=queue, h=history: q if urlsplit(request.full_url).path == '/queue' else h)
                result = client.prompt_state(TOKEN)
                self.assertEqual(result['state'], 'unknown')
                self.assertEqual(result.get('missing', False), missing)
                if not missing:
                    self.assertNotIn('missing', result)
                paths = [urlsplit(request.full_url).path for request in client._opener.calls]
                self.assertEqual(paths.count('/queue'), 1)
                self.assertEqual(paths.count('/history/' + TOKEN), history_reads)

    # 見込み: 登録node/indexをそのまま使えば別枝や先頭プレビューを採用しない。
    # 合格: 任意node IDのindex1だけをGETし、exact PNG bytesを返す。範囲: 模擬view。
    def test_exact_output_node_and_index(self):
        client = self.client(lambda request: PNG)
        history = {"outputs": {"preview": {"images": [{"filename": "wrong.png", "type": "temp"}]},
                               "finish:任意/42": {"images": [{"filename": "first.png", "type": "output"},
                                                             {"filename": "chosen.png", "subfolder": "job 1/成果", "type": "output"}]}}}
        self.assertEqual(client.get_image(history, {"node": "finish:任意/42", "index": 1}), PNG)
        query = parse_qs(urlsplit(client._opener.calls[0].full_url).query)
        self.assertEqual(query, {"filename": ["chosen.png"], "subfolder": ["job 1/成果"], "type": ["output"]})

    # 見込み: 実出力のidentityを削除拡張へ渡せば、成功を誤認せず対象を限定できる。
    # 合格: exact body/pathをPOSTし、削除集合の不一致は失敗。範囲: 実client・HTTP固定応答、実体は拡張側の試験。
    def test_unused_output_deletion_requires_matching_receipt(self):
        outputs = [{'prompt_id': TOKEN, 'node': 'out', 'index': 0,
                    'image': {'filename': 'unused.png', 'subfolder': 'job', 'type': 'output'}}]
        client = self.client(lambda request: json.dumps({'deleted': outputs}).encode())
        client.delete_outputs(outputs)
        request = client._opener.calls[0]
        self.assertEqual(urlsplit(request.full_url).path, '/nyamuru/outputs/delete')
        self.assertEqual(request.method, 'POST')
        self.assertEqual(json.loads(request.data), {'outputs': outputs})
        other = self.client(lambda request: json.dumps({'deleted': []}).encode())
        with self.assertRaises(client_module.ComfyError):
            other.delete_outputs(outputs)

    # 見込み: 出力位置の確定不備を通信障害と分け、画像解析は回収側へ任せる。
    # 合格: node・位置欠落やJPEG名はComfyOutputError。PNG名のbytesはそのまま返す。範囲: 実client、viewは模擬。
    def test_output_locator_is_checked_but_image_bytes_are_not_reparsed(self):
        client = self.client(lambda request: b"\xff\xd8jpeg")
        history = {"outputs": {"x": {"images": [{"filename": "image.png", "type": "output"}]}}}
        for binding in [{"node": "missing", "index": 0}, {"node": "x", "index": 2}]:
            with self.assertRaises(client_module.ComfyOutputError):
                client.get_image(history, binding)
        self.assertEqual(client._opener.calls, [])
        self.assertEqual(client.get_image(history, {"node": "x", "index": 0}), b"\xff\xd8jpeg")
        history["outputs"]["x"]["images"][0]["filename"] = "image.jpg"
        with self.assertRaises(client_module.ComfyOutputError):
            client.get_image(history, {"node": "x", "index": 0})

    # 見込み: 原子的な単一ID取消routeだけなら他人の実行を中断する要求を送らない。
    # 合格: 対象だけ削除、他ジョブ不変、interrupt/clear要求ゼロ。範囲: server挙動は模擬。
    def test_cancel_targets_only_one_job(self):
        jobs = {TOKEN: {"state": "running"}, OTHER: {"state": "queued"}}
        unrelated = copy.deepcopy(jobs[OTHER])

        def respond(request):
            self.assertEqual(urlsplit(request.full_url).path, f"/api/jobs/{TOKEN}/cancel")
            self.assertEqual(json.loads(request.data), {})
            return {"cancelled": jobs.pop(TOKEN, None) is not None}

        client = self.client(respond)
        self.assertTrue(client.cancel(TOKEN)["cancelled"])
        self.assertEqual(jobs, {OTHER: unrelated})
        self.assertFalse(client.cancel(TOKEN)["cancelled"])

    # 見込み: 古いserverで危険な汎用interruptへfallbackしない。
    # 合格: 404/405/501の各1回で非対応を返し、他APIを呼ばない。範囲: 模擬HTTP。
    def test_unsupported_cancel_does_not_fallback(self):
        for status in [404, 405, 501]:
            client = self.client(lambda request, s=status: error(s))
            result = client.cancel(TOKEN)
            self.assertFalse(result["supported"])
            self.assertFalse(result["cancelled"])
            self.assertEqual(len(client._opener.calls), 1)

    # 見込み: 能力確認だけで解放や実行は起こらない。
    # 合格: protocol1だけTrue、未導入False、GETのみ。範囲: 模擬capabilities。
    def test_release_capability_is_readonly_and_protocol_checked(self):
        for response, expected in [({"protocol": 1}, True), ({"protocol": True}, False),
                                   ({"protocol": 2}, False), (error(404), False)]:
            client = self.client(lambda request, r=response: r)
            self.assertIs(client.memory_release_available(), expected)
            self.assertEqual(client._opener.calls[0].method, "GET")

    # 見込み: 同じtokenを継続照会すればpendingを成功とせず、完了を待てる。
    # 合格: False→True、token同一、idle/loaded=0が必要。範囲: 模擬observer。
    def test_release_polls_same_token_and_requires_confirmation(self):
        tokens = []

        def respond(request):
            if request.method == "GET":
                return IDLE
            token = json.loads(request.data)["token"]
            tokens.append(token)
            return {"protocol": 1, "token": token, "state": "pending" if len(tokens) == 1 else "released",
                    "queue_idle": True, "loaded_model_count": 0}

        client = self.client(respond)
        self.assertFalse(client.release_models())
        self.assertTrue(client.release_models())
        self.assertEqual(len(set(tokens)), 1)
        self.assertEqual(client.last_release_status, "released")

    # 見込み: 他ジョブがいる時に解放要求を送らず、解放後の新規ジョブも検出する。
    # 合格: busyならPOSTゼロ、確認後busyならFalse。範囲: 模擬queue競合。
    def test_release_never_succeeds_while_other_jobs_are_observed(self):
        busy = {"queue_running": [item(OTHER, OTHER)], "queue_pending": []}
        client = self.client(lambda request: busy)
        self.assertFalse(client.release_models())
        self.assertTrue(all(r.method == "GET" for r in client._opener.calls))
        queues = iter([IDLE, busy])

        def respond(request):
            if request.method == "GET":
                return next(queues)
            return {"protocol": 1, "token": json.loads(request.data)["token"], "state": "released",
                    "queue_idle": True, "loaded_model_count": 0}

        client = self.client(respond)
        self.assertFalse(client.release_models())
        self.assertEqual(client.last_release_status, "busy_after_confirmation")

    # 見込み: 不一致tokenやモデル残存は解放完了の根拠にできない。
    # 合格: 各不正応答でFalse、未導入だけ案内可能な例外。範囲: 模擬observer。
    def test_release_rejects_unproven_results_and_reports_missing_extension(self):
        for changes in [{"token": OTHER}, {"protocol": 2}, {"queue_idle": False}, {"loaded_model_count": 1}, {"loaded_model_count": False}]:
            def respond(request, patch=changes):
                if request.method == "GET":
                    return IDLE
                return dict({"protocol": 1, "token": json.loads(request.data)["token"], "state": "released",
                             "queue_idle": True, "loaded_model_count": 0}, **patch)
            client = self.client(respond)
            self.assertFalse(client.release_models())
        client = self.client(lambda request: IDLE if request.method == "GET" else error(404))
        with self.assertRaises(client_module.ComfyMemoryReleaseUnavailable):
            client.release_models()


if __name__ == "__main__":
    unittest.main()
