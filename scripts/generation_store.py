"""Immutable image job storage and management of previously saved generation caches."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import io
import json
import os
import re
import time
from pathlib import Path
from uuid import uuid4

from generation_cache_store import (
    CACHE_SCHEMA_VERSION,
    ONE_SHOT_CACHE_TTL,
    DEFAULT_CACHE_ROOT,
    CACHE_ID_RE,
    valid_cache_owner_id,
    parse_utc,
    GenerationCacheStore,
)
from generation_files import (
    canonical,
    sha256,
    text,
    directory_fd,
    read_regular_at,
    open_child_directory,
    remove_tree_at,
)


UUID_RE = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
MAX_PNG = 20 * 1024 * 1024
MAX_JSON = 8 * 1024 * 1024

def checked_id(value):
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise ValueError("画像生成job IDが正しいUUIDではありません")
    return value


def validate_png(raw: bytes, *, native_size=False):
    """Let Pillow check PNG chunks once, then decode within the pixel limit."""
    if not isinstance(raw, bytes) or not 33 <= len(raw) <= MAX_PNG or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("画像がPNGではないか、20MiBを超えています")
    from PIL import Image
    with Image.open(io.BytesIO(raw)) as image:
        dimensions = image.size
        if native_size:
            if min(dimensions) < 1 or max(dimensions) > 16384 or dimensions[0] * dimensions[1] > 100_000_000:
                raise ValueError("参照画像が処理可能な画素数を超えています")
        elif min(dimensions) < 1 or max(dimensions) > 4096:
            raise ValueError("参照PNGは4096px以内の入力用コピーにしてください")
        if image.format != "PNG" or getattr(image, "is_animated", False):
            raise ValueError("静止PNGを指定してください")
        image.verify()
    with Image.open(io.BytesIO(raw)) as image:
        image.load()
    return dimensions


class JobStore:
    def __init__(self, root: Path):
        self.root = root.absolute()

    @contextmanager
    def lock(self):
        # POSIX flock also protects against two bridge processes, and releases on crash.
        import fcntl
        with directory_fd(self.root, create=True) as root_fd:
            fd = os.open(".jobs.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX)
                yield
            finally:
                os.close(fd)

    def ids(self):
        try:
            with directory_fd(self.root) as fd:
                return sorted(name for name in os.listdir(fd) if UUID_RE.fullmatch(name))
        except FileNotFoundError:
            return []

    def create(self, job_id):
        with directory_fd(self.root, create=True) as fd:
            try:
                os.mkdir(checked_id(job_id), mode=0o700, dir_fd=fd)
                os.fsync(fd)
                return True
            except FileExistsError:
                return False

    def read(self, job_id, name):
        with directory_fd(self.root / checked_id(job_id)) as fd:
            source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            with os.fdopen(source, 'rb') as stream:
                return stream.read()

    def json(self, job_id, name):
        return json.loads(self.read(job_id, name).decode("utf-8"))

    def write_once(self, job_id, name, raw):
        with directory_fd(self.root / checked_id(job_id)) as fd:
            temporary = f".pending-{uuid4()}"
            destination = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            try:
                remaining = memoryview(raw)
                while remaining:
                    count = os.write(destination, remaining)
                    if count <= 0:
                        raise OSError("画像生成保存ファイルに書き込めません")
                    remaining = remaining[count:]
                os.fsync(destination)
                # Publish the complete inode atomically, without replacing a prior file.
                os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
                os.fsync(fd)
            finally:
                os.close(destination)
                os.unlink(temporary, dir_fd=fd)

    def event(self, job_id, status, error=""):
        previous = self.latest(job_id)
        if previous.get("status") == status and previous.get("error", "") == error:
            return
        self.write_once(job_id, f"event-{time.time_ns():020d}-{uuid4()}.json", canonical({
            "status": status, "error": error, "at": datetime.now(timezone.utc).isoformat(),
        }))

    def latest(self, job_id):
        with directory_fd(self.root / checked_id(job_id)) as fd:
            names = sorted(name for name in os.listdir(fd) if re.fullmatch(r"event-\d{20}-[a-f0-9-]{36}\.json", name))
        return self.json(job_id, names[-1]) if names else {"status": "preparing"}
