import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
SPEC = importlib.util.spec_from_file_location("nyamuru_local_bridge", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)

WORKER_MODULE_PATH = Path(__file__).parents[1] / "scripts" / "local_vision_worker.py"
WORKER_SPEC = importlib.util.spec_from_file_location("local_vision_worker", WORKER_MODULE_PATH)
worker = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC and WORKER_SPEC.loader
sys.modules[WORKER_SPEC.name] = worker
WORKER_SPEC.loader.exec_module(worker)


class ScannerSessionsTest(unittest.TestCase):
    def test_decodes_cocoa_unicode_escape_in_document_name(self):
        completed = type("Completed", (), {"stdout": r"\u30b9\u30ad\u30e3\u30f3" + "\n"})()
        with patch.object(bridge.subprocess, "run", return_value=completed):
            self.assertEqual(bridge.image_capture_preference("IK_documentName", "scan"), "スキャン")

    def test_quits_image_capture_by_bundle_identifier(self):
        with patch.object(bridge.subprocess, "run") as run:
            bridge.quit_image_capture()

        run.assert_called_once_with(
            [
                "/usr/bin/osascript",
                "-e",
                'if application id "com.apple.Image_Capture" is running then tell application id "com.apple.Image_Capture" to quit',
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_keeps_scans_until_human_commit_and_deletes_only_then(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            old_scan = directory / "スキャン.jpeg"
            old_scan.write_bytes(b"old")
            manager = bridge.ScannerSessions(directory / "scanner-state.json")
            with (
                patch.object(bridge, "scanner_destination", return_value=directory),
                patch.object(bridge, "scanner_document_prefix", return_value="スキャン"),
                patch.object(bridge, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
                patch.object(bridge, "SCANNER_STABLE_SECONDS", 0),
            ):
                session = manager.start()
                new_scan = directory / "スキャン 1.jpeg"
                new_scan.write_bytes(b"new")
                unrelated = directory / "vacation.jpeg"
                unrelated.write_bytes(b"keep")

                self.assertEqual(manager.collect(session["session_id"])["files"], [])
                batch = manager.collect(session["session_id"])
                self.assertEqual([item["filename"] for item in batch["files"]], ["スキャン 1.jpeg"])
                self.assertTrue(new_scan.exists())

                self.assertEqual(manager.finish(session["session_id"]), {"ok": True, "retained": ["スキャン 1.jpeg"]})
                self.assertTrue(new_scan.exists())
                result = manager.commit(session["session_id"])
                self.assertEqual(result, {"deleted": 1, "errors": []})
                self.assertFalse(new_scan.exists())
                self.assertTrue(old_scan.exists())
                self.assertTrue(unrelated.exists())
                self.assertIsNone(manager.active)

    def test_explicit_cancel_deletes_scan_source(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            manager = bridge.ScannerSessions(directory / "scanner-state.json")
            with (
                patch.object(bridge, "scanner_destination", return_value=directory),
                patch.object(bridge, "scanner_document_prefix", return_value="scan"),
                patch.object(bridge, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
                patch.object(bridge, "SCANNER_STABLE_SECONDS", 0),
            ):
                session = manager.start()
                source = directory / "scan 1.jpg"
                source.write_bytes(b"source")
                manager.collect(session["session_id"])
                self.assertEqual(len(manager.collect(session["session_id"])["files"]), 1)
                result = manager.cancel(session["session_id"])
                self.assertEqual(result, {"deleted": 1, "errors": []})
                self.assertFalse(source.exists())
                self.assertIsNone(manager.active)

    def test_recovers_scan_after_forced_restart_without_deleting_it(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            state_path = directory / "scanner-state.json"
            with (
                patch.object(bridge, "scanner_destination", return_value=directory),
                patch.object(bridge, "scanner_document_prefix", return_value="scan"),
                patch.object(bridge, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
            ):
                first_manager = bridge.ScannerSessions(state_path)
                first_manager.start()
                source = directory / "scan 1.jpg"
                source.write_bytes(b"source")

                restarted_manager = bridge.ScannerSessions(state_path)
                pending = restarted_manager.pending()
                self.assertTrue(pending["pending"])
                self.assertEqual(pending["count"], 1)
                self.assertTrue(source.exists())

                resumed = restarted_manager.resume()
                self.assertEqual([item["filename"] for item in resumed["files"]], ["scan 1.jpg"])
                self.assertTrue(source.exists())
                restarted_manager.commit(resumed["session_id"])
                self.assertFalse(source.exists())
                self.assertFalse(state_path.exists())

    def test_caps_one_session_at_ten_files(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            manager = bridge.ScannerSessions(directory / "scanner-state.json")
            with (
                patch.object(bridge, "scanner_destination", return_value=directory),
                patch.object(bridge, "scanner_document_prefix", return_value="scan"),
                patch.object(bridge, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
                patch.object(bridge, "SCANNER_STABLE_SECONDS", 0),
            ):
                session = manager.start()
                for index in range(12):
                    (directory / f"scan {index:02}.jpg").write_bytes(str(index).encode())
                manager.collect(session["session_id"])
                batch = manager.collect(session["session_id"])
                self.assertEqual(len(batch["files"]), 10)
                self.assertTrue(batch["complete"])
                self.assertEqual(batch["total"], 10)
                result = manager.cancel(session["session_id"])
                self.assertEqual(result, {"deleted": 10, "errors": []})
                self.assertTrue((directory / "scan 10.jpg").exists())
                self.assertTrue((directory / "scan 11.jpg").exists())


class OrientationResultTest(unittest.TestCase):
    def test_accepts_only_valid_manual_rotation_override(self):
        self.assertIsNone(bridge.normalized_rotation_override(None))
        self.assertEqual(bridge.normalized_rotation_override("180"), 180)
        with self.assertRaisesRegex(ValueError, "0・90・180・270"):
            bridge.normalized_rotation_override(45)

    def test_analysis_refuses_an_unconfirmed_orientation(self):
        with self.assertRaisesRegex(ValueError, "画像を正立"):
            bridge.LocalVisionState.analyze(object(), b"image", None)


class LocalVisionResultTest(unittest.TestCase):
    def test_formats_rtdetr_outputs_without_manga_babble_dependency(self):
        detector_path = Path(__file__).parents[1] / "scripts" / "rtdetr_onnx.py"
        detector_spec = importlib.util.spec_from_file_location("rtdetr_onnx", detector_path)
        detector = importlib.util.module_from_spec(detector_spec)
        assert detector_spec and detector_spec.loader
        detector_spec.loader.exec_module(detector)
        buckets = detector.detection_buckets(
            [2, 0, 1, 3, 99],
            [[1, 2, 30, 40], [4, 5, 20, 50], [6, 7, 8, 9], [10, 11, 12, 13], [0, 0, 1, 1]],
            [0.9, 0.8, 0.1, 0.7, 0.99],
            0.2,
        )
        self.assertEqual([item["id"] for item in buckets["frames"]], ["f0"])
        self.assertEqual([item["id"] for item in buckets["bodies"]], ["b0"])
        self.assertEqual(buckets["texts"], [])
        self.assertEqual([item["id"] for item in buckets["faces"]], ["face0"])

    def test_reads_ndlocr_text_block_ids_in_line_order(self):
        page_xml = """<PAGE>
          <TEXTBLOCK BLOCKID="7"><LINE X="1"/><LINE X="2"/></TEXTBLOCK>
          <LINE X="3"/>
        </PAGE>"""
        self.assertEqual(worker.ndlocr_line_group_ids(page_xml), [
            "ndl-block-7", "ndl-block-7", None,
        ])

    def test_orders_detected_panels_top_to_bottom_and_right_to_left(self):
        boxes = [
            (0.05, 0.52, 0.4, 0.4),
            (0.55, 0.04, 0.4, 0.4),
            (0.05, 0.05, 0.4, 0.4),
            (0.55, 0.53, 0.4, 0.4),
        ]
        self.assertEqual(bridge.sort_panel_boxes_reading_order(boxes), [
            (0.55, 0.04, 0.4, 0.4),
            (0.05, 0.05, 0.4, 0.4),
            (0.55, 0.53, 0.4, 0.4),
            (0.05, 0.52, 0.4, 0.4),
        ])

    def test_rejects_full_page_frame_from_rtdetr(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {"frames": [
                {"score": 0.9, "bbox": [0, 0, 1000, 1400]},
                {"score": 0.8, "bbox": [40, 50, 960, 600]},
            ]},
        }
        self.assertEqual(bridge.detector_boxes(detection, "frames"), [(0.04, 50 / 1400, 0.92, 550 / 1400)])

    def test_rejects_frame_that_duplicates_a_text_region(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "texts": [{"score": 0.9, "bbox": [105, 105, 395, 295]}],
                "faces": [],
                "bodies": [],
            },
        }
        boxes = [(0.1, 0.07, 0.3, 0.15)]
        kept, excluded = bridge.exclude_non_panel_regions(boxes, detection)
        self.assertEqual(kept, [])
        self.assertEqual(excluded, {"texts": 1, "faces": 0, "bodies": 0})

    def test_keeps_panel_that_only_contains_text_and_a_person(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "texts": [{"score": 0.9, "bbox": [120, 120, 220, 320]}],
                "faces": [{"score": 0.9, "bbox": [300, 220, 420, 340]}],
                "bodies": [{"score": 0.9, "bbox": [260, 200, 480, 620]}],
            },
        }
        boxes = [(0.05, 0.04, 0.9, 0.42)]
        kept, excluded = bridge.exclude_non_panel_regions(boxes, detection)
        self.assertEqual(kept, boxes)
        self.assertEqual(excluded, {"texts": 0, "faces": 0, "bodies": 0})

    def test_fuses_bodies_with_only_unmatched_faces_as_person_regions(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "faces": [
                    {"score": 0.9, "bbox": [300, 220, 420, 340]},
                    {"score": 0.8, "bbox": [700, 180, 800, 280]},
                ],
                "bodies": [
                    {"score": 0.9, "bbox": [260, 200, 480, 620]},
                    {"score": 0.7, "bbox": [270, 210, 475, 610]},
                ],
            },
        }
        self.assertEqual(bridge.detected_person_regions(detection), [
            {"source": "body", "bbox": [0.26, 0.142857, 0.22, 0.3]},
            {"source": "face", "bbox": [0.7, 0.128571, 0.1, 0.071429]},
        ])

    def test_filters_giant_and_latin_garbage_ocr_regions(self):
        payload = {
            "width": 1000,
            "height": 1400,
            "region_lines": [
                {"id": "good", "text": "ものようになる。", "bbox": [600, 100, 140, 180], "confidence": 0.7, "group_id": "ndl-block-2"},
                {"id": "bad", "text": "AAAAAAAAAAAA", "bbox": [50, 50, 100, 100], "confidence": 0.8},
            ],
            "detected_lines": [
                {"id": "page", "text": "誤検出", "bbox": [0, 0, 1000, 1400], "confidence": 0.9},
            ],
        }
        lines = bridge.usable_ocr_lines(payload)
        self.assertEqual([line["id"] for line in lines], ["good"])
        self.assertEqual(lines[0]["group_id"], "ndl-block-2")
        self.assertFalse(lines[0]["needs_review"])


if __name__ == "__main__":
    unittest.main()
