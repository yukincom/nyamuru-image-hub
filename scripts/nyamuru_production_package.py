#!/usr/bin/env python3
"""Create and validate local Nyamuru production packages.

The module deliberately has no bridge or UI dependency.  It scans only the
workspace directories owned by the manga-production workflow, produces a
content-addressed plan, then rechecks that plan immediately before export.
"""

from __future__ import annotations

import ctypes
import datetime as dt
import errno
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import subprocess
import sys
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from typing import Any

try:  # Optional by design: planning must work without bagit-python.
    import bagit as _installed_bagit
except ImportError:  # pragma: no cover - depends on the caller's environment
    _installed_bagit = None


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
_DEFAULT_BAGIT = object()
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


def _atomic_rename_no_replace(parent_fd: int, source_name: str, destination_name: str) -> None:
    """Atomically rename one owned entry inside a held directory FD."""

    _validate_component(source_name)
    _validate_component(destination_name)
    libc = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source_name)
    destination_bytes = os.fsencode(destination_name)
    ctypes.set_errno(0)
    if os.uname().sysname == "Darwin" and hasattr(libc, "renameatx_np"):
        renameatx_np = libc.renameatx_np
        renameatx_np.argtypes = (
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        )
        renameatx_np.restype = ctypes.c_int
        result = renameatx_np(
            parent_fd,
            source_bytes,
            parent_fd,
            destination_bytes,
            0x00000004,
        )  # RENAME_EXCL
    elif os.uname().sysname == "Linux" and hasattr(libc, "renameat2"):
        renameat2 = libc.renameat2
        renameat2.argtypes = (
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        )
        renameat2.restype = ctypes.c_int
        result = renameat2(
            parent_fd,
            source_bytes,
            parent_fd,
            destination_bytes,
            0x00000001,
        )  # RENAME_NOREPLACE
    else:
        raise ProductionPackageError("このOSにはatomic no-replace rename APIがありません")
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in (errno.EEXIST, errno.ENOTEMPTY):
        raise PackageDestinationExists(f"package出力先は既に存在します: {destination_name}")
    raise OSError(error_number, os.strerror(error_number), destination_name)


def _open_owned_parent(root_fd: int, parts: Sequence[str], owned: _OwnedEntries) -> int | None:
    current = os.dup(root_fd)
    traversed: list[str] = []
    try:
        for name in parts:
            traversed.append(name)
            expected = owned.identities.get(tuple(traversed))
            if expected is None:
                os.close(current)
                return None
            try:
                child, metadata = _open_child_directory(
                    current,
                    name,
                    expected_device=os.fstat(root_fd).st_dev,
                    label="/".join(traversed),
                )
            except ProductionPackageError:
                os.close(current)
                return None
            if _entry_identity(metadata) != expected:
                os.close(child)
                os.close(current)
                return None
            os.close(current)
            current = child
        return current
    except Exception:
        os.close(current)
        raise


def _cleanup_owned_entries(staging_fd: int, owned: _OwnedEntries) -> None:
    """Best-effort deletion of only entries whose recorded inode still matches."""

    for parts, expected in sorted(
        owned.identities.items(),
        key=lambda item: (len(item[0]), item[0]),
        reverse=True,
    ):
        parent_fd = _open_owned_parent(staging_fd, parts[:-1], owned)
        if parent_fd is None:
            continue
        try:
            try:
                metadata = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            if _entry_identity(metadata) != expected:
                continue
            try:
                if stat.S_ISDIR(metadata.st_mode):
                    os.rmdir(parts[-1], dir_fd=parent_fd)
                else:
                    os.unlink(parts[-1], dir_fd=parent_fd)
            except OSError:
                # Unknown or swapped descendants are deliberately left untouched.
                continue
        finally:
            os.close(parent_fd)


def _cleanup_owned_root(
    parent_fd: int,
    name: str,
    staging_fd: int,
    expected: tuple[int, int, int],
    owned: _OwnedEntries,
) -> bool:
    _cleanup_owned_entries(staging_fd, owned)
    try:
        metadata = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    if _entry_identity(metadata) != expected or not stat.S_ISDIR(metadata.st_mode):
        return False
    try:
        os.rmdir(name, dir_fd=parent_fd)
    except OSError:
        return False
    return True


def _collect_regular_files(
    directory_fd: int,
    *,
    prefix: tuple[str, ...],
    expected_device: int,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    for name in sorted(os.listdir(directory_fd)):
        relative_parts = (*prefix, name)
        label = "/".join(relative_parts)
        listed = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISLNK(listed.st_mode):
            raise BagItValidationError(f"package内にsymlinkがあります: {label}")
        if stat.S_ISDIR(listed.st_mode):
            child, _ = _open_child_directory(
                directory_fd,
                name,
                expected_device=expected_device,
                label=label,
            )
            try:
                collected.extend(
                    _collect_regular_files(
                        child,
                        prefix=relative_parts,
                        expected_device=expected_device,
                    )
                )
            finally:
                os.close(child)
            continue
        if not stat.S_ISREG(listed.st_mode):
            raise BagItValidationError(f"package内に通常file以外があります: {label}")
        descriptor, _ = _open_child_file(
            directory_fd,
            name,
            expected_device=expected_device,
            label=label,
        )
        try:
            byte_size, hashes = _hash_descriptor(descriptor, label=label)
        finally:
            os.close(descriptor)
        collected.append({"path": label, "byte_size": byte_size, **hashes})
    return collected


def _make_bag_fd(
    staging_fd: int,
    *,
    package_name: str,
    bagging_date: str,
    owned: _OwnedEntries,
) -> None:
    """Write the small BagIt 1.0 envelope using only held directory FDs."""

    data_fd, _ = _open_child_directory(
        staging_fd,
        "data",
        expected_device=os.fstat(staging_fd).st_dev,
        label="data",
    )
    try:
        payload_files = _collect_regular_files(
            data_fd,
            prefix=("data",),
            expected_device=os.fstat(staging_fd).st_dev,
        )
    finally:
        os.close(data_fd)
    payload_files.sort(key=lambda item: item["path"])
    payload_bytes = sum(item["byte_size"] for item in payload_files)

    bag_info = (
        f"Bagging-Date: {bagging_date}\n"
        "Bag-Software-Agent: Nyamuru production package core\n"
        f"External-Identifier: {package_name}\n"
        f"Payload-Oxum: {payload_bytes}.{len(payload_files)}\n"
        "Source-Organization: Nyamuru local workspace\n"
    ).encode("utf-8")
    _write_owned_file(staging_fd, ("bagit.txt",), _BAGIT_HEADER, owned)
    _write_owned_file(staging_fd, ("bag-info.txt",), bag_info, owned)

    for algorithm in HASH_ALGORITHMS:
        lines = "".join(
            f"{item[algorithm]}  {item['path']}\n"
            for item in payload_files
        ).encode("utf-8")
        _write_owned_file(staging_fd, (f"manifest-{algorithm}.txt",), lines, owned)

    tag_file_names = (
        "bagit.txt",
        "bag-info.txt",
        "manifest-sha256.txt",
        "manifest-sha512.txt",
    )
    tag_hashes: dict[str, dict[str, str]] = {}
    for name in tag_file_names:
        descriptor = _open_file_beneath(
            staging_fd,
            (name,),
            expected_device=os.fstat(staging_fd).st_dev,
            label=name,
        )
        try:
            _, hashes = _hash_descriptor(descriptor, label=name)
        finally:
            os.close(descriptor)
        tag_hashes[name] = hashes
    for algorithm in HASH_ALGORITHMS:
        lines = "".join(
            f"{tag_hashes[name][algorithm]}  {name}\n"
            for name in tag_file_names
        ).encode("utf-8")
        _write_owned_file(staging_fd, (f"tagmanifest-{algorithm}.txt",), lines, owned)
    os.fsync(staging_fd)


_BAGIT_FD_VALIDATOR = r"""
import json
import os
import sys
import bagit

fd = int(sys.argv[1])
try:
    os.fchdir(fd)
    value = bagit.Bag.__new__(bagit.Bag)
    value.tags = {}
    value.info = {}
    value.entries = {}
    value.normalized_filesystem_names = {}
    value.normalized_manifest_names = {}
    value.algorithms = []
    value.tag_file_name = None
    value.path = "."
    value._open()
    valid = value.validate()
    print(json.dumps({"ok": valid is not False}, separators=(",", ":")))
except Exception as error:
    print(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"}, separators=(",", ":")))
    raise SystemExit(2)
"""


def _validate_bagit_with_module(package_fd: int, bagit_module: Any) -> None:
    validate_fd = getattr(bagit_module, "validate_fd", None)
    if callable(validate_fd):
        try:
            result = validate_fd(package_fd)
        except Exception as error:
            raise BagItValidationError(f"BagIt検証に失敗しました: {error}") from error
        if result is False:
            raise BagItValidationError("BagIt検証がfalseを返しました")
        return

    try:
        completed = subprocess.run(
            [sys.executable, "-c", _BAGIT_FD_VALIDATOR, str(package_fd)],
            pass_fds=(package_fd,),
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BagItValidationError(f"BagIt検証processを実行できません: {error}") from error
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    try:
        payload = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError as error:
        raise BagItValidationError("BagIt検証processが有効なJSONを返しません") from error
    if (
        completed.returncode != 0
        or not isinstance(payload, dict)
        or payload.get("ok") is not True
        or set(payload) - {"ok"}
    ):
        detail = payload.get("error") if isinstance(payload, dict) else completed.stderr.strip()
        raise BagItValidationError(f"BagIt検証に失敗しました: {detail or 'unknown error'}")


class ProductionPackageCore:
    """Plan, export and validate immutable local production packages."""

    def __init__(
        self,
        *,
        bagit_module: object = _DEFAULT_BAGIT,
        now: Callable[[], dt.datetime] | None = None,
        _test_hook: Callable[[str, Mapping[str, object]], None] | None = None,
        _token_factory: Callable[[], str] | None = None,
        _rename_noreplace: Callable[[int, str, str], None] | None = None,
    ) -> None:
        self._bagit = _installed_bagit if bagit_module is _DEFAULT_BAGIT else bagit_module
        self._now = now or (lambda: dt.datetime.now(dt.timezone.utc))
        self._test_hook = _test_hook
        self._token_factory = _token_factory or (lambda: secrets.token_hex(16))
        self._rename_noreplace = _rename_noreplace or _atomic_rename_no_replace

    @property
    def bagit_available(self) -> bool:
        return self._bagit is not None

    def _trigger(self, event: str, **details: object) -> None:
        if self._test_hook is not None:
            self._test_hook(event, details)

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

    def _require_bagit(self) -> Any:
        if self._bagit is None:
            raise BagItUnavailable(
                "export/validateには bagit-python 1.9.0 が必要です。"
                "requirements-package.txt を明示的に導入してください"
            )
        return self._bagit

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

    def export(
        self,
        workspace: str | os.PathLike[str],
        *,
        plan_revision: str,
        selected_files: Sequence[Mapping[str, Any]],
        omny_yaml: str | bytes,
        omay_yaml: str | bytes,
        document: Mapping[str, Any],
    ) -> dict[str, Any]:
        bagit_module = self._require_bagit()
        root_fd, root_metadata = _open_root_directory(workspace, label="workspace")
        export_fd: int | None = None
        staging_fd: int | None = None
        staging_name: str | None = None
        active_name: str | None = None
        staging_identity: tuple[int, int, int] | None = None
        owned = _OwnedEntries()
        completed = False
        try:
            current_plan = self._plan_fd(root_fd, root_metadata)
            if not isinstance(plan_revision, str) or plan_revision != current_plan["plan_revision"]:
                raise PackagePlanConflict("workspaceがplan作成後に変化しました。planを再作成してください")
            selected = self._normalize_selections(selected_files, current_plan["candidates"])
            normalized_document = self._normalize_document(document)
            omny_bytes = self._document_bytes(omny_yaml, "OMNY")
            omay_bytes = self._document_bytes(omay_yaml, "OMAY")
            self._trigger("replan_complete_before_copy", workspace_fd=root_fd)

            try:
                os.mkdir(EXPORT_DIRECTORY, 0o700, dir_fd=root_fd)
            except FileExistsError:
                pass
            export_fd, export_metadata = _open_child_directory(
                root_fd,
                EXPORT_DIRECTORY,
                expected_device=root_metadata.st_dev,
                label=EXPORT_DIRECTORY,
            )
            export_identity = _entry_identity(export_metadata)
            self._trigger("export_fd_opened", workspace_fd=root_fd, export_fd=export_fd)

            created_at = _format_utc(self._now())
            timestamp = created_at.replace("-", "").replace(":", "")
            package_name = f"{_safe_package_slug(normalized_document['title'])}-{timestamp}-package"
            _validate_component(package_name)

            for _attempt in range(_MAX_STAGING_NAME_ATTEMPTS):
                candidate_name = f".nyamuru-package-{self._token_factory()}"
                _validate_component(candidate_name)
                try:
                    os.mkdir(candidate_name, 0o700, dir_fd=export_fd)
                except FileExistsError:
                    continue
                listed = os.stat(candidate_name, dir_fd=export_fd, follow_symlinks=False)
                staging_fd, opened = _open_child_directory(
                    export_fd,
                    candidate_name,
                    expected_device=export_metadata.st_dev,
                    label=candidate_name,
                )
                if _entry_identity(listed) != _entry_identity(opened):
                    os.close(staging_fd)
                    staging_fd = None
                    raise PackagePlanConflict("staging directoryが作成直後に差し替えられました")
                os.fchmod(staging_fd, 0o700)
                staging_name = candidate_name
                active_name = candidate_name
                staging_identity = _entry_identity(opened)
                break
            if staging_fd is None or staging_name is None or staging_identity is None:
                raise ProductionPackageError("安全なstaging directory名を作成できません")
            self._trigger(
                "staging_fd_opened",
                export_fd=export_fd,
                staging_fd=staging_fd,
                staging_name=staging_name,
            )

            data_fd = _ensure_owned_directory(staging_fd, ("data",), owned)
            os.close(data_fd)
            payloads: list[dict[str, Any]] = []
            omny_path = "data/name/document.yaml"
            omay_path = "data/style/settings.yaml"
            omny_details = _write_owned_file(
                staging_fd,
                ("data", "name", "document.yaml"),
                omny_bytes,
                owned,
            )
            omay_details = _write_owned_file(
                staging_fd,
                ("data", "style", "settings.yaml"),
                omay_bytes,
                owned,
            )
            payloads.append(
                {
                    "role": "story_omny",
                    "path": omny_path,
                    "media_type": "application/yaml",
                    **omny_details,
                }
            )
            payloads.append(
                {
                    "role": "style_omay",
                    "path": omay_path,
                    "media_type": "application/yaml",
                    **omay_details,
                }
            )
            payloads.extend(
                self._copy_selected_file(
                    root_fd,
                    root_metadata.st_dev,
                    staging_fd,
                    owned,
                    candidate,
                )
                for candidate in selected
            )
            payloads.sort(key=lambda payload: payload["path"])

            manifest = {
                "schema_version": PACKAGE_SCHEMA_VERSION,
                "kind": PACKAGE_MANIFEST_KIND,
                "created_at": created_at,
                "bagit": {"version": "1.0", "algorithms": list(HASH_ALGORITHMS)},
                "document": {
                    **normalized_document,
                    "omny_path": omny_path,
                    "omay_path": omay_path,
                },
                "payloads": payloads,
            }
            manifest_bytes = json.dumps(
                manifest,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            ).encode("utf-8") + b"\n"
            _write_owned_file(staging_fd, ("data", MANIFEST_FILE_NAME), manifest_bytes, owned)
            _make_bag_fd(
                staging_fd,
                package_name=package_name,
                bagging_date=created_at[:10],
                owned=owned,
            )
            self._trigger("bagit_complete", staging_fd=staging_fd)

            self._trigger(
                "before_publish",
                workspace_fd=root_fd,
                export_fd=export_fd,
                staging_fd=staging_fd,
                staging_name=staging_name,
                package_name=package_name,
            )
            self._assert_export_identity(root_fd, export_fd, export_identity)
            current_staging = os.stat(staging_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(current_staging) != staging_identity:
                raise PackagePlanConflict("publish直前にstaging directoryが差し替えられました")
            # Validate after the final caller-visible hook, then recheck every
            # pathname identity because validation can be long for large PSDs.
            self._validate_package_fd(staging_fd, bagit_module)
            self._assert_export_identity(root_fd, export_fd, export_identity)
            current_staging = os.stat(staging_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(current_staging) != staging_identity:
                raise PackagePlanConflict("publish最終検証中にstaging directoryが差し替えられました")
            self._rename_noreplace(export_fd, staging_name, package_name)
            active_name = package_name
            os.fsync(export_fd)
            self._assert_export_identity(root_fd, export_fd, export_identity)
            published = os.stat(package_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(published) != staging_identity:
                raise PackagePlanConflict("publish後のpackage identityがstagingと一致しません")
            self._trigger(
                "published_before_final_validation",
                workspace_fd=root_fd,
                export_fd=export_fd,
                staging_fd=staging_fd,
                package_name=package_name,
            )
            validation = self._validate_package_fd(staging_fd, bagit_module)
            self._assert_export_identity(root_fd, export_fd, export_identity)
            published = os.stat(package_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(published) != staging_identity:
                raise PackagePlanConflict("publish後最終検証中にpackageが差し替えられました")
            completed = True
            return {
                "ok": True,
                "schema_version": PACKAGE_SCHEMA_VERSION,
                "package_relative_path": f"{EXPORT_DIRECTORY}/{package_name}",
                "plan_revision": current_plan["plan_revision"],
                "payload_count": len(payloads),
                "algorithms": list(HASH_ALGORITHMS),
                "valid": validation["valid"],
            }
        finally:
            if (
                not completed
                and export_fd is not None
                and staging_fd is not None
                and active_name is not None
                and staging_identity is not None
            ):
                self._trigger(
                    "before_cleanup",
                    export_fd=export_fd,
                    staging_fd=staging_fd,
                    staging_name=active_name,
                )
                _cleanup_owned_root(
                    export_fd,
                    active_name,
                    staging_fd,
                    staging_identity,
                    owned,
                )
            if staging_fd is not None:
                os.close(staging_fd)
            if export_fd is not None:
                os.close(export_fd)
            os.close(root_fd)

    def _assert_export_identity(
        self,
        workspace_fd: int,
        export_fd: int,
        expected: tuple[int, int, int],
    ) -> None:
        try:
            listed = os.stat(EXPORT_DIRECTORY, dir_fd=workspace_fd, follow_symlinks=False)
        except FileNotFoundError as error:
            raise PackagePlanConflict("export_dataが処理中に移動されました") from error
        opened = os.fstat(export_fd)
        if _entry_identity(listed) != expected or _entry_identity(opened) != expected:
            raise PackagePlanConflict("export_dataが処理中に差し替えられました")

    def _normalize_document(self, value: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise ProductionPackageError("document metadataはobjectで指定してください")
        allowed = ("title", "series_id", "episode_id", "episode_number")
        normalized: dict[str, Any] = {}
        for key in allowed:
            item = value.get(key)
            if key == "episode_number" and item is not None:
                if not isinstance(item, int) or isinstance(item, bool) or item < 0:
                    raise ProductionPackageError("episode_numberは0以上の整数で指定してください")
                normalized[key] = item
                continue
            if item is None and key != "title":
                continue
            if not isinstance(item, str) or not item.strip() or len(item.strip()) > 256:
                raise ProductionPackageError(f"{key}は1〜256文字の文字列で指定してください")
            normalized[key] = item.strip()
        return normalized

    def _document_bytes(self, value: str | bytes, label: str) -> bytes:
        if isinstance(value, str):
            encoded = value.encode("utf-8")
        elif isinstance(value, bytes):
            encoded = value
            try:
                value.decode("utf-8")
            except UnicodeDecodeError as error:
                raise ProductionPackageError(f"{label}はUTF-8で指定してください") from error
        else:
            raise ProductionPackageError(f"{label}は文字列またはUTF-8 bytesで指定してください")
        if not encoded:
            raise ProductionPackageError(f"{label}を空にすることはできません")
        return encoded

    def validate(self, package_directory: str | os.PathLike[str]) -> dict[str, Any]:
        bagit_module = self._require_bagit()
        try:
            package_fd, _ = _open_root_directory(package_directory, label="package")
        except UnsafeWorkspaceEntry as error:
            raise BagItValidationError(str(error)) from error
        try:
            return self._validate_package_fd(package_fd, bagit_module)
        finally:
            os.close(package_fd)

    def _validate_package_fd(self, package_fd: int, bagit_module: Any) -> dict[str, Any]:
        try:
            self._validate_bag_root(package_fd)
            _validate_bagit_with_module(package_fd, bagit_module)
            manifest = self._validate_manifest_payloads_fd(package_fd)
        except BagItValidationError:
            raise
        except ProductionPackageError as error:
            raise BagItValidationError(f"Nyamuru manifest検証に失敗しました: {error}") from error
        except (KeyError, TypeError, ValueError) as error:
            raise BagItValidationError(f"Nyamuru manifest検証に失敗しました: {error}") from error
        return {
            "ok": True,
            "valid": True,
            "schema_version": PACKAGE_SCHEMA_VERSION,
            "payload_count": len(manifest["payloads"]),
            "manifest": manifest,
        }

    def _validate_bag_root(self, package_fd: int) -> None:
        package_device = os.fstat(package_fd).st_dev
        required_files = {
            "bagit.txt",
            "bag-info.txt",
            "manifest-sha256.txt",
            "manifest-sha512.txt",
            "tagmanifest-sha256.txt",
            "tagmanifest-sha512.txt",
        }
        names = set(os.listdir(package_fd))
        if not required_files.issubset(names) or "data" not in names:
            raise BagItValidationError("packageに必須のBagIt fileまたはdata directoryがありません")
        for name in names:
            metadata = os.stat(name, dir_fd=package_fd, follow_symlinks=False)
            if name == "data":
                child, _ = _open_child_directory(
                    package_fd,
                    name,
                    expected_device=package_device,
                    label=name,
                )
                os.close(child)
                continue
            if not stat.S_ISREG(metadata.st_mode):
                raise BagItValidationError(f"package rootに通常file以外があります: {name}")
            descriptor, _ = _open_child_file(
                package_fd,
                name,
                expected_device=package_device,
                label=name,
            )
            os.close(descriptor)
        header_fd = _open_file_beneath(
            package_fd,
            ("bagit.txt",),
            expected_device=package_device,
            label="bagit.txt",
        )
        try:
            header = _read_descriptor(header_fd)
        finally:
            os.close(header_fd)
        if header != _BAGIT_HEADER:
            raise BagItValidationError("bagit.txtがNyamuruのBagIt 1.0 contractと一致しません")

    def _validate_manifest_payloads_fd(self, package_fd: int) -> dict[str, Any]:
        package_device = os.fstat(package_fd).st_dev
        data_fd, _ = _open_child_directory(
            package_fd,
            "data",
            expected_device=package_device,
            label="data",
        )
        try:
            manifest_fd, _ = _open_child_file(
                data_fd,
                MANIFEST_FILE_NAME,
                expected_device=package_device,
                label=f"data/{MANIFEST_FILE_NAME}",
            )
            try:
                manifest_bytes = _read_descriptor(manifest_fd)
            finally:
                os.close(manifest_fd)
            actual_files = _collect_regular_files(
                data_fd,
                prefix=("data",),
                expected_device=package_device,
            )
        finally:
            os.close(data_fd)
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BagItValidationError(f"{MANIFEST_FILE_NAME}を読み取れません: {error}") from error
        self._validate_manifest_shape(manifest)

        actual_by_path = {item["path"]: item for item in actual_files}
        listed_paths: set[str] = set()
        roles_by_path: dict[str, str] = {}
        for payload in manifest["payloads"]:
            payload_path = _normalize_bag_payload_path(payload.get("path"))
            if payload_path in listed_paths:
                raise BagItValidationError(f"manifest payload pathが重複しています: {payload_path}")
            listed_paths.add(payload_path)
            roles_by_path[payload_path] = payload["role"]
            if "source_relative_path" in payload:
                source_relative_path = normalize_managed_relative_path(payload["source_relative_path"])
                expected_payload_path = f"data/workspace/{source_relative_path}"
                if payload_path != expected_payload_path:
                    raise BagItValidationError(
                        f"workspace payload pathとsource_relative_pathが一致しません: {payload_path}"
                    )
            elif payload_path not in (
                manifest["document"]["omny_path"],
                manifest["document"]["omay_path"],
            ):
                raise BagItValidationError(f"sourceのないpayloadが固定document path外にあります: {payload_path}")
            actual = actual_by_path.get(payload_path)
            if actual is None:
                raise BagItValidationError(f"manifest掲載payloadがありません: {payload_path}")
            if actual["byte_size"] != payload["byte_size"]:
                raise BagItValidationError(f"payload sizeがmanifestと一致しません: {payload_path}")
            if actual["sha256"] != payload["sha256"] or actual["sha512"] != payload["sha512"]:
                raise BagItValidationError(f"payload hashがmanifestと一致しません: {payload_path}")

        actual_paths = set(actual_by_path) - {f"data/{MANIFEST_FILE_NAME}"}
        if actual_paths != listed_paths:
            missing = sorted(listed_paths - actual_paths)
            extra = sorted(actual_paths - listed_paths)
            raise BagItValidationError(f"manifestとdata payload一覧が一致しません: missing={missing}, extra={extra}")

        document = manifest["document"]
        if roles_by_path.get(document["omny_path"]) != "story_omny":
            raise BagItValidationError("document.omny_pathがstory_omny payloadを参照していません")
        if roles_by_path.get(document["omay_path"]) != "style_omay":
            raise BagItValidationError("document.omay_pathがstyle_omay payloadを参照していません")
        return manifest

    def _validate_manifest_shape(self, manifest: object) -> None:
        if not isinstance(manifest, dict):
            raise BagItValidationError("manifestはJSON objectである必要があります")
        allowed_root = {"schema_version", "kind", "created_at", "bagit", "document", "payloads"}
        if set(manifest) != allowed_root:
            raise BagItValidationError("manifestのroot fieldsがv1 schemaと一致しません")
        if manifest.get("schema_version") != PACKAGE_SCHEMA_VERSION or manifest.get("kind") != PACKAGE_MANIFEST_KIND:
            raise BagItValidationError("manifestのschema_versionまたはkindが不正です")
        if not isinstance(manifest.get("created_at"), str) or not manifest["created_at"].endswith("Z"):
            raise BagItValidationError("manifest.created_atはUTC日時である必要があります")
        try:
            parsed_created_at = dt.datetime.fromisoformat(manifest["created_at"].replace("Z", "+00:00"))
        except ValueError as error:
            raise BagItValidationError("manifest.created_atが有効な日時ではありません") from error
        if parsed_created_at.tzinfo is None or parsed_created_at.utcoffset() != dt.timedelta(0):
            raise BagItValidationError("manifest.created_atはUTC日時である必要があります")
        bagit_section = manifest.get("bagit")
        if bagit_section != {"version": "1.0", "algorithms": list(HASH_ALGORITHMS)}:
            raise BagItValidationError("manifest.bagitはBagIt 1.0とsha256/sha512である必要があります")
        document = manifest.get("document")
        if not isinstance(document, dict):
            raise BagItValidationError("manifest.documentはobjectである必要があります")
        required_document = {"title", "omny_path", "omay_path"}
        allowed_document = required_document | {"series_id", "episode_id", "episode_number"}
        if not required_document.issubset(document) or not set(document).issubset(allowed_document):
            raise BagItValidationError("manifest.document fieldsがv1 schemaと一致しません")
        for key in ("title", "omny_path", "omay_path"):
            if not isinstance(document[key], str) or not document[key]:
                raise BagItValidationError(f"manifest.document.{key}が不正です")
        if len(document["title"]) > 256:
            raise BagItValidationError("manifest.document.titleが長すぎます")
        for key in ("series_id", "episode_id"):
            if key in document and (
                not isinstance(document[key], str)
                or not document[key]
                or len(document[key]) > 256
            ):
                raise BagItValidationError(f"manifest.document.{key}が不正です")
        if "episode_number" in document and (
            not isinstance(document["episode_number"], int)
            or isinstance(document["episode_number"], bool)
            or document["episode_number"] < 0
        ):
            raise BagItValidationError("manifest.document.episode_numberが不正です")
        if document["omny_path"] not in ("data/name/document.yaml", "data/name/document.omny.yaml"):
            raise BagItValidationError("manifest.document.omny_pathが固定pathと一致しません")
        if document["omay_path"] not in ("data/style/settings.yaml", "data/style/document.omay.yaml"):
            raise BagItValidationError("manifest.document.omay_pathが固定pathと一致しません")
        payloads = manifest.get("payloads")
        if not isinstance(payloads, list) or len(payloads) < 2:
            raise BagItValidationError("manifest.payloadsにはOMNY/OMAYが必要です")
        valid_roles = {
            "story_omny",
            "style_omay",
            "editable_psd",
            "reference_asset",
            "coverage_report",
            "workspace_payload",
        }
        for payload in payloads:
            if not isinstance(payload, dict):
                raise BagItValidationError("manifest.payloadはobjectである必要があります")
            required = {"role", "path", "media_type", "byte_size", "sha256", "sha512"}
            allowed = required | {"source_relative_path"}
            if not required.issubset(payload) or not set(payload).issubset(allowed):
                raise BagItValidationError("manifest.payload fieldsがv1 schemaと一致しません")
            if payload["role"] not in valid_roles:
                raise BagItValidationError(f"manifest payload roleが不正です: {payload['role']!r}")
            if (
                not isinstance(payload["media_type"], str)
                or not payload["media_type"]
                or len(payload["media_type"]) > 255
            ):
                raise BagItValidationError("manifest payload media_typeが不正です")
            if (
                not isinstance(payload["byte_size"], int)
                or isinstance(payload["byte_size"], bool)
                or payload["byte_size"] < 0
            ):
                raise BagItValidationError("manifest payload byte_sizeが不正です")
            if not isinstance(payload["sha256"], str) or not _HEX_256.fullmatch(payload["sha256"]):
                raise BagItValidationError("manifest payload sha256が不正です")
            if not isinstance(payload["sha512"], str) or not _HEX_512.fullmatch(payload["sha512"]):
                raise BagItValidationError("manifest payload sha512が不正です")


__all__ = [
    "BagItUnavailable",
    "BagItValidationError",
    "PackageDestinationExists",
    "PackagePlanConflict",
    "ProductionPackageCore",
    "ProductionPackageError",
    "UnsafeWorkspaceEntry",
    "normalize_managed_relative_path",
]
