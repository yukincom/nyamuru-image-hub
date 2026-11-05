"""Fixed local ComfyUI workflow and manga-base image conversion."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
import time
from http.client import HTTPException
from pathlib import Path, PurePosixPath
from typing import Any
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse

from panel_draft_workflow import (
    PANEL_DRAFT_CHECKPOINT,
    PANEL_DRAFT_PROFILE,
    PANEL_DRAFT_WIDTH,
    PANEL_DRAFT_HEIGHT,
    PANEL_DRAFT_STEPS,
    PANEL_DRAFT_CFG,
    PANEL_DRAFT_SEED,
    PanelDraftWorkflow,
)
from panel_draft_images import (
    MANGA_BASE_PALETTE,
    MANGA_BASE_RGB,
    MAX_COMFY_IMAGE_BYTES,
    PanelDraftImages,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT.parent
DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188"
MAX_COMFY_JSON_BYTES = 4 * 1024 * 1024
PANEL_DRAFT_ID_PATTERN = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
)
MANGA_BASE_TRANSFORM_VERSION = "manga-base-nearest-palette-v1"
MANGA_BASE_PALETTE_VERSION = "manga-base-4color-v1"
MAX_PANEL_DRAFT_CHECKPOINT_BYTES = 20 * 1024 * 1024 * 1024

class ComfyUIUnavailable(RuntimeError):
    pass


class ComfyUIObservationUnavailable(ComfyUIUnavailable):
    """ComfyUI state could not be observed; this is not execution evidence."""


class ComfyUIDraftGenerator(PanelDraftImages, PanelDraftWorkflow):
    """固定した軽量ワークフローだけをlocalhostのComfyUIへ送る。"""

    def __init__(self, endpoint: str = DEFAULT_COMFYUI_URL, checkpoint_root: Path | None = None):
        parsed = urlparse(endpoint)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("ComfyUI接続先はlocalhost上のHTTP URLだけを指定できます")
        self.endpoint = endpoint.rstrip("/")
        self.checkpoint_root = (checkpoint_root or (TOOLS_ROOT / "ComfyUI" / "models" / "checkpoints")).expanduser().absolute()
        self._checkpoint_identity_cache: dict[str, dict[str, Any]] = {}

    def checkpoint_identity(self, checkpoint_value: object) -> dict[str, Any]:
        name = Path(checkpoint_value).name if isinstance(checkpoint_value, str) else ""
        if not name or name != checkpoint_value:
            raise ValueError("checkpoint identityの名前が正しくありません")
        cached = self._checkpoint_identity_cache.get(name)
        if cached is not None:
            return dict(cached)
        identity: dict[str, Any] = {
            "name": name,
            "verification": "unverified_name_only",
        }
        try:
            root = self.checkpoint_root
            if root.is_symlink() or not root.is_dir():
                identity["unverified_reason"] = "checkpoint_root_unavailable"
                self._checkpoint_identity_cache[name] = identity
                return dict(identity)
            resolved_root = root.resolve()
            candidate = root / name
            if candidate.is_symlink() or not candidate.is_file():
                identity["unverified_reason"] = "checkpoint_file_unavailable"
                self._checkpoint_identity_cache[name] = identity
                return dict(identity)
            resolved_candidate = candidate.resolve()
            resolved_candidate.relative_to(resolved_root)
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(candidate, flags)
            try:
                before = os.fstat(descriptor)
                if not stat.S_ISREG(before.st_mode) or before.st_size < 1 \
                        or before.st_size > MAX_PANEL_DRAFT_CHECKPOINT_BYTES:
                    raise ValueError("checkpoint fileを安全なサイズで確認できません")
                digest = hashlib.sha256()
                while True:
                    chunk = os.read(descriptor, 4 * 1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                after = os.fstat(descriptor)
                if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
                    raise ValueError("checkpoint fileが検証中に変更されました")
            finally:
                os.close(descriptor)
            identity.update({
                "verification": "sha256_verified",
                "sha256": digest.hexdigest(),
                "byte_size": before.st_size,
            })
        except (OSError, ValueError):
            identity.setdefault("unverified_reason", "checkpoint_file_not_safely_readable")
        self._checkpoint_identity_cache[name] = identity
        return dict(identity)

    @staticmethod
    def read_limited(response: Any, maximum: int, label: str) -> bytes:
        raw = response.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError(f"{label}が大きすぎます")
        return raw

    def json_request(
        self,
        target: str | urllib_request.Request,
        *,
        timeout: float,
        unavailable_message: str,
    ) -> dict[str, Any]:
        try:
            with urllib_request.urlopen(target, timeout=timeout) as response:
                raw = self.read_limited(response, MAX_COMFY_JSON_BYTES, "ComfyUIの応答")
        except HTTPError as exc:
            raise ComfyUIObservationUnavailable(f"ComfyUIがHTTP {exc.code}を返しました") from exc
        except (URLError, TimeoutError, OSError, HTTPException) as exc:
            raise ComfyUIObservationUnavailable(unavailable_message) from exc
        except ValueError as exc:
            raise ComfyUIObservationUnavailable(str(exc)) from exc
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ComfyUIObservationUnavailable("ComfyUIの応答をJSONとして読めませんでした") from exc
        if not isinstance(value, dict):
            raise ComfyUIObservationUnavailable("ComfyUIの応答形式が正しくありません")
        return value

    @staticmethod
    def output_image(history: dict[str, Any], prompt_id: str) -> dict[str, str] | None:
        record = history.get(prompt_id)
        if not isinstance(record, dict):
            return None
        status = record.get("status")
        if isinstance(status, dict) and status.get("status_str") == "error":
            raise RuntimeError("ComfyUIで作画用ラフの実行に失敗しました")
        outputs = record.get("outputs")
        if not isinstance(outputs, dict):
            raise RuntimeError("ComfyUI historyに完了recordがありますが生成画像がありません")
        for node in outputs.values():
            images = node.get("images") if isinstance(node, dict) else None
            if not isinstance(images, list):
                continue
            for image in images:
                if not isinstance(image, dict):
                    continue
                filename = image.get("filename")
                subfolder = image.get("subfolder", "")
                image_type = image.get("type", "output")
                if isinstance(filename, str) and filename and isinstance(subfolder, str) and image_type == "output":
                    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,254}", filename):
                        raise ValueError("ComfyUIの生成ファイル名が安全ではありません")
                    folder = PurePosixPath(subfolder)
                    if folder.is_absolute() or ".." in folder.parts or "\\" in subfolder:
                        raise ValueError("ComfyUIの生成サブフォルダが安全ではありません")
                    if subfolder and not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", subfolder):
                        raise ValueError("ComfyUIの生成サブフォルダが安全ではありません")
                    return {"filename": filename, "subfolder": subfolder, "type": image_type}
        raise RuntimeError("ComfyUI historyに完了recordがありますが出力PNGがありません")

    def submit(self, value: dict[str, Any], prompt_id: str) -> str:
        if not PANEL_DRAFT_ID_PATTERN.fullmatch(prompt_id):
            raise ValueError("ComfyUIへ渡すattempt IDが正しいUUIDではありません")
        request_body = json.dumps({
            "prompt": self.workflow(value),
            "client_id": f"nyamuru-{secrets.token_hex(12)}",
            "prompt_id": prompt_id,
        }, ensure_ascii=False).encode("utf-8")
        prompt_request = urllib_request.Request(
            f"{self.endpoint}/prompt",
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        prompt_response = self.json_request(
            prompt_request,
            timeout=30,
            unavailable_message="ComfyUIが起動していません。127.0.0.1:8188 で起動してください",
        )
        returned_prompt_id = prompt_response.get("prompt_id")
        if returned_prompt_id != prompt_id:
            raise ComfyUIUnavailable("ComfyUIが指定したattempt IDを確認できませんでした")
        return prompt_id

    def history_image(self, prompt_id: str) -> dict[str, str] | None:
        history = self.json_request(
            f"{self.endpoint}/history/{prompt_id}",
            timeout=15,
            unavailable_message="生成履歴をComfyUIから取得できませんでした",
        )
        return self.output_image(history, prompt_id)

    def queue_contains(self, prompt_id: str) -> bool:
        queue = self.json_request(
            f"{self.endpoint}/queue",
            timeout=15,
            unavailable_message="ComfyUIのqueueを確認できませんでした",
        )
        for key in ("queue_running", "queue_pending"):
            entries = queue.get(key)
            if not isinstance(entries, list):
                continue
            if any(isinstance(entry, list) and len(entry) > 1 and entry[1] == prompt_id for entry in entries):
                return True
        return False

    def wait_for_image(self, prompt_id: str, timeout_seconds: float = 360) -> dict[str, str]:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            image_info = self.history_image(prompt_id)
            if image_info is not None:
                return image_info
            time.sleep(0.5)
        raise ComfyUIUnavailable("ComfyUIの作画用ラフ生成が6分以内に完了しませんでした")

    def fetch_image(self, image_info: dict[str, str]) -> bytes:
        view_query = urlencode({
            "filename": image_info["filename"],
            "subfolder": image_info["subfolder"],
            "type": image_info["type"],
        })
        try:
            with urllib_request.urlopen(f"{self.endpoint}/view?{view_query}", timeout=30) as response:
                content_type = response.headers.get_content_type()
                if content_type != "image/png":
                    raise ValueError("ComfyUIの生成画像がPNGとして返されませんでした")
                image_bytes = self.read_limited(response, MAX_COMFY_IMAGE_BYTES, "ComfyUIの生成画像")
        except HTTPError as exc:
            raise RuntimeError(f"ComfyUIの生成画像取得がHTTP {exc.code}で失敗しました") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise ComfyUIUnavailable("ComfyUIの生成画像を取得できませんでした") from exc
        self.validate_png_bytes(image_bytes)
        return image_bytes

    def generate(self, body: dict[str, Any]) -> dict[str, Any]:
        value = self.normalized_request(body)
        from nyamuru_panel_draft_ledger import PanelDraftLedger
        prompt_id = PanelDraftLedger.checked_id(body.get("attempt_id"), "attempt ID")
        self.submit(value, prompt_id)
        image_info = self.wait_for_image(prompt_id)
        image_bytes = self.fetch_image(image_info)
        manga_base_bytes = self.manga_base_png(image_bytes)
        return self.result_payload(value, prompt_id, image_info, manga_base_bytes)
