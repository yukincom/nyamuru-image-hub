"""Store immutable artifacts and read the verified data and snapshots for a draft attempt."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from nyamuru_comfy_draft import MAX_COMFY_IMAGE_BYTES, ComfyUIDraftGenerator


MAX_PANEL_DRAFT_OMNY_BYTES = 5 * 1024 * 1024
MAX_PANEL_DRAFT_SNAPSHOT_BYTES = 2 * 1024 * 1024
PANEL_DRAFT_STATUS_VALUES = {"created", "queued", "succeeded", "failed", "outcome_unknown"}
PANEL_DRAFT_REVIEW_VALUES = {"accepted", "rejected"}
PANEL_DRAFT_LEDGER_SCHEMA_VERSION = 2
PANEL_DRAFT_PROVENANCE_VERSION = 2

class DraftLedgerArtifacts:
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
