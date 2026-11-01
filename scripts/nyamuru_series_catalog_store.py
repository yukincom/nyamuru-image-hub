"""Series-common catalog store: OMNY drafts, character text/images, and background model delegation."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import tempfile
import threading
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from nyamuru_macos_picker import (
    choose_series_directory,
    choose_workspace_files,
    default_picker_directory,
)
from nyamuru_series_background_store import SeriesBackgroundStore


DEFAULT_SERIES_CATALOG_ROOT = (
    Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "series-common"
)
SERIES_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
DRAFT_TOKEN_PATTERN = re.compile(r"^[a-f0-9]{32}$")
CHARACTER_ASSET_ID_PATTERN = re.compile(r"^image-[a-f0-9]{64}$")
CHARACTER_ASSET_FILE_PATTERN = re.compile(r"^image-[a-f0-9]{64}\.png$")
MAX_SERIES_OMNY_BYTES = 5 * 1024 * 1024
MAX_CHARACTER_TEXT_BYTES = 5 * 1024 * 1024
CHARACTER_TEXT_RETENTION_DAYS = 30
CHARACTER_TEXT_HISTORY_LIMIT = 120
CHARACTER_TEXT_CATALOG_START = re.compile(
    r'^<!--\s*nyamuru-series-character-catalog\b[^>]*-->\s*$', re.MULTILINE
)
CHARACTER_TEXT_CATALOG_END = re.compile(
    r'^<!--\s*/nyamuru-series-character-catalog\s*-->\s*$', re.MULTILINE
)
CHARACTER_TEXT_ENTRY_START = re.compile(
    r'^<!--\s*nyamuru-character\s+id="[A-Za-z0-9._-]{1,128}"\s*-->\s*$'
)
CHARACTER_TEXT_ENTRY_END = re.compile(r'^<!--\s*/nyamuru-character\s*-->\s*$')
CHARACTER_TEXT_GENERIC_HEADING = re.compile(
    r'^#{1,2}\s*(?:登場人物設定|登場人物|キャラクター|人物設定|メインキャラクター|characters?)\s*#*\s*$',
    re.IGNORECASE,
)
MAX_CHARACTER_REFERENCE_BYTES = 40 * 1024 * 1024
MAX_WORKSPACE_TEXT_BYTES = 5 * 1024 * 1024
EPISODE_WORKSPACE_DIRECTORIES = ("name_data", "draft_data", "manuscript_data", "export_data")
WORKSPACE_TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".text"}


def managed_character_catalog_span(source: str) -> tuple[int, int] | None:
    """Return the managed character block span, including its end marker."""
    start = CHARACTER_TEXT_CATALOG_START.search(source)
    if start is None:
        return None
    end = CHARACTER_TEXT_CATALOG_END.search(source, start.end())
    if end is None:
        return None
    return start.start(), end.end()


def character_text_notes(source: str) -> str:
    """Keep user notes outside legacy or managed character definitions."""
    managed_span = managed_character_catalog_span(source)
    if managed_span is not None:
        source = source[:managed_span[0]] + source[managed_span[1]:]
    lines = source.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    kept: list[str] = []
    skipping_entry = False
    inside_fence = False
    inside_character_section = True
    for raw_line in lines:
        line = raw_line.strip()
        if line.startswith('```'):
            if not skipping_entry:
                kept.append(raw_line)
                inside_fence = not inside_fence
            continue
        if inside_fence:
            kept.append(raw_line)
            continue
        if CHARACTER_TEXT_ENTRY_START.fullmatch(line):
            skipping_entry = True
            continue
        if CHARACTER_TEXT_ENTRY_END.fullmatch(line):
            skipping_entry = False
            continue
        heading = re.match(r'^(#{1,6})\s+(.+?)(?:\s+#+)?$', line)
        legacy_name = re.fullmatch(r'\*\*[^*\n]{1,80}\*\*', line)
        if heading and len(heading.group(1)) <= 2:
            skipping_entry = False
            inside_character_section = CHARACTER_TEXT_GENERIC_HEADING.fullmatch(line) is not None
            if inside_character_section:
                continue
            kept.append(raw_line)
            continue
        if inside_character_section and (legacy_name or (heading and len(heading.group(1)) == 3)):
            skipping_entry = True
            continue
        if skipping_entry:
            continue
        if CHARACTER_TEXT_GENERIC_HEADING.fullmatch(line):
            continue
        kept.append(raw_line)
    return '\n'.join(kept).strip()


def merge_character_catalog_markdown(previous: str, incoming: str) -> str:
    """Replace only Nyamuru's managed block and preserve other source notes."""
    incoming_span = managed_character_catalog_span(incoming)
    if incoming_span is None:
        return incoming
    managed = incoming[incoming_span[0]:incoming_span[1]].strip()
    previous_span = managed_character_catalog_span(previous)
    if previous_span is not None:
        prefix = previous[:previous_span[0]].rstrip()
        suffix = previous[previous_span[1]:].lstrip()
        parts = [part for part in (prefix, managed, suffix) if part]
        return '\n\n'.join(parts).rstrip() + '\n'
    notes = character_text_notes(previous)
    if not notes:
        return managed + '\n'
    return f'{managed}\n\n---\n\n{notes}\n'


def normalized_series_name(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return unicodedata.normalize("NFKC", value).strip().casefold()


def _reference_candidate_score(relative: Path, source: str, scope: str) -> tuple[int, list[str]]:
    """Score bounded text candidates without treating a plausible name as a decision."""
    normalized_path = unicodedata.normalize("NFKC", relative.as_posix()).casefold()
    normalized_name = unicodedata.normalize("NFKC", relative.stem).casefold()
    signals: list[str] = []
    score = 0
    character_words = ("character", "characters", "キャラクター", "人物", "登場人物")
    episode_words = ("origin", "story", "plot", "script", "scenario", "synopsis", "episode", "name", "ネーム", "あらすじ", "台本", "脚本", "原作")
    series_setting_words = ("series_setting", "series-settings", "series_settings", "worldview", "world", "lore", "世界観", "シリーズ設定", "舞台設定")
    character_heading = re.search(r"^#{1,3}\s*(?:登場人物|キャラクター|人物設定|characters?)\b", source, re.MULTILINE | re.IGNORECASE)
    episode_heading = re.search(r"^#{1,3}\s*(?:あらすじ|ストーリー|プロット|サブタイトル|話数|今回のエピソード)\b", source, re.MULTILINE | re.IGNORECASE)
    series_setting_heading = re.search(
        r"^#{1,3}\s*(?:シリーズ設定|シリーズの舞台|世界観|ジャンル|対象読者|成人指定|series settings?|world(?:view)?|lore)\b",
        source,
        re.MULTILINE | re.IGNORECASE,
    )

    if scope == "series":
        if normalized_name in {"character", "characters", "登場人物", "キャラクター", "人物設定"}:
            score += 120
            signals.append("人物資料らしいファイル名")
        elif any(word in normalized_name for word in character_words):
            score += 55
            signals.append("人物を示すファイル名")
        if any(part in normalized_path for part in ("character_data/", "characters/", "キャラクター/", "人物/")):
            score += 45
            signals.append("人物資料フォルダ")
        if character_heading:
            score += 55
            signals.append("人物設定の見出し")
        if normalized_name in {"series_setting", "series-settings", "series_settings", "シリーズ設定", "世界観", "世界観設定"}:
            score += 140
            signals.append("シリーズ設定らしいファイル名")
        elif any(word in normalized_name for word in series_setting_words) or "設定" in normalized_name:
            score += 60
            signals.append("世界観や設定を示すファイル名")
        if series_setting_heading:
            score += 70
            signals.append("シリーズ設定の見出し")
        if any(part in normalized_path for part in ("text/", "settings/", "setting/", "設定/", "資料/")):
            score += 15
            signals.append("シリーズ資料フォルダ")
        if episode_heading or any(word in normalized_name for word in episode_words):
            score -= 25
        if not any(signal not in {"人物資料フォルダ", "シリーズ資料フォルダ"} for signal in signals):
            return 0, signals
    else:
        if any(part in normalized_path for part in ("origin_data/text/", "元データ/", "source/text/", "reference/text/")):
            score += 65
            signals.append("元資料フォルダ")
        if any(word in normalized_name for word in episode_words):
            score += 45
            signals.append("話資料らしいファイル名")
        if episode_heading:
            score += 55
            signals.append("話情報の見出し")
        if character_heading or any(word in normalized_name for word in character_words):
            score -= 45
    return score, signals


def _series_reference_candidate_kind(relative: Path, source: str) -> str:
    normalized_name = unicodedata.normalize("NFKC", relative.stem).casefold()
    if (
        normalized_name in {"character", "characters", "登場人物", "キャラクター", "人物設定"}
        or any(word in normalized_name for word in ("character", "characters", "キャラクター", "人物", "登場人物"))
        or re.search(r"^#{1,3}\s*(?:登場人物|キャラクター|人物設定|characters?)\b", source, re.MULTILINE | re.IGNORECASE)
    ):
        return "characters"
    if (
        normalized_name in {"series_setting", "series-settings", "series_settings", "シリーズ設定", "世界観", "世界観設定"}
        or any(word in normalized_name for word in ("series_setting", "series-settings", "series_settings", "worldview", "world", "lore", "世界観", "シリーズ設定", "舞台設定"))
        or "設定" in normalized_name
        or re.search(
            r"^#{1,3}\s*(?:シリーズ設定|シリーズの舞台|世界観|ジャンル|対象読者|成人指定|series settings?|world(?:view)?|lore)\b",
            source,
            re.MULTILINE | re.IGNORECASE,
        )
    ):
        return "series-setting"
    return "series-reference"


def _read_reference_candidate(root: Path, relative: Path) -> str | None:
    """Read one regular file without following a symlink at any path component."""
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in relative.parts[:-1]:
            next_fd = os.open(
                part,
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=directory_fd,
            )
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(
            relative.name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        try:
            file_stat = os.fstat(file_fd)
            if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size > MAX_WORKSPACE_TEXT_BYTES:
                return None
            with os.fdopen(file_fd, "r", encoding="utf-8-sig", closefd=False) as handle:
                source = handle.read(MAX_WORKSPACE_TEXT_BYTES + 1)
            return source if len(source.encode("utf-8")) <= MAX_WORKSPACE_TEXT_BYTES else None
        finally:
            os.close(file_fd)
    except (OSError, UnicodeError):
        return None
    finally:
        os.close(directory_fd)


def discover_reference_text_candidates(root: Path, scope: str) -> list[dict[str, Any]]:
    """Inspect a selected folder only, with hard limits and managed-output exclusions."""
    if scope not in {"series", "episode"}:
        raise ValueError("参照テキストの分類が正しくありません")
    resolved_root = root.expanduser().resolve()
    if not resolved_root.is_dir():
        return []
    excluded = set(EPISODE_WORKSPACE_DIRECTORIES) | {".git", ".nyamuru", "node_modules"}
    candidates: list[dict[str, Any]] = []
    inspected = 0
    for path in sorted(resolved_root.rglob("*"), key=lambda item: item.as_posix()):
        if path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
            continue
        try:
            relative = path.relative_to(resolved_root)
        except ValueError:
            continue
        if len(relative.parts) > 5 or any(part.startswith(".") or part in excluded for part in relative.parts[:-1]):
            continue
        inspected += 1
        if inspected > 200:
            break
        source = _read_reference_candidate(resolved_root, relative)
        if source is None:
            continue
        score, signals = _reference_candidate_score(relative, source, scope)
        if score <= 0:
            continue
        relative_path = relative.as_posix()
        candidates.append({
            "candidate_id": hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:16],
            "relative_path": relative_path,
            "file_name": path.name,
            "text": source,
            "excerpt": source[:1800],
            "score": score,
            "signals": signals,
            "kind": _series_reference_candidate_kind(relative, source) if scope == "series" else "episode",
            "recommended": scope == "series" and score >= 100,
        })
    candidates.sort(key=lambda item: (-item["score"], len(item["relative_path"]), item["relative_path"]))
    return candidates[:20]


class SeriesCatalogConflict(RuntimeError):
    """Raised when a catalog changed after the client loaded it."""


class SeriesCatalogStore:
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

    @staticmethod
    def character_text_reference(metadata: dict[str, Any] | None) -> dict[str, Any]:
        value = metadata.get("character_text_reference") if metadata else None
        return value if isinstance(value, dict) else {}

    def character_text_candidates(
        self,
        series_directory: Path,
        series_id: str,
        reference: dict[str, Any],
    ) -> list[Path]:
        candidates: list[tuple[int, Path]] = []
        inspected_text_files = 0
        old_relative = reference.get("relative_path")
        old_name = reference.get("file_name")
        if isinstance(old_relative, str) and old_relative:
            exact = (series_directory / old_relative).resolve()
            if self.path_within(series_directory, exact) and exact.is_file() and exact.suffix.lower() in WORKSPACE_TEXT_EXTENSIONS:
                return [exact]
        for path in series_directory.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
                continue
            inspected_text_files += 1
            if inspected_text_files > 200:
                break
            try:
                relative = path.relative_to(series_directory)
            except ValueError:
                continue
            if len(relative.parts) > 5:
                continue
            resolved = path.resolve()
            if not self.path_within(series_directory, resolved):
                continue
            try:
                if path.stat().st_size > MAX_CHARACTER_TEXT_BYTES:
                    continue
                source = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeError):
                continue
            score = 0
            if f'series-id="{series_id}"' in source:
                score += 100
            if isinstance(old_name, str) and path.name == old_name:
                score += 50
            normalized_name = unicodedata.normalize("NFKC", path.stem).casefold()
            if any(word in normalized_name for word in ("character", "characters", "キャラクター", "人物", "登場人物")):
                score += 20
            if re.search(r"^#\s*(?:登場人物|キャラクター|人物設定)", source, re.MULTILINE):
                score += 30
            if re.search(r"^##\s*(?:登場人物|キャラクター|メインキャラクター)", source, re.MULTILINE):
                score += 10
            if score:
                candidates.append((score, resolved))
        candidates.sort(key=lambda item: (-item[0], len(item[1].parts), item[1].as_posix()))
        if not candidates:
            return []
        best_score = candidates[0][0]
        return [path for score, path in candidates if score == best_score]

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
