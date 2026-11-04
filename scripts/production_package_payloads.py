"""Plan and copy only the selected, verified workspace payloads."""

from __future__ import annotations

import datetime as dt
import hashlib
import mimetypes
import os
import re
import stat
import unicodedata
from pathlib import Path, PurePosixPath
from collections.abc import Mapping, Sequence
from typing import Any

from production_package_files import (
    PACKAGE_SCHEMA_VERSION,
    PACKAGE_PLAN_KIND,
    MANAGED_SOURCE_DIRECTORIES,
    HASH_ALGORITHMS,
    _COPY_CHUNK_SIZE,
    UnsafeWorkspaceEntry,
    PackagePlanConflict,
    _canonical_json_bytes,
    _stat_identity,
    _hash_descriptor,
    _open_root_directory,
    _open_child_directory,
    _open_child_file,
    _open_file_beneath,
    _OwnedEntries,
    _ensure_owned_directory,
    normalize_managed_relative_path,
)


def _media_type(path: Path) -> str:
    if path.suffix.lower() in (".yaml", ".yml"):
        return "application/yaml"
    if path.suffix.lower() in (".psd", ".psb"):
        return "image/vnd.adobe.photoshop"
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _payload_role(relative_path: str) -> str:
    lowered = relative_path.lower()
    if lowered.endswith((".omny.yaml", ".omny.yml")):
        return "story_omny"
    if lowered.endswith((".omay.yaml", ".omay.yml")):
        return "style_omay"
    if lowered.endswith((".yaml", ".yml")):
        stem = PurePosixPath(lowered).stem
        if stem in ("settings", "generation") or stem.endswith(("-settings", "-generation")):
            return "style_omay"
        if lowered.startswith("name_data/"):
            return "story_omny"
    if lowered.endswith((".psd", ".psb")):
        return "editable_psd"
    if lowered.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".avif")):
        return "reference_asset"
    if lowered.endswith(".json") and "/coverage/" in f"/{lowered}":
        return "coverage_report"
    return "workspace_payload"


def _safe_package_slug(title: str) -> str:
    normalized = unicodedata.normalize("NFKC", title).strip()
    normalized = re.sub(r"[^\w.-]+", "-", normalized, flags=re.UNICODE)
    normalized = normalized.strip("._-")[:64].rstrip("._-")
    return normalized or "nyamuru"


def _format_utc(value: dt.datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ProductionPackagePayloads:
    def plan(self, workspace: str | os.PathLike[str]) -> dict[str, Any]:
        root_fd, root_metadata = _open_root_directory(workspace, label="workspace")
        try:
            return self._plan_fd(root_fd, root_metadata)
        finally:
            os.close(root_fd)

    def _plan_fd(self, root_fd: int, root_metadata: os.stat_result) -> dict[str, Any]:
        candidates: list[dict[str, Any]] = []
        missing_directories: list[str] = []

        for directory_name in MANAGED_SOURCE_DIRECTORIES:
            try:
                os.stat(directory_name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                missing_directories.append(directory_name)
                continue
            managed_fd, _ = _open_child_directory(
                root_fd,
                directory_name,
                expected_device=root_metadata.st_dev,
                after_lstat=lambda _metadata, name=directory_name: self._trigger(
                    "entry_lstat_done",
                    parent_fd=root_fd,
                    name=name,
                    relative_path=name,
                ),
                label=directory_name,
            )
            try:
                self._scan_managed_directory(
                    managed_fd,
                    relative_parts=(directory_name,),
                    workspace_device=root_metadata.st_dev,
                    candidates=candidates,
                )
            finally:
                os.close(managed_fd)

        candidates.sort(key=lambda candidate: candidate["relative_path"])
        revision_material = {
            "schema_version": PACKAGE_SCHEMA_VERSION,
            "managed_directories": list(MANAGED_SOURCE_DIRECTORIES),
            "candidates": candidates,
        }
        plan_revision = hashlib.sha256(_canonical_json_bytes(revision_material)).hexdigest()
        return {
            "schema_version": PACKAGE_SCHEMA_VERSION,
            "kind": PACKAGE_PLAN_KIND,
            "bagit_available": self.bagit_available,
            "algorithms": list(HASH_ALGORITHMS),
            "managed_directories": list(MANAGED_SOURCE_DIRECTORIES),
            "missing_directories": missing_directories,
            "candidates": candidates,
            "plan_revision": plan_revision,
        }

    def _scan_managed_directory(
        self,
        directory_fd: int,
        *,
        relative_parts: tuple[str, ...],
        workspace_device: int,
        candidates: list[dict[str, Any]],
    ) -> None:
        for name in sorted(os.listdir(directory_fd)):
            candidate_parts = (*relative_parts, name)
            relative_path = "/".join(candidate_parts)
            normalize_managed_relative_path(relative_path)
            try:
                initial = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except OSError as error:
                raise UnsafeWorkspaceEntry(f"管理entryを検査できません: {relative_path}") from error
            callback = lambda _metadata, path=relative_path: self._trigger(
                "entry_lstat_done",
                parent_fd=directory_fd,
                name=name,
                relative_path=path,
            )
            if stat.S_ISDIR(initial.st_mode):
                child, _ = _open_child_directory(
                    directory_fd,
                    name,
                    expected_device=workspace_device,
                    after_lstat=callback,
                    label=relative_path,
                )
                try:
                    self._scan_managed_directory(
                        child,
                        relative_parts=candidate_parts,
                        workspace_device=workspace_device,
                        candidates=candidates,
                    )
                finally:
                    os.close(child)
                continue
            if not stat.S_ISREG(initial.st_mode):
                raise UnsafeWorkspaceEntry(f"symlinkまたは通常file以外は管理対象に置けません: {relative_path}")
            descriptor, _ = _open_child_file(
                directory_fd,
                name,
                expected_device=workspace_device,
                after_lstat=callback,
                label=relative_path,
            )
            try:
                byte_size, hashes = _hash_descriptor(descriptor, label=relative_path)
            finally:
                os.close(descriptor)
            candidates.append(
                {
                    "relative_path": relative_path,
                    "role": _payload_role(relative_path),
                    "media_type": _media_type(Path(relative_path)),
                    "byte_size": byte_size,
                    **hashes,
                }
            )

    def _normalize_selections(
        self,
        selections: Sequence[Mapping[str, Any]],
        candidates: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        by_path = {candidate["relative_path"]: candidate for candidate in candidates}
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        if isinstance(selections, (str, bytes)) or not isinstance(selections, Sequence):
            raise PackagePlanConflict("selected_filesはselection objectの配列で指定してください")
        for selection in selections:
            if not isinstance(selection, Mapping):
                raise PackagePlanConflict("selectionはrelative_pathとhashを持つobjectである必要があります")
            relative_path = normalize_managed_relative_path(selection.get("relative_path"))
            if relative_path in seen:
                raise PackagePlanConflict(f"selectionが重複しています: {relative_path}")
            seen.add(relative_path)
            candidate = by_path.get(relative_path)
            if candidate is None:
                raise PackagePlanConflict(f"planに存在しないfileが選択されています: {relative_path}")
            if selection.get("sha256") != candidate["sha256"] or selection.get("sha512") != candidate["sha512"]:
                raise PackagePlanConflict(f"selection hashが現在のplanと一致しません: {relative_path}")
            normalized.append(dict(candidate))
        normalized.sort(key=lambda candidate: candidate["relative_path"])
        return normalized

    def _copy_selected_file(
        self,
        workspace_fd: int,
        workspace_device: int,
        staging_fd: int,
        owned: _OwnedEntries,
        candidate: Mapping[str, Any],
    ) -> dict[str, Any]:
        relative_path = normalize_managed_relative_path(candidate["relative_path"])
        relative_parts = PurePosixPath(relative_path).parts
        descriptor = _open_file_beneath(
            workspace_fd,
            relative_parts,
            expected_device=workspace_device,
            label=relative_path,
        )
        target_parts = ("data", "workspace", *relative_parts)
        target_parent = _ensure_owned_directory(staging_fd, target_parts[:-1], owned)
        digests = {algorithm: hashlib.new(algorithm) for algorithm in HASH_ALGORITHMS}
        copied_size = 0
        try:
            opened = os.fstat(descriptor)
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
            try:
                output = os.open(target_parts[-1], flags, 0o600, dir_fd=target_parent)
            except OSError as error:
                raise PackagePlanConflict(f"copy先をexclusiveに作成できません: {relative_path}") from error
            try:
                while True:
                    chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
                    if not chunk:
                        break
                    offset = 0
                    while offset < len(chunk):
                        offset += os.write(output, chunk[offset:])
                    copied_size += len(chunk)
                    for digest in digests.values():
                        digest.update(chunk)
                os.fsync(output)
                output_metadata = os.fstat(output)
                owned.record(target_parts, output_metadata)
            finally:
                os.close(output)
            after = os.fstat(descriptor)
            actual_hashes = {name: digest.hexdigest() for name, digest in digests.items()}
            if _stat_identity(opened) != _stat_identity(after):
                raise PackagePlanConflict(f"copy中にfileが更新されました: {relative_path}")
            if (
                copied_size != candidate["byte_size"]
                or actual_hashes["sha256"] != candidate["sha256"]
                or actual_hashes["sha512"] != candidate["sha512"]
            ):
                raise PackagePlanConflict(f"copy時の内容がplanと一致しません: {relative_path}")
        finally:
            os.close(descriptor)
            os.close(target_parent)
        return {
            "role": candidate["role"],
            "path": f"data/workspace/{relative_path}",
            "source_relative_path": relative_path,
            "media_type": candidate["media_type"],
            "byte_size": copied_size,
            "sha256": candidate["sha256"],
            "sha512": candidate["sha512"],
        }
