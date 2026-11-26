"""Unit tests for Phase 0 (flywheel & eval) and Group 3 lightweight models (M6, M7)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
DEV_TOOLS_DIR = ROOT / "dev_tools"
for path in (SCRIPTS_DIR, DEV_TOOLS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from model_lab.dataset_flywheel import (  # noqa: E402
    extract_character_match_pairs,
    extract_layout_annotations,
    extract_ocr_correction_pairs,
    extract_project_training_samples,
)
from model_lab.model_eval_harness import (  # noqa: E402
    benchmark_inference_latency,
    evaluate_character_match_predictions,
    evaluate_ocr_cer,
    evaluate_orientation_predictions,
    evaluate_slot_predictions,
)
import layout_relation_scorer as relation_scorer  # noqa: E402
import page_orientation_classifier as orientation_classifier  # noqa: E402
import vision_model_paths  # noqa: E402


class Phase0FlywheelAndEvalTests(unittest.TestCase):
    def test_extracts_ocr_layout_and_character_samples_from_project_json(self):
        project = {
            "manga": {
                "characters": [{"localId": "c1", "catalog_id": "cat-1"}],
                "pages": [
                    {
                        "page": 1,
                        "canvas": {"w": 210, "h": 297},
                        "panels": [
                            {
                                "id": 1,
                                "shape": {"type": "rect", "x": 10, "y": 10, "w": 90, "h": 120},
                                "figures": [
                                    {
                                        "refId": "c1",
                                        "size": "bust-up",
                                        "bbox": {"x": 20, "y": 20, "w": 40, "h": 60},
                                        "analogImport": {"assetId": "fig-1"},
                                    }
                                ],
                                "bubbles": [
                                    {
                                        "text": "おはよう！",
                                        "shape": "toge",
                                        "speakerId": "c1",
                                        "bbox": {"x": 55, "y": 15, "w": 30, "h": 25},
                                        "analogTextImport": {"assetId": "txt-1", "ocrText": "おはよぅ"},
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        }
        ocr = extract_ocr_correction_pairs(project)
        self.assertEqual(len(ocr), 1)
        self.assertTrue(ocr[0]["was_corrected"])
        self.assertEqual(ocr[0]["shape"], "toge")

        layout = extract_layout_annotations(project)
        self.assertEqual(len(layout[0]["panels"][0]["speaker_links"]), 1)

        chars = extract_character_match_pairs(project)
        self.assertEqual(chars[0]["character_id"], "c1")
        self.assertEqual(chars[0]["catalog_id"], "cat-1")

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "project.json"
            target.write_text(json.dumps(project), encoding="utf-8")
            bundle = extract_project_training_samples(target)
            self.assertEqual(bundle["summary"]["ocr_corrected"], 1)
            self.assertEqual(bundle["summary"]["character_matches"], 1)

    def test_evaluation_metrics_and_latency_harness(self):
        self.assertEqual(evaluate_orientation_predictions([0, 90, 180], [0, 90, 270])["correct"], 2)
        slots = evaluate_slot_predictions(
            [[("PANEL_NUM", "1"), ("CHAR_NAME", "小雪")]],
            [[("PANEL_NUM", "1"), ("CHAR_NAME", "小雪")]],
        )
        self.assertEqual(slots["f1"], 1.0)
        match = evaluate_character_match_predictions(["c1", "c2"], [("c1", "high"), ("", "none")])
        self.assertEqual(match["accepted_precision"], 1.0)
        self.assertEqual(match["abstention_rate"], 0.5)
        cer = evaluate_ocr_cer(["おはよう"], ["おはよ"])
        self.assertAlmostEqual(cer["cer"], 0.25)
        bench = benchmark_inference_latency(lambda: sum(range(10)), warmup=1, runs=3)
        self.assertEqual(bench["runs"], 3)
        self.assertGreaterEqual(bench["mean_ms"], 0.0)


class Group3OrientationAndRelationTests(unittest.TestCase):
    def test_orientation_classifier_falls_back_to_zero_when_model_absent_or_uncertain(self):
        missing = orientation_classifier.estimate_page_orientation(b"fake-bytes", model_path=None)
        self.assertEqual(missing["recommended_degrees"], 0)
        self.assertFalse(missing["applied"])
        self.assertEqual(missing["fallback_reason"], "model_unavailable")

        low_conf = orientation_classifier.interpret_orientation_probabilities([0.4, 0.45, 0.1, 0.05], min_confidence=0.8)
        self.assertEqual(low_conf["recommended_degrees"], 0)
        self.assertEqual(low_conf["raw_degrees"], 90)
        self.assertEqual(low_conf["fallback_reason"], "low_confidence")

        high_conf = orientation_classifier.interpret_orientation_probabilities([0.01, 0.94, 0.03, 0.02], min_confidence=0.8)
        self.assertEqual(high_conf["recommended_degrees"], 90)
        self.assertTrue(high_conf["applied"])

    def test_upright_scan_rotations_and_single_pass_selection(self):
        import io
        import numpy as np
        from PIL import Image

        # Create an asymmetric RGB test image (unique corner colors)
        base = Image.new("RGB", (64, 64), (255, 255, 255))
        for y in range(20):
            for x in range(20):
                base.putpixel((x, y), (255, 0, 0))       # top-left: red
                base.putpixel((44 + x, y), (0, 255, 0))  # top-right: green
                base.putpixel((x, 44 + y), (0, 0, 255))  # bottom-left: blue
        buf = io.BytesIO()
        base.save(buf, format="PNG")
        candidates = orientation_classifier.prepare_orientation_candidates(buf.getvalue(), input_size=64)
        self.assertEqual(candidates.shape, (4, 3, 64, 64))
        for idx, deg in enumerate((0, 90, 180, 270)):
            expected_img = base.rotate(-deg, expand=False)
            expected_arr = np.asarray(expected_img, dtype=np.float32).transpose(2, 0, 1) / 255.0
            self.assertTrue(np.allclose(candidates[idx], expected_arr, atol=1e-5))

        picked = orientation_classifier.interpret_upright_scan_probabilities(
            [0.05, 0.94, 0.02, 0.03], min_confidence=0.80, model_name="page-orientation"
        )
        self.assertEqual(picked["strategy"], "upright_scan")
        self.assertEqual(picked["recommended_degrees"], 90)
        self.assertTrue(picked["applied"])

        tied = orientation_classifier.interpret_upright_scan_probabilities(
            [0.85, 0.01, 0.84, 0.01], min_confidence=0.80
        )
        self.assertEqual(tied["recommended_degrees"], 0)
        self.assertEqual(tied["fallback_reason"], "low_confidence")
        self.assertFalse(tied["applied"])

        class FakeInput:
            def __init__(self, shape):
                self.name = "input"
                self.shape = shape

        class FakeSession:
            def __init__(self, input_size):
                self._input = FakeInput(["batch", 3, input_size, input_size])
                self.calls = []

            def get_inputs(self):
                return [self._input]

            def run(self, _outputs, feed):
                batch = feed["input"]
                self.calls.append(batch.shape)
                # Return logits where index 3 (270 CW) gives highest upright probability
                return [np.array([
                    [0.0, 2.0, 1.0, 4.0],
                    [0.0, 1.0, 4.0, 1.0],
                    [0.0, 4.0, 1.0, 1.0],
                    [6.0, 0.0, 0.0, 0.0],
                ], dtype=np.float32)]

        with tempfile.TemporaryDirectory() as directory:
            model_file = Path(directory) / "page-orientation" / "model.onnx"
            model_file.parent.mkdir(parents=True)
            model_file.write_bytes(b"onnx")
            for size in (384, 224):
                fake_session = FakeSession(size)
                with patch.object(orientation_classifier, "_get_session", return_value=fake_session):
                    res = orientation_classifier.estimate_page_orientation(buf.getvalue(), model_path=model_file)
                self.assertEqual(fake_session.calls, [(4, 3, size, size)])
                self.assertEqual(res["recommended_degrees"], 270)
                self.assertTrue(res["applied"])

    def test_layout_relation_scorer_links_speakers_and_flags_page_overlay(self):
        panels = [(0.52, 0.05, 0.42, 0.40), (0.06, 0.05, 0.42, 0.40)]
        order = relation_scorer.score_panel_reading_order(panels)
        self.assertEqual(order["order"], [0, 1])

        people = [
            {"id": "fig-right", "bbox": (0.60, 0.12, 0.20, 0.28)},
            {"id": "fig-left", "bbox": (0.14, 0.12, 0.20, 0.28)},
        ]
        lines = [
            {"id": "ocr-1", "text": "右コマセリフ", "bbox": (0.76, 0.08, 0.12, 0.12)},
            {"id": "ocr-2", "text": "左コマセリフ", "bbox": (0.08, 0.08, 0.12, 0.12)},
        ]
        linked = relation_scorer.link_bubble_speakers(lines, people, panel_boxes=panels)
        self.assertEqual(linked[0].get("speaker_figure_id"), "fig-right")
        self.assertEqual(linked[1].get("speaker_figure_id"), "fig-left")

        overlay_checked = relation_scorer.classify_page_overlay_candidates(
            [
                {"id": "inside", "bbox": (0.60, 0.12, 0.20, 0.28)},
                {"id": "spanning", "bbox": (0.38, 0.10, 0.30, 0.55)},
            ],
            panels,
        )
        self.assertFalse(overlay_checked[0]["page_overlay_recommended"])
        self.assertTrue(overlay_checked[1]["page_overlay_recommended"])

    def test_vision_model_paths_prefers_personal_ocr_when_valid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            personal = root / "models" / "ocr-personal"
            (personal / "onnx").mkdir(parents=True)
            (personal / "tokenizer").mkdir(parents=True)
            for rel in (
                "onnx_infer.py",
                "onnx/vision_int4.onnx",
                "onnx/decoder_prefill_int8.onnx",
                "onnx/decoder_step_int8.onnx",
                "tokenizer/vocab.json",
            ):
                (personal / rel).write_bytes(b"ok")
            with patch.dict("os.environ", {}, clear=True):
                resolved, is_personal = vision_model_paths.resolve_text_ocr_model(root)
            self.assertTrue(is_personal)
            self.assertEqual(resolved, personal)


if __name__ == "__main__":
    unittest.main()
