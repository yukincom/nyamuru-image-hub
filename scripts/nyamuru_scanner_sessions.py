"""Image Capture preferences, previews, and recoverable scanner sessions."""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scanner_files import (
    SCANNER_EXTENSIONS,
    image_capture_preference,
    quit_image_capture,
    scanner_destination,
    scanner_document_prefix,
    scanner_image_files,
    scanner_file_signature,
    scanner_preview,
)


SCANNER_WINDOW_SECONDS = 5 * 60
SCANNER_MAX_FILES = 10
SCANNER_STABLE_SECONDS = 0.8
DEFAULT_SCANNER_STATE_PATH = (
    Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "scanner-session.json"
)

@dataclass
class ObservedScan:
    signature: tuple[int, int]
    stable_since: float


@dataclass
class ScannerSession:
    session_id: str
    directory: Path
    prefix: str
    started_ns: int
    started_at: str
    expires_at_monotonic: float
    baseline: dict[Path, tuple[int, int]]
    observed: dict[Path, ObservedScan] = field(default_factory=dict)
    delivered: dict[str, Path] = field(default_factory=dict)
    delivered_paths: set[Path] = field(default_factory=set)
    watching: bool = True

    @property
    def complete(self) -> bool:
        return not self.watching or time.monotonic() >= self.expires_at_monotonic or len(self.delivered_paths) >= SCANNER_MAX_FILES


class ScannerSessions:
    def __init__(self, state_path: Path | None = None):
        self.lock = threading.Lock()
        self.active: ScannerSession | None = None
        self.state_path = state_path or DEFAULT_SCANNER_STATE_PATH

    def _persist(self, session: ScannerSession) -> None:
        payload = {
            "version": 1,
            "session_id": session.session_id,
            "directory": str(session.directory),
            "prefix": session.prefix,
            "started_ns": session.started_ns,
            "started_at": session.started_at,
            "baseline": {
                path.name: [signature[0], signature[1]]
                for path, signature in session.baseline.items()
                if path.parent == session.directory
            },
            "delivered": {file_id: path.name for file_id, path in session.delivered.items()},
            "watching": session.watching,
        }
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(f"{self.state_path.suffix}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    def _clear_state(self) -> None:
        self.state_path.unlink(missing_ok=True)

    def _load_recoverable(self) -> ScannerSession | None:
        if self.active:
            return self.active
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            directory = Path(payload["directory"]).expanduser().resolve()
            prefix = str(payload["prefix"])
            started_ns = int(payload["started_ns"])
            started_at = str(payload["started_at"])
            session_id = str(payload["session_id"])
            if not directory.is_dir() or not prefix or not session_id:
                raise ValueError("invalid scanner recovery state")
            raw_baseline = payload.get("baseline", {})
            baseline = {
                (directory / name).resolve(): (int(signature[0]), int(signature[1]))
                for name, signature in raw_baseline.items()
                if isinstance(name, str)
                and Path(name).name == name
                and isinstance(signature, list)
                and len(signature) == 2
            }
            session = ScannerSession(
                session_id=session_id,
                directory=directory,
                prefix=prefix,
                started_ns=started_ns,
                started_at=started_at,
                expires_at_monotonic=time.monotonic(),
                baseline=baseline,
                watching=False,
            )
            raw_delivered = payload.get("delivered", {})
            if isinstance(raw_delivered, dict):
                for file_id, name in raw_delivered.items():
                    if not isinstance(file_id, str) or not isinstance(name, str) or Path(name).name != name:
                        continue
                    path = (directory / name).resolve()
                    if path.parent == directory and path.exists():
                        session.delivered[file_id] = path
                        session.delivered_paths.add(path)
            self.active = session
            return session
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            self._clear_state()
            return None

    @staticmethod
    def _session_payload(session: ScannerSession) -> dict[str, Any]:
        return {
            "session_id": session.session_id,
            "started_at": session.started_at,
            "expires_in_seconds": SCANNER_WINDOW_SECONDS if session.watching else 0,
            "max_files": SCANNER_MAX_FILES,
            "directory": str(session.directory),
        }

    @staticmethod
    def _eligible_paths(session: ScannerSession) -> list[tuple[Path, tuple[int, int]]]:
        eligible: list[tuple[Path, tuple[int, int]]] = []
        for candidate in scanner_image_files(session.directory, session.prefix):
            path = candidate.resolve()
            if path.parent != session.directory:
                continue
            try:
                signature = scanner_file_signature(path)
            except OSError:
                continue
            if signature[1] < session.started_ns or session.baseline.get(path) == signature:
                continue
            eligible.append((path, signature))
        return sorted(eligible, key=lambda item: (item[1][1], item[0].name))[:SCANNER_MAX_FILES]

    def _delete_session_files(self, session: ScannerSession) -> dict[str, Any]:
        deleted = 0
        errors: list[str] = []
        for path, _ in self._eligible_paths(session):
            try:
                path.unlink()
                deleted += 1
            except FileNotFoundError:
                continue
            except OSError as exc:
                errors.append(f"{path.name}: {exc}")
        if not errors:
            self.active = None
            self._clear_state()
        else:
            self._persist(session)
        return {"deleted": deleted, "errors": errors}

    def start(self) -> dict[str, Any]:
        with self.lock:
            recoverable = self._load_recoverable()
            if recoverable and self._eligible_paths(recoverable):
                raise ValueError("前回のスキャン画像が残っています。先につなぎ直すか破棄してください")
            if recoverable:
                self.active = None
                self._clear_state()
        directory = scanner_destination().resolve()
        prefix = scanner_document_prefix()
        started_ns = time.time_ns()
        baseline: dict[Path, tuple[int, int]] = {}
        for path in scanner_image_files(directory, prefix):
            try:
                baseline[path.resolve()] = scanner_file_signature(path)
            except OSError:
                continue
        session = ScannerSession(
            session_id=secrets.token_urlsafe(24),
            directory=directory,
            prefix=prefix,
            started_ns=started_ns,
            started_at=datetime.now(timezone.utc).isoformat(),
            expires_at_monotonic=time.monotonic() + SCANNER_WINDOW_SECONDS,
            baseline=baseline,
        )
        with self.lock:
            self.active = session
            self._persist(session)
        return self._session_payload(session)

    def cancel(self, session_id: str) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            return self._delete_session_files(session)

    def _session(self, session_id: object) -> ScannerSession:
        if not isinstance(session_id, str) or not self.active or not secrets.compare_digest(session_id, self.active.session_id):
            raise ValueError("スキャン待機セッションが見つかりません")
        return self.active

    def collect(self, session_id: object) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            now = time.monotonic()
            ready: list[tuple[Path, tuple[int, int]]] = []
            if not session.complete:
                for candidate in scanner_image_files(session.directory, session.prefix):
                    path = candidate.resolve()
                    if path in session.delivered_paths:
                        continue
                    try:
                        signature = scanner_file_signature(path)
                    except OSError:
                        continue
                    if signature[1] < session.started_ns or session.baseline.get(path) == signature:
                        continue
                    observed = session.observed.get(path)
                    if not observed or observed.signature != signature:
                        session.observed[path] = ObservedScan(signature=signature, stable_since=now)
                        continue
                    if now - observed.stable_since >= SCANNER_STABLE_SECONDS:
                        ready.append((path, signature))

            slots = max(0, SCANNER_MAX_FILES - len(session.delivered_paths))
            payloads: list[dict[str, Any]] = []
            for path, (size, modified_ns) in sorted(ready, key=lambda item: (item[1][1], item[0].name))[:slots]:
                try:
                    mime_type, encoded = scanner_preview(path)
                except (OSError, ValueError):
                    continue
                file_id = secrets.token_urlsafe(18)
                session.delivered[file_id] = path
                session.delivered_paths.add(path)
                payloads.append({
                    "id": file_id,
                    "filename": path.name,
                    "size": size,
                    "modified_at": datetime.fromtimestamp(modified_ns / 1_000_000_000, timezone.utc).isoformat(),
                    "image": f"data:{mime_type};base64,{encoded}",
                })
            self._persist(session)
            remaining = max(0, round(session.expires_at_monotonic - time.monotonic()))
            return {
                "files": payloads,
                "complete": session.complete,
                "remaining_seconds": remaining,
                "total": len(session.delivered_paths),
            }

    def commit(self, session_id: object) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            return self._delete_session_files(session)

    def finish(self, session_id: object) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            session.watching = False
            retained = [path.name for path in session.delivered.values() if path.exists()]
            self._persist(session)
        return {"ok": True, "retained": retained}

    def pending(self) -> dict[str, Any]:
        with self.lock:
            session = self._load_recoverable()
            if not session:
                return {"pending": False}
            paths = self._eligible_paths(session)
            if not paths:
                self.active = None
                self._clear_state()
                return {"pending": False}
            return {
                "pending": True,
                "started_at": session.started_at,
                "directory": str(session.directory),
                "count": len(paths),
            }

    def resume(self) -> dict[str, Any]:
        with self.lock:
            session = self._load_recoverable()
            if not session:
                raise ValueError("再開できるスキャン画像がありません")
            session.watching = False
            session.delivered = {}
            session.delivered_paths = set()
            payloads: list[dict[str, Any]] = []
            for path, (size, modified_ns) in self._eligible_paths(session):
                try:
                    mime_type, encoded = scanner_preview(path)
                except (OSError, ValueError):
                    continue
                file_id = secrets.token_urlsafe(18)
                session.delivered[file_id] = path
                session.delivered_paths.add(path)
                payloads.append({
                    "id": file_id,
                    "filename": path.name,
                    "size": size,
                    "modified_at": datetime.fromtimestamp(modified_ns / 1_000_000_000, timezone.utc).isoformat(),
                    "image": f"data:{mime_type};base64,{encoded}",
                })
            if not payloads:
                raise ValueError("再開できるスキャン画像を読み込めませんでした")
            self._persist(session)
            return {**self._session_payload(session), "files": payloads}

    def discard_pending(self) -> dict[str, Any]:
        with self.lock:
            session = self._load_recoverable()
            if not session:
                self._clear_state()
                return {"deleted": 0, "errors": []}
            return self._delete_session_files(session)
