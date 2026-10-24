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


class FigurePerformanceWorkerTest(unittest.TestCase):
    def test_finer_sizes_survive_bridge_and_analysis(self):
        for size in ("long", "knee-up", "shoulder-up", "face-detail"):
            with self.subTest(size=size):
                self.assertIn(size, bridge.FIGURE_PERFORMANCE_SIZES)
                self.assertIn(size, worker.FIGURE_SIZES)
                self.assertEqual(worker.normalize_analysis({}, {}, size)["framing"]["size"], size)
        knee = worker.normalize_analysis({"framing": "knee_up", "pose_draft": "膝を曲げる",
                                          "pose": {"legs": [{"side": "left", "visibility": "visible"}]}}, {}, "full")
        self.assertEqual(knee["framing"]["size"], "knee-up")
        face = worker.normalize_analysis({"framing": "full_body", "pose": {"base_posture": "standing"}}, {}, "face-detail")
        self.assertEqual(face["framing"]["size"], "face-detail")
        self.assertEqual(face["pose"]["base"], "uncertain")

    def test_prompt_separates_framing_and_posture_without_proportion_inference(self):
        prompt = worker.prompt_text("bust-up")
        self.assertIn("描写範囲と基本姿勢は別々", prompt)
        self.assertIn("胸から上でも standing", prompt)
        self.assertIn("等身、頭身", prompt)
        self.assertIn("周囲のコマ枠", prompt)
        self.assertIn("pupil_or_iris_visible", prompt)

    def test_standing_is_kept_when_the_crop_is_bust_up(self):
        analysis = worker.normalize_analysis({
            "framing": "bust_up",
            "edge_truncation": {"cropped_parts": [], "fully_visible_parts": ["頭", "胸"]},
            "canvas_orientation": {"body_axis": "upright"},
            "view_direction": {"head": {"view_angle": "front", "horizontal_facing": "center"}},
            "pose": {"base_posture": "standing", "torso_shape": "上体は正面", "arms": [], "legs": []},
        }, {
            "eye_observation": {"combined_state": "open"},
            "expression_family_candidates": [{"label": "中立", "visual_evidence": []}],
            "smile_detected": False,
            "direction_draft": "中立的な表情で正面を見る",
        }, "bust-up")
        action = worker.compose_action(analysis)
        self.assertEqual(analysis["framing"]["size"], "bust-up")
        self.assertIn("立っている", action)
        self.assertNotIn("脚", action)

    def test_face_only_crop_does_not_infer_whole_body_posture(self):
        analysis = worker.normalize_analysis({
            "framing": "bust_up",
            "edge_truncation": {
                "cropped_parts": ["脚", "hair"],
                "fully_visible_parts": ["腕"],
                "occluded_but_not_cropped_parts": ["胴"],
                "cropped_by_image_edge": True,
            },
            "canvas_orientation": {
                "body_axis": "upside_down",
                "head_relative_to_pelvis": "頭は骨盤より下",
                "is_upside_down": True,
            },
            "view_direction": {
                "head": {"view_angle": "front", "horizontal_facing": "center"},
                "torso": {
                    "view_angle": "back",
                    "horizontal_facing": "image_left",
                    "evidence": ["背中が見える"],
                },
                "head_torso_twist": "頭と胴体が逆方向",
            },
            "pose": {
                "base_posture": "standing",
                "torso_shape": "上体は正面",
                "arms": [{"side": "left", "visibility": "cropped"}],
                "legs": [{"side": "right", "visibility": "cropped"}],
                "support_or_contact": "足が地面に接している",
                "action_candidate": "立っている",
            },
            "pose_draft": "立って左腕を上げ、両脚で接地している",
        }, {
            "expression_family_candidates": [{"label": "中立", "visual_evidence": []}],
            "smile_detected": False,
            "direction_draft": "中立な表情",
        }, "face")
        action = worker.compose_action(analysis)
        self.assertEqual(analysis["framing"]["size"], "face")
        self.assertEqual(analysis["framing"]["source"], "face_closeup")
        self.assertEqual(analysis["framing"]["visible_parts"], [])
        self.assertEqual(analysis["framing"]["cut_off_parts"], [])
        self.assertEqual(analysis["framing"]["occluded_parts"], [])
        self.assertFalse(analysis["framing"]["cropped_by_image_edge"])
        self.assertEqual(analysis["orientation"]["body_axis"], "uncertain")
        self.assertEqual(analysis["orientation"]["head_relative_to_pelvis"], "")
        self.assertFalse(analysis["orientation"]["upside_down"])
        self.assertEqual(analysis["orientation"]["head"], {
            "view_angle": "front",
            "horizontal_facing": "center",
            "evidence": [],
        })
        self.assertEqual(analysis["orientation"]["torso"], {
            "view_angle": "uncertain",
            "horizontal_facing": "uncertain",
            "evidence": [],
        })
        self.assertEqual(analysis["orientation"]["head_torso_twist"], "")
        self.assertEqual(analysis["pose"]["base"], "uncertain")
        self.assertEqual(analysis["pose"]["torso"], "")
        self.assertEqual(analysis["pose"]["arms"], [])
        self.assertEqual(analysis["pose"]["legs"], [])
        self.assertEqual(analysis["pose"]["support_or_contact"], "")
        self.assertEqual(analysis["pose"]["action_candidate"], "")
        self.assertEqual(analysis["pose"]["draft"], "")
        self.assertNotIn("立っている", action)
        self.assertNotIn("腕", action)
        self.assertNotIn("脚", action)
        self.assertNotIn("上下逆さ", action)
        self.assertIn("中立な表情", action)

    def test_subtle_smile_is_preserved_without_becoming_strong(self):
        analysis = worker.normalize_analysis({
            "framing": "face_closeup",
            "pose": {"base_posture": "uncertain", "arms": [], "legs": []},
        }, {
            "eye_observation": {
                "left": {"pupil_or_iris_visible": "true", "eye_state": "open"},
                "right": {"pupil_or_iris_visible": "true", "eye_state": "open"},
                "combined_state": "open",
            },
            "expression_family_candidates": [{"label": "笑顔", "visual_evidence": ["口角上昇がごく弱い"]}],
            "smile_detected": True,
            "smile_observation": {
                "eye_state": "open",
                "mouth_opening": "closed",
                "mouth_shape": "口角がわずかに上がる",
            },
            "smile_type_candidates": [{
                "label": "微笑み",
                "strength": "weak",
                "visual_evidence": ["口角上昇がごく弱い"],
            }],
            "direction_draft": "口角がごくわずかに上がっている",
        }, "face")
        action = worker.compose_action(analysis)
        self.assertIn("ほのかな微笑み", action)
        self.assertNotIn("強く笑", action)

    def test_visible_knees_can_correct_sitting_to_kneeling_and_full_body(self):
        analysis = worker.normalize_analysis({
            "framing": "waist_up",
            "pose": {
                "base_posture": "sitting",
                "arms": [{"side": "left", "image_direction": "up", "elbow": "straight", "visibility": "full"}],
                "legs": [
                    {"side": "left", "knee": "bent", "visibility": "full"},
                    {"side": "right", "knee": "bent", "visibility": "full"},
                ],
            },
            "pose_draft": "左腕を頭上に伸ばし、両膝を地面についている。",
        }, {}, "bust-up")
        self.assertEqual(analysis["pose"]["base"], "kneeling")
        self.assertEqual(analysis["framing"]["size"], "full")
        self.assertIn("膝立ち", worker.compose_action(analysis))

    def test_waist_up_action_omits_unseen_leg_details(self):
        analysis = worker.normalize_analysis({
            "framing": "waist_up",
            "pose": {
                "base_posture": "standing",
                "arms": [],
                "legs": [
                    {"side": "left", "knee": "straight", "visibility": "full"},
                    {"side": "right", "knee": "straight", "visibility": "full"},
                ],
            },
        }, {}, "bust-up")
        action = worker.compose_action(analysis)
        self.assertIn("立っている", action)
        self.assertNotIn("膝", action)

    def test_extracts_json_after_model_chatter(self):
        raw = "model loaded\n```json\n" + json.dumps({"pose": {"base": "running"}}) + "\n```"
        self.assertEqual(worker.extract_json_object(raw)["pose"]["base"], "running")


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
