"""Build, check and compare deterministic quality reports."""

from __future__ import annotations

import copy
import hashlib
import re
from typing import Any, Mapping

from generation_qa_contract import (
    REPORT_SCHEMA_NAME,
    REPORT_SCHEMA_VERSION,
    COMPARISON_SCHEMA_NAME,
    COMPARISON_SCHEMA_VERSION,
    RUBRIC_ID,
    RUBRIC_VERSION,
    IMPLEMENTATION_NAME,
    IMPLEMENTATION_VERSION,
    MAX_DIMENSION_PX,
    MAX_PIXEL_COUNT,
    PNG_SPEC_MAX_DIMENSION,
    SHA256_PATTERN,
    MANGA_BASE_PALETTE,
    DEFAULT_THRESHOLDS,
    SEVERITY_ORDER,
    METRIC_KEYS,
    ArtifactExpectation,
    _checked_utc_timestamp,
    canonical_json,
    canonical_sha256,
    _report_status,
    _analysis_key,
    _metrics_digest_payload,
    _empty_metrics,
)


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


def _finalize_report(report: dict[str, Any]) -> dict[str, Any]:
    findings = report["findings"]
    findings.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], item["code"]))
    report["status"] = _report_status(findings)
    report["metrics_sha256"] = canonical_sha256(_metrics_digest_payload(report))
    return report


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
