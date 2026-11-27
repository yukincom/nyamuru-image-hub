"""Preprocess a raster image (data URL) for vector line tracing at higher internal density
without changing its logical canvas placement (`bbox`).

Modes:
  - `ai2x`: 2x IllustrationJaNai V3denoise SPAN_S (fp16 ONNX, CoreML/CPU) with tiled inference
    and automatic fallback to `lanczos2x` if the model or onnxruntime is unavailable.
  - `lanczos2x`: 2x Lanczos resampling (no AI).
  - `none`: pass-through.

Reads JSON from stdin: `{ "image": "data:image/png;base64,...", "mode": "ai2x", "maxEdge": 4096 }`
Writes JSON to stdout: `{ "image": "data:image/png;base64,...", "modeUsed": "...", "scale": 2, "width": W, "height": H }`
"""

import base64
import io
import json
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image

MODEL_REL_PATH = Path("models/janai-v3-span/2x_IllustrationJaNai_V3denoise_SPAN_S_30k_fp16_1x3xHxW_dyn-HW_strong_fp16_op23.onnx")


def decode_data_url(data_url: str) -> Image.Image:
    if "," in data_url:
        _, b64 = data_url.split(",", 1)
    else:
        b64 = data_url
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        white.alpha_composite(rgba)
        return white.convert("RGB")
    return img.convert("RGB")


def encode_png_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def resolve_model_path(vision_root: str) -> Path | None:
    env_override = os.environ.get("NYAMURU_LINE_TRACE_UPSCALE_MODEL")
    if env_override:
        p = Path(env_override)
        if p.is_file():
            return p
    candidate = Path(vision_root) / MODEL_REL_PATH
    if candidate.is_file():
        return candidate
    return None


def upscale_onnx_2x(img: Image.Image, model_path: Path, tile: int = 384, overlap: int = 16) -> Image.Image:
    import onnxruntime as ort

    sess_opts = ort.SessionOptions()
    sess_opts.log_severity_level = 3
    sess = ort.InferenceSession(
        str(model_path),
        sess_options=sess_opts,
        providers=["CoreMLExecutionProvider", "CPUExecutionProvider"],
    )
    inp = sess.get_inputs()[0]
    inp_name = inp.name
    dtype = np.float16 if "float16" in inp.type else np.float32

    arr = np.asarray(img, dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    scale = 2

    if w * h <= 512 * 512:
        x = np.transpose(arr, (2, 0, 1))[None, ...].astype(dtype)
        y = sess.run(None, {inp_name: x})[0][0].astype(np.float32)
        out_arr = (np.transpose(np.clip(y, 0.0, 1.0), (1, 2, 0)) * 255.0 + 0.5).astype(np.uint8)
        return Image.fromarray(out_arr, mode="RGB")

    out_arr = np.zeros((h * scale, w * scale, 3), dtype=np.uint8)
    for ty in range(0, h, tile):
        for tx in range(0, w, tile):
            y0 = max(0, ty - overlap)
            x0 = max(0, tx - overlap)
            y1 = min(h, ty + tile + overlap)
            x1 = min(w, tx + tile + overlap)
            patch = np.transpose(arr[y0:y1, x0:x1, :], (2, 0, 1))[None, ...].astype(dtype)
            pred = np.clip(sess.run(None, {inp_name: patch})[0][0].astype(np.float32), 0.0, 1.0)
            pred_u8 = (np.transpose(pred, (1, 2, 0)) * 255.0 + 0.5).astype(np.uint8)
            oy0 = (ty - y0) * scale
            ox0 = (tx - x0) * scale
            oh = min(tile, h - ty) * scale
            ow = min(tile, w - tx) * scale
            out_arr[ty * scale : ty * scale + oh, tx * scale : tx * scale + ow] = pred_u8[
                oy0 : oy0 + oh, ox0 : ox0 + ow
            ]
    return Image.fromarray(out_arr, mode="RGB")


def main() -> None:
    vision_root = sys.argv[1] if len(sys.argv) > 1 else ".local-vision"
    req = json.loads(sys.stdin.read())
    image_url = req.get("image", "")
    mode = str(req.get("mode", "none") or "none")
    max_edge = int(req.get("maxEdge", 4096) or 4096)

    if not image_url or mode == "none":
        sys.stdout.write(json.dumps({"image": image_url, "modeUsed": "none", "scale": 1}))
        return

    img = decode_data_url(image_url)
    w, h = img.size
    long_edge = max(w, h)

    # Cap output so huge pages don't blow up memory or runtime
    if long_edge >= max_edge:
        sys.stdout.write(
            json.dumps({"image": image_url, "modeUsed": "none", "scale": 1, "width": w, "height": h})
        )
        return

    out_img = None
    mode_used = mode
    if mode == "ai2x":
        model_path = resolve_model_path(vision_root)
        if model_path is not None:
            try:
                out_img = upscale_onnx_2x(img, model_path)
            except Exception:
                out_img = None
        if out_img is None:
            mode_used = "lanczos2x"

    if out_img is None:
        target_w = min(max_edge, w * 2)
        target_h = min(max_edge, h * 2)
        scale_fit = min(target_w / w, target_h / h)
        out_img = img.resize(
            (max(1, round(w * scale_fit)), max(1, round(h * scale_fit))),
            Image.Resampling.LANCZOS,
        )
    elif max(out_img.size) > max_edge:
        ow, oh = out_img.size
        s = max_edge / max(ow, oh)
        out_img = out_img.resize((max(1, round(ow * s)), max(1, round(oh * s))), Image.Resampling.LANCZOS)

    ow, oh = out_img.size
    sys.stdout.write(
        json.dumps(
            {
                "image": encode_png_data_url(out_img),
                "modeUsed": mode_used,
                "scale": round(ow / max(w, 1), 3),
                "width": ow,
                "height": oh,
            }
        )
    )


if __name__ == "__main__":
    main()
