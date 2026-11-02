"""WD出力の候補制限・Qwenへ渡す内容と来歴を模擬入力で検証。原画の表情推定は実機で別途確認。"""

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

    # WDが渡すのは英語候補1回。辞書との同時入力でもraw tagを含めず、実線の根拠を求める。模擬タグのみ。
    def test_qwen_prompt_receives_natural_english_not_danbooru_tokens(self):
        prompt = performance.prompt_text("face", [{
            "tag": "one_eye_closed",
            "score": 0.82,
            "text": "one eye is closed",
        }])
        self.assertIn("Expression-only visual hints from a local WD Tagger", prompt)
        self.assertEqual(prompt.count("one eye is closed (confidence 0.82)"), 1)
        self.assertNotIn("one_eye_closed", prompt)
        self.assertIn("tentative candidate cues, not observations", prompt.lower())
        self.assertIn("must not affect pose or character matching", prompt)
        self.assertIn("visible strokes independently support", prompt)
        self.assertIn("single cue cannot establish strong emotion", prompt)

    # WD候補なしでも同じ辞書で表情を読む。promptにヒント欄がなく5枠と辞書が残ることを確認。
    def test_prompt_without_hints_keeps_the_existing_qwen_path(self):
        prompt = performance.prompt_text("bust-up", [])
        self.assertNotIn("Expression-only visual hints", prompt)
        self.assertIn("parts_mapping", prompt)
        self.assertIn("S050", prompt)

    # 閉じた口だけでは顔全体の感情を示さない。promptにヒントを追加せず、通常の読み取り指示が残ることを確認。
    def test_closed_mouth_alone_is_recorded_but_not_sent_as_emotion_context(self):
        prompt = performance.prompt_text("face", [{
            "tag": "closed_mouth",
            "score": 0.74,
            "threshold": 0.35,
            "text": "the mouth is closed",
        }])
        self.assertNotIn("Expression-only visual hints", prompt)
        self.assertIn("parts_mapping", prompt)
        self.assertIn("S050", prompt)

    # ヒントは来歴のみ。顔のない固定応答にWD候補を添えても、顔・表情を新しく作らない。
    def test_wide_eyes_alone_remain_auxiliary_and_do_not_rewrite_qwen_observations(self):
        expression = performance.normalized_expression({"faces": []})
        result = performance.attach_expression_hint_provenance(expression, {
            "hints": [{
                "tag": "wide-eyed",
                "score": 0.11,
                "threshold": 0.1,
                "text": "the eyes are opened wide",
            }],
            "source": {"provider": "wd-tagger", "verified_pinned_artifacts": False},
        })
        self.assertEqual(result["faces"], [])
        self.assertIsNone(result["target_face_id"])
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
