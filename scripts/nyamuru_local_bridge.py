#!/usr/bin/env python3
"""Local-only bridge for Nyamuru's scanner and manga image analysis features."""

from __future__ import annotations

import argparse
import base64
import hashlib
import ipaddress
import importlib.util
import io
import json
import math
import mimetypes
import os
import platform
import re
import secrets
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import zlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT.parent
SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))
from nyamuru_layout_geometry import (
    detect_panel_boxes,
    deduplicate_panel_boxes,
    _group_panel_rows,
    _line_fit,
    _covered_length,
    _maximum_uncovered_gap,
    _row_dividers,
    _infer_row_panel_shapes_from_segments,
    _shape_bounds,
    _box_iou,
    _order_shapes_by_detector_boxes,
    _canonical_quad,
    _transpose_shape,
    _shape_diagonal_deviation,
    infer_panel_shapes_from_segments,
    detect_panel_shapes,
    sort_panel_boxes_reading_order,
    detector_regions,
    detector_boxes,
    detected_person_regions,
    box_area,
    box_intersection_area,
    face_ids_inside,
    exclude_composite_body_regions,
    box_overlap_ratios,
    exclude_non_panel_regions,
    exclude_paired_title_header_boxes,
)
from nyamuru_worker_runtime import (
    ACTIVE_WORKERS,
    ACTIVE_WORKERS_LOCK,
    WORKER_SHUTDOWN_EVENT,
    DEFAULT_VISION_ROOT,
    DEFAULT_VLM_MODEL_LABEL,
    DEFAULT_VLM_CACHE,
    register_worker,
    unregister_worker,
    stop_worker,
    terminate_active_workers,
    venv_python,
    default_vision_paths,
    cached_model_snapshot,
    huggingface_hub_cache,
    default_vlm_paths,
    run_worker_process,
    run_local_worker,
    run_mlx_vlm_worker,
    run_figure_performance_worker,
    run_character_reference_worker,
    run_character_reference_set_worker,
    run_character_match_worker,
)
from nyamuru_ocr_util import (
    decode_image_data,
    normalized_rotation_override,
    ocr_text_quality,
    usable_ocr_lines,
    rotated_image_bytes,
)
from nyamuru_macos_picker import (
    run_macos_picker,
    default_picker_directory,
    choose_episode_directory,
    choose_series_directory,
    choose_workspace_files,
)
from nyamuru_scanner_sessions import (
    SCANNER_WINDOW_SECONDS,
    SCANNER_MAX_FILES,
    SCANNER_STABLE_SECONDS,
    SCANNER_EXTENSIONS,
    DEFAULT_SCANNER_STATE_PATH,
    image_capture_preference,
    quit_image_capture,
    scanner_destination,
    scanner_document_prefix,
    scanner_image_files,
    scanner_file_signature,
    scanner_preview,
    ObservedScan,
    ScannerSession,
    ScannerSessions,
)
from nyamuru_analog_asset_store import (
    ANALOG_ASSET_FILE_PATTERN,
    ANALOG_ASSET_KINDS,
    AnalogAssetStore,
    DEFAULT_IMAGE_HUB_ROOT,
)
from nyamuru_series_catalog_store import (
    DEFAULT_SERIES_CATALOG_ROOT,
    SERIES_ID_PATTERN,
    DRAFT_TOKEN_PATTERN,
    CHARACTER_ASSET_ID_PATTERN,
    CHARACTER_ASSET_FILE_PATTERN,
    MAX_SERIES_OMNY_BYTES,
    MAX_CHARACTER_TEXT_BYTES,
    CHARACTER_TEXT_RETENTION_DAYS,
    CHARACTER_TEXT_HISTORY_LIMIT,
    CHARACTER_TEXT_CATALOG_START,
    CHARACTER_TEXT_CATALOG_END,
    CHARACTER_TEXT_ENTRY_START,
    CHARACTER_TEXT_ENTRY_END,
    CHARACTER_TEXT_GENERIC_HEADING,
    MAX_CHARACTER_REFERENCE_BYTES,
    MAX_WORKSPACE_TEXT_BYTES,
    EPISODE_WORKSPACE_DIRECTORIES,
    WORKSPACE_TEXT_EXTENSIONS,
    managed_character_catalog_span,
    character_text_notes,
    merge_character_catalog_markdown,
    normalized_series_name,
    _reference_candidate_score,
    _series_reference_candidate_kind,
    _read_reference_candidate,
    discover_reference_text_candidates,
    SeriesCatalogConflict,
    SeriesCatalogStore,
)
from nyamuru_episode_workspace import (
    DEFAULT_EPISODE_WORKSPACE_STATE_PATH,
    MAX_WORKSPACE_IMAGE_BYTES,
    MAX_WORKSPACE_IMAGE_TOTAL_BYTES,
    MAX_SOURCE_COVERAGE_REPORT_BYTES,
    MAX_SOURCE_COVERAGE_UNITS,
    MAX_SOURCE_COVERAGE_TARGETS,
    SOURCE_COVERAGE_SCHEMA_NAME,
    SOURCE_COVERAGE_SHA_PATTERN,
    SOURCE_COVERAGE_SOURCE_ID_PATTERN,
    SOURCE_COVERAGE_TARGET_ID_PATTERN,
    WORKSPACE_IMAGE_EXTENSIONS,
    CoverageReportConflict,
    EpisodeWorkspaceManager,
)
from nyamuru_panel_actions import (
    MAX_PANEL_ACTION_RESPONSE_BYTES,
    DEFAULT_PANEL_ACTION_LLM_URL,
    SHARED_PANEL_ACTION_LLM_MODEL,
    PanelActionSuggester,
    PanelActionLLMUnavailable,
)
from nyamuru_panel_draft_ledger import (
    MAX_PANEL_DRAFT_OMNY_BYTES,
    MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
    PANEL_DRAFT_STATUS_VALUES,
    PANEL_DRAFT_REVIEW_VALUES,
    PANEL_DRAFT_LEDGER_SCHEMA_VERSION,
    PANEL_DRAFT_PROVENANCE_VERSION,
    PanelDraftLedger,
)
from nyamuru_comfy_draft import (
    DEFAULT_COMFYUI_URL,
    PANEL_DRAFT_CHECKPOINT,
    PANEL_DRAFT_PROFILE,
    PANEL_DRAFT_WIDTH,
    PANEL_DRAFT_HEIGHT,
    PANEL_DRAFT_STEPS,
    PANEL_DRAFT_CFG,
    PANEL_DRAFT_SEED,
    MANGA_BASE_PALETTE,
    MANGA_BASE_RGB,
    MAX_COMFY_JSON_BYTES,
    MAX_COMFY_IMAGE_BYTES,
    PANEL_DRAFT_ID_PATTERN,
    MANGA_BASE_TRANSFORM_VERSION,
    MANGA_BASE_PALETTE_VERSION,
    MAX_PANEL_DRAFT_CHECKPOINT_BYTES,
    ComfyUIUnavailable,
    ComfyUIObservationUnavailable,
    ComfyUIDraftGenerator,
)
from nyamuru_bridge_identity import (
    LAYOUT_PROTOCOL_VERSION,
    BRIDGE_SERVICE_NAME,
)
from nyamuru_panel_draft_jobs import (
    PANEL_DRAFT_BRIDGE_VERSION,
    PanelDraftJobService,
)
from nyamuru_project_store import load_project, save_project
from nyamuru_series_background_store import SeriesBackgroundStore
from qwen_generation import QwenGenerationService
from nyamuru_bridge_constants import (
    MAX_BODY_BYTES,
    ALLOWED_ORIGIN,
    PANEL_ACTION_LLM_MODE_MANAGED,
    PANEL_ACTION_LLM_MODE_AUTO,
    PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED,
    FIGURE_PERFORMANCE_SIZES,
    CHARACTER_REFERENCE_VIEWS,
)
from nyamuru_vision_state import LocalVisionState
from nyamuru_bridge_http import BridgeHandler


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


def main() -> int:
    args = parse_args()
    args.host = checked_loopback_bind_host(args.host)
    state = LocalVisionState(
        vision_root=args.vision_root,
        vision_python=args.vision_python,
        rtdetr_model=args.rtdetr_model,
        baberu_model=args.baberu_model,
        series_root=args.series_root,
        image_hub_root=args.image_hub_root,
        panel_action_llm_url=args.llm_url,
        comfyui_url=args.comfyui_url,
        vlm_python=args.vlm_python,
        vlm_model=args.vlm_model,
        vlm_model_label=args.vlm_model_label,
        wd_expression_model=args.wd_expression_model,
        wd_expression_tags=args.wd_expression_tags,
        wd_expression_threshold=args.wd_expression_threshold,
        panel_action_llm_mode=args.llm_mode,
    )
    status = state.check()
    if args.check_vlm:
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0 if status["vlm_available"] else 1
    if args.check:
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0 if (
            status["rtdetr_available"]
            and status["baberu_available"]
        ) else 1
    WORKER_SHUTDOWN_EVENT.clear()
    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    server.state = state  # type: ignore[attr-defined]
    shutdown_started = threading.Event()

    def request_shutdown(_signum: int | None = None, _frame: object | None = None) -> None:
        if shutdown_started.is_set():
            return
        shutdown_started.set()
        WORKER_SHUTDOWN_EVENT.set()

        def stop_server() -> None:
            terminate_active_workers()
            server.shutdown()

        threading.Thread(target=stop_server, name="nyamuru-bridge-shutdown", daemon=True).start()

    for signal_name in ("SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"):
        shutdown_signal = getattr(signal, signal_name, None)
        if shutdown_signal is not None:
            signal.signal(shutdown_signal, request_shutdown)

    parent_pid_value = os.environ.get("NYAMURU_BRIDGE_PARENT_PID", "").strip()
    try:
        parent_pid = int(parent_pid_value) if parent_pid_value else None
    except ValueError:
        parent_pid = None
    if parent_pid and parent_pid > 0:
        def watch_parent() -> None:
            while not shutdown_started.wait(0.5):
                if os.getppid() != parent_pid:
                    request_shutdown()
                    return
                try:
                    os.kill(parent_pid, 0)
                except ProcessLookupError:
                    request_shutdown()
                    return
                except PermissionError:
                    pass

        threading.Thread(target=watch_parent, name="nyamuru-bridge-parent-watch", daemon=True).start()
    print(f"Nyamuru local bridge: http://{args.host}:{args.port}")
    print(f"RT-DETR: {state.rtdetr_model}")
    print(f"Baberu OCR: {state.baberu_model}")
    print(f"Series common: {state.series_catalogs.root}")
    print(f"Panel action LLM: {state.panel_actions.endpoint}")
    print(f"ComfyUI: {state.panel_drafts.endpoint}")
    print(f"Qwen3-VL/MLX (explicit per-figure performance analysis only): {state.vlm_model}")
    print("Orientation: manual confirmation required")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        request_shutdown()
    finally:
        shutdown_started.set()
        WORKER_SHUTDOWN_EVENT.set()
        terminate_active_workers()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
