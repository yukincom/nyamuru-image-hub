"""Return editable, pre-screen MangaScreen layers for one raster (no output files)."""

import base64
import importlib.util
import io
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from nyamuru_ocr_util import decode_image_data


def load_mangascreen(comfy_root):
    path = Path(comfy_root) / "custom_nodes" / "ComfyUI-MangaScreen" / "__init__.py"
    if not path.is_file():
        raise ValueError("登録済みのComfyUIにComfyUI-MangaScreenが見つかりません")
    spec = importlib.util.spec_from_file_location("mangascreen", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encode_layer(layers, role, gray, alpha):
    if not alpha.any():
        return
    if np.isscalar(gray):
        gray = np.full(alpha.shape, gray, dtype=np.uint8)
    image = Image.merge("LA", (Image.fromarray(gray), Image.fromarray(alpha)))
    output = io.BytesIO()
    image.save(output, format="PNG")
    layers[role] = "data:image/png;base64," + base64.b64encode(output.getbuffer()).decode("ascii")


def finish_raster(body, screen):
    edge = body.get("long_edge")
    if type(edge) is not int or not 1 <= edge <= 2048:
        raise ValueError("仕上げの長辺には1〜2048pxを指定してください")
    with Image.open(io.BytesIO(decode_image_data(body.get("image")))) as image:
        if image.format != "PNG" or image.width * image.height > 32 * 1024 * 1024:
            raise ValueError("仕上げには32メガピクセル以内のPNG画像を選んでください")
        scale = edge / max(image.size)
        size = tuple(max(1, round(length * scale)) for length in image.size)
        source = image.convert("RGBA").resize(size, Image.Resampling.LANCZOS)

    alpha = np.asarray(source.getchannel("A"))
    layers = {}
    result = {"width": size[0], "height": size[1], "layers": layers}
    if not alpha.any():
        return result
    paper = Image.new("RGB", size, "white")
    paper.paste(source, mask=source.getchannel("A"))
    lightness = cv2.cvtColor(np.asarray(paper), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255

    # MangaFinish's own ink, value and region stages. Separate their roles before print_screen.
    k = size[0] / 1024
    ink = screen.ink_layer(lightness, k)
    solid = cv2.GaussianBlur(lightness, (0, 0), 1.5 * k) < 0.22
    strokes = ink & ~solid
    values = screen.value_map(lightness, ink, k)
    plan = screen.tone_plan(values, k, 0.80, 0.55, 0.30)
    coverage = np.take(np.float32((0, 0.18, 0.42, 1)), plan)
    # Same default gradation as MangaFinish, but retain coverage for the editor's paper-aligned tone.
    smooth = cv2.GaussianBlur(values, (0, 0), 3 * k)
    mix = cv2.GaussianBlur(np.clip((screen.region_spread(plan, smooth) - 0.03) / 0.05, 0, 1), (0, 0), 4 * k)
    coverage = coverage * (1 - mix) + np.clip((0.80 - smooth) / 0.50, 0, 1) * mix
    beta = cv2.erode((plan == 3).astype(np.uint8), np.ones((int(3 * k) | 1,) * 2, np.uint8)).astype(bool)
    cuts = beta & screen.white_cut(strokes, k)
    fill = (ink & solid) | beta | (coverage >= 1)

    # Keep opaque whites and transparent holes. Steepen the soft fringe around its midpoint,
    # retaining more of a detected ink edge than of unmarked white paper.
    ramp = np.clip((alpha.astype(np.float32) / 255 - np.where(ink, 0.18, 0.30)) / 0.46, 0, 1)
    silhouette = np.rint(255 * ramp * ramp * (3 - 2 * ramp)).astype(np.uint8)
    encode_layer(layers, "white", 255, silhouette)
    tone_gray = np.rint(255 * (1 - coverage)).astype(np.uint8)
    encode_layer(layers, "shade", tone_gray, silhouette * ((tone_gray < 255) & ~fill & ~strokes))
    encode_layer(layers, "black", 0, silhouette * fill)
    encode_layer(layers, "line", cuts.astype(np.uint8) * 255, silhouette * (strokes | cuts))
    return result


if __name__ == "__main__":
    try:
        result = finish_raster(json.load(sys.stdin), load_mangascreen(sys.argv[1]))
        json.dump(result, sys.stdout)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
