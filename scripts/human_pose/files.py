"""素材の境界・ハッシュ・保存を共通化する。"""
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
from urllib.request import Request, urlopen

from scripts.generation_store import canonical, sha256


# 相対パスとリンクを検査し、素材外を読み書きしない。
def asset_path(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("素材パスが不正です")
    parts = PurePosixPath(relative).parts
    if relative.startswith("/") or any(part in {"..", "."} for part in relative.split("/")):
        raise ValueError(f"素材外のパスです: {relative}")
    path = root.absolute()
    if path.is_symlink():
        raise ValueError("素材ルートのリンクは使えません")
    for part in parts:
        path /= part
        if path.is_symlink():
            raise ValueError(f"素材へのリンクは使えません: {relative}")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("素材ルート外です")
    return path


def read_json(path: Path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("JSONが大きすぎます")
    return json.loads(path.read_text(encoding="utf-8"))


# 一時ファイルで置換し、途中終了時も既存の記録を保つ。
def save_json(path: Path, value) -> None:
    raw = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode() + b"\n"
    if path.exists() and path.read_bytes() == raw:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".pose-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def write_original(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError(f"既存の原本と一致しません: {path.name}")
        return
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".original-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(name, path)
        except FileExistsError:
            if path.read_bytes() != raw:
                raise ValueError(f"既存の原本と一致しません: {path.name}")
    finally:
        Path(name).unlink(missing_ok=True)


def fetch(url: str, limit: int = 40 * 1024 * 1024) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "ComicImageHub-PoseCatalog/1"}), timeout=40) as response:
        raw = response.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("取得データが上限を超えています")
    return raw


def record(relative: str, raw: bytes, url: str) -> dict:
    return {"path": relative, "sha256": sha256(raw), "byte_size": len(raw), "url": url,
            "retrieved_at": datetime.now(timezone.utc).isoformat()}


# ヘッダーだけでなく全画素をdecodeして破損を検出する。
def image_info(raw: bytes) -> dict:
    from PIL import Image
    with Image.open(io.BytesIO(raw)) as image:
        if image.format not in {"WEBP", "PNG", "JPEG"} or max(image.size) > 8192:
            raise ValueError("対応外の参照画像です")
        image.load()
        return {"width": image.width, "height": image.height, "format": image.format}
