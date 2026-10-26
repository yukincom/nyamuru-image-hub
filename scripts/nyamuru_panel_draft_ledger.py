"""Episode-local panel draft ledger and immutable artifact storage."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from nyamuru_comfy_draft import (
    MAX_COMFY_IMAGE_BYTES,
    PANEL_DRAFT_ID_PATTERN,
    ComfyUIDraftGenerator,
)


MAX_PANEL_DRAFT_OMNY_BYTES = 5 * 1024 * 1024
MAX_PANEL_DRAFT_SNAPSHOT_BYTES = 2 * 1024 * 1024
PANEL_DRAFT_STATUS_VALUES = {"created", "queued", "succeeded", "failed", "outcome_unknown"}
PANEL_DRAFT_REVIEW_VALUES = {"accepted", "rejected"}
PANEL_DRAFT_LEDGER_SCHEMA_VERSION = 2
PANEL_DRAFT_PROVENANCE_VERSION = 2


class PanelDraftLedger:
    """Episode-local durable ledger; ComfyUI queue/history is external execution evidence only."""

    SCHEMA_VERSION = PANEL_DRAFT_LEDGER_SCHEMA_VERSION
    ARTIFACT_SUFFIXES = {".json", ".yaml", ".png"}

    def __init__(self, episode_root: Path, root: Path):
        self.episode_root = episode_root.resolve()
        unresolved_root = root.expanduser().absolute()
        if unresolved_root.is_symlink():
            raise ValueError("制作台帳のsymlinkは使用できません")
        self.root = unresolved_root.resolve()
        try:
            self.root.relative_to(self.episode_root)
        except ValueError as exc:
            raise ValueError("制作台帳の保存先がエピソードフォルダ外です") from exc
        artifact_directory = self.root / "artifacts"
        self.artifact_root = artifact_directory / "sha256"
        self.database_path = self.root / "ledger.sqlite3"
        if artifact_directory.exists() and (artifact_directory.is_symlink() or not artifact_directory.is_dir()):
            raise ValueError("制作artifactの保存先を安全に使用できません")
        if self.artifact_root.exists() and (self.artifact_root.is_symlink() or not self.artifact_root.is_dir()):
            raise ValueError("制作artifactの保存先を安全に使用できません")
        if self.database_path.exists() and (self.database_path.is_symlink() or not self.database_path.is_file()):
            raise ValueError("制作台帳databaseを安全に使用できません")
        self.artifact_root.mkdir(parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        os.chmod(artifact_directory, 0o700)
        os.chmod(self.artifact_root, 0o700)
        try:
            descriptor = os.open(self.database_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            descriptor = None
        if descriptor is not None:
            os.close(descriptor)
        if self.database_path.is_symlink() or not self.database_path.is_file():
            raise ValueError("制作台帳databaseを安全に使用できません")
        os.chmod(self.database_path, 0o600)
        self._initialize()

    @staticmethod
    def checked_id(value: object, label: str) -> str:
        if not isinstance(value, str) or not PANEL_DRAFT_ID_PATTERN.fullmatch(value):
            raise ValueError(f"{label}が正しいUUIDではありません")
        return value

    @staticmethod
    def checked_source_id(value: object, label: str, required: bool = True) -> str:
        if value in (None, "") and not required:
            return ""
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value):
            raise ValueError(f"{label}の形式が正しくありません")
        return value

    @staticmethod
    def checked_snapshot(value: object, label: str, maximum: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{label}がありません")
        if len(value.encode("utf-8")) > maximum:
            raise ValueError(f"{label}が保存上限を超えています")
        return value

    @staticmethod
    def canonical_json(value: object) -> bytes:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")

    @staticmethod
    def sanitized_error(value: BaseException | str, episode_root: Path | None = None) -> str:
        message = str(value).replace("\x00", "")
        for sensitive in (episode_root, Path.home()):
            if sensitive is not None:
                message = message.replace(str(sensitive), "<local-path>")
        message = re.sub(r"\s+", " ", message).strip()
        return message or "ローカル生成処理に失敗しました"

    @contextmanager
    def _connect(self):
        if self.database_path.is_symlink():
            raise ValueError("制作台帳databaseのsymlinkは使用できません")
        connection = sqlite3.connect(self.database_path, timeout=30)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 30000")
            connection.execute("PRAGMA journal_mode = DELETE")
            connection.execute("PRAGMA synchronous = FULL")
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            schema_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if schema_version > self.SCHEMA_VERSION:
                raise ValueError("制作台帳databaseはこのbridgeより新しいschemaです")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    series_id TEXT NOT NULL,
                    episode_id TEXT NOT NULL,
                    page_number INTEGER NOT NULL,
                    panel_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attempts (
                    attempt_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES jobs(job_id),
                    attempt_number INTEGER NOT NULL,
                    retry_of_attempt_id TEXT REFERENCES attempts(attempt_id),
                    status TEXT NOT NULL CHECK(status IN ('created','queued','succeeded','failed','outcome_unknown')),
                    prompt_id TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    submitted_at TEXT,
                    finished_at TEXT,
                    source_file_name TEXT,
                    source_subfolder TEXT,
                    download_name TEXT,
                    error_code TEXT,
                    error_message TEXT,
                    UNIQUE(job_id, attempt_number)
                );
                CREATE TABLE IF NOT EXISTS status_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
                    status TEXT NOT NULL,
                    recorded_at TEXT NOT NULL,
                    detail_json TEXT NOT NULL,
                    provenance_sha256 TEXT REFERENCES artifacts(sha256),
                    error_message TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS reviews (
                    attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id),
                    decision TEXT NOT NULL CHECK(decision IN ('unreviewed','accepted','rejected')),
                    note TEXT NOT NULL,
                    reviewed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    sha256 TEXT PRIMARY KEY,
                    relative_path TEXT NOT NULL UNIQUE,
                    byte_size INTEGER NOT NULL,
                    media_type TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attempt_artifacts (
                    attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
                    role TEXT NOT NULL,
                    sha256 TEXT NOT NULL REFERENCES artifacts(sha256),
                    PRIMARY KEY(attempt_id, role)
                );
                CREATE TABLE IF NOT EXISTS review_events (
                    review_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
                    revision INTEGER NOT NULL CHECK(revision >= 1),
                    request_nonce TEXT NOT NULL,
                    decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
                    note TEXT NOT NULL,
                    reviewed_at TEXT NOT NULL,
                    artifact_sha256 TEXT NOT NULL REFERENCES artifacts(sha256),
                    UNIQUE(attempt_id, revision),
                    UNIQUE(attempt_id, request_nonce)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS review_events_request_nonce_unique
                    ON review_events(request_nonce);
                """
            )
            status_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(status_events)").fetchall()
            }
            if "provenance_sha256" not in status_columns:
                connection.execute(
                    "ALTER TABLE status_events ADD COLUMN provenance_sha256 TEXT REFERENCES artifacts(sha256)"
                )
            if "error_message" not in status_columns:
                connection.execute(
                    "ALTER TABLE status_events ADD COLUMN error_message TEXT NOT NULL DEFAULT ''"
                )
            # v1の可変reviewはartifact完全検証とCASを経ていないため昇格しない。
            # candidate未公開の移行ではfail-closedで未確認へ戻し、旧tableは読まずに残す。
            connection.execute(f"PRAGMA user_version = {self.SCHEMA_VERSION}")
        self._backfill_status_event_provenance()
        with self._connect() as connection:
            missing_created_events = [
                row["attempt_id"] for row in connection.execute(
                    """SELECT a.attempt_id FROM attempts a
                        WHERE NOT EXISTS(SELECT 1 FROM status_events se WHERE se.attempt_id=a.attempt_id)"""
                ).fetchall()
            ]
        for attempt_id in missing_created_events:
            self._ensure_created_status_event(attempt_id)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TRIGGER IF NOT EXISTS status_events_no_update
                BEFORE UPDATE ON status_events BEGIN
                    SELECT RAISE(ABORT, 'status events are append-only');
                END;
                CREATE TRIGGER IF NOT EXISTS status_events_no_delete
                BEFORE DELETE ON status_events BEGIN
                    SELECT RAISE(ABORT, 'status events are append-only');
                END;
                CREATE TRIGGER IF NOT EXISTS review_events_no_update
                BEFORE UPDATE ON review_events BEGIN
                    SELECT RAISE(ABORT, 'review events are append-only');
                END;
                CREATE TRIGGER IF NOT EXISTS review_events_no_delete
                BEFORE DELETE ON review_events BEGIN
                    SELECT RAISE(ABORT, 'review events are append-only');
                END;
                """
            )
        os.chmod(self.database_path, 0o600)

    def _backfill_status_event_provenance(self) -> None:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT se.event_id,se.attempt_id,se.status,se.recorded_at,se.detail_json,
                       CASE WHEN se.event_id=(SELECT MAX(latest.event_id) FROM status_events latest
                                                WHERE latest.attempt_id=se.attempt_id)
                            THEN COALESCE(NULLIF(se.error_message,''),a.error_message,'')
                            ELSE se.error_message END AS recovered_error_message,
                       a.job_id,a.attempt_number,j.series_id,j.episode_id,
                       j.page_number,j.panel_id
                  FROM status_events se
                  JOIN attempts a ON a.attempt_id=se.attempt_id
                  JOIN jobs j ON j.job_id=a.job_id
                 WHERE se.provenance_sha256 IS NULL
                 ORDER BY se.event_id
                """
            ).fetchall()
        for row in rows:
            provenance = {
                "schema_version": PANEL_DRAFT_PROVENANCE_VERSION,
                "kind": "panel_draft_status_event",
                "ledger_schema_version": self.SCHEMA_VERSION,
                "event_id": row["event_id"],
                "job_id": row["job_id"],
                "attempt_id": row["attempt_id"],
                "attempt_number": row["attempt_number"],
                "status": row["status"],
                "recorded_at": row["recorded_at"],
                "source": {
                    "series_id": row["series_id"],
                    "episode_id": row["episode_id"],
                    "page_number": row["page_number"],
                    "panel_id": row["panel_id"],
                },
                "legacy_backfill": True,
            }
            recovered_error = self.sanitized_error(
                row["recovered_error_message"], self.episode_root,
            ) if row["recovered_error_message"] else ""
            if recovered_error:
                provenance["error"] = {"message": recovered_error}
            artifact = self.write_artifact(
                self.canonical_json(provenance), ".json", "application/json", MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
            )
            with self._connect() as connection:
                connection.execute(
                    """UPDATE status_events SET provenance_sha256=?,error_message=?
                        WHERE event_id=? AND provenance_sha256 IS NULL""",
                    (artifact["sha256"], recovered_error, row["event_id"]),
                )

    def _artifact_target(self, sha256: str, suffix: str) -> Path:
        if suffix not in self.ARTIFACT_SUFFIXES or not re.fullmatch(r"[a-f0-9]{64}", sha256):
            raise ValueError("制作artifactの識別情報が正しくありません")
        directory = self.artifact_root / sha256[:2]
        if directory.exists() and (directory.is_symlink() or not directory.is_dir()):
            raise ValueError("制作artifactの保存先を安全に使用できません")
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
        target = directory / f"{sha256}{suffix}"
        try:
            target.parent.resolve().relative_to(self.root)
        except ValueError as exc:
            raise ValueError("制作artifactの保存先が台帳外です") from exc
        return target

    def _checked_artifact_path(self, relative_path: object) -> Path:
        if not isinstance(relative_path, str) or not relative_path or "\\" in relative_path:
            raise ValueError("制作artifactの保存場所が正しくありません")
        relative = PurePosixPath(relative_path)
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise ValueError("制作artifactの保存場所が正しくありません")
        candidate = self.root
        for part in relative.parts:
            candidate /= part
            if candidate.is_symlink():
                raise ValueError("制作artifactのsymlinkは使用できません")
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("制作artifactが台帳外を参照しています") from exc
        if not resolved.is_file():
            raise ValueError("制作artifactを安全に読み取れません")
        return resolved

    def write_artifact(self, data: bytes, suffix: str, media_type: str, maximum: int) -> dict[str, Any]:
        if not data or len(data) > maximum:
            raise ValueError("制作artifactが空か保存上限を超えています")
        sha256 = hashlib.sha256(data).hexdigest()
        if suffix == ".yaml":
            # The ledger identifies artifacts by content hash, not by filename.
            # Reuse a verified legacy row without rewriting its immutable bytes.
            with self._connect() as connection:
                legacy = connection.execute(
                    "SELECT relative_path, byte_size, media_type FROM artifacts WHERE sha256 = ?",
                    (sha256,),
                ).fetchone()
            if legacy is not None and legacy["relative_path"] == f"artifacts/sha256/{sha256[:2]}/{sha256}.omny.yaml":
                target = self._checked_artifact_path(legacy["relative_path"])
                with target.open("rb") as handle:
                    existing = handle.read(maximum + 1)
                if (legacy["byte_size"] != len(data) or legacy["media_type"] != media_type
                        or existing != data):
                    raise ValueError("保存済み制作artifactの整合性が壊れています")
                return self.artifact_metadata(sha256)
        target = self._artifact_target(sha256, suffix)
        if target.is_symlink():
            raise ValueError("制作artifactのsymlinkは使用できません")
        if target.exists():
            if not target.is_file():
                raise ValueError("制作artifactの保存先を安全に使用できません")
            existing = target.read_bytes()
            if len(existing) != len(data) or hashlib.sha256(existing).hexdigest() != sha256:
                raise ValueError("保存済み制作artifactの整合性が壊れています")
        else:
            with tempfile.NamedTemporaryFile("wb", dir=target.parent, delete=False) as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
                temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
        os.chmod(target, 0o600)
        relative_path = target.relative_to(self.root).as_posix()
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO artifacts(sha256, relative_path, byte_size, media_type, created_at) VALUES(?,?,?,?,?)",
                (sha256, relative_path, len(data), media_type, now),
            )
            stored = connection.execute(
                "SELECT relative_path, byte_size, media_type FROM artifacts WHERE sha256 = ?",
                (sha256,),
            ).fetchone()
            if (
                stored is None
                or stored["relative_path"] != relative_path
                or stored["byte_size"] != len(data)
                or stored["media_type"] != media_type
            ):
                raise ValueError("制作artifact台帳の整合性を確認できません")
        return self.artifact_metadata(sha256)

    def artifact_metadata(self, sha256: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT sha256, relative_path, byte_size, media_type FROM artifacts WHERE sha256 = ?",
                (sha256,),
            ).fetchone()
        if row is None:
            raise ValueError("制作artifactが台帳にありません")
        target = self._checked_artifact_path(row["relative_path"])
        return {
            "sha256": row["sha256"],
            "byte_size": row["byte_size"],
            "media_type": row["media_type"],
            "workspace_relative_path": target.relative_to(self.episode_root).as_posix(),
        }

    def read_attempt_artifact(self, attempt_id_value: object, role: str, maximum: int) -> bytes:
        attempt_id = self.checked_id(attempt_id_value, "attempt ID")
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", role):
            raise ValueError("制作artifact roleが正しくありません")
        with self._connect() as connection:
            row = connection.execute(
                """SELECT ar.sha256, ar.relative_path, ar.byte_size
                     FROM attempt_artifacts aa JOIN artifacts ar ON ar.sha256=aa.sha256
                    WHERE aa.attempt_id=? AND aa.role=?""",
                (attempt_id, role),
            ).fetchone()
        if row is None:
            raise ValueError("制作attemptに必要なartifactがありません")
        target = self._checked_artifact_path(row["relative_path"])
        with target.open("rb") as handle:
            data = handle.read(maximum + 1)
        if len(data) != row["byte_size"] or len(data) > maximum:
            raise ValueError("制作artifactのサイズが台帳と一致しません")
        if hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise ValueError("制作artifactのSHA-256が台帳と一致しません")
        return data

    @staticmethod
    def checked_sha256(value: object, label: str) -> str:
        if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
            raise ValueError(f"{label}が正しくありません")
        return value

    def _artifact_from_row(self, row: sqlite3.Row, prefix: str = "") -> dict[str, Any]:
        target = self._checked_artifact_path(row[f"{prefix}relative_path"])
        return {
            "sha256": row[f"{prefix}sha256"],
            "byte_size": row[f"{prefix}byte_size"],
            "media_type": row[f"{prefix}media_type"],
            "workspace_relative_path": target.relative_to(self.episode_root).as_posix(),
        }

    def _read_artifact_row(self, row: sqlite3.Row, prefix: str, maximum: int) -> tuple[bytes, dict[str, Any]]:
        metadata = self._artifact_from_row(row, prefix)
        target = self._checked_artifact_path(row[f"{prefix}relative_path"])
        with target.open("rb") as handle:
            data = handle.read(maximum + 1)
        if len(data) != metadata["byte_size"] or len(data) > maximum:
            raise ValueError("制作artifactのサイズが台帳と一致しません")
        if hashlib.sha256(data).hexdigest() != metadata["sha256"]:
            raise ValueError("制作artifactのSHA-256が台帳と一致しません")
        return data, metadata

    @staticmethod
    def _event_provenance(
        provenance: dict[str, Any] | None,
        *,
        job_id: str,
        attempt_id: str,
        attempt_number: int,
        status: str,
        recorded_at: str,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        result = dict(provenance or {})
        result.update({
            "schema_version": PANEL_DRAFT_PROVENANCE_VERSION,
            "kind": "panel_draft_status_event",
            "ledger_schema_version": PANEL_DRAFT_LEDGER_SCHEMA_VERSION,
            "job_id": job_id,
            "attempt_id": attempt_id,
            "attempt_number": attempt_number,
            "status": status,
            "recorded_at": recorded_at,
        })
        if error_code or error_message:
            result["error"] = {"code": error_code or "unknown", "message": error_message or ""}
        else:
            result.pop("error", None)
        return result

    def _audit_events_for(self, connection: sqlite3.Connection, attempt_id: str) -> list[dict[str, Any]]:
        rows = connection.execute(
            """
            SELECT se.event_id,se.status,se.recorded_at,se.detail_json,se.error_message,
                   ar.sha256 AS provenance_sha256,ar.relative_path AS provenance_relative_path,
                   ar.byte_size AS provenance_byte_size,ar.media_type AS provenance_media_type
              FROM status_events se
              JOIN artifacts ar ON ar.sha256=se.provenance_sha256
             WHERE se.attempt_id=? ORDER BY se.event_id
            """,
            (attempt_id,),
        ).fetchall()
        events: list[dict[str, Any]] = []
        for row in rows:
            try:
                detail = json.loads(row["detail_json"])
            except json.JSONDecodeError as exc:
                raise ValueError("制作status eventの詳細が壊れています") from exc
            if not isinstance(detail, dict):
                raise ValueError("制作status eventの詳細が正しくありません")
            provenance_bytes, provenance_metadata = self._read_artifact_row(
                row, "provenance_", MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
            )
            try:
                provenance_value = json.loads(provenance_bytes.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("制作status eventのprovenanceが壊れています") from exc
            if not isinstance(provenance_value, dict):
                raise ValueError("制作status eventのprovenance形式が正しくありません")
            events.append({
                "event_id": row["event_id"],
                "status": row["status"],
                "recorded_at": row["recorded_at"],
                "detail": detail,
                "error_message": row["error_message"],
                "provenance_sha256": row["provenance_sha256"],
                "provenance": provenance_metadata,
                "provenance_verified": True,
            })
        return events

    def _ensure_created_status_event(self, attempt_id: str) -> None:
        record = self.attempt(attempt_id)
        if record["audit_events"]:
            return
        recorded_at = record["created_at"]
        provenance = self._event_provenance(
            {
                "source": {
                    "series_id": record["series_id"],
                    "episode_id": record["episode_id"],
                    "page_number": record["page_number"],
                    "panel_id": record["panel_id"],
                },
                "inputs": {
                    role: artifact for role, artifact in record["artifacts"].items()
                    if role in {"omny_snapshot", "plan_snapshot", "workflow_snapshot"}
                },
                "policy": {"automatic_retry": False, "automatic_review_acceptance": False},
            },
            job_id=record["job_id"],
            attempt_id=record["attempt_id"],
            attempt_number=record["attempt_number"],
            status="created",
            recorded_at=recorded_at,
        )
        provenance_artifact = self.write_artifact(
            self.canonical_json(provenance), ".json", "application/json", MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
        )
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            exists = connection.execute(
                "SELECT 1 FROM status_events WHERE attempt_id=? LIMIT 1", (attempt_id,)
            ).fetchone()
            if exists is None:
                connection.execute(
                    """INSERT INTO status_events(
                           attempt_id,status,recorded_at,detail_json,provenance_sha256,error_message
                       ) VALUES(?,?,?,?,?,?)""",
                    (attempt_id, "created", recorded_at, "{}", provenance_artifact["sha256"], ""),
                )

    def begin_attempt(
        self,
        *,
        job_id: str,
        attempt_id: str,
        retry_of_attempt_id: str | None,
        series_id: str,
        episode_id: str,
        page_number: int,
        panel_id: int,
        omny_snapshot: str,
        plan_snapshot: dict[str, Any],
        workflow_snapshot: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        omny = self.write_artifact(omny_snapshot.encode("utf-8"), ".yaml", "application/yaml", MAX_PANEL_DRAFT_OMNY_BYTES)
        plan_bytes = self.canonical_json(plan_snapshot)
        workflow_bytes = self.canonical_json(workflow_snapshot)
        plan = self.write_artifact(plan_bytes, ".json", "application/json", MAX_PANEL_DRAFT_SNAPSHOT_BYTES)
        workflow = self.write_artifact(workflow_bytes, ".json", "application/json", MAX_PANEL_DRAFT_SNAPSHOT_BYTES)
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing_attempt = connection.execute(
                """
                SELECT a.attempt_id, a.job_id, a.retry_of_attempt_id,
                       j.series_id, j.episode_id, j.page_number, j.panel_id,
                       MAX(CASE WHEN aa.role='omny_snapshot' THEN aa.sha256 END) AS omny_sha256,
                       MAX(CASE WHEN aa.role='plan_snapshot' THEN aa.sha256 END) AS plan_sha256,
                       MAX(CASE WHEN aa.role='workflow_snapshot' THEN aa.sha256 END) AS workflow_sha256
                  FROM attempts a JOIN jobs j ON j.job_id=a.job_id
                  LEFT JOIN attempt_artifacts aa ON aa.attempt_id=a.attempt_id
                 WHERE a.attempt_id=? GROUP BY a.attempt_id
                """,
                (attempt_id,),
            ).fetchone()
            if existing_attempt is not None:
                expected = (
                    job_id, retry_of_attempt_id, series_id, episode_id, page_number, panel_id,
                    omny["sha256"], plan["sha256"], workflow["sha256"],
                )
                actual = (
                    existing_attempt["job_id"], existing_attempt["retry_of_attempt_id"],
                    existing_attempt["series_id"], existing_attempt["episode_id"],
                    existing_attempt["page_number"], existing_attempt["panel_id"], existing_attempt["omny_sha256"],
                    existing_attempt["plan_sha256"], existing_attempt["workflow_sha256"],
                )
                if actual != expected:
                    raise ValueError("同じattempt IDへ異なる生成内容を送ることはできません")
                connection.commit()
                self._ensure_created_status_event(attempt_id)
                return self.attempt(attempt_id), False

            job = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if job is None:
                if retry_of_attempt_id is not None:
                    raise ValueError("最初のattemptにretry元は指定できません")
                connection.execute(
                    "INSERT INTO jobs(job_id,series_id,episode_id,page_number,panel_id,created_at) VALUES(?,?,?,?,?,?)",
                    (job_id, series_id, episode_id, page_number, panel_id, now),
                )
                attempt_number = 1
            else:
                if (job["series_id"], job["episode_id"], job["page_number"], job["panel_id"]) != (
                    series_id, episode_id, page_number, panel_id,
                ):
                    raise ValueError("同じjob IDを別の作品またはコマへ使用できません")
                previous = connection.execute(
                    "SELECT attempt_id FROM attempts WHERE attempt_id=? AND job_id=?",
                    (retry_of_attempt_id, job_id),
                ).fetchone()
                if previous is None:
                    raise ValueError("retry元attemptが同じjobにありません")
                attempt_number = int(connection.execute(
                    "SELECT COALESCE(MAX(attempt_number),0)+1 FROM attempts WHERE job_id=?", (job_id,)
                ).fetchone()[0])

            connection.execute(
                """INSERT INTO attempts(
                       attempt_id,job_id,attempt_number,retry_of_attempt_id,status,prompt_id,created_at
                   ) VALUES(?,?,?,?,?,?,?)""",
                (attempt_id, job_id, attempt_number, retry_of_attempt_id, "created", attempt_id, now),
            )
            for role, artifact in (
                ("omny_snapshot", omny), ("plan_snapshot", plan), ("workflow_snapshot", workflow),
            ):
                connection.execute(
                    "INSERT INTO attempt_artifacts(attempt_id,role,sha256) VALUES(?,?,?)",
                    (attempt_id, role, artifact["sha256"]),
                )
        self._ensure_created_status_event(attempt_id)
        return self.attempt(attempt_id), True

    def _artifacts_for(self, connection: sqlite3.Connection, attempt_id: str) -> dict[str, dict[str, Any]]:
        rows = connection.execute(
            """SELECT aa.role, ar.sha256, ar.relative_path, ar.byte_size, ar.media_type
                 FROM attempt_artifacts aa JOIN artifacts ar ON ar.sha256=aa.sha256
                WHERE aa.attempt_id=? ORDER BY aa.role""",
            (attempt_id,),
        ).fetchall()
        artifacts: dict[str, dict[str, Any]] = {}
        for row in rows:
            target = self._checked_artifact_path(row["relative_path"])
            artifacts[row["role"]] = {
                "sha256": row["sha256"],
                "byte_size": row["byte_size"],
                "media_type": row["media_type"],
                "workspace_relative_path": target.relative_to(self.episode_root).as_posix(),
            }
        return artifacts

    def attempt(self, attempt_id_value: object) -> dict[str, Any]:
        attempt_id = self.checked_id(attempt_id_value, "attempt ID")
        with self._connect() as connection:
            row = connection.execute(
                """SELECT a.*, j.series_id, j.episode_id, j.page_number, j.panel_id,
                          r.review_event_id,r.revision,r.request_nonce,r.decision,r.note,
                          r.reviewed_at,r.artifact_sha256 AS review_artifact_sha256
                     FROM attempts a JOIN jobs j ON j.job_id=a.job_id
                     LEFT JOIN review_events r ON r.attempt_id=a.attempt_id
                          AND r.revision=(SELECT MAX(latest.revision) FROM review_events latest
                                           WHERE latest.attempt_id=a.attempt_id)
                    WHERE a.attempt_id=?""",
                (attempt_id,),
            ).fetchone()
            if row is None:
                raise ValueError("制作attemptが見つかりません")
            artifacts = self._artifacts_for(connection, attempt_id)
            audit_events = self._audit_events_for(connection, attempt_id)
        review = {
            "decision": row["decision"] or "unreviewed",
            "note": row["note"] or "",
            "reviewed_at": row["reviewed_at"],
            "revision": row["revision"] or 0,
            "review_event_id": row["review_event_id"],
            "request_nonce": row["request_nonce"],
            "artifact_sha256": row["review_artifact_sha256"],
        }
        return {
            "job_id": row["job_id"],
            "attempt_id": row["attempt_id"],
            "attempt_number": row["attempt_number"],
            "retry_of_attempt_id": row["retry_of_attempt_id"],
            "prompt_id": row["prompt_id"],
            "status": row["status"],
            "series_id": row["series_id"],
            "episode_id": row["episode_id"],
            "page_number": row["page_number"],
            "panel_id": row["panel_id"],
            "created_at": row["created_at"],
            "submitted_at": row["submitted_at"],
            "finished_at": row["finished_at"],
            "source_file_name": row["source_file_name"],
            "source_subfolder": row["source_subfolder"],
            "download_name": row["download_name"],
            "error": ({"code": row["error_code"], "message": row["error_message"]} if row["error_code"] else None),
            "review": review,
            "artifacts": artifacts,
            "audit_events": audit_events,
        }

    def list_attempts(self, page_number: int, panel_id: int, limit: int = 20) -> list[dict[str, Any]]:
        if page_number < 1 or panel_id < 1:
            raise ValueError("ページ番号またはコマ番号が正しくありません")
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT a.attempt_id FROM attempts a JOIN jobs j ON j.job_id=a.job_id
                    WHERE j.page_number=? AND j.panel_id=?
                    ORDER BY a.created_at DESC, a.attempt_number DESC LIMIT ?""",
                (page_number, panel_id, max(1, min(limit, 100))),
            ).fetchall()
        return [self.attempt(row["attempt_id"]) for row in rows]

    def set_status(
        self,
        attempt_id_value: object,
        status: str,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
        provenance: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        attempt_id = self.checked_id(attempt_id_value, "attempt ID")
        if status not in PANEL_DRAFT_STATUS_VALUES:
            raise ValueError("制作attemptの状態が正しくありません")
        record = self.attempt(attempt_id)
        clean_error = self.sanitized_error(error_message, self.episode_root) if error_message else ""
        now = datetime.now(timezone.utc).isoformat()
        event_provenance = self._event_provenance(
            provenance,
            job_id=record["job_id"],
            attempt_id=attempt_id,
            attempt_number=record["attempt_number"],
            status=status,
            recorded_at=now,
            error_code=error_code,
            error_message=clean_error or None,
        )
        provenance_artifact = self.write_artifact(
            self.canonical_json(event_provenance), ".json", "application/json", MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
        )
        transitions = {
            "created": {"created", "queued", "failed", "outcome_unknown"},
            "queued": {"queued", "succeeded", "failed", "outcome_unknown"},
            "outcome_unknown": {"outcome_unknown", "queued", "succeeded", "failed"},
            "succeeded": {"succeeded"},
            "failed": {"failed"},
        }
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute("SELECT status FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
            if current is None:
                raise ValueError("制作attemptが見つかりません")
            if status not in transitions[current["status"]]:
                raise ValueError("制作attemptを不正な状態へ変更できません")
            submitted_at = now if status == "queued" else None
            finished_at = now if status in {"succeeded", "failed"} else None
            connection.execute(
                """UPDATE attempts SET status=?,
                       submitted_at=COALESCE(submitted_at,?), finished_at=COALESCE(?,finished_at),
                       error_code=?, error_message=? WHERE attempt_id=?""",
                (status, submitted_at, finished_at, error_code, clean_error or None, attempt_id),
            )
            connection.execute(
                """INSERT INTO attempt_artifacts(attempt_id,role,sha256) VALUES(?,?,?)
                   ON CONFLICT(attempt_id,role) DO UPDATE SET sha256=excluded.sha256""",
                (attempt_id, "provenance", provenance_artifact["sha256"]),
            )
            detail = self.canonical_json({"error_code": error_code} if error_code else {}).decode("utf-8")
            connection.execute(
                """INSERT INTO status_events(
                       attempt_id,status,recorded_at,detail_json,provenance_sha256,error_message
                   ) VALUES(?,?,?,?,?,?)""",
                (attempt_id, status, now, detail, provenance_artifact["sha256"], clean_error),
            )
        return self.attempt(attempt_id)

    def complete_success(
        self,
        attempt_id_value: object,
        *,
        original_png: bytes,
        manga_base_png: bytes,
        source_file_name: str,
        source_subfolder: str,
        download_name: str,
        provenance: dict[str, Any],
        recovering_created_from_history: bool = False,
    ) -> dict[str, Any]:
        attempt_id = self.checked_id(attempt_id_value, "attempt ID")
        ComfyUIDraftGenerator.validate_png_bytes(original_png)
        ComfyUIDraftGenerator.validate_png_bytes(manga_base_png, require_manga_base=True)
        original = self.write_artifact(original_png, ".png", "image/png", MAX_COMFY_IMAGE_BYTES)
        composite = self.write_artifact(manga_base_png, ".png", "image/png", MAX_COMFY_IMAGE_BYTES)
        record = self.attempt(attempt_id)
        now = datetime.now(timezone.utc).isoformat()
        complete_provenance = {
            **provenance,
            "status": "succeeded",
            "recorded_at": now,
            "outputs": {
                "original_comfy_output": original,
                "manga_base_composite": composite,
            },
        }
        complete_provenance = self._event_provenance(
            complete_provenance,
            job_id=record["job_id"],
            attempt_id=attempt_id,
            attempt_number=record["attempt_number"],
            status="succeeded",
            recorded_at=now,
        )
        provenance_artifact = self.write_artifact(
            self.canonical_json(complete_provenance), ".json", "application/json", MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
        )
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute("SELECT status FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
            if current is None:
                raise ValueError("制作attemptが見つかりません")
            if current["status"] == "succeeded":
                stored = connection.execute(
                    """SELECT role,sha256 FROM attempt_artifacts
                        WHERE attempt_id=? AND role IN ('original_comfy_output','manga_base_composite')""",
                    (attempt_id,),
                ).fetchall()
                expected = {
                    "original_comfy_output": original["sha256"],
                    "manga_base_composite": composite["sha256"],
                }
                if {row["role"]: row["sha256"] for row in stored} != expected:
                    raise ValueError("成功済みattemptへ異なる生成結果を保存できません")
                connection.commit()
                return self.attempt(attempt_id)
            if current["status"] not in {"queued", "outcome_unknown"} \
                    and not (current["status"] == "created" and recovering_created_from_history):
                raise ValueError("完了済みでないattemptへ生成結果を保存できません")
            for role, artifact in (
                ("original_comfy_output", original),
                ("manga_base_composite", composite),
                ("provenance", provenance_artifact),
            ):
                connection.execute(
                    """INSERT INTO attempt_artifacts(attempt_id,role,sha256) VALUES(?,?,?)
                       ON CONFLICT(attempt_id,role) DO UPDATE SET sha256=excluded.sha256""",
                    (attempt_id, role, artifact["sha256"]),
                )
            connection.execute(
                """UPDATE attempts SET status='succeeded', submitted_at=COALESCE(submitted_at,created_at),
                       finished_at=?, source_file_name=?,
                       source_subfolder=?, download_name=?, error_code=NULL, error_message=NULL WHERE attempt_id=?""",
                (now, source_file_name, source_subfolder, download_name, attempt_id),
            )
            connection.execute(
                """INSERT INTO status_events(
                       attempt_id,status,recorded_at,detail_json,provenance_sha256,error_message
                   ) VALUES(?,?,?,?,?,?)""",
                (attempt_id, "succeeded", now, "{}", provenance_artifact["sha256"], ""),
            )
        return self.attempt(attempt_id)

    def set_review(
        self,
        attempt_id_value: object,
        decision_value: object,
        *,
        expected_revision_value: object,
        request_nonce_value: object,
        artifact_sha256_value: object,
        note_value: object = "",
    ) -> dict[str, Any]:
        attempt_id = self.checked_id(attempt_id_value, "attempt ID")
        if not isinstance(decision_value, str) or decision_value not in PANEL_DRAFT_REVIEW_VALUES:
            raise ValueError("レビュー結果が正しくありません")
        if isinstance(expected_revision_value, bool) or not isinstance(expected_revision_value, int) or expected_revision_value < 0:
            raise ValueError("レビューrevisionが正しくありません")
        request_nonce = self.checked_id(request_nonce_value, "review request nonce")
        artifact_sha256 = self.checked_sha256(artifact_sha256_value, "review対象artifact SHA-256")
        if note_value is not None and not isinstance(note_value, str):
            raise ValueError("レビューメモの形式が正しくありません")
        note = (note_value or "").strip()
        if len(note.encode("utf-8")) > 2000:
            raise ValueError("レビューメモが長すぎます")
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            duplicate = connection.execute(
                """SELECT attempt_id,revision,decision,note,artifact_sha256 FROM review_events
                    WHERE request_nonce=?""",
                (request_nonce,),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["attempt_id"] != attempt_id
                    or
                    duplicate["revision"] != expected_revision_value + 1
                    or duplicate["decision"] != decision_value
                    or duplicate["note"] != note
                    or duplicate["artifact_sha256"] != artifact_sha256
                ):
                    raise ValueError("同じreview request nonceを異なる内容へ再利用できません")
                connection.commit()
                return self.attempt(attempt_id)

            row = connection.execute(
                """
                SELECT a.status,COALESCE(MAX(re.revision),0) AS current_revision,
                       ar.sha256 AS artifact_sha256,ar.relative_path AS artifact_relative_path,
                       ar.byte_size AS artifact_byte_size,ar.media_type AS artifact_media_type
                  FROM attempts a
                  LEFT JOIN review_events re ON re.attempt_id=a.attempt_id
                  LEFT JOIN attempt_artifacts aa ON aa.attempt_id=a.attempt_id
                                                AND aa.role='manga_base_composite'
                  LEFT JOIN artifacts ar ON ar.sha256=aa.sha256
                 WHERE a.attempt_id=?
                 GROUP BY a.attempt_id,ar.sha256,ar.relative_path,ar.byte_size,ar.media_type
                """,
                (attempt_id,),
            ).fetchone()
            if row is None:
                raise ValueError("制作attemptが見つかりません")
            if row["status"] != "succeeded" or row["artifact_sha256"] != artifact_sha256:
                raise ValueError("成功済みattemptの検証済み4値artifactだけをレビューできます")
            if row["current_revision"] != expected_revision_value:
                raise ValueError("レビューが別の操作で更新されました。履歴を再読込してください")
            if row["artifact_media_type"] != "image/png":
                raise ValueError("review対象4値artifactのmedia typeが正しくありません")
            data, _ = self._read_artifact_row(row, "artifact_", MAX_COMFY_IMAGE_BYTES)
            ComfyUIDraftGenerator.validate_png_bytes(data, require_manga_base=True)
            connection.execute(
                """INSERT INTO review_events(
                       attempt_id,revision,request_nonce,decision,note,reviewed_at,artifact_sha256
                   ) VALUES(?,?,?,?,?,?,?)""",
                (
                    attempt_id, expected_revision_value + 1, request_nonce,
                    decision_value, note, now, artifact_sha256,
                ),
            )
        return self.attempt(attempt_id)

    def resolve_succeeded_artifact(
        self,
        job_id_value: object,
        attempt_id_value: object,
        artifact_sha256_value: object,
        *,
        expected_omny_sha256: object,
        expected_plan_sha256: object,
        expected_workflow_sha256: object,
        role: str = "manga_base_composite",
    ) -> dict[str, Any]:
        job_id = self.checked_id(job_id_value, "job ID")
        attempt_id = self.checked_id(attempt_id_value, "attempt ID")
        if role != "manga_base_composite":
            raise ValueError("後工程へ渡せるartifact roleではありません")
        artifact_sha256 = self.checked_sha256(artifact_sha256_value, "artifact SHA-256")
        omny_sha256 = self.checked_sha256(expected_omny_sha256, "OMNY snapshot SHA-256")
        plan_sha256 = self.checked_sha256(expected_plan_sha256, "plan snapshot SHA-256")
        workflow_sha256 = self.checked_sha256(expected_workflow_sha256, "workflow snapshot SHA-256")
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT output.sha256 AS output_sha256,output.relative_path AS output_relative_path,
                       output.byte_size AS output_byte_size,output.media_type AS output_media_type,
                       omny.sha256 AS omny_sha256,omny.relative_path AS omny_relative_path,
                       omny.byte_size AS omny_byte_size,omny.media_type AS omny_media_type,
                       plan.sha256 AS plan_sha256,plan.relative_path AS plan_relative_path,
                       plan.byte_size AS plan_byte_size,plan.media_type AS plan_media_type,
                       workflow.sha256 AS workflow_sha256,workflow.relative_path AS workflow_relative_path,
                       workflow.byte_size AS workflow_byte_size,workflow.media_type AS workflow_media_type
                  FROM attempts a
                  JOIN attempt_artifacts output_link ON output_link.attempt_id=a.attempt_id
                       AND output_link.role='manga_base_composite' AND output_link.sha256=?
                  JOIN artifacts output ON output.sha256=output_link.sha256
                  JOIN attempt_artifacts omny_link ON omny_link.attempt_id=a.attempt_id
                       AND omny_link.role='omny_snapshot' AND omny_link.sha256=?
                  JOIN artifacts omny ON omny.sha256=omny_link.sha256
                  JOIN attempt_artifacts plan_link ON plan_link.attempt_id=a.attempt_id
                       AND plan_link.role='plan_snapshot' AND plan_link.sha256=?
                  JOIN artifacts plan ON plan.sha256=plan_link.sha256
                  JOIN attempt_artifacts workflow_link ON workflow_link.attempt_id=a.attempt_id
                       AND workflow_link.role='workflow_snapshot' AND workflow_link.sha256=?
                  JOIN artifacts workflow ON workflow.sha256=workflow_link.sha256
                    WHERE a.job_id=? AND a.attempt_id=? AND a.status='succeeded'
                """,
                (artifact_sha256, omny_sha256, plan_sha256, workflow_sha256, job_id, attempt_id),
            ).fetchone()
        if row is None:
            raise ValueError("成功済みattemptと入力snapshotに一致する検証bundleがありません")
        if row["output_media_type"] != "image/png":
            raise ValueError("作画用4値artifactのmedia typeが正しくありません")
        if row["omny_media_type"] != "application/yaml" or row["plan_media_type"] != "application/json" \
                or row["workflow_media_type"] != "application/json":
            raise ValueError("入力snapshot bundleのmedia typeが正しくありません")
        output_bytes, output_metadata = self._read_artifact_row(row, "output_", MAX_COMFY_IMAGE_BYTES)
        omny_bytes, omny_metadata = self._read_artifact_row(row, "omny_", MAX_PANEL_DRAFT_OMNY_BYTES)
        plan_bytes, plan_metadata = self._read_artifact_row(row, "plan_", MAX_PANEL_DRAFT_SNAPSHOT_BYTES)
        workflow_bytes, workflow_metadata = self._read_artifact_row(row, "workflow_", MAX_PANEL_DRAFT_SNAPSHOT_BYTES)
        ComfyUIDraftGenerator.validate_png_bytes(output_bytes, require_manga_base=True)
        verified_bundle = {
            "manga_base_composite": {**output_metadata, "bytes": output_bytes},
            "omny_snapshot": {**omny_metadata, "bytes": omny_bytes},
            "plan_snapshot": {**plan_metadata, "bytes": plan_bytes},
            "workflow_snapshot": {**workflow_metadata, "bytes": workflow_bytes},
        }
        return {
            "bytes": output_bytes,
            "job_id": job_id,
            "attempt_id": attempt_id,
            "role": role,
            "sha256": artifact_sha256,
            "byte_size": len(output_bytes),
            "media_type": row["output_media_type"],
            "source_snapshot_sha256": omny_sha256,
            "verified_bundle": verified_bundle,
        }
