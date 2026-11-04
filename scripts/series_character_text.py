"""Synchronize and recover character text sources within the open series."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from series_reference_sources import (
    MAX_SERIES_OMNY_BYTES,
    MAX_CHARACTER_TEXT_BYTES,
    CHARACTER_TEXT_RETENTION_DAYS,
    CHARACTER_TEXT_HISTORY_LIMIT,
    WORKSPACE_TEXT_EXTENSIONS,
    merge_character_catalog_markdown,
)


class SeriesCharacterText:
    def resolve_character_text(
        self,
        series_id: str,
        metadata: dict[str, Any],
    ) -> tuple[Path | None, Path | None, dict[str, Any]]:
        reference = self.character_text_reference(metadata)
        directory_value = reference.get("series_directory")
        if not isinstance(directory_value, str) or not directory_value.strip():
            return None, None, reference
        series_directory = Path(directory_value).expanduser()
        if not series_directory.is_dir():
            return None, None, reference
        relative_value = reference.get("relative_path")
        if isinstance(relative_value, str) and relative_value:
            path = (series_directory / relative_value).resolve()
            if self.path_within(series_directory, path) and path.is_file() and path.suffix.lower() in WORKSPACE_TEXT_EXTENSIONS:
                return series_directory.resolve(), path, reference
        candidates = self.character_text_candidates(series_directory.resolve(), series_id, reference)
        if len(candidates) == 1:
            path = candidates[0]
            reference = {
                **reference,
                "series_directory": str(series_directory.resolve()),
                "relative_path": path.relative_to(series_directory.resolve()).as_posix(),
                "file_name": path.name,
                "relinked_at": datetime.now(timezone.utc).isoformat(),
            }
            metadata["character_text_reference"] = reference
            self.write_metadata(series_id, metadata)
            return series_directory.resolve(), path, reference
        return series_directory.resolve(), None, reference

    def deleted_character_directory(self, series_id: str) -> Path:
        return self.root / series_id / "deleted-characters"

    def purge_character_text_records(self, series_id: str) -> None:
        now = datetime.now(timezone.utc)
        trash = self.deleted_character_directory(series_id)
        if trash.is_dir():
            for path in trash.glob("*.json"):
                try:
                    value = json.loads(path.read_text(encoding="utf-8"))
                    expires_at = datetime.fromisoformat(str(value.get("expires_at", "")))
                except (OSError, json.JSONDecodeError, ValueError):
                    continue
                if expires_at <= now:
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass
        history = self.root / series_id / "character-text-history"
        if history.is_dir():
            snapshots = sorted(history.glob("*.md"), key=lambda path: path.stat().st_mtime, reverse=True)
            for path in snapshots[CHARACTER_TEXT_HISTORY_LIMIT:]:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass

    def list_deleted_characters(self, series_id_value: object) -> list[dict[str, Any]]:
        series_id = self.checked_id(series_id_value)
        if not series_id:
            return []
        self.purge_character_text_records(series_id)
        items: list[dict[str, Any]] = []
        trash = self.deleted_character_directory(series_id)
        if not trash.is_dir():
            return []
        for path in trash.glob("*.json"):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(value, dict) or value.get("series_id") != series_id:
                continue
            items.append({
                "deletion_id": path.stem,
                "character_catalog_id": str(value.get("character_catalog_id") or ""),
                "character_name": str(value.get("character_name") or "削除した人物"),
                "deleted_at": str(value.get("deleted_at") or ""),
                "expires_at": str(value.get("expires_at") or ""),
            })
        items.sort(key=lambda item: item["deleted_at"], reverse=True)
        return items

    def character_text_status(self, series_id_value: object) -> dict[str, Any]:
        series_id = self.checked_id(series_id_value)
        metadata = self.metadata_for(series_id) if series_id else None
        if not series_id or metadata is None:
            return {"linked": False, "series_id": series_id, "deleted_characters": []}
        with self.lock:
            series_directory, path, reference = self.resolve_character_text(series_id, metadata)
            text = ""
            if path is not None:
                try:
                    text = path.read_text(encoding="utf-8-sig")
                except OSError:
                    path = None
            return {
                "linked": path is not None,
                "needs_relink": bool(reference) and path is None,
                "series_id": series_id,
                "series_directory": str(series_directory) if series_directory else str(reference.get("series_directory") or ""),
                "relative_path": str(reference.get("relative_path") or ""),
                "file_name": path.name if path else str(reference.get("file_name") or ""),
                "text": text,
                "deleted_characters": self.list_deleted_characters(series_id),
            }

    def sync_character_text(
        self,
        series_id_value: object,
        markdown_value: object,
        active_character_ids_value: object,
        archive_value: object,
    ) -> dict[str, Any]:
        series_id = self.checked_id(series_id_value)
        markdown = self.checked_text(markdown_value, "人物の参照テキスト")
        active_ids = active_character_ids_value if isinstance(active_character_ids_value, list) else []
        active_character_ids = {
            self.checked_character_id(value) for value in active_ids if isinstance(value, str)
        }
        metadata = self.metadata_for(series_id) if series_id else None
        if not series_id or metadata is None:
            raise ValueError("シリーズ資料が見つかりません")
        archived = False
        with self.lock:
            self.purge_character_text_records(series_id)
            if isinstance(archive_value, dict):
                character_id = self.checked_character_id(archive_value.get("character_catalog_id"))
                character_name = str(archive_value.get("character_name") or "削除した人物").strip()[:200]
                archive_yaml = self.checked_text(archive_value.get("omny_yaml"), "人物の復元データ", MAX_SERIES_OMNY_BYTES)
                now = datetime.now(timezone.utc)
                deletion_id = f"deleted-{now.strftime('%Y%m%dT%H%M%S%fZ')}-{secrets.token_hex(6)}"
                payload = {
                    "schema_version": 1,
                    "series_id": series_id,
                    "character_catalog_id": character_id,
                    "character_name": character_name or "削除した人物",
                    "deleted_at": now.isoformat(),
                    "expires_at": (now + timedelta(days=CHARACTER_TEXT_RETENTION_DAYS)).isoformat(),
                    "omny_yaml": archive_yaml,
                }
                trash = self.deleted_character_directory(series_id)
                trash.mkdir(parents=True, exist_ok=True)
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=trash, delete=False) as handle:
                        temporary = Path(handle.name)
                        json.dump(payload, handle, ensure_ascii=False, indent=2)
                    os.replace(temporary, trash / f"{deletion_id}.json")
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
                archived = True

            series_directory, path, reference = self.resolve_character_text(series_id, metadata)
            linked = path is not None and series_directory is not None
            if linked and path is not None:
                try:
                    previous = path.read_text(encoding="utf-8-sig")
                except OSError:
                    previous = ""
                next_markdown = merge_character_catalog_markdown(previous, markdown)
                if previous != next_markdown:
                    history = self.root / series_id / "character-text-history"
                    history.mkdir(parents=True, exist_ok=True)
                    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                    digest = hashlib.sha256(previous.encode("utf-8")).hexdigest()[:12]
                    if previous:
                        (history / f"{stamp}-{digest}.md").write_text(previous, encoding="utf-8")
                    temporary = None
                    try:
                        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
                            temporary = Path(handle.name)
                            handle.write(next_markdown)
                        os.replace(temporary, path)
                    finally:
                        if temporary is not None:
                            temporary.unlink(missing_ok=True)
            else:
                next_markdown = ""

            trash = self.deleted_character_directory(series_id)
            if trash.is_dir() and active_character_ids:
                for deletion_path in trash.glob("*.json"):
                    try:
                        value = json.loads(deletion_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    if value.get("character_catalog_id") in active_character_ids:
                        try:
                            deletion_path.unlink()
                        except FileNotFoundError:
                            pass
        return {
            "ok": True,
            "linked": linked,
            "needs_relink": bool(reference) and not linked,
            "archived": archived,
            "series_id": series_id,
            "series_directory": str(series_directory) if series_directory else "",
            "file_name": path.name if path else "",
            "relative_path": path.relative_to(series_directory).as_posix() if path and series_directory else "",
            "text": next_markdown,
            "deleted_characters": self.list_deleted_characters(series_id),
        }

    def restore_character_text(self, series_id_value: object, deletion_id_value: object) -> dict[str, Any]:
        series_id = self.checked_id(series_id_value)
        if not isinstance(deletion_id_value, str) or not re.fullmatch(r"deleted-[A-Za-z0-9-]{1,100}", deletion_id_value):
            raise ValueError("復元する人物の情報が正しくありません")
        self.purge_character_text_records(series_id)
        path = self.deleted_character_directory(series_id) / f"{deletion_id_value}.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {"found": False, "series_id": series_id, "deletion_id": deletion_id_value}
        if not isinstance(value, dict) or value.get("series_id") != series_id or not isinstance(value.get("omny_yaml"), str):
            raise ValueError("人物の復元データが正しくありません")
        return {
            "found": True,
            "series_id": series_id,
            "deletion_id": deletion_id_value,
            "character_catalog_id": str(value.get("character_catalog_id") or ""),
            "character_name": str(value.get("character_name") or "削除した人物"),
            "omny_yaml": value["omny_yaml"],
        }
