"""Read Image Capture preferences, identify new scan files, and build image previews."""

from __future__ import annotations

import base64
import io
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse


SCANNER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}

def image_capture_preference(key: str, fallback: str) -> str:
    try:
        result = subprocess.run(
            ["/usr/bin/defaults", "read", "com.apple.Image_Capture", key],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        )
        value = re.sub(
            r"\\[uU]([0-9a-fA-F]{4})",
            lambda match: chr(int(match.group(1), 16)),
            result.stdout.strip(),
        )
        return value or fallback
    except (OSError, subprocess.SubprocessError):
        return fallback


def quit_image_capture() -> None:
    subprocess.run(
        [
            "/usr/bin/osascript",
            "-e",
            'if application id "com.apple.Image_Capture" is running then tell application id "com.apple.Image_Capture" to quit',
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )


def scanner_destination() -> Path:
    configured = image_capture_preference("IK_Scanner_downloadURL", "~/Pictures")
    if configured.startswith("file://"):
        from urllib.parse import unquote

        configured = unquote(urlparse(configured).path)
    destination = Path(configured).expanduser().resolve()
    if not destination.is_dir():
        raise ValueError(f"イメージキャプチャの保存先が見つかりません: {destination}")
    return destination


def scanner_document_prefix() -> str:
    return image_capture_preference("IK_documentName", "スキャン").strip() or "スキャン"


def scanner_image_files(directory: Path, prefix: str) -> list[Path]:
    try:
        files = list(directory.iterdir())
    except OSError as exc:
        raise ValueError(f"スキャン保存先を読み取れません: {directory}") from exc
    return [
        path for path in files
        if path.is_file() and path.suffix.lower() in SCANNER_EXTENSIONS and path.stem.startswith(prefix)
    ]


def scanner_file_signature(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def scanner_preview(path: Path) -> tuple[str, str]:
    from PIL import Image, ImageOps

    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((1800, 1800))
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=92, optimize=True)
    return "image/jpeg", base64.b64encode(output.getvalue()).decode("ascii")
