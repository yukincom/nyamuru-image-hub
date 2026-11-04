"""Record draft attempt transitions, evidence and review events in the current ledger."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any
from nyamuru_comfy_draft import MAX_COMFY_IMAGE_BYTES, ComfyUIDraftGenerator

from draft_ledger_artifacts import (
    MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
    PANEL_DRAFT_STATUS_VALUES,
    PANEL_DRAFT_REVIEW_VALUES,
    PANEL_DRAFT_LEDGER_SCHEMA_VERSION,
    PANEL_DRAFT_PROVENANCE_VERSION,
)


class DraftLedgerEvents:
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
