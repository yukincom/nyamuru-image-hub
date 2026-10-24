#!/usr/bin/env python3
"""Deterministic, local-only QA for Nyamuru manga-base artifacts.

This module deliberately has no bridge, ComfyUI, VLM, or network integration.
Image dependencies are imported lazily so schema/canonicalization tests can run
with the system Python before the optional local vision environment is present.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import re
import stat
import struct
import warnings
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any, Mapping


REPORT_SCHEMA_NAME = "nyamuru-generation-qa-report"
REPORT_SCHEMA_VERSION = 1
COMPARISON_SCHEMA_NAME = "nyamuru-generation-qa-comparison"
COMPARISON_SCHEMA_VERSION = 1
RUBRIC_ID = "manga-base-deterministic"
RUBRIC_VERSION = 1
IMPLEMENTATION_NAME = "nyamuru-generation-qa"
IMPLEMENTATION_VERSION = "1"
MANGA_BASE_PROFILE = "manga-base"
MANGA_BASE_ROLE = "manga_base_composite"
MANGA_BASE_PALETTE_VERSION = "manga-base-v1"
PNG_MEDIA_TYPE = "image/png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_ARTIFACT_BYTES = 20 * 1024 * 1024
MAX_DIMENSION_PX = 8192
MAX_PIXEL_COUNT = 16 * 1024 * 1024
PNG_SPEC_MAX_DIMENSION = (1 << 31) - 1
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
UTC_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
APNG_CHUNK_TYPES = {"acTL", "fcTL", "fdAT"}
PNG_CRITICAL_CHUNK_TYPES = {"IHDR", "PLTE", "IDAT", "IEND"}

MANGA_BASE_PALETTE: dict[str, tuple[int, int, int]] = {
    "ink": (0, 0, 0),
    "dense_tone": (230, 0, 18),
    "light_tone": (0, 215, 232),
    "paper": (255, 255, 255),
}

DEFAULT_THRESHOLDS: dict[str, int | float] = {
    "nearly_blank_content_fraction_lte": 0.002,
    "nearly_filled_content_fraction_gte": 0.98,
    "low_ink_fraction_lte": 0.0005,
    "tiny_component_max_area_px": 3,
    "tiny_component_pixel_fraction_gt": 0.02,
    "edge_band_ratio": 0.02,
    "edge_contact_info_fraction_gte": 0.8,
}

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}
METRIC_KEYS = {
    "decoded", "format", "frame_count", "mode", "width_px", "height_px", "pixel_count",
    "pixel_sha256", "png_chunk_count", "metadata_chunk_types", "palette_counts",
    "palette_fractions", "used_palette_slots", "unknown_palette_pixels", "non_opaque_pixels",
    "content_pixels", "content_fraction", "ink_fraction", "content_bbox_px", "edge_band_px",
    "edge_content_fractions", "component_count", "tiny_component_count",
    "tiny_component_pixels", "tiny_component_pixel_fraction", "recomposition_mismatch_pixels",
}


class QAEnvironmentError(RuntimeError):
    """Raised when the already-configured local QA dependencies are unavailable."""


class PNGStructureError(ValueError):
    """Raised when PNG chunks do not form one exact, CRC-valid stream."""

    def __init__(self, code: str, message: str, actual: object, expected: object):
        super().__init__(message)
        self.code = code
        self.actual = actual
        self.expected = expected


@dataclass(frozen=True)
class ArtifactExpectation:
    """Immutable binding supplied by a future B002 artifact resolver."""

    job_id: str
    attempt_id: str
    artifact_sha256: str
    source_snapshot_sha256: str
    role: str = MANGA_BASE_ROLE
    media_type: str = PNG_MEDIA_TYPE
    width_px: int = 512
    height_px: int = 512
    profile: str = MANGA_BASE_PROFILE
    palette_version: str = MANGA_BASE_PALETTE_VERSION

    def __post_init__(self) -> None:
        for label, value in (("job_id", self.job_id), ("attempt_id", self.attempt_id)):
            if not isinstance(value, str) or not value.strip() or len(value) > 256:
                raise ValueError(f"{label} must be a non-empty string of at most 256 characters")
        for label, value in (
            ("artifact_sha256", self.artifact_sha256),
            ("source_snapshot_sha256", self.source_snapshot_sha256),
        ):
            if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
                raise ValueError(f"{label} must be a lowercase SHA-256 digest")
        if self.role != MANGA_BASE_ROLE:
            raise ValueError(f"role must be {MANGA_BASE_ROLE}")
        if self.media_type != PNG_MEDIA_TYPE:
            raise ValueError(f"media_type must be {PNG_MEDIA_TYPE}")
        if self.profile != MANGA_BASE_PROFILE:
            raise ValueError(f"profile must be {MANGA_BASE_PROFILE}")
        if self.palette_version != MANGA_BASE_PALETTE_VERSION:
            raise ValueError(f"palette_version must be {MANGA_BASE_PALETTE_VERSION}")
        if not isinstance(self.width_px, int) or isinstance(self.width_px, bool) or self.width_px <= 0:
            raise ValueError("width_px must be a positive integer")
        if not isinstance(self.height_px, int) or isinstance(self.height_px, bool) or self.height_px <= 0:
            raise ValueError("height_px must be a positive integer")
        if self.width_px > MAX_DIMENSION_PX or self.height_px > MAX_DIMENSION_PX:
            raise ValueError(f"expected dimensions must not exceed {MAX_DIMENSION_PX}px per side")
        if self.width_px * self.height_px > MAX_PIXEL_COUNT:
            raise ValueError(f"expected pixel count must not exceed {MAX_PIXEL_COUNT}")


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _checked_utc_timestamp(value: str) -> str:
    if not isinstance(value, str) or UTC_TIMESTAMP_PATTERN.fullmatch(value) is None:
        raise ValueError("created_at must be an RFC 3339 UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError("created_at must be a valid UTC timestamp") from exc
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError("created_at must use UTC")
    return value


def canonical_json(value: object) -> str:
    """Return the one canonical JSON encoding used for every B003 digest."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _rounded_fraction(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 8) if denominator else 0.0


def _empty_metrics() -> dict[str, Any]:
    return {
        "decoded": False,
        "format": "",
        "frame_count": 0,
        "mode": "",
        "width_px": 0,
        "height_px": 0,
        "pixel_count": 0,
        "pixel_sha256": "",
        "png_chunk_count": 0,
        "metadata_chunk_types": [],
        "palette_counts": {name: 0 for name in MANGA_BASE_PALETTE},
        "palette_fractions": {name: 0.0 for name in MANGA_BASE_PALETTE},
        "used_palette_slots": 0,
        "unknown_palette_pixels": 0,
        "non_opaque_pixels": 0,
        "content_pixels": 0,
        "content_fraction": 0.0,
        "ink_fraction": 0.0,
        "content_bbox_px": None,
        "edge_band_px": 0,
        "edge_content_fractions": {"top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0},
        "component_count": 0,
        "tiny_component_count": 0,
        "tiny_component_pixels": 0,
        "tiny_component_pixel_fraction": 0.0,
        "recomposition_mismatch_pixels": 0,
    }


def _finding(
    code: str,
    severity: str,
    message: str,
    metric: str,
    actual: object,
    expected: object,
) -> dict[str, Any]:
    if severity not in SEVERITY_ORDER:
        raise ValueError(f"unsupported severity: {severity}")
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "metric": metric,
        "actual": actual,
        "expected": expected,
    }


def _report_status(findings: list[dict[str, Any]]) -> str:
    severities = {item["severity"] for item in findings}
    if "error" in severities:
        return "fail"
    if "warning" in severities:
        return "warn"
    return "pass"


def _load_image_dependencies() -> tuple[Any, Any, Any, Any, str]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        import PIL  # type: ignore[import-not-found]
        from PIL import Image, UnidentifiedImageError  # type: ignore[import-not-found]
    except ImportError as exc:
        raise QAEnvironmentError(
            "Generation QA requires the existing local Pillow/numpy/OpenCV environment; "
            "install requirements-qa.txt explicitly before running image metrics"
        ) from exc
    return cv2, np, Image, UnidentifiedImageError, str(PIL.__version__)


def _checked_png_chunks(image_bytes: bytes) -> tuple[int, list[str], int, int]:
    """Validate chunk bounds/CRC/IEND and report metadata chunk names only."""

    offset = len(PNG_SIGNATURE)
    chunk_count = 0
    metadata_types: set[str] = set()
    saw_ihdr = False
    saw_plte = False
    saw_idat = False
    idat_ended = False
    header_width = 0
    header_height = 0
    while offset < len(image_bytes):
        if len(image_bytes) - offset < 12:
            raise PNGStructureError(
                "png_structure_invalid", "PNG chunk headerが途中で切れています。",
                len(image_bytes) - offset, ">= 12 bytes",
            )
        data_length = struct.unpack(">I", image_bytes[offset:offset + 4])[0]
        chunk_type_bytes = image_bytes[offset + 4:offset + 8]
        try:
            chunk_type = chunk_type_bytes.decode("ascii")
        except UnicodeDecodeError as exc:
            raise PNGStructureError(
                "png_structure_invalid", "PNG chunk typeがASCIIではありません。",
                chunk_type_bytes.hex(), "four ASCII bytes",
            ) from exc
        if re.fullmatch(r"[A-Za-z]{4}", chunk_type) is None:
            raise PNGStructureError(
                "png_structure_invalid", "PNG chunk typeが4文字の英字ではありません。",
                chunk_type, "four ASCII letters",
            )
        if chunk_type_bytes[2] & 0x20:
            raise PNGStructureError(
                "png_structure_invalid", "PNG chunk typeのreserved bitが不正です。",
                chunk_type, "uppercase third chunk-type letter",
            )
        if chunk_type in APNG_CHUNK_TYPES:
            raise PNGStructureError(
                "animated_png_not_allowed", "APNG chunkを含む画像は使用できません。",
                chunk_type, "static PNG without acTL/fcTL/fdAT",
            )
        if not (chunk_type_bytes[0] & 0x20) and chunk_type not in PNG_CRITICAL_CHUNK_TYPES:
            raise PNGStructureError(
                "png_structure_invalid", "未知のcritical PNG chunkがあります。",
                chunk_type, sorted(PNG_CRITICAL_CHUNK_TYPES),
            )
        chunk_end = offset + 12 + data_length
        if chunk_end > len(image_bytes):
            raise PNGStructureError(
                "png_structure_invalid", "PNG chunk dataが途中で切れています。",
                len(image_bytes) - offset, chunk_end - offset,
            )
        chunk_data = image_bytes[offset + 8:offset + 8 + data_length]
        stored_crc = struct.unpack(">I", image_bytes[offset + 8 + data_length:chunk_end])[0]
        actual_crc = zlib.crc32(chunk_type_bytes + chunk_data) & 0xFFFFFFFF
        if actual_crc != stored_crc:
            raise PNGStructureError(
                "png_structure_invalid", "PNG chunkのCRCが一致しません。",
                f"{actual_crc:08x}", f"{stored_crc:08x}",
            )
        chunk_count += 1
        if chunk_count == 1:
            if chunk_type != "IHDR" or data_length != 13:
                raise PNGStructureError(
                    "png_structure_invalid", "PNGの先頭chunkが正しいIHDRではありません。",
                    {"type": chunk_type, "length": data_length}, {"type": "IHDR", "length": 13},
                )
            header_width, header_height = struct.unpack(">II", chunk_data[:8])
            if header_width == 0 or header_height == 0:
                raise PNGStructureError(
                    "png_structure_invalid", "PNGのwidth/heightは正の整数である必要があります。",
                    [header_width, header_height], "positive PNG dimensions",
                )
            if header_width > PNG_SPEC_MAX_DIMENSION or header_height > PNG_SPEC_MAX_DIMENSION:
                raise PNGStructureError(
                    "png_structure_invalid", "PNGのwidth/heightが仕様上限を超えています。",
                    [header_width, header_height], f"<= {PNG_SPEC_MAX_DIMENSION}",
                )
            saw_ihdr = True
        elif chunk_type == "IHDR":
            raise PNGStructureError(
                "png_structure_invalid", "PNGに複数のIHDR chunkがあります。",
                chunk_count, "exactly one leading IHDR",
            )
        if chunk_type == "PLTE":
            if saw_plte:
                raise PNGStructureError(
                    "png_structure_invalid", "PNGに複数のPLTE chunkがあります。",
                    "duplicate PLTE", "at most one PLTE before IDAT",
                )
            if saw_idat:
                raise PNGStructureError(
                    "png_structure_invalid", "PLTE chunkはIDATより前である必要があります。",
                    "PLTE after IDAT", "PLTE before the first IDAT",
                )
            if data_length < 3 or data_length > 768 or data_length % 3 != 0:
                raise PNGStructureError(
                    "png_structure_invalid", "PLTE chunkの長さが不正です。",
                    data_length, "3..768 bytes and divisible by 3",
                )
            saw_plte = True
        if chunk_type == "IDAT":
            if idat_ended:
                raise PNGStructureError(
                    "png_structure_invalid", "複数のIDAT chunkは連続している必要があります。",
                    "non-consecutive IDAT", "one consecutive IDAT sequence",
                )
            saw_idat = True
        elif saw_idat and chunk_type != "IEND":
            idat_ended = True
        if chunk_type in {"eXIf", "iCCP", "iTXt", "tEXt", "zTXt"}:
            metadata_types.add(chunk_type)
        offset = chunk_end
        if chunk_type == "IEND":
            if data_length != 0:
                raise PNGStructureError(
                    "png_structure_invalid", "IEND chunkは空である必要があります。",
                    data_length, 0,
                )
            if offset != len(image_bytes):
                raise PNGStructureError(
                    "png_trailing_bytes", "IEND後に余剰byteがあります。",
                    len(image_bytes) - offset, 0,
                )
            if not saw_idat:
                raise PNGStructureError(
                    "png_structure_invalid", "PNGにIDAT chunkがありません。",
                    {"ihdr": saw_ihdr, "idat": saw_idat}, "at least one IDAT before IEND",
                )
            return chunk_count, sorted(metadata_types), header_width, header_height
    raise PNGStructureError(
        "png_structure_invalid", "PNGにIEND chunkがありません。",
        {"ihdr": saw_ihdr, "chunks": chunk_count}, "one terminal IEND chunk",
    )


def _ratio_matches(count: int, total: int, threshold: int | float, operator: str) -> bool:
    """Compare an exact integer ratio without using its rounded display value."""

    if total <= 0:
        return False
    fraction = Fraction(str(threshold))
    left = count * fraction.denominator
    right = total * fraction.numerator
    if operator == "<=":
        return left <= right
    if operator == ">=":
        return left >= right
    if operator == ">":
        return left > right
    raise ValueError(f"unsupported ratio operator: {operator}")


def _analysis_key(
    expectation: ArtifactExpectation,
    thresholds: Mapping[str, int | float] | None = None,
) -> str:
    threshold_values = dict(DEFAULT_THRESHOLDS if thresholds is None else thresholds)
    payload = {
        "job_id": expectation.job_id,
        "attempt_id": expectation.attempt_id,
        "artifact_sha256": expectation.artifact_sha256,
        "source_snapshot_sha256": expectation.source_snapshot_sha256,
        "role": expectation.role,
        "media_type": expectation.media_type,
        "width_px": expectation.width_px,
        "height_px": expectation.height_px,
        "profile": expectation.profile,
        "palette_version": expectation.palette_version,
        "rubric_id": RUBRIC_ID,
        "rubric_version": RUBRIC_VERSION,
        "implementation_version": IMPLEMENTATION_VERSION,
        "thresholds": threshold_values,
    }
    return f"qa-{canonical_sha256(payload)}"


def _base_report(
    expectation: ArtifactExpectation,
    image_bytes: bytes,
    *,
    created_at: str,
) -> dict[str, Any]:
    return {
        "schema_name": REPORT_SCHEMA_NAME,
        "schema_version": REPORT_SCHEMA_VERSION,
        "analysis_key": _analysis_key(expectation),
        "job_id": expectation.job_id,
        "attempt_id": expectation.attempt_id,
        "artifact": {
            "role": expectation.role,
            "expected_sha256": expectation.artifact_sha256,
            "actual_sha256": hashlib.sha256(image_bytes).hexdigest(),
            "source_snapshot_sha256": expectation.source_snapshot_sha256,
            "media_type": expectation.media_type,
            "byte_size": len(image_bytes),
            "expected_width_px": expectation.width_px,
            "expected_height_px": expectation.height_px,
            "profile": expectation.profile,
            "palette_version": expectation.palette_version,
        },
        "rubric": {
            "id": RUBRIC_ID,
            "version": RUBRIC_VERSION,
            "implementation_version": IMPLEMENTATION_VERSION,
            "thresholds": copy.deepcopy(DEFAULT_THRESHOLDS),
        },
        "analyzer": {
            "kind": "deterministic",
            "implementation": IMPLEMENTATION_NAME,
            "version": IMPLEMENTATION_VERSION,
            "external_network": False,
            "python_dependencies": {"pillow": "", "numpy": "", "opencv": ""},
        },
        "status": "fail",
        "metrics": _empty_metrics(),
        "findings": [],
        "metrics_sha256": "0" * 64,
        "created_at": created_at,
    }


def _metrics_digest_payload(report: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema_name": report["schema_name"],
        "schema_version": report["schema_version"],
        "artifact_actual_sha256": report["artifact"]["actual_sha256"],
        "rubric": report["rubric"],
        "status": report["status"],
        "metrics": report["metrics"],
        "findings": [
            {key: copy.deepcopy(item[key]) for key in ("code", "severity", "metric", "actual", "expected")}
            for item in report["findings"]
        ],
    }


def _finalize_report(report: dict[str, Any]) -> dict[str, Any]:
    findings = report["findings"]
    findings.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], item["code"]))
    report["status"] = _report_status(findings)
    report["metrics_sha256"] = canonical_sha256(_metrics_digest_payload(report))
    return report


def analyze_artifact_bytes(
    image_bytes: bytes,
    expectation: ArtifactExpectation,
    *,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Analyze one immutable manga-base PNG without modifying its bytes."""

    if not isinstance(image_bytes, bytes):
        raise TypeError("image_bytes must be bytes")
    report = _base_report(
        expectation,
        image_bytes,
        created_at=_checked_utc_timestamp(created_at) if created_at is not None else utc_timestamp(),
    )
    findings: list[dict[str, Any]] = report["findings"]
    artifact = report["artifact"]
    metrics = report["metrics"]

    if artifact["actual_sha256"] != artifact["expected_sha256"]:
        findings.append(_finding(
            "artifact_hash_mismatch", "error", "保存画像のSHA-256が台帳と一致しません。",
            "artifact.actual_sha256", artifact["actual_sha256"], artifact["expected_sha256"],
        ))
    if not image_bytes:
        findings.append(_finding("artifact_empty", "error", "画像ファイルが空です。", "artifact.byte_size", 0, "> 0"))
        return _finalize_report(report)
    if len(image_bytes) > MAX_ARTIFACT_BYTES:
        findings.append(_finding(
            "artifact_too_large", "error", "画像ファイルがQA上限を超えています。",
            "artifact.byte_size", len(image_bytes), f"<= {MAX_ARTIFACT_BYTES}",
        ))
        return _finalize_report(report)
    if not image_bytes.startswith(PNG_SIGNATURE):
        findings.append(_finding(
            "png_signature_invalid", "error", "PNG signatureを確認できません。",
            "artifact.signature", image_bytes[:8].hex(), PNG_SIGNATURE.hex(),
        ))
        return _finalize_report(report)

    try:
        (
            metrics["png_chunk_count"],
            metrics["metadata_chunk_types"],
            metrics["width_px"],
            metrics["height_px"],
        ) = _checked_png_chunks(image_bytes)
    except PNGStructureError as exc:
        findings.append(_finding(exc.code, "error", str(exc), "artifact.png_structure", exc.actual, exc.expected))
        return _finalize_report(report)
    if metrics["metadata_chunk_types"]:
        findings.append(_finding(
            "embedded_metadata", "info", "PNGにmetadata chunkがあります。内容本文はQA reportへ複製しません。",
            "metrics.metadata_chunk_types", metrics["metadata_chunk_types"], "diagnostic only",
        ))

    header_width = metrics["width_px"]
    header_height = metrics["height_px"]
    if (
        header_width > MAX_DIMENSION_PX
        or header_height > MAX_DIMENSION_PX
        or header_width * header_height > MAX_PIXEL_COUNT
    ):
        findings.append(_finding(
            "image_dimensions_unsafe", "error", "画像寸法が安全な解析上限を超えています。",
            "metrics.dimensions", [header_width, header_height],
            {"max_dimension_px": MAX_DIMENSION_PX, "max_pixel_count": MAX_PIXEL_COUNT},
        ))
        return _finalize_report(report)

    cv2, np, Image, UnidentifiedImageError, pillow_version = _load_image_dependencies()
    report["analyzer"]["python_dependencies"] = {
        "pillow": str(pillow_version),
        "numpy": str(np.__version__),
        "opencv": str(cv2.__version__),
    }

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as opened:
                metrics["format"] = str(opened.format or "")
                metrics["frame_count"] = int(getattr(opened, "n_frames", 1))
                metrics["mode"] = str(opened.mode)
                metrics["width_px"], metrics["height_px"] = map(int, opened.size)
                opened.verify()

            width = metrics["width_px"]
            height = metrics["height_px"]
            with Image.open(io.BytesIO(image_bytes)) as opened:
                opened.load()
                rgba = np.array(opened.convert("RGBA"), dtype=np.uint8, copy=True)
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        findings.append(_finding(
            "image_decode_failed", "error", "PNGを最後まで安全に読み取れません。",
            "metrics.decoded", False, f"valid PNG ({type(exc).__name__})",
        ))
        return _finalize_report(report)

    metrics["decoded"] = True
    width = metrics["width_px"]
    height = metrics["height_px"]
    pixel_count = width * height
    metrics["pixel_count"] = pixel_count
    if rgba.shape != (height, width, 4):
        findings.append(_finding(
            "decoded_shape_mismatch", "error", "decoded pixel配列のshapeが画像寸法と一致しません。",
            "metrics.decoded_shape", list(rgba.shape), [height, width, 4],
        ))
        return _finalize_report(report)

    if metrics["format"] != "PNG":
        findings.append(_finding(
            "media_format_mismatch", "error", "画像形式がPNGではありません。",
            "metrics.format", metrics["format"], "PNG",
        ))
    if metrics["frame_count"] != 1:
        findings.append(_finding(
            "frame_count_mismatch", "error", "manga-base画像は単一frameである必要があります。",
            "metrics.frame_count", metrics["frame_count"], 1,
        ))
    if [width, height] != [expectation.width_px, expectation.height_px]:
        findings.append(_finding(
            "dimension_mismatch", "error", "画像寸法が生成artifact契約と一致しません。",
            "metrics.dimensions", [width, height], [expectation.width_px, expectation.height_px],
        ))
    if metrics["mode"] != "RGB":
        findings.append(_finding(
            "mode_mismatch", "error", "manga-base合成画像はRGB PNGである必要があります。",
            "metrics.mode", metrics["mode"], "RGB",
        ))

    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]
    pixel_hash_input = (
        width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"RGB\0" + rgb.tobytes(order="C")
    )
    metrics["pixel_sha256"] = hashlib.sha256(pixel_hash_input).hexdigest()
    masks: dict[str, Any] = {}
    assigned = np.zeros((height, width), dtype=bool)
    for name, color in MANGA_BASE_PALETTE.items():
        mask = np.all(rgb == np.asarray(color, dtype=np.uint8), axis=2)
        masks[name] = mask
        assigned |= mask
        count = int(np.count_nonzero(mask))
        metrics["palette_counts"][name] = count
        metrics["palette_fractions"][name] = _rounded_fraction(count, pixel_count)
    metrics["used_palette_slots"] = sum(1 for count in metrics["palette_counts"].values() if count)
    metrics["unknown_palette_pixels"] = int(pixel_count - np.count_nonzero(assigned))
    metrics["non_opaque_pixels"] = int(np.count_nonzero(alpha != 255))

    content_mask = ~masks["paper"]
    content_pixels = int(np.count_nonzero(content_mask))
    metrics["content_pixels"] = content_pixels
    metrics["content_fraction"] = _rounded_fraction(content_pixels, pixel_count)
    metrics["ink_fraction"] = metrics["palette_fractions"]["ink"]

    if content_pixels:
        ys, xs = np.nonzero(content_mask)
        min_x = int(xs.min())
        max_x = int(xs.max())
        min_y = int(ys.min())
        max_y = int(ys.max())
        metrics["content_bbox_px"] = {
            "x": min_x,
            "y": min_y,
            "width": max_x - min_x + 1,
            "height": max_y - min_y + 1,
        }

    edge_band_px = max(1, round(
        min(width, height) * Fraction(str(DEFAULT_THRESHOLDS["edge_band_ratio"]))
    ))
    metrics["edge_band_px"] = edge_band_px
    edge_masks = {
        "top": content_mask[:edge_band_px, :],
        "right": content_mask[:, width - edge_band_px:],
        "bottom": content_mask[height - edge_band_px:, :],
        "left": content_mask[:, :edge_band_px],
    }
    metrics["edge_content_fractions"] = {
        name: _rounded_fraction(int(np.count_nonzero(mask)), int(mask.size))
        for name, mask in edge_masks.items()
    }

    if content_pixels:
        label_count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(
            content_mask.astype(np.uint8), connectivity=8, ltype=cv2.CV_32S,
        )
        areas = [int(value) for value in stats[1:, cv2.CC_STAT_AREA].tolist()]
        tiny_max = int(DEFAULT_THRESHOLDS["tiny_component_max_area_px"])
        tiny_areas = [area for area in areas if area <= tiny_max]
        metrics["component_count"] = max(0, int(label_count) - 1)
        metrics["tiny_component_count"] = len(tiny_areas)
        metrics["tiny_component_pixels"] = sum(tiny_areas)
        metrics["tiny_component_pixel_fraction"] = _rounded_fraction(metrics["tiny_component_pixels"], content_pixels)

    reconstructed = np.zeros_like(rgb)
    for name, color in MANGA_BASE_PALETTE.items():
        reconstructed[masks[name]] = color
    metrics["recomposition_mismatch_pixels"] = int(np.count_nonzero(
        (~assigned) | np.any(reconstructed != rgb, axis=2)
    ))

    if metrics["unknown_palette_pixels"]:
        findings.append(_finding(
            "off_palette_pixels", "error", "4値palette外のpixelがあります。",
            "metrics.unknown_palette_pixels", metrics["unknown_palette_pixels"], 0,
        ))
    if metrics["non_opaque_pixels"]:
        findings.append(_finding(
            "non_opaque_pixels", "error", "非透明pixelがあります。",
            "metrics.non_opaque_pixels", metrics["non_opaque_pixels"], 0,
        ))
    if metrics["recomposition_mismatch_pixels"]:
        findings.append(_finding(
            "recomposition_mismatch", "error", "4値maskの再合成が元画像と一致しません。",
            "metrics.recomposition_mismatch_pixels", metrics["recomposition_mismatch_pixels"], 0,
        ))

    content_fraction = float(metrics["content_fraction"])
    if _ratio_matches(
        content_pixels, pixel_count, DEFAULT_THRESHOLDS["nearly_blank_content_fraction_lte"], "<=",
    ):
        findings.append(_finding(
            "nearly_blank", "warning", "非白pixelが非常に少ないため、内容を目視確認してください。",
            "metrics.content_fraction", content_fraction,
            f"> {DEFAULT_THRESHOLDS['nearly_blank_content_fraction_lte']}",
        ))
    if _ratio_matches(
        content_pixels, pixel_count, DEFAULT_THRESHOLDS["nearly_filled_content_fraction_gte"], ">=",
    ):
        findings.append(_finding(
            "nearly_filled", "warning", "画面の大部分が非白pixelのため、黒つぶれ等を目視確認してください。",
            "metrics.content_fraction", content_fraction,
            f"< {DEFAULT_THRESHOLDS['nearly_filled_content_fraction_gte']}",
        ))
    ink_pixels = int(metrics["palette_counts"]["ink"])
    if content_pixels and _ratio_matches(
        ink_pixels, pixel_count, DEFAULT_THRESHOLDS["low_ink_fraction_lte"], "<=",
    ):
        findings.append(_finding(
            "low_ink", "warning", "黒線pixelが非常に少ないため、線画を目視確認してください。",
            "metrics.ink_fraction", metrics["ink_fraction"],
            f"> {DEFAULT_THRESHOLDS['low_ink_fraction_lte']}",
        ))
    tiny_pixels = int(metrics["tiny_component_pixels"])
    if content_pixels and _ratio_matches(
        tiny_pixels, content_pixels, DEFAULT_THRESHOLDS["tiny_component_pixel_fraction_gt"], ">",
    ):
        findings.append(_finding(
            "speckle_noise", "warning", "微小な孤立成分の比率が高いため、noiseを目視確認してください。",
            "metrics.tiny_component_pixel_fraction", metrics["tiny_component_pixel_fraction"],
            f"<= {DEFAULT_THRESHOLDS['tiny_component_pixel_fraction_gt']}",
        ))
    touching = []
    for name, mask in edge_masks.items():
        if _ratio_matches(
            int(np.count_nonzero(mask)), int(mask.size),
            DEFAULT_THRESHOLDS["edge_contact_info_fraction_gte"], ">=",
        ):
            touching.append(name)
    touching.sort()
    if touching:
        findings.append(_finding(
            "edge_contact", "info", "外周bandへ内容が接しています。裁ち切り等として妥当か確認できます。",
            "metrics.edge_content_fractions", touching, "diagnostic only",
        ))

    return _finalize_report(report)


def analyze_artifact_path(
    path: Path,
    expectation: ArtifactExpectation,
    *,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Read one regular file with a bounded read and analyze it."""

    if path.is_symlink():
        raise ValueError("artifact path must be a regular, non-symlink file")
    resolved = path.resolve(strict=True)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(resolved, flags)
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode):
            raise ValueError("artifact path must be a regular, non-symlink file")
        if file_stat.st_size > MAX_ARTIFACT_BYTES:
            raise ValueError(f"artifact exceeds bounded read limit ({MAX_ARTIFACT_BYTES} bytes)")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            image_bytes = handle.read(MAX_ARTIFACT_BYTES + 1)
        if len(image_bytes) > MAX_ARTIFACT_BYTES:
            raise ValueError(f"artifact exceeds bounded read limit ({MAX_ARTIFACT_BYTES} bytes)")
    finally:
        os.close(descriptor)
    return analyze_artifact_bytes(image_bytes, expectation, created_at=created_at)


def _flatten_metrics(value: object, prefix: str = "/metrics") -> dict[str, object]:
    if isinstance(value, Mapping):
        flattened: dict[str, object] = {}
        for key in sorted(value):
            flattened.update(_flatten_metrics(value[key], f"{prefix}/{key}"))
        return flattened
    return {prefix: value}


def _semantic_finding(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: copy.deepcopy(value.get(key))
        for key in ("code", "severity", "metric", "actual", "expected")
    }


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _checked_report_metrics(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != METRIC_KEYS:
        raise ValueError("QA report metric set is incompatible")
    if not isinstance(value.get("decoded"), bool):
        raise ValueError("QA report metrics.decoded is malformed")
    if not isinstance(value.get("format"), str) or not isinstance(value.get("mode"), str):
        raise ValueError("QA report image format/mode metrics are malformed")
    integer_limits = {
        "frame_count": None,
        "width_px": PNG_SPEC_MAX_DIMENSION,
        "height_px": PNG_SPEC_MAX_DIMENSION,
        "pixel_count": MAX_PIXEL_COUNT,
        "png_chunk_count": None,
        "used_palette_slots": len(MANGA_BASE_PALETTE),
        "unknown_palette_pixels": MAX_PIXEL_COUNT,
        "non_opaque_pixels": MAX_PIXEL_COUNT,
        "content_pixels": MAX_PIXEL_COUNT,
        "edge_band_px": MAX_DIMENSION_PX,
        "component_count": MAX_PIXEL_COUNT,
        "tiny_component_count": MAX_PIXEL_COUNT,
        "tiny_component_pixels": MAX_PIXEL_COUNT,
        "recomposition_mismatch_pixels": MAX_PIXEL_COUNT,
    }
    for key, maximum in integer_limits.items():
        item = value.get(key)
        if not _is_integer(item) or item < 0 or (maximum is not None and item > maximum):
            raise ValueError(f"QA report metrics.{key} is malformed")
    pixel_sha256 = value.get("pixel_sha256")
    if not isinstance(pixel_sha256, str) or (pixel_sha256 and SHA256_PATTERN.fullmatch(pixel_sha256) is None):
        raise ValueError("QA report metrics.pixel_sha256 is malformed")
    metadata = value.get("metadata_chunk_types")
    allowed_metadata = {"eXIf", "iCCP", "iTXt", "tEXt", "zTXt"}
    if not isinstance(metadata, list) or metadata != sorted(set(metadata)) or any(item not in allowed_metadata for item in metadata):
        raise ValueError("QA report metadata chunk metrics are malformed")
    palette_keys = set(MANGA_BASE_PALETTE)
    palette_counts = value.get("palette_counts")
    if not isinstance(palette_counts, dict) or set(palette_counts) != palette_keys or any(
        not _is_integer(item) or item < 0 or item > MAX_PIXEL_COUNT for item in palette_counts.values()
    ):
        raise ValueError("QA report palette count metrics are malformed")
    ratio_objects = [value.get("palette_fractions"), value.get("edge_content_fractions")]
    ratio_keys = [palette_keys, {"top", "right", "bottom", "left"}]
    for ratio_object, expected_keys in zip(ratio_objects, ratio_keys, strict=True):
        if not isinstance(ratio_object, dict) or set(ratio_object) != expected_keys or any(
            isinstance(item, bool) or not isinstance(item, (int, float)) or not 0 <= item <= 1
            for item in ratio_object.values()
        ):
            raise ValueError("QA report ratio metrics are malformed")
    for key in ("content_fraction", "ink_fraction", "tiny_component_pixel_fraction"):
        item = value.get(key)
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not 0 <= item <= 1:
            raise ValueError(f"QA report metrics.{key} is malformed")
    bbox = value.get("content_bbox_px")
    if bbox is not None and (
        not isinstance(bbox, dict)
        or set(bbox) != {"x", "y", "width", "height"}
        or any(not _is_integer(item) for item in bbox.values())
        or bbox["x"] < 0 or bbox["y"] < 0 or bbox["width"] < 1 or bbox["height"] < 1
    ):
        raise ValueError("QA report content bbox metric is malformed")
    return value


def _checked_report(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("QA report must be a JSON object")
    expected_root_keys = {
        "schema_name", "schema_version", "analysis_key", "job_id", "attempt_id", "artifact",
        "rubric", "analyzer", "status", "metrics", "findings", "metrics_sha256", "created_at",
    }
    if set(value) != expected_root_keys:
        raise ValueError("QA report root field set is incompatible")
    if value.get("schema_name") != REPORT_SCHEMA_NAME or value.get("schema_version") != REPORT_SCHEMA_VERSION:
        raise ValueError("unsupported QA report schema")
    if not isinstance(value.get("analysis_key"), str) or re.fullmatch(r"qa-[a-f0-9]{64}", value["analysis_key"]) is None:
        raise ValueError("QA report analysis_key is malformed")
    if value.get("status") not in {"pass", "warn", "fail"}:
        raise ValueError("QA report status is malformed")
    if not isinstance(value.get("metrics_sha256"), str) or SHA256_PATTERN.fullmatch(value["metrics_sha256"]) is None:
        raise ValueError("QA report metrics_sha256 is malformed")
    if not isinstance(value.get("created_at"), str):
        raise ValueError("QA report created_at is malformed")
    _checked_utc_timestamp(value["created_at"])
    if not isinstance(value.get("artifact"), dict) or not isinstance(value.get("rubric"), dict):
        raise ValueError("QA report artifact/rubric is missing")
    expected_artifact_keys = {
        "role", "expected_sha256", "actual_sha256", "source_snapshot_sha256", "media_type",
        "byte_size", "expected_width_px", "expected_height_px", "profile", "palette_version",
    }
    if set(value["artifact"]) != expected_artifact_keys:
        raise ValueError("QA report artifact field set is incompatible")
    for digest_key in ("expected_sha256", "actual_sha256", "source_snapshot_sha256"):
        digest = value["artifact"].get(digest_key)
        if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
            raise ValueError(f"QA report artifact.{digest_key} is malformed")
    artifact = value["artifact"]
    if not _is_integer(artifact.get("byte_size")) or artifact["byte_size"] < 0:
        raise ValueError("QA report artifact.byte_size is malformed")
    try:
        expectation = ArtifactExpectation(
            job_id=value.get("job_id"),
            attempt_id=value.get("attempt_id"),
            artifact_sha256=artifact.get("expected_sha256"),
            source_snapshot_sha256=artifact.get("source_snapshot_sha256"),
            role=artifact.get("role"),
            media_type=artifact.get("media_type"),
            width_px=artifact.get("expected_width_px"),
            height_px=artifact.get("expected_height_px"),
            profile=artifact.get("profile"),
            palette_version=artifact.get("palette_version"),
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("QA report artifact expectation is malformed") from exc
    if set(value["rubric"]) != {"id", "version", "implementation_version", "thresholds"}:
        raise ValueError("QA report rubric field set is incompatible")
    if value["rubric"] != {
        "id": RUBRIC_ID,
        "version": RUBRIC_VERSION,
        "implementation_version": IMPLEMENTATION_VERSION,
        "thresholds": DEFAULT_THRESHOLDS,
    }:
        raise ValueError("QA report rubric thresholds are malformed")
    analyzer = value.get("analyzer")
    if not isinstance(analyzer, dict) or set(analyzer) != {
        "kind", "implementation", "version", "external_network", "python_dependencies",
    }:
        raise ValueError("QA report analyzer is missing")
    dependencies = analyzer.get("python_dependencies")
    if (
        analyzer.get("kind") != "deterministic"
        or analyzer.get("implementation") != IMPLEMENTATION_NAME
        or analyzer.get("version") != IMPLEMENTATION_VERSION
        or analyzer.get("external_network") is not False
        or not isinstance(dependencies, dict)
        or set(dependencies) != {"pillow", "numpy", "opencv"}
        or any(not isinstance(item, str) for item in dependencies.values())
    ):
        raise ValueError("QA report analyzer contract is malformed")
    if not isinstance(value.get("findings"), list):
        raise ValueError("QA report metrics/findings is missing")
    _checked_report_metrics(value.get("metrics"))
    codes: set[str] = set()
    for finding in value["findings"]:
        if (
            not isinstance(finding, dict)
            or set(finding) != {"code", "severity", "message", "metric", "actual", "expected"}
            or not isinstance(finding.get("code"), str)
            or re.fullmatch(r"[a-z][a-z0-9_]{0,99}", finding["code"]) is None
            or finding.get("severity") not in SEVERITY_ORDER
            or not isinstance(finding.get("message"), str)
            or not isinstance(finding.get("metric"), str)
        ):
            raise ValueError("QA report finding is malformed")
        if finding["code"] in codes:
            raise ValueError("QA report contains duplicate finding codes")
        codes.add(finding["code"])
    expected_order = sorted(value["findings"], key=lambda item: (SEVERITY_ORDER[item["severity"]], item["code"]))
    if value["findings"] != expected_order:
        raise ValueError("QA report findings are not in canonical order")
    if value["status"] != _report_status(value["findings"]):
        raise ValueError("QA report status does not match its findings")
    try:
        canonical_json(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("QA report is not finite canonical JSON") from exc
    if value["analysis_key"] != _analysis_key(expectation, value["rubric"]["thresholds"]):
        raise ValueError("QA report analysis_key does not match its artifact contract")
    if value["metrics_sha256"] != canonical_sha256(_metrics_digest_payload(value)):
        raise ValueError("QA report metrics_sha256 does not match its canonical content")
    return value


def compare_reports(before_value: object, after_value: object) -> dict[str, Any]:
    """Compare the fixed report semantics without a generic object-diff dependency."""

    before = _checked_report(before_value)
    after = _checked_report(after_value)
    incompatibilities: list[str] = []
    for rubric_key in ("id", "version", "implementation_version"):
        if before["rubric"].get(rubric_key) != after["rubric"].get(rubric_key):
            incompatibilities.append(f"rubric.{rubric_key}")
    for artifact_key in ("role", "media_type", "profile", "palette_version", "expected_width_px", "expected_height_px"):
        if before["artifact"].get(artifact_key) != after["artifact"].get(artifact_key):
            incompatibilities.append(f"artifact.{artifact_key}")
    compatible = not incompatibilities
    before_metrics = _flatten_metrics(before["metrics"])
    after_metrics = _flatten_metrics(after["metrics"])
    metric_changes = [] if not compatible else [
        {"path": path, "before": copy.deepcopy(before_metrics[path]), "after": copy.deepcopy(after_metrics[path])}
        for path in sorted(before_metrics)
        if before_metrics[path] != after_metrics[path]
    ]

    before_findings = {
        item.get("code"): _semantic_finding(item)
        for item in before["findings"] if isinstance(item, dict) and isinstance(item.get("code"), str)
    }
    after_findings = {
        item.get("code"): _semantic_finding(item)
        for item in after["findings"] if isinstance(item, dict) and isinstance(item.get("code"), str)
    }
    added_codes = sorted(set(after_findings) - set(before_findings))
    removed_codes = sorted(set(before_findings) - set(after_findings))
    changed_codes = sorted(
        code for code in set(before_findings) & set(after_findings)
        if before_findings[code] != after_findings[code]
    )
    finding_changes = {
        "added": [after_findings[code] for code in added_codes],
        "removed": [before_findings[code] for code in removed_codes],
        "changed": [
            {"code": code, "before": before_findings[code], "after": after_findings[code]}
            for code in changed_codes
        ],
    }
    artifact_changed = before["artifact"] != after["artifact"]
    rubric_changed = before["rubric"] != after["rubric"]
    status_changed = before.get("status") != after.get("status")
    comparison = {
        "schema_name": COMPARISON_SCHEMA_NAME,
        "schema_version": COMPARISON_SCHEMA_VERSION,
        "before_analysis_key": str(before.get("analysis_key") or ""),
        "after_analysis_key": str(after.get("analysis_key") or ""),
        "compatible": compatible,
        "incompatibilities": sorted(incompatibilities),
        "equivalent": compatible and not (
            artifact_changed or rubric_changed or status_changed or metric_changes or any(finding_changes.values())
        ),
        "artifact_changed": artifact_changed,
        "rubric_changed": rubric_changed,
        "status_changed": status_changed,
        "metric_changes": metric_changes,
        "finding_changes": finding_changes,
    }
    comparison["comparison_sha256"] = canonical_sha256(comparison)
    return comparison


def exact_duplicate_groups(reports_by_id: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return stable exact-byte duplicate groups for batch diagnostics."""

    grouped: dict[str, list[str]] = {}
    for report_id, report in reports_by_id.items():
        checked = _checked_report(report)
        digest = checked["artifact"].get("actual_sha256")
        if isinstance(digest, str) and SHA256_PATTERN.fullmatch(digest):
            grouped.setdefault(digest, []).append(str(report_id))
    return [
        {"artifact_sha256": digest, "case_ids": sorted(case_ids)}
        for digest, case_ids in sorted(grouped.items())
        if len(case_ids) > 1
    ]


__all__ = [
    "ArtifactExpectation",
    "COMPARISON_SCHEMA_NAME",
    "COMPARISON_SCHEMA_VERSION",
    "DEFAULT_THRESHOLDS",
    "IMPLEMENTATION_VERSION",
    "MANGA_BASE_PALETTE",
    "QAEnvironmentError",
    "REPORT_SCHEMA_NAME",
    "REPORT_SCHEMA_VERSION",
    "analyze_artifact_bytes",
    "analyze_artifact_path",
    "canonical_json",
    "canonical_sha256",
    "compare_reports",
    "exact_duplicate_groups",
    "utc_timestamp",
]
