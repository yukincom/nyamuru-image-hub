"""Inspect series catalogs, character images, drafts and recovery data."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import PurePosixPath
from typing import Any

from workspace_inspection_contract import (
    SERIES_ID_PATTERN,
    DRAFT_TOKEN_PATTERN,
    CHARACTER_ID_PATTERN,
    CHARACTER_IMAGE_PATTERN,
    MAX_SERIES_OMNY_BYTES,
    MAX_CATALOG_BYTES,
    MAX_CHARACTER_IMAGE_BYTES,
    MAX_RECOVERY_JSON_BYTES,
)


class WorkspaceSeriesChecks:
    def _scan_series(self, descriptor: int) -> None:
        root_metadata = os.fstat(descriptor)
        self._scan_directory("series", descriptor, (), root_metadata.st_dev)
        try:
            with os.scandir(descriptor) as iterator:
                entries = sorted(iterator, key=lambda item: item.name)
        except OSError:
            return
        for entry in entries:
            name = entry.name
            try:
                metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            except OSError:
                continue
            if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                if name not in {".DS_Store"}:
                    self._observe(
                        "unknown_series_root_entry",
                        "info",
                        "series",
                        name,
                        "series rootの非directory entryはbytesだけsnapshotしました",
                    )
                continue
            if name == ".drafts":
                self._inspect_series_drafts(descriptor, root_metadata.st_dev)
            elif SERIES_ID_PATTERN.fullmatch(name):
                self._inspect_series_catalog(descriptor, root_metadata.st_dev, name)
            else:
                self._observe(
                    "unknown_series_root_directory",
                    "not_inspected",
                    "series",
                    name,
                    "未知のseries root directoryはbytesだけsnapshotし、意味検査していません",
                    {},
                    incomplete=True,
                )

    def _inspect_series_drafts(self, series_fd: int, expected_device: int) -> None:
        draft_files = [
            path for (root, path) in self.files
            if root == "series" and path.startswith(".drafts/") and path.endswith("/manifest.json")
        ]
        self._observe(
            "series_drafts_present",
            "warning" if draft_files else "info",
            "series",
            ".drafts",
            "未完了series draftは復旧資産として保持し、変更しません",
            {"manifest_count": len(draft_files)},
        )
        for path in sorted(draft_files):
            parts = PurePosixPath(path).parts
            token_valid = len(parts) >= 3 and DRAFT_TOKEN_PATTERN.fullmatch(parts[1]) is not None
            data = self._read_snapshot_file(
                series_fd,
                "series",
                path,
                expected_device,
                MAX_RECOVERY_JSON_BYTES,
                "series_draft_manifest",
            )
            if data is None:
                continue
            try:
                value = json.loads(data.decode("utf-8"))
                valid = isinstance(value, dict) and token_valid and value.get("draft_token") == parts[1]
            except (UnicodeDecodeError, json.JSONDecodeError):
                valid = False
            self._observe(
                "series_draft_manifest",
                "ok" if valid else "warning",
                "series",
                path,
                "series draft manifestをread-onlyで確認しました",
                {"valid": valid},
            )

    def _inspect_series_catalog(self, series_fd: int, expected_device: int, series_id: str) -> None:
        catalog_path = f"{series_id}/catalog.json"
        current_path = f"{series_id}/series.yaml"
        legacy_path = f"{series_id}/series.omny.yaml"
        has_current = ("series", current_path) in self.files
        omny_path = current_path if has_current else legacy_path
        catalog_data = self._read_snapshot_file(
            series_fd,
            "series",
            catalog_path,
            expected_device,
            MAX_CATALOG_BYTES,
            "series_catalog",
        )
        omny_data = self._read_snapshot_file(
            series_fd,
            "series",
            omny_path,
            expected_device,
            MAX_SERIES_OMNY_BYTES,
            "series_omny",
        )
        if catalog_data is None:
            self._observe(
                "series_catalog_missing",
                "error",
                "series",
                catalog_path,
                "series catalog.jsonがありません、または安全に読めません",
            )
        if omny_data is None:
            self._observe(
                "series_omny_missing",
                "error",
                "series",
                omny_path,
                "series.yaml（または互換用series.omny.yaml）がありません、または安全に読めません",
            )
        metadata: dict[str, Any] | None = None
        if catalog_data is not None:
            try:
                parsed = json.loads(catalog_data.decode("utf-8"))
                metadata = parsed if isinstance(parsed, dict) else None
            except (UnicodeDecodeError, json.JSONDecodeError):
                metadata = None
            self._observe(
                "series_catalog_json",
                "ok" if metadata is not None else "error",
                "series",
                catalog_path,
                "series catalog JSONを確認しました",
                {"object": metadata is not None},
            )
        if omny_data is not None:
            try:
                omny_data.decode("utf-8")
                utf8 = True
            except UnicodeDecodeError:
                utf8 = False
            self._observe(
                "series_omny_utf8",
                "ok" if utf8 else "error",
                "series",
                omny_path,
                "series OMNYのUTF-8 encodingを確認しました",
                {"utf8": utf8},
            )
        if metadata is not None:
            legacy_data = (
                self._read_snapshot_file(series_fd, "series", legacy_path, expected_device, MAX_SERIES_OMNY_BYTES, "series_omny")
                if has_current and ("series", legacy_path) in self.files else (omny_data if not has_current else None)
            )
            origin = metadata.get("legacy_source")
            if origin is not None:
                names_ok = (
                    isinstance(origin, dict) and origin.get("file_name") == "series.omny.yaml"
                    and isinstance(origin.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", origin["sha256"]) is not None
                    and has_current and (legacy_data is None or hashlib.sha256(legacy_data).hexdigest() == origin["sha256"])
                )
            else:
                names_ok = not has_current or legacy_data is None or legacy_data == omny_data
            self._observe(
                "series_catalog_names", "ok" if names_ok else "error", "series", omny_path,
                "新旧の台帳名と移行時の原本照合情報を確認しました",
                {"compatible": names_ok, "current_present": has_current, "legacy_present": legacy_data is not None},
            )
            observed_id = metadata.get("series_id")
            revision = metadata.get("revision")
            expected_revision = (
                hashlib.sha256(omny_data.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")).hexdigest()
                if omny_data is not None and utf8 else None
            )
            fields_ok = (
                observed_id == series_id
                and isinstance(metadata.get("series_name"), str)
                and bool(metadata["series_name"].strip())
                and revision == expected_revision
            )
            self._observe(
                "series_catalog_identity",
                "ok" if fields_ok else "error",
                "series",
                catalog_path,
                "directory名・series ID・OMNY revisionを照合しました",
                {
                    "series_id_matches": observed_id == series_id,
                    "series_name_present": isinstance(metadata.get("series_name"), str)
                    and bool(str(metadata.get("series_name", "")).strip()),
                    "revision_matches": revision == expected_revision,
                },
            )
            external_fields: list[str] = []
            if isinstance(metadata.get("series_directory"), str) and metadata["series_directory"].strip():
                external_fields.append("series_directory")
            reference = metadata.get("character_text_reference")
            if isinstance(reference, dict) and isinstance(reference.get("series_directory"), str):
                external_fields.append("character_text_reference.series_directory")
            if external_fields:
                self._observe(
                    "external_reference_not_followed",
                    "info",
                    "series",
                    catalog_path,
                    "catalogの外部path文字列は記録だけ確認し、追跡していません",
                    {"fields": sorted(external_fields)},
                )
        self._inspect_character_images(series_fd, expected_device, series_id)
        self._inspect_recovery_assets(series_fd, expected_device, series_id)

    def _inspect_character_images(self, series_fd: int, expected_device: int, series_id: str) -> None:
        prefix = f"{series_id}/characters/"
        for (root, path), snapshot in sorted(self.files.items()):
            if root != "series" or not path.startswith(prefix):
                continue
            relative = path.removeprefix(prefix)
            parts = PurePosixPath(relative).parts
            if len(parts) != 2:
                self._observe(
                    "character_asset_layout_unknown",
                    "warning",
                    "series",
                    path,
                    "人物資料assetのdirectory構造が既知contractと異なります",
                )
                continue
            character_id, file_name = parts
            match = CHARACTER_IMAGE_PATTERN.fullmatch(file_name)
            if CHARACTER_ID_PATTERN.fullmatch(character_id) is None or match is None:
                self._observe(
                    "character_asset_name_invalid",
                    "warning",
                    "series",
                    path,
                    "人物資料assetのIDまたはfile名が既知contractと異なります",
                )
                continue
            expected_hash = match.group(1)
            data = self._read_snapshot_file(
                series_fd,
                "series",
                path,
                expected_device,
                MAX_CHARACTER_IMAGE_BYTES,
                "character_image",
            )
            if data is None:
                continue
            png_header = len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR"
            width = int.from_bytes(data[16:20], "big") if png_header else 0
            height = int.from_bytes(data[20:24], "big") if png_header else 0
            dimensions_ok = (
                png_header
                and 1 <= width <= 12_000
                and 1 <= height <= 12_000
                and width * height <= 60_000_000
            )
            valid = snapshot["sha256"] == expected_hash and dimensions_ok
            self._observe(
                "character_image_integrity",
                "ok" if valid else "error",
                "series",
                path,
                "人物資料PNGのfile名hash・header・寸法を確認しました",
                {
                    "hash_matches": snapshot["sha256"] == expected_hash,
                    "png_header": png_header,
                    "dimensions_ok": dimensions_ok,
                    "width_px": width,
                    "height_px": height,
                },
            )

    def _inspect_recovery_assets(self, series_fd: int, expected_device: int, series_id: str) -> None:
        for directory_name in ("deleted-characters", "character-text-history"):
            prefix = f"{series_id}/{directory_name}/"
            paths = sorted(path for root, path in self.files if root == "series" and path.startswith(prefix))
            if not paths:
                continue
            observation = self._observe(
                "recovery_assets_present",
                "info",
                "series",
                f"{series_id}/{directory_name}",
                "復旧資産を列挙しました。期限に関係なく変更しません",
                {"file_count": len(paths), "asset_kind": directory_name},
            )
            self._infer(
                "recovery_assets_require_retention_review",
                "info",
                "series",
                f"{series_id}/{directory_name}",
                "復旧資産の保持・削除判断は人間の確認が必要です",
                [observation],
            )
            if directory_name != "deleted-characters":
                continue
            for path in paths:
                if not path.endswith(".json"):
                    continue
                data = self._read_snapshot_file(
                    series_fd,
                    "series",
                    path,
                    expected_device,
                    MAX_RECOVERY_JSON_BYTES,
                    "deleted_character_record",
                )
                if data is None:
                    continue
                try:
                    value = json.loads(data.decode("utf-8"))
                    valid = isinstance(value, dict) and value.get("series_id") == series_id
                except (UnicodeDecodeError, json.JSONDecodeError):
                    valid = False
                self._observe(
                    "deleted_character_record",
                    "ok" if valid else "warning",
                    "series",
                    path,
                    "削除人物の復旧recordをread-onlyで確認しました",
                    {"valid": valid},
                )
