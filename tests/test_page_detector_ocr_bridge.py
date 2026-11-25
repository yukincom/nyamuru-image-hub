"""Unit tests for Group 2 M3 (extended page detector) and M4 (personal handwriting OCR)."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import rtdetr_onnx as page_detector  # noqa: E402
import nyamuru_ocr_util as ocr_util  # noqa: E402
import vision_model_paths  # noqa: E402


def _load_local_vision_worker():
    path = SCRIPTS_DIR / "local_vision_worker.py"
    spec = importlib.util.spec_from_file_location("local_vision_worker_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class PageDetectorAndOcrTests(unittest.TestCase):
    def test_detection_buckets_preserves_4_classes_and_maps_extended_bubble_classes(self):
        labels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        boxes = [[i * 10, i * 10, i * 10 + 20, i * 10 + 20] for i in range(10)]
        scores = [0.95] * 10
        buckets = page_detector.detection_buckets(labels, boxes, scores, conf_threshold=0.5)

        self.assertEqual(len(buckets["bodies"]), 1)
        self.assertEqual(len(buckets["frames"]), 1)
        self.assertEqual(len(buckets["faces"]), 1)
        self.assertEqual(len(buckets["tails"]), 1)
        # Standard text + 5 extended bubble/handwritten classes all land in texts with hints.
        self.assertEqual(len(buckets["texts"]), 6)
        hints = [entry.get("bubble_shape_hint") for entry in buckets["texts"]]
        self.assertEqual(hints, [None, "normal", "square", "toge", "thought", "handwritten"])

    def test_detect_manga_page_elements_is_exported_as_model_agnostic_name(self):
        self.assertTrue(callable(page_detector.detect_manga_page_elements))

    def test_usable_ocr_lines_preserves_bubble_shape_hint(self):
        lines = ocr_util.usable_ocr_lines({
            "width": 1000,
            "height": 1400,
            "region_lines": [
                {
                    "id": "t-1",
                    "text": "うおお！",
                    "bbox": [100, 100, 120, 200],
                    "confidence": 0.9,
                    "vertical": True,
                    "bubble_shape_hint": "toge",
                }
            ],
        })
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["bubble_shape_hint"], "toge")

    def test_local_vision_worker_exports_functional_names_and_propagates_shape_hint(self):
        worker = _load_local_vision_worker()
        self.assertTrue(callable(worker.detect_page_elements))
        self.assertTrue(callable(worker.load_text_ocr_engine))
        self.assertTrue(callable(worker.recognize_page_text_regions))

        from PIL import Image

        with tempfile.TemporaryDirectory() as directory:
            img_path = Path(directory) / "page.png"
            Image.new("RGB", (200, 200), "white").save(img_path)
            with patch.object(worker, "load_text_ocr_engine", return_value=lambda _crop: "テスト"):
                result = worker.recognize_page_text_regions(
                    Path(directory),
                    img_path,
                    [{"id": "1", "bbox": [10, 10, 80, 120], "score": 0.9, "bubble_shape_hint": "thought"}],
                    model=Path(directory) / "ocr",
                )
        self.assertEqual(result["region_lines"][0]["text"], "テスト")
        self.assertEqual(result["region_lines"][0]["bubble_shape_hint"], "thought")

    def test_personal_ocr_model_falls_back_to_standard_when_incomplete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Incomplete personal directory must not override standard OCR.
            (root / "models" / "ocr-personal").mkdir(parents=True)
            with patch.dict("os.environ", {}, clear=True):
                resolved, is_personal = vision_model_paths.resolve_text_ocr_model(root)
            self.assertFalse(is_personal)
            self.assertEqual(resolved, root / "models" / "baberu-ocr")


if __name__ == "__main__":
    unittest.main()
