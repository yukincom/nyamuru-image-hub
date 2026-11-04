"""Read bounded, descriptor-pinned directories and files into the workspace scan."""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path

from workspace_inspection_contract import (
    READ_CHUNK_SIZE,
    _entry_identity,
    _file_identity,
    _directory_flags,
    _file_flags,
)


class WorkspaceFileScan:
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
