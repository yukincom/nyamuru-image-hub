from __future__ import annotations

import ast
import copy
import hashlib
import importlib.util
import json
import math
import os
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "generation_qa"
SCHEMAS = ROOT / "schemas"
sys.path.insert(0, str(SCRIPTS))

import generation_qa as qa  # noqa: E402
import generation_qa_report as qa_report  # noqa: E402


try:
    import cv2  # type: ignore[import-not-found]  # noqa: F401
    import numpy  # type: ignore[import-not-found]  # noqa: F401
    import PIL  # type: ignore[import-not-found]  # noqa: F401
except ImportError:
    IMAGE_DEPENDENCIES_AVAILABLE = False
else:
    IMAGE_DEPENDENCIES_AVAILABLE = True

try:
    from jsonschema import Draft202012Validator  # type: ignore[import-not-found]
    from referencing import Registry, Resource  # type: ignore[import-not-found]
except ImportError:
    JSON_SCHEMA_AVAILABLE = False
else:
    JSON_SCHEMA_AVAILABLE = True

REQUIRE_QA_DEPENDENCIES = os.environ.get("NYAMURU_QA_REQUIRE_DEPENDENCIES") == "1"
if REQUIRE_QA_DEPENDENCIES and not IMAGE_DEPENDENCIES_AVAILABLE:
    raise RuntimeError("NYAMURU_QA_REQUIRE_DEPENDENCIES=1 but Pillow/numpy/OpenCV could not be imported")
if REQUIRE_QA_DEPENDENCIES and not JSON_SCHEMA_AVAILABLE:
    raise RuntimeError("NYAMURU_QA_REQUIRE_DEPENDENCIES=1 but jsonschema/referencing could not be imported")


def fixture_manifest() -> dict:
    return json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))


def expectation(case: dict) -> qa.ArtifactExpectation:
    return qa.ArtifactExpectation(
        job_id=f"fixture-{case['case_id']}",
        attempt_id=f"fixture-attempt-{case['case_id']}",
        artifact_sha256=case["artifact_sha256"],
        source_snapshot_sha256=case["source_snapshot_sha256"],
    )


def analyze_case(case: dict, *, created_at: str = "2026-09-01T00:00:00Z") -> dict:
    return qa.analyze_artifact_path(FIXTURES / case["file_name"], expectation(case), created_at=created_at)


class GenerationQAStructuralTest(unittest.TestCase):
    def test_canonical_json_is_stable_and_rejects_non_finite_numbers(self):
        left = {"日本語": [3, 2, 1], "alpha": {"z": False, "a": None}}
        right = {"alpha": {"a": None, "z": False}, "日本語": [3, 2, 1]}
        self.assertEqual(qa.canonical_json(left), qa.canonical_json(right))
        self.assertEqual(qa.canonical_sha256(left), qa.canonical_sha256(right))
        with self.assertRaises(ValueError):
            qa.canonical_json({"bad": math.nan})

    def test_artifact_expectation_is_fail_closed(self):
        digest = "a" * 64
        valid = qa.ArtifactExpectation("job", "attempt", digest, digest)
        self.assertEqual(valid.role, "manga_base_composite")
        invalid_values = [
            {"job_id": ""},
            {"artifact_sha256": "A" * 64},
            {"role": "preview"},
            {"media_type": "image/jpeg"},
            {"profile": "other"},
            {"palette_version": "other"},
            {"width_px": True},
            {"width_px": 8193},
            {"width_px": 4097, "height_px": 4097},
        ]
        base = {
            "job_id": "job", "attempt_id": "attempt", "artifact_sha256": digest,
            "source_snapshot_sha256": digest,
        }
        for replacement in invalid_values:
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                qa.ArtifactExpectation(**(base | replacement))

    def test_threshold_boundaries_use_exact_integer_ratios(self):
        self.assertTrue(qa._ratio_matches(2, 1000, 0.002, "<="))
        self.assertFalse(qa._ratio_matches(3, 1000, 0.002, "<="))
        self.assertTrue(qa._ratio_matches(98, 100, 0.98, ">="))
        self.assertFalse(qa._ratio_matches(97, 100, 0.98, ">="))
        self.assertFalse(qa._ratio_matches(2, 100, 0.02, ">"))
        self.assertTrue(qa._ratio_matches(3, 100, 0.02, ">"))

    def test_report_timestamp_must_be_valid_utc(self):
        case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "invalid-trailing")
        with self.assertRaisesRegex(ValueError, "UTC timestamp"):
            analyze_case(case, created_at="2026-09-01T00:00:00+09:00")
        with self.assertRaisesRegex(ValueError, "valid UTC timestamp"):
            analyze_case(case, created_at="2026-02-30T00:00:00Z")

    def test_analysis_key_binds_expected_dimensions_and_threshold_values(self):
        case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "invalid-trailing")
        default_report = analyze_case(case)
        changed_expectation = qa.ArtifactExpectation(
            job_id=f"fixture-{case['case_id']}",
            attempt_id=f"fixture-attempt-{case['case_id']}",
            artifact_sha256=case["artifact_sha256"],
            source_snapshot_sha256=case["source_snapshot_sha256"],
            width_px=511,
        )
        changed_report = qa.analyze_artifact_path(FIXTURES / case["file_name"], changed_expectation)
        self.assertNotEqual(default_report["analysis_key"], changed_report["analysis_key"])
        changed_thresholds = {**qa.DEFAULT_THRESHOLDS, "edge_band_ratio": 0.03}
        self.assertNotEqual(
            qa._analysis_key(expectation(case)),
            qa._analysis_key(expectation(case), changed_thresholds),
        )

    def test_manifest_hashes_cover_every_checked_in_png(self):
        manifest = fixture_manifest()
        self.assertEqual(manifest["schema_name"], "nyamuru-generation-qa-fixture-manifest")
        self.assertEqual(manifest["kind"], "project-generated-synthetic")
        listed = set()
        for case in manifest["cases"]:
            path = FIXTURES / case["file_name"]
            self.assertFalse(path.is_symlink())
            self.assertTrue(path.is_file())
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), case["artifact_sha256"])
            self.assertEqual(case["expected_finding_codes"], sorted(set(case["expected_finding_codes"])))
            listed.add(case["file_name"])
        self.assertEqual(listed, {path.name for path in FIXTURES.glob("*.png")})

    def test_fixture_provenance_is_project_owned_and_model_free(self):
        provenance = json.loads((FIXTURES / "provenance.json").read_text(encoding="utf-8"))
        self.assertEqual(provenance["kind"], "project-generated-synthetic")
        self.assertFalse(provenance["external_assets"])
        self.assertFalse(provenance["external_network"])
        self.assertEqual(provenance["models_used"], [])
        self.assertRegex(provenance["generator_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(
            provenance["generator_sha256"],
            hashlib.sha256((FIXTURES / "build_fixtures.py").read_bytes()).hexdigest(),
        )
        for case in fixture_manifest()["cases"]:
            derived = hashlib.sha256(
                f"generation-qa-fixture-v{provenance['generator_version']}:{provenance['generator_sha256']}:{case['case_id']}".encode()
            ).hexdigest()
            self.assertEqual(case["source_snapshot_sha256"], derived)

    def test_draft_2020_12_schemas_are_strict_and_offline_resolvable(self):
        schema_paths = sorted(SCHEMAS.glob("generation-qa-*.schema.json"))
        self.assertGreaterEqual(len(schema_paths), 4)

        def assert_strict_objects(node: object, location: str) -> None:
            if isinstance(node, dict):
                if node.get("type") == "object":
                    self.assertIn("additionalProperties", node, location)
                for key, value in node.items():
                    assert_strict_objects(value, f"{location}/{key}")
            elif isinstance(node, list):
                for index, value in enumerate(node):
                    assert_strict_objects(value, f"{location}/{index}")

        for path in schema_paths:
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
                self.assertTrue(schema["$id"].endswith(path.name))
                self.assertFalse(schema["additionalProperties"])
                assert_strict_objects(schema, path.name)
                for reference in _all_refs(schema):
                    if reference.startswith("#/"):
                        continue
                    self.assertNotIn("://", reference)
                    self.assertTrue((SCHEMAS / reference).is_file(), reference)

    def test_deepdiff_is_not_a_dependency(self):
        requirements = (ROOT / "requirements-qa.txt").read_text(encoding="utf-8").lower()
        requirements += (ROOT / "requirements-vision.txt").read_text(encoding="utf-8").lower()
        self.assertNotIn("deepdiff", requirements)

    def test_core_cli_and_fixture_generator_have_no_network_or_model_imports(self):
        forbidden = {
            "aiohttp", "httpx", "mlx", "requests", "socket", "torch", "transformers", "urllib",
        }
        paths = [
            SCRIPTS / "generation_qa.py",
            SCRIPTS / "generation_qa_contract.py",
            SCRIPTS / "generation_qa_results.py",
            SCRIPTS / "generation_qa_report.py",
            SCRIPTS / "generation_qa_manifest.py",
            FIXTURES / "build_fixtures.py",
        ]
        for path in paths:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            imported = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported.update(alias.name.split(".")[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported.add(node.module.split(".")[0])
            self.assertEqual(imported & forbidden, set(), path.name)

    def test_png_structure_errors_do_not_need_image_dependencies(self):
        early_cases = {
            "invalid-apng": "animated_png_not_allowed",
            "invalid-crc": "png_structure_invalid",
            "invalid-signature": "png_signature_invalid",
            "invalid-trailing": "png_trailing_bytes",
            "invalid-truncated": "png_structure_invalid",
            "invalid-unsafe-dimension": "image_dimensions_unsafe",
        }
        cases = {case["case_id"]: case for case in fixture_manifest()["cases"]}
        for case_id, code in early_cases.items():
            with self.subTest(case_id=case_id):
                report = analyze_case(cases[case_id])
                self.assertEqual(report["status"], "fail")
                self.assertEqual([item["code"] for item in report["findings"]], [code])
                self.assertFalse(report["metrics"]["decoded"])

    def test_png_rejects_one_frame_apng_marker_and_reserved_bit_violation(self):
        valid_case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "valid-four-color")
        valid = (FIXTURES / valid_case["file_name"]).read_bytes()

        def chunk(chunk_type: bytes, data: bytes = b"") -> bytes:
            return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(
                ">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF,
            )

        variants = {
            "one-frame-apng": (valid[:33] + chunk(b"acTL", struct.pack(">II", 1, 0)) + valid[33:], "animated_png_not_allowed"),
            "reserved-bit": (valid[:-12] + chunk(b"aabc") + valid[-12:], "png_structure_invalid"),
        }
        for case_id, (image_bytes, expected_code) in variants.items():
            digest = hashlib.sha256(image_bytes).hexdigest()
            report = qa.analyze_artifact_bytes(
                image_bytes,
                qa.ArtifactExpectation(case_id, f"attempt-{case_id}", digest, "a" * 64),
                created_at="2026-09-01T00:00:00Z",
            )
            with self.subTest(case_id=case_id):
                self.assertEqual(report["status"], "fail")
                self.assertEqual([item["code"] for item in report["findings"]], [expected_code])

    def test_png_requires_one_leading_ihdr_and_idat_before_iend(self):
        valid_case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "valid-four-color")
        valid = (FIXTURES / valid_case["file_name"]).read_bytes()
        first_chunk_end = 33
        variants = {
            "duplicate-ihdr": valid[:first_chunk_end] + valid[8:first_chunk_end] + valid[first_chunk_end:],
            "missing-idat": valid[:first_chunk_end] + valid[-12:],
        }
        for case_id, image_bytes in variants.items():
            digest = hashlib.sha256(image_bytes).hexdigest()
            report = qa.analyze_artifact_bytes(
                image_bytes,
                qa.ArtifactExpectation(case_id, f"attempt-{case_id}", digest, "a" * 64),
                created_at="2026-09-01T00:00:00Z",
            )
            with self.subTest(case_id=case_id):
                self.assertEqual(report["status"], "fail")
                self.assertEqual([item["code"] for item in report["findings"]], ["png_structure_invalid"])

    def test_png_enforces_plte_cardinality_order_and_length(self):
        valid_case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "valid-four-color")
        valid = (FIXTURES / valid_case["file_name"]).read_bytes()

        def chunk(chunk_type: bytes, data: bytes = b"") -> bytes:
            return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(
                ">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF,
            )

        plte = chunk(b"PLTE", b"\x00\x00\x00")
        variants = {
            "plte-after-idat": valid[:-12] + plte + valid[-12:],
            "duplicate-plte": valid[:33] + plte + plte + valid[33:],
            "empty-plte": valid[:33] + chunk(b"PLTE") + valid[33:],
            "partial-entry-plte": valid[:33] + chunk(b"PLTE", b"\x00" * 4) + valid[33:],
            "oversized-plte": valid[:33] + chunk(b"PLTE", b"\x00" * 771) + valid[33:],
        }
        for case_id, image_bytes in variants.items():
            digest = hashlib.sha256(image_bytes).hexdigest()
            report = qa.analyze_artifact_bytes(
                image_bytes,
                qa.ArtifactExpectation(case_id, f"attempt-{case_id}", digest, "a" * 64),
                created_at="2026-09-01T00:00:00Z",
            )
            with self.subTest(case_id=case_id):
                self.assertEqual(report["status"], "fail")
                self.assertEqual([item["code"] for item in report["findings"]], ["png_structure_invalid"])

        chunk_count, _metadata, _width, _height = qa._checked_png_chunks(valid[:33] + plte + valid[33:])
        self.assertGreater(chunk_count, 3)

    def test_comparator_uses_fixed_semantics_not_generic_deep_diff(self):
        case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "invalid-trailing")
        before = analyze_case(case, created_at="2026-09-01T00:00:00Z")
        after = copy.deepcopy(before)
        after["created_at"] = "2026-09-02T00:00:00Z"
        after["analyzer"]["python_dependencies"]["pillow"] = "different-runtime"
        after["findings"][0]["message"] = "wording changed"
        self.assertTrue(qa.compare_reports(before, after)["equivalent"])

        changed = copy.deepcopy(after)
        changed["metrics"]["png_chunk_count"] += 1
        changed["metrics_sha256"] = qa.canonical_sha256(qa._metrics_digest_payload(changed))
        comparison = qa.compare_reports(before, changed)
        self.assertFalse(comparison["equivalent"])
        self.assertEqual(comparison["metric_changes"][0]["path"], "/metrics/png_chunk_count")

        incompatible_expectation = qa.ArtifactExpectation(
            job_id=f"fixture-{case['case_id']}",
            attempt_id=f"fixture-attempt-{case['case_id']}",
            artifact_sha256=case["artifact_sha256"],
            source_snapshot_sha256=case["source_snapshot_sha256"],
            width_px=511,
        )
        incompatible = qa.analyze_artifact_path(
            FIXTURES / case["file_name"], incompatible_expectation, created_at="2026-09-01T00:00:00Z",
        )
        comparison = qa.compare_reports(before, incompatible)
        self.assertFalse(comparison["compatible"])
        self.assertIn("artifact.expected_width_px", comparison["incompatibilities"])
        self.assertEqual(comparison["metric_changes"], [])

    def test_comparator_rejects_duplicate_finding_codes(self):
        case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "invalid-trailing")
        report = analyze_case(case)
        report["findings"].append(copy.deepcopy(report["findings"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate finding codes"):
            qa.compare_reports(report, report)

    def test_comparator_rejects_stale_analysis_and_metrics_digests(self):
        case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "invalid-trailing")
        report = analyze_case(case)
        stale_metrics = copy.deepcopy(report)
        stale_metrics["metrics"]["png_chunk_count"] += 1
        with self.assertRaisesRegex(ValueError, "metrics_sha256"):
            qa.compare_reports(stale_metrics, report)
        stale_analysis = copy.deepcopy(report)
        stale_analysis["analysis_key"] = "qa-" + "0" * 64
        with self.assertRaisesRegex(ValueError, "analysis_key"):
            qa.compare_reports(stale_analysis, report)

    def test_batch_rejects_manifest_path_traversal(self):
        manifest = fixture_manifest()
        manifest["cases"] = [copy.deepcopy(manifest["cases"][0])]
        manifest["cases"][0]["file_name"] = "../escape.png"
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(qa_report.BatchInputError):
                qa_report.build_batch_report(path)

    def test_artifact_and_manifest_symlinks_are_rejected(self):
        case = next(case for case in fixture_manifest()["cases"] if case["case_id"] == "invalid-trailing")
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            artifact_link = directory / "artifact.png"
            manifest_link = directory / "manifest.json"
            try:
                artifact_link.symlink_to(FIXTURES / case["file_name"])
                manifest_link.symlink_to(FIXTURES / "manifest.json")
            except OSError as exc:
                self.skipTest(f"symlink unavailable: {exc}")
            with self.assertRaisesRegex(ValueError, "non-symlink"):
                qa.analyze_artifact_path(artifact_link, expectation(case))
            with self.assertRaises(qa_report.BatchInputError):
                qa_report.build_batch_report(manifest_link)


@unittest.skipUnless(IMAGE_DEPENDENCIES_AVAILABLE, "Pillow/numpy/OpenCV local QA environment unavailable")
class GenerationQAImageMetricsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = fixture_manifest()
        cls.cases = {case["case_id"]: case for case in cls.manifest["cases"]}
        cls.reports = {case_id: analyze_case(case) for case_id, case in cls.cases.items()}

    def test_all_synthetic_cases_match_expected_status_and_findings(self):
        for case_id, case in self.cases.items():
            with self.subTest(case_id=case_id):
                report = self.reports[case_id]
                self.assertEqual(report["status"], case["expected_status"])
                self.assertEqual(sorted(item["code"] for item in report["findings"]), case["expected_finding_codes"])

    def test_decoded_metric_invariants(self):
        for case_id, report in self.reports.items():
            if not report["metrics"]["decoded"]:
                continue
            with self.subTest(case_id=case_id):
                metrics = report["metrics"]
                self.assertEqual(metrics["pixel_count"], metrics["width_px"] * metrics["height_px"])
                self.assertEqual(sum(metrics["palette_counts"].values()) + metrics["unknown_palette_pixels"], metrics["pixel_count"])
                self.assertEqual(metrics["recomposition_mismatch_pixels"], metrics["unknown_palette_pixels"])
                self.assertRegex(metrics["pixel_sha256"], r"^[a-f0-9]{64}$")
                self.assertLessEqual(metrics["tiny_component_pixels"], metrics["content_pixels"])

    def test_container_metadata_does_not_change_pixel_sha(self):
        plain = self.reports["valid-four-color"]
        metadata = self.reports["same-pixels-different-metadata"]
        self.assertNotEqual(plain["artifact"]["actual_sha256"], metadata["artifact"]["actual_sha256"])
        self.assertEqual(plain["metrics"]["pixel_sha256"], metadata["metrics"]["pixel_sha256"])

    def test_analysis_digest_ignores_timestamp_and_runtime_versions(self):
        case = self.cases["valid-four-color"]
        first = analyze_case(case, created_at="2026-09-01T00:00:00Z")
        second = analyze_case(case, created_at="2026-09-02T00:00:00Z")
        self.assertEqual(first["analysis_key"], second["analysis_key"])
        self.assertEqual(first["metrics_sha256"], second["metrics_sha256"])

    def test_exact_duplicate_groups_do_not_confuse_semantic_duplicates(self):
        groups = qa.exact_duplicate_groups(self.reports)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["case_ids"], ["valid-four-color", "valid-four-color-copy"])
        self.assertNotIn("same-pixels-different-metadata", groups[0]["case_ids"])

    def test_fixture_generator_preserves_decoded_semantics(self):
        spec = importlib.util.spec_from_file_location("generation_qa_fixture_builder", FIXTURES / "build_fixtures.py")
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp_dir:
            regenerated_dir = Path(temp_dir)
            module.build(regenerated_dir)
            regenerated = json.loads((regenerated_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(
                [case["case_id"] for case in regenerated["cases"]],
                [case["case_id"] for case in self.manifest["cases"]],
            )
            for case in regenerated["cases"]:
                with self.subTest(case_id=case["case_id"]):
                    report = qa.analyze_artifact_path(regenerated_dir / case["file_name"], expectation(case))
                    self.assertEqual(report["status"], case["expected_status"])
                    self.assertEqual(sorted(item["code"] for item in report["findings"]), case["expected_finding_codes"])
                    checked_in = self.reports[case["case_id"]]
                    if report["metrics"]["decoded"] and checked_in["metrics"]["decoded"]:
                        self.assertEqual(report["metrics"]["pixel_sha256"], checked_in["metrics"]["pixel_sha256"])

    def test_batch_cli_and_baseline_are_stable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            first_json = directory / "first.json"
            first_md = directory / "first.md"
            rc = qa_report.main([
                "--manifest", str(FIXTURES / "manifest.json"),
                "--json-out", str(first_json),
                "--markdown-out", str(first_md),
                "--generated-at", "2026-09-01T00:00:00Z",
            ])
            self.assertEqual(rc, 0)
            first = json.loads(first_json.read_text(encoding="utf-8"))
            self.assertEqual(first["summary"]["mismatching"], 0)
            self.assertIn("Nyamuru deterministic generation QA", first_md.read_text(encoding="utf-8"))

            second = qa_report.build_batch_report(
                FIXTURES / "manifest.json",
                baseline_path=first_json,
                generated_at="2026-09-02T00:00:00Z",
            )
            self.assertFalse(qa_report.batch_has_regression(second))
            self.assertTrue(all(item["comparison"]["equivalent"] for item in second["baseline"]["comparisons"]))
            second_json = directory / "second.json"
            second_json.write_text(qa.canonical_json(second) + "\n", encoding="utf-8")
            third = qa_report.build_batch_report(
                FIXTURES / "manifest.json",
                baseline_path=second_json,
                generated_at="2026-09-03T00:00:00Z",
            )
            self.assertFalse(qa_report.batch_has_regression(third))

            without_baseline = qa_report.build_batch_report(
                FIXTURES / "manifest.json",
                generated_at="2026-09-04T00:00:00Z",
            )
            self.assertEqual(first["batch_sha256"], without_baseline["batch_sha256"])

    def test_baseline_rejects_stale_batch_digest(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            baseline = qa_report.build_batch_report(
                FIXTURES / "manifest.json", generated_at="2026-09-01T00:00:00Z",
            )
            baseline["batch_sha256"] = "0" * 64
            baseline_path = directory / "tampered.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            with self.assertRaisesRegex(qa_report.BatchInputError, "batch digest"):
                qa_report.build_batch_report(FIXTURES / "manifest.json", baseline_path=baseline_path)

    def test_baseline_history_binds_presence_case_ids_and_current_analysis(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            first = qa_report.build_batch_report(
                FIXTURES / "manifest.json", generated_at="2026-09-01T00:00:00Z",
            )
            first_path = directory / "first.json"
            first_path.write_text(qa.canonical_json(first) + "\n", encoding="utf-8")
            second = qa_report.build_batch_report(
                FIXTURES / "manifest.json",
                baseline_path=first_path,
                generated_at="2026-09-02T00:00:00Z",
            )

            mutations = []
            changed_presence = copy.deepcopy(second)
            changed_presence["baseline"]["provided"] = False
            mutations.append(changed_presence)

            changed_case = copy.deepcopy(second)
            changed_case["baseline"]["comparisons"][0]["case_id"] = "valid-four-color"
            mutations.append(changed_case)

            changed_analysis = copy.deepcopy(second)
            changed_analysis["baseline"]["comparisons"][0]["comparison"]["after_analysis_key"] = "qa-" + "0" * 64
            changed_analysis["baseline"]["comparisons"][0]["comparison"]["comparison_sha256"] = qa.canonical_sha256({
                key: value
                for key, value in changed_analysis["baseline"]["comparisons"][0]["comparison"].items()
                if key != "comparison_sha256"
            })
            changed_analysis["batch_sha256"] = qa.canonical_sha256(qa_report._batch_digest_payload(changed_analysis))
            mutations.append(changed_analysis)

            for index, mutated in enumerate(mutations):
                path = directory / f"tampered-{index}.json"
                path.write_text(qa.canonical_json(mutated) + "\n", encoding="utf-8")
                with self.subTest(index=index), self.assertRaises(qa_report.BatchInputError):
                    qa_report.build_batch_report(FIXTURES / "manifest.json", baseline_path=path)

    def test_cli_rejects_colliding_input_and_output_paths_before_writing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "same-output"
            output.write_text("sentinel", encoding="utf-8")
            self.assertEqual(qa_report.main([
                "--manifest", str(FIXTURES / "manifest.json"),
                "--json-out", str(output),
                "--markdown-out", str(output),
            ]), 2)
            self.assertEqual(output.read_text(encoding="utf-8"), "sentinel")

    def test_cli_rejects_casefolded_and_unicode_normalized_output_aliases(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            aliases = [
                (directory / "Report.out", directory / "report.out"),
                (directory / "re\N{LATIN SMALL LETTER E WITH ACUTE}sume.out", directory / "re\N{LATIN SMALL LETTER E}\N{COMBINING ACUTE ACCENT}sume.out"),
            ]
            for json_output, markdown_output in aliases:
                with self.subTest(json_output=json_output.name):
                    self.assertTrue(qa_report._same_path(json_output, markdown_output))
                    self.assertEqual(qa_report.main([
                        "--manifest", str(FIXTURES / "manifest.json"),
                        "--json-out", str(json_output),
                        "--markdown-out", str(markdown_output),
                    ]), 2)
                    self.assertFalse(json_output.exists())
                    self.assertFalse(markdown_output.exists())

    @unittest.skipUnless(JSON_SCHEMA_AVAILABLE, "jsonschema local QA dependency unavailable")
    def test_generated_contracts_validate_against_every_draft_2020_12_schema(self):
        schemas = {
            path.name: json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(SCHEMAS.glob("generation-qa-*.schema.json"))
        }
        registry = Registry().with_resources(
            (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
        )
        for schema in schemas.values():
            Draft202012Validator.check_schema(schema)
        manifest = fixture_manifest()
        provenance = json.loads((FIXTURES / "provenance.json").read_text(encoding="utf-8"))
        batch = qa_report.build_batch_report(
            FIXTURES / "manifest.json", generated_at="2026-09-01T00:00:00Z",
        )
        report = batch["cases"][0]["report"]
        comparison = qa.compare_reports(report, report)
        contracts = {
            "generation-qa-fixture-manifest-v1.schema.json": manifest,
            "generation-qa-fixture-provenance-v1.schema.json": provenance,
            "generation-qa-report-v1.schema.json": report,
            "generation-qa-comparison-v1.schema.json": comparison,
            "generation-qa-batch-v1.schema.json": batch,
        }
        for schema_name, instance in contracts.items():
            with self.subTest(schema=schema_name):
                Draft202012Validator(schemas[schema_name], registry=registry).validate(instance)


def _all_refs(value: object) -> list[str]:
    references: list[str] = []
    if isinstance(value, dict):
        if isinstance(value.get("$ref"), str):
            references.append(value["$ref"])
        for child in value.values():
            references.extend(_all_refs(child))
    elif isinstance(value, list):
        for child in value:
            references.extend(_all_refs(child))
    return references


if __name__ == "__main__":
    unittest.main()
