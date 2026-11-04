"""File descriptors, identities, paths and exceptions for managed production files."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import PurePosixPath
from collections.abc import Callable, Sequence
from typing import Any


PACKAGE_SCHEMA_VERSION = 1
PACKAGE_PLAN_KIND = "nyamuru-production-package-plan"
PACKAGE_MANIFEST_KIND = "nyamuru-production-package"
MANIFEST_FILE_NAME = "nyamuru-manifest.json"
MANAGED_SOURCE_DIRECTORIES = ("name_data", "draft_data", "manuscript_data")
EXPORT_DIRECTORY = "export_data"
HASH_ALGORITHMS = ("sha256", "sha512")
_COPY_CHUNK_SIZE = 1024 * 1024
_HEX_256 = re.compile(r"^[0-9a-f]{64}$")
_HEX_512 = re.compile(r"^[0-9a-f]{128}$")
_BAGIT_HEADER = b"BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n"
_MAX_STAGING_NAME_ATTEMPTS = 128

class ProductionPackageError(RuntimeError):
    """Base error for a rejected package operation."""


class UnsafeWorkspaceEntry(ProductionPackageError):
    """A workspace entry is outside the supported safe file model."""


class PackagePlanConflict(ProductionPackageError):
    """The workspace or submitted selection no longer matches its plan."""


class PackageDestinationExists(ProductionPackageError):
    """The requested immutable package destination already exists."""


class BagItUnavailable(ProductionPackageError):
    """Export or validation was requested without bagit-python installed."""


class BagItValidationError(ProductionPackageError):
    """A BagIt or Nyamuru manifest validation failed."""


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _hash_bytes(value: bytes) -> dict[str, str]:
    return {
        "sha256": hashlib.sha256(value).hexdigest(),
        "sha512": hashlib.sha512(value).hexdigest(),
    }


def _stat_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _entry_identity(value: os.stat_result) -> tuple[int, int, int]:
    return (value.st_dev, value.st_ino, stat.S_IFMT(value.st_mode))


def _directory_open_flags() -> int:
    required = ("O_DIRECTORY", "O_NOFOLLOW", "O_CLOEXEC")
    if any(not hasattr(os, name) for name in required):
        raise ProductionPackageError("このOSには安全なdirfd openに必要なflagがありません")
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _file_open_flags() -> int:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
        raise ProductionPackageError("このOSには安全なfile openに必要なflagがありません")
    return os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC


def _validate_component(name: str) -> None:
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        raise UnsafeWorkspaceEntry(f"安全でないpath componentです: {name!r}")


def _read_descriptor(descriptor: int) -> bytes:
    os.lseek(descriptor, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    while True:
        chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
        if not chunk:
            break
        chunks.append(chunk)
    return b"".join(chunks)


def _hash_descriptor(descriptor: int, *, label: str) -> tuple[int, dict[str, str]]:
    before = os.fstat(descriptor)
    if not stat.S_ISREG(before.st_mode):
        raise UnsafeWorkspaceEntry(f"通常file以外は処理できません: {label}")
    os.lseek(descriptor, 0, os.SEEK_SET)
    digests = {algorithm: hashlib.new(algorithm) for algorithm in HASH_ALGORITHMS}
    size = 0
    while True:
        chunk = os.read(descriptor, _COPY_CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        for digest in digests.values():
            digest.update(chunk)
    after = os.fstat(descriptor)
    if _stat_identity(before) != _stat_identity(after) or size != after.st_size:
        raise PackagePlanConflict(f"処理中にfileが更新されました: {label}")
    return size, {name: digest.hexdigest() for name, digest in digests.items()}


def _open_root_directory(path: str | os.PathLike[str], *, label: str) -> tuple[int, os.stat_result]:
    try:
        descriptor = os.open(path, _directory_open_flags())
    except FileNotFoundError as error:
        raise UnsafeWorkspaceEntry(f"{label}が存在しません: {path}") from error
    except OSError as error:
        raise UnsafeWorkspaceEntry(f"{label}を安全に開けません: {path}") from error
    metadata = os.fstat(descriptor)
    if not stat.S_ISDIR(metadata.st_mode):
        os.close(descriptor)
        raise UnsafeWorkspaceEntry(f"{label}はdirectoryである必要があります")
    return descriptor, metadata


def _open_child_directory(
    parent_fd: int,
    name: str,
    *,
    expected_device: int | None = None,
    after_lstat: Callable[[os.stat_result], None] | None = None,
    label: str,
) -> tuple[int, os.stat_result]:
    _validate_component(name)
    try:
        listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as error:
        raise UnsafeWorkspaceEntry(f"directoryを検査できません: {label}") from error
    if after_lstat is not None:
        after_lstat(listed)
    if stat.S_ISLNK(listed.st_mode) or not stat.S_ISDIR(listed.st_mode):
        raise UnsafeWorkspaceEntry(f"symlinkまたは非directoryは使用できません: {label}")
    try:
        descriptor = os.open(name, _directory_open_flags(), dir_fd=parent_fd)
    except OSError as error:
        raise UnsafeWorkspaceEntry(f"directoryを安全に開けません: {label}") from error
    opened = os.fstat(descriptor)
    if _entry_identity(listed) != _entry_identity(opened) or not stat.S_ISDIR(opened.st_mode):
        os.close(descriptor)
        raise PackagePlanConflict(f"検査中にdirectory参照が変化しました: {label}")
    if expected_device is not None and opened.st_dev != expected_device:
        os.close(descriptor)
        raise UnsafeWorkspaceEntry(f"別filesystemのdirectoryは使用できません: {label}")
    return descriptor, opened


def _open_child_file(
    parent_fd: int,
    name: str,
    *,
    expected_device: int | None = None,
    after_lstat: Callable[[os.stat_result], None] | None = None,
    label: str,
) -> tuple[int, os.stat_result]:
    _validate_component(name)
    try:
        listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as error:
        raise UnsafeWorkspaceEntry(f"fileを検査できません: {label}") from error
    if after_lstat is not None:
        after_lstat(listed)
    if stat.S_ISLNK(listed.st_mode) or not stat.S_ISREG(listed.st_mode):
        raise UnsafeWorkspaceEntry(f"symlinkまたは通常file以外は使用できません: {label}")
    try:
        descriptor = os.open(name, _file_open_flags(), dir_fd=parent_fd)
    except OSError as error:
        raise UnsafeWorkspaceEntry(f"fileを安全に開けません: {label}") from error
    opened = os.fstat(descriptor)
    if _entry_identity(listed) != _entry_identity(opened) or not stat.S_ISREG(opened.st_mode):
        os.close(descriptor)
        raise PackagePlanConflict(f"検査中にfile参照が変化しました: {label}")
    if expected_device is not None and opened.st_dev != expected_device:
        os.close(descriptor)
        raise UnsafeWorkspaceEntry(f"別filesystemのfileは使用できません: {label}")
    return descriptor, opened


def _open_file_beneath(root_fd: int, parts: Sequence[str], *, expected_device: int, label: str) -> int:
    if not parts:
        raise UnsafeWorkspaceEntry(f"file pathが空です: {label}")
    current = os.dup(root_fd)
    try:
        for index, part in enumerate(parts[:-1]):
            child, _ = _open_child_directory(
                current,
                part,
                expected_device=expected_device,
                label="/".join(parts[: index + 1]),
            )
            os.close(current)
            current = child
        descriptor, _ = _open_child_file(
            current,
            parts[-1],
            expected_device=expected_device,
            label=label,
        )
        return descriptor
    finally:
        os.close(current)


class _OwnedEntries:
    def __init__(self) -> None:
        self.identities: dict[tuple[str, ...], tuple[int, int, int]] = {}

    def record(self, parts: Sequence[str], metadata: os.stat_result) -> None:
        self.identities[tuple(parts)] = _entry_identity(metadata)


def _ensure_owned_directory(
    root_fd: int,
    parts: Sequence[str],
    owned: _OwnedEntries,
) -> int:
    current = os.dup(root_fd)
    traversed: list[str] = []
    try:
        for name in parts:
            _validate_component(name)
            traversed.append(name)
            key = tuple(traversed)
            expected = owned.identities.get(key)
            if expected is None:
                try:
                    os.mkdir(name, 0o700, dir_fd=current)
                except FileExistsError as error:
                    raise PackagePlanConflict(f"staging内に未知のentryがあります: {'/'.join(traversed)}") from error
            child, metadata = _open_child_directory(
                current,
                name,
                expected_device=os.fstat(root_fd).st_dev,
                label="/".join(traversed),
            )
            if expected is None:
                owned.record(traversed, metadata)
            elif _entry_identity(metadata) != expected:
                os.close(child)
                raise PackagePlanConflict(f"staging entryが差し替えられました: {'/'.join(traversed)}")
            os.close(current)
            current = child
        return current
    except Exception:
        os.close(current)
        raise


def _write_owned_file(
    root_fd: int,
    parts: Sequence[str],
    value: bytes,
    owned: _OwnedEntries,
) -> dict[str, Any]:
    if not parts:
        raise ProductionPackageError("staging file pathが空です")
    parent_fd = _ensure_owned_directory(root_fd, parts[:-1], owned)
    try:
        name = parts[-1]
        _validate_component(name)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
        try:
            descriptor = os.open(name, flags, 0o600, dir_fd=parent_fd)
        except OSError as error:
            raise PackagePlanConflict(f"staging fileをexclusiveに作成できません: {'/'.join(parts)}") from error
        try:
            offset = 0
            while offset < len(value):
                offset += os.write(descriptor, value[offset:])
            os.fsync(descriptor)
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise ProductionPackageError(f"staging fileが通常fileではありません: {'/'.join(parts)}")
            owned.record(parts, metadata)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent_fd)
    return {"byte_size": len(value), **_hash_bytes(value)}


def normalize_managed_relative_path(value: object) -> str:
    """Return a canonical managed relative path or reject it.

    Paths use POSIX separators on every platform.  Backslashes are rejected
    rather than interpreted, which keeps the serialized plan unambiguous.
    """

    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise UnsafeWorkspaceEntry("管理対象pathは空でないPOSIX相対pathで指定してください")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise UnsafeWorkspaceEntry("管理対象pathに制御文字は使用できません")
    if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        raise UnsafeWorkspaceEntry("管理対象pathにUnicode surrogateは使用できません")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value:
        raise UnsafeWorkspaceEntry(f"正規化できない相対pathです: {value!r}")
    if len(path.parts) < 2 or any(part in ("", ".", "..") for part in path.parts):
        raise UnsafeWorkspaceEntry(f"相対pathの移動要素は使用できません: {value!r}")
    if not path.parts or path.parts[0] not in MANAGED_SOURCE_DIRECTORIES:
        raise UnsafeWorkspaceEntry(
            "packageへ含められるのは name_data / draft_data / manuscript_data 配下だけです"
        )
    return value


def _normalize_bag_payload_path(value: object) -> str:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise BagItValidationError("manifest payload pathが不正です")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value:
        raise BagItValidationError(f"manifest payload pathが正規相対pathではありません: {value!r}")
    if any(part in ("", ".", "..") for part in path.parts) or not path.parts:
        raise BagItValidationError(f"manifest payload pathに移動要素があります: {value!r}")
    if path.parts[0] != "data" or len(path.parts) < 2:
        raise BagItValidationError(f"manifest payload pathはdata/配下である必要があります: {value!r}")
    return value
