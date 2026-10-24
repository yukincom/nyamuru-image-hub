"""Persist analog figure/text crop PNGs under Documents/Image-Hub per work."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import tempfile
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_IMAGE_HUB_ROOT = Path.home() / "Documents" / "Image-Hub"
ANALOG_ASSET_KINDS = {"figures", "texts"}
ANALOG_ASSET_FILE_PATTERN = re.compile(r"^(?:figure|text)-[a-f0-9]{24}\.png$")


class AnalogAssetStore:
    """人物・原字クロップを作品単位でDocumentsへ永続保存する。"""

    def __init__(self, root: Path):
        self.root = root.expanduser().absolute()
        self.lock = threading.Lock()

    @staticmethod
    def checked_component(value: object, label: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label}が正しくありません")
        normalized = unicodedata.normalize("NFKC", value).strip()
        if (
            not normalized
            or normalized in {".", ".."}
            or "/" in normalized
            or "\\" in normalized
            or any(ord(character) < 32 for character in normalized)
            or len(normalized) > 128
        ):
            raise ValueError(f"{label}が正しくありません")
        return normalized

    @classmethod
    def work_key(cls, episode_id: object, work_title: object) -> str:
        if isinstance(episode_id, str) and episode_id.strip():
            return cls.checked_component(episode_id, "エピソードID")
        title = unicodedata.normalize("NFKC", work_title if isinstance(work_title, str) else "").strip()
        title = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "_", title).strip(" ._")
        return cls.checked_component(title[:80] or "名称未設定", "作品名")

    @staticmethod
    def checked_kind(value: object) -> str:
        if value not in ANALOG_ASSET_KINDS:
            raise ValueError("原画参照の種別は figures または texts にしてください")
        return str(value)

    @staticmethod
    def checked_asset_id(value: object) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > 512:
            raise ValueError("原画参照の画像IDが正しくありません")
        return value.strip()

    @staticmethod
    def file_name(kind: str, asset_id: str) -> str:
        prefix = "figure" if kind == "figures" else "text"
        digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()[:24]
        return f"{prefix}-{digest}.png"

    @staticmethod
    def read_manifest(path: Path) -> dict[str, Any]:
        if not path.is_file():
            return {"schema_version": 1, "assets": {}}
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("Image-Hubのmanifest.jsonを読み込めません") from exc
        if not isinstance(value, dict) or not isinstance(value.get("assets"), dict):
            raise ValueError("Image-Hubのmanifest.jsonが正しくありません")
        return value

    def save(
        self,
        episode_id: object,
        work_title: object,
        kind_value: object,
        asset_id_value: object,
        image_bytes: bytes,
    ) -> dict[str, Any]:
        kind = self.checked_kind(kind_value)
        asset_id = self.checked_asset_id(asset_id_value)
        work_key = self.work_key(episode_id, work_title)
        if not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("原画参照はPNG画像で保存してください")
        file_name = self.file_name(kind, asset_id)
        work_directory = self.root / work_key
        asset_directory = work_directory / kind
        manifest_path = work_directory / "manifest.json"
        with self.lock:
            asset_directory.mkdir(parents=True, exist_ok=True)
            manifest = self.read_manifest(manifest_path)
            with tempfile.NamedTemporaryFile("wb", dir=asset_directory, delete=False) as handle:
                handle.write(image_bytes)
                image_temporary = Path(handle.name)
            os.chmod(image_temporary, 0o600)
            os.replace(image_temporary, asset_directory / file_name)

            manifest.update({
                "schema_version": 1,
                "work_key": work_key,
                "episode_id": episode_id.strip() if isinstance(episode_id, str) else "",
                "work_title": work_title.strip() if isinstance(work_title, str) else "",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            manifest["assets"][asset_id] = {
                "kind": kind,
                "file_name": file_name,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=work_directory, delete=False) as handle:
                json.dump(manifest, handle, ensure_ascii=False, indent=2)
                manifest_temporary = Path(handle.name)
            os.chmod(manifest_temporary, 0o600)
            os.replace(manifest_temporary, manifest_path)
        return {
            "ok": True,
            "work_key": work_key,
            "kind": kind,
            "file_name": file_name,
            "directory": str(work_directory),
        }

    def load(self, work_key_value: object, kind_value: object, file_name_value: object) -> dict[str, Any]:
        work_key = self.checked_component(work_key_value, "作品フォルダ名")
        kind = self.checked_kind(kind_value)
        if not isinstance(file_name_value, str) or not ANALOG_ASSET_FILE_PATTERN.fullmatch(file_name_value):
            raise ValueError("原画参照のファイル名が正しくありません")
        path = self.root / work_key / kind / file_name_value
        if not path.is_file():
            return {"found": False}
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return {"found": True, "image": f"data:image/png;base64,{encoded}"}
