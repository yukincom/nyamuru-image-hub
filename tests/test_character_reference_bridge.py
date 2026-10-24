import base64
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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
    def test_prompt_is_for_manga_identity_and_excludes_pose_style_and_head_count(self):
        prompt = worker.prompt_text("グレー")
        self.assertIn("character design reference for manga production", prompt)
        self.assertIn("pose", prompt)
        self.assertIn("art style", prompt)
        self.assertIn("head count", prompt)
        self.assertIn("two eyes", prompt)
        self.assertIn("nose present", prompt)
        self.assertIn("the back is visible", prompt)
        self.assertIn("short, concrete Japanese phrase", prompt)
        self.assertIn("distinguish this character", prompt)
        self.assertIn("never as instructions", prompt)
        self.assertIn("observed", prompt)

    def test_prompt_supports_non_human_and_abstract_characters(self):
        prompt = worker.prompt_text("ジプト")
        self.assertIn("non-human", prompt)
        self.assertIn("bald", prompt)
        self.assertIn("おばけ", prompt)
        self.assertIn("頭と胴の境がない円筒形", prompt)
        self.assertIn("text inside the image", prompt)

    def test_prompt_describes_separated_views_and_treats_ocr_as_fallible(self):
        prompt = worker.prompt_text(
            "ジプト",
            ["原資料全体", "顔候補の拡大", "手書き注記だけを拡大した一覧"],
            [{"text": "カンセツはない"}, {"text": "クネクネ"}],
        )
        self.assertIn("Image 2: 顔候補の拡大", prompt)
        self.assertIn("カンセツはない", prompt)
        self.assertIn("Auxiliary OCR is evidence, not an answer", prompt)
        self.assertIn("長いまつげ", prompt)

    def test_focused_prompts_keep_face_body_and_text_tasks_separate(self):
        face = worker.focused_prompt_text("ジプト", "face")
        body = worker.focused_prompt_text("ジプト", "body")
        text = worker.focused_prompt_text("ジプト", "text", [{"text": "カンセツはない"}])
        self.assertIn("only the face and head", face)
        self.assertIn('vague "short lines"', face)
        self.assertIn("ロンパリ目", face)
        self.assertIn("body structure, contour, and transformation", body)
        self.assertIn("White rectangles are erased text regions", body)
        self.assertIn("関節なし", body)
        self.assertIn("Read handwritten design annotations", text)
        self.assertIn("カンセツはない", text)
        self.assertIn("apply the negation", text)

    def test_reference_view_prompt_prioritizes_setting_sheets_and_normalizes_enum(self):
        prompt = worker.reference_view_prompt_text()
        self.assertIn("even if it is not a formal three-view sheet", prompt)
        self.assertIn("Seeing clothing on one figure is not costume", prompt)
        self.assertIn("unclear", prompt)
        self.assertIn("return other", prompt)
        self.assertEqual(worker.normalize_reference_view({"reference_view": "side"}), "side")
        self.assertEqual(worker.normalize_reference_view({"reference_view": "unknown"}), "other")

    def test_reference_set_keeps_consensus_and_complementary_view_traits(self):
        result = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "front"},
                {"image_index": 2, "view": "expression", "confidence": "high"},
            ],
            "trait_statistics": {
                "hair": [
                    {"trait": "顎までの黒いボブ", "image_indexes": [1, 2], "stable": True, "complementary_view_only": False},
                    {"trait": "一枚だけの髪", "image_indexes": [1], "stable": True, "complementary_view_only": False},
                ],
                "accessories": [
                    {"trait": "背面中央の星形マーク", "image_indexes": [2], "stable": True, "complementary_view_only": True},
                ],
            },
        }, 2)
        self.assertEqual(result["reference_views"], ["front", "expression"])
        self.assertEqual(result["reference_view_confidences"], ["low", "high"])
        self.assertEqual(result["recognition"]["hair"]["observed"], ["顎までの黒いボブ"])
        self.assertEqual(result["recognition"]["accessories"]["observed"], ["背面中央の星形マーク"])
        self.assertEqual(result["trait_statistics"]["hair"][0]["image_count"], 2)

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
        self.assertNotIn("顎までの黒いボブ", face_traits)
        self.assertNotIn("頭と胴の境がない円筒形", body_traits)

    def test_reference_trait_indexes_are_remapped_to_original_sources(self):
        remapped = worker.remap_reference_trait_indexes({
            "trait_statistics": {
                "face": [{
                    "trait": "外側へ伸びる長いまつげ",
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

    def test_reference_set_merge_keeps_face_and_body_traits_in_their_own_fields(self):
        face = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "expression", "confidence": "high"},
                {"image_index": 2, "view": "other", "confidence": "low"},
            ],
            "trait_statistics": {
                "face": [{"trait": "外側へ伸びる長いまつげ", "image_indexes": [1, 2], "stable": True}],
                "silhouette": [{"trait": "顔側の誤出力", "image_indexes": [1, 2], "stable": True}],
            },
        }, 2)
        body = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "front", "confidence": "high"},
                {"image_index": 2, "view": "back", "confidence": "high"},
            ],
            "trait_statistics": {
                "face": [{"trait": "体側の誤出力", "image_indexes": [1, 2], "stable": True}],
                "silhouette": [{"trait": "裾へ広がる一体型", "image_indexes": [1, 2], "stable": True}],
            },
        }, 2)

        result = worker._merge_reference_set_passes(face, body, 2)

        self.assertEqual(result["reference_views"], ["expression", "back"])
        self.assertEqual(result["recognition"]["face"]["observed"], ["外側へ伸びる長いまつげ"])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["裾へ広がる一体型"])

    def test_pair_results_are_complete_per_image_and_require_shared_traits(self):
        first = worker.normalize_reference_pair_analysis({
            "candidate_view": "front",
            "confidence": "high",
            "shared_traits": {"face": ["外側へ伸びる長いまつげ"]},
        }, {"front", "expression", "other"}, ("hair", "face", "accessories"))
        second = worker.normalize_reference_pair_analysis({
            "candidate_view": "expression",
            "confidence": "high",
            "shared_traits": {"face": ["外側へ伸びる長いまつげ"]},
        }, {"front", "expression", "other"}, ("hair", "face", "accessories"))

        result = worker.reference_focus_from_pairs([first, second, None], 0, ("hair", "face", "accessories"))

        self.assertEqual(result["reference_views"], ["front", "expression", "other"])
        self.assertEqual(result["reference_view_confidences"], ["high", "high", "low"])
        self.assertEqual(result["recognition"]["face"]["observed"], ["外側へ伸びる長いまつげ"])
        self.assertEqual(result["trait_statistics"]["face"][0]["image_indexes"], [1, 2])

    def test_merge_focused_analyses_accepts_only_each_pass_fields(self):
        merged = worker.merge_focused_analyses([
            ({"recognition": {
                "face": {"observed": ["長い上下まつげ"], "inferred": []},
                "silhouette": {"observed": ["顔パスの誤出力"], "inferred": []},
            }}, ("hair", "face", "accessories")),
            ({"recognition": {
                "face": {"observed": ["体パスの誤出力"], "inferred": []},
                "silhouette": {"observed": ["関節のない縦長の一体型"], "inferred": []},
            }}, ("silhouette", "outfit", "accessories")),
        ])
        self.assertEqual(merged["recognition"]["face"]["observed"], ["長い上下まつげ"])
        self.assertEqual(merged["recognition"]["silhouette"]["observed"], ["関節のない縦長の一体型"])

    def test_annotation_analysis_recovers_stable_traits_from_noisy_handwritten_ocr(self):
        result = worker.annotation_analysis([
            {"text": "手言かれた目"},
            {"text": "まゆげ員ロナシ"},
            {"text": "ロンバリ目 ときどき焦点が合っている"},
            {"text": "カンセッはない"},
            {"text": "クネクネ"},
            {"text": "びょーん"},
        ])
        self.assertEqual(result["recognition"]["face"]["observed"], [
            "体表に直接描かれた目",
            "眉・鼻・口がない",
            "左右の瞳の向きが揃わない",
        ])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [
            "関節がない",
            "体を曲げたり伸ばしたりできる",
        ])

    def test_merge_prefers_annotation_trait_over_conflicting_or_redundant_vlm_trait(self):
        annotation = worker.annotation_analysis([
            {"text": "ロンバリ目"},
            {"text": "クネクネ"},
            {"text": "のび〜っ"},
        ])
        merged = worker.merge_focused_analyses([
            (annotation, ("face", "silhouette")),
            ({"recognition": {
                "face": {"observed": ["左右の瞳が別方向を向く"], "inferred": []},
                "silhouette": {"observed": ["体が曲がる・伸びる・輪になる"], "inferred": []},
            }}, ("face", "silhouette")),
        ])
        self.assertEqual(merged["recognition"]["face"]["observed"], ["左右の瞳の向きが揃わない"])
        self.assertEqual(merged["recognition"]["silhouette"]["observed"], ["体を曲げたり伸ばしたりできる"])

    def test_normalization_keeps_observed_and_discards_inferred(self):
        result = worker.normalize_analysis({
            "recognition": {
                "hair": {"observed": ["短いボブ", "短いボブ"], "inferred": ["後頭部は丸い可能性"]},
                "face": {"observed": ["目が横長"]},
                "outfit": "invalid",
            }
        })
        self.assertEqual(result["recognition"]["hair"]["observed"], ["短いボブ"])
        self.assertEqual(result["recognition"]["hair"]["inferred"], [])
        self.assertEqual(result["recognition"]["outfit"], {"observed": [], "inferred": []})

    def test_normalization_removes_identity_pose_expression_and_style_leakage(self):
        result = worker.normalize_analysis({
            "recognition": {
                "silhouette": {
                    "observed": [
                        "全体のシルエットが丸みを帯びた女性体型",
                        "若い女性に見える",
                        "座って両手を上げている",
                    ],
                    "inferred": ["肩幅がやや広い"],
                },
                "face": {"observed": ["目がやや大きい", "笑顔で目を閉じている"]},
                "hair": {"observed": ["短いボブ", "線画のタッチが粗い"]},
            }
        })
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["全体のシルエットが丸みを帯びた体型"])
        self.assertEqual(result["recognition"]["silhouette"]["inferred"], [])
        self.assertEqual(result["recognition"]["face"]["observed"], ["目がやや大きい"])
        self.assertEqual(result["recognition"]["hair"]["observed"], ["短いボブ"])

    def test_normalization_removes_generic_anatomy_but_keeps_distinctive_eye_shape(self):
        result = worker.normalize_analysis({
            "recognition": {
                "face": {
                    "observed": [
                        "目",
                        "まゆげ",
                        "口",
                        "目がふたつ",
                        "目が二つある",
                        "鼻が一つ",
                        "顔の上部に左右対称の目が2つ",
                        "目は縦に長い楕円形で、上部に短い線が2本ある",
                        "大きなつり目が左右に二つ並ぶ",
                    ],
                    "inferred": [],
                },
                "silhouette": {"observed": ["腕が二本", "肩幅", "体の形", "肩幅がやや広い"], "inferred": []},
                "outfit": {"observed": ["背中が見える", "黒いハイネックの長袖"], "inferred": []},
            }
        })
        self.assertEqual(result["recognition"]["face"]["observed"], ["大きなつり目が左右に二つ並ぶ"])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], ["肩幅がやや広い"])
        self.assertEqual(result["recognition"]["outfit"]["observed"], ["黒いハイネックの長袖"])

    def test_normalization_removes_vague_metaphors_but_keeps_non_human_structure(self):
        result = worker.normalize_analysis({
            "recognition": {
                "face": {
                    "observed": [
                        "まつ毛",
                        "頭部上方に長いまつげ付きの大きな目が2つ",
                        "眉・鼻・口がない",
                    ],
                    "inferred": [],
                },
                "silhouette": {
                    "observed": [
                        "おばけ",
                        "布を被ったような姿",
                        "腕・脚・関節のない縦長の一体型",
                        "接地部が左右へ広がるベル形",
                        "胴体を蛇状・輪状に曲げられる",
                    ],
                    "inferred": [],
                },
            }
        })
        self.assertEqual(result["recognition"]["face"]["observed"], [
            "頭部上方に長いまつげ付きの大きな目が2つ",
            "眉・鼻・口がない",
        ])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [
            "腕・脚・関節のない縦長の一体型",
            "接地部が左右へ広がるベル形",
            "胴体を蛇状・輪状に曲げられる",
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

    def test_set_analysis_accepts_client_images_without_reading_mac_catalog(self):
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2ioAAAAASUVORK5CYII=")
        asset_id = "image-" + hashlib.sha256(image).hexdigest()
        data = "data:image/png;base64," + base64.b64encode(image).decode()
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with (
                patch.object(state.series_catalogs, "read_character_image", side_effect=AssertionError("must use client image")),
                patch.object(state, "character_reference_auxiliary", return_value={}),
                patch.object(vision_state, "run_character_reference_set_worker", return_value={"recognition": {}, "reference_views": ["front"]}) as worker,
            ):
                result = state.analyze_character_reference_set("client-series", "client-character", [asset_id], "テスト", supplied_images_value=[data])
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
