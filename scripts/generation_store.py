"""Immutable image job storage and management of previously saved generation caches."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import time
from uuid import uuid4

CACHE_SCHEMA_VERSION = 1
ONE_SHOT_CACHE_TTL = timedelta(days=30)
DEFAULT_CACHE_ROOT = Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "generation-cache"
UUID_RE = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
CACHE_ID_RE = re.compile(r"[a-f0-9]{64}\Z")
MAX_PNG = 20 * 1024 * 1024
MAX_JSON = 8 * 1024 * 1024


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_id(value):
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise ValueError("画像生成job IDが正しいUUIDではありません")
    return value


def text(value, label, maximum=40000, required=True):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError(f"{label}の形式または長さが正しくありません")
    return value


def valid_cache_owner_id(value):
    return isinstance(value, str) and 0 < len(value) <= 200 and bool(value.strip()) \
        and all(ord(character) >= 32 and ord(character) != 127 for character in value)


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


def parse_utc(value):
    if not isinstance(value, str):
        raise ValueError("生成キャッシュの日時が不正です")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("生成キャッシュの日時にタイムゾーンがありません")
    return parsed.astimezone(timezone.utc)


class GenerationCacheStore:
    """Inspect and delete saved reference caches without loading a generation model."""

    def __init__(self, root: Path):
        # Canonicalize only the configured base (macOS /var is a symlink). Every
        # profile/owner/entry component below it is opened with O_NOFOLLOW.
        self.root = Path(os.path.realpath(root.absolute()))

    @contextmanager
    def lock(self, *, create=False):
        import fcntl
        with directory_fd(self.root, create=create) as root_fd:
            lock_fd = os.open(".cache.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
            try:
                if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
                    raise ValueError("生成キャッシュのlock fileが通常ファイルではありません")
                fcntl.flock(lock_fd, fcntl.LOCK_EX)
                yield root_fd
            finally:
                os.close(lock_fd)

    @staticmethod
    def owner_hash(kind, owner_id):
        return sha256(f"{kind}\0{owner_id}".encode("utf-8"))

    @staticmethod
    def _entry(entry_fd, profile_id, kind, owner_hash, entry_id):
        metadata_raw, metadata_info = read_regular_at(entry_fd, "metadata.json", 32768)
        latent_raw, latent_info = read_regular_at(entry_fd, "reference.safetensors", 64 * 1024 * 1024)
        metadata = json.loads(metadata_raw.decode("utf-8"))
        if not isinstance(metadata, dict):
            raise ValueError("生成キャッシュのmetadataとlatentが一致しません")
        owner_id = metadata.get("owner_id")
        identity = {key: metadata.get(key) for key in (
            "schema_version", "profile_id", "owner_kind", "owner_id", "source_sha256",
            "target_width", "target_height", "fit_mode", "fit_algorithm_version", "vae_sha256",
        )}
        dimensions = [metadata.get(key) for key in ("source_width", "source_height", "target_width", "target_height")]
        if metadata.get("schema_version") != CACHE_SCHEMA_VERSION or metadata.get("profile_id") != profile_id \
                or metadata.get("owner_kind") != kind or metadata.get("entry_id") != entry_id \
                or not valid_cache_owner_id(owner_id) \
                or GenerationCacheStore.owner_hash(kind, owner_id) != owner_hash \
                or any(not isinstance(metadata.get(key), str) or not CACHE_ID_RE.fullmatch(metadata[key])
                       for key in ("source_sha256", "vae_sha256")) \
                or any(isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 4096 for value in dimensions) \
                or metadata.get("fit_mode") not in {"fit", "crop (legacy)"} \
                or not isinstance(metadata.get("fit_algorithm_version"), str) or not metadata["fit_algorithm_version"] \
                or entry_id != sha256(canonical(identity)) \
                or metadata.get("latent_byte_size") != len(latent_raw) \
                or metadata.get("latent_sha256") != sha256(latent_raw):
            raise ValueError("生成キャッシュのmetadataとlatentが一致しません")
        last_used = parse_utc(metadata.get("last_used_at"))
        return {
            "profile_id": profile_id,
            "profile_label": text(metadata.get("profile_label"), "生成profile名", 500),
            "owner_kind": kind,
            "owner_id": text(metadata.get("owner_id"), "作品ID", 200),
            "owner_label": text(metadata.get("owner_label"), "作品名", 500),
            "entry_id": entry_id,
            "last_used_at": last_used,
            "byte_size": metadata_info.st_size + latent_info.st_size,
        }

    def _entries_locked(self, root_fd):
        entries, invalid = [], 0
        for profile_id in sorted(name for name in os.listdir(root_fd) if CACHE_ID_RE.fullmatch(name)):
            try:
                profile_fd = open_child_directory(root_fd, profile_id)
            except (FileNotFoundError, NotADirectoryError, OSError):
                invalid += 1
                continue
            try:
                for kind in sorted(name for name in os.listdir(profile_fd) if name in {"series", "one-shot"}):
                    try:
                        kind_fd = open_child_directory(profile_fd, kind)
                    except (FileNotFoundError, NotADirectoryError, OSError):
                        invalid += 1
                        continue
                    try:
                        for owner_hash in sorted(name for name in os.listdir(kind_fd) if CACHE_ID_RE.fullmatch(name)):
                            try:
                                owner_fd = open_child_directory(kind_fd, owner_hash)
                            except (FileNotFoundError, NotADirectoryError, OSError):
                                invalid += 1
                                continue
                            try:
                                for entry_id in sorted(name for name in os.listdir(owner_fd) if CACHE_ID_RE.fullmatch(name)):
                                    try:
                                        entry_fd = open_child_directory(owner_fd, entry_id)
                                        try:
                                            entries.append(self._entry(entry_fd, profile_id, kind, owner_hash, entry_id))
                                        finally:
                                            os.close(entry_fd)
                                    except (FileNotFoundError, NotADirectoryError, OSError, ValueError, json.JSONDecodeError, UnicodeDecodeError):
                                        invalid += 1
                            finally:
                                os.close(owner_fd)
                    finally:
                        os.close(kind_fd)
            finally:
                os.close(profile_fd)
        return entries, invalid

    def summary(self, *, now=None):
        current = now or datetime.now(timezone.utc)
        try:
            with self.lock() as root_fd:
                entries, invalid = self._entries_locked(root_fd)
        except FileNotFoundError:
            entries, invalid = [], 0
        profiles = {}
        for entry in entries:
            profile = profiles.setdefault(entry["profile_id"], {
                "profile_id": entry["profile_id"], "label": entry["profile_label"],
                "entry_count": 0, "byte_size": 0, "owners": {},
            })
            owner_key = (entry["owner_kind"], entry["owner_id"])
            owner = profile["owners"].setdefault(owner_key, {
                "kind": entry["owner_kind"], "id": entry["owner_id"], "label": entry["owner_label"],
                "entry_count": 0, "byte_size": 0, "last_used_at": entry["last_used_at"],
            })
            profile["entry_count"] += 1
            profile["byte_size"] += entry["byte_size"]
            owner["entry_count"] += 1
            owner["byte_size"] += entry["byte_size"]
            owner["last_used_at"] = max(owner["last_used_at"], entry["last_used_at"])
        result = []
        for profile in profiles.values():
            owners = []
            for owner in profile.pop("owners").values():
                last_used = owner.pop("last_used_at")
                owner["last_used_at"] = last_used.isoformat()
                owner["expires_at"] = (last_used + ONE_SHOT_CACHE_TTL).isoformat() if owner["kind"] == "one-shot" else None
                owner["expired"] = owner["kind"] == "one-shot" and current >= last_used + ONE_SHOT_CACHE_TTL
                owners.append(owner)
            profile["owners"] = sorted(owners, key=lambda item: (item["kind"], item["label"], item["id"]))
            result.append(profile)
        return {"root": str(self.root), "profiles": sorted(result, key=lambda item: item["label"]),
                "invalid_entry_count": invalid}

    def cleanup_expired(self, *, now=None):
        current = now or datetime.now(timezone.utc)
        removed = 0
        try:
            with self.lock() as root_fd:
                entries, _invalid = self._entries_locked(root_fd)
                for entry in entries:
                    if entry["owner_kind"] != "one-shot" or current < entry["last_used_at"] + ONE_SHOT_CACHE_TTL:
                        continue
                    profile_fd = open_child_directory(root_fd, entry["profile_id"])
                    try:
                        kind_fd = open_child_directory(profile_fd, "one-shot")
                        try:
                            owner_name = self.owner_hash("one-shot", entry["owner_id"])
                            owner_fd = open_child_directory(kind_fd, owner_name)
                            try:
                                if remove_tree_at(owner_fd, entry["entry_id"]):
                                    removed += 1
                            finally:
                                os.close(owner_fd)
                        finally:
                            os.close(kind_fd)
                    finally:
                        os.close(profile_fd)
        except FileNotFoundError:
            pass
        return removed

    def delete(self, body):
        if not isinstance(body, dict):
            raise ValueError("生成キャッシュの削除指定が不正です")
        scope = body.get("scope")
        if scope not in {"profile", "owner"}:
            raise ValueError("生成キャッシュの削除範囲が不正です")
        deleted = False
        try:
            with self.lock() as root_fd:
                if scope == "profile":
                    profile_id = body.get("profile_id")
                    if not isinstance(profile_id, str) or not CACHE_ID_RE.fullmatch(profile_id):
                        raise ValueError("削除する生成profileが不正です")
                    deleted = remove_tree_at(root_fd, profile_id)
                else:
                    kind, owner_id = body.get("owner_kind"), body.get("owner_id")
                    if kind not in {"series", "one-shot"} or not valid_cache_owner_id(owner_id):
                        raise ValueError("削除する作品キャッシュが不正です")
                    owner_hash = self.owner_hash(kind, owner_id)
                    for profile_id in sorted(name for name in os.listdir(root_fd) if CACHE_ID_RE.fullmatch(name)):
                        try:
                            profile_fd = open_child_directory(root_fd, profile_id)
                        except (FileNotFoundError, NotADirectoryError):
                            continue
                        try:
                            try:
                                kind_fd = open_child_directory(profile_fd, kind)
                            except (FileNotFoundError, NotADirectoryError):
                                continue
                            try:
                                deleted = remove_tree_at(kind_fd, owner_hash) or deleted
                            finally:
                                os.close(kind_fd)
                        finally:
                            os.close(profile_fd)
        except FileNotFoundError:
            pass
        return {"ok": True, "deleted": deleted, "summary": self.summary()}


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
