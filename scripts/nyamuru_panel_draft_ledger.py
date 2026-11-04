"""Episode-local panel draft ledger and immutable artifact storage."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from nyamuru_comfy_draft import PANEL_DRAFT_ID_PATTERN

from draft_ledger_artifacts import (
    MAX_PANEL_DRAFT_OMNY_BYTES,
    MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
    PANEL_DRAFT_STATUS_VALUES,
    PANEL_DRAFT_REVIEW_VALUES,
    PANEL_DRAFT_LEDGER_SCHEMA_VERSION,
    PANEL_DRAFT_PROVENANCE_VERSION,
    DraftLedgerArtifacts,
)
from draft_ledger_events import DraftLedgerEvents


class PanelDraftLedger(DraftLedgerArtifacts, DraftLedgerEvents):
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
