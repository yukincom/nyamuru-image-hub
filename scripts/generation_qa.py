#!/usr/bin/env python3
"""Deterministic, local-only QA for Nyamuru manga-base artifacts.

This module deliberately has no bridge, ComfyUI, VLM, or network integration.
Image dependencies are imported lazily so schema/canonicalization tests can run
with the system Python before the optional local vision environment is present.
"""

from __future__ import annotations

import hashlib
import io
import os
import stat
import warnings
from fractions import Fraction
from pathlib import Path
from typing import Any

from generation_qa_contract import (
    REPORT_SCHEMA_NAME,
    REPORT_SCHEMA_VERSION,
    COMPARISON_SCHEMA_NAME,
    COMPARISON_SCHEMA_VERSION,
    RUBRIC_ID,
    RUBRIC_VERSION,
    IMPLEMENTATION_NAME,
    IMPLEMENTATION_VERSION,
    MANGA_BASE_PROFILE,
    MANGA_BASE_ROLE,
    MANGA_BASE_PALETTE_VERSION,
    PNG_MEDIA_TYPE,
    PNG_SIGNATURE,
    MAX_ARTIFACT_BYTES,
    MAX_DIMENSION_PX,
    MAX_PIXEL_COUNT,
    PNG_SPEC_MAX_DIMENSION,
    SHA256_PATTERN,
    UTC_TIMESTAMP_PATTERN,
    APNG_CHUNK_TYPES,
    PNG_CRITICAL_CHUNK_TYPES,
    MANGA_BASE_PALETTE,
    DEFAULT_THRESHOLDS,
    SEVERITY_ORDER,
    METRIC_KEYS,
    QAEnvironmentError,
    PNGStructureError,
    ArtifactExpectation,
    utc_timestamp,
    _checked_utc_timestamp,
    canonical_json,
    canonical_sha256,
    _rounded_fraction,
    _report_status,
    _load_image_dependencies,
    _checked_png_chunks,
    _ratio_matches,
    _analysis_key,
    _metrics_digest_payload,
    _empty_metrics,
)
from generation_qa_results import (
    _finding,
    _base_report,
    _finalize_report,
    _flatten_metrics,
    _semantic_finding,
    _is_integer,
    _checked_report_metrics,
    _checked_report,
    compare_reports,
    exact_duplicate_groups,
)


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
