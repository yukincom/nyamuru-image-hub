#!/usr/bin/env python3
"""Read-only integrity doctor for Nyamuru-managed local workspaces.

The doctor intentionally does not import the bridge stores: constructing those
stores can create directories, migrate databases, recover drafts, or purge
history.  Every live root is opened once without following its final symlink;
all later reads stay below that held directory descriptor.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# The public entry point can also be loaded directly by its file path.
_script_directory = str(Path(__file__).resolve().parent)
if _script_directory not in sys.path:
    sys.path.insert(0, _script_directory)

from workspace_inspection_contract import (
    REPORT_SCHEMA_VERSION,
    REPORT_KIND,
    SNAPSHOT_ALGORITHM,
    MANAGED_EPISODE_DIRECTORIES,
    DEFAULT_SERIES_ROOT,
    LEDGER_RELATIVE_PATH,
    LEDGER_SCHEMA_VERSION,
    LEDGER_REQUIRED_TABLES,
    LEDGER_REQUIRED_TRIGGERS,
    LEDGER_COLUMN_CONTRACTS,
    LEDGER_FOREIGN_KEY_CONTRACTS,
    LEDGER_UNIQUE_CONTRACTS,
    LEDGER_CHECK_CONTRACTS,
    LEDGER_TRIGGER_CONTRACTS,
    LEDGER_REQUIRED_INPUT_ROLES,
    LEDGER_REQUIRED_SUCCESS_ROLES,
    SERIES_ID_PATTERN,
    DRAFT_TOKEN_PATTERN,
    CHARACTER_ID_PATTERN,
    CHARACTER_IMAGE_PATTERN,
    ARTIFACT_PATH_PATTERN,
    SHA256_PATTERN,
    MAX_LEDGER_BYTES,
    MAX_SERIES_OMNY_BYTES,
    MAX_CATALOG_BYTES,
    MAX_CHARACTER_IMAGE_BYTES,
    MAX_RECOVERY_JSON_BYTES,
    DEFAULT_MAX_FILES,
    DEFAULT_MAX_TOTAL_BYTES,
    READ_CHUNK_SIZE,
    Hook,
    _canonical_json,
    _stable_id,
    _entry_identity,
    _file_identity,
    _directory_flags,
    _file_flags,
    _safe_relative_path,
    _safe_snapshot_path,
    _normalized_schema_sql,
    _normalized_trigger_sql,
)
from workspace_file_scan import WorkspaceFileScan
from workspace_snapshots import WorkspaceSnapshots
from workspace_ledger_checks import WorkspaceLedgerChecks
from workspace_series_checks import WorkspaceSeriesChecks


class WorkspaceDoctor(
    WorkspaceFileScan,
    WorkspaceSnapshots,
    WorkspaceLedgerChecks,
    WorkspaceSeriesChecks,
):
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
