"""選択画像の画素だけから有効な仕上げレイヤーを返す。合成PNGの分離・透過・寸法と上限を確認。
MangaScreen実装を使う試験は導入済み環境をNYAMURU_COMFYUI_DIRに指定して実行する。
"""
import base64
import io
import os
from pathlib import Path
import sys
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from manga_finish import finish_raster, load_mangascreen
from nyamuru_ocr_util import decode_image_data


def data_url(image):
    raw = io.BytesIO()
    image.save(raw, "PNG")
    return "data:image/png;base64," + base64.b64encode(raw.getvalue()).decode("ascii")


class MangaFinishTests(unittest.TestCase):
    # 見込み: 過大な出力要求は画像展開前に止まる。合格: 上限超過でValueError。範囲: 画素処理前の入力。
    def test_output_bound(self):
        with self.assertRaisesRegex(ValueError, "2048px"):
            finish_raster({"long_edge": 2049}, None)

    # 見込み: 透明素材には追加画像がない。合格: 縦長入力を指定比率へ拡大し、出力役割は空。範囲: 合成PNG。
    def test_empty_source_yields_no_layers(self):
        result = finish_raster({"long_edge": 128, "image": data_url(Image.new("RGBA", (16, 32)))}, None)
        self.assertEqual(result, {"width": 64, "height": 128, "layers": {}})

    # 見込み: 細線・黒面・陰影・白い肌が別々に編集できる。合格: 各位置の役割と透過穴が一致、白紙は白だけ。範囲: 実MangaScreenと合成PNG。
    @unittest.skipUnless(os.environ.get("NYAMURU_COMFYUI_DIR"), "ローカルMangaScreen依存")
    def test_real_screen_separates_only_painted_roles(self):
        screen = load_mangascreen(os.environ["NYAMURU_COMFYUI_DIR"])
        image = Image.new("RGBA", (256, 160))
        image.paste("white", (16, 10, 240, 150))
        image.paste((255, 255, 255, 0), (20, 20, 32, 32))
        image.paste((90, 90, 90, 255), (40, 40, 41, 142))
        image.paste("black", (80, 50, 144, 130))
        image.paste((150, 150, 150, 255), (160, 40, 228, 142))
        output = finish_raster({"long_edge": 512, "image": data_url(image)}, screen)
        self.assertEqual((output["width"], output["height"]), (512, 320))
        layers = {role: Image.open(io.BytesIO(decode_image_data(url))).convert("LA")
                  for role, url in output["layers"].items()}
        self.assertEqual(set(layers), {"line", "black", "shade", "white"})
        self.assertEqual(layers["white"].getpixel((74, 112)), (255, 255))
        self.assertEqual(layers["line"].getpixel((80, 160)), (0, 255))
        self.assertEqual(layers["black"].getpixel((190, 160)), (0, 255))
        gray, alpha = layers["shade"].getpixel((380, 160))
        self.assertTrue(0 < gray < 255 and alpha == 255)
        for layer in layers.values():
            self.assertEqual(layer.getpixel((2, 2))[1], 0)
            self.assertEqual(layer.getpixel((52, 52))[1], 0)
        white = finish_raster({"long_edge": 128, "image": data_url(Image.new("RGB", (16, 16), "white"))}, screen)
        self.assertEqual(set(white["layers"]), {"white"})


if __name__ == "__main__":
    unittest.main()
