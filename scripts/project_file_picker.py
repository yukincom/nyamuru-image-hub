"""Read files explicitly chosen in the registered project/series directory."""
from __future__ import annotations

import base64
import mimetypes

from nyamuru_macos_picker import choose_workspace_files, default_picker_directory


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
