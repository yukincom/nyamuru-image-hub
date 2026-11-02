# 自動読み取りだけ英語にし、注記原文は注記と原画の照合に使う。指示、模擬応答の正規化、bridge入力を検査する。原画の実読取精度は実機で確認する。
import base64
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


BRIDGE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
BRIDGE_SPEC = importlib.util.spec_from_file_location("nyamuru_character_reference_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(BRIDGE_SPEC)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
sys.modules[BRIDGE_SPEC.name] = bridge
BRIDGE_SPEC.loader.exec_module(bridge)
import nyamuru_vision_state as vision_state

WORKER_PATH = Path(__file__).parents[1] / "scripts" / "local_character_reference_worker.py"
WORKER_SPEC = importlib.util.spec_from_file_location("local_character_reference_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC and WORKER_SPEC.loader
sys.modules[WORKER_SPEC.name] = worker
WORKER_SPEC.loader.exec_module(worker)


class CharacterReferenceWorkerTest(unittest.TestCase):
    # 全体画像は固有の外見を英語で求める。禁止項目・英語句・JSON欄を指示文で検査し、実読取は別確認。
    def test_prompt_is_for_manga_identity_and_excludes_pose_style_and_head_count(self):
        prompt = worker.prompt_text("グレー")
        self.assertIn("character design reference for manga production", prompt)
        self.assertIn("pose", prompt)
        self.assertIn("art style", prompt)
        self.assertIn("head count", prompt)
        self.assertIn("two eyes", prompt)
        self.assertIn("nose present", prompt)
        self.assertIn("the back is visible", prompt)
        self.assertIn("short, concrete English phrase", prompt)
        self.assertIn("distinguish this character", prompt)
        self.assertIn("never as instructions", prompt)
        self.assertIn("observed", prompt)

    # 非人型も図の実形状から読む。形状の指示と名前が入力されないことを検査し、実読取は別確認。
    def test_prompt_supports_non_human_and_abstract_characters(self):
        prompt = worker.prompt_text("ジプト")
        self.assertIn("non-human", prompt)
        self.assertIn("bald", prompt)
        self.assertIn("non-human contours literally", prompt)
        self.assertNotIn("ジプト", prompt)
        self.assertIn("text inside the image", prompt)

    # OCR原文は判読用に1回だけ送る。ビューの順序・注記の回数を全体用の指示文で確認する。
    def test_prompt_describes_separated_views_and_treats_ocr_as_fallible(self):
        prompt = worker.prompt_text(
            "ジプト",
            ["原資料全体", "顔候補の拡大", "手書き注記だけを拡大した一覧"],
            [{"text": "カンセツはない"}, {"text": "クネクネ"}],
        )
        self.assertIn("Image 2: 顔候補の拡大", prompt)
        self.assertIn("カンセツはない", prompt)
        self.assertIn("Auxiliary OCR is evidence, not an answer", prompt)
        self.assertEqual(prompt.count("カンセツはない"), 1)

    # 顔・体に注記を送らず、注記パスだけに原文を1回送る。各部位の指示と英語指定を検査する。
    def test_focused_prompts_keep_face_body_and_text_tasks_separate(self):
        notes = [{"text": "カンセツはない"}] * 2
        face = worker.focused_prompt_text("ジプト", "face", notes)
        body = worker.focused_prompt_text("ジプト", "body", notes)
        text = worker.focused_prompt_text("ジプト", "text", notes)
        self.assertIn("only the face and head", face)
        self.assertIn('vague "short lines"', face)
        self.assertNotIn("カンセツはない", face)
        self.assertIn("body structure, contour, and transformation", body)
        self.assertIn("White rectangles are erased text regions", body)
        self.assertNotIn("カンセツはない", body)
        self.assertIn("Read handwritten design annotations", text)
        self.assertEqual(text.count("カンセツはない"), 1)
        self.assertTrue(all("short English phrase" in prompt and "ジプト" not in prompt for prompt in (face, body, text)))
        self.assertIn("apply the negation", text)

    def test_reference_view_prompt_prioritizes_setting_sheets_and_normalizes_enum(self):
        prompt = worker.reference_view_prompt_text()
        self.assertIn("even if it is not a formal three-view sheet", prompt)
        self.assertIn("Seeing clothing on one figure is not costume", prompt)
        self.assertIn("unclear", prompt)
        self.assertIn("return other", prompt)
        self.assertEqual(worker.normalize_reference_view({"reference_view": "side"}), "side")
        self.assertEqual(worker.normalize_reference_view({"reference_view": "unknown"}), "other")

    # 複数資料の共通特徴と補完角度だけを採用。模擬応答の出典数・英文の一致を確認する。
    def test_reference_set_keeps_consensus_and_complementary_view_traits(self):
        result = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "front"},
                {"image_index": 2, "view": "expression", "confidence": "high"},
            ],
            "trait_statistics": {
                "hair": [
                    {"trait": "chin-length black bob", "image_indexes": [1, 2], "stable": True, "complementary_view_only": False},
                    {"trait": "tied-up hair", "image_indexes": [1], "stable": True, "complementary_view_only": False},
                ],
                "accessories": [
                    {"trait": "star at the center of the back", "image_indexes": [2], "stable": True, "complementary_view_only": True},
                ],
            },
        }, 2)
        self.assertEqual(result["reference_views"], ["front", "expression"])
        self.assertEqual(result["reference_view_confidences"], ["low", "high"])
        self.assertEqual(result["recognition"]["hair"]["observed"], ["chin-length black bob"])
        self.assertEqual(result["recognition"]["accessories"]["observed"], ["star at the center of the back"])
        self.assertEqual(result["trait_statistics"]["hair"][0]["image_count"], 2)

    # 顔は顔、体は体のクロップだけを比較し、名前を送らず英語を求める。比較指示を検査する。
    def test_reference_set_prompts_compare_face_and_body_separately_without_text(self):
        face = worker.reference_face_pair_prompt_text("グレー", False)
        body = worker.reference_body_pair_prompt_text("グレー", False)
        face_traits = worker.reference_face_traits_prompt_text("グレー", 3)
        body_traits = worker.reference_body_traits_prompt_text("グレー", 3)

        self.assertIn("Compare face only with face", face)
        self.assertIn("Do not reason about body, clothes", face)
        self.assertIn("representative baseline", face)
        self.assertIn("Compare body only with body", body)
        self.assertIn("Face regions and source text have been removed", body)
        self.assertIn("never use facial expression, written annotations", body)
        self.assertNotIn("OCR candidates", face)
        self.assertNotIn("OCR candidates", body)
        self.assertIn("Compare face only with face", face_traits)
        self.assertIn("Compare body only with body", body_traits)
        self.assertIn("Ignore any residual letters completely", face_traits)
        self.assertIn("Ignore any residual letters completely", body_traits)
        self.assertTrue(all("short concrete English phrase" in prompt for prompt in (face_traits, body_traits)))
        self.assertTrue(all("グレー" not in prompt for prompt in (face, body, face_traits, body_traits)))

    # 有効な2枚の元番号へ戻す。模擬英文の根拠が元1・4枚目になることを確認する。
    def test_reference_trait_indexes_are_remapped_to_original_sources(self):
        remapped = worker.remap_reference_trait_indexes({
            "trait_statistics": {
                "face": [{
                    "trait": "long outward lashes",
                    "image_indexes": [1, 2, 9],
                    "stable": True,
                }],
            },
        }, [0, 3])
        normalized = worker.normalize_reference_set_analysis(remapped, 4)

        self.assertEqual(normalized["trait_statistics"]["face"][0]["image_indexes"], [1, 4])

    def test_smile_reference_is_expression_even_when_the_smile_is_slight(self):
        prompt = worker.reference_face_pair_prompt_text("グレー", False)

        self.assertIn("slight closed-mouth smile", prompt)
        self.assertIn("Classify its reference purpose as expression", prompt)

    # 顔と体で同じカテゴリが混在しても担当分だけ残す。模擬英文とビュー分類を照合する。
    def test_reference_set_merge_keeps_face_and_body_traits_in_their_own_fields(self):
        face = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "expression", "confidence": "high"},
                {"image_index": 2, "view": "other", "confidence": "low"},
            ],
            "trait_statistics": {
                "face": [{"trait": "long outward lashes", "image_indexes": [1, 2], "stable": True}],
                "silhouette": [{"trait": "spurious face pass trait", "image_indexes": [1, 2], "stable": True}],
            },
        }, 2)
        body = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "front", "confidence": "high"},
                {"image_index": 2, "view": "back", "confidence": "high"},
            ],
            "trait_statistics": {
                "face": [{"trait": "spurious body pass trait", "image_indexes": [1, 2], "stable": True}],
                "silhouette": [{"trait": "one-piece flared outline", "image_indexes": [1, 2], "stable": True}],
            },
        }, 2)

        result = worker._merge_reference_set_passes(face, body, 2)

        self.assertEqual(result["reference_views"], ["expression", "back"])
        self.assertEqual(result["recognition"]["face"]["observed"], ["long outward lashes"])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["one-piece flared outline"])

    # 2画像の共通形状だけが候補になり、欠測の分類は保留。模擬応答で出典番号と内容を確認する。
    def test_pair_results_are_complete_per_image_and_require_shared_traits(self):
        first = worker.normalize_reference_pair_analysis({
            "candidate_view": "front",
            "confidence": "high",
            "shared_traits": {"face": ["long outward lashes"]},
        }, {"front", "expression", "other"}, ("hair", "face", "accessories"))
        second = worker.normalize_reference_pair_analysis({
            "candidate_view": "expression",
            "confidence": "high",
            "shared_traits": {"face": ["long outward lashes"]},
        }, {"front", "expression", "other"}, ("hair", "face", "accessories"))

        result = worker.reference_focus_from_pairs([first, second, None], 0, ("hair", "face", "accessories"))

        self.assertEqual(result["reference_views"], ["front", "expression", "other"])
        self.assertEqual(result["reference_view_confidences"], ["high", "high", "low"])
        self.assertEqual(result["recognition"]["face"]["observed"], ["long outward lashes"])
        self.assertEqual(result["trait_statistics"]["face"][0]["image_indexes"], [1, 2])

    # 顔と体の出力欄を限定。無関係な欄の模擬英文を除外し、観察された英文だけが残ることを確認する。
    def test_merge_focused_analyses_accepts_only_each_pass_fields(self):
        merged = worker.merge_focused_analyses([
            ({"recognition": {
                "face": {"observed": ["long upper and lower lashes"], "inferred": []},
                "silhouette": {"observed": ["spurious face pass trait"], "inferred": []},
            }}, ("hair", "face", "accessories")),
            ({"recognition": {
                "face": {"observed": ["spurious body pass trait"], "inferred": []},
                "silhouette": {"observed": ["elongated jointless contour"], "inferred": []},
            }}, ("silhouette", "outfit", "accessories")),
        ])
        self.assertEqual(merged["recognition"]["face"]["observed"], ["long upper and lower lashes"])
        self.assertEqual(merged["recognition"]["silhouette"]["observed"], ["elongated jointless contour"])

    # 見込み: 単数setの注記原文は拡大画像と全体画像の照合でだけ使う。合格: 模擬VLMが返した英文だけ保存、誤読した関節なしは採用しない。画像内容は未評価。
    def test_single_set_checks_annotations_before_saving_english_traits(self):
        note = "まゆげ員ロナシ・カンセツはない"
        auxiliary = {"ocr_lines": [{"text": note, "bbox": [0.5, 0.25, 0.25, 0.25]}]}
        prompts = []

        def generate(_model, _processor, prompt, *, image, **_sampling):
            prompts.append((prompt, list(image)))
            result = ({"recognition": {"face": {"observed": ["no eyebrows, nose or mouth"]}}}
                      if note in prompt else {"reference_view": "turnaround"})
            return SimpleNamespace(text=json.dumps(result))

        vlm = SimpleNamespace(load=Mock(return_value=(SimpleNamespace(config={}), object())), generate=generate)
        template = SimpleNamespace(apply_chat_template=lambda _processor, _config, prompt, num_images: prompt)
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            (root / "config.json").touch()
            overall, face, text = (root / name for name in ("overall.jpg", "face.jpg", "text.jpg"))
            args = SimpleNamespace(model=root, image=[root / "source.png"], max_tokens=900)
            args.image[0].touch()
            output = io.StringIO()
            with (
                patch.dict(sys.modules, {"mlx_vlm": vlm, "mlx_vlm.prompt_utils": template}),
                patch.object(worker, "prepare_reference_images", return_value=(
                    [overall, face, text], 100, 100, ["原資料全体", "顔候補", "手書き注記"]
                )) as prepare,
                patch.object(worker, "parse_args", return_value=args),
                patch.object(sys, "stdin", io.StringIO(json.dumps({"set_analysis": True, "auxiliaries": [auxiliary]}))),
                patch.object(sys, "stdout", output),
            ):
                self.assertEqual(worker.main(), 0)
            self.assertEqual(prepare.call_args.args[1]["ocr_lines"][0]["text"], note)
        self.assertEqual([(p.count(note), images) for p, images in prompts], [
            (0, [str(overall)]), (0, [str(face)]), (1, [str(text), str(overall)]),
        ])
        result = json.loads(output.getvalue())["result"]
        self.assertEqual(result["recognition"]["face"]["observed"], ["no eyebrows, nose or mouth"])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [])

    # 見込み: 注記と顔・体の観察に同じ特徴があっても1件でよい。合格: 模擬応答の瞳の不揃いと可変輪郭は各1件。実画像からの判断は別確認。
    def test_merge_deduplicates_same_traits_across_visual_and_annotation_passes(self):
        passes = [
            {"face": {"observed": ["misaligned pupils"]},
             "silhouette": {"observed": ["body bends and stretches"]}},
            {"face": {"observed": ["pupils point in different directions"]},
             "silhouette": {"observed": ["body curves and stretches into a loop"]}},
        ]
        result = worker.merge_focused_analyses([(value, ("face", "silhouette")) for value in passes])
        self.assertEqual(result["recognition"]["face"]["observed"], ["misaligned pupils"])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["body bends and stretches"])

    # 英語観察だけを1回残し、推測や日英の重複表現は除く。模擬応答のobservedとinferredを確認する。
    def test_normalization_keeps_observed_and_discards_inferred(self):
        result = worker.normalize_analysis({
            "recognition": {
                "hair": {"observed": ["short bob", "short bob", "短いボブ", "short bob（短いボブ）"], "inferred": ["possibly rounded back of head"]},
                "face": {"observed": ["elongated eyes"]},
                "outfit": "invalid",
            }
        })
        self.assertEqual(result["recognition"]["hair"]["observed"], ["short bob"])
        self.assertEqual(result["recognition"]["hair"]["inferred"], [])
        self.assertEqual(result["recognition"]["outfit"], {"observed": [], "inferred": []})

    # 性別・姿勢・表情・画風は恒常的外見にしない。模擬応答から形状だけが残ることを確認する。
    def test_normalization_removes_identity_pose_expression_and_style_leakage(self):
        result = worker.normalize_analysis({
            "recognition": {
                "silhouette": {
                    "observed": [
                        "rounded female body silhouette",
                        "a young woman",
                        "sitting with raised hands",
                    ],
                    "inferred": ["slightly broad shoulders"],
                },
                "face": {"observed": ["slightly larger eyes", "smiling with closed eyes"]},
                "hair": {"observed": ["short bob", "rough art style"]},
            }
        })
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["rounded body silhouette"])
        self.assertEqual(result["recognition"]["silhouette"]["inferred"], [])
        self.assertEqual(result["recognition"]["face"]["observed"], ["slightly larger eyes"])
        self.assertEqual(result["recognition"]["hair"]["observed"], ["short bob"])

    # 一般的な器官の存在は除き、眼形や襟の構造は保持。模擬英文の各欄の配列を確認する。
    def test_normalization_removes_generic_anatomy_but_keeps_distinctive_eye_shape(self):
        result = worker.normalize_analysis({
            "recognition": {
                "face": {
                    "observed": [
                        "eyes",
                        "eyebrows",
                        "mouth",
                        "two eyes",
                        "has two eyes",
                        "one nose",
                        "both eyes are visible",
                        "eyes present",
                        "large upward-slanting eyes",
                    ],
                    "inferred": [],
                },
                "silhouette": {"observed": ["two arms", "shoulder width", "body shape", "slightly broad shoulders"], "inferred": []},
                "outfit": {"observed": ["back is visible", "black long sleeves with a high collar"], "inferred": []},
            }
        })
        self.assertEqual(result["recognition"]["face"]["observed"], ["large upward-slanting eyes"])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["slightly broad shoulders"])
        self.assertEqual(result["recognition"]["outfit"]["observed"], ["black long sleeves with a high collar"])

    # 非人型の比喩は除き、明確な器官の欠如や輪郭は保持。模擬英文の項目を比較する。
    def test_normalization_removes_vague_metaphors_but_keeps_non_human_structure(self):
        result = worker.normalize_analysis({
            "recognition": {
                "face": {
                    "observed": [
                        "eyelashes",
                        "large eyes high on the head with long lashes",
                        "no eyebrows, nose or mouth",
                    ],
                    "inferred": [],
                },
                "silhouette": {
                    "observed": [
                        "ghost",
                        "sheet-like figure",
                        "elongated shape without limbs or joints",
                        "bell-shaped base flaring sideways",
                        "torso curves into a loop",
                    ],
                    "inferred": [],
                },
            }
        })
        self.assertEqual(result["recognition"]["face"]["observed"], [
            "large eyes high on the head with long lashes",
            "no eyebrows, nose or mouth",
        ])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [
            "elongated shape without limbs or joints",
            "bell-shaped base flaring sideways",
            "torso curves into a loop",
        ])

    def test_extracts_json_after_model_chatter(self):
        raw = "loaded\n```json\n" + json.dumps({"recognition": {"hair": {}}}) + "\n```"
        self.assertIn("recognition", worker.extract_json_object(raw))

    def test_prepares_overall_body_face_and_text_views(self):
        try:
            from PIL import Image, ImageDraw
        except ModuleNotFoundError:
            self.skipTest("Pillow is available in the local vision runtime")

        with tempfile.TemporaryDirectory() as directory_name:
            source = Path(directory_name) / "reference.png"
            image = Image.new("RGB", (400, 300), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((80, 40, 240, 280), outline="black", width=4)
            draw.text((270, 80), "note", fill="black")
            image.save(source)
            auxiliary = worker.normalized_auxiliary({
                "regions": {
                    "bodies": [{"bbox": [0.2, 0.13, 0.4, 0.8]}],
                    "faces": [{"bbox": [0.25, 0.16, 0.2, 0.2]}],
                    "texts": [{"bbox": [0.66, 0.2, 0.25, 0.3]}],
                },
                "ocr_lines": [{"text": "注記", "bbox": [0.66, 0.2, 0.25, 0.3]}],
            })
            with patch.object(worker, "_dominant_ink_box", return_value=(70, 30, 250, 290)):
                paths, width, height, labels = worker.prepare_reference_images(source, auxiliary)
            try:
                self.assertEqual((width, height), (400, 300))
                self.assertEqual(len(paths), 4)
                self.assertTrue(all(path.is_file() for path in paths))
                self.assertIn("体・輪郭・変形例", labels[1])
                self.assertIn("顔候補", labels[2])
                self.assertIn("手書き注記", labels[3])
            finally:
                for path in paths:
                    path.unlink(missing_ok=True)


class CharacterReferenceBridgeTest(unittest.TestCase):
    def make_state(self, root: Path) -> bridge.LocalVisionState:
        python = root / "python"
        python.write_text("", encoding="utf-8")
        detector = root / "detector.onnx"
        detector.write_text("", encoding="utf-8")
        baberu = root / "baberu"
        (baberu / "onnx").mkdir(parents=True)
        (baberu / "tokenizer").mkdir()
        for path in (
            baberu / "onnx_infer.py",
            baberu / "onnx" / "vision_int4.onnx",
            baberu / "onnx" / "decoder_prefill_int8.onnx",
            baberu / "onnx" / "decoder_step_int8.onnx",
            baberu / "tokenizer" / "vocab.json",
        ):
            path.write_text("", encoding="utf-8")
        model = root / "model"
        model.mkdir()
        (model / "config.json").write_text("{}", encoding="utf-8")
        (model / "model.safetensors").write_text("", encoding="utf-8")
        return bridge.LocalVisionState(
            root,
            python,
            detector,
            baberu,
            series_root=root / "series",
            image_hub_root=root / "images",
            vlm_python=python,
            vlm_model=model,
            vlm_model_label="local-qwen",
        )

    def test_worker_uses_shared_offline_runner_and_deletes_temporary_image(self):
        created = []

        class SuccessfulProcess:
            returncode = 0
            stdin = stdout = stderr = None

            def __init__(self, command, **kwargs):
                self.command = command
                self.kwargs = kwargs
                created.append(self)

            def communicate(self, input=None, timeout=None):
                self.input = input
                self.timeout = timeout
                return json.dumps({
                    "ok": True,
                    "result": {
                        "recognition": {"hair": {"observed": ["短いボブ"], "inferred": []}},
                        "prompt_version": "character-reference-v1",
                    },
                }), ""

            def terminate(self):
                return None

            def kill(self):
                return None

            def wait(self, timeout=None):
                return 0

            def poll(self):
                return self.returncode

        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with patch.object(bridge.subprocess, "Popen", SuccessfulProcess):
                result = bridge.run_character_reference_worker(
                    python=state.vlm_python,
                    model=state.vlm_model,
                    image_bytes=b"image",
                    target_character="グレー",
                    auxiliary={"ocr_lines": [{"text": "黒い帯"}]},
                )

        self.assertEqual(result["prompt_version"], "character-reference-v1")
        process = created[0]
        temporary_image = Path(process.command[process.command.index("--image") + 1])
        self.assertFalse(temporary_image.exists())
        self.assertEqual(process.kwargs["env"]["HF_HUB_OFFLINE"], "1")
        self.assertEqual(process.kwargs["env"]["TRANSFORMERS_OFFLINE"], "1")
        self.assertEqual(json.loads(process.input)["target_character"], "グレー")
        self.assertEqual(json.loads(process.input)["auxiliary"]["ocr_lines"][0]["text"], "黒い帯")

    def test_set_worker_passes_all_images_to_one_offline_process(self):
        created = []

        class SuccessfulProcess:
            returncode = 0
            stdin = stdout = stderr = None

            def __init__(self, command, **kwargs):
                self.command = command
                self.kwargs = kwargs
                created.append(self)

            def communicate(self, input=None, timeout=None):
                self.input = input
                return json.dumps({"ok": True, "result": {
                    "recognition": {},
                    "reference_views": ["front", "side"],
                    "reference_view_confidences": ["high", "high"],
                    "prompt_version": "character-reference-v17",
                }}), ""

            def terminate(self):
                return None

            def kill(self):
                return None

            def wait(self, timeout=None):
                return 0

            def poll(self):
                return self.returncode

        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with patch.object(bridge.subprocess, "Popen", SuccessfulProcess):
                bridge.run_character_reference_set_worker(
                    python=state.vlm_python,
                    model=state.vlm_model,
                    image_bytes=[b"first", b"second"],
                    target_character="グレー",
                    auxiliaries=[{}, {}],
                )

        process = created[0]
        self.assertEqual(process.command.count("--image"), 2)
        image_paths = [Path(process.command[index + 1]) for index, value in enumerate(process.command) if value == "--image"]
        self.assertTrue(all(not path.exists() for path in image_paths))
        self.assertTrue(json.loads(process.input)["set_analysis"])

    def test_analysis_returns_candidate_with_local_analyzer(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            detection = {
                "page": {"width": 1000, "height": 800},
                "detections": {
                    "faces": [{"id": "face0", "score": 0.8, "bbox": [100, 80, 300, 280]}],
                    "bodies": [{"id": "body0", "score": 0.7, "bbox": [80, 60, 500, 760]}],
                    "texts": [{"id": "text0", "score": 0.1, "bbox": [600, 100, 900, 220]}],
                },
            }
            ocr = {
                "width": 1000,
                "height": 800,
                "region_lines": [{
                    "id": "text0",
                    "text": "関節はない",
                    "bbox": [600, 100, 300, 120],
                    "confidence": 0.1,
                    "vertical": False,
                }],
            }
            worker_result = {
                "recognition": {"hair": {"observed": ["短いボブ"], "inferred": []}},
                "reference_view": "turnaround",
                "prompt_version": "character-reference-v1",
            }
            with (
                patch.object(vision_state, "run_local_worker", side_effect=[detection, ocr]) as local_worker,
                patch.object(vision_state, "run_character_reference_worker", return_value=worker_result) as reference_worker,
            ):
                result = state.analyze_character_reference(b"reference", "グレー")

        self.assertEqual(result["recognition"]["hair"]["observed"], ["短いボブ"])
        self.assertEqual(result["reference_view"], "turnaround")
        self.assertEqual(result["analyzer"]["provider"], "local")
        self.assertEqual(result["analyzer"]["model"], "local-qwen")
        self.assertEqual(local_worker.call_count, 2)
        auxiliary = reference_worker.call_args.kwargs["auxiliary"]
        self.assertEqual(auxiliary["ocr_lines"][0]["text"], "関節はない")
        self.assertEqual(auxiliary["regions"]["faces"][0]["bbox"], (0.1, 0.1, 0.2, 0.25))

    def test_set_analysis_uses_saved_images_and_returns_per_image_views(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            worker_result = {
                "recognition": {"hair": {"observed": ["顎までの黒いボブ"], "inferred": []}},
                "reference_views": ["front", "expression"],
                "reference_view_confidences": ["high", "high"],
                "trait_statistics": {"hair": [{"trait": "顎までの黒いボブ", "image_count": 2}]},
                "prompt_version": "character-reference-v17",
            }
            with (
                patch.object(state.series_catalogs, "read_character_image", side_effect=lambda *_: {"found": True, "image_bytes": b"image"}),
                patch.object(state, "character_reference_auxiliary", return_value={}) as auxiliary_worker,
                patch.object(vision_state, "run_character_reference_set_worker", return_value=worker_result) as set_worker,
            ):
                result = state.analyze_character_reference_set(
                    "series-one",
                    "character-one",
                    [f"image-{'a' * 64}", f"image-{'b' * 64}"],
                    "グレー",
                )

        self.assertEqual(result["recognition"]["hair"]["observed"], ["顎までの黒いボブ"])
        self.assertEqual(result["reference_views"], [
            {"asset_id": f"image-{'a' * 64}", "view": "front", "confidence": "high"},
            {"asset_id": f"image-{'b' * 64}", "view": "expression", "confidence": "high"},
        ])
        self.assertEqual(set_worker.call_args.kwargs["target_character"], "グレー")
        self.assertEqual(set_worker.call_args.kwargs["auxiliaries"], [{}, {}])
        self.assertEqual(
            [call.kwargs for call in auxiliary_worker.call_args_list],
            [{"include_ocr": False}, {"include_ocr": False}],
        )

    # 見込み: 1枚setでは注記原文と本人の画像をworkerに渡す。合格: mockのOCR有効・送信引数が一致し、ID不一致は拒否。検出精度は別確認。
    def test_set_analysis_accepts_client_images_without_reading_mac_catalog(self):
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2ioAAAAASUVORK5CYII=")
        asset_id = "image-" + hashlib.sha256(image).hexdigest()
        data = "data:image/png;base64," + base64.b64encode(image).decode()
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with (
                patch.object(state.series_catalogs, "read_character_image", side_effect=AssertionError("must use client image")),
                patch.object(state, "character_reference_auxiliary", return_value={"ocr_lines": [{"text": "注記原文"}]}) as auxiliary,
                patch.object(vision_state, "run_character_reference_set_worker", return_value={"recognition": {}, "reference_views": ["front"]}) as worker,
            ):
                result = state.analyze_character_reference_set("client-series", "client-character", [asset_id], "テスト", supplied_images_value=[data])
                auxiliary.assert_called_once_with(image, include_ocr=True)
                self.assertEqual(worker.call_args.kwargs["auxiliaries"], [{"ocr_lines": [{"text": "注記原文"}]}])
                self.assertEqual(worker.call_args.kwargs["image_bytes"], [image])
                self.assertEqual(result["reference_views"][0]["asset_id"], asset_id)
                with self.assertRaisesRegex(ValueError, "一致"):
                    state.analyze_character_reference_set("s", "c", ["image-" + "a" * 64], "", supplied_images_value=[data])
                with self.assertRaisesRegex(ValueError, "件数"):
                    state.analyze_character_reference_set("s", "c", [asset_id], "", supplied_images_value=[])
                self.assertEqual(worker.call_count, 1)

    def test_figure_and_reference_analysis_share_one_lock(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            self.assertIsInstance(state.analysis_lock, type(__import__("threading").Lock()))
            self.assertFalse(hasattr(state, "figure_performance_lock"))


if __name__ == "__main__":
    unittest.main()
