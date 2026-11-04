"""Persist, commit or discard catalog drafts while holding the existing series store lock."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from series_reference_sources import (
    DRAFT_TOKEN_PATTERN,
    MAX_SERIES_OMNY_BYTES,
    WORKSPACE_TEXT_EXTENSIONS,
    normalized_series_name,
    SeriesCatalogConflict,
)


class SeriesCatalogDrafts:
    def _draft_directory(self, token: str) -> Path:
        if not DRAFT_TOKEN_PATTERN.fullmatch(token):
            raise ValueError("新規作成の仮保存IDが正しくありません")
        return self.root / ".drafts" / token

    @staticmethod
    def _draft_manifest(directory: Path) -> dict[str, Any]:
        try:
            value = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("新規作成の仮保存情報を確認できません") from exc
        if not isinstance(value, dict):
            raise ValueError("新規作成の仮保存情報が正しくありません")
        return value

    def _discard_draft_locked(self, token: str) -> dict[str, Any]:
        draft_directory = self._draft_directory(token)
        if not draft_directory.is_dir():
            return {"ok": True, "discarded": False, "draft_token": token}
        manifest = self._draft_manifest(draft_directory)
        series_id = self.checked_id(manifest.get("series_id"))
        if not series_id:
            raise ValueError("破棄するシリーズの内部IDが正しくありません")
        current = self.root / series_id
        existed = manifest.get("existed") is True
        snapshot = draft_directory / "snapshot"
        displaced = draft_directory / "discarded-current"
        if existed and not snapshot.is_dir():
            raise ValueError("保存前のシリーズ台帳を復元できません")
        if displaced.exists():
            shutil.rmtree(displaced)
        if current.exists():
            shutil.move(str(current), str(displaced))
        try:
            if existed:
                shutil.move(str(snapshot), str(current))
        except Exception:
            if displaced.exists() and not current.exists():
                shutil.move(str(displaced), str(current))
            raise
        shutil.rmtree(draft_directory)
        drafts_root = self.root / ".drafts"
        try:
            drafts_root.rmdir()
        except OSError:
            pass
        return {"ok": True, "discarded": True, "draft_token": token, "series_id": series_id}

    def recover_abandoned_drafts(self) -> int:
        drafts_root = self.root / ".drafts"
        if not drafts_root.is_dir():
            return 0
        recovered = 0
        for directory in sorted(drafts_root.iterdir()):
            if not directory.is_dir() or not DRAFT_TOKEN_PATTERN.fullmatch(directory.name):
                continue
            self._discard_draft_locked(directory.name)
            recovered += 1
        return recovered

    def begin_draft(
        self,
        series_name_value: object,
        series_id_value: object,
        episode_id_value: object,
    ) -> dict[str, Any]:
        series_name = self.checked_name(series_name_value)
        series_id = self.checked_id(series_id_value)
        episode_id = self.checked_id(episode_id_value)
        if not series_id or not episode_id:
            raise ValueError("新規作成の内部IDが正しくありません")
        with self.lock:
            drafts_root = self.root / ".drafts"
            if drafts_root.is_dir():
                for directory in drafts_root.iterdir():
                    if not directory.is_dir() or not DRAFT_TOKEN_PATTERN.fullmatch(directory.name):
                        continue
                    manifest = self._draft_manifest(directory)
                    if manifest.get("series_id") == series_id:
                        raise SeriesCatalogConflict("このシリーズには保存していない新規作成データがあります")
            token = secrets.token_hex(16)
            draft_directory = self._draft_directory(token)
            source = self.root / series_id
            draft_directory.mkdir(parents=True)
            if source.is_dir():
                shutil.copytree(source, draft_directory / "snapshot")
            manifest = {
                "draft_token": token,
                "series_id": series_id,
                "series_name": series_name,
                "episode_id": episode_id,
                "existed": source.is_dir(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            (draft_directory / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return {"ok": True, **manifest}

    def discard_draft(self, token_value: object) -> dict[str, Any]:
        token = str(token_value).strip() if isinstance(token_value, str) else ""
        with self.lock:
            return self._discard_draft_locked(token)

    def commit_draft(self, token_value: object) -> dict[str, Any]:
        token = str(token_value).strip() if isinstance(token_value, str) else ""
        draft_directory = self._draft_directory(token)
        with self.lock:
            if not draft_directory.is_dir():
                return {"ok": True, "committed": False, "draft_token": token}
            manifest = self._draft_manifest(draft_directory)
            series_id = self.checked_id(manifest.get("series_id"))
            shutil.rmtree(draft_directory)
            drafts_root = self.root / ".drafts"
            try:
                drafts_root.rmdir()
            except OSError:
                pass
        return {"ok": True, "committed": True, "draft_token": token, "series_id": series_id}

    def save(
        self,
        series_name_value: object,
        series_id_value: object,
        omny_yaml_value: object,
        expected_revision_value: object,
        series_directory_value: object = None,
        series_text_relative_path_value: object = None,
    ) -> dict[str, Any]:
        series_name = self.checked_name(series_name_value)
        requested_id = self.checked_id(series_id_value)
        expected_revision = str(expected_revision_value).strip() if isinstance(expected_revision_value, str) else ""
        if expected_revision and not re.fullmatch(r"[a-f0-9]{64}", expected_revision):
            raise ValueError("シリーズ台帳のリビジョンが正しくありません")
        if not isinstance(omny_yaml_value, str) or not omny_yaml_value.strip():
            raise ValueError("シリーズ共通OMNYが空です")
        if len(omny_yaml_value.encode("utf-8")) > MAX_SERIES_OMNY_BYTES:
            raise ValueError("シリーズ共通OMNYが保存上限を超えています")
        with self.lock:
            series_id = requested_id
            requested_metadata = self.metadata_for(series_id) if series_id else None
            matched = self.find_by_name(series_name)
            if requested_metadata is not None and matched and matched[0] != series_id:
                raise SeriesCatalogConflict("同じ名前の別シリーズ台帳があります。保存済みシリーズを選び直してください")
            if requested_metadata is None:
                if matched:
                    series_id = matched[0]
            series_id = series_id or secrets.token_hex(16)
            directory = self.root / series_id
            catalog_path = directory / "series.yaml"
            previous_metadata = requested_metadata
            if previous_metadata is None and matched and matched[0] == series_id:
                previous_metadata = matched[1]
            metadata_path = directory / "catalog.json"
            try:
                previous_metadata_bytes = metadata_path.read_bytes()
            except FileNotFoundError:
                previous_metadata_bytes = None
            if (json.loads(previous_metadata_bytes) if previous_metadata_bytes is not None else None) != previous_metadata:
                raise SeriesCatalogConflict("保存の準備中にシリーズ情報が変わりました。再読み込みしてください")
            catalog_state = self._read_catalog(series_id, previous_metadata)
            current_source, previous_bytes, _legacy, origin = catalog_state
            current_revision = hashlib.sha256(current_source.encode("utf-8")).hexdigest() if current_source else ""
            if current_revision != expected_revision:
                raise SeriesCatalogConflict("シリーズ台帳が別の画面または話から更新されました。再読み込みして内容を確認してください")
            next_revision = hashlib.sha256(omny_yaml_value.encode("utf-8")).hexdigest()
            metadata = {
                **(previous_metadata or {}),
                "series_id": series_id,
                "series_name": series_name,
                "revision": next_revision,
            }
            if origin is not None:
                metadata["legacy_source"] = origin
            series_directory = (
                Path(series_directory_value).expanduser().resolve()
                if isinstance(series_directory_value, str) and series_directory_value.strip()
                else None
            )
            if series_directory is not None:
                if not series_directory.is_dir():
                    raise ValueError("選択したシリーズフォルダが見つかりません")
                metadata["series_directory"] = str(series_directory)
            relative_path = (
                str(series_text_relative_path_value).strip()
                if isinstance(series_text_relative_path_value, str)
                else ""
            )
            if relative_path:
                if series_directory is None:
                    saved_directory = metadata.get("series_directory")
                    series_directory = (
                        Path(saved_directory).expanduser().resolve()
                        if isinstance(saved_directory, str) and saved_directory.strip()
                        else None
                    )
                if series_directory is None or not series_directory.is_dir():
                    raise ValueError("シリーズ資料テキストの保存先を確認できません")
                reference_path = (series_directory / relative_path).resolve()
                if not relative_path or not self.path_within(series_directory, reference_path):
                    raise ValueError("シリーズ資料テキストの場所が正しくありません")
                if not reference_path.is_file() or reference_path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
                    raise ValueError("シリーズ資料テキストが見つかりません")
                previous_reference = self.character_text_reference(metadata)
                reference = {
                    "schema_version": 1,
                    "series_directory": str(series_directory),
                    "relative_path": reference_path.relative_to(series_directory).as_posix(),
                    "file_name": reference_path.name,
                    "reference_id": str(previous_reference.get("reference_id") or secrets.token_hex(16)),
                }
                same_reference = all(previous_reference.get(key) == value for key, value in reference.items())
                metadata["character_text_reference"] = previous_reference if same_reference else {
                    **reference,
                    "linked_at": datetime.now(timezone.utc).isoformat(),
                }
            if previous_bytes is not None and current_source == omny_yaml_value and metadata == previous_metadata:
                return {"ok": True, "series_id": series_id, "series_name": series_name, "directory": str(directory), "revision": next_revision}
            metadata["updated_at"] = datetime.now(timezone.utc).isoformat()
            directory.mkdir(parents=True, exist_ok=True)
            temporaries: list[Path] = []
            try:
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as handle:
                    yaml_temporary = Path(handle.name)
                    temporaries.append(yaml_temporary)
                    handle.write(omny_yaml_value)
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as handle:
                    metadata_temporary = Path(handle.name)
                    temporaries.append(metadata_temporary)
                    json.dump(metadata, handle, ensure_ascii=False, indent=2)
                restore_temporary = None
                if previous_bytes is not None:
                    # Prepare recovery before publication: a full disk must not split the pair.
                    with tempfile.NamedTemporaryFile("wb", dir=directory, delete=False) as handle:
                        restore_temporary = Path(handle.name)
                        temporaries.append(restore_temporary)
                        handle.write(previous_bytes)
                try:
                    latest_metadata_bytes = metadata_path.read_bytes()
                except FileNotFoundError:
                    latest_metadata_bytes = None
                if latest_metadata_bytes != previous_metadata_bytes or self._read_catalog(series_id, previous_metadata) != catalog_state:
                    raise SeriesCatalogConflict("保存の準備中にシリーズ台帳が変わりました。再読み込みしてください")
                os.replace(yaml_temporary, catalog_path)
                try:
                    os.replace(metadata_temporary, directory / "catalog.json")
                except Exception:
                    if restore_temporary is None:
                        catalog_path.unlink()
                    else:
                        try:
                            os.replace(restore_temporary, catalog_path)
                        except OSError as error:
                            # Do not erase the only recoverable old bytes after a second I/O failure.
                            temporaries.remove(restore_temporary)
                            raise OSError(f"台帳の復元にも失敗しました。元データを保持しています: {restore_temporary}") from error
                    raise
            finally:
                for temporary in temporaries:
                    temporary.unlink(missing_ok=True)
        return {"ok": True, "series_id": series_id, "series_name": series_name, "directory": str(directory), "revision": next_revision}

    def discard_unsaved(
        self,
        series_name_value: object,
        series_id_value: object,
        episode_id_value: object,
    ) -> dict[str, Any]:
        series_name = self.checked_name(series_name_value)
        series_id = self.checked_id(series_id_value)
        episode_id = self.checked_id(episode_id_value)
        if not series_id or not episode_id:
            raise ValueError("破棄する新規作品の内部IDが正しくありません")
        directory = self.root / series_id
        with self.lock:
            metadata = self.metadata_for(series_id)
            if metadata is None or not directory.is_dir():
                return {"ok": True, "deleted": False, "series_id": series_id}
            stored_name = str(metadata.get("series_name") or "").strip()
            if normalized_series_name(stored_name) != normalized_series_name(series_name):
                raise SeriesCatalogConflict("破棄対象のシリーズ名が一致しません")
            try:
                source, current, legacy, _origin = self._read_catalog(series_id, metadata)
                if current is None and legacy is None:
                    raise FileNotFoundError("series.yaml")
            except OSError as exc:
                raise ValueError("破棄対象のシリーズ台帳を確認できません") from exc
            episode_pattern = re.compile(
                rf'^\s*episode_id:\s*["\']?{re.escape(episode_id)}["\']?\s*$',
                re.MULTILINE,
            )
            if not episode_pattern.search(source):
                raise SeriesCatalogConflict("破棄対象が現在の新規作品と一致しません")
            shutil.rmtree(directory)
        return {"ok": True, "deleted": True, "series_id": series_id}
