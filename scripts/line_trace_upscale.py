"""Preprocess and upscale raster manga images (data URL) using IllustrationJaNai V3denoise SPAN_S
without changing logical canvas placement (`bbox`).

Modes:
  - `ai2x`: 2x IllustrationJaNai V3denoise SPAN_S (fp16 ONNX, CoreML/CPU) with tiled inference
    and automatic fallback to `lanczos2x` if the model or onnxruntime is unavailable.
  - `ai4x`: 2x IllustrationJaNai V3denoise SPAN_S followed by high-quality Lanczos resize up to 4x (`maxEdge`).
  - `lanczos2x`: 2x Lanczos resampling (no AI).
  - `none`: pass-through.

Optional raster-to-raster fields:
  - `preserveAlpha` (bool, default False): preserve transparency via neighbor RGB color bleeding before inference
    and upscaling the alpha mask identically.
  - `outputMode` ("color" | "monochrome", default "color"):
      * "color": returns color/grayscale RGB or RGBA PNG.
      * "monochrome": binarizes luminance with `threshold` to pure black `(0,0,0)` ink on white (or transparent).
  - `threshold` (int, 1..254, default 180): luminance threshold for `monochrome` output.

Reads JSON from stdin: `{ "image": "data:image/png;base64,...", "mode": "ai2x", "maxEdge": 4096, ... }`
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


def decode_data_url_rgba(data_url: str) -> tuple[Image.Image, bool]:
    if "," in data_url:
        _, b64 = data_url.split(",", 1)
    else:
        b64 = data_url
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        alpha_min, _ = rgba.getchannel("A").getextrema()
        if alpha_min < 255:
            return rgba, True
        return rgba.convert("RGB"), False
    return img.convert("RGB"), False


def decode_data_url(data_url: str) -> Image.Image:
    img, has_alpha = decode_data_url_rgba(data_url)
    if has_alpha:
        white = Image.new("RGBA", img.size, (255, 255, 255, 255))
        white.alpha_composite(img)
        return white.convert("RGB")
    return img.convert("RGB")


def composite_on_white(img: Image.Image) -> Image.Image:
    if img.mode == "RGB":
        return img
    rgba = img.convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    white.alpha_composite(rgba)
    return white.convert("RGB")


def bleed_rgb_into_transparent(rgba: Image.Image, iterations: int = 8) -> Image.Image:
    """Propagate neighbor RGB colors into transparent pixels to prevent black/white fringes after AI upscaling."""
    arr = np.asarray(rgba.convert("RGBA"), dtype=np.float32)
    valid = arr[:, :, 3] > 16
    if not np.any(valid):
        return Image.new("RGB", rgba.size, (255, 255, 255))
    if np.all(valid):
        return rgba.convert("RGB")

    rgb = arr[:, :, :3].copy()
    for _ in range(iterations):
        inv = ~valid
        if not np.any(inv):
            break
        sum_rgb = np.zeros_like(rgb)
        cnt = np.zeros(valid.shape, dtype=np.float32)

        v_up = valid[:-1, :]
        sum_rgb[1:, :] += np.where(v_up[..., None], rgb[:-1, :], 0.0)
        cnt[1:, :] += v_up

        v_dn = valid[1:, :]
        sum_rgb[:-1, :] += np.where(v_dn[..., None], rgb[1:, :], 0.0)
        cnt[:-1, :] += v_dn

        v_lt = valid[:, :-1]
        sum_rgb[:, 1:] += np.where(v_lt[..., None], rgb[:, :-1], 0.0)
        cnt[:, 1:] += v_lt

        v_rt = valid[:, 1:]
        sum_rgb[:, :-1] += np.where(v_rt[..., None], rgb[:, 1:], 0.0)
        cnt[:, :-1] += v_rt

        fill = inv & (cnt > 0)
        if not np.any(fill):
            break
        rgb[fill] = sum_rgb[fill] / cnt[fill, None]
        valid[fill] = True

    if not np.all(valid):
        rgb[~valid] = 255.0
    return Image.fromarray(np.clip(rgb + 0.5, 0.0, 255.0).astype(np.uint8), mode="RGB")


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


def create_onnx_session(model_path: Path):
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
    return sess, inp_name, dtype


def upscale_onnx_2x(img: Image.Image, model_path: Path, tile: int = 384, overlap: int = 16, session_info=None) -> Image.Image:
    if session_info is None:
        sess, inp_name, dtype = create_onnx_session(model_path)
    else:
        sess, inp_name, dtype = session_info

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


def upscale_rgb(img: Image.Image, mode: str, max_edge: int, model_path: Path | None, session_info=None) -> tuple[Image.Image, str, object]:
    w, h = img.size
    out_img = None
    mode_used = mode
    if mode in ("ai2x", "ai4x"):
        if model_path is not None:
            try:
                if session_info is None:
                    session_info = create_onnx_session(model_path)
                out_img = upscale_onnx_2x(img, model_path, session_info=session_info)
            except Exception:
                out_img = None
                session_info = None
        if out_img is None:
            mode_used = "lanczos2x"
        elif mode == "ai4x":
            ow, oh = out_img.size
            target_w = min(max_edge, ow * 2)
            target_h = min(max_edge, oh * 2)
            scale_fit = min(target_w / ow, target_h / oh)
            if scale_fit > 1.01:
                out_img = out_img.resize(
                    (max(1, round(ow * scale_fit)), max(1, round(oh * scale_fit))),
                    Image.Resampling.LANCZOS,
                )

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

    return out_img, mode_used, session_info


def main() -> None:
    vision_root = sys.argv[1] if len(sys.argv) > 1 else ".local-vision"
    req = json.loads(sys.stdin.read())
    image_url = req.get("image", "")
    mode = str(req.get("mode", "none") or "none")
    max_edge = int(req.get("maxEdge", 4096) or 4096)
    preserve_alpha = bool(req.get("preserveAlpha", False))
    output_mode = "monochrome" if req.get("outputMode") == "monochrome" else "color"
    threshold = max(1, min(254, int(req.get("threshold", 180) or 180)))

    if not image_url or (mode == "none" and output_mode == "color"):
        sys.stdout.write(json.dumps({"image": image_url, "modeUsed": "none", "scale": 1}))
        return

    decoded, has_alpha = decode_data_url_rgba(image_url)
    w, h = decoded.size
    long_edge = max(w, h)
    keep_alpha = preserve_alpha and has_alpha

    # Cap output so huge pages don't blow up memory or runtime
    if (mode == "none" or long_edge >= max_edge) and output_mode == "color":
        sys.stdout.write(
            json.dumps({"image": image_url, "modeUsed": "none", "scale": 1, "width": w, "height": h})
        )
        return

    model_path = resolve_model_path(vision_root) if mode in ("ai2x", "ai4x") else None
    should_upscale = mode != "none" and long_edge < max_edge

    if output_mode == "monochrome":
        base_rgb = composite_on_white(decoded)
        if should_upscale:
            upscaled_rgb, mode_used, _ = upscale_rgb(base_rgb, mode, max_edge, model_path)
        else:
            upscaled_rgb, mode_used = base_rgb, "none"
        gray = np.asarray(upscaled_rgb.convert("L"), dtype=np.uint8)
        ink = gray < threshold
        ow, oh = upscaled_rgb.size
        if keep_alpha:
            out_rgba = np.zeros((oh, ow, 4), dtype=np.uint8)
            out_rgba[ink, 3] = 255
            out_img = Image.fromarray(out_rgba, mode="RGBA")
        else:
            out_rgb = np.full((oh, ow, 3), 255, dtype=np.uint8)
            out_rgb[ink] = 0
            out_img = Image.fromarray(out_rgb, mode="RGB")
    elif keep_alpha:
        bled_rgb = bleed_rgb_into_transparent(decoded)
        alpha_ch = decoded.getchannel("A")
        alpha_rgb = Image.merge("RGB", (alpha_ch, alpha_ch, alpha_ch))
        out_rgb, mode_used, session_info = upscale_rgb(bled_rgb, mode, max_edge, model_path)
        alpha_mode = mode if mode_used != "lanczos2x" else "lanczos2x"
        out_alpha_rgb, _, _ = upscale_rgb(alpha_rgb, alpha_mode, max_edge, model_path, session_info=session_info)
        if out_alpha_rgb.size != out_rgb.size:
            out_alpha_rgb = out_alpha_rgb.resize(out_rgb.size, Image.Resampling.LANCZOS)
        out_img = out_rgb.convert("RGBA")
        out_img.putalpha(out_alpha_rgb.convert("L"))
    else:
        base_rgb = composite_on_white(decoded)
        out_img, mode_used, _ = upscale_rgb(base_rgb, mode, max_edge, model_path)

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
