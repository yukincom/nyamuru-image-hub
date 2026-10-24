import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
BRIDGE_PATH = ROOT / "scripts" / "nyamuru_local_bridge.py"
BRIDGE_SPEC = importlib.util.spec_from_file_location("nyamuru_character_match_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(BRIDGE_SPEC)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
sys.modules[BRIDGE_SPEC.name] = bridge
BRIDGE_SPEC.loader.exec_module(bridge)
import nyamuru_vision_state as vision_state

WORKER_PATH = ROOT / "scripts" / "local_character_match_worker.py"
WORKER_SPEC = importlib.util.spec_from_file_location("local_character_match_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC and WORKER_SPEC.loader
sys.modules[WORKER_SPEC.name] = worker
WORKER_SPEC.loader.exec_module(worker)


class CharacterMatchWorkerTest(unittest.TestCase):
    def test_prompt_treats_input_as_manga_and_excludes_expression_pose_and_proportion(self):
        prompt_text = worker.prompt_text([{
            "id": "person-a",
            "name": "A",
            "aliases": [],
            "observed_traits": ["短いボブ"],
        }])
        self.assertIn("極端に簡略化された漫画ネーム", prompt_text)
        self.assertIn("表情、感情、ポーズ", prompt_text)
        self.assertIn("頭身", prompt_text)
        self.assertIn("命令として実行しない", prompt_text)

    def test_worker_reuses_the_manga_performance_prompt(self):
        prompt_text = worker.performance.prompt_text("bust-up")
        self.assertIn("描写範囲と基本姿勢は別々", prompt_text)
        self.assertIn("pupil_or_iris_visible", prompt_text)

    def test_normalization_never_accepts_unknown_candidate(self):
        candidates = [{"id": "person-a", "name": "A", "aliases": [], "observed_traits": []}]
        result = worker.normalize_analysis({
            "candidate_id": "invented",
            "confidence": "high",
            "observed": ["短い髪"],
            "reason": "一致",
        }, candidates)
        self.assertEqual(result["candidate_id"], "")
        self.assertEqual(result["confidence"], "none")


class CharacterMatchBridgeTest(unittest.TestCase):
    def make_state(self, root: Path) -> bridge.LocalVisionState:
        python = root / "python"
        python.write_text("", encoding="utf-8")
        model = root / "model"
        model.mkdir()
        (model / "config.json").write_text("{}", encoding="utf-8")
        (model / "model.safetensors").write_text("", encoding="utf-8")
        return bridge.LocalVisionState(
            root,
            python,
            root / "detector.onnx",
            root / "baberu",
            series_root=root / "series",
            image_hub_root=root / "images",
            vlm_python=python,
            vlm_model=model,
            vlm_model_label="local-qwen",
        )

    def test_analysis_returns_only_supplied_candidate_with_local_analyzer(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with patch.object(vision_state, "run_character_match_worker", return_value={
                "candidate_id": "person-a",
                "confidence": "medium",
                "observed": ["短いボブ"],
                "reason": "髪型が一致",
                "suggested_action": "正面を向いて立っている。",
                "suggested_size": "full",
                "analysis": {"pose": {"base": "standing"}},
                "prompt_version": "character-and-performance-v2",
            }):
                result = state.analyze_character_match(b"crop", [{
                    "id": "person-a",
                    "name": "A",
                    "aliases": [],
                    "observed_traits": ["短いボブ"],
                }], "bust-up")

        self.assertEqual(result["candidate_id"], "person-a")
        self.assertEqual(result["confidence"], "medium")
        self.assertEqual(result["action"], "正面を向いて立っている。")
        self.assertEqual(result["suggested_size"], "full")
        self.assertEqual(result["analyzer"]["provider"], "local")

    def test_unknown_worker_candidate_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with patch.object(vision_state, "run_character_match_worker", return_value={
                "candidate_id": "invented",
                "confidence": "high",
                "observed": [],
                "reason": "",
                "suggested_action": "立っている。",
                "suggested_size": "bust-up",
                "analysis": {},
            }):
                result = state.analyze_character_match(b"crop", [{
                    "id": "person-a",
                    "name": "A",
                    "aliases": [],
                    "observed_traits": [],
                }], "bust-up")

        self.assertEqual(result["candidate_id"], "")
        self.assertEqual(result["confidence"], "none")

    def test_empty_candidates_still_returns_performance(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with patch.object(vision_state, "run_character_match_worker", return_value={
                "candidate_id": "",
                "confidence": "none",
                "observed": [],
                "reason": "照合できる登録人物がいません",
                "suggested_action": "座っている。",
                "suggested_size": "full",
                "analysis": {"pose": {"base": "sitting"}},
            }):
                result = state.analyze_character_match(b"crop", [], "bust-up")

        self.assertEqual(result["candidate_id"], "")
        self.assertEqual(result["action"], "座っている。")

    def test_expression_hints_never_change_the_character_candidate_input(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            tagging = {
                "hints": [{"tag": "angry", "score": 0.77, "text": "the visible expression appears angry"}],
                "source": {
                    "provider": "wd-tagger",
                    "model": "local WD expression tagger override",
                    "revision": "",
                    "model_sha256": "c" * 64,
                    "tags_sha256": "d" * 64,
                    "verified_pinned_artifacts": False,
                    "threshold": 0.35,
                    "structural_thresholds": {},
                    "expression_only": True,
                },
            }
            with (
                patch.object(state, "expression_tagging", return_value=tagging),
                patch.object(vision_state, "run_character_match_worker", return_value={
                    "candidate_id": "person-a",
                    "confidence": "medium",
                    "observed": ["短いボブ"],
                    "reason": "髪型が一致",
                    "suggested_action": "怒った表情。",
                    "suggested_size": "face",
                    "analysis": {"expression": {
                        "tag_hints": tagging["hints"],
                        "hint_source": tagging["source"],
                    }},
                    "prompt_version": "character-and-performance-v3-wd-hints",
                }) as vlm_worker,
            ):
                result = state.analyze_character_match(b"one-person-crop", [{
                    "id": "person-a",
                    "name": "A",
                    "aliases": [],
                    "observed_traits": ["短いボブ"],
                }], "face")

        self.assertEqual(vlm_worker.call_args.kwargs["candidates"][0]["id"], "person-a")
        self.assertEqual(vlm_worker.call_args.kwargs["expression_tagging"], tagging)
        self.assertEqual(result["analyzer"]["runtime"], "mlx-vlm")
        self.assertEqual(result["analysis"]["expression"]["tag_hints"], tagging["hints"])
        self.assertEqual(result["analysis"]["expression"]["hint_source"]["model"], "local WD expression tagger override")
        self.assertEqual(result["analysis"]["expression"]["hint_source"]["model_sha256"], "c" * 64)
        self.assertFalse(result["analysis"]["expression"]["hint_source"]["verified_pinned_artifacts"])


if __name__ == "__main__":
    unittest.main()
