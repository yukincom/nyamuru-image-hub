import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
TAGGER_PATH = ROOT / "scripts" / "local_wd_expression_tagger.py"
TAGGER_SPEC = importlib.util.spec_from_file_location("local_wd_expression_tagger", TAGGER_PATH)
tagger = importlib.util.module_from_spec(TAGGER_SPEC)
assert TAGGER_SPEC and TAGGER_SPEC.loader
sys.modules[TAGGER_SPEC.name] = tagger
TAGGER_SPEC.loader.exec_module(tagger)

PERFORMANCE_PATH = ROOT / "scripts" / "local_figure_performance_worker.py"
PERFORMANCE_SPEC = importlib.util.spec_from_file_location("wd_hint_figure_performance", PERFORMANCE_PATH)
performance = importlib.util.module_from_spec(PERFORMANCE_SPEC)
assert PERFORMANCE_SPEC and PERFORMANCE_SPEC.loader
sys.modules[PERFORMANCE_SPEC.name] = performance
PERFORMANCE_SPEC.loader.exec_module(performance)


class WdExpressionTaggerTest(unittest.TestCase):
    def test_only_allowlisted_general_expression_tags_survive(self):
        rows = [
            ("1girl", 0),
            ("smile", 0),
            ("one_eye_closed", 0),
            ("school_uniform", 0),
            ("explicit", 9),
            ("some_character", 4),
        ]
        hints = tagger.expression_hints_from_scores(
            rows,
            [0.99, 0.84, 0.79, 0.98, 0.99, 0.99],
            threshold=0.35,
        )
        self.assertEqual([item["tag"] for item in hints], ["smile", "one_eye_closed"])
        self.assertIn("smile-like upward curve", hints[0]["text"])
        self.assertEqual(hints[1]["text"], "one eye is closed")

    def test_threshold_and_score_order_are_deterministic(self):
        rows = [("smile", 0), ("open_mouth", 0), ("blush", 0)]
        hints = tagger.expression_hints_from_scores(rows, [0.36, 0.91, 0.34], threshold=0.35)
        self.assertEqual([item["tag"] for item in hints], ["open_mouth", "smile"])

    def test_direct_manga_shapes_use_narrow_lower_thresholds_but_expressionless_is_excluded(self):
        rows = [
            ("expressionless", 0),
            ("wide-eyed", 0),
            ("v-shaped_eyebrows", 0),
            ("angry", 0),
        ]
        hints = tagger.expression_hints_from_scores(rows, [0.95, 0.11, 0.09, 0.09], threshold=0.35)
        self.assertEqual([item["tag"] for item in hints], ["wide-eyed", "v-shaped_eyebrows"])
        self.assertEqual([item["threshold"] for item in hints], [0.1, 0.08])

    def test_qwen_prompt_receives_natural_english_not_danbooru_tokens(self):
        prompt = performance.prompt_text("face", [{
            "tag": "one_eye_closed",
            "score": 0.82,
            "text": "one eye is closed",
        }])
        self.assertIn("Expression-only visual hints from a local WD Tagger", prompt)
        self.assertIn("one eye is closed (confidence 0.82)", prompt)
        self.assertNotIn("one_eye_closed", prompt)
        self.assertIn("tentative candidate cues, not observations", prompt)
        self.assertIn("must not affect pose or character matching", prompt)
        self.assertIn("wide-open eyes", prompt)
        self.assertIn("Sharp V-shaped eyebrows", prompt)
        self.assertIn("must not become high-confidence or strong surprise", prompt)

    def test_prompt_without_hints_keeps_the_existing_qwen_path(self):
        prompt = performance.prompt_text("bust-up", [])
        self.assertNotIn("Expression-only visual hints", prompt)
        self.assertIn("表情の規則", prompt)

    def test_closed_mouth_alone_is_recorded_but_not_sent_as_emotion_context(self):
        prompt = performance.prompt_text("face", [{
            "tag": "closed_mouth",
            "score": 0.74,
            "threshold": 0.35,
            "text": "the mouth is closed",
        }])
        self.assertNotIn("Expression-only visual hints", prompt)
        self.assertIn("表情の規則", prompt)

    def test_wide_eyes_alone_remain_auxiliary_and_do_not_rewrite_qwen_observations(self):
        expression = {
            "families": [{"label": "中立", "visual_evidence": []}],
            "direction_draft": "感情表現は見られない",
            "confidence": "high",
            "uncertainties": [],
        }
        result = performance.attach_expression_hint_provenance(expression, {
            "hints": [{
                "tag": "wide-eyed",
                "score": 0.11,
                "threshold": 0.1,
                "text": "the eyes are opened wide",
            }],
            "source": {"provider": "wd-tagger", "verified_pinned_artifacts": False},
        })
        self.assertEqual(result["families"], [{"label": "中立", "visual_evidence": []}])
        self.assertEqual(result["direction_draft"], "感情表現は見られない")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["uncertainties"], [])
        self.assertEqual(result["tag_hints"][0]["tag"], "wide-eyed")
        self.assertFalse(result["hint_source"]["verified_pinned_artifacts"])

    def test_custom_artifacts_are_hashed_and_never_labeled_as_the_pinned_model(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            model = directory / "custom.onnx"
            tags = directory / "custom.csv"
            model.write_bytes(b"custom model bytes")
            tags.write_text("name,category\nsmile,0\n", encoding="utf-8")
            identity = tagger.source_identity(model, tags)

        self.assertEqual(identity["model"], "local WD expression tagger override")
        self.assertEqual(identity["revision"], "")
        self.assertRegex(identity["model_sha256"], r"^[a-f0-9]{64}$")
        self.assertRegex(identity["tags_sha256"], r"^[a-f0-9]{64}$")
        self.assertFalse(identity["verified_pinned_artifacts"])


if __name__ == "__main__":
    unittest.main()
