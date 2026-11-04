"""Find and normalize the text sources used by series and character catalogs."""

from __future__ import annotations

import hashlib
import os
import re
import stat
import unicodedata
from pathlib import Path
from typing import Any


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


class SeriesTextSources:
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
