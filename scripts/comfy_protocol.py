"""HTTP errors, size limits, and address validation for the local ComfyUI API."""

from __future__ import annotations

from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler


MAX_JSON_BYTES = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 64 * 1024 * 1024

class ComfyError(OSError):
    """A transport, protocol or observation failure, not execution evidence."""


class ComfyServerMissing(ComfyError):
    """The loopback listener refused the connection, rather than timing out."""


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
