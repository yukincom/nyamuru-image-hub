"""Shared HTTP and analysis constants for the local bridge."""

import re


# 高解像度TIFFをブラウザ側で縮小できない場合にも、ローカルbridgeで受け取れる上限。
MAX_BODY_BYTES = 96 * 1024 * 1024
ALLOWED_ORIGIN = re.compile(r"^https?://(?:127\.0\.0\.1|localhost)(?::\d+)?$")
PANEL_ACTION_LLM_MODE_MANAGED = "managed"
PANEL_ACTION_LLM_MODE_AUTO = "auto"
PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED = "external-shared"
FIGURE_PERFORMANCE_SIZES = {"long", "full", "knee-up", "waist-up", "bust-up", "shoulder-up", "face", "face-detail", "hand", "foot", "part"}
CHARACTER_REFERENCE_VIEWS = {"turnaround", "front", "three-quarter", "side", "back", "expression", "costume", "other"}
