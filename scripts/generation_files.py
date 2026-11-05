"""Read and validate bounded generation files and their content identifiers."""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
import stat
from pathlib import Path


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def text(value, label, maximum=40000, required=True):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError(f"{label}の形式または長さが正しくありません")
    return value


@contextmanager
def directory_fd(path: Path, *, create=False):
    """Walk absolute directories without following even intermediate symlinks."""
    path = path.absolute()
    fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    finally:
        os.close(fd)


def read_regular_at(parent_fd, name, maximum):
    source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        info = os.fstat(source)
        if not stat.S_ISREG(info.st_mode) or info.st_size < 1 or info.st_size > maximum:
            raise ValueError("生成キャッシュのファイル形式または容量が不正です")
        parts, length = [], 0
        while True:
            chunk = os.read(source, min(65536, maximum + 1 - length))
            if not chunk:
                break
            parts.append(chunk)
            length += len(chunk)
            if length > maximum:
                raise ValueError("生成キャッシュのファイルが大きすぎます")
        return b"".join(parts), info
    finally:
        os.close(source)


def open_child_directory(parent_fd, name, *, create=False):
    if create:
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)


def remove_tree_at(parent_fd, name):
    """Remove one already-validated cache directory without following links."""
    try:
        child_fd = open_child_directory(parent_fd, name)
    except FileNotFoundError:
        return False
    try:
        for child in os.listdir(child_fd):
            info = os.stat(child, dir_fd=child_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                remove_tree_at(child_fd, child)
            else:
                os.unlink(child, dir_fd=child_fd)
    finally:
        os.close(child_fd)
    os.rmdir(name, dir_fd=parent_fd)
    return True
