"""模擬した照合候補・演技の応答で入力の限定とbridge結果を確認する。実機の人物識別・画質は対象外。"""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
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
    # 名前・別名・推測は目で照合できない。手入力の観察語だけを1回送り、架空の候補や辞書内容は送らない（promptの組立のみ）。
    def test_prompt_supplies_only_ids_and_reviewed_appearance_once(self):
        prompt = worker.prompt_text([{
            "id": "person-a", "name": "NameLeak", "aliases": ["AliasLeak"],
            "inferred": ["InferredLeak"], "observed_traits": ["短いボブ", "短いボブ"],
        }, {"id": "empty-traits", "name": "NoEvidence", "observed_traits": []}])
        self.assertIn('{"id":"person-a","observed_traits":["短いボブ"]}', prompt)
        self.assertEqual(prompt.count("短いボブ"), 1)
        for omitted in ("NameLeak", "AliasLeak", "InferredLeak", "empty-traits", "S071", "WD Tagger"):
            self.assertNotIn(omitted, prompt)
        self.assertIn("short English phrases", prompt)

    # 同一部位の英語と日本語が返っても自動観察語だけを英語で残す。模擬出力で候補と観察を確認し、根拠ゼロでは確定しない。
    def test_normalization_keeps_only_supported_identity_and_english_observations(self):
        candidates = [{"id": "person-a", "observed_traits": ["顎までのボブ"]}]
        response = {"candidate_id": "person-a", "confidence": "high",
                    "observed": ["jaw-length bob", "Jaw-length bob", "顎までのボブ", "smiling with closed eyes"]}
        result = worker.normalize_analysis(response, candidates)
        self.assertEqual((result["candidate_id"], result["observed"]), ("person-a", ["jaw-length bob"]))
        response["observed"] = ["顎までのボブ"]
        self.assertEqual(worker.normalize_analysis(response, candidates)["confidence"], "none")

    # 通常取込は同じ切り抜きを人物照合と演技の2回だけで読む。模擬MLXで送信を記録し、辞書/WDと台帳の分離、部位採用の結果、画像解放を確認する。
    def test_combined_read_uses_the_existing_two_passes_and_applies_only_the_target_expression(self):
        requests = []
        identity = {"candidate_id": "person-a", "confidence": "medium",
                    "observed": ["jaw-length bob"], "reason": "The bob matches."}
        face = {"face_id": "face_01", "confidence": "medium",
                "parts_mapping": {"eyes": {"id": "S010", "evidence_en": "half-lidded eyes"},
                                  "mouth": {"id": "S050", "evidence_en": "a short straight closed mouth"}}}
        response = {"framing": "bust_up", "pose": {"base_posture": "standing"}, "expression": {"faces": [face]}}
        def generate(_model, _processor, prompt, *, image, **kwargs):
            requests.append((prompt, image))
            return SimpleNamespace(text=json.dumps([identity, response][len(requests) - 1]))
        model = SimpleNamespace(config={})
        modules = {
            "mlx_vlm": SimpleNamespace(load=lambda _path: (model, object()), generate=generate),
            "mlx_vlm.prompt_utils": SimpleNamespace(apply_chat_template=lambda _p, _c, prompt, *, num_images:
                                                   prompt if num_images == 1 else self.fail("expected one crop")),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").touch()
            original, prepared = root / "original", root / "prepared"
            original.touch()
            prepared.touch()
            with patch.dict(sys.modules, modules), patch.object(worker.performance, "prepare_image",
                    return_value=(prepared, 600, 300)):
                result = worker.analyze(root, original, [{"id": "person-a", "observed_traits": ["顎までのボブ"]}],
                    "bust-up", 700, {"hints": [{"tag": "one_eye_closed", "text": "one eyelid may be closed", "score": 0.5}]})
            self.assertFalse(prepared.exists())
        self.assertEqual([image for _, image in requests], [str(prepared), str(prepared)])
        id_prompt, acting_prompt = [prompt for prompt, _ in requests]
        self.assertEqual(id_prompt.count("顎までのボブ"), 1)
        self.assertNotIn("S086", id_prompt)
        self.assertNotIn("one eyelid may be closed", id_prompt)
        self.assertNotIn("person-a", acting_prompt)
        self.assertNotIn("顎までのボブ", acting_prompt)
        self.assertEqual(acting_prompt.count("one eyelid may be closed"), 1)
        self.assertIn("S086 C10", acting_prompt)
        self.assertEqual(result["candidate_id"], "person-a")
        self.assertEqual(result["analysis"]["expression"]["target_face_id"], "face_01")
        self.assertEqual(result["suggested_action"].lower().count("half-lidded eyes"), 1)
        self.assertNotIn("expressionless", result["suggested_action"])
        self.assertIn("Standing.", result["suggested_action"])

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

    # 顔もポーズも読めなくても画像内の外見照合は有効。模擬workerで空の演技は辞書解析付きだけ通り、壊れた応答は拒否する。
    def test_no_face_does_not_lose_independent_identity(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            result = {"candidate_id": "person-a", "confidence": "medium", "observed": ["jaw-length bob"],
                      "reason": "Visible hair matches.", "suggested_action": "", "suggested_size": "face",
                      "analysis": {"expression": {"catalog_version": "v1", "faces": [], "target_face_id": None,
                                                  "catalog_sha256": "a" * 64}}}
            incoming = [{"id": "person-a", "name": "unneeded", "aliases": ["also unneeded"],
                         "observed_traits": ["jaw-length bob"]}]
            with patch.object(state, "expression_tagging", return_value={}), patch.object(
                vision_state, "run_character_match_worker", return_value=result
            ) as runner:
                data = state.analyze_character_match(b"crop", incoming, "face")
                self.assertEqual(runner.call_args.kwargs["candidates"],
                                 [{"id": "person-a", "observed_traits": ["jaw-length bob"]}])
                self.assertEqual((data["candidate_id"], data["action"], data["analysis"]), ("person-a", "", result["analysis"]))
                result["analysis"] = {}
                with self.assertRaises(RuntimeError):
                    state.analyze_character_match(b"crop", incoming, "face")

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
