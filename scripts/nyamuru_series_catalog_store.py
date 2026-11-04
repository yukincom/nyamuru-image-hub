"""Series-common catalog store: OMNY drafts, character text/images, and background model delegation."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from nyamuru_macos_picker import (
    choose_series_directory,
    choose_workspace_files,
    default_picker_directory,
)
from nyamuru_series_background_store import SeriesBackgroundStore

from series_reference_sources import (
    DEFAULT_SERIES_CATALOG_ROOT,
    SERIES_ID_PATTERN,
    DRAFT_TOKEN_PATTERN,
    CHARACTER_ASSET_ID_PATTERN,
    CHARACTER_ASSET_FILE_PATTERN,
    MAX_SERIES_OMNY_BYTES,
    MAX_CHARACTER_TEXT_BYTES,
    CHARACTER_TEXT_RETENTION_DAYS,
    CHARACTER_TEXT_HISTORY_LIMIT,
    CHARACTER_TEXT_CATALOG_START,
    CHARACTER_TEXT_CATALOG_END,
    CHARACTER_TEXT_ENTRY_START,
    CHARACTER_TEXT_ENTRY_END,
    CHARACTER_TEXT_GENERIC_HEADING,
    MAX_CHARACTER_REFERENCE_BYTES,
    MAX_WORKSPACE_TEXT_BYTES,
    EPISODE_WORKSPACE_DIRECTORIES,
    WORKSPACE_TEXT_EXTENSIONS,
    managed_character_catalog_span,
    character_text_notes,
    merge_character_catalog_markdown,
    normalized_series_name,
    _reference_candidate_score,
    _series_reference_candidate_kind,
    _read_reference_candidate,
    discover_reference_text_candidates,
    SeriesCatalogConflict,
    SeriesTextSources,
)
from series_catalog_drafts import SeriesCatalogDrafts
from series_character_text import SeriesCharacterText
from series_character_images import SeriesCharacterImages


class SeriesCatalogStore(
    SeriesTextSources,
    SeriesCatalogDrafts,
    SeriesCharacterText,
    SeriesCharacterImages,
):
    def __init__(self, root: Path):
        self.root = root.expanduser().absolute()
        self.lock = threading.Lock()
        self.background_models = SeriesBackgroundStore(self.root)

    def save_background_model(self, series_id: object, stage: object, model_data: object) -> dict[str, Any]:
        with self.lock:
            return self.background_models.save(series_id, stage, model_data)

    def load_background_model(self, series_id: object, stage_id: object, model_format: object, verify_only: object = False) -> dict[str, Any]:
        with self.lock:
            return self.background_models.load(series_id, stage_id, model_format, verify_only)

    @staticmethod
    def checked_id(value: object) -> str:
        if value in (None, ""):
            return ""
        if not isinstance(value, str) or not SERIES_ID_PATTERN.fullmatch(value):
            raise ValueError("シリーズの内部IDが正しくありません")
        return value

    @staticmethod
    def checked_name(value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("シリーズ名を入力してください")
        return value.strip()

    def metadata_for(self, series_id: str) -> dict[str, Any] | None:
        metadata_path = self.root / series_id / "catalog.json"
        try:
            value = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def _read_catalog(self, series_id: str, metadata: dict[str, Any] | None) -> tuple[str, bytes | None, bytes | None, dict[str, str] | None]:
        """Resolve the two supported names without moving or rewriting either file."""
        directory = self.root / series_id
        data = []
        for name in ("series.yaml", "series.omny.yaml"):
            try:
                data.append((directory / name).read_bytes())
            except FileNotFoundError:
                data.append(None)
        current, legacy = data
        origin = (metadata or {}).get("legacy_source")
        if origin is not None:
            if (not isinstance(origin, dict) or origin.get("file_name") != "series.omny.yaml"
                    or not isinstance(origin.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", origin["sha256"])):
                raise SeriesCatalogConflict("シリーズ台帳の旧ファイル情報を確認できません")
            if current is None or (legacy is not None and hashlib.sha256(legacy).hexdigest() != origin["sha256"]):
                raise SeriesCatalogConflict("新旧のシリーズ台帳が食い違っています。両方のファイルを保管して確認してください")
        elif legacy is not None:
            if current is not None and current != legacy:
                raise SeriesCatalogConflict("新旧のシリーズ台帳が食い違っています。両方のファイルを保管して確認してください")
            origin = {"file_name": "series.omny.yaml", "sha256": hashlib.sha256(legacy).hexdigest()}
        source = current if current is not None else legacy
        # Preserve the existing read_text/universal-newline revision contract.
        text = source.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n") if source is not None else ""
        return text, current, legacy, origin

    def find_by_name(self, series_name: str) -> tuple[str, dict[str, Any]] | None:
        target = normalized_series_name(series_name)
        if not target or not self.root.exists():
            return None
        matches: list[tuple[float, str, dict[str, Any]]] = []
        for directory in self.root.iterdir():
            if not directory.is_dir() or not SERIES_ID_PATTERN.fullmatch(directory.name):
                continue
            metadata = self.metadata_for(directory.name)
            if metadata and normalized_series_name(metadata.get("series_name")) == target:
                try:
                    modified = (directory / "catalog.json").stat().st_mtime
                except OSError:
                    modified = 0
                matches.append((modified, directory.name, metadata))
        if not matches:
            return None
        _modified, series_id, metadata = max(matches)
        return series_id, metadata

    def list_catalogs(self) -> dict[str, Any]:
        items: list[dict[str, Any]] = []
        with self.lock:
            self.recover_abandoned_drafts()
            if not self.root.exists():
                return {"series": []}
            for directory in self.root.iterdir():
                if not directory.is_dir() or not SERIES_ID_PATTERN.fullmatch(directory.name):
                    continue
                metadata = self.metadata_for(directory.name)
                if not metadata or not any((directory / name).is_file() for name in ("series.yaml", "series.omny.yaml")):
                    continue
                series_name = metadata.get("series_name")
                if not isinstance(series_name, str) or not series_name.strip():
                    continue
                reference = self.character_text_reference(metadata)
                items.append({
                    "series_id": directory.name,
                    "series_name": series_name.strip(),
                    "updated_at": str(metadata.get("updated_at") or ""),
                    "series_directory": str(reference.get("series_directory") or metadata.get("series_directory") or ""),
                    "series_text_file_name": str(reference.get("file_name") or ""),
                })
        items.sort(key=lambda item: (item["updated_at"], item["series_name"]), reverse=True)
        return {"series": items}

    def load(self, series_name_value: object, series_id_value: object) -> dict[str, Any]:
        series_id = self.checked_id(series_id_value)
        series_name = str(series_name_value).strip() if isinstance(series_name_value, str) else ""
        with self.lock:
            metadata = self.metadata_for(series_id) if series_id else None
            if metadata is None and series_name:
                match = self.find_by_name(series_name)
                if match:
                    series_id, metadata = match
            if not series_id or metadata is None:
                return {"found": False, "series_id": series_id, "series_name": series_name, "omny_yaml": ""}
            source, current, legacy, _origin = self._read_catalog(series_id, metadata)
            if current is None and legacy is None:
                return {"found": False, "series_id": series_id, "series_name": series_name, "omny_yaml": ""}
            revision = hashlib.sha256(source.encode("utf-8")).hexdigest()
            return {
                "found": True,
                "series_id": series_id,
                "series_name": str(metadata.get("series_name", series_name)),
                "omny_yaml": source,
                "revision": revision,
            }

    def choose_reference_text(
        self,
        series_id_value: object,
        default_directory_value: object,
    ) -> dict[str, Any]:
        series_id = self.checked_id(series_id_value)
        metadata = self.metadata_for(series_id) if series_id else None
        reference = self.character_text_reference(metadata or {})
        stored_directory_value = reference.get("series_directory") or (metadata or {}).get("series_directory")
        stored_directory = (
            Path(stored_directory_value).expanduser().resolve()
            if isinstance(stored_directory_value, str) and stored_directory_value.strip()
            else None
        )
        if stored_directory is not None and not stored_directory.is_dir():
            stored_directory = None
        explicit_default = (
            Path(default_directory_value).expanduser().resolve()
            if isinstance(default_directory_value, str) and default_directory_value.strip()
            else None
        )
        if explicit_default is not None and not explicit_default.is_dir():
            explicit_default = None
        series_directory = stored_directory or explicit_default
        if series_directory is None:
            series_directory = choose_series_directory(default_picker_directory(default_directory_value))
        if series_directory is None:
            return {"ok": True, "cancelled": True, "series_id": series_id}
        selected_files = choose_workspace_files(series_directory, "character-text", False)
        if selected_files is None:
            return {"ok": True, "cancelled": True, "series_id": series_id}
        path = selected_files[0]
        if not self.path_within(series_directory, path):
            raise ValueError("シリーズフォルダ内の文章を選んでください")
        if not path.is_file() or path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
            raise ValueError("Markdown（.md/.markdown）またはテキスト（.txt/.text）を選んでください")
        if path.stat().st_size > MAX_CHARACTER_TEXT_BYTES:
            raise ValueError("シリーズ資料テキストが5MBを超えています")
        return {
            "ok": True,
            "cancelled": False,
            "series_id": series_id,
            "series_directory": str(series_directory),
            "relative_path": path.resolve().relative_to(series_directory).as_posix(),
            "file_name": path.name,
            "text": path.read_text(encoding="utf-8-sig"),
        }

    def choose_directory(self, default_directory_value: object) -> dict[str, Any]:
        selected = choose_series_directory(default_picker_directory(default_directory_value))
        if selected is None:
            return {"ok": True, "cancelled": True}
        selected = selected.expanduser().resolve()
        if not selected.is_dir():
            raise ValueError("選択したシリーズフォルダが見つかりません")
        return {
            "ok": True,
            "cancelled": False,
            "series_directory": str(selected),
        }

    @staticmethod
    def checked_text(value: object, label: str, maximum_bytes: int = MAX_CHARACTER_TEXT_BYTES) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label}の形式が正しくありません")
        if len(value.encode("utf-8")) > maximum_bytes:
            raise ValueError(f"{label}が保存上限を超えています")
        return value

    def write_metadata(self, series_id: str, metadata: dict[str, Any]) -> None:
        directory = self.root / series_id
        directory.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(metadata, handle, ensure_ascii=False, indent=2)
            os.replace(temporary, directory / "catalog.json")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    @staticmethod
    def path_within(root: Path, candidate: Path) -> bool:
        try:
            candidate.resolve().relative_to(root.resolve())
            return True
        except (OSError, ValueError):
            return False

    def link_character_text(
        self,
        series_name_value: object,
        series_id_value: object,
        default_directory_value: object,
    ) -> dict[str, Any]:
        series_name = self.checked_name(series_name_value)
        series_id = self.checked_id(series_id_value)
        metadata = self.metadata_for(series_id) if series_id else None
        if not series_id or metadata is None:
            raise ValueError("先にシリーズ資料を保存してください")
        reference = self.character_text_reference(metadata)
        reference_directory_value = reference.get("series_directory")
        reference_directory = (
            Path(reference_directory_value).expanduser().resolve()
            if isinstance(reference_directory_value, str) and reference_directory_value.strip()
            else None
        )
        if reference_directory is not None and not reference_directory.is_dir():
            reference_directory = None
        default_directory = default_picker_directory(default_directory_value)
        selected_directory = reference_directory
        folder_was_reselected = False
        if selected_directory is None and reference:
            selected_directory = choose_series_directory(default_directory)
            folder_was_reselected = True
        elif selected_directory is None:
            selected_directory = default_directory
        if selected_directory is None:
            return {"ok": True, "cancelled": True, "series_id": series_id}
        selected_directory = selected_directory.expanduser().resolve()
        if not selected_directory.is_dir():
            raise ValueError("選択したシリーズフォルダが見つかりません")
        relative_value = reference.get("relative_path")
        referenced_path = (
            (selected_directory / relative_value).resolve()
            if isinstance(relative_value, str) and relative_value
            else None
        )
        referenced_file_exists = bool(
            referenced_path
            and self.path_within(selected_directory, referenced_path)
            and referenced_path.is_file()
        )
        candidates = self.character_text_candidates(selected_directory, series_id, reference) if reference and not referenced_file_exists else []
        if folder_was_reselected and referenced_file_exists and referenced_path is not None:
            path = referenced_path
        elif folder_was_reselected and len(candidates) == 1:
            path = candidates[0]
        else:
            selected_files = choose_workspace_files(selected_directory, "character-text", False)
            if selected_files is None:
                return {"ok": True, "cancelled": True, "series_id": series_id}
            path = selected_files[0]
            if not self.path_within(selected_directory, path):
                raise ValueError("シリーズフォルダ内の文章を選んでください")
        if not path.is_file() or path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
            raise ValueError("Markdown（.md/.markdown）またはテキスト（.txt/.text）を選んでください")
        if path.stat().st_size > MAX_CHARACTER_TEXT_BYTES:
            raise ValueError("人物の参照テキストが5MBを超えています")
        next_reference = {
            "schema_version": 1,
            "series_directory": str(selected_directory),
            "relative_path": path.resolve().relative_to(selected_directory).as_posix(),
            "file_name": path.name,
            "reference_id": str(reference.get("reference_id") or secrets.token_hex(16)),
            "linked_at": datetime.now(timezone.utc).isoformat(),
        }
        with self.lock:
            latest = self.metadata_for(series_id) or metadata
            latest["series_name"] = series_name
            latest["character_text_reference"] = next_reference
            self.write_metadata(series_id, latest)
        return {
            "ok": True,
            "cancelled": False,
            "linked": True,
            "series_id": series_id,
            "series_directory": str(selected_directory),
            "relative_path": next_reference["relative_path"],
            "file_name": path.name,
            "text": path.read_text(encoding="utf-8-sig"),
            "deleted_characters": self.list_deleted_characters(series_id),
        }
