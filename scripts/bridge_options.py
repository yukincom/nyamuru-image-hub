"""Command-line options and loopback binding for the local bridge."""
from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path

from nyamuru_analog_asset_store import DEFAULT_IMAGE_HUB_ROOT
from nyamuru_bridge_constants import (
    PANEL_ACTION_LLM_MODE_AUTO,
    PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED,
    PANEL_ACTION_LLM_MODE_MANAGED,
)
from nyamuru_comfy_draft import DEFAULT_COMFYUI_URL
from nyamuru_panel_actions import DEFAULT_PANEL_ACTION_LLM_URL
from nyamuru_series_catalog_store import DEFAULT_SERIES_CATALOG_ROOT
from nyamuru_worker_runtime import default_vision_paths, default_vlm_paths


def parse_args() -> argparse.Namespace:
    defaults = default_vision_paths()
    vlm_defaults = default_vlm_paths()
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--vision-root", type=Path, default=defaults["vision_root"])
    parser.add_argument("--vision-python", type=Path, default=defaults["vision_python"])
    parser.add_argument("--rtdetr-model", type=Path, default=defaults["rtdetr_model"])
    parser.add_argument("--baberu-model", type=Path, default=defaults["baberu_model"])
    parser.add_argument("--wd-expression-model", type=Path, default=defaults["wd_expression_model"])
    parser.add_argument("--wd-expression-tags", type=Path, default=defaults["wd_expression_tags"])
    parser.add_argument(
        "--wd-expression-threshold",
        type=float,
        default=float(os.environ.get("NYAMURU_WD_EXPRESSION_THRESHOLD", "0.35")),
    )
    parser.add_argument("--vlm-python", type=Path, default=vlm_defaults["vlm_python"])
    parser.add_argument("--vlm-model", type=Path, default=vlm_defaults["vlm_model"])
    parser.add_argument("--vlm-model-label", default=vlm_defaults["vlm_model_label"])
    parser.add_argument(
        "--series-root",
        type=Path,
        default=Path(os.environ.get("NYAMURU_SERIES_CATALOG_ROOT", DEFAULT_SERIES_CATALOG_ROOT)).expanduser(),
    )
    parser.add_argument(
        "--image-hub-root",
        type=Path,
        default=Path(os.environ.get("NYAMURU_IMAGE_HUB_ROOT", DEFAULT_IMAGE_HUB_ROOT)).expanduser(),
    )
    parser.add_argument(
        "--llm-url",
        default=os.environ.get("NYAMURU_PANEL_ACTION_LLM_URL", DEFAULT_PANEL_ACTION_LLM_URL),
    )
    parser.add_argument(
        "--llm-mode",
        choices=(PANEL_ACTION_LLM_MODE_AUTO, PANEL_ACTION_LLM_MODE_MANAGED, PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED),
        default=(
            os.environ.get("NYAMURU_PANEL_ACTION_LLM_MODE", PANEL_ACTION_LLM_MODE_AUTO).strip()
            or PANEL_ACTION_LLM_MODE_AUTO
        ),
    )
    parser.add_argument(
        "--comfyui-url",
        default=os.environ.get("NYAMURU_COMFYUI_URL", DEFAULT_COMFYUI_URL),
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-vlm", action="store_true")
    return parser.parse_args()


def checked_loopback_bind_host(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("ローカルbridgeのbind先が正しくありません")
    host = value.strip()
    normalized = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    if normalized.lower() == "localhost":
        return host
    try:
        if ipaddress.ip_address(normalized).is_loopback:
            return host
    except ValueError:
        pass
    raise ValueError("ローカルbridgeはloopbackアドレスだけへbindできます")
