"""Targeted tests for cloud single-image generation helper."""
from __future__ import annotations

import base64
import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import image_generation as ig  # noqa: E402


class CloudSingleImageTests(unittest.TestCase):
    def test_closest_aspect_ratio(self) -> None:
        self.assertEqual(ig._closest_aspect_ratio(1000, 1000), "1:1")
        self.assertEqual(ig._closest_aspect_ratio(750, 1000), "3:4")
        self.assertEqual(ig._closest_aspect_ratio(1600, 900), "16:9")
        self.assertEqual(ig._closest_aspect_ratio(None, None), "3:4")

    def test_build_cloud_single_prompt_for_figure(self) -> None:
        prompt = ig.build_cloud_single_prompt(
            target_kind="figure",
            label="小雪",
            character_name="小雪",
            action="驚いた表情で振り向く",
            output_format="モノクロ",
            style_notes=[
                "[style] 作品の出力形式はOMNYの meta.format に従う。",
                "Gペン風の強弱ある線画",
            ],
            negative_prompt="blurry, color",
            has_character_refs=True,
            has_reference_image=True,
        )
        self.assertIn("monochrome black-and-white Japanese manga line art", prompt)
        self.assertIn("character reference sheet", prompt)
        self.assertIn("rough character sketch/guide", prompt)
        self.assertIn("小雪", prompt)
        self.assertIn("驚いた表情で振り向く", prompt)
        self.assertIn("Gペン風の強弱ある線画", prompt)
        self.assertNotIn("[style] 作品の出力形式", prompt)
        self.assertIn("Negative / avoid: blurry, color", prompt)

    def test_generate_cloud_single_image_closes_connection_and_decodes_parts(self) -> None:
        fake_png = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode("ascii")
        fake_response = json.dumps({
            "candidates": [{
                "content": {
                    "parts": [{
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": fake_png,
                        }
                    }]
                }
            }]
        }).encode("utf-8")

        captured_requests = []

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return fake_response

        def _fake_urlopen(req, timeout=None):
            captured_requests.append((req, timeout))
            return _FakeResp()

        sample_data_url = f"data:image/png;base64,{fake_png}"
        with mock.patch.object(ig, "resolve_cloud_api_key", return_value="test-key"), \
             mock.patch.object(ig.urllib.request, "urlopen", side_effect=_fake_urlopen):
            result = ig.generate_cloud_single_image(
                model="gemini-3.1-flash-image",
                target_kind="figure",
                label="小雪",
                character_name="小雪",
                width=600,
                height=800,
                cutout_white_background=False,
                character_references=[{"label": "小雪設定画", "image": sample_data_url}],
                reference_image=sample_data_url,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["model"], "gemini-3.1-flash-image")
        self.assertEqual(result["mime_type"], "image/png")
        self.assertEqual(result["image_base64"], fake_png)
        self.assertEqual(len(captured_requests), 1)
        req, _timeout = captured_requests[0]
        self.assertEqual(req.get_header("Connection"), "close")
        body = json.loads(req.data.decode("utf-8"))
        parts = body["contents"][0]["parts"]
        # 1 character ref + 1 atari ref + 1 text prompt
        self.assertEqual(len(parts), 3)
        self.assertEqual(body["generationConfig"]["imageConfig"]["aspectRatio"], "3:4")

    def test_list_cloud_vision_models_filters_and_prioritizes_flash_lite(self) -> None:
        fake_models = json.dumps({
            "models": [
                {"name": "models/gemini-3.1-flash-image", "displayName": "Image", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-2.5-flash", "displayName": "Gemini 2.5 Flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-2.5-flash-lite", "displayName": "Gemini 2.5 Flash-Lite", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/text-embedding-004", "displayName": "Embed", "supportedGenerationMethods": ["embedContent"]},
            ]
        }).encode("utf-8")

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return fake_models

        with mock.patch.object(ig, "resolve_cloud_api_key", return_value="test-key"), \
             mock.patch.object(ig.urllib.request, "urlopen", return_value=_FakeResp()):
            result = ig.list_cloud_vision_models()

        self.assertTrue(result["ok"])
        self.assertEqual([m["id"] for m in result["models"]], ["gemini-2.5-flash-lite", "gemini-2.5-flash"])

    def test_extract_and_match_cloud_vision(self) -> None:
        fake_png = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode("ascii")
        sample_data_url = f"data:image/png;base64,{fake_png}"
        extract_resp = json.dumps({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "hair": {"observed": ["黒いショートヘア"], "inferred": []},
                            "face": {"observed": ["丸い目"], "inferred": []},
                            "silhouette": {"observed": [], "inferred": []},
                            "outfit": {"observed": ["セーラー服"], "inferred": []},
                            "accessories": {"observed": ["カチューシャ"], "inferred": []},
                            "ambiguous_design": {"observed": [], "inferred": []},
                        }, ensure_ascii=False)
                    }]
                }
            }]
        }).encode("utf-8")
        match_resp = json.dumps({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "matched_character_id": "char-1",
                            "confidence": "high",
                            "reason": "髪型とカチューシャが一致",
                        }, ensure_ascii=False)
                    }]
                }
            }]
        }).encode("utf-8")

        responses = [extract_resp, match_resp]

        class _FakeResp:
            def __init__(self, data):
                self._data = data

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return self._data

        with mock.patch.object(ig, "resolve_cloud_api_key", return_value="test-key"), \
             mock.patch.object(ig.urllib.request, "urlopen", side_effect=lambda req, timeout=None: _FakeResp(responses.pop(0))):
            extracted = ig.extract_cloud_character_features(
                model="gemini-2.5-flash-lite",
                images=[{"image": sample_data_url}],
                character_name="小雪",
            )
            matched = ig.match_cloud_character(
                model="gemini-2.5-flash-lite",
                image=sample_data_url,
                candidates=[{"id": "char-1", "name": "小雪", "recognition": extracted["recognition"]}],
            )

        self.assertEqual(extracted["recognition"]["hair"]["observed"], ["黒いショートヘア"])
        self.assertEqual(extracted["analyzer"]["provider"], "cloud")
        self.assertEqual(matched["matched_character_id"], "char-1")
        self.assertEqual(matched["confidence"], "high")


if __name__ == "__main__":
    unittest.main()
