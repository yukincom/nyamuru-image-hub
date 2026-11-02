import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BRIDGE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
BRIDGE_SPEC = importlib.util.spec_from_file_location("nyamuru_figure_performance_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(BRIDGE_SPEC)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
sys.modules[BRIDGE_SPEC.name] = bridge
BRIDGE_SPEC.loader.exec_module(bridge)
import nyamuru_vision_state as vision_state

WORKER_PATH = Path(__file__).parents[1] / "scripts" / "local_figure_performance_worker.py"
WORKER_SPEC = importlib.util.spec_from_file_location("local_figure_performance_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC and WORKER_SPEC.loader
sys.modules[WORKER_SPEC.name] = worker
WORKER_SPEC.loader.exec_module(worker)


# 固定したQwenの構造化応答から、部位ごとの出典・姿勢・編集用英文を実処理で組み立てる。
# 顔の原画での認識精度、画像寸法、生成品質はこの局所試験の範囲外。
class FigurePerformanceWorkerTest(unittest.TestCase):
    @staticmethod
    def face(number=1, **parts):
        return {"face_id": f"face_{number:02d}", "confidence": "high", "bbox": [0.1, 0.1, 0.6, 0.8],
                "parts_mapping": parts}

    @staticmethod
    def reading(*faces, target="face_01", evidence=""):
        return {"faces": list(faces), "target_face_id": target, "target_evidence_en": evidence}

    # 見込み: 表情辞書は正本の順序・元のラベル・英語の手掛かりを一度だけ渡す。
    # 合格: プロンプトの辞書行86件と正本のSHA・S070/S071の形が一致し、日本語は入らない。推論は行わない。
    def test_prompt_has_86_english_cues_and_preserves_pose(self):
        import re
        prompt = worker.prompt_text("bust-up")
        self.assertEqual(re.findall(r"^(S\d{3}) C\d{2} [WF] ", prompt, flags=re.M),
                         [f"S{i:03d}" for i in range(1, 87)])
        self.assertEqual(worker.CATALOG["source_sha256"], "6bd93e067410380469bdbad8ef13615a9a52439b44d5e4394823f1c5d43b01b6")
        self.assertNotRegex(prompt, r"[ぁ-んァ-ヶ一-龠]")
        self.assertIn("heart-shaped", worker.ENTRIES["S070"]["visual_description_en"])
        self.assertIn("central pupil", worker.ENTRIES["S071"]["visual_description_en"])
        self.assertIn("Decide framing and posture separately", prompt)
        self.assertIn("never infer proportions", prompt)

    # 見込み: 部位は独立し、口がS050でも感情ラベルを増やさない。番号なしの眉は独自の画像観察となる。
    # 合格: 疎な部位入力から半目と口の英文が各1回、出典とbboxが残る。模擬応答に対する合成を検証する。
    def test_partial_hybrid_does_not_inherit_whole_face_from_mouth(self):
        face = self.face(brows={"id": None, "evidence_en": "slightly lowered inner brows"},
                         eyes={"id": "S010", "evidence_en": "half-lidded eyes"},
                         mouth={"id": "S050", "evidence_en": "a short straight closed mouth"})
        result = worker.normalize_analysis({}, self.reading(face), "face")
        stored = result["expression"]["faces"][0]
        self.assertEqual(stored["bbox"], face["bbox"])
        self.assertIsNone(stored["parts_mapping"]["base_emotion"])
        self.assertEqual(stored["parts_mapping"]["brows"]["source"], "observation")
        self.assertEqual(stored["parts_mapping"]["eyes"]["source"], "catalog")
        self.assertEqual(stored["parts_mapping"]["mouth"]["id"], "S050")
        self.assertFalse(stored["parts_mapping"]["eyes"]["is_symbolic_eye"])
        action = worker.compose_action(result)
        self.assertEqual(action.lower().count("half-lidded eyes"), 1)
        self.assertEqual(action.count("a short straight closed mouth"), 1)
        self.assertNotIn("expressionless", action)
        self.assertNotIn("<image", action)

    # 見込み: 漫符を全体感情にせず、未知のID・他部位のID・日本語を生成に採用しない。
    # 合格: 正当な汗の英文だけが1回残り、座標不正はnull。模擬応答の契約検証に限る。
    def test_only_valid_cues_in_their_slots_reach_the_action(self):
        sweat = {"id": "S043", "evidence_en": "a drop of sweat at the temple"}
        face = self.face(base_emotion=sweat, eyes={"id": "S077", "evidence_en": "round open mouth"},
                         brows={"id": "S999", "evidence_en": "brows"},
                         mouth={"id": None, "evidence_en": "a smile 笑顔"}, extras=[sweat, sweat])
        face["bbox"] = [0, 0.5, 1, 0]
        result = worker.normalize_analysis({}, self.reading(face), "face")
        stored = result["expression"]["faces"][0]
        self.assertIsNone(stored["bbox"])
        for slot in ("base_emotion", "brows", "eyes", "mouth"):
            self.assertIsNone(stored["parts_mapping"][slot])
        self.assertEqual(worker.compose_action(result), "A drop of sweat at the temple.")
        for slot, code in [("brows", "S043"), ("eyes", "S043"), ("mouth", "S020")]:
            with self.subTest(slot=slot, code=code):
                bad_part = {"id": code, "evidence_en": worker.ENTRIES[code]["visual_description_en"]}
                self.assertIsNone(worker.normalized_part(bad_part, slot))

    # 見込み: 記号置換はIDの形で決まり、C08カテゴリ全体では決まらない。
    # 合格: 円記号だけtrue、虹彩内星・ハートや片目閉じはfalse。固定IDの処理のみで原画の識別は後日。
    def test_symbolic_eyes_follow_replacement_not_category(self):
        for code, symbolic in (("S058", False), ("S066", True), ("S070", False), ("S071", False),
                               ("S072", False), ("S073", False), ("S083", False), ("S084", False)):
            with self.subTest(code=code):
                face = self.face(eyes={"id": code, "evidence_en": worker.ENTRIES[code]["visual_description_en"]})
                part = worker.normalized_expression(self.reading(face))["faces"][0]["parts_mapping"]["eyes"]
                self.assertEqual(part["is_symbolic_eye"], symbolic)

    # 見込み: 顔なし・複数顔で対応の根拠なしなら、他人の表情を人物に貼らない。
    # 合格: 顔なしは空、1顔は採用、複数は対応根拠つきの顔だけを採用。模擬応答で保存と本文を検証する。
    def test_no_face_or_ambiguous_target_preserves_the_readings(self):
        empty = worker.normalize_analysis({}, self.reading(), "face")
        self.assertEqual(empty["expression"]["faces"], [])
        self.assertEqual(worker.compose_action(empty), "")
        faces = [self.face(1, mouth={"id": "S077", "evidence_en": "a round open mouth"}),
                 self.face(2, mouth={"id": "S075", "evidence_en": "W-shaped mouth"})]
        single = worker.normalize_analysis({}, self.reading(faces[0], target=None), "face")
        self.assertEqual(single["expression"]["target_face_id"], "face_01")
        self.assertEqual(worker.compose_action(single), "A round open mouth.")
        uncertain = worker.normalize_analysis({}, self.reading(*faces), "face")
        self.assertEqual(len(uncertain["expression"]["faces"]), 2)
        self.assertIsNone(uncertain["expression"]["target_face_id"])
        self.assertEqual(worker.compose_action(uncertain), "")
        selected = worker.normalize_analysis({}, self.reading(*faces, target="face_02",
                                             evidence="The face is attached to the cropped central torso."), "face")
        self.assertEqual(worker.compose_action(selected), "W-shaped mouth.")

    # 見込み: 薄い口角上昇は弱いまま。顔だけの切り抜きに全身や腕の誤読が混ざっても編集本文へ入れない。
    # 合格: 顔・顔詳細とも姿勢/手足/断ち切り/軸推測が消え、弱い笑顔だけ残る。固定応答を使用する。
    def test_face_only_crop_preserves_subtle_smile_without_body(self):
        face = self.face(mouth={"id": "S002", "evidence_en": "barely raised mouth corners"})
        pose = {"framing": "full_body", "edge_truncation": {"cropped_parts": ["leg"], "fully_visible_parts": ["arm"]},
                "canvas_orientation": {"body_axis": "upside_down", "is_upside_down": True},
                "view_direction": {"torso": {"view_angle": "back"}, "head_torso_twist": "clear"},
                "pose": {"base_posture": "standing", "arms": [{"side": "left"}], "legs": [{"side": "right"}],
                         "support_or_contact": "on both feet", "torso_shape": "upright"},
                "pose_draft": "Standing with straight legs."}
        for size in ("face", "face-detail"):
            result = worker.normalize_analysis(pose, self.reading(face), size)
            self.assertEqual(result["framing"]["size"], size)
            for key in ("visible_parts", "occluded_parts", "cut_off_parts"):
                self.assertEqual(result["framing"][key], [])
            self.assertEqual(result["orientation"]["body_axis"], "uncertain")
            self.assertFalse(result["orientation"]["upside_down"])
            self.assertEqual(result["orientation"]["torso"]["view_angle"], "uncertain")
            self.assertEqual(result["pose"]["base"], "uncertain")
            self.assertFalse(any(result["pose"][key] for key in ("arms", "legs", "torso", "draft", "support_or_contact")))
            self.assertEqual(worker.compose_action(result), "Barely raised mouth corners.")

    # 見込み: 胸より上に切れた立ち姿は立位を保つ。見えない脚の補完は取り除く。
    # 合格: 模擬英文からbust-up・standingを保存し、本文に立位があり、脚・膝の句が出ない。
    def test_standing_is_kept_when_the_crop_is_bust_up(self):
        result = worker.normalize_analysis({"framing": "bust_up", "pose": {"base_posture": "standing"},
                                            "pose_draft": "Shoulders tilted. Feet are not visible."}, {}, "bust-up")
        action = worker.compose_action(result)
        self.assertEqual(result["framing"]["size"], "bust-up")
        self.assertIn("Standing", action)
        self.assertIn("Shoulders tilted", action)
        self.assertNotIn("Feet", action)

    # 見込み: 脚が実際に映る英文なら膝立ち・全身を選び、膝までという明示framingは維持する。
    # 合格: 模擬英文の再分類がkneeling/full、既定のlong/shoulder-up/knee-upも保存される。
    def test_visible_knees_can_correct_sitting_to_kneeling_and_full_body(self):
        for size in ("long", "knee-up", "shoulder-up"):
            self.assertIn(size, bridge.FIGURE_PERFORMANCE_SIZES)
            self.assertEqual(worker.normalize_analysis({}, {}, size)["framing"]["size"], size)
        pose = {"framing": "waist_up", "pose": {"base_posture": "sitting", "legs": [{"knee": "bent"}]},
                "pose_draft": "Both knees rest on the ground."}
        result = worker.normalize_analysis(pose, {}, "bust-up")
        self.assertEqual(result["pose"]["base"], "kneeling")
        self.assertEqual(result["framing"]["size"], "full")
        self.assertIn("Kneeling", worker.compose_action(result))
        pose["framing"] = "knee_up"
        self.assertEqual(worker.normalize_analysis(pose, {}, "bust-up")["framing"]["size"], "knee-up")

    # 見込み: JSON本体の前置きは許すが、切れた応答の内部辞書を正常結果にしない。
    # 合格: 応答全文ならposeを取得でき、最後の括弧や必須sectionがなければ明示失敗。推論は行わない。
    def test_extracts_only_complete_performance_objects(self):
        payload = {"framing": "full_body", "pose": {"base_posture": "running"}, "expression": {"faces": []}}
        wrapped = "model loaded\n" + json.dumps(payload) + "\n"
        self.assertEqual(worker.extract_json_object(wrapped), payload)
        for invalid in [json.dumps(payload)[:-1], json.dumps({"pose": {}})]:
            with self.assertRaises(ValueError):
                worker.extract_json_object(invalid)


class FigurePerformanceBridgeTest(unittest.TestCase):
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
            vlm_python=python,
            vlm_model=model,
            vlm_model_label="local-qwen",
        )

    def test_worker_runs_offline_and_deletes_its_temporary_image(self):
        created = []

        class SuccessfulProcess:
            returncode = 0
            stdin = stdout = stderr = None

            def __init__(self, command, **kwargs):
                self.command = command
                self.kwargs = kwargs
                created.append(self)

            def communicate(self, **_kwargs):
                return json.dumps({
                    "ok": True,
                    "result": {
                        "suggested_action": "立っている。",
                        "suggested_size": "bust-up",
                        "analysis": {},
                        "prompt_version": "figure-performance-v1",
                    },
                }), ""

            def poll(self):
                return self.returncode

        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with patch.object(bridge.subprocess, "Popen", SuccessfulProcess):
                result = bridge.run_figure_performance_worker(
                    python=state.vlm_python,
                    model=state.vlm_model,
                    image_bytes=b"image",
                    current_size="bust-up",
                )

        self.assertEqual(result["suggested_action"], "立っている。")
        process = created[0]
        temporary_image = Path(process.command[process.command.index("--image") + 1])
        self.assertFalse(temporary_image.exists())
        self.assertEqual(process.kwargs["env"]["HF_HUB_OFFLINE"], "1")
        self.assertEqual(process.kwargs["env"]["TRANSFORMERS_OFFLINE"], "1")
        self.assertEqual(process.kwargs["env"]["TOKENIZERS_PARALLELISM"], "false")

    def test_analysis_returns_an_editable_action_and_separate_size(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            worker_result = {
                "suggested_action": "立っている。顔は正面向き。",
                "suggested_size": "bust-up",
                "analysis": {"pose": {"base": "standing"}},
                "prompt_version": "figure-performance-v1",
            }
            with patch.object(vision_state, "run_figure_performance_worker", return_value=worker_result):
                result = state.analyze_figure_performance(b"one-figure", "bust-up")

        self.assertEqual(result["action"], "立っている。顔は正面向き。")
        self.assertEqual(result["suggested_size"], "bust-up")
        self.assertEqual(result["analysis"]["pose"]["base"], "standing")
        self.assertEqual(result["analyzer"]["provider"], "local")
        self.assertEqual(result["analyzer"]["model"], "local-qwen")

    def test_requested_vlm_model_resolves_only_a_cached_huggingface_id(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            state = self.make_state(root)
            state.vlm_cache_root = root / "hub"
            model_root = state.vlm_cache_root / "models--owner--small-vlm"
            snapshot = model_root / "snapshots" / "abcdef1"
            snapshot.mkdir(parents=True)
            (model_root / "refs").mkdir()
            (model_root / "refs" / "main").write_text("abcdef1", encoding="utf-8")
            (snapshot / "config.json").write_text("{}", encoding="utf-8")
            (snapshot / "model.safetensors").write_text("weights", encoding="utf-8")
            worker_result = {"suggested_action": "正面を見る。", "suggested_size": "face", "analysis": {}}
            with patch.object(vision_state, "run_figure_performance_worker", return_value=worker_result) as vlm_worker:
                result = state.analyze_figure_performance(b"crop", "face", "owner/small-vlm")
            self.assertEqual(vlm_worker.call_args.kwargs["model"], snapshot)
            self.assertEqual(result["analyzer"]["model"], "owner/small-vlm")
            with self.assertRaisesRegex(ValueError, "Hugging Face"):
                state.analyze_figure_performance(b"crop", "face", "/tmp/model")
            with self.assertRaisesRegex(FileNotFoundError, "ローカルキャッシュ"):
                state.analyze_figure_performance(b"crop", "face", "owner/missing")

    def test_analysis_passes_one_crop_wd_hints_to_qwen(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            tagging = {
                "hints": [{"tag": "smile", "score": 0.8, "text": "the mouth is smiling"}],
                "source": {
                    "provider": "wd-tagger",
                    "model": "SmilingWolf/wd-vit-tagger-v3",
                    "revision": "7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f",
                    "model_sha256": "a" * 64,
                    "tags_sha256": "b" * 64,
                    "verified_pinned_artifacts": True,
                    "threshold": 0.35,
                    "structural_thresholds": {"wide-eyed": 0.1},
                    "expression_only": True,
                },
            }
            worker_result = {
                "suggested_action": "笑っている。",
                "suggested_size": "face",
                "analysis": {"expression": {
                    "tag_hints": tagging["hints"],
                    "hint_source": tagging["source"],
                }},
                "prompt_version": "figure-performance-v2-wd-hints",
            }
            with (
                patch.object(state, "expression_tagging", return_value=tagging),
                patch.object(vision_state, "run_figure_performance_worker", return_value=worker_result) as vlm_worker,
            ):
                result = state.analyze_figure_performance(b"one-person-crop", "face")

        self.assertEqual(vlm_worker.call_args.kwargs["image_bytes"], b"one-person-crop")
        self.assertEqual(vlm_worker.call_args.kwargs["expression_tagging"], tagging)
        self.assertEqual(result["analyzer"]["runtime"], "mlx-vlm")
        self.assertEqual(result["analysis"]["expression"]["tag_hints"], tagging["hints"])
        self.assertEqual(result["analysis"]["expression"]["hint_source"]["model_sha256"], "a" * 64)
        self.assertEqual(result["analysis"]["expression"]["hint_source"]["tags_sha256"], "b" * 64)
        self.assertTrue(result["analysis"]["expression"]["hint_source"]["verified_pinned_artifacts"])

    def test_layout_analysis_never_invokes_the_vlm_worker(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with (
                patch.object(vision_state, "rotated_image_bytes", return_value=b"upright"),
                patch.object(vision_state, "run_local_worker", return_value={"detections": {}}),
                patch.object(vision_state, "detect_panel_boxes", return_value=[]),
                patch.object(vision_state, "detect_panel_shapes", return_value=[]),
                patch.object(vision_state, "run_figure_performance_worker") as vlm_worker,
            ):
                state.analyze(b"analog-page", 0)
            vlm_worker.assert_not_called()

    def test_rejects_an_unknown_current_size_before_model_start(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with self.assertRaisesRegex(ValueError, "描写範囲"):
                state.analyze_figure_performance(b"one-figure", "whole-person")


if __name__ == "__main__":
    unittest.main()
