#!/usr/bin/env python3
"""Read-only integrity doctor for Nyamuru-managed local workspaces.

The doctor intentionally does not import the bridge stores: constructing those
stores can create directories, migrate databases, recover drafts, or purge
history.  Every live root is opened once without following its final symlink;
all later reads stay below that held directory descriptor.
"""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
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


class WorkspaceDoctor:
    """Produce a bounded, mutation-free report for episode and series data."""

    def __init__(
        self,
        *,
        max_files: int = DEFAULT_MAX_FILES,
        max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
        hook: Hook | None = None,
    ) -> None:
        if max_files < 1 or max_total_bytes < 1:
            raise ValueError("scan上限は1以上にしてください")
        self.max_files = max_files
        self.max_total_bytes = max_total_bytes
        self.hook = hook or (lambda _event, _detail: None)
        self._reset()

    def _reset(self) -> None:
        self.observations: list[dict[str, Any]] = []
        self.inferences: list[dict[str, Any]] = []
        self.files: dict[tuple[str, str], dict[str, Any]] = {}
        self.roots: list[dict[str, Any]] = []
        self.scan_complete = True
        self.total_bytes = 0
        self._observation_ids: set[str] = set()
        self._inference_ids: set[str] = set()
        self._limit_reported = False

    def _observe(
        self,
        code: str,
        status: str,
        root: str,
        path: str,
        message: str,
        evidence: Mapping[str, Any] | None = None,
        *,
        incomplete: bool = False,
    ) -> str:
        evidence_value = dict(evidence or {})
        identity = {
            "code": code,
            "status": status,
            "root": root,
            "path": path,
            "evidence": evidence_value,
        }
        observation_id = _stable_id("obs", identity)
        if observation_id not in self._observation_ids:
            self._observation_ids.add(observation_id)
            self.observations.append(
                {
                    "id": observation_id,
                    **identity,
                    "message": message,
                }
            )
        if incomplete:
            self.scan_complete = False
        return observation_id

    def _infer(
        self,
        code: str,
        severity: str,
        root: str,
        path: str,
        message: str,
        based_on: Sequence[str],
    ) -> str:
        identity = {
            "code": code,
            "severity": severity,
            "root": root,
            "path": path,
            "based_on": sorted(set(based_on)),
        }
        inference_id = _stable_id("inf", identity)
        if inference_id not in self._inference_ids:
            self._inference_ids.add(inference_id)
            self.inferences.append(
                {
                    "id": inference_id,
                    **identity,
                    "message": message,
                    "requires_human_review": True,
                }
            )
        return inference_id

    def _open_root(self, value: str | os.PathLike[str], root: str, *, optional: bool) -> int | None:
        path = Path(value).expanduser().absolute()
        display_name = path.name or root
        try:
            listed = os.lstat(path)
        except FileNotFoundError:
            self.roots.append({"name": root, "display_name": display_name, "state": "absent"})
            self._observe(
                f"{root}_root_absent",
                "info" if optional else "error",
                root,
                ".",
                f"{root} rootは存在しません",
                {"optional": optional},
                incomplete=not optional,
            )
            return None
        except OSError as error:
            self.roots.append({"name": root, "display_name": display_name, "state": "unavailable"})
            self._observe(
                f"{root}_root_unavailable",
                "not_inspected",
                root,
                ".",
                f"{root} rootを検査できません",
                {"error_type": type(error).__name__},
                incomplete=True,
            )
            return None
        if stat.S_ISLNK(listed.st_mode) or not stat.S_ISDIR(listed.st_mode):
            self.roots.append({"name": root, "display_name": display_name, "state": "unsafe"})
            self._observe(
                f"{root}_root_unsafe",
                "not_inspected",
                root,
                ".",
                f"{root} rootはsymlinkではないdirectoryである必要があります",
                {"entry_type": self._mode_name(listed.st_mode)},
                incomplete=True,
            )
            return None
        descriptor: int | None = None
        try:
            descriptor = os.open(path, _directory_flags())
            opened = os.fstat(descriptor)
        except OSError as error:
            if descriptor is not None:
                os.close(descriptor)
            self.roots.append({"name": root, "display_name": display_name, "state": "unavailable"})
            self._observe(
                f"{root}_root_open_failed",
                "not_inspected",
                root,
                ".",
                f"{root} rootを安全に開けません",
                {"error_type": type(error).__name__},
                incomplete=True,
            )
            return None
        if _entry_identity(listed) != _entry_identity(opened):
            os.close(descriptor)
            self.roots.append({"name": root, "display_name": display_name, "state": "changed"})
            self._observe(
                f"{root}_root_changed",
                "not_inspected",
                root,
                ".",
                f"{root} rootが検査開始時に変化しました",
                {},
                incomplete=True,
            )
            return None
        self.roots.append({"name": root, "display_name": display_name, "state": "present"})
        self._observe(
            f"{root}_root_opened",
            "ok",
            root,
            ".",
            f"{root} rootをread-onlyで固定しました",
        )
        self.hook(f"{root}_root_opened", {"descriptor": descriptor})
        return descriptor

    @staticmethod
    def _mode_name(mode: int) -> str:
        if stat.S_ISDIR(mode):
            return "directory"
        if stat.S_ISREG(mode):
            return "file"
        if stat.S_ISLNK(mode):
            return "symlink"
        if stat.S_ISFIFO(mode):
            return "fifo"
        if stat.S_ISSOCK(mode):
            return "socket"
        if stat.S_ISCHR(mode) or stat.S_ISBLK(mode):
            return "device"
        return "unknown"

    def _open_child_directory(
        self,
        parent_fd: int,
        name: str,
        root: str,
        path: str,
        expected_device: int,
        *,
        missing_status: str = "info",
    ) -> int | None:
        try:
            listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            self._observe(
                "managed_directory_absent",
                missing_status,
                root,
                path,
                "管理directoryはまだ作成されていません",
            )
            return None
        except OSError as error:
            self._observe(
                "directory_not_inspected",
                "not_inspected",
                root,
                path,
                "directoryを検査できません",
                {"error_type": type(error).__name__},
                incomplete=True,
            )
            return None
        if stat.S_ISLNK(listed.st_mode) or not stat.S_ISDIR(listed.st_mode):
            self._observe(
                "unsafe_directory_entry",
                "error",
                root,
                path,
                "symlinkまたはdirectory以外を管理directoryとして使用できません",
                {"entry_type": self._mode_name(listed.st_mode)},
            )
            return None
        if listed.st_dev != expected_device:
            self._observe(
                "cross_device_directory",
                "not_inspected",
                root,
                path,
                "別filesystemのdirectoryは検査対象外です",
                {},
                incomplete=True,
            )
            return None
        descriptor: int | None = None
        try:
            descriptor = os.open(name, _directory_flags(), dir_fd=parent_fd)
            opened = os.fstat(descriptor)
        except OSError as error:
            if descriptor is not None:
                os.close(descriptor)
            self._observe(
                "directory_open_failed",
                "not_inspected",
                root,
                path,
                "directoryを安全に開けません",
                {"error_type": type(error).__name__},
                incomplete=True,
            )
            return None
        if _entry_identity(listed) != _entry_identity(opened) or opened.st_dev != expected_device:
            os.close(descriptor)
            self._observe(
                "directory_changed_during_scan",
                "not_inspected",
                root,
                path,
                "directory参照が検査中に変化しました",
                {},
                incomplete=True,
            )
            return None
        return descriptor

    def _scan_directory(
        self,
        root: str,
        directory_fd: int,
        prefix: tuple[str, ...],
        expected_device: int,
    ) -> None:
        try:
            with os.scandir(directory_fd) as iterator:
                entries = sorted(iterator, key=lambda item: item.name)
        except OSError as error:
            self._observe(
                "directory_listing_failed",
                "not_inspected",
                root,
                "/".join(prefix) or ".",
                "directory内容を列挙できません",
                {"error_type": type(error).__name__},
                incomplete=True,
            )
            return
        for entry in entries:
            name = entry.name
            parts = (*prefix, name)
            relative = "/".join(parts)
            try:
                listed = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except OSError as error:
                self._observe(
                    "entry_stat_failed",
                    "not_inspected",
                    root,
                    relative,
                    "entryを検査できません",
                    {"error_type": type(error).__name__},
                    incomplete=True,
                )
                continue
            if stat.S_ISLNK(listed.st_mode):
                self._observe(
                    "symlink_not_followed",
                    "error",
                    root,
                    relative,
                    "symlinkは追跡しません",
                    {"entry_type": "symlink"},
                )
                continue
            if listed.st_dev != expected_device:
                self._observe(
                    "cross_device_entry",
                    "not_inspected",
                    root,
                    relative,
                    "別filesystemのentryは検査対象外です",
                    {"entry_type": self._mode_name(listed.st_mode)},
                    incomplete=True,
                )
                continue
            if stat.S_ISDIR(listed.st_mode):
                child_fd = self._open_child_directory(
                    directory_fd,
                    name,
                    root,
                    relative,
                    expected_device,
                )
                if child_fd is None:
                    continue
                try:
                    self._scan_directory(root, child_fd, parts, expected_device)
                finally:
                    os.close(child_fd)
                continue
            if not stat.S_ISREG(listed.st_mode):
                self._observe(
                    "special_file_not_inspected",
                    "not_inspected",
                    root,
                    relative,
                    "通常file以外は読み取りません",
                    {"entry_type": self._mode_name(listed.st_mode)},
                    incomplete=True,
                )
                continue
            self._scan_file(root, directory_fd, name, relative, listed, expected_device)

    def _scan_file(
        self,
        root: str,
        parent_fd: int,
        name: str,
        relative: str,
        listed: os.stat_result,
        expected_device: int,
    ) -> None:
        if len(self.files) >= self.max_files or self.total_bytes + listed.st_size > self.max_total_bytes:
            if not self._limit_reported:
                self._limit_reported = True
                self._observe(
                    "scan_limit_reached",
                    "not_inspected",
                    root,
                    relative,
                    "scan上限に達したため残りを正常扱いしません",
                    {"max_files": self.max_files, "max_total_bytes": self.max_total_bytes},
                    incomplete=True,
                )
            return
        descriptor: int | None = None
        try:
            descriptor = os.open(name, _file_flags(), dir_fd=parent_fd)
            opened = os.fstat(descriptor)
        except OSError as error:
            if descriptor is not None:
                os.close(descriptor)
            self._observe(
                "file_open_failed",
                "not_inspected",
                root,
                relative,
                "fileを安全に開けません",
                {"error_type": type(error).__name__},
                incomplete=True,
            )
            return
        try:
            if (
                _entry_identity(listed) != _entry_identity(opened)
                or not stat.S_ISREG(opened.st_mode)
                or opened.st_dev != expected_device
            ):
                self._observe(
                    "file_changed_before_read",
                    "not_inspected",
                    root,
                    relative,
                    "file参照が読み取り前に変化しました",
                    {},
                    incomplete=True,
                )
                return
            self.hook("file_opened", {"root": root, "path": relative, "descriptor": descriptor})
            digest = hashlib.sha256()
            size = 0
            while True:
                chunk = os.read(descriptor, READ_CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                digest.update(chunk)
            after = os.fstat(descriptor)
            if _file_identity(opened) != _file_identity(after) or size != after.st_size:
                self._observe(
                    "file_changed_during_read",
                    "not_inspected",
                    root,
                    relative,
                    "fileが読み取り中に変化しました",
                    {},
                    incomplete=True,
                )
                return
            record = {
                "root": root,
                "path": relative,
                "byte_size": size,
                "sha256": digest.hexdigest(),
                "mode": f"{stat.S_IMODE(after.st_mode):04o}",
            }
            self.files[(root, relative)] = record
            self.total_bytes += size
        finally:
            os.close(descriptor)

    def _open_relative_file(
        self,
        root_fd: int,
        root: str,
        relative: str,
        expected_device: int,
    ) -> int | None:
        parsed = _safe_relative_path(relative)
        if parsed is None:
            return None
        current = os.dup(root_fd)
        try:
            for index, part in enumerate(parsed.parts[:-1]):
                child = self._open_child_directory(
                    current,
                    part,
                    root,
                    "/".join(parsed.parts[: index + 1]),
                    expected_device,
                )
                if child is None:
                    return None
                os.close(current)
                current = child
            name = parsed.parts[-1]
            listed = os.stat(name, dir_fd=current, follow_symlinks=False)
            if stat.S_ISLNK(listed.st_mode) or not stat.S_ISREG(listed.st_mode):
                return None
            descriptor = os.open(name, _file_flags(), dir_fd=current)
            try:
                opened = os.fstat(descriptor)
            except OSError:
                os.close(descriptor)
                return None
            if _entry_identity(listed) != _entry_identity(opened) or opened.st_dev != expected_device:
                os.close(descriptor)
                return None
            return descriptor
        except OSError:
            return None
        finally:
            os.close(current)

    def _read_snapshot_file(
        self,
        root_fd: int,
        root: str,
        relative: str,
        expected_device: int,
        maximum: int,
        label: str,
    ) -> bytes | None:
        snapshot = self.files.get((root, relative))
        if snapshot is None:
            return None
        if snapshot["byte_size"] > maximum:
            self._observe(
                f"{label}_too_large",
                "not_inspected",
                root,
                relative,
                f"{label}が検査上限を超えています",
                {"byte_size": snapshot["byte_size"], "maximum": maximum},
                incomplete=True,
            )
            return None
        descriptor = self._open_relative_file(root_fd, root, relative, expected_device)
        if descriptor is None:
            self._observe(
                f"{label}_reopen_failed",
                "not_inspected",
                root,
                relative,
                f"{label}を意味検査のため再読込できません",
                {},
                incomplete=True,
            )
            return None
        try:
            before = os.fstat(descriptor)
            chunks: list[bytes] = []
            size = 0
            digest = hashlib.sha256()
            while True:
                chunk = os.read(descriptor, READ_CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                if size > maximum:
                    self._observe(
                        f"{label}_changed_after_snapshot",
                        "not_inspected",
                        root,
                        relative,
                        f"{label}がsnapshot後に上限を超える内容へ変化しました",
                        {},
                        incomplete=True,
                    )
                    return None
                chunks.append(chunk)
                digest.update(chunk)
            after = os.fstat(descriptor)
            if (
                _file_identity(before) != _file_identity(after)
                or size != snapshot["byte_size"]
                or digest.hexdigest() != snapshot["sha256"]
            ):
                self._observe(
                    f"{label}_changed_after_snapshot",
                    "not_inspected",
                    root,
                    relative,
                    f"{label}がsnapshot後に変化しました",
                    {},
                    incomplete=True,
                )
                return None
            return b"".join(chunks)
        finally:
            os.close(descriptor)

    def _scan_episode(self, descriptor: int) -> None:
        root_metadata = os.fstat(descriptor)
        for name in MANAGED_EPISODE_DIRECTORIES:
            child = self._open_child_directory(
                descriptor,
                name,
                "episode",
                name,
                root_metadata.st_dev,
            )
            if child is None:
                continue
            try:
                self._observe(
                    "managed_directory_present",
                    "ok",
                    "episode",
                    name,
                    "管理directoryを検査します",
                )
                self._scan_directory("episode", child, (name,), root_metadata.st_dev)
            finally:
                os.close(child)
        self._inspect_ledger(descriptor, root_metadata.st_dev)

    def _inspect_ledger(self, episode_fd: int, expected_device: int) -> None:
        snapshot = self.files.get(("episode", LEDGER_RELATIVE_PATH))
        if snapshot is None:
            self._observe(
                "ledger_absent",
                "info",
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳はまだ作成されていません",
            )
            return
        data = self._read_snapshot_file(
            episode_fd,
            "episode",
            LEDGER_RELATIVE_PATH,
            expected_device,
            MAX_LEDGER_BYTES,
            "ledger",
        )
        if data is None:
            return
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        try:
            connection.deserialize(data)
            connection.execute("PRAGMA query_only = ON")
            quick_check = [row[0] for row in connection.execute("PRAGMA quick_check").fetchall()]
            if quick_check != ["ok"]:
                self._observe(
                    "ledger_quick_check_failed",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite quick_checkが失敗しました",
                    {"result_count": len(quick_check), "sample": quick_check[:5]},
                )
            else:
                self._observe(
                    "ledger_quick_check_ok",
                    "ok",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite quick_checkに合格しました",
                )
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                self._observe(
                    "ledger_foreign_key_failed",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite foreign key整合性に違反があります",
                    {"violation_count": len(foreign_keys)},
                )
            else:
                self._observe(
                    "ledger_foreign_key_ok",
                    "ok",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite foreign key整合性に合格しました",
                )
            schema_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            schema_status = "ok" if schema_version == LEDGER_SCHEMA_VERSION else "not_inspected"
            self._observe(
                "ledger_schema_version",
                schema_status,
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳のschema versionを確認しました",
                {"observed": schema_version, "supported": LEDGER_SCHEMA_VERSION},
                incomplete=schema_version != LEDGER_SCHEMA_VERSION,
            )
            objects = connection.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','trigger')"
            ).fetchall()
            tables = {str(row["name"]): row for row in objects if row["type"] == "table"}
            triggers = {str(row["name"]): row for row in objects if row["type"] == "trigger"}
            missing_tables = sorted(LEDGER_REQUIRED_TABLES - tables.keys())
            missing_triggers = sorted(LEDGER_REQUIRED_TRIGGERS - triggers.keys())
            invalid_tables = self._invalid_ledger_tables(connection, tables)
            invalid_triggers = self._invalid_ledger_triggers(triggers)
            self._observe(
                "ledger_required_objects",
                "ok" if not missing_tables and not missing_triggers and not invalid_tables and not invalid_triggers
                else "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳のcolumn・制約・foreign key・append-only triggerを確認しました",
                {
                    "missing_tables": missing_tables,
                    "missing_triggers": missing_triggers,
                    "invalid_tables": invalid_tables,
                    "invalid_triggers": invalid_triggers,
                },
            )
            if missing_tables or invalid_tables:
                return
            self._inspect_ledger_artifacts(connection)
            self._inspect_ledger_relations(connection)
        except (sqlite3.DatabaseError, ValueError, OverflowError) as error:
            self._observe(
                "ledger_unreadable",
                "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳をSQLiteとして検査できません",
                {"error_type": type(error).__name__},
            )
        finally:
            connection.close()

    @staticmethod
    def _quoted_identifier(value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    def _invalid_ledger_tables(
        self,
        connection: sqlite3.Connection,
        tables: Mapping[str, sqlite3.Row],
    ) -> list[str]:
        issues: list[str] = []
        for table_name, expected_columns in LEDGER_COLUMN_CONTRACTS.items():
            if table_name not in tables:
                continue
            quoted_table = self._quoted_identifier(table_name)
            column_rows = connection.execute(f"PRAGMA table_info({quoted_table})").fetchall()
            actual_columns = tuple(
                (str(row["name"]), str(row["type"]).upper(), int(row["notnull"]), int(row["pk"]))
                for row in column_rows
            )
            if actual_columns != expected_columns:
                issues.append(f"{table_name}:columns")
            foreign_key_rows = connection.execute(f"PRAGMA foreign_key_list({quoted_table})").fetchall()
            actual_foreign_keys = {
                (str(row["from"]), str(row["table"]), str(row["to"])) for row in foreign_key_rows
            }
            if actual_foreign_keys != LEDGER_FOREIGN_KEY_CONTRACTS[table_name]:
                issues.append(f"{table_name}:foreign_keys")
            actual_unique: set[tuple[str, ...]] = set()
            for index in connection.execute(f"PRAGMA index_list({quoted_table})").fetchall():
                if int(index["unique"]) != 1:
                    continue
                quoted_index = self._quoted_identifier(str(index["name"]))
                columns = tuple(
                    str(row["name"])
                    for row in connection.execute(f"PRAGMA index_info({quoted_index})").fetchall()
                )
                actual_unique.add(columns)
            if not LEDGER_UNIQUE_CONTRACTS[table_name].issubset(actual_unique):
                issues.append(f"{table_name}:unique_constraints")
            schema_sql = tables[table_name]["sql"]
            normalized_sql = _normalized_schema_sql(schema_sql) if isinstance(schema_sql, str) else ""
            if any(fragment not in normalized_sql for fragment in LEDGER_CHECK_CONTRACTS.get(table_name, ())):
                issues.append(f"{table_name}:check_constraints")
        return sorted(set(issues))

    def _invalid_ledger_triggers(self, triggers: Mapping[str, sqlite3.Row]) -> list[str]:
        issues: list[str] = []
        for trigger_name, (table_name, operation) in LEDGER_TRIGGER_CONTRACTS.items():
            row = triggers.get(trigger_name)
            if row is None:
                continue
            sql = row["sql"]
            normalized = _normalized_trigger_sql(sql) if isinstance(sql, str) else ""
            pattern = re.compile(
                rf"^create trigger(?: if not exists)? {re.escape(trigger_name)} "
                rf"before {operation} on {re.escape(table_name)} begin "
                r"select raise\(abort,\s*'[^']+'\); end$"
            )
            if str(row["tbl_name"]) != table_name or pattern.fullmatch(normalized) is None:
                issues.append(trigger_name)
        return sorted(issues)

    def _inspect_ledger_artifacts(self, connection: sqlite3.Connection) -> None:
        rows = connection.execute(
            "SELECT sha256,relative_path,byte_size,media_type FROM artifacts ORDER BY relative_path"
        ).fetchall()
        listed_paths: set[str] = set()
        for row in rows:
            sha256 = row["sha256"]
            relative_path = row["relative_path"]
            byte_size = row["byte_size"]
            media_type = row["media_type"]
            safe = isinstance(relative_path, str) and _safe_relative_path(relative_path) is not None
            match = ARTIFACT_PATH_PATTERN.fullmatch(relative_path) if safe else None
            metadata_valid = (
                isinstance(sha256, str)
                and SHA256_PATTERN.fullmatch(sha256) is not None
                and match is not None
                and match.group(1) == sha256[:2]
                and match.group(2) == sha256
                and isinstance(byte_size, int)
                and byte_size >= 0
                and isinstance(media_type, str)
                and bool(media_type)
            )
            if metadata_valid and match is not None:
                expected_media_type = {
                    ".json": "application/json",
                    ".yaml": "application/yaml",
                    ".omny.yaml": "application/yaml",
                    ".png": "image/png",
                }[match.group(3)]
                metadata_valid = media_type == expected_media_type
            if not metadata_valid:
                self._observe(
                    "ledger_artifact_metadata_invalid",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "artifact行のpathまたはmetadataが不正です",
                    {"sha256": sha256 if isinstance(sha256, str) else "", "path_safe": safe},
                )
                continue
            listed_paths.add(relative_path)
            workspace_path = f"draft_data/nyamuru/{relative_path}"
            snapshot = self.files.get(("episode", workspace_path))
            if snapshot is None:
                self._observe(
                    "ledger_artifact_missing",
                    "error",
                    "episode",
                    workspace_path,
                    "台帳が参照するartifact fileがありません",
                    {"sha256": sha256},
                )
                continue
            mismatches: list[str] = []
            if snapshot["sha256"] != sha256:
                mismatches.append("sha256")
            if snapshot["byte_size"] != byte_size:
                mismatches.append("byte_size")
            if mismatches:
                self._observe(
                    "ledger_artifact_mismatch",
                    "error",
                    "episode",
                    workspace_path,
                    "台帳とartifact fileの内容が一致しません",
                    {"fields": mismatches, "expected_sha256": sha256},
                )
        artifact_prefix = "draft_data/nyamuru/artifacts/sha256/"
        for (root, path), snapshot in sorted(self.files.items()):
            if root != "episode" or not path.startswith(artifact_prefix):
                continue
            ledger_relative = path.removeprefix("draft_data/nyamuru/")
            match = ARTIFACT_PATH_PATTERN.fullmatch(ledger_relative)
            if (
                match is None
                or match.group(1) != match.group(2)[:2]
                or snapshot["sha256"] != match.group(2)
            ):
                self._observe(
                    "artifact_path_not_canonical",
                    "warning",
                    "episode",
                    path,
                    "content-addressed artifact directoryに非canonical fileがあります",
                    {},
                )
                continue
            if ledger_relative not in listed_paths:
                observation = self._observe(
                    "artifact_not_listed_in_ledger",
                    "warning",
                    "episode",
                    path,
                    "artifact fileは存在しますが台帳行がありません",
                    {"sha256": snapshot["sha256"]},
                )
                self._infer(
                    "possible_orphan_artifact",
                    "warning",
                    "episode",
                    path,
                    "孤立artifactの可能性があります。移動や削除はせず人間が参照元を確認してください",
                    [observation],
                )
        self._observe(
            "ledger_artifact_inventory",
            "ok",
            "episode",
            LEDGER_RELATIVE_PATH,
            "台帳artifact inventoryを検査しました",
            {"row_count": len(rows)},
        )

    def _inspect_ledger_relations(self, connection: sqlite3.Connection) -> None:
        attempts = connection.execute(
            """
            SELECT a.attempt_id,a.status,
                   GROUP_CONCAT(aa.role, ',') AS roles,
                   (SELECT se.status FROM status_events se
                     WHERE se.attempt_id=a.attempt_id ORDER BY se.event_id DESC LIMIT 1) AS latest_status
              FROM attempts a
              LEFT JOIN attempt_artifacts aa ON aa.attempt_id=a.attempt_id
             GROUP BY a.attempt_id,a.status ORDER BY a.attempt_id
            """
        ).fetchall()
        for row in attempts:
            roles = set(str(row["roles"] or "").split(",")) - {""}
            missing = sorted(LEDGER_REQUIRED_INPUT_ROLES - roles)
            if row["status"] == "succeeded":
                missing.extend(sorted(LEDGER_REQUIRED_SUCCESS_ROLES - roles))
            if missing:
                self._observe(
                    "attempt_required_artifact_missing",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "attemptに必須artifact roleがありません",
                    {"attempt_id": row["attempt_id"], "missing_roles": sorted(set(missing))},
                )
            if row["latest_status"] != row["status"]:
                self._observe(
                    "attempt_latest_status_mismatch",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "attempt状態と最新status eventが一致しません",
                    {
                        "attempt_id": row["attempt_id"],
                        "attempt_status": row["status"],
                        "latest_event_status": row["latest_status"],
                    },
                )
        missing_provenance = int(
            connection.execute(
                "SELECT COUNT(*) FROM status_events WHERE provenance_sha256 IS NULL OR provenance_sha256=''"
            ).fetchone()[0]
        )
        if missing_provenance:
            self._observe(
                "status_event_provenance_missing",
                "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "status eventにprovenance artifactがありません",
                {"count": missing_provenance},
            )
        review_mismatches = connection.execute(
            """
            SELECT re.review_event_id,re.attempt_id,a.status,re.artifact_sha256,aa.sha256 AS output_sha256
              FROM review_events re
              JOIN attempts a ON a.attempt_id=re.attempt_id
              LEFT JOIN attempt_artifacts aa ON aa.attempt_id=re.attempt_id
                                            AND aa.role='manga_base_composite'
             WHERE a.status!='succeeded' OR aa.sha256 IS NULL OR re.artifact_sha256!=aa.sha256
             ORDER BY re.review_event_id
            """
        ).fetchall()
        for row in review_mismatches:
            self._observe(
                "review_target_mismatch",
                "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "review eventが成功済み4値artifactを参照していません",
                {"attempt_id": row["attempt_id"], "review_event_id": row["review_event_id"]},
            )
        self._observe(
            "ledger_relation_inventory",
            "ok",
            "episode",
            LEDGER_RELATIVE_PATH,
            "attempt・status event・review参照を検査しました",
            {"attempt_count": len(attempts), "review_mismatch_count": len(review_mismatches)},
        )

    def _scan_series(self, descriptor: int) -> None:
        root_metadata = os.fstat(descriptor)
        self._scan_directory("series", descriptor, (), root_metadata.st_dev)
        try:
            with os.scandir(descriptor) as iterator:
                entries = sorted(iterator, key=lambda item: item.name)
        except OSError:
            return
        for entry in entries:
            name = entry.name
            try:
                metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            except OSError:
                continue
            if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                if name not in {".DS_Store"}:
                    self._observe(
                        "unknown_series_root_entry",
                        "info",
                        "series",
                        name,
                        "series rootの非directory entryはbytesだけsnapshotしました",
                    )
                continue
            if name == ".drafts":
                self._inspect_series_drafts(descriptor, root_metadata.st_dev)
            elif SERIES_ID_PATTERN.fullmatch(name):
                self._inspect_series_catalog(descriptor, root_metadata.st_dev, name)
            else:
                self._observe(
                    "unknown_series_root_directory",
                    "not_inspected",
                    "series",
                    name,
                    "未知のseries root directoryはbytesだけsnapshotし、意味検査していません",
                    {},
                    incomplete=True,
                )

    def _inspect_series_drafts(self, series_fd: int, expected_device: int) -> None:
        draft_files = [
            path for (root, path) in self.files
            if root == "series" and path.startswith(".drafts/") and path.endswith("/manifest.json")
        ]
        self._observe(
            "series_drafts_present",
            "warning" if draft_files else "info",
            "series",
            ".drafts",
            "未完了series draftは復旧資産として保持し、変更しません",
            {"manifest_count": len(draft_files)},
        )
        for path in sorted(draft_files):
            parts = PurePosixPath(path).parts
            token_valid = len(parts) >= 3 and DRAFT_TOKEN_PATTERN.fullmatch(parts[1]) is not None
            data = self._read_snapshot_file(
                series_fd,
                "series",
                path,
                expected_device,
                MAX_RECOVERY_JSON_BYTES,
                "series_draft_manifest",
            )
            if data is None:
                continue
            try:
                value = json.loads(data.decode("utf-8"))
                valid = isinstance(value, dict) and token_valid and value.get("draft_token") == parts[1]
            except (UnicodeDecodeError, json.JSONDecodeError):
                valid = False
            self._observe(
                "series_draft_manifest",
                "ok" if valid else "warning",
                "series",
                path,
                "series draft manifestをread-onlyで確認しました",
                {"valid": valid},
            )

    def _inspect_series_catalog(self, series_fd: int, expected_device: int, series_id: str) -> None:
        catalog_path = f"{series_id}/catalog.json"
        current_path = f"{series_id}/series.yaml"
        legacy_path = f"{series_id}/series.omny.yaml"
        has_current = ("series", current_path) in self.files
        omny_path = current_path if has_current else legacy_path
        catalog_data = self._read_snapshot_file(
            series_fd,
            "series",
            catalog_path,
            expected_device,
            MAX_CATALOG_BYTES,
            "series_catalog",
        )
        omny_data = self._read_snapshot_file(
            series_fd,
            "series",
            omny_path,
            expected_device,
            MAX_SERIES_OMNY_BYTES,
            "series_omny",
        )
        if catalog_data is None:
            self._observe(
                "series_catalog_missing",
                "error",
                "series",
                catalog_path,
                "series catalog.jsonがありません、または安全に読めません",
            )
        if omny_data is None:
            self._observe(
                "series_omny_missing",
                "error",
                "series",
                omny_path,
                "series.yaml（または互換用series.omny.yaml）がありません、または安全に読めません",
            )
        metadata: dict[str, Any] | None = None
        if catalog_data is not None:
            try:
                parsed = json.loads(catalog_data.decode("utf-8"))
                metadata = parsed if isinstance(parsed, dict) else None
            except (UnicodeDecodeError, json.JSONDecodeError):
                metadata = None
            self._observe(
                "series_catalog_json",
                "ok" if metadata is not None else "error",
                "series",
                catalog_path,
                "series catalog JSONを確認しました",
                {"object": metadata is not None},
            )
        if omny_data is not None:
            try:
                omny_data.decode("utf-8")
                utf8 = True
            except UnicodeDecodeError:
                utf8 = False
            self._observe(
                "series_omny_utf8",
                "ok" if utf8 else "error",
                "series",
                omny_path,
                "series OMNYのUTF-8 encodingを確認しました",
                {"utf8": utf8},
            )
        if metadata is not None:
            legacy_data = (
                self._read_snapshot_file(series_fd, "series", legacy_path, expected_device, MAX_SERIES_OMNY_BYTES, "series_omny")
                if has_current and ("series", legacy_path) in self.files else (omny_data if not has_current else None)
            )
            origin = metadata.get("legacy_source")
            if origin is not None:
                names_ok = (
                    isinstance(origin, dict) and origin.get("file_name") == "series.omny.yaml"
                    and isinstance(origin.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", origin["sha256"]) is not None
                    and has_current and (legacy_data is None or hashlib.sha256(legacy_data).hexdigest() == origin["sha256"])
                )
            else:
                names_ok = not has_current or legacy_data is None or legacy_data == omny_data
            self._observe(
                "series_catalog_names", "ok" if names_ok else "error", "series", omny_path,
                "新旧の台帳名と移行時の原本照合情報を確認しました",
                {"compatible": names_ok, "current_present": has_current, "legacy_present": legacy_data is not None},
            )
            observed_id = metadata.get("series_id")
            revision = metadata.get("revision")
            expected_revision = (
                hashlib.sha256(omny_data.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")).hexdigest()
                if omny_data is not None and utf8 else None
            )
            fields_ok = (
                observed_id == series_id
                and isinstance(metadata.get("series_name"), str)
                and bool(metadata["series_name"].strip())
                and revision == expected_revision
            )
            self._observe(
                "series_catalog_identity",
                "ok" if fields_ok else "error",
                "series",
                catalog_path,
                "directory名・series ID・OMNY revisionを照合しました",
                {
                    "series_id_matches": observed_id == series_id,
                    "series_name_present": isinstance(metadata.get("series_name"), str)
                    and bool(str(metadata.get("series_name", "")).strip()),
                    "revision_matches": revision == expected_revision,
                },
            )
            external_fields: list[str] = []
            if isinstance(metadata.get("series_directory"), str) and metadata["series_directory"].strip():
                external_fields.append("series_directory")
            reference = metadata.get("character_text_reference")
            if isinstance(reference, dict) and isinstance(reference.get("series_directory"), str):
                external_fields.append("character_text_reference.series_directory")
            if external_fields:
                self._observe(
                    "external_reference_not_followed",
                    "info",
                    "series",
                    catalog_path,
                    "catalogの外部path文字列は記録だけ確認し、追跡していません",
                    {"fields": sorted(external_fields)},
                )
        self._inspect_character_images(series_fd, expected_device, series_id)
        self._inspect_recovery_assets(series_fd, expected_device, series_id)

    def _inspect_character_images(self, series_fd: int, expected_device: int, series_id: str) -> None:
        prefix = f"{series_id}/characters/"
        for (root, path), snapshot in sorted(self.files.items()):
            if root != "series" or not path.startswith(prefix):
                continue
            relative = path.removeprefix(prefix)
            parts = PurePosixPath(relative).parts
            if len(parts) != 2:
                self._observe(
                    "character_asset_layout_unknown",
                    "warning",
                    "series",
                    path,
                    "人物資料assetのdirectory構造が既知contractと異なります",
                )
                continue
            character_id, file_name = parts
            match = CHARACTER_IMAGE_PATTERN.fullmatch(file_name)
            if CHARACTER_ID_PATTERN.fullmatch(character_id) is None or match is None:
                self._observe(
                    "character_asset_name_invalid",
                    "warning",
                    "series",
                    path,
                    "人物資料assetのIDまたはfile名が既知contractと異なります",
                )
                continue
            expected_hash = match.group(1)
            data = self._read_snapshot_file(
                series_fd,
                "series",
                path,
                expected_device,
                MAX_CHARACTER_IMAGE_BYTES,
                "character_image",
            )
            if data is None:
                continue
            png_header = len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR"
            width = int.from_bytes(data[16:20], "big") if png_header else 0
            height = int.from_bytes(data[20:24], "big") if png_header else 0
            dimensions_ok = (
                png_header
                and 1 <= width <= 12_000
                and 1 <= height <= 12_000
                and width * height <= 60_000_000
            )
            valid = snapshot["sha256"] == expected_hash and dimensions_ok
            self._observe(
                "character_image_integrity",
                "ok" if valid else "error",
                "series",
                path,
                "人物資料PNGのfile名hash・header・寸法を確認しました",
                {
                    "hash_matches": snapshot["sha256"] == expected_hash,
                    "png_header": png_header,
                    "dimensions_ok": dimensions_ok,
                    "width_px": width,
                    "height_px": height,
                },
            )

    def _inspect_recovery_assets(self, series_fd: int, expected_device: int, series_id: str) -> None:
        for directory_name in ("deleted-characters", "character-text-history"):
            prefix = f"{series_id}/{directory_name}/"
            paths = sorted(path for root, path in self.files if root == "series" and path.startswith(prefix))
            if not paths:
                continue
            observation = self._observe(
                "recovery_assets_present",
                "info",
                "series",
                f"{series_id}/{directory_name}",
                "復旧資産を列挙しました。期限に関係なく変更しません",
                {"file_count": len(paths), "asset_kind": directory_name},
            )
            self._infer(
                "recovery_assets_require_retention_review",
                "info",
                "series",
                f"{series_id}/{directory_name}",
                "復旧資産の保持・削除判断は人間の確認が必要です",
                [observation],
            )
            if directory_name != "deleted-characters":
                continue
            for path in paths:
                if not path.endswith(".json"):
                    continue
                data = self._read_snapshot_file(
                    series_fd,
                    "series",
                    path,
                    expected_device,
                    MAX_RECOVERY_JSON_BYTES,
                    "deleted_character_record",
                )
                if data is None:
                    continue
                try:
                    value = json.loads(data.decode("utf-8"))
                    valid = isinstance(value, dict) and value.get("series_id") == series_id
                except (UnicodeDecodeError, json.JSONDecodeError):
                    valid = False
                self._observe(
                    "deleted_character_record",
                    "ok" if valid else "warning",
                    "series",
                    path,
                    "削除人物の復旧recordをread-onlyで確認しました",
                    {"valid": valid},
                )

    def _snapshot(self) -> dict[str, Any]:
        files = sorted(self.files.values(), key=lambda item: (item["root"], item["path"]))
        revision = hashlib.sha256(_canonical_json(files)).hexdigest()
        return {
            "algorithm": SNAPSHOT_ALGORITHM,
            "revision": revision,
            "files": files,
        }

    def _compare(self, baseline: Mapping[str, Any], current: Mapping[str, Any]) -> dict[str, Any] | None:
        if (
            baseline.get("kind") != REPORT_KIND
            or baseline.get("schema_version") != REPORT_SCHEMA_VERSION
            or baseline.get("scan_complete") is not True
        ):
            self._observe(
                "baseline_contract_invalid",
                "not_inspected",
                "report",
                ".",
                "baseline reportのkindまたはschema versionが正しくありません",
                {},
                incomplete=True,
            )
            return None
        snapshot = baseline.get("snapshot")
        baseline_files = snapshot.get("files") if isinstance(snapshot, dict) else None
        if (
            not isinstance(snapshot, dict)
            or snapshot.get("algorithm") != SNAPSHOT_ALGORITHM
            or not isinstance(snapshot.get("revision"), str)
            or SHA256_PATTERN.fullmatch(snapshot["revision"]) is None
            or not isinstance(baseline_files, list)
        ):
            self._observe(
                "baseline_snapshot_invalid",
                "not_inspected",
                "report",
                ".",
                "baseline reportにsnapshot file一覧がありません",
                {},
                incomplete=True,
            )
            return None
        expected: dict[tuple[str, str], Mapping[str, Any]] = {}
        for item in baseline_files:
            if (
                not isinstance(item, dict)
                or set(item) != {"root", "path", "byte_size", "sha256", "mode"}
                or item.get("root") not in {"episode", "series"}
                or not isinstance(item.get("path"), str)
                or _safe_snapshot_path(item["path"]) is None
                or not isinstance(item.get("byte_size"), int)
                or not isinstance(item.get("sha256"), str)
                or SHA256_PATTERN.fullmatch(item["sha256"]) is None
                or not isinstance(item.get("mode"), str)
                or re.fullmatch(r"[0-7]{4}", item["mode"]) is None
            ):
                self._observe(
                    "baseline_snapshot_entry_invalid",
                    "not_inspected",
                    "report",
                    ".",
                    "baseline snapshotに不正entryがあります",
                    {},
                    incomplete=True,
                )
                return None
            key = (item["root"], item["path"])
            if key in expected:
                self._observe(
                    "baseline_snapshot_duplicate",
                    "not_inspected",
                    "report",
                    item["path"],
                    "baseline snapshotに重複pathがあります",
                    {"root": item["root"]},
                    incomplete=True,
                )
                return None
            expected[key] = {
                "root": item["root"],
                "path": item["path"],
                "byte_size": item["byte_size"],
                "sha256": item["sha256"],
                "mode": item["mode"],
            }
        canonical_baseline_files = sorted(expected.values(), key=lambda item: (item["root"], item["path"]))
        computed_revision = hashlib.sha256(_canonical_json(canonical_baseline_files)).hexdigest()
        if computed_revision != snapshot["revision"]:
            self._observe(
                "baseline_revision_mismatch",
                "not_inspected",
                "report",
                ".",
                "baseline snapshot revisionがfile一覧から再計算した値と一致しません",
                {},
                incomplete=True,
            )
            return None
        actual = {(item["root"], item["path"]): item for item in current["files"]}
        added = [
            {"root": root, "path": path}
            for root, path in sorted(actual.keys() - expected.keys())
        ]
        removed = [
            {"root": root, "path": path}
            for root, path in sorted(expected.keys() - actual.keys())
        ]
        changed: list[dict[str, Any]] = []
        for root, path in sorted(actual.keys() & expected.keys()):
            fields = [
                field for field in ("byte_size", "sha256", "mode")
                if actual[(root, path)].get(field) != expected[(root, path)].get(field)
            ]
            if fields:
                changed.append({"root": root, "path": path, "fields": fields})
        matches = not added and not removed and not changed and self.scan_complete
        self._observe(
            "baseline_comparison",
            "ok" if matches else "error",
            "report",
            ".",
            "baseline snapshotと現在のmanaged dataを比較しました",
            {"matches": matches, "added": len(added), "removed": len(removed), "changed": len(changed)},
        )
        return {
            "matches": matches,
            "baseline_revision": str(snapshot.get("revision") or ""),
            "current_revision": current["revision"],
            "added": added,
            "removed": removed,
            "changed": changed,
        }

    def scan(
        self,
        episode_root: str | os.PathLike[str],
        *,
        series_root: str | os.PathLike[str] | None = None,
        baseline: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._reset()
        episode_fd = self._open_root(episode_root, "episode", optional=False)
        series_fd = None
        try:
            if episode_fd is not None:
                self._scan_episode(episode_fd)
            if series_root is None:
                self.roots.append({"name": "series", "display_name": "series-common", "state": "skipped"})
                self._observe(
                    "series_root_skipped",
                    "info",
                    "series",
                    ".",
                    "series rootは明示的にscan対象外です",
                )
            else:
                series_fd = self._open_root(series_root, "series", optional=True)
                if series_fd is not None:
                    self._scan_series(series_fd)
            snapshot = self._snapshot()
            comparison = self._compare(baseline, snapshot) if baseline is not None else None
            status_counts = Counter(item["status"] for item in self.observations)
            inference_counts = Counter(item["severity"] for item in self.inferences)
            attention = any(status_counts[value] for value in ("warning", "error")) or any(
                inference_counts[value] for value in ("warning", "error")
            )
            verdict = "incomplete" if not self.scan_complete else "attention" if attention else "healthy"
            return {
                "schema_version": REPORT_SCHEMA_VERSION,
                "kind": REPORT_KIND,
                "mode": "dry_run",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "scan_complete": self.scan_complete,
                "verdict": verdict,
                "roots": self.roots,
                "summary": {
                    "file_count": len(self.files),
                    "total_bytes": self.total_bytes,
                    "observation_counts": {
                        key: status_counts[key]
                        for key in ("ok", "info", "warning", "error", "not_inspected")
                    },
                    "inference_counts": {
                        key: inference_counts[key] for key in ("info", "warning", "error")
                    },
                },
                "snapshot": snapshot,
                "observations": sorted(
                    self.observations,
                    key=lambda item: (item["root"], item["path"], item["code"], item["id"]),
                ),
                "inferences": sorted(
                    self.inferences,
                    key=lambda item: (item["root"], item["path"], item["code"], item["id"]),
                ),
                "comparison": comparison,
            }
        finally:
            if series_fd is not None:
                os.close(series_fd)
            if episode_fd is not None:
                os.close(episode_fd)


def _baseline_from_path(path: str) -> Mapping[str, Any]:
    source = Path(path).expanduser().read_bytes()
    if len(source) > 64 * 1024 * 1024:
        raise ValueError("baseline reportが64MiBを超えています")
    value = json.loads(source.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("baseline reportはJSON objectである必要があります")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Nyamuru managed workspaceをread-onlyで診断します")
    parser.add_argument("--episode", required=True, help="episode workspaceの絶対path")
    series = parser.add_mutually_exclusive_group()
    series.add_argument("--series-root", help="series-common root。省略時はapp supportの既定path")
    series.add_argument("--no-series", action="store_true", help="series-commonをscanしない")
    parser.add_argument("--baseline", help="復元前に保存したdoctor report JSON")
    parser.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    parser.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    parser.add_argument("--compact", action="store_true", help="JSONを1行で出力する")
    arguments = parser.parse_args(argv)
    try:
        baseline = _baseline_from_path(arguments.baseline) if arguments.baseline else None
        series_root = None if arguments.no_series else arguments.series_root or DEFAULT_SERIES_ROOT
        report = WorkspaceDoctor(
            max_files=arguments.max_files,
            max_total_bytes=arguments.max_total_bytes,
        ).scan(arguments.episode, series_root=series_root, baseline=baseline)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    json.dump(
        report,
        sys.stdout,
        ensure_ascii=False,
        indent=None if arguments.compact else 2,
        separators=(",", ":") if arguments.compact else None,
    )
    sys.stdout.write("\n")
    return {"healthy": 0, "attention": 1, "incomplete": 2}[report["verdict"]]


if __name__ == "__main__":
    raise SystemExit(main())
