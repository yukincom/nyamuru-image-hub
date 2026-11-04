"""Create, verify and publish or clean up an owned BagIt staging tree."""

from __future__ import annotations

import ctypes
import errno
import json
import os
import stat
import subprocess
import sys
from collections.abc import Sequence
from typing import Any

from production_package_files import (
    HASH_ALGORITHMS,
    _BAGIT_HEADER,
    ProductionPackageError,
    PackageDestinationExists,
    BagItValidationError,
    _entry_identity,
    _validate_component,
    _hash_descriptor,
    _open_child_directory,
    _open_child_file,
    _open_file_beneath,
    _OwnedEntries,
    _write_owned_file,
)


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
