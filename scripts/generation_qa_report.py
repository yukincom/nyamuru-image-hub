#!/usr/bin/env python3
"""Batch and Markdown reporting CLI for deterministic generation QA fixtures.

This command accepts only a project-generated fixture manifest. It never scans
arbitrary directories, follows symlinks, calls a service, or invokes a VLM.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
import unicodedata
from pathlib import Path
from typing import Any, Sequence

from generation_qa import (
    ArtifactExpectation,
    QAEnvironmentError,
    analyze_artifact_path,
    canonical_json,
    canonical_sha256,
    compare_reports,
    exact_duplicate_groups,
    utc_timestamp,
)

from generation_qa_manifest import (
    BATCH_SCHEMA_NAME,
    BATCH_SCHEMA_VERSION,
    FIXTURE_SCHEMA_NAME,
    FIXTURE_SCHEMA_VERSION,
    MAX_CASES,
    MAX_MANIFEST_BYTES,
    CASE_ID_PATTERN,
    FILE_NAME_PATTERN,
    SHA256_PATTERN,
    BatchInputError,
    _read_bounded_json,
    _checked_manifest,
    _fixture_path,
    _batch_digest_payload,
    _checked_comparison,
    _checked_baseline,
)


def build_batch_report(
    manifest_path: Path,
    *,
    baseline_path: Path | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    manifest, manifest_raw, manifest_dir = _checked_manifest(manifest_path)
    case_results: list[dict[str, Any]] = []
    reports_by_id: dict[str, dict[str, Any]] = {}
    status_counts = {"pass": 0, "warn": 0, "fail": 0}

    for case in sorted(manifest["cases"], key=lambda item: item["case_id"]):
        case_id = case["case_id"]
        fixture_path = _fixture_path(manifest_dir, case["file_name"])
        expectation = ArtifactExpectation(
            job_id=f"fixture-{case_id}",
            attempt_id=f"fixture-attempt-{case_id}",
            artifact_sha256=case["artifact_sha256"],
            source_snapshot_sha256=case["source_snapshot_sha256"],
        )
        report = analyze_artifact_path(fixture_path, expectation, created_at=generated_at)
        finding_codes = sorted(item["code"] for item in report["findings"])
        expectation_match = (
            report["status"] == case["expected_status"]
            and finding_codes == case["expected_finding_codes"]
        )
        status_counts[report["status"]] += 1
        case_results.append({
            "case_id": case_id,
            "expected_status": case["expected_status"],
            "expected_finding_codes": case["expected_finding_codes"],
            "expectation_match": expectation_match,
            "report": report,
        })
        reports_by_id[case_id] = report

    baseline_summary: dict[str, Any] = {
        "provided": baseline_path is not None,
        "added_case_ids": [],
        "removed_case_ids": [],
        "comparisons": [],
    }
    if baseline_path is not None:
        baseline = _checked_baseline(baseline_path)
        prior_reports = {item["case_id"]: item["report"] for item in baseline["cases"]}
        current_ids = set(reports_by_id)
        prior_ids = set(prior_reports)
        baseline_summary["added_case_ids"] = sorted(current_ids - prior_ids)
        baseline_summary["removed_case_ids"] = sorted(prior_ids - current_ids)
        baseline_summary["comparisons"] = [
            {"case_id": case_id, "comparison": compare_reports(prior_reports[case_id], reports_by_id[case_id])}
            for case_id in sorted(current_ids & prior_ids)
        ]

    matching = sum(1 for item in case_results if item["expectation_match"])
    batch: dict[str, Any] = {
        "schema_name": BATCH_SCHEMA_NAME,
        "schema_version": BATCH_SCHEMA_VERSION,
        "generated_at": generated_at or utc_timestamp(),
        "manifest": {
            "file_name": manifest_path.name,
            "sha256": hashlib.sha256(manifest_raw).hexdigest(),
        },
        "cases": case_results,
        "summary": {
            "total": len(case_results),
            "matching": matching,
            "mismatching": len(case_results) - matching,
            "status_counts": status_counts,
        },
        "duplicate_groups": exact_duplicate_groups(reports_by_id),
        "baseline": baseline_summary,
    }
    batch["batch_sha256"] = canonical_sha256(_batch_digest_payload(batch))
    return batch


def batch_has_regression(batch: dict[str, Any]) -> bool:
    if batch["summary"]["mismatching"]:
        return True
    baseline = batch["baseline"]
    if not baseline["provided"]:
        return False
    if baseline["added_case_ids"] or baseline["removed_case_ids"]:
        return True
    return any(not item["comparison"]["equivalent"] for item in baseline["comparisons"])


def render_markdown(batch: dict[str, Any]) -> str:
    lines = [
        "# Nyamuru deterministic generation QA",
        "",
        f"- Generated: `{batch['generated_at']}`",
        f"- Batch SHA-256: `{batch['batch_sha256']}`",
        f"- Cases: {batch['summary']['total']} (matching {batch['summary']['matching']}, mismatching {batch['summary']['mismatching']})",
        "",
        "| Case | Status | Expected | Findings | Match |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in batch["cases"]:
        findings = ", ".join(finding["code"] for finding in item["report"]["findings"]) or "none"
        lines.append(
            f"| `{item['case_id']}` | {item['report']['status']} | {item['expected_status']} | {findings} | "
            f"{'yes' if item['expectation_match'] else 'NO'} |"
        )
    lines.extend(["", "## Exact-byte duplicates", ""])
    if batch["duplicate_groups"]:
        for group in batch["duplicate_groups"]:
            lines.append(f"- `{group['artifact_sha256']}`: {', '.join(group['case_ids'])}")
    else:
        lines.append("- none")
    lines.extend(["", "## Baseline", ""])
    baseline = batch["baseline"]
    if not baseline["provided"]:
        lines.append("- not provided")
    else:
        lines.append(f"- Added cases: {', '.join(baseline['added_case_ids']) or 'none'}")
        lines.append(f"- Removed cases: {', '.join(baseline['removed_case_ids']) or 'none'}")
        changed = [item["case_id"] for item in baseline["comparisons"] if not item["comparison"]["equivalent"]]
        lines.append(f"- Changed cases: {', '.join(changed) or 'none'}")
    return "\n".join(lines) + "\n"


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _same_path(left: Path, right: Path) -> bool:
    try:
        if left.samefile(right):
            return True
    except (FileNotFoundError, OSError):
        pass
    left_key = unicodedata.normalize("NFC", str(left.resolve(strict=False))).casefold()
    right_key = unicodedata.normalize("NFC", str(right.resolve(strict=False))).casefold()
    return left_key == right_key


def _reject_path_collisions(paths: Sequence[tuple[str, Path | None]]) -> None:
    present = [(label, path) for label, path in paths if path is not None]
    for index, (left_label, left_path) in enumerate(present):
        for right_label, right_path in present[index + 1:]:
            if _same_path(left_path, right_path):
                raise BatchInputError(f"{left_label} and {right_label} must use different paths")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path, help="project-generated fixture manifest")
    parser.add_argument("--baseline", type=Path, help="prior batch JSON to compare semantically")
    parser.add_argument("--json-out", type=Path, help="write canonical batch JSON atomically")
    parser.add_argument("--markdown-out", type=Path, help="write a human-readable Markdown summary atomically")
    parser.add_argument("--generated-at", help=argparse.SUPPRESS)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        _reject_path_collisions([
            ("manifest", args.manifest),
            ("baseline", args.baseline),
            ("JSON output", args.json_out),
            ("Markdown output", args.markdown_out),
        ])
        batch = build_batch_report(
            args.manifest,
            baseline_path=args.baseline,
            generated_at=args.generated_at,
        )
        canonical = (canonical_json(batch) + "\n").encode("utf-8")
        if args.json_out is not None:
            _atomic_write(args.json_out, canonical)
        if args.markdown_out is not None:
            _atomic_write(args.markdown_out, render_markdown(batch).encode("utf-8"))
        if args.json_out is None and args.markdown_out is None:
            sys.stdout.buffer.write(canonical)
        return 1 if batch_has_regression(batch) else 0
    except (BatchInputError, QAEnvironmentError, KeyError, OSError, TypeError, ValueError) as exc:
        print(f"generation QA input/environment error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
