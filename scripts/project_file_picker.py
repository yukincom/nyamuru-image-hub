"""Read and list image files explicitly chosen or browsed in the registered project/series directory."""
from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
import re
import sys

from nyamuru_macos_picker import choose_import_images_with_options, choose_workspace_files, default_picker_directory

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SKIP_DIRS = {"analog-assets", "draft_data", "node_modules", "__pycache__"}


def _natural_sort_key(text: str) -> list[tuple[int, int | str]]:
    return [
        (0, int(part)) if part.isdigit() else (1, part)
        for part in re.split(r"([0-9]+)", text.lower())
        if part
    ]


def choose_project_files(directory: object, accept: str, multiple: bool) -> dict:
    selected = choose_workspace_files(default_picker_directory(directory), "file", multiple, accept)
    if selected is None:
        return {"ok": True, "cancelled": True, "files": []}
    return {
        "ok": True,
        "cancelled": False,
        "files": [{
            "name": path.name,
            "type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        } for path in selected],
    }


def list_project_images(directory: object, max_depth: int = 2, max_entries: int = 200) -> dict:
    picked = default_picker_directory(directory)
    if picked is None:
        return {"ok": True, "directory": "", "folder_name": "", "entries": []}
    root = picked.resolve()
    if not root.is_dir():
        return {"ok": True, "directory": "", "folder_name": "", "entries": []}

    found: list[tuple[str, Path]] = []

    def walk(current: Path, depth: int) -> None:
        if len(found) >= max_entries:
            return
        try:
            children = list(current.iterdir())
        except OSError:
            return
        for child in children:
            if child.name.startswith("."):
                continue
            try:
                resolved = child.resolve()
                resolved.relative_to(root)
            except (OSError, ValueError):
                continue
            if resolved.is_dir():
                if child.name in SKIP_DIRS or depth >= max_depth:
                    continue
                walk(resolved, depth + 1)
            elif resolved.is_file() and child.suffix.lower() in IMAGE_EXTENSIONS:
                rel = resolved.relative_to(root).as_posix()
                found.append((rel, resolved))
                if len(found) >= max_entries:
                    return

    walk(root, 0)
    found.sort(key=lambda item: _natural_sort_key(item[0]))
    entries = []
    for rel, path in found[:max_entries]:
        try:
            stat = path.stat()
        except OSError:
            continue
        entries.append({
            "rel_path": rel,
            "name": path.name,
            "size": stat.st_size,
            "mtime": stat.st_mtime,
        })
    return {
        "ok": True,
        "directory": str(root),
        "folder_name": root.name,
        "entries": entries,
    }


def read_project_images(directory: object, rel_paths: object) -> dict:
    picked = default_picker_directory(directory)
    if picked is None or not picked.resolve().is_dir():
        raise ValueError("作品フォルダが見つかりません")
    root = picked.resolve()
    if not isinstance(rel_paths, list):
        raise ValueError("読み込むファイルの指定が不正です")
    files = []
    for rel in rel_paths:
        if not isinstance(rel, str) or not rel:
            continue
        try:
            target = (root / rel).resolve()
            target.relative_to(root)
        except (OSError, ValueError) as exc:
            raise ValueError("作品フォルダ外のファイルは読み込めません") from exc
        if not target.is_file() or target.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        files.append({
            "name": target.name,
            "rel_path": rel,
            "type": mimetypes.guess_type(target.name)[0] or "application/png",
            "data": base64.b64encode(target.read_bytes()).decode("ascii"),
        })
    return {"ok": True, "files": files}


def choose_import_images(directory: object) -> dict:
    picked = choose_import_images_with_options(default_picker_directory(directory))
    if picked is None:
        return {"ok": True, "supported": False, "cancelled": False, "files": [], "options": None}
    if picked.get("cancelled"):
        return {"ok": True, "supported": True, "cancelled": True, "files": [], "options": None}
    files = []
    for raw_path in picked.get("paths", []):
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            continue
        files.append({
            "name": path.name,
            "type": mimetypes.guess_type(path.name)[0] or "image/png",
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        })
    return {
        "ok": True,
        "supported": True,
        "cancelled": False,
        "files": files,
        "options": picked.get("options"),
    }
