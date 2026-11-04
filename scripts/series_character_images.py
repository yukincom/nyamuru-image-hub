"""Store and read character reference images in the selected series."""

from __future__ import annotations

import base64
import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any

from series_reference_sources import (
    SERIES_ID_PATTERN,
    CHARACTER_ASSET_ID_PATTERN,
    CHARACTER_ASSET_FILE_PATTERN,
    MAX_CHARACTER_REFERENCE_BYTES,
)


class SeriesCharacterImages:
    @staticmethod
    def checked_character_id(value: object) -> str:
        if not isinstance(value, str) or not SERIES_ID_PATTERN.fullmatch(value):
            raise ValueError("キャラクターの内部IDが正しくありません")
        return value

    @staticmethod
    def checked_character_asset_id(value: object) -> str:
        if not isinstance(value, str) or not CHARACTER_ASSET_ID_PATTERN.fullmatch(value):
            raise ValueError("人物資料画像のIDが正しくありません")
        return value

    def character_directory(self, series_id_value: object, character_id_value: object) -> tuple[str, str, Path]:
        series_id = self.checked_id(series_id_value)
        character_id = self.checked_character_id(character_id_value)
        if not series_id or self.metadata_for(series_id) is None:
            raise ValueError("先にシリーズ資料を保存してください")
        return series_id, character_id, self.root / series_id / "characters" / character_id

    def save_character_image(
        self,
        series_id_value: object,
        character_id_value: object,
        original_name_value: object,
        image_bytes: bytes,
    ) -> dict[str, Any]:
        series_id, character_id, directory = self.character_directory(series_id_value, character_id_value)
        original_name = str(original_name_value).strip()[:255] if isinstance(original_name_value, str) else "reference.png"
        original_name = original_name.replace("\\", "/").rsplit("/", 1)[-1].strip() or "reference.png"
        if len(image_bytes) < 24 or not image_bytes.startswith(b"\x89PNG\r\n\x1a\n") or image_bytes[12:16] != b"IHDR":
            raise ValueError("人物資料画像はPNG形式で保存してください")
        width = int.from_bytes(image_bytes[16:20], "big")
        height = int.from_bytes(image_bytes[20:24], "big")
        if width < 1 or height < 1:
            raise ValueError("設定画の寸法を確認できません")
        max_width, max_height = (351, 248) if width >= height else (248, 351)
        if width > max_width or height > max_height:
            scale = min(max_width / width, max_height / height)
            target_width = max(1, int(width * scale + 0.5))
            target_height = max(1, int(height * scale + 0.5))
            raise ValueError(
                f"設定画は {width} × {height} px です（上限 {max_width} × {max_height} px）。"
                f"推奨寸法 {target_width} × {target_height} px に縮小して選び直してください。"
            )
        if len(image_bytes) > MAX_CHARACTER_REFERENCE_BYTES:
            raise ValueError("人物資料画像は40MB以内にしてください")
        png_bytes = image_bytes

        sha256 = hashlib.sha256(png_bytes).hexdigest()
        asset_id = f"image-{sha256}"
        file_name = f"{asset_id}.png"
        target = directory / file_name
        with self.lock:
            directory.mkdir(parents=True, exist_ok=True)
            created = not target.is_file()
            try:
                existing_bytes = target.read_bytes() if not created else b""
            except OSError:
                existing_bytes = b""
            if created or existing_bytes != png_bytes:
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile("wb", dir=directory, delete=False) as handle:
                        temporary = Path(handle.name)
                        handle.write(png_bytes)
                    os.chmod(temporary, 0o600)
                    os.replace(temporary, target)
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
        return {
            "ok": True,
            "created": created,
            "series_id": series_id,
            "character_catalog_id": character_id,
            "source_image": {
                "schema_version": 1,
                "asset_id": asset_id,
                "file_name": (Path("characters") / character_id / file_name).as_posix(),
                "original_name": original_name or "reference.png",
                "media_type": "image/png",
                "byte_size": len(png_bytes),
                "width_px": width,
                "height_px": height,
                "sha256": sha256,
            },
        }

    def read_character_image(
        self,
        series_id_value: object,
        character_id_value: object,
        asset_id_value: object,
    ) -> dict[str, Any]:
        asset_id = self.checked_character_asset_id(asset_id_value)
        _series_id, _character_id, directory = self.character_directory(series_id_value, character_id_value)
        file_name = f"{asset_id}.png"
        if not CHARACTER_ASSET_FILE_PATTERN.fullmatch(file_name):
            raise ValueError("人物資料画像のファイル名が正しくありません")
        path = directory / file_name
        try:
            # Bound the read itself, not only the object after allocating it.
            with path.open("rb") as source:
                image_bytes = source.read(MAX_CHARACTER_REFERENCE_BYTES + 1)
        except FileNotFoundError:
            return {
                "found": False,
                "series_id": _series_id,
                "character_catalog_id": _character_id,
                "asset_id": asset_id,
            }
        if not image_bytes or len(image_bytes) > MAX_CHARACTER_REFERENCE_BYTES:
            raise ValueError("保存済みの人物資料画像が正しくありません")
        if len(image_bytes) < 24 or not image_bytes.startswith(b"\x89PNG\r\n\x1a\n") or image_bytes[12:16] != b"IHDR":
            raise ValueError("保存済みの人物資料画像が正しくありません")
        width = int.from_bytes(image_bytes[16:20], "big")
        height = int.from_bytes(image_bytes[20:24], "big")
        if width < 1 or height < 1 or width > 12000 or height > 12000 or width * height > 60_000_000:
            raise ValueError("保存済みの人物資料画像の寸法が正しくありません")
        if f"image-{hashlib.sha256(image_bytes).hexdigest()}" != asset_id:
            raise ValueError("保存済みの人物資料画像とIDのハッシュが一致しません")
        return {
            "found": True,
            "series_id": _series_id,
            "character_catalog_id": _character_id,
            "asset_id": asset_id,
            "image_bytes": image_bytes,
        }

    def load_character_image(
        self, series_id_value: object, character_id_value: object, asset_id_value: object,
    ) -> dict[str, Any]:
        # Only the HTTP boundary needs Base64; internal analysis keeps raw bytes.
        loaded = self.read_character_image(series_id_value, character_id_value, asset_id_value)
        if loaded["found"]:
            encoded = base64.b64encode(loaded.pop("image_bytes")).decode("ascii")
            loaded["image"] = f"data:image/png;base64,{encoded}"
        return loaded

    def delete_character_image(
        self,
        series_id_value: object,
        character_id_value: object,
        asset_id_value: object,
    ) -> dict[str, Any]:
        asset_id = self.checked_character_asset_id(asset_id_value)
        _series_id, _character_id, directory = self.character_directory(series_id_value, character_id_value)
        path = directory / f"{asset_id}.png"
        with self.lock:
            try:
                path.unlink()
                deleted = True
            except FileNotFoundError:
                deleted = False
            try:
                directory.rmdir()
            except OSError:
                pass
        return {
            "ok": True,
            "deleted": deleted,
            "series_id": _series_id,
            "character_catalog_id": _character_id,
            "asset_id": asset_id,
        }
