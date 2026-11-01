"""Bounded loopback-only ComfyUI transport; no process or model startup.

Submission errors may be ambiguous: never retry POST /prompt automatically.
Model release requires the accompanying nyamuru_memory_release extension.
"""

from __future__ import annotations

import json
import math
import mimetypes
import secrets
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID, uuid4


MAX_JSON_BYTES = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 64 * 1024 * 1024


class ComfyError(OSError):
    """A transport, protocol or observation failure, not execution evidence."""


class ComfyOutputError(ValueError):
    """A completed prompt has no usable image at its configured output."""


class ComfyHTTPError(ComfyError):
    def __init__(self, status: int, detail: object = None):
        self.status = status
        self.detail = detail
        super().__init__(f"ComfyUI HTTP {status}: {str(detail)[:500]}")


class ComfyRejected(ComfyError):
    """ComfyUI explicitly rejected the submitted prompt with HTTP 400."""

    def __init__(self, detail: object):
        self.detail = detail
        super().__init__(f"ComfyUIが生成定義を受け付けませんでした: {str(detail)[:500]}")


class ComfySubmissionUnknown(ComfyError):
    """The request might have been accepted; reconcile, do not resend."""

    def __init__(self, correlation_id: str, reason: object = "応答を確認できません"):
        self.correlation_id = correlation_id
        super().__init__(f"ComfyUIへの送信結果は未確定です ({correlation_id}): {reason}")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ComfyError("ComfyUIの転送応答は受け付けません")


class ComfyMemoryReleaseUnavailable(ComfyError):
    """Install/enable the explicit completion observer before generation."""


def normalize_endpoint(endpoint: object) -> str:
    """Accept an HTTP origin only; pin localhost to its loopback address."""
    if not isinstance(endpoint, str) or not endpoint or len(endpoint) > 200:
        raise ValueError("ComfyUI接続先をloopback HTTP URLで指定してください")
    if any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in endpoint) or "\\" in endpoint:
        raise ValueError("ComfyUI接続先に空白や制御文字は使用できません")
    try:
        parsed = urlsplit(endpoint)
        host, port = parsed.hostname, parsed.port
        valid = (parsed.scheme == "http" and host in {"localhost", "127.0.0.1", "::1"}
                 and parsed.username is None and parsed.password is None
                 and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment
                 and "?" not in endpoint and "#" not in endpoint
                 and not parsed.netloc.endswith(":") and port != 0)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("ComfyUI接続先はlocalhostのHTTPポートまでを指定してください")
    host = "127.0.0.1" if host == "localhost" else host
    authority = f"[{host}]" if host == "::1" else host
    return f"http://{authority}" + (f":{port}" if port is not None else "")


def _identifier(value: object, label: str = "prompt_id") -> str:
    if not isinstance(value, str) or not value or len(value) > 256 \
            or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError(f"{label}が正しくありません")
    return value


def _filename(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 255 \
            or value in {".", ".."} or any(c in value for c in '/\\:"') \
            or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("ComfyUIの画像名が正しくありません")
    return value


def _subfolder(value: object) -> str:
    if not isinstance(value, str) or len(value) > 1024 or "\\" in value or ":" in value \
            or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("ComfyUIの画像subfolderが正しくありません")
    if value and any(p in {"", ".", ".."} for p in value.split("/")):
        raise ValueError("ComfyUIの画像subfolderは相対パスで指定してください")
    return value


class ComfyClient:
    """Standard-library client with observable, conservative state transitions.

    output_binding is {"node": <exact string node ID>, "index": <integer>}.
    get_image accepts the single history record returned by prompt_state.
    cancel's `cancelled` means a targeted request was dispatched, not stopped.
    release_models returns True ONLY after the completion observer confirms
    cache clearing and no loaded models at an idle point. Pending, busy or
    unobservable states retain the caller's LLM-restoration barrier.
    """

    def __init__(self, endpoint: str, timeout: float = 30):
        self.endpoint = normalize_endpoint(endpoint)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) \
                or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeoutは正の有限秒数で指定してください")
        self.timeout = timeout
        self._opener = build_opener(ProxyHandler({}), _NoRedirect())
        self._known_prompts: dict[str, str] = {}
        self._release_token = str(uuid4())
        self.last_release_status = "not_requested"
        self.last_release_error = ""

    def _request(self, path: str, *, method: str = "GET", payload=None,
                 raw: bytes | None = None, content_type: str | None = None,
                 limit: int = MAX_JSON_BYTES, accept: str = "application/json") -> bytes:
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("ComfyUI API pathが正しくありません")
        headers = {"Accept": accept}
        if payload is not None:
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(self.endpoint + path, data=raw, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                status = response.status
                if not 200 <= status < 300:
                    raise ComfyHTTPError(status)
                result = response.read(limit + 1)
            if len(result) > limit:
                raise ComfyError("ComfyUI応答のサイズが上限を超えています")
            return result
        except HTTPError as exc:
            try:
                body = exc.read(64 * 1024)
                try:
                    detail = json.loads(body)
                except (ValueError, UnicodeError):
                    detail = body.decode("utf-8", errors="replace")[:500]
            finally:
                exc.close()
            raise ComfyHTTPError(exc.code, detail) from exc
        except ComfyError:
            raise
        except (OSError, URLError, HTTPException) as exc:
            raise ComfyError(f"ComfyUIとの通信を確認できません: {exc}") from exc

    def _json(self, path: str, *, method: str = "GET", payload=None,
              raw: bytes | None = None, content_type: str | None = None) -> dict:
        data = self._request(path, method=method, payload=payload, raw=raw, content_type=content_type)
        try:
            value = json.loads(data)
        except (ValueError, UnicodeError) as exc:
            raise ComfyError("ComfyUI応答がJSONではありません") from exc
        if not isinstance(value, dict):
            raise ComfyError("ComfyUI応答がJSON objectではありません")
        return value

    def system_stats(self) -> dict:
        return self._json("/system_stats")

    def object_info(self) -> dict:
        return self._json("/object_info")

    def queue(self) -> dict:
        result = self._json("/queue")
        for key in ("queue_running", "queue_pending"):
            items = result.get(key)
            if not isinstance(items, list) or any(
                not isinstance(item, list) or len(item) < 4
                or not isinstance(item[1], str) or not item[1]
                or not isinstance(item[3], dict) for item in items
            ):
                raise ComfyError("ComfyUIのキュー状態を確認できません")
        return result

    def history(self, prompt_id: str | None = None) -> dict:
        path = "/history"
        if prompt_id is not None:
            path += "/" + quote(_identifier(prompt_id), safe="")
        result = self._json(path)
        if any(not isinstance(v, dict) for v in result.values()):
            raise ComfyError("ComfyUIの履歴形式を確認できません")
        return result

    def upload_image(self, raw: bytes, filename: str) -> str:
        if not isinstance(raw, bytes) or not raw or len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("アップロードする画像bytesが空か上限を超えています")
        filename = _filename(filename)
        boundary = "nyamuru_" + secrets.token_hex(24)
        while boundary.encode() in raw:
            boundary = "nyamuru_" + secrets.token_hex(24)
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts = []
        for name, value in (("type", "input"), ("overwrite", "false")):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\n'
                      f'Content-Type: {mime}\r\n\r\n').encode("utf-8"))
        parts.extend([raw, f"\r\n--{boundary}--\r\n".encode()])
        result = self._json("/upload/image", method="POST", raw=b"".join(parts),
                            content_type=f"multipart/form-data; boundary={boundary}")
        if result.get("type") != "input":
            raise ComfyError("ComfyUI画像アップロードの配置先を確認できません")
        try:
            name = _filename(result.get("name"))
            folder = _subfolder(result.get("subfolder", ""))
        except ValueError as exc:
            raise ComfyError(str(exc)) from exc
        return f"{folder}/{name}" if folder else name

    def submit(self, graph: dict, correlation_id: str, *, workflow=None) -> str:
        if not isinstance(graph, dict) or not graph:
            raise ValueError("空でないComfyUI API graphを指定してください")
        correlation_id = _identifier(correlation_id, "correlation_id")
        try:
            if str(UUID(correlation_id)) != correlation_id:
                raise ValueError
        except ValueError:
            raise ValueError("correlation_idは小文字・ハイフン付きUUIDで指定してください") from None
        payload = {"prompt": graph, "prompt_id": correlation_id, "client_id": correlation_id,
                   "extra_data": {"nyamuru_submission_id": correlation_id}}
        if workflow is not None:
            payload['extra_data']['extra_pnginfo'] = {'workflow': workflow}
        # Validate serialization before the request: local invalid input is not
        # an ambiguous network submission and must never reach the server.
        json.dumps(payload, ensure_ascii=False, allow_nan=False)
        try:
            result = self._json("/prompt", method="POST", payload=payload)
            prompt_id = _identifier(result.get("prompt_id"))
        except ComfyHTTPError as exc:
            if exc.status == 400:
                raise ComfyRejected(exc.detail) from exc
            raise ComfySubmissionUnknown(correlation_id, exc) from exc
        except (ComfyError, ValueError) as exc:
            raise ComfySubmissionUnknown(correlation_id, exc) from exc
        self._known_prompts[correlation_id] = prompt_id
        return prompt_id

    @staticmethod
    def _matching_prompt(item: object, correlation_id: str, known_ids: set[str]) -> str | None:
        if not isinstance(item, (list, tuple)) or len(item) < 4 or not isinstance(item[1], str):
            return None
        extra = item[3] if isinstance(item[3], dict) else {}
        if extra.get("nyamuru_submission_id") == correlation_id or item[1] in known_ids:
            return item[1]
        return None

    def find_prompt(self, correlation_id: str) -> str | None:
        correlation_id = _identifier(correlation_id, "correlation_id")
        known_ids = {correlation_id}
        if correlation_id in self._known_prompts:
            known_ids.add(self._known_prompts[correlation_id])
        matches = set()
        # Queue first, history second: a completion between reads is still found.
        queue = self.queue()
        for item in queue["queue_running"] + queue["queue_pending"]:
            match = self._matching_prompt(item, correlation_id, known_ids)
            if match:
                matches.add(match)
        for prompt_id, record in self.history().items():
            match = self._matching_prompt(record.get("prompt"), correlation_id, known_ids)
            if match:
                if match != prompt_id:
                    raise ComfyError("ComfyUI履歴のprompt_idが一致しません")
                matches.add(match)
            elif prompt_id in known_ids:
                matches.add(prompt_id)
        if len(matches) > 1:
            raise ComfyError("照合用IDに複数のComfyUI実行が見つかりました。自動選択しません")
        if matches:
            result = matches.pop()
            self._known_prompts[correlation_id] = result
            return result
        return None

    def prompt_state(self, prompt_id: str) -> dict:
        prompt_id = _identifier(prompt_id)
        try:
            queue = self.queue()
            for key, state in (("queue_running", "running"), ("queue_pending", "queued")):
                if any(item[1] == prompt_id for item in queue[key]):
                    return {"state": state}
            history = self.history(prompt_id)
            record = history.get(prompt_id)
            if record is None:
                if history:
                    raise ComfyError("ComfyUI履歴のprompt_idが一致しません")
                # Absence is observed only after BOTH successful reads. A cancel
                # receipt can then distinguish a dequeued job from lost history.
                return {"state": "unknown", "missing": True}
            status = record.get("status")
            if not isinstance(status, dict):
                return {"state": "unknown", "history": record}
            messages = status.get("messages", [])
            for event in messages if isinstance(messages, list) else []:
                if isinstance(event, list) and len(event) >= 2 and event[0] in {
                    "execution_error", "execution_interrupted"
                }:
                    detail = event[1] if isinstance(event[1], dict) else {}
                    error = detail.get("exception_message") or event[0]
                    return {"state": "failed", "history": record, "error": str(error)[:1000]}
            if status.get("status_str") == "error":
                return {"state": "failed", "history": record, "error": "ComfyUI execution error"}
            if status.get("status_str") == "success" and status.get("completed") is True:
                return {"state": "succeeded", "history": record}
            return {"state": "unknown", "history": record}
        except ComfyError as exc:
            return {"state": "unknown", "error": str(exc)}

    def get_image(self, history: dict, output_binding: dict) -> bytes:
        if not isinstance(output_binding, dict) or set(output_binding) != {"node", "index"}:
            raise ValueError("完成画像のnodeとindexを明示してください")
        node, index = output_binding["node"], output_binding["index"]
        if not isinstance(node, str) or not node or isinstance(index, bool) \
                or not isinstance(index, int) or index < 0:
            raise ValueError("完成画像のnodeとindexが正しくありません")
        try:
            images = history["outputs"][node]["images"]
            if not isinstance(images, list):
                raise TypeError
            image = images[index]
            filename = _filename(image["filename"])
            folder = _subfolder(image.get("subfolder", ""))
            kind = image["type"]
            if kind not in {"output", "temp"} or not filename.lower().endswith(".png"):
                raise ValueError
        except (KeyError, IndexError, TypeError, ValueError, AttributeError) as exc:
            raise ComfyOutputError("指定した出力ノード・画像位置にPNGの完成画像がありません") from exc
        path = "/view?" + urlencode({"filename": filename, "subfolder": folder, "type": kind})
        # Image metadata is read once by the job collector, alongside output dimensions.
        return self._request(path, limit=MAX_IMAGE_BYTES, accept="image/png")

    def cancel(self, prompt_id: str) -> dict:
        prompt_id = _identifier(prompt_id)
        try:
            # This route uses interrupt_if_running under the queue mutex. The
            # generic /interrupt endpoint is intentionally never called: older
            # versions ignore IDs and newer versions still have a check race.
            result = self._json("/api/jobs/" + quote(prompt_id, safe="") + "/cancel",
                                method="POST", payload={})
            if not isinstance(result.get("cancelled"), bool):
                raise ComfyError("対象ジョブ取消しの応答を確認できません")
            return {"prompt_id": prompt_id, "supported": True, "cancelled": result["cancelled"]}
        except ComfyHTTPError as exc:
            if exc.status in {404, 405, 501}:
                return {"prompt_id": prompt_id, "supported": False, "cancelled": False,
                        "error": "targeted_cancel_unsupported"}
            raise

    def memory_release_available(self) -> bool:
        """Read-only capability check; stock /free cannot substitute for this."""
        try:
            result = self._json("/nyamuru/memory/capabilities")
        except ComfyHTTPError as exc:
            if exc.status in {404, 405, 501}:
                return False
            raise
        return type(result.get("protocol")) is int and result["protocol"] == 1

    def release_models(self) -> bool:
        """Poll the same idempotent release token; no sleeps or global stop.

        True is an observed idle completion, not a cross-application lease:
        an unrelated client may submit later. The guardian must coordinate its
        own generation ownership and restore only the LLM it suspended.
        """
        self.last_release_status = "checking_idle"
        self.last_release_error = ""
        try:
            queue = self.queue()
            if queue["queue_running"] or queue["queue_pending"]:
                self.last_release_status = "busy"
                return False
            result = self._json("/nyamuru/memory/release", method="POST",
                                payload={"token": self._release_token})
            if type(result.get("protocol")) is not int or result["protocol"] != 1 \
                    or result.get("token") != self._release_token \
                    or result.get("state") not in {"pending", "busy", "released", "failed"}:
                raise ComfyError("ComfyUIモデル解放確認のprotocol・token・stateが一致しません")
            self.last_release_status = result["state"]
            self.last_release_error = str(result.get("error", ""))[:1000]
            if result["state"] != "released":
                return False
            if result.get("queue_idle") is not True \
                    or type(result.get("loaded_model_count")) is not int \
                    or result["loaded_model_count"] != 0:
                raise ComfyError("ComfyUIのidle・モデル解放を確認できません")
            queue = self.queue()
            if queue["queue_running"] or queue["queue_pending"]:
                self.last_release_status = "busy_after_confirmation"
                return False
            return True
        except ComfyHTTPError as exc:
            if exc.status in {404, 405, 501}:
                self.last_release_status = "extension_unavailable"
                raise ComfyMemoryReleaseUnavailable(
                    "ComfyUIにnyamuru_memory_release拡張を配置し再起動してから接続を確認してください"
                ) from exc
            self.last_release_status = "observation_unavailable"
            self.last_release_error = str(exc)
            return False
        except ComfyError as exc:
            self.last_release_status = "observation_unavailable"
            self.last_release_error = str(exc)
            return False
