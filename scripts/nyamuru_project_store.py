"""Atomic local snapshots with immutable, content-addressed image/model originals."""

from __future__ import annotations

import sys
import base64
import fcntl
import hashlib
import json
import os
import secrets
import stat
from contextlib import contextmanager
from pathlib import Path

# Allow tools to load the project store directly from its file path.
_script_directory = str(Path(__file__).resolve().parent)
if _script_directory not in sys.path:
    sys.path.insert(0, _script_directory)

from project_snapshot_validation import (
    IMAGE_MEDIA_TYPES,
    MODEL_MEDIA_TYPES,
    PAINT_INKS,
    number,
    box,
    paint_ink,
    image_dimensions,
    validate_model_header,
    validate_background_capture,
    validate_paint,
    validate_snapshot,
)


MAX_PROJECT_BYTES = 96 * 1024 * 1024
PROJECT_FILE = "project.json"
ASSET_DIRECTORY = "assets"
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

def encoded_snapshot(value: dict) -> bytes:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(raw) > MAX_PROJECT_BYTES:
        raise ValueError("画像・3D舞台を含む作品データが保存上限の96MiBを超えています")
    return raw


@contextmanager
def project_directory(directory: Path, create: bool):
    root = os.open(directory, DIRECTORY_FLAGS)
    folder = None
    lock = None
    try:
        if create:
            try:
                os.mkdir(".nyamuru", mode=0o700, dir_fd=root)
            except FileExistsError:
                pass
        folder = os.open(".nyamuru", DIRECTORY_FLAGS, dir_fd=root)
        if create:
            lock = os.open(".save.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            if not stat.S_ISREG(os.fstat(lock).st_mode):
                raise ValueError("保存先のロックファイルが通常のファイルではありません")
            fcntl.flock(lock, fcntl.LOCK_EX)
        yield folder
    finally:
        if lock is not None:
            os.close(lock)
        if folder is not None:
            os.close(folder)
        os.close(root)


def read_regular_file(folder: int, name: str, limit: int) -> bytes:
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError("作品ファイルの形式またはサイズを確認してください")
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("作品ファイルが大きすぎます")
    return raw


def read_asset(folder: int, entry: dict) -> bytes:
    digest = entry["sha256"]
    size = entry["byteLength"]
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("原画像・3D舞台の識別情報が壊れています")
    if entry["path"] != f"{ASSET_DIRECTORY}/{digest}" or type(size) is not int or not 0 < size <= MAX_PROJECT_BYTES:
        raise ValueError("原画像・3D舞台の保存場所またはサイズが壊れています")
    raw = read_regular_file(folder, digest, size)
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("原画像・3D舞台のサイズまたはハッシュが一致しません")
    return raw


def manifest_to_snapshot(folder: int, manifest: object) -> dict:
    if not isinstance(manifest, dict) or manifest.get("version") != 2:
        return validate_snapshot(manifest)
    try:
        entries = manifest["assets"]
        if not isinstance(entries, list):
            raise ValueError()
        # Bound reconstruction before reading binary files, including repeated refs.
        encoded_size = 0
        for entry in entries:
            size = entry["byteLength"]
            if type(size) is not int or not 0 < size <= MAX_PROJECT_BYTES:
                raise ValueError()
            encoded_size += 4 * ((size + 2) // 3)
            if encoded_size > MAX_PROJECT_BYTES:
                raise ValueError("画像・3D舞台を含む作品データが保存上限の96MiBを超えています")
        assets = []
        if entries:
            asset_folder = os.open(ASSET_DIRECTORY, DIRECTORY_FLAGS, dir_fd=folder)
            try:
                for entry in entries:
                    raw = read_asset(asset_folder, entry)
                    assets.append({"id": entry["id"], "type": entry["type"], "data": base64.b64encode(raw).decode("ascii")})
            finally:
                os.close(asset_folder)
        snapshot = {**manifest, "version": 1, "assets": assets}
        encoded_snapshot(snapshot)
        return validate_snapshot(snapshot)
    except (AttributeError, KeyError, TypeError, ValueError, OSError) as error:
        raise ValueError("保存した作品の原画像・3D舞台が不足または破損しています。保存先は変更していません") from error


def read_project(folder: int) -> tuple[dict, str] | None:
    try:
        raw = read_regular_file(folder, PROJECT_FILE, MAX_PROJECT_BYTES)
    except FileNotFoundError:
        return None
    return manifest_to_snapshot(folder, json.loads(raw)), hashlib.sha256(raw).hexdigest()


def load_project(directory: Path) -> dict:
    try:
        with project_directory(directory, create=False) as folder:
            result = read_project(folder)
    except FileNotFoundError:
        result = None
    if result is None:
        raise ValueError("このフォルダには保存した作品がありません。新規作成で指定したエピソードのフォルダを選んでください")
    snapshot, revision = result
    return {"ok": True, "snapshot": snapshot, "revision": revision}


def write_original(folder: int, data: bytes, digest: str) -> None:
    entry = {"path": f"{ASSET_DIRECTORY}/{digest}", "sha256": digest, "byteLength": len(data)}
    try:
        read_asset(folder, entry)
        return
    except FileNotFoundError:
        pass
    name = f".original-{secrets.token_hex(12)}.tmp"
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            # A pre-existing original is never replaced, even in a publication race.
            os.link(name, digest, src_dir_fd=folder, dst_dir_fd=folder, follow_symlinks=False)
        except FileExistsError:
            read_asset(folder, entry)
    finally:
        try:
            os.unlink(name, dir_fd=folder)
        except FileNotFoundError:
            pass


def snapshot_to_manifest(folder: int, value: dict) -> dict:
    entries = []
    if value["assets"]:
        try:
            os.mkdir(ASSET_DIRECTORY, mode=0o700, dir_fd=folder)
        except FileExistsError:
            pass
        asset_folder = os.open(ASSET_DIRECTORY, DIRECTORY_FLAGS, dir_fd=folder)
        try:
            for asset in value["assets"]:
                data = base64.b64decode(asset["data"], validate=True)
                digest = hashlib.sha256(data).hexdigest()
                write_original(asset_folder, data, digest)
                entries.append({"id": asset["id"], "type": asset["type"], "path": f"{ASSET_DIRECTORY}/{digest}", "sha256": digest, "byteLength": len(data)})
            os.fsync(asset_folder)
        finally:
            os.close(asset_folder)
    return {**value, "version": 2, "assets": entries}


def save_project(directory: Path, snapshot: object, expected_revision: object) -> dict:
    value = validate_snapshot(snapshot)
    encoded_snapshot(value)  # The version-1 wire-size limit also applies on disk.
    with project_directory(directory, create=True) as folder:
        previous = read_project(folder)
        if previous:
            if previous[0]["document"]["manga"]["meta"]["episode_id"] != value["document"]["manga"]["meta"]["episode_id"]:
                raise ValueError("このフォルダには別の作品が保存されています。別の保存先を選んでください")
            if expected_revision != previous[1]:
                raise ValueError("保存先の作品が更新されています。「開く」から作品フォルダを開き直してください。現在の編集内容は画面に残しています")
        elif expected_revision is not None:
            raise ValueError("保存済みの作品ファイルが見つかりません。保存先を確認してください")
        raw = encoded_snapshot(snapshot_to_manifest(folder, value))
        name = f".project-{secrets.token_hex(12)}.tmp"
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, PROJECT_FILE, src_dir_fd=folder, dst_dir_fd=folder)
        finally:
            try:
                os.unlink(name, dir_fd=folder)
            except FileNotFoundError:
                pass
    return {"ok": True, "revision": hashlib.sha256(raw).hexdigest()}
