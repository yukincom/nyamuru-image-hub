"""Artifact expectations, canonical identifiers and PNG format checks for generation QA."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import struct
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
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
