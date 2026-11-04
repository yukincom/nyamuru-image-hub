"""Read and save immutable source coverage reports within the selected episode."""

from __future__ import annotations

import os
import secrets
import stat
from pathlib import Path
from typing import Any

from source_coverage_contract import MAX_SOURCE_COVERAGE_REPORT_BYTES, CoverageReportConflict


class SourceCoverageFiles:
    @staticmethod
    def _coverage_directory_flags() -> int:
        required = ("O_DIRECTORY", "O_NOFOLLOW", "O_CLOEXEC")
        if any(not hasattr(os, name) for name in required):
            raise ValueError("このOSではcoverage reportを安全に保存できません")
        return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

    @classmethod
    def _open_coverage_root(cls, path: Path) -> int:
        listed = path.stat(follow_symlinks=False)
        if not stat.S_ISDIR(listed.st_mode):
            raise ValueError("エピソード保存先を安全に使用できません")
        descriptor = os.open(path, cls._coverage_directory_flags())
        opened = os.fstat(descriptor)
        if not stat.S_ISDIR(opened.st_mode) or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino):
            os.close(descriptor)
            raise ValueError("エピソード保存先が検証中に変更されました")
        return descriptor

    @classmethod
    def _open_or_create_coverage_directory(cls, parent_fd: int, name: str) -> int:
        try:
            listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.mkdir(name, 0o700, dir_fd=parent_fd)
            except FileExistsError:
                pass
            listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(listed.st_mode):
            raise ValueError(f"{name}をcoverage report保存先に使用できません")
        descriptor = os.open(name, cls._coverage_directory_flags(), dir_fd=parent_fd)
        opened = os.fstat(descriptor)
        parent = os.fstat(parent_fd)
        if not stat.S_ISDIR(opened.st_mode) \
                or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino) \
                or opened.st_dev != parent.st_dev:
            os.close(descriptor)
            raise ValueError(f"{name}が検証中に変更されました")
        return descriptor

    @classmethod
    def _verify_coverage_directory_chain(
        cls,
        episode: Path,
        root_fd: int,
        name_data_fd: int,
        coverage_fd: int,
    ) -> None:
        root_listed = episode.stat(follow_symlinks=False)
        name_data_listed = os.stat("name_data", dir_fd=root_fd, follow_symlinks=False)
        coverage_listed = os.stat("coverage", dir_fd=name_data_fd, follow_symlinks=False)
        root_opened = os.fstat(root_fd)
        name_data_opened = os.fstat(name_data_fd)
        coverage_opened = os.fstat(coverage_fd)
        entries = (
            ("エピソード保存先", root_listed, root_opened),
            ("name_data", name_data_listed, name_data_opened),
            ("coverage", coverage_listed, coverage_opened),
        )
        for label, listed, opened in entries:
            if not stat.S_ISDIR(listed.st_mode) or not stat.S_ISDIR(opened.st_mode) \
                    or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino):
                raise ValueError(f"{label}が保存中に差し替えられました")
        if name_data_opened.st_dev != root_opened.st_dev or coverage_opened.st_dev != root_opened.st_dev:
            raise ValueError("coverage report保存先が別deviceを参照しています")

    @staticmethod
    def _unlink_coverage_entry_if_identity(
        directory_fd: int,
        name: str,
        identity: tuple[int, int],
    ) -> bool:
        try:
            current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            return False
        if identity != (current.st_dev, current.st_ino):
            return False
        os.unlink(name, dir_fd=directory_fd)
        return True

    @classmethod
    def _open_existing_workspace_directory(cls, parent_fd: int, name: str) -> int:
        if name in {"", ".", ".."} or "/" in name or "\\" in name or "\x00" in name:
            raise ValueError("文章ファイルの保存場所を安全に使用できません")
        listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(listed.st_mode):
            raise ValueError("文章ファイルの保存場所にsymlinkまたは通常でない項目があります")
        descriptor = os.open(name, cls._coverage_directory_flags(), dir_fd=parent_fd)
        opened = os.fstat(descriptor)
        parent = os.fstat(parent_fd)
        if not stat.S_ISDIR(opened.st_mode) \
                or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino) \
                or opened.st_dev != parent.st_dev:
            os.close(descriptor)
            raise ValueError("文章ファイルの保存場所が検証中に変更されました")
        return descriptor

    @classmethod
    def _open_selected_workspace_text(cls, workspace: Path, path: Path) -> tuple[int, str | None]:
        if not path.is_absolute():
            raise ValueError("選択した文章ファイルの場所が正しくありません")
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
        try:
            relative = path.relative_to(workspace)
        except ValueError:
            return os.open(path, flags), None
        parts = relative.parts
        if not parts or any(part in {"", ".", ".."} or "/" in part or "\\" in part or "\x00" in part for part in parts):
            raise ValueError("選択した文章ファイルの相対pathが正しくありません")
        root_fd = cls._open_coverage_root(workspace)
        parent_fd = root_fd
        try:
            for part in parts[:-1]:
                child_fd = cls._open_existing_workspace_directory(parent_fd, part)
                if parent_fd != root_fd:
                    os.close(parent_fd)
                parent_fd = child_fd
            descriptor = os.open(parts[-1], flags, dir_fd=parent_fd)
            opened = os.fstat(descriptor)
            parent = os.fstat(parent_fd)
            if opened.st_dev != parent.st_dev:
                os.close(descriptor)
                raise ValueError("文章ファイルがエピソード保存先の外側を参照しています")
            return descriptor, relative.as_posix()
        finally:
            if parent_fd != root_fd:
                os.close(parent_fd)
            os.close(root_fd)

    @staticmethod
    def _read_coverage_file(directory_fd: int, name: str) -> bytes:
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
        descriptor = os.open(name, flags, dir_fd=directory_fd)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE_COVERAGE_REPORT_BYTES:
                raise CoverageReportConflict("既存coverage reportを安全に確認できません")
            chunks: list[bytes] = []
            remaining = MAX_SOURCE_COVERAGE_REPORT_BYTES + 1
            while remaining > 0:
                chunk = os.read(descriptor, min(1024 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            after = os.fstat(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != \
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise CoverageReportConflict("既存coverage reportが検証中に変更されました")
            data = b"".join(chunks)
            if len(data) > MAX_SOURCE_COVERAGE_REPORT_BYTES:
                raise CoverageReportConflict("既存coverage reportが保存上限を超えています")
            return data
        finally:
            os.close(descriptor)

    def save_source_coverage(
        self,
        token_value: object,
        expected_episode_id_value: object,
        report_value: object,
    ) -> dict[str, Any]:
        data, digest = self._checked_coverage_report(report_value, expected_episode_id_value)
        episode = self.directory(token_value)
        final_name = f"source-coverage-{digest}.json"
        relative_path = f"name_data/coverage/{final_name}"
        with self.lock:
            root_fd = self._open_coverage_root(episode)
            name_data_fd = -1
            coverage_fd = -1
            staging_fd = -1
            temporary_name = f".source-coverage-{secrets.token_hex(16)}.tmp"
            temporary_identity: tuple[int, int] | None = None
            created_final_identity: tuple[int, int] | None = None
            try:
                name_data_fd = self._open_or_create_coverage_directory(root_fd, "name_data")
                os.fsync(root_fd)
                coverage_fd = self._open_or_create_coverage_directory(name_data_fd, "coverage")
                os.fsync(name_data_fd)
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
                staging_fd = os.open(temporary_name, flags, 0o600, dir_fd=coverage_fd)
                metadata = os.fstat(staging_fd)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != 0:
                    raise OSError("coverage reportのstaging fileを開始できません")
                temporary_identity = (metadata.st_dev, metadata.st_ino)
                written = 0
                while written < len(data):
                    count = os.write(staging_fd, data[written:])
                    if count <= 0:
                        raise OSError("coverage reportを書き切れませんでした")
                    written += count
                os.fsync(staging_fd)
                metadata = os.fstat(staging_fd)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != len(data) \
                        or temporary_identity != (metadata.st_dev, metadata.st_ino):
                    raise OSError("coverage reportのstaging fileを検証できません")
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                current_temporary = os.stat(temporary_name, dir_fd=coverage_fd, follow_symlinks=False)
                if temporary_identity != (current_temporary.st_dev, current_temporary.st_ino):
                    raise OSError("coverage reportのstaging fileが公開前に変更されました")
                try:
                    os.link(
                        temporary_name, final_name,
                        src_dir_fd=coverage_fd, dst_dir_fd=coverage_fd, follow_symlinks=False,
                    )
                    created = True
                    published_metadata = os.stat(final_name, dir_fd=coverage_fd, follow_symlinks=False)
                    created_final_identity = (published_metadata.st_dev, published_metadata.st_ino)
                    current_temporary = os.stat(temporary_name, dir_fd=coverage_fd, follow_symlinks=False)
                    if temporary_identity != (current_temporary.st_dev, current_temporary.st_ino) \
                            or temporary_identity != created_final_identity:
                        raise OSError("coverage reportのstaging fileが公開中に変更されました")
                except FileExistsError:
                    existing = self._read_coverage_file(coverage_fd, final_name)
                    if not secrets.compare_digest(existing, data):
                        raise CoverageReportConflict("同じhash名に異なるcoverage reportが既にあります")
                    created = False
                if created:
                    os.fsync(coverage_fd)
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                published = self._read_coverage_file(coverage_fd, final_name)
                if not secrets.compare_digest(published, data):
                    raise CoverageReportConflict("保存したcoverage reportを再検証できません")
                if not self._unlink_coverage_entry_if_identity(coverage_fd, temporary_name, temporary_identity):
                    raise OSError("coverage reportのstaging fileを安全に削除できません")
                temporary_identity = None
                os.fsync(coverage_fd)
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                if created:
                    created_final_identity = None
                return {
                    "ok": True,
                    "relative_path": relative_path,
                    "sha256": digest,
                    "created": created,
                    "byte_size": len(data),
                }
            finally:
                removed_entry = False
                if coverage_fd >= 0 and created_final_identity is not None:
                    try:
                        removed_entry = self._unlink_coverage_entry_if_identity(
                            coverage_fd, final_name, created_final_identity,
                        ) or removed_entry
                    except OSError:
                        pass
                if coverage_fd >= 0 and temporary_identity is not None:
                    try:
                        removed_entry = self._unlink_coverage_entry_if_identity(
                            coverage_fd, temporary_name, temporary_identity,
                        ) or removed_entry
                    except OSError:
                        pass
                if coverage_fd >= 0 and removed_entry:
                    try:
                        os.fsync(coverage_fd)
                    except OSError:
                        pass
                if staging_fd >= 0:
                    os.close(staging_fd)
                for descriptor in (coverage_fd, name_data_fd, root_fd):
                    if descriptor >= 0:
                        os.close(descriptor)
