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


if __name__ == "__main__":
    unittest.main()
