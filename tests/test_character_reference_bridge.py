# アナログネームとは異なるパイプライン、一枚のイラストからデザインを抽出する。
# RT-DETRやBaberu OCRによる領域分割を使わず、設定画全体をQwen-VLへ渡し、性別・年齢感も含めて英語で特徴を保持することを検査する。
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
    # 見込み: 設定画全体と性別・年齢感を指示すれば、分割や人物名による補作を要求しない。
    # 合格: 全図統合の指示と対象カテゴリ・属性が入り、人物名は入らない。入力promptのみ、認識精度は対象外。
    def test_prompt_extracts_whole_sheet_design_and_retains_gender_and_age_words(self):
        prompt = worker.prompt_text("小雪")
        self.assertIn("character design reference illustration", prompt)
        self.assertIn("synthesize all views in the illustration as a whole", prompt.casefold())
        for required_word in ("girl", "boy", "woman", "man", "young", "elderly", "child"):
            self.assertIn(required_word, prompt)
        self.assertIn("accessories", prompt)
        self.assertIn("hair", prompt)
        self.assertIn("face", prompt)
        self.assertIn("silhouette", prompt)
        self.assertIn("outfit", prompt)
        self.assertIn("turnaround", prompt)
        self.assertNotIn("小雪", prompt)

    def test_reference_set_prompt_inspects_whole_illustrations_and_retains_gender_and_age_words(self):
        prompt = worker.reference_set_prompt_text(3, "小雪")
        self.assertIn("3 whole character reference illustrations", prompt)
        for required_word in ("girl", "boy", "woman", "man", "young", "elderly", "child"):
            self.assertIn(required_word, prompt)
        self.assertNotIn("小雪", prompt)

    def test_normalization_preserves_gender_and_age_traits_while_removing_pose_expression_and_style(self):
        result = worker.normalize_analysis({
            "recognition": {
                "silhouette": {
                    "observed": [
                        "slender young girl build",
                        "young woman",
                        "young boy",
                        "adult man",
                        "elderly man",
                        "child figure",
                        "rounded female body silhouette",
                        "sitting with raised hands",
                    ],
                    "inferred": ["slightly broad shoulders"],
                },
                "face": {
                    "observed": [
                        "young girl facial features with a soft rounded chin",
                        "large rounded eyes with double-eyelid creases",
                        "smiling with closed eyes",
                    ],
                },
                "hair": {
                    "observed": [
                        "light unshaded white chin-length bob",
                        "rough art style",
                    ],
                },
                "accessories": {
                    "observed": [
                        "wide solid black headband worn across the crown of the head",
                    ],
                },
                "outfit": {
                    "observed": [
                        "solid black high-neck long-sleeved turtleneck shirt",
                        "white sleeveless deep V-neck A-line jumper dress",
                        "solid black opaque tights",
                        "solid black low-heeled shoes",
                    ],
                },
            }
        })
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [
            "slender young girl build",
            "young woman",
            "young boy",
            "adult man",
            "elderly man",
            "child figure",
            "rounded female body silhouette",
        ])
        self.assertEqual(result["recognition"]["silhouette"]["inferred"], [])
        self.assertEqual(result["recognition"]["face"]["observed"], [
            "young girl facial features with a soft rounded chin",
            "large rounded eyes with double-eyelid creases",
        ])
        self.assertEqual(result["recognition"]["hair"]["observed"], [
            "light unshaded white chin-length bob",
        ])
        self.assertEqual(result["recognition"]["accessories"]["observed"], [
            "wide solid black headband worn across the crown of the head",
        ])
        self.assertEqual(len(result["recognition"]["outfit"]["observed"]), 4)

    # 見込み: 汎用的な人体の列挙を除いても、人外の輪郭を表す語は特徴として残す。
    # 合格: ghost・sheet-like figure・固有形状が残り、eyes等の列挙とチェックリストの反復は消える。固定応答の正規化のみ。
    def test_normalization_removes_generic_anatomy_and_checklist_echoes_but_keeps_distinctive_traits(self):
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
                        "eye contour with slight slant",
                        "permanent eyebrow curve",
                        "nose shape with defined bridge",
                        "mouth with straight line",
                        "large upward-slanting eyes",
                        "no eyebrows, nose or mouth",
                    ],
                    "inferred": [],
                },
                "silhouette": {
                    "observed": [
                        "two arms",
                        "shoulder width",
                        "body shape",
                        "ghost",
                        "sheet-like figure",
                        "slightly broad shoulders",
                        "elongated shape without limbs or joints",
                    ],
                    "inferred": [],
                },
                "outfit": {
                    "observed": [
                        "back is visible",
                        "black long sleeves with a high collar",
                    ],
                    "inferred": [],
                },
            }
        })
        self.assertEqual(result["recognition"]["face"]["observed"], [
            "large upward-slanting eyes",
            "no eyebrows, nose or mouth",
        ])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [
            "ghost",
            "sheet-like figure",
            "slightly broad shoulders",
            "elongated shape without limbs or joints",
        ])
        self.assertEqual(result["recognition"]["outfit"]["observed"], [
            "black long sleeves with a high collar",
        ])

    def test_normalization_keeps_english_observed_and_discards_japanese_or_inferred(self):
        result = worker.normalize_analysis({
            "recognition": {
                "hair": {
                    "observed": ["short bob", "Short bob", "短いボブ", "short bob（短いボブ）"],
                    "inferred": ["possibly rounded back of head"],
                },
                "outfit": "invalid",
            }
        })
        self.assertEqual(result["recognition"]["hair"]["observed"], ["short bob"])
        self.assertEqual(result["recognition"]["hair"]["inferred"], [])
        self.assertEqual(result["recognition"]["outfit"], {"observed": [], "inferred": []})

    def test_reference_set_keeps_consensus_and_complementary_view_traits(self):
        result = worker.normalize_reference_set_analysis({
            "reference_views": [
                {"image_index": 1, "view": "turnaround", "confidence": "high"},
                {"image_index": 2, "view": "expression", "confidence": "high"},
            ],
            "trait_statistics": {
                "hair": [
                    {"trait": "chin-length white bob", "image_indexes": [1, 2], "stable": True, "complementary_view_only": False},
                    {"trait": "temporary messy hair", "image_indexes": [1], "stable": True, "complementary_view_only": False},
                ],
                "accessories": [
                    {"trait": "wide solid black headband worn across the crown", "image_indexes": [1], "stable": True, "complementary_view_only": True},
                ],
            },
        }, 2)
        self.assertEqual(result["reference_views"], ["turnaround", "expression"])
        self.assertEqual(result["reference_view_confidences"], ["high", "high"])
        self.assertEqual(result["recognition"]["hair"]["observed"], ["chin-length white bob"])
        self.assertEqual(result["recognition"]["accessories"]["observed"], ["wide solid black headband worn across the crown"])
        self.assertEqual(result["trait_statistics"]["hair"][0]["image_count"], 2)

    def test_single_sheet_analyze_runs_single_whole_image_vlm_call_without_cropping(self):
        calls = []

        def generate(_model, _processor, prompt, *, image, **_sampling):
            calls.append((prompt, list(image)))
            return SimpleNamespace(text=json.dumps({
                "reference_view": "turnaround",
                "recognition": {
                    "accessories": {"observed": ["wide solid black headband over the crown"], "inferred": []},
                    "hair": {"observed": ["light unshaded white chin-length bob"], "inferred": []},
                    "face": {"observed": ["young girl facial features", "large rounded eyes with double-eyelid creases"], "inferred": []},
                    "silhouette": {"observed": ["slender young girl build", "flared A-line dress silhouette"], "inferred": []},
                    "outfit": {"observed": ["solid black turtleneck shirt", "white sleeveless V-neck A-line dress"], "inferred": []},
                },
            }))

        vlm = SimpleNamespace(load=Mock(return_value=(SimpleNamespace(config={}), object())), generate=generate)
        template = SimpleNamespace(apply_chat_template=lambda _processor, _config, prompt, num_images: prompt)
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            (root / "config.json").touch()
            whole_sheet = root / "sheet.jpg"
            whole_sheet.touch()
            args = SimpleNamespace(model=root, image=[root / "source.png"], max_tokens=1200)
            args.image[0].touch()
            output = io.StringIO()
            with (
                patch.dict(sys.modules, {"mlx_vlm": vlm, "mlx_vlm.prompt_utils": template}),
                patch.object(worker, "prepare_whole_reference_image", return_value=(whole_sheet, 351, 187)) as prepare,
                patch.object(worker, "parse_args", return_value=args),
                patch.object(sys, "stdin", io.StringIO(json.dumps({"set_analysis": True, "target_character": "小雪"}))),
                patch.object(sys, "stdout", output),
            ):
                self.assertEqual(worker.main(), 0)
            prepare.assert_called_once_with(args.image[0].resolve())
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], [str(whole_sheet)])
        envelope = json.loads(output.getvalue())
        self.assertTrue(envelope["ok"])
        result = envelope["result"]
        self.assertEqual(result["reference_views"], ["turnaround"])
        self.assertEqual(result["recognition"]["accessories"]["observed"], ["wide solid black headband over the crown"])
        self.assertEqual(result["recognition"]["face"]["observed"], [
            "young girl facial features",
            "large rounded eyes with double-eyelid creases",
        ])
        self.assertEqual(result["recognition"]["silhouette"]["observed"], [
            "slender young girl build",
            "flared A-line dress silhouette",
        ])
        self.assertEqual(result["recognition"]["outfit"]["observed"], [
            "solid black turtleneck shirt",
            "white sleeveless V-neck A-line dress",
        ])

    def test_extracts_json_after_model_chatter(self):
        raw = "loaded\n```json\n" + json.dumps({"recognition": {"hair": {}}}) + "\n```"
        self.assertIn("recognition", worker.extract_json_object(raw))


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
                        "recognition": {"hair": {"observed": ["short bob"], "inferred": []}},
                        "prompt_version": "character-reference-v21-whole-sheet-en",
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
                )

        self.assertEqual(result["prompt_version"], "character-reference-v21-whole-sheet-en")
        process = created[0]
        temporary_image = Path(process.command[process.command.index("--image") + 1])
        self.assertFalse(temporary_image.exists())
        self.assertEqual(process.kwargs["env"]["HF_HUB_OFFLINE"], "1")
        self.assertEqual(process.kwargs["env"]["TRANSFORMERS_OFFLINE"], "1")
        payload = json.loads(process.input)
        self.assertEqual(payload["target_character"], "グレー")
        self.assertNotIn("auxiliary", payload)

    def test_set_worker_passes_all_images_to_one_offline_process_without_rtdetr_auxiliaries(self):
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
                    "prompt_version": "character-reference-v21-whole-sheet-en",
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
                )

        process = created[0]
        self.assertEqual(process.command.count("--image"), 2)
        image_paths = [Path(process.command[index + 1]) for index, value in enumerate(process.command) if value == "--image"]
        self.assertTrue(all(not path.exists() for path in image_paths))
        payload = json.loads(process.input)
        self.assertTrue(payload["set_analysis"])
        self.assertNotIn("auxiliaries", payload)

    def test_analysis_extracts_whole_sheet_without_calling_rtdetr_or_ocr(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            worker_result = {
                "recognition": {"hair": {"observed": ["short bob"], "inferred": []}},
                "reference_view": "turnaround",
                "prompt_version": "character-reference-v21-whole-sheet-en",
            }
            with (
                patch.object(vision_state, "run_local_worker") as local_worker,
                patch.object(vision_state, "run_character_reference_worker", return_value=worker_result) as reference_worker,
            ):
                result = state.analyze_character_reference(b"reference", "グレー")

        self.assertEqual(result["recognition"]["hair"]["observed"], ["short bob"])
        self.assertEqual(result["reference_view"], "turnaround")
        self.assertEqual(result["analyzer"]["provider"], "local")
        self.assertEqual(result["analyzer"]["model"], "local-qwen")
        local_worker.assert_not_called()
        self.assertNotIn("auxiliary", reference_worker.call_args.kwargs)

    def test_set_analysis_uses_saved_images_without_rtdetr_and_returns_per_image_views(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            worker_result = {
                "recognition": {"hair": {"observed": ["chin-length black bob"], "inferred": []}},
                "reference_views": ["front", "expression"],
                "reference_view_confidences": ["high", "high"],
                "trait_statistics": {"hair": [{"trait": "chin-length black bob", "image_count": 2}]},
                "prompt_version": "character-reference-v21-whole-sheet-en",
            }
            with (
                patch.object(state.series_catalogs, "read_character_image", side_effect=lambda *_: {"found": True, "image_bytes": b"image"}),
                patch.object(vision_state, "run_local_worker") as local_worker,
                patch.object(vision_state, "run_character_reference_set_worker", return_value=worker_result) as set_worker,
            ):
                result = state.analyze_character_reference_set(
                    "series-one",
                    "character-one",
                    [f"image-{'a' * 64}", f"image-{'b' * 64}"],
                    "グレー",
                )

        self.assertEqual(result["recognition"]["hair"]["observed"], ["chin-length black bob"])
        self.assertEqual(result["reference_views"], [
            {"asset_id": f"image-{'a' * 64}", "view": "front", "confidence": "high"},
            {"asset_id": f"image-{'b' * 64}", "view": "expression", "confidence": "high"},
        ])
        self.assertEqual(set_worker.call_args.kwargs["target_character"], "グレー")
        self.assertNotIn("auxiliaries", set_worker.call_args.kwargs)
        local_worker.assert_not_called()

    def test_set_analysis_accepts_client_images_without_reading_mac_catalog_or_running_rtdetr(self):
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2ioAAAAASUVORK5CYII=")
        asset_id = "image-" + hashlib.sha256(image).hexdigest()
        data = "data:image/png;base64," + base64.b64encode(image).decode()
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            with (
                patch.object(state.series_catalogs, "read_character_image", side_effect=AssertionError("must use client image")),
                patch.object(vision_state, "run_local_worker") as local_worker,
                patch.object(vision_state, "run_character_reference_set_worker", return_value={"recognition": {}, "reference_views": ["turnaround"]}) as set_worker,
            ):
                result = state.analyze_character_reference_set("client-series", "client-character", [asset_id], "テスト", supplied_images_value=[data])
                local_worker.assert_not_called()
                self.assertEqual(set_worker.call_args.kwargs["image_bytes"], [image])
                self.assertNotIn("auxiliaries", set_worker.call_args.kwargs)
                self.assertEqual(result["reference_views"][0]["asset_id"], asset_id)
                with self.assertRaisesRegex(ValueError, "一致"):
                    state.analyze_character_reference_set("s", "c", ["image-" + "a" * 64], "", supplied_images_value=[data])
                with self.assertRaisesRegex(ValueError, "件数"):
                    state.analyze_character_reference_set("s", "c", [asset_id], "", supplied_images_value=[])
                self.assertEqual(set_worker.call_count, 1)

    def test_figure_and_reference_analysis_share_one_lock(self):
        with tempfile.TemporaryDirectory() as directory_name:
            state = self.make_state(Path(directory_name))
            self.assertIsInstance(state.analysis_lock, type(__import__("threading").Lock()))
            self.assertFalse(hasattr(state, "figure_performance_lock"))


if __name__ == "__main__":
    unittest.main()
