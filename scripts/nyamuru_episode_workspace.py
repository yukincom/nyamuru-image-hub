"""Episode workspace registry, reference file selection, and source coverage persistence."""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import secrets
import stat
import tempfile
import threading
from pathlib import Path
from typing import Any
from nyamuru_macos_picker import (
    choose_episode_directory,
    choose_workspace_files,
    default_picker_directory,
)
from nyamuru_series_catalog_store import (
    EPISODE_WORKSPACE_DIRECTORIES,
    MAX_WORKSPACE_TEXT_BYTES,
    WORKSPACE_TEXT_EXTENSIONS,
    discover_reference_text_candidates,
)

from source_coverage_contract import (
    MAX_SOURCE_COVERAGE_REPORT_BYTES,
    MAX_SOURCE_COVERAGE_UNITS,
    MAX_SOURCE_COVERAGE_TARGETS,
    SOURCE_COVERAGE_SCHEMA_NAME,
    SOURCE_COVERAGE_SHA_PATTERN,
    SOURCE_COVERAGE_SOURCE_ID_PATTERN,
    SOURCE_COVERAGE_TARGET_ID_PATTERN,
    CoverageReportConflict,
    SourceCoverageContract,
)
from source_coverage_files import SourceCoverageFiles


DEFAULT_EPISODE_WORKSPACE_STATE_PATH = (
    Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "episode-workspaces.json"
)
MAX_WORKSPACE_IMAGE_BYTES = 40 * 1024 * 1024
MAX_WORKSPACE_IMAGE_TOTAL_BYTES = 96 * 1024 * 1024
WORKSPACE_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}

class EpisodeWorkspaceManager(SourceCoverageContract, SourceCoverageFiles):
    def __init__(self, state_path: Path | None = None):
        self.lock = threading.Lock()
        self.directories: dict[str, Path] = {}
        self.state_path = (state_path or DEFAULT_EPISODE_WORKSPACE_STATE_PATH).expanduser().absolute()
        self._load()

    def _load(self) -> None:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        workspaces = value.get("workspaces") if isinstance(value, dict) else None
        if not isinstance(workspaces, dict):
            return
        recovered: dict[str, Path] = {}
        for token, entry in workspaces.items():
            directory_value = entry.get("directory") if isinstance(entry, dict) else None
            if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{24,128}", token):
                continue
            if not isinstance(directory_value, str) or not directory_value:
                continue
            directory = Path(directory_value).expanduser().resolve()
            if directory.is_dir():
                recovered[token] = directory
        self.directories = recovered

    def _persist(self) -> None:
        payload = {
            "schema_version": 1,
            "workspaces": {
                token: {"directory": str(directory)}
                for token, directory in sorted(self.directories.items())
            },
        }
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.state_path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.state_path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def select(self, default_directory_value: object) -> dict[str, Any]:
        selected = choose_episode_directory(default_picker_directory(default_directory_value))
        if selected is None:
            return {"ok": True, "cancelled": True}
        selected = selected.expanduser().resolve()
        if not selected.is_dir():
            raise ValueError("選択したエピソードフォルダが見つかりません")
        with self.lock:
            token = next((key for key, directory in sorted(self.directories.items()) if directory == selected), None)
            if token is None:
                token = secrets.token_urlsafe(24)
                while token in self.directories:
                    token = secrets.token_urlsafe(24)
                self.directories[token] = selected
                try:
                    self._persist()
                except Exception:
                    self.directories.pop(token)
                    raise
        return {
            "ok": True,
            "cancelled": False,
            "workspace_token": token,
            "directory": str(selected),
            "folder_name": selected.name,
            "series_directory": str(selected.parent),
        }

    def directory(self, token_value: object) -> Path:
        if not isinstance(token_value, str) or not token_value:
            raise ValueError("エピソード保存先の選択情報がありません")
        with self.lock:
            directory = self.directories.get(token_value)
        if directory is None or not directory.is_dir():
            raise ValueError("エピソード保存先をもう一度選んでください")
        return directory

    def prepare(self, token_value: object) -> dict[str, Any]:
        directory = self.directory(token_value)
        created: list[str] = []
        with self.lock:
            for name in EPISODE_WORKSPACE_DIRECTORIES:
                target = directory / name
                if target.exists() and not target.is_dir():
                    raise ValueError(f"{name}と同名のファイルがあるため、制作フォルダを作成できません")
            for name in EPISODE_WORKSPACE_DIRECTORIES:
                target = directory / name
                if not target.exists():
                    target.mkdir()
                    created.append(name)
        return {
            "ok": True,
            "directory": str(directory),
            "created": created,
            "managed_directories": list(EPISODE_WORKSPACE_DIRECTORIES),
        }

    def ledger_root(self, token_value: object) -> tuple[Path, Path]:
        episode = self.directory(token_value).resolve()
        draft_directory = episode / "draft_data"
        if not draft_directory.is_dir():
            raise ValueError("制作フォルダが準備されていません。保存先を選び直してください")
        if draft_directory.is_symlink():
            raise ValueError("制作フォルダのsymlinkは台帳保存先に使用できません")
        resolved_draft = draft_directory.resolve()
        try:
            resolved_draft.relative_to(episode)
        except ValueError as exc:
            raise ValueError("制作フォルダがエピソード保存先の外側を参照しています") from exc
        root = resolved_draft / "nyamuru"
        if root.exists() and (not root.is_dir() or root.is_symlink()):
            raise ValueError("Nyamuruの制作台帳保存先を安全に使用できません")
        root.mkdir(parents=True, exist_ok=True)
        resolved_root = root.resolve()
        try:
            resolved_root.relative_to(episode)
        except ValueError as exc:
            raise ValueError("Nyamuruの制作台帳保存先がエピソード外を参照しています") from exc
        return episode, resolved_root

    def choose_text(self, token_value: object) -> dict[str, Any]:
        directory = self.directory(token_value)
        selected = choose_workspace_files(directory, "text", False)
        if selected is None:
            return {"ok": True, "cancelled": True}
        if len(selected) != 1:
            raise ValueError("文章ファイルを1つ選んでください")
        path = selected[0]
        if path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
            raise ValueError("Markdown（.md/.markdown）またはテキスト（.txt/.text）を選んでください")
        if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
            raise ValueError("このOSでは文章ファイルを安全に読み込めません")
        try:
            descriptor, relative_path = self._open_selected_workspace_text(directory, path)
        except OSError as exc:
            raise ValueError("選択した文章ファイルを安全に開けません") from exc
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_WORKSPACE_TEXT_BYTES:
                raise ValueError("文章ファイルが5MiBを超えているか、通常ファイルではありません")
            chunks: list[bytes] = []
            remaining = MAX_WORKSPACE_TEXT_BYTES + 1
            while remaining > 0:
                chunk = os.read(descriptor, min(1024 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            after = os.fstat(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != \
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise ValueError("文章ファイルが読み込み中に変更されました")
            raw = b"".join(chunks)
            if len(raw) > MAX_WORKSPACE_TEXT_BYTES:
                raise ValueError("文章ファイルが5MiBを超えています")
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise ValueError("文章ファイルはUTF-8で保存してください") from exc
        finally:
            os.close(descriptor)
        return {
            "ok": True,
            "cancelled": False,
            "filename": path.name,
            "text": text,
            "relative_path": relative_path,
            "byte_size": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }

    def reference_candidates(self, token_value: object) -> list[dict[str, Any]]:
        return discover_reference_text_candidates(self.directory(token_value), "episode")

    def choose_images(self, token_value: object, max_files_value: object) -> dict[str, Any]:
        directory = self.directory(token_value)
        try:
            max_files = min(12, max(1, int(max_files_value)))
        except (TypeError, ValueError):
            max_files = 10
        selected = choose_workspace_files(directory, "image", True)
        if selected is None:
            return {"ok": True, "cancelled": True, "files": []}
        files: list[dict[str, Any]] = []
        total_bytes = 0
        for path in selected[:max_files]:
            if not path.is_file() or path.suffix.lower() not in WORKSPACE_IMAGE_EXTENSIONS:
                raise ValueError(f"対応していない画像です: {path.name}")
            byte_size = path.stat().st_size
            if byte_size > MAX_WORKSPACE_IMAGE_BYTES:
                raise ValueError(f"画像が40MBを超えています: {path.name}")
            total_bytes += byte_size
            if total_bytes > MAX_WORKSPACE_IMAGE_TOTAL_BYTES:
                raise ValueError("選択した画像の合計が96MBを超えています")
            media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            files.append({
                "filename": path.name,
                "media_type": media_type,
                "image": f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}",
            })
        return {"ok": True, "cancelled": False, "files": files}
