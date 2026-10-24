"""Fixed local ComfyUI workflow and manga-base image conversion."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import secrets
import stat
import time
import unicodedata
import zlib
from http.client import HTTPException
from pathlib import Path, PurePosixPath
from typing import Any
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT.parent
DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188"
PANEL_DRAFT_CHECKPOINT = "animagine-xl-3.1.safetensors"
PANEL_DRAFT_PROFILE = "manga-base"
PANEL_DRAFT_WIDTH = 512
PANEL_DRAFT_HEIGHT = 512
PANEL_DRAFT_STEPS = 20
PANEL_DRAFT_CFG = 6.0
PANEL_DRAFT_SEED = 2026082901
MANGA_BASE_PALETTE = {
    "ink": "#000000",
    "dense_tone": "#E60012",
    "light_tone": "#00D7E8",
    "paper": "#FFFFFF",
}
MANGA_BASE_RGB = (
    (0, 0, 0),
    (230, 0, 18),
    (0, 215, 232),
    (255, 255, 255),
)
MAX_COMFY_JSON_BYTES = 4 * 1024 * 1024
MAX_COMFY_IMAGE_BYTES = 20 * 1024 * 1024
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


class ComfyUIDraftGenerator:
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
    def checked_text(value: object, label: str, maximum: int, *, required: bool = False) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label}の形式が正しくありません")
        text = unicodedata.normalize("NFKC", value).strip()
        if required and not text:
            raise ValueError(f"{label}が空です")
        if len(text) > maximum:
            raise ValueError(f"{label}が長すぎます")
        return text

    @staticmethod
    def checked_integer(value: object, label: str, minimum: int, maximum: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
            raise ValueError(f"{label}の値が正しくありません")
        return value

    @classmethod
    def normalized_request(cls, body: dict[str, Any]) -> dict[str, Any]:
        page_number = cls.checked_integer(body.get("page_number"), "ページ番号", 1, 100000)
        panel_id = cls.checked_integer(body.get("panel_id"), "コマ番号", 1, 1000000)
        profile = cls.checked_text(body.get("profile"), "生成プロファイル", 100, required=True)
        if profile != PANEL_DRAFT_PROFILE:
            raise ValueError("作画用ラフではmanga-baseプロファイルだけを使用できます")
        checkpoint = cls.checked_text(body.get("checkpoint"), "チェックポイント", 200, required=True)
        if checkpoint != PANEL_DRAFT_CHECKPOINT:
            raise ValueError("作画用ラフでは固定のAnimagineチェックポイントだけを使用できます")

        fixed_integers = {
            "width": PANEL_DRAFT_WIDTH,
            "height": PANEL_DRAFT_HEIGHT,
            "steps": PANEL_DRAFT_STEPS,
        }
        for key, expected in fixed_integers.items():
            if body.get(key) != expected:
                raise ValueError("作画用ラフの解像度とステップ数は固定です")
        cfg = body.get("cfg")
        if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or float(cfg) != PANEL_DRAFT_CFG:
            raise ValueError("作画用ラフのCFGは固定です")
        if body.get("seed") != PANEL_DRAFT_SEED:
            raise ValueError("作画用ラフのシードは固定です")

        return {
            "page_number": page_number,
            "panel_id": panel_id,
            "profile": profile,
            "positive_prompt": cls.checked_text(body.get("positive_prompt"), "ポジティブプロンプト", 12000, required=True),
            "negative_prompt": cls.checked_text(body.get("negative_prompt"), "ネガティブプロンプト", 8000, required=True),
            "checkpoint": checkpoint,
            "width": PANEL_DRAFT_WIDTH,
            "height": PANEL_DRAFT_HEIGHT,
            "steps": PANEL_DRAFT_STEPS,
            "cfg": PANEL_DRAFT_CFG,
            "seed": PANEL_DRAFT_SEED,
        }

    @staticmethod
    def workflow(value: dict[str, Any]) -> dict[str, Any]:
        prefix = f"manga_base_drafts/page_{value['page_number']:04d}_panel_{value['panel_id']:04d}"
        return {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": value["checkpoint"]},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["1", 1], "text": value["positive_prompt"]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["1", 1], "text": value["negative_prompt"]},
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": value["width"], "height": value["height"], "batch_size": 1},
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                    "seed": value["seed"],
                    "control_after_generate": "fixed",
                    "steps": value["steps"],
                    "cfg": value["cfg"],
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            "7": {
                "class_type": "SaveImage",
                "inputs": {"filename_prefix": prefix, "images": ["6", 0]},
            },
        }

    @staticmethod
    def nearest_manga_base_color(red: int, green: int, blue: int, alpha: int = 255) -> tuple[int, int, int, int]:
        if alpha < 128:
            return 255, 255, 255, 255
        chroma = max(red, green, blue) - min(red, green, blue)
        if chroma <= 32:
            luminance = round(0.2126 * red + 0.7152 * green + 0.0722 * blue)
            if luminance < 72:
                return 0, 0, 0, 255
            if luminance < 170:
                return 230, 0, 18, 255
            if luminance < 225:
                return 0, 215, 232, 255
            return 255, 255, 255, 255
        # 輝度への寄与が大きい緑を重くし、生成時の色ぶれを4値へ戻す。
        color = min(
            MANGA_BASE_RGB,
            key=lambda candidate: (
                2 * (red - candidate[0]) ** 2
                + 4 * (green - candidate[1]) ** 2
                + 3 * (blue - candidate[2]) ** 2
            ),
        )
        return color[0], color[1], color[2], 255

    @staticmethod
    def paper_pixels_outside_ink(pixels: list[tuple[int, int, int, int]], width: int, height: int) -> set[int]:
        """黒い線の横または縦スパンに含まれない明るい無彩色を紙に戻す。"""

        row_bounds: list[list[int] | None] = [None] * height
        column_bounds: list[list[int] | None] = [None] * width
        for index, (red, green, blue, alpha) in enumerate(pixels):
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if alpha < 128 or luminance >= 72:
                continue
            x = index % width
            y = index // width
            if row_bounds[y] is None:
                row_bounds[y] = [x, x]
            else:
                row_bounds[y][0] = min(row_bounds[y][0], x)
                row_bounds[y][1] = max(row_bounds[y][1], x)
            if column_bounds[x] is None:
                column_bounds[x] = [y, y]
            else:
                column_bounds[x][0] = min(column_bounds[x][0], y)
                column_bounds[x][1] = max(column_bounds[x][1], y)

        paper: set[int] = set()
        for index, (red, green, blue, alpha) in enumerate(pixels):
            if alpha < 128:
                paper.add(index)
                continue
            chroma = max(red, green, blue) - min(red, green, blue)
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if chroma > 32 or luminance < 170:
                continue
            x = index % width
            y = index // width
            row = row_bounds[y]
            column = column_bounds[x]
            inside_row_ink = row is not None and row[0] <= x <= row[1]
            inside_column_ink = column is not None and column[0] <= y <= column[1]
            if not inside_row_ink and not inside_column_ink:
                paper.add(index)
        return paper

    @classmethod
    def manga_base_png(cls, image_bytes: bytes) -> bytes:
        try:
            from PIL import Image, UnidentifiedImageError
        except ImportError as exc:
            raise RuntimeError("作画用4値画像の変換にはローカルbridgeのPillowが必要です") from exc
        cls.validate_png_bytes(image_bytes)
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                source.load()
                if source.size != (PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT):
                    raise ValueError("ComfyUIの生成画像サイズが固定設定と一致しません")
                image = source.convert("RGBA")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("ComfyUIの生成画像を4値画像として読み取れません") from exc

        pixels = list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())
        paper = cls.paper_pixels_outside_ink(pixels, *image.size)
        image.putdata([
            (255, 255, 255, 255) if index in paper else cls.nearest_manga_base_color(red, green, blue, alpha)
            for index, (red, green, blue, alpha) in enumerate(pixels)
        ])
        output = io.BytesIO()
        image.convert("RGB").save(output, format="PNG", optimize=True)
        result = output.getvalue()
        if not result or len(result) > MAX_COMFY_IMAGE_BYTES:
            raise ValueError("作画用4値画像が大きすぎます")
        cls.validate_png_bytes(result, require_manga_base=True)
        return result

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

    @staticmethod
    def _validate_png_container(image_bytes: bytes) -> None:
        if len(image_bytes) < 33 or not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("ComfyUIの生成画像が正しいPNGではありません")
        offset = 8
        saw_ihdr = False
        saw_idat = False
        saw_iend = False
        while offset < len(image_bytes):
            if offset + 12 > len(image_bytes):
                raise ValueError("ComfyUIのPNG chunkが途中で切れています")
            chunk_size = int.from_bytes(image_bytes[offset:offset + 4], "big")
            chunk_type = image_bytes[offset + 4:offset + 8]
            chunk_end = offset + 12 + chunk_size
            if chunk_end > len(image_bytes):
                raise ValueError("ComfyUIのPNG chunkが途中で切れています")
            chunk_data = image_bytes[offset + 8:offset + 8 + chunk_size]
            stored_crc = int.from_bytes(image_bytes[offset + 8 + chunk_size:chunk_end], "big")
            actual_crc = zlib.crc32(chunk_type)
            actual_crc = zlib.crc32(chunk_data, actual_crc) & 0xFFFFFFFF
            if stored_crc != actual_crc:
                raise ValueError("ComfyUIのPNG chunk CRCが一致しません")
            if not saw_ihdr:
                if chunk_type != b"IHDR" or chunk_size != 13:
                    raise ValueError("ComfyUIのPNG IHDRが正しくありません")
                width = int.from_bytes(chunk_data[0:4], "big")
                height = int.from_bytes(chunk_data[4:8], "big")
                if (width, height) != (PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT):
                    # Pillowが展開する前にIHDR寸法を固定し、圧縮bombをfail-closedにする。
                    raise ValueError("ComfyUIの生成画像サイズが固定設定と一致しません")
                saw_ihdr = True
            elif chunk_type == b"IHDR":
                raise ValueError("ComfyUIのPNGにIHDRが重複しています")
            if chunk_type == b"IDAT":
                saw_idat = True
            if chunk_type == b"IEND":
                if chunk_size != 0 or not saw_idat or chunk_end != len(image_bytes):
                    raise ValueError("ComfyUIのPNG IENDまたは末尾が正しくありません")
                saw_iend = True
                offset = chunk_end
                break
            offset = chunk_end
        if not saw_ihdr or not saw_idat or not saw_iend or offset != len(image_bytes):
            raise ValueError("ComfyUIのPNGが完全ではありません")

    @classmethod
    def validate_png_bytes(cls, image_bytes: bytes, *, require_manga_base: bool = False) -> None:
        if not isinstance(image_bytes, bytes) or len(image_bytes) > MAX_COMFY_IMAGE_BYTES:
            raise ValueError("ComfyUIの生成画像が空か大きすぎます")
        cls._validate_png_container(image_bytes)
        try:
            from PIL import Image, UnidentifiedImageError
        except ImportError as exc:
            raise RuntimeError("PNGの完全検証にはローカルbridgeのPillowが必要です") from exc
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                if source.format != "PNG" or getattr(source, "n_frames", 1) != 1:
                    raise ValueError("ComfyUIの生成画像が単一PNGではありません")
                source.verify()
            with Image.open(io.BytesIO(image_bytes)) as source:
                source.load()
                if source.size != (PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT):
                    raise ValueError("ComfyUIの生成画像サイズが固定設定と一致しません")
                if require_manga_base:
                    rgba = source.convert("RGBA")
                    colors = rgba.getcolors(maxcolors=PANEL_DRAFT_WIDTH * PANEL_DRAFT_HEIGHT)
                    allowed = {(red, green, blue, 255) for red, green, blue in MANGA_BASE_RGB}
                    if colors is None or any(color not in allowed for _, color in colors):
                        raise ValueError("作画用4値artifactにパレット外のpixelがあります")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("ComfyUIの生成画像を完全なPNGとして読み取れません") from exc

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

    @staticmethod
    def result_payload(
        value: dict[str, Any],
        prompt_id: str,
        image_info: dict[str, str],
        manga_base_bytes: bytes,
    ) -> dict[str, Any]:
        download_name = (
            f"manga-base_page_{value['page_number']:04d}_panel_{value['panel_id']:04d}"
            f"_seed_{value['seed']}.png"
        )
        return {
            "image": f"data:image/png;base64,{base64.b64encode(manga_base_bytes).decode('ascii')}",
            "prompt_id": prompt_id,
            "file_name": image_info["filename"],
            "download_name": download_name,
            "subfolder": image_info["subfolder"],
            "profile": value["profile"],
            "palette": MANGA_BASE_PALETTE,
            "checkpoint": value["checkpoint"],
            "seed": value["seed"],
        }

    def generate(self, body: dict[str, Any]) -> dict[str, Any]:
        value = self.normalized_request(body)
        from nyamuru_panel_draft_ledger import PanelDraftLedger
        prompt_id = PanelDraftLedger.checked_id(body.get("attempt_id"), "attempt ID")
        self.submit(value, prompt_id)
        image_info = self.wait_for_image(prompt_id)
        image_bytes = self.fetch_image(image_info)
        manga_base_bytes = self.manga_base_png(image_bytes)
        return self.result_payload(value, prompt_id, image_info, manga_base_bytes)
