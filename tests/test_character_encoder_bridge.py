"""Unit tests for Group 1 M1+M2 shared lightweight character vision encoder."""

import base64
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import character_vision_encoder as encoder  # noqa: E402
from vision_character_analysis import VisionCharacterAnalysis  # noqa: E402


def _png_bytes(size=(128, 128), color=(255, 255, 255), draw_rect=None) -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", size, color)
    if draw_rect is not None:
        draw = ImageDraw.Draw(image)
        draw.rectangle(draw_rect, fill=(20, 20, 20))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


class CharacterEncoderTests(unittest.TestCase):
    def test_embedding_matching_and_abstention_on_low_margin(self):
        match = encoder.match_character_embeddings(
            [1.0, 0.0, 0.0],
            [
                {"id": "koyuki", "embedding": [0.95, 0.31, 0.0]},
                {"id": "haru", "embedding": [0.40, 0.91, 0.0]},
            ],
        )
        self.assertEqual(match["candidate_id"], "koyuki")
        self.assertEqual(match["confidence"], "high")

        # Ambiguous candidates with close scores must abstain safely.
        ambiguous = encoder.match_character_embeddings(
            [1.0, 0.0],
            [
                {"id": "a", "embedding": [0.85, 0.52]},
                {"id": "b", "embedding": [0.84, 0.54]},
            ],
        )
        self.assertEqual(ambiguous["candidate_id"], "")
        self.assertEqual(ambiguous["confidence"], "none")

    def test_view_and_size_prediction_plus_asset_recommendation(self):
        centered = _png_bytes(size=(180, 180), draw_rect=(50, 25, 130, 155))
        pred = encoder.predict_figure_view_and_size(centered, current_size="bust-up")
        self.assertEqual(pred["recommended_view"], "front")
        self.assertEqual(pred["suggested_size"], "face")

        rec = encoder.recommend_reference_view(
            centered,
            [
                {"asset_id": "asset-side", "view": "side"},
                {"asset_id": "asset-front", "view": "front"},
            ],
        )
        self.assertEqual(rec["asset_id"], "asset-front")
        self.assertEqual(rec["matched_view"], "front")

    def test_vision_character_analysis_lightweight_match_and_recommend(self):
        class StubAnalysis(VisionCharacterAnalysis):
            character_encoder_model = Path("/nonexistent/model.onnx")

        stub = StubAnalysis()
        img_a = _png_bytes(size=(160, 260), draw_rect=(40, 20, 120, 240))
        img_b = _png_bytes(size=(160, 260), draw_rect=(10, 180, 150, 250))

        matched = stub.analyze_character_match_lightweight(
            img_a,
            [
                {"id": "char-a", "reference_images": [_data_url(img_a)]},
                {"id": "char-b", "reference_images": [_data_url(img_b)]},
            ],
            current_size="waist-up",
        )
        self.assertEqual(matched["candidate_id"], "char-a")
        self.assertIn(matched["confidence"], ("high", "medium", "low"))
        self.assertEqual(matched["analyzer"]["runtime"], "lightweight-descriptor-fallback")

        rec = stub.recommend_figure_reference_view(
            img_a,
            [{"asset_id": "img-1", "view": "front"}],
            current_size="waist-up",
        )
        self.assertEqual(rec["asset_id"], "img-1")

    def test_analyze_character_match_falls_back_to_lightweight_encoder_without_vlm(self):
        class NoVlmAnalysis(VisionCharacterAnalysis):
            character_encoder_model = Path("/nonexistent/model.onnx")

            def resolve_vlm_model(self, requested):
                return Path("/nonexistent/vlm"), "missing-vlm"

            def vlm_available(self, selected_model=None):
                return False

        stub = NoVlmAnalysis()
        img = _png_bytes(size=(160, 260), draw_rect=(40, 20, 120, 240))
        result = stub.analyze_character_match(
            img,
            [{"id": "char-a", "observed_traits": ["黒髪ショート"]}],
            "bust-up",
        )
        self.assertEqual(result["analyzer"]["provider"], "local")
        self.assertEqual(result["analyzer"]["runtime"], "lightweight-descriptor-fallback")
        self.assertEqual(result["confidence"], "none")
        expr = result["analysis"]["expression"]
        self.assertEqual(expr["read_status"], "no_face")
        self.assertTrue(expr["catalog_version"])
        self.assertRegex(expr["catalog_sha256"], r"^[0-9a-f]{64}$")

    def test_short_lived_worker_cli_executes_offline(self):
        img = _png_bytes(size=(128, 128), draw_rect=(32, 20, 96, 110))
        with tempfile.TemporaryDirectory() as directory:
            img_path = Path(directory) / "fig.png"
            img_path.write_bytes(img)
            proc = subprocess.run(
                [sys.executable, str(SCRIPTS_DIR / "local_character_encoder_worker.py"), "--mode", "recommend-view", "--image", str(img_path)],
                input=json.dumps({"available_assets": [{"asset_id": "a1", "view": "front"}], "current_size": "bust-up"}),
                capture_output=True,
                text=True,
                check=True,
            )
        payload = json.loads(proc.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["result"]["asset_id"], "a1")


if __name__ == "__main__":
    unittest.main()
