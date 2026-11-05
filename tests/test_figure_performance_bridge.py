import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


BRIDGE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
BRIDGE_SPEC = importlib.util.spec_from_file_location("nyamuru_figure_performance_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(BRIDGE_SPEC)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
sys.modules[BRIDGE_SPEC.name] = bridge
BRIDGE_SPEC.loader.exec_module(bridge)
import nyamuru_vision_state as vision_state
import vision_character_analysis as character_analysis

WORKER_PATH = Path(__file__).parents[1] / "scripts" / "local_figure_performance_worker.py"
WORKER_SPEC = importlib.util.spec_from_file_location("local_figure_performance_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC and WORKER_SPEC.loader
sys.modules[WORKER_SPEC.name] = worker
WORKER_SPEC.loader.exec_module(worker)


# 固定したQwenの構造化応答から、部位ごとの出典・姿勢・編集用英文を実処理で組み立てる。
# 合成PNGで原寸切り出しと姿勢用の縮小を比較する。実際のネームの認識精度・生成品質は範囲外。
class FigurePerformanceWorkerTest(unittest.TestCase):
    @staticmethod
    def face(number=1, sentence=None, **parts):
        return {"face_id": f"face_{number:02d}", "confidence": "high", "bbox": [0.1, 0.1, 0.6, 0.8],
                "parts_mapping": parts, "qwen_image21_prompt_en": sentence}

    @staticmethod
    def reading(*faces, target="face_01", evidence=""):
        return {"faces": list(faces), "target_face_id": target, "target_evidence_en": evidence}

    # 見込み: 表情辞書は正本の順序・元のラベル・英語の手掛かりを一度だけ渡す。
    # 合格: プロンプトの辞書行86件と正本のSHA・S070/S071の形が一致し、日本語は入らない。推論は行わない。
    def test_prompt_has_86_english_cues_and_preserves_pose(self):
        import re
        prompt = worker.expression_prompt_text()
        pose = worker.pose_prompt_text(True)
        self.assertEqual(re.findall(r"^(S\d{3}) C\d{2} [WF] ", prompt, flags=re.M),
                         [f"S{i:03d}" for i in range(1, 87)])
        self.assertEqual(worker.CATALOG["source_sha256"], "6bd93e067410380469bdbad8ef13615a9a52439b44d5e4394823f1c5d43b01b6")
        self.assertNotRegex(prompt, r"[ぁ-んァ-ヶ一-龠]")
        self.assertIn("heart-shaped", worker.ENTRIES["S070"]["visual_description_en"])
        self.assertIn("central pupil", worker.ENTRIES["S071"]["visual_description_en"])
        for section in ("CRITICAL RULES FOR ROUGH STORYBOARDS", "PART-BY-PART HYBRID MATCHING RULES",
                        "IMPORTANT VISUAL DISTINCTIONS", "SYNTHESIZING qwen_image21_prompt_en", "OUTPUT FORMAT"):
            self.assertIn(section, prompt)
        for field in ("extract_en", "reason", "is_symbolic_eye", "selected_tags", "qwen_image21_prompt_en"):
            self.assertIn(field, prompt)
        self.assertIn("STAR-SHAPED CENTRAL PUPIL INSIDE A ROUND IRIS", prompt)
        self.assertIn("Decide framing and posture separately", pose)
        self.assertIn("never infer proportions", pose)
        self.assertNotIn("S086", pose)

    # 見込み: 部位は独立し、口がS050でも感情ラベルを増やさない。番号なしの眉は独自の画像観察となる。
    # 合格: 疎な部位入力から半目と口の英文が各1回、出典とbboxが残る。模擬応答に対する合成を検証する。
    def test_partial_hybrid_does_not_inherit_whole_face_from_mouth(self):
        sentence = "Apply half-lidded eyes, slightly lowered inner brows and a short straight closed mouth."
        face = self.face(sentence=sentence, brows={"id": None, "extract_en": "slightly lowered inner brows"},
                         eyes={"id": "S010", "extract_en": "half-lidded eyes", "is_symbolic_eye": False},
                         mouth={"id": "S050", "extract_en": "a short straight closed mouth"})
        result = worker.normalize_analysis({}, self.reading(face), "face")
        stored = result["expression"]["faces"][0]
        self.assertEqual(stored["bbox"], face["bbox"])
        self.assertIsNone(stored["parts_mapping"]["base_emotion"])
        self.assertEqual(stored["parts_mapping"]["brows"]["source"], "observation")
        self.assertEqual(stored["parts_mapping"]["eyes"]["source"], "catalog")
        self.assertEqual(stored["parts_mapping"]["mouth"]["id"], "S050")
        self.assertFalse(stored["parts_mapping"]["eyes"]["is_symbolic_eye"])
        action = worker.compose_action(result)
        self.assertEqual(action, sentence)
        self.assertEqual(action.lower().count("half-lidded eyes"), 1)
        self.assertEqual(action.count("a short straight closed mouth"), 1)
        self.assertNotIn("expressionless", action)
        self.assertNotIn("<image", action)

    # 見込み: 漫符を全体感情にせず、未知のID・他部位のID・日本語を生成に採用しない。
    # 合格: 辞書出典不正の部位はIDだけnullにし、汗の観察とQwen文は残る。座標不正はnull。模擬応答に限る。
    def test_only_valid_cues_in_their_slots_reach_the_action(self):
        sweat = {"id": "S043", "extract_en": "a drop of sweat at the temple"}
        face = self.face(sentence="A drop of sweat at the temple.", base_emotion=sweat, eyes={"id": "S077", "extract_en": "round open mouth"},
                         brows={"id": "S999", "extract_en": "brows"},
                         mouth={"id": None, "extract_en": "a smile 笑顔"}, extras=[sweat, sweat])
        face["bbox"] = [0, 0.5, 1, 0]
        result = worker.normalize_analysis({}, self.reading(face), "face")
        stored = result["expression"]["faces"][0]
        self.assertIsNone(stored["bbox"])
        for slot in ("base_emotion", "mouth"):
            self.assertIsNone(stored["parts_mapping"][slot])
        self.assertEqual(worker.compose_action(result), "A drop of sweat at the temple.")
        for slot in ("brows", "eyes"):
            self.assertIsNone(stored["parts_mapping"][slot]["id"])
            self.assertEqual(stored["parts_mapping"][slot]["source"], "observation")
        self.assertEqual(len(stored["parts_mapping"]["extras"]), 1)
        for slot, code in [("brows", "S043"), ("eyes", "S043"), ("mouth", "S020")]:
            with self.subTest(slot=slot, code=code):
                bad_part = {"id": code, "extract_en": worker.ENTRIES[code]["visual_description_en"]}
                self.assertIsNone(worker.normalized_part(bad_part, slot)["id"])

    # 見込み: 記号目の判定はQwenが顔を見て行い、コードがIDから捏造しない。
    # 合格: 固定応答のtrue/falseを保持し、Qwen無回答では既知IDでもnull。原画の識別は後日。
    def test_symbolic_eyes_follow_replacement_not_category(self):
        for code, symbolic in (("S058", False), ("S066", True), ("S070", False), ("S071", False),
                               ("S072", False), ("S073", False), ("S083", False), ("S084", False), ("S066", None), ("S066", False)):
            with self.subTest(code=code):
                face = self.face(eyes={"id": code, "extract_en": worker.ENTRIES[code]["visual_description_en"],
                                      "is_symbolic_eye": symbolic})
                part = worker.normalized_expression(self.reading(face))["faces"][0]["parts_mapping"]["eyes"]
                self.assertEqual(part["is_symbolic_eye"], symbolic)

    # 見込み: 顔なし・複数顔で対応の根拠なしなら、他人の表情を人物に貼らない。
    # 合格: 顔なしは空、1顔は採用、複数は対応根拠つきの顔だけを採用。模擬応答で保存と本文を検証する。
    def test_no_face_or_ambiguous_target_preserves_the_readings(self):
        empty = worker.normalize_analysis({}, self.reading(), "face")
        self.assertEqual(empty["expression"]["faces"], [])
        self.assertEqual(worker.compose_action(empty), "")
        faces = [self.face(1, sentence="A round open mouth.", mouth={"id": "S077", "extract_en": "a round open mouth"}),
                 self.face(2, sentence="W-shaped mouth.", mouth={"id": "S075", "extract_en": "W-shaped mouth"})]
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
        face = self.face(sentence="Barely raised mouth corners.", mouth={"id": "S002", "extract_en": "barely raised mouth corners"})
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

    # 見込み: 検出顔なしなら人物画像で対象顔の位置を確認し、元画素の顔だけをQwenに渡す。
    # 合格: 1280pxの姿勢画像と1600pxの顔を区別し全画素が一致、顔専用辞書は後者だけ・1ロード。位置と生成は模擬。
    def test_face_located_in_pose_is_cropped_from_original_pixels(self):
        from PIL import Image
        bbox = [0.25, 0, 0.75, 1]
        pose = {"framing": "bust_up", "pose": {}, "subject_face_status": "located",
                "subject_face": {"bbox": bbox, "reason": "The face joins the central neck."}}
        sentence = "Keep the mouth level."
        face = self.face(sentence=sentence, mouth={"id": "S050", "extract_en": "a short straight closed mouth"})
        calls, paths = [], []
        def generate(_model, _processor, prompt, *, image, **_kw):
            with Image.open(image) as received:
                calls.append((prompt, received.size, received.convert("RGB").tobytes()))
            paths.append(Path(image))
            return SimpleNamespace(text=json.dumps(pose if len(calls) == 1 else {"faces": [face]}))
        load = Mock(return_value=(SimpleNamespace(config={}), object()))
        modules = {
            "mlx_vlm": SimpleNamespace(load=load, generate=generate),
            "mlx_vlm.prompt_utils": SimpleNamespace(apply_chat_template=lambda _p, _c, prompt, *, num_images: prompt),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").touch()
            original = root / "source.png"
            with Image.new("RGBA", (3200, 120), (0, 0, 0, 0)) as drawing:
                for x in range(800, 2400, 3):
                    drawing.putpixel((x, x % 120), (11, 23, 51, 255))
                # Black transparent pixels must become white; the opaque colored
                # line retains its RGB, independent of the hidden black background.
                expected = Image.new("RGB", (1600, 120), "white")
                for x in range(800, 2400, 3):
                    expected.putpixel((x-800, x % 120), (11, 23, 51))
                expected = expected.tobytes()
                drawing.save(original)
            with patch.dict(sys.modules, modules):
                result = worker.analyze(root, original, "bust-up", 2400)
            self.assertTrue(original.exists())
            self.assertFalse(any(p.exists() for p in paths))
        self.assertEqual([c[1] for c in calls], [(1280, 48), (1600, 120)])
        self.assertEqual(calls[1][2], expected)
        self.assertNotIn("S086", calls[0][0])
        self.assertIn("S086 C10", calls[1][0])
        self.assertEqual(result["analysis"]["expression"]["faces"][0]["bbox"], bbox)
        self.assertEqual(result["analysis"]["expression"]["target_evidence_en"], "The face joins the central neck")
        self.assertEqual(result["suggested_action"], sentence)
        load.assert_called_once()

    # 人物に顔がない場合と所属が不明な場合は辞書へ渡さない。固定の位置判定で呼出し1回、状態・姿勢を確認。
    def test_no_or_unassociated_face_never_sends_full_figure_to_expression(self):
        for flag, status in [("no_face", "no_face"), ("ambiguous", "ambiguous"), ("located", "unreadable")]:
            with self.subTest(flag=flag), patch.object(worker, "infer_object", return_value={
                "framing": "full_body", "pose": {"base_posture": "running"}, "subject_face_status": flag,
                "subject_face": {"bbox": [0.2, 0.1, 0.5, 0.4], "reason": ""}}) as infer:
                analysis = worker.read_performance(None, None, Path("figure"), Path("prepared"), "full", 2400, {}, None, None)
                self.assertEqual(infer.call_count, 1)
                self.assertEqual(analysis["expression"]["read_status"], status)
                self.assertEqual(analysis["expression"]["faces"], [])
                self.assertEqual(worker.compose_action(analysis), "Running.")

    # 顔が検出されたのに読めない場合は向きだけで成功にしない。顔回答の欠落や不正を模擬し、要確認と姿勢保持を見る。
    def test_unreadable_known_face_is_not_recorded_as_no_face(self):
        for records in ([], [None], [self.face(mouth={"id": "S050", "extract_en": "straight mouth"})]):
            from contextlib import nullcontext
            with self.subTest(records=records), patch.object(worker, "face_target_image", return_value=nullcontext(Path("face"))), patch.object(worker, "infer_object", side_effect=[
                {"framing": "full_body", "pose": {"base_posture": "running"}}, {"faces": records},
            ]) as infer:
                analysis = worker.read_performance(None, None, Path("face"), Path("prepared"), "full", 2400, {}, None, [0,0,1,1])
                self.assertEqual(infer.call_args.args[3], Path("face"))
                self.assertEqual(analysis["expression"]["read_status"], "unreadable")
                self.assertEqual(worker.compose_action(analysis), "Running.")

    # 不一致は辞書IDの出典に限定する。模擬Qwenで理由欠落・誤ラベル・片方の部位の不正を与え、正しい部位と英文が残る。
    def test_bad_citation_and_sparse_optional_fields_do_not_erase_model_sentence(self):
        sentence = "Give the face a reluctant smile."
        face = self.face(sentence=sentence, brows={"id": "S002", "prompt": "wrong label", "extract_en": "level brows"},
                         eyes="malformed", mouth={"id": "S002", "extract_en": "both mouth corners rise"})
        face["face_id"] = "face_1"
        result = worker.normalized_expression(self.reading(face, target="face_1"))
        self.assertEqual((result["target_face_id"], result["read_status"]), ("face_01", "read"))
        self.assertEqual(result["faces"][0]["qwen_image21_prompt_en"], sentence)
        parts = result["faces"][0]["parts_mapping"]
        self.assertEqual((parts["brows"]["id"], parts["brows"]["evidence_en"]), (None, "level brows"))
        self.assertEqual((parts["eyes"], parts["mouth"]["id"]), (None, "S002"))

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
            with patch.object(character_analysis, "run_figure_performance_worker", return_value=worker_result):
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
            with patch.object(character_analysis, "run_figure_performance_worker", return_value=worker_result) as vlm_worker:
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
                patch.object(character_analysis, "run_figure_performance_worker", return_value=worker_result) as vlm_worker,
            ):
                result = state.analyze_figure_performance(b"one-person-crop", "face", face_bbox=[0, 0, 1, 1])

        self.assertEqual(vlm_worker.call_args.kwargs["image_bytes"], b"one-person-crop")
        self.assertEqual(vlm_worker.call_args.kwargs["expression_tagging"], tagging)
        self.assertEqual(result["analyzer"]["runtime"], "mlx-vlm")
        self.assertEqual(result["analysis"]["expression"]["tag_hints"], tagging["hints"])
        self.assertEqual(result["analysis"]["expression"]["hint_source"]["model_sha256"], "a" * 64)
        self.assertEqual(result["analysis"]["expression"]["hint_source"]["tags_sha256"], "b" * 64)
        self.assertTrue(result["analysis"]["expression"]["hint_source"]["verified_pinned_artifacts"])

    # 検出器が枠を見つけなくても、レイアウト解析は人物用VLMを起動しない。
    # 検出結果は模擬し、解析が空のコマ一覧を返し、人物解析workerの呼び出しが0回なら合格。
    def test_layout_analysis_never_invokes_the_vlm_worker(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with (
                patch.object(vision_state, "rotated_image_bytes", return_value=b"upright"),
                patch.object(vision_state, "run_local_worker", return_value={"detections": {}}),
                patch.object(vision_state, "detect_panel_boxes", return_value=[]),
                patch.object(character_analysis, "run_figure_performance_worker") as vlm_worker,
            ):
                result = state.analyze(b"analog-page", 0)
            self.assertEqual(result["panels"], [])
            vlm_worker.assert_not_called()

    def test_rejects_an_unknown_current_size_before_model_start(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with self.assertRaisesRegex(ValueError, "描写範囲"):
                state.analyze_figure_performance(b"one-figure", "whole-person")


if __name__ == "__main__":
    unittest.main()
