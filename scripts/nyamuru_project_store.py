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
import struct
import zlib
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


MAX_EXPORT_YAML_FILES = 10
MAX_EXPORT_YAML_BYTES = 16 * 1024 * 1024


def _validated_yaml_file(entry: object) -> tuple[str, bytes]:
    if not isinstance(entry, dict):
        raise ValueError("書き出しデータの形式が不正です")
    file_name = entry.get("fileName")
    text = entry.get("content") if "content" in entry else entry.get("yaml")
    if not isinstance(file_name, str) or not isinstance(text, str):
        raise ValueError("ファイル名または本文が不正です")
    if not file_name or len(file_name) > 255 or "/" in file_name or "\\" in file_name or "\x00" in file_name:
        raise ValueError("ファイル名が不正です")
    if file_name.startswith(".") or not file_name.endswith((".yaml", ".json")):
        raise ValueError("ファイル名は .yaml または .json で終わる通常ファイル名のみ許可されます")
    raw = text.encode("utf-8")
    if len(raw) > MAX_EXPORT_YAML_BYTES:
        raise ValueError("書き出しサイズが上限の16MiBを超えています")
    return file_name, raw


def _render_cutline_guide_png(page: dict) -> bytes:
    """Render a thin light-blue cut-line layout guide PNG for a cloud generation page."""
    canvas = page.get("canvas") if isinstance(page.get("canvas"), dict) else {}
    w_mm = float(canvas.get("w") or 182)
    h_mm = float(canvas.get("h") or 257)
    scale = 5
    width = max(1, int(round(w_mm * scale)))
    height = max(1, int(round(h_mm * scale)))
    buf = bytearray([255] * (width * height * 3))
    r, g, b = 140, 205, 240

    def fill_rect(x0: float, y0: float, x1: float, y1: float) -> None:
        ix0, iy0 = max(0, int(round(x0))), max(0, int(round(y0)))
        ix1, iy1 = min(width, int(round(x1))), min(height, int(round(y1)))
        if ix1 <= ix0 or iy1 <= iy0:
            return
        row = bytes([r, g, b]) * (ix1 - ix0)
        for y in range(iy0, iy1):
            start = (y * width + ix0) * 3
            buf[start:start + len(row)] = row

    def draw_line(x0: float, y0: float, x1: float, y1: float, thickness: int = 2) -> None:
        steps = max(1, int(max(abs(x1 - x0), abs(y1 - y0))))
        half = thickness / 2.0
        for step in range(steps + 1):
            t = step / steps
            px = x0 + (x1 - x0) * t
            py = y0 + (y1 - y0) * t
            fill_rect(px - half, py - half, px + half, py + half)

    rects: list[tuple[float, float, float, float]] = []
    for panel in page.get("panels") or []:
        shape = panel.get("shape") if isinstance(panel, dict) else None
        if not isinstance(shape, dict):
            continue
        if shape.get("type") == "polygon" and isinstance(shape.get("points"), list):
            pts = [(float(pt[0]) * scale, float(pt[1]) * scale) for pt in shape["points"] if isinstance(pt, (list, tuple)) and len(pt) == 2]
            for i in range(len(pts)):
                draw_line(pts[i][0], pts[i][1], pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1], 2)
        elif shape.get("type") == "rect":
            x = float(shape.get("x") or 0)
            y = float(shape.get("y") or 0)
            w = float(shape.get("w") or 0)
            h = float(shape.get("h") or 0)
            rects.append((x, y, x + w, y + h))

    if rects:
        min_x = min(item[0] for item in rects) * scale
        min_y = min(item[1] for item in rects) * scale
        max_x = max(item[2] for item in rects) * scale
        max_y = max(item[3] for item in rects) * scale
        fill_rect(min_x, min_y, max_x, min_y + 2)
        fill_rect(min_x, max_y - 2, max_x, max_y)
        fill_rect(min_x, min_y, min_x + 2, max_y)
        fill_rect(max_x - 2, min_y, max_x, max_y)
        for i, a in enumerate(rects):
            for b_rect in rects[i + 1:]:
                # Horizontal cut line when one panel is directly above the other with horizontal overlap
                if a[2] > b_rect[0] and b_rect[2] > a[0]:
                    ov_x0 = max(a[0], b_rect[0]) * scale
                    ov_x1 = min(a[2], b_rect[2]) * scale
                    if 0 <= b_rect[1] - a[3] <= 20:
                        mid_y = ((a[3] + b_rect[1]) / 2.0) * scale
                        fill_rect(ov_x0, mid_y - 1, ov_x1, mid_y + 1)
                    elif 0 <= a[1] - b_rect[3] <= 20:
                        mid_y = ((b_rect[3] + a[1]) / 2.0) * scale
                        fill_rect(ov_x0, mid_y - 1, ov_x1, mid_y + 1)
                # Vertical cut line when one panel is beside the other with vertical overlap
                if a[3] > b_rect[1] and b_rect[3] > a[1]:
                    ov_y0 = max(a[1], b_rect[1]) * scale
                    ov_y1 = min(a[3], b_rect[3]) * scale
                    if 0 <= b_rect[0] - a[2] <= 20:
                        mid_x = ((a[2] + b_rect[0]) / 2.0) * scale
                        fill_rect(mid_x - 1, ov_y0, mid_x + 1, ov_y1)
                    elif 0 <= a[0] - b_rect[2] <= 20:
                        mid_x = ((b_rect[2] + a[0]) / 2.0) * scale
                        fill_rect(mid_x - 1, ov_y0, mid_x + 1, ov_y1)

    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(buf[y * stride:(y + 1) * stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b"")


def _atomic_write_in_dir(root: int, file_name: str, raw: bytes) -> None:
    temp_name = f".export-{secrets.token_hex(12)}.tmp"
    try:
        fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, file_name, src_dir_fd=root, dst_dir_fd=root)
    finally:
        try:
            os.unlink(temp_name, dir_fd=root)
        except FileNotFoundError:
            pass


def export_yaml_files(directory: Path, files: object) -> dict:
    """Write validated .yaml/.json files (and cutline guide PNGs when requested) atomically."""
    if not isinstance(files, list) or not files or len(files) > MAX_EXPORT_YAML_FILES:
        raise ValueError("書き出すYAMLファイル一覧が不正です")
    validated = [_validated_yaml_file(entry) for entry in files]
    extra_pngs: list[tuple[str, bytes]] = []
    for file_name, raw in validated:
        if not file_name.endswith("-cloud.json"):
            continue
        try:
            spec = json.loads(raw)
        except ValueError:
            continue
        if isinstance(spec, dict) and (spec.get("render_options") or {}).get("export_reference_images") is True:
            for page in spec.get("pages") or []:
                if not isinstance(page, dict):
                    continue
                guide_name = page.get("guide_image")
                if isinstance(guide_name, str) and guide_name.endswith(".png") and "/" not in guide_name and "\\" not in guide_name and not guide_name.startswith("."):
                    extra_pngs.append((guide_name, _render_cutline_guide_png(page)))
    root = os.open(directory, DIRECTORY_FLAGS)
    try:
        written: list[str] = []
        for file_name, raw in validated:
            _atomic_write_in_dir(root, file_name, raw)
            written.append(file_name)
        for guide_name, png_bytes in extra_pngs:
            _atomic_write_in_dir(root, guide_name, png_bytes)
            written.append(guide_name)
        os.fsync(root)
    finally:
        os.close(root)
    return {"ok": True, "files": written}
