"""Read snapshot files and compare the current file inventory to a prior scan."""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import os
import re
import stat
from typing import Any

from workspace_inspection_contract import (
    REPORT_SCHEMA_VERSION,
    REPORT_KIND,
    SNAPSHOT_ALGORITHM,
    SHA256_PATTERN,
    READ_CHUNK_SIZE,
    _canonical_json,
    _entry_identity,
    _file_identity,
    _file_flags,
    _safe_relative_path,
    _safe_snapshot_path,
)


class WorkspaceSnapshots:
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
