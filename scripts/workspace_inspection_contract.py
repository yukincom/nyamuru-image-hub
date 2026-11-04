"""File identity, report fields and storage contracts inspected by the workspace doctor."""

from __future__ import annotations

from collections.abc import Callable, Mapping
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath
from typing import Any


REPORT_SCHEMA_VERSION = 1
REPORT_KIND = "nyamuru-workspace-doctor-report"
SNAPSHOT_ALGORITHM = "sha256"
MANAGED_EPISODE_DIRECTORIES = ("name_data", "draft_data", "manuscript_data", "export_data")
DEFAULT_SERIES_ROOT = (
    Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "series-common"
)
LEDGER_RELATIVE_PATH = "draft_data/nyamuru/ledger.sqlite3"
LEDGER_SCHEMA_VERSION = 2
LEDGER_REQUIRED_TABLES = {
    "jobs",
    "attempts",
    "status_events",
    "reviews",
    "artifacts",
    "attempt_artifacts",
    "review_events",
}
LEDGER_REQUIRED_TRIGGERS = {
    "status_events_no_update",
    "status_events_no_delete",
    "review_events_no_update",
    "review_events_no_delete",
}
LEDGER_COLUMN_CONTRACTS: dict[str, tuple[tuple[str, str, int, int], ...]] = {
    "jobs": (
        ("job_id", "TEXT", 0, 1),
        ("series_id", "TEXT", 1, 0),
        ("episode_id", "TEXT", 1, 0),
        ("page_number", "INTEGER", 1, 0),
        ("panel_id", "INTEGER", 1, 0),
        ("created_at", "TEXT", 1, 0),
    ),
    "attempts": (
        ("attempt_id", "TEXT", 0, 1),
        ("job_id", "TEXT", 1, 0),
        ("attempt_number", "INTEGER", 1, 0),
        ("retry_of_attempt_id", "TEXT", 0, 0),
        ("status", "TEXT", 1, 0),
        ("prompt_id", "TEXT", 1, 0),
        ("created_at", "TEXT", 1, 0),
        ("submitted_at", "TEXT", 0, 0),
        ("finished_at", "TEXT", 0, 0),
        ("source_file_name", "TEXT", 0, 0),
        ("source_subfolder", "TEXT", 0, 0),
        ("download_name", "TEXT", 0, 0),
        ("error_code", "TEXT", 0, 0),
        ("error_message", "TEXT", 0, 0),
    ),
    "status_events": (
        ("event_id", "INTEGER", 0, 1),
        ("attempt_id", "TEXT", 1, 0),
        ("status", "TEXT", 1, 0),
        ("recorded_at", "TEXT", 1, 0),
        ("detail_json", "TEXT", 1, 0),
        ("provenance_sha256", "TEXT", 0, 0),
        ("error_message", "TEXT", 1, 0),
    ),
    "reviews": (
        ("attempt_id", "TEXT", 0, 1),
        ("decision", "TEXT", 1, 0),
        ("note", "TEXT", 1, 0),
        ("reviewed_at", "TEXT", 0, 0),
    ),
    "artifacts": (
        ("sha256", "TEXT", 0, 1),
        ("relative_path", "TEXT", 1, 0),
        ("byte_size", "INTEGER", 1, 0),
        ("media_type", "TEXT", 1, 0),
        ("created_at", "TEXT", 1, 0),
    ),
    "attempt_artifacts": (
        ("attempt_id", "TEXT", 1, 1),
        ("role", "TEXT", 1, 2),
        ("sha256", "TEXT", 1, 0),
    ),
    "review_events": (
        ("review_event_id", "INTEGER", 0, 1),
        ("attempt_id", "TEXT", 1, 0),
        ("revision", "INTEGER", 1, 0),
        ("request_nonce", "TEXT", 1, 0),
        ("decision", "TEXT", 1, 0),
        ("note", "TEXT", 1, 0),
        ("reviewed_at", "TEXT", 1, 0),
        ("artifact_sha256", "TEXT", 1, 0),
    ),
}
LEDGER_FOREIGN_KEY_CONTRACTS: dict[str, set[tuple[str, str, str]]] = {
    "jobs": set(),
    "attempts": {("job_id", "jobs", "job_id"), ("retry_of_attempt_id", "attempts", "attempt_id")},
    "status_events": {
        ("attempt_id", "attempts", "attempt_id"),
        ("provenance_sha256", "artifacts", "sha256"),
    },
    "reviews": {("attempt_id", "attempts", "attempt_id")},
    "artifacts": set(),
    "attempt_artifacts": {
        ("attempt_id", "attempts", "attempt_id"),
        ("sha256", "artifacts", "sha256"),
    },
    "review_events": {
        ("attempt_id", "attempts", "attempt_id"),
        ("artifact_sha256", "artifacts", "sha256"),
    },
}
LEDGER_UNIQUE_CONTRACTS: dict[str, set[tuple[str, ...]]] = {
    "jobs": {("job_id",)},
    "attempts": {("attempt_id",), ("prompt_id",), ("job_id", "attempt_number")},
    "status_events": set(),
    "reviews": {("attempt_id",)},
    "artifacts": {("sha256",), ("relative_path",)},
    "attempt_artifacts": {("attempt_id", "role")},
    "review_events": {("attempt_id", "revision"), ("attempt_id", "request_nonce"), ("request_nonce",)},
}
LEDGER_CHECK_CONTRACTS: dict[str, tuple[str, ...]] = {
    "attempts": ("check(statusin('created','queued','succeeded','failed','outcome_unknown'))",),
    "reviews": ("check(decisionin('unreviewed','accepted','rejected'))",),
    "review_events": ("check(revision>=1)", "check(decisionin('accepted','rejected'))"),
}
LEDGER_TRIGGER_CONTRACTS = {
    "status_events_no_update": ("status_events", "update"),
    "status_events_no_delete": ("status_events", "delete"),
    "review_events_no_update": ("review_events", "update"),
    "review_events_no_delete": ("review_events", "delete"),
}
LEDGER_REQUIRED_INPUT_ROLES = {"omny_snapshot", "plan_snapshot", "workflow_snapshot"}
LEDGER_REQUIRED_SUCCESS_ROLES = {"original_comfy_output", "manga_base_composite", "provenance"}
SERIES_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
DRAFT_TOKEN_PATTERN = re.compile(r"^[a-f0-9]{32}$")
CHARACTER_ID_PATTERN = SERIES_ID_PATTERN
CHARACTER_IMAGE_PATTERN = re.compile(r"^image-([a-f0-9]{64})\.png$")
ARTIFACT_PATH_PATTERN = re.compile(
    r"^artifacts/sha256/([a-f0-9]{2})/([a-f0-9]{64})(\.json|\.yaml|\.omny\.yaml|\.png)$"
)
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
MAX_LEDGER_BYTES = 512 * 1024 * 1024
MAX_SERIES_OMNY_BYTES = 5 * 1024 * 1024
MAX_CATALOG_BYTES = 1024 * 1024
MAX_CHARACTER_IMAGE_BYTES = 40 * 1024 * 1024
MAX_RECOVERY_JSON_BYTES = 5 * 1024 * 1024
DEFAULT_MAX_FILES = 100_000
DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024 * 1024
READ_CHUNK_SIZE = 1024 * 1024
Hook = Callable[[str, Mapping[str, Any]], None]

def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _stable_id(prefix: str, value: Any) -> str:
    return f"{prefix}-{hashlib.sha256(_canonical_json(value)).hexdigest()[:20]}"


def _entry_identity(value: os.stat_result) -> tuple[int, int, int]:
    return value.st_dev, value.st_ino, stat.S_IFMT(value.st_mode)


def _file_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def _directory_flags() -> int:
    required = ("O_DIRECTORY", "O_NOFOLLOW", "O_CLOEXEC")
    if any(not hasattr(os, name) for name in required):
        raise RuntimeError("このOSには安全なread-only directory走査に必要なflagがありません")
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _file_flags() -> int:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
        raise RuntimeError("このOSには安全なread-only file走査に必要なflagがありません")
    return os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC


def _safe_relative_path(value: str) -> PurePosixPath | None:
    if not value or "\\" in value or "\x00" in value:
        return None
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        return None
    return path


def _safe_snapshot_path(value: str) -> PurePosixPath | None:
    if not value or "\x00" in value:
        return None
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        return None
    return path


def _normalized_schema_sql(value: str) -> str:
    return re.sub(r"\s+", "", value.lower())


def _normalized_trigger_sql(value: str) -> str:
    return " ".join(value.lower().split())
