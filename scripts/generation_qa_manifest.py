"""Read generation QA fixture manifests and verify the batch baseline."""

from __future__ import annotations

import json
import os
import re
import stat
from pathlib import Path
from typing import Any

from generation_qa import canonical_sha256, compare_reports, exact_duplicate_groups


BATCH_SCHEMA_NAME = "nyamuru-generation-qa-batch"
BATCH_SCHEMA_VERSION = 1
FIXTURE_SCHEMA_NAME = "nyamuru-generation-qa-fixture-manifest"
FIXTURE_SCHEMA_VERSION = 1
MAX_CASES = 256
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
CASE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
FILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.png$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class BatchInputError(ValueError):
    """Raised for an invalid or unsafe batch input."""


def _read_bounded_json(path: Path, *, maximum_bytes: int = MAX_MANIFEST_BYTES) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink():
        raise BatchInputError(f"JSON input must be a regular non-symlink file: {path}")
    resolved = path.resolve(strict=True)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(resolved, flags)
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode):
            raise BatchInputError(f"JSON input must be a regular non-symlink file: {path}")
        if file_stat.st_size > maximum_bytes:
            raise BatchInputError(f"JSON input exceeds {maximum_bytes} bytes: {path}")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            raw = handle.read(maximum_bytes + 1)
        if len(raw) > maximum_bytes:
            raise BatchInputError(f"JSON input exceeds {maximum_bytes} bytes: {path}")
    finally:
        os.close(descriptor)
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BatchInputError(f"invalid UTF-8 JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise BatchInputError(f"JSON root must be an object: {path}")
    return value, raw


def _checked_manifest(path: Path) -> tuple[dict[str, Any], bytes, Path]:
    manifest, raw = _read_bounded_json(path)
    if manifest.get("schema_name") != FIXTURE_SCHEMA_NAME or manifest.get("schema_version") != FIXTURE_SCHEMA_VERSION:
        raise BatchInputError("unsupported fixture manifest schema")
    if manifest.get("kind") != "project-generated-synthetic":
        raise BatchInputError("fixture manifest kind must be project-generated-synthetic")
    if set(manifest) != {"schema_name", "schema_version", "kind", "cases"}:
        raise BatchInputError("fixture manifest has missing or unknown root fields")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise BatchInputError(f"fixture manifest must contain 1..{MAX_CASES} cases")

    seen_ids: set[str] = set()
    seen_files: set[str] = set()
    required = {
        "case_id", "file_name", "artifact_sha256", "source_snapshot_sha256",
        "expected_status", "expected_finding_codes", "expected_pixel_semantics",
    }
    for index, case in enumerate(cases):
        if not isinstance(case, dict) or set(case) != required:
            raise BatchInputError(f"case {index} has missing or unknown fields")
        case_id = case.get("case_id")
        file_name = case.get("file_name")
        if not isinstance(case_id, str) or CASE_ID_PATTERN.fullmatch(case_id) is None or case_id in seen_ids:
            raise BatchInputError(f"case {index} has an invalid or duplicate case_id")
        if not isinstance(file_name, str) or FILE_NAME_PATTERN.fullmatch(file_name) is None or file_name in seen_files:
            raise BatchInputError(f"case {case_id} has an invalid or duplicate file_name")
        for digest_key in ("artifact_sha256", "source_snapshot_sha256"):
            digest = case.get(digest_key)
            if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
                raise BatchInputError(f"case {case_id} has an invalid {digest_key}")
        if case.get("expected_status") not in {"pass", "warn", "fail"}:
            raise BatchInputError(f"case {case_id} has an invalid expected_status")
        codes = case.get("expected_finding_codes")
        if not isinstance(codes, list) or any(
            not isinstance(code, str) or re.fullmatch(r"[a-z][a-z0-9_]{0,99}", code) is None
            for code in codes
        ):
            raise BatchInputError(f"case {case_id} has invalid expected_finding_codes")
        if codes != sorted(set(codes)):
            raise BatchInputError(f"case {case_id} expected_finding_codes must be unique and sorted")
        semantics = case.get("expected_pixel_semantics")
        if not isinstance(semantics, str) or not 1 <= len(semantics) <= 500:
            raise BatchInputError(f"case {case_id} has no expected_pixel_semantics")
        seen_ids.add(case_id)
        seen_files.add(file_name)

    return manifest, raw, path.resolve(strict=True).parent


def _fixture_path(manifest_dir: Path, file_name: str) -> Path:
    candidate = manifest_dir / file_name
    if candidate.is_symlink():
        raise BatchInputError(f"fixture must not be a symlink: {file_name}")
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise BatchInputError(f"fixture does not exist: {file_name}") from exc
    if resolved.parent != manifest_dir or not resolved.is_file():
        raise BatchInputError(f"fixture escapes its manifest directory: {file_name}")
    return resolved


def _batch_digest_payload(batch: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_name": batch["schema_name"],
        "schema_version": batch["schema_version"],
        "manifest_sha256": batch["manifest"]["sha256"],
        "cases": [
            {
                "case_id": item["case_id"],
                "expectation_match": item["expectation_match"],
                "analysis_key": item["report"]["analysis_key"],
                "metrics_sha256": item["report"]["metrics_sha256"],
            }
            for item in batch["cases"]
        ],
        "duplicate_groups": batch["duplicate_groups"],
        "baseline": {
            "provided": batch["baseline"]["provided"],
            "added_case_ids": batch["baseline"]["added_case_ids"],
            "removed_case_ids": batch["baseline"]["removed_case_ids"],
            "comparisons": [
                {
                    "case_id": item["case_id"],
                    "comparison_sha256": item["comparison"]["comparison_sha256"],
                }
                for item in batch["baseline"]["comparisons"]
            ],
        },
    }


def _checked_comparison(value: object) -> None:
    expected_keys = {
        "schema_name", "schema_version", "before_analysis_key", "after_analysis_key",
        "compatible", "incompatibilities", "equivalent", "artifact_changed", "rubric_changed",
        "status_changed", "metric_changes", "finding_changes", "comparison_sha256",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise BatchInputError("baseline comparison contract is malformed")
    digest = value.get("comparison_sha256")
    if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
        raise BatchInputError("baseline comparison digest is malformed")
    without_digest = {key: item for key, item in value.items() if key != "comparison_sha256"}
    if canonical_sha256(without_digest) != digest:
        raise BatchInputError("baseline comparison digest does not match its canonical content")


def _checked_baseline(path: Path) -> dict[str, Any]:
    baseline, _raw = _read_bounded_json(path, maximum_bytes=32 * 1024 * 1024)
    if baseline.get("schema_name") != BATCH_SCHEMA_NAME or baseline.get("schema_version") != BATCH_SCHEMA_VERSION:
        raise BatchInputError("unsupported baseline batch schema")
    if set(baseline) != {
        "schema_name", "schema_version", "generated_at", "manifest", "cases", "summary",
        "duplicate_groups", "baseline", "batch_sha256",
    }:
        raise BatchInputError("baseline batch root contract is malformed")
    manifest = baseline.get("manifest")
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"file_name", "sha256"}
        or not isinstance(manifest.get("file_name"), str)
        or not manifest["file_name"]
        or not isinstance(manifest.get("sha256"), str)
        or SHA256_PATTERN.fullmatch(manifest["sha256"]) is None
    ):
        raise BatchInputError("baseline manifest identity is malformed")
    cases = baseline.get("cases")
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise BatchInputError(f"baseline cases must contain 1..{MAX_CASES} cases")
    seen: set[str] = set()
    reports_by_id: dict[str, dict[str, Any]] = {}
    for case in cases:
        case_id = case.get("case_id") if isinstance(case, dict) else None
        expected_codes = case.get("expected_finding_codes") if isinstance(case, dict) else None
        invalid_codes = (
            not isinstance(expected_codes, list)
            or any(not isinstance(code, str) for code in expected_codes)
            or (isinstance(expected_codes, list) and all(isinstance(code, str) for code in expected_codes)
                and expected_codes != sorted(set(expected_codes)))
        )
        if (
            not isinstance(case, dict)
            or set(case) != {
                "case_id", "expected_status", "expected_finding_codes", "expectation_match", "report",
            }
            or not isinstance(case_id, str)
            or CASE_ID_PATTERN.fullmatch(case_id) is None
            or case_id in seen
            or not isinstance(case.get("report"), dict)
            or case.get("expected_status") not in {"pass", "warn", "fail"}
            or invalid_codes
            or not isinstance(case.get("expectation_match"), bool)
        ):
            raise BatchInputError("baseline has malformed or duplicate cases")
        try:
            compare_reports(case["report"], case["report"])
        except (TypeError, ValueError) as exc:
            raise BatchInputError(f"baseline report is invalid: {case_id}: {exc}") from exc
        actual_codes = sorted(item["code"] for item in case["report"]["findings"])
        expected_match = (
            case["report"]["status"] == case["expected_status"]
            and actual_codes == case["expected_finding_codes"]
        )
        if case["expectation_match"] is not expected_match:
            raise BatchInputError(f"baseline expectation result is inconsistent: {case_id}")
        seen.add(case_id)
        reports_by_id[case_id] = case["report"]
    summary = baseline.get("summary")
    status_counts = {
        status: sum(1 for case in cases if case["report"]["status"] == status)
        for status in ("pass", "warn", "fail")
    }
    expected_summary = {
        "total": len(cases),
        "matching": sum(1 for case in cases if case["expectation_match"]),
        "mismatching": sum(1 for case in cases if not case["expectation_match"]),
        "status_counts": status_counts,
    }
    if summary != expected_summary:
        raise BatchInputError("baseline summary does not match its cases")
    if baseline.get("duplicate_groups") != exact_duplicate_groups(reports_by_id):
        raise BatchInputError("baseline duplicate groups do not match its reports")
    prior_baseline = baseline.get("baseline")
    if not isinstance(prior_baseline, dict) or set(prior_baseline) != {
        "provided", "added_case_ids", "removed_case_ids", "comparisons",
    }:
        raise BatchInputError("baseline comparison summary is malformed")
    if not isinstance(prior_baseline.get("provided"), bool):
        raise BatchInputError("baseline comparison presence is malformed")
    for key in ("added_case_ids", "removed_case_ids"):
        values = prior_baseline.get(key)
        if not isinstance(values, list) or values != sorted(set(values)) or any(
            not isinstance(item, str) or CASE_ID_PATTERN.fullmatch(item) is None for item in values
        ):
            raise BatchInputError(f"baseline {key} is malformed")
    comparisons = prior_baseline.get("comparisons")
    if not isinstance(comparisons, list):
        raise BatchInputError("baseline comparisons are malformed")
    comparison_ids: list[str] = []
    for entry in comparisons:
        if not isinstance(entry, dict) or set(entry) != {"case_id", "comparison"}:
            raise BatchInputError("baseline comparison entry is malformed")
        case_id = entry.get("case_id")
        if not isinstance(case_id, str) or CASE_ID_PATTERN.fullmatch(case_id) is None:
            raise BatchInputError("baseline comparison case ID is malformed")
        _checked_comparison(entry.get("comparison"))
        if entry["comparison"]["after_analysis_key"] != reports_by_id.get(case_id, {}).get("analysis_key"):
            raise BatchInputError("baseline comparison does not bind to its current case report")
        comparison_ids.append(case_id)
    if comparison_ids != sorted(set(comparison_ids)):
        raise BatchInputError("baseline comparison case IDs are not canonical")
    current_ids = set(reports_by_id)
    added_ids = set(prior_baseline["added_case_ids"])
    removed_ids = set(prior_baseline["removed_case_ids"])
    if not prior_baseline["provided"]:
        if added_ids or removed_ids or comparison_ids:
            raise BatchInputError("baseline without a prior report must have an empty comparison summary")
    else:
        if not added_ids.issubset(current_ids):
            raise BatchInputError("baseline added case IDs must belong to the current batch")
        if removed_ids & current_ids:
            raise BatchInputError("baseline removed case IDs must not belong to the current batch")
        if set(comparison_ids) != current_ids - added_ids:
            raise BatchInputError("baseline comparison case IDs do not cover the unchanged current cases")
    digest = baseline.get("batch_sha256")
    if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
        raise BatchInputError("baseline batch digest is malformed")
    try:
        expected_digest = canonical_sha256(_batch_digest_payload(baseline))
    except (KeyError, TypeError, ValueError) as exc:
        raise BatchInputError("baseline batch digest inputs are malformed") from exc
    if digest != expected_digest:
        raise BatchInputError("baseline batch digest does not match its canonical content")
    return baseline
