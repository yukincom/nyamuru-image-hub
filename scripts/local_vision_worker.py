#!/usr/bin/env python3
"""One-shot workers for optional local manga detectors.

The parent bridge intentionally launches these workers with each project's own
Python environment.  This keeps ComfyUI, manga-babble-maker, and NDLOCR-Lite
dependencies isolated from one another.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=("rtdetr", "ndlocr"), required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--confidence", type=float, default=0.2)
    return parser.parse_args()


def run_rtdetr(root: Path, image: Path, model: Path | None, confidence: float) -> dict[str, Any]:
    sys.path.insert(0, str(root))
    from manga_babble.detect.rtdetr_onnx import detect_page

    model_path = model or root / "models" / "rtdetrv4-x-manga109s_v2" / "model.onnx"
    return detect_page(image, model_path=model_path, conf_threshold=confidence)


def text_quality(text: str) -> float:
    compact = "".join(text.split())
    if not compact:
        return 0.0
    japanese = sum(
        "\u3040" <= char <= "\u30ff" or "\u3400" <= char <= "\u9fff"
        for char in compact
    )
    latin = sum(char.isascii() and char.isalpha() for char in compact)
    repeated = max((compact.count(char) for char in set(compact)), default=0)
    repetition_penalty = max(0, repeated - max(4, len(compact) // 2))
    return japanese * 2.0 + min(len(compact), 24) * 0.08 - latin * 0.6 - repetition_penalty


def direct_region_lines(image_array, regions: list[dict[str, Any]], recognizers) -> list[dict[str, Any]]:
    height, width = image_array.shape[:2]
    lines: list[dict[str, Any]] = []
    for index, region in enumerate(regions[:32]):
        bbox = region.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            x1, y1, x2, y2 = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        margin_x = max(2, round((x2 - x1) * 0.06))
        margin_y = max(2, round((y2 - y1) * 0.04))
        left = max(0, round(x1) - margin_x)
        top = max(0, round(y1) - margin_y)
        right = min(width, round(x2) + margin_x)
        bottom = min(height, round(y2) + margin_y)
        crop = image_array[top:bottom, left:right]
        if crop.size == 0:
            continue
        options = [recognizer.read(crop) for recognizer in recognizers]
        best = max(options, key=text_quality, default="").strip()
        if not best:
            continue
        lines.append(
            {
                "id": f"rtdetr-{index}",
                "text": best,
                "bbox": [left, top, right - left, bottom - top],
                "confidence": float(region.get("score", 0.0) or 0.0),
                "vertical": (bottom - top) > (right - left),
                "detection_source": "rtdetr-text",
                "alternatives": options,
            }
        )
    return lines


def run_ndlocr(root: Path, image: Path, regions: list[dict[str, Any]]) -> dict[str, Any]:
    import numpy as np
    from PIL import Image, ImageOps

    source_root = root / "src"
    sys.path.insert(0, str(source_root))
    import ocr

    model_root = source_root / "model"
    config_root = source_root / "config"
    options = SimpleNamespace(
        det_weights=str(model_root / "deim-s-1024x1024.onnx"),
        det_classes=str(config_root / "ndl.yaml"),
        det_score_threshold=0.2,
        det_conf_threshold=0.25,
        det_iou_threshold=0.2,
        rec_weights30=str(model_root / "parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx"),
        rec_weights50=str(model_root / "parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx"),
        rec_weights=str(model_root / "parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx"),
        rec_classes=str(config_root / "NDLmoji.yaml"),
        device="cpu",
        enable_tcy=False,
    )
    detector = ocr.get_detector(options)
    recognizer30 = ocr.get_recognizer(options, options.rec_weights30)
    recognizer50 = ocr.get_recognizer(options, options.rec_weights50)
    recognizer100 = ocr.get_recognizer(options, options.rec_weights)
    recognizers = (recognizer30, recognizer50, recognizer100)
    image_array = np.asarray(ImageOps.exif_transpose(Image.open(image)).convert("RGB"))
    result = ocr._run_ocr_on_image_array(
        detector=detector,
        recognizer30=recognizer30,
        recognizer50=recognizer50,
        recognizer100=recognizer100,
        inputname=image.name,
        img=image_array,
        outputpath="/tmp",
        save_viz=False,
    )
    detected_lines: list[dict[str, Any]] = []
    for index, line in enumerate(result.get("text_layer_lines", [])):
        json_line = result.get("json_lines", [])[index] if index < len(result.get("json_lines", [])) else {}
        detected_lines.append(
            {
                "id": f"ndl-{index}",
                "text": str(line.get("text", "")).strip(),
                "bbox": [
                    int(line.get("x", 0)),
                    int(line.get("y", 0)),
                    int(line.get("width", 0)),
                    int(line.get("height", 0)),
                ],
                "confidence": float(json_line.get("confidence", 0.0) or 0.0),
                "vertical": bool(line.get("is_vertical", False)),
                "detection_source": "ndlocr",
            }
        )
    return {
        "engine": "NDLOCR-Lite",
        "width": int(result.get("img_width", image_array.shape[1])),
        "height": int(result.get("img_height", image_array.shape[0])),
        "detected_lines": detected_lines,
        "region_lines": direct_region_lines(image_array, regions, recognizers),
    }


def main() -> int:
    args = parse_args()
    request: dict[str, Any] = {}
    try:
        raw_request = sys.stdin.read().strip()
        if raw_request:
            value = json.loads(raw_request)
            if isinstance(value, dict):
                request = value
        if args.engine == "rtdetr":
            result = run_rtdetr(args.root.resolve(), args.image.resolve(), args.model, args.confidence)
        else:
            regions = request.get("regions") if isinstance(request.get("regions"), list) else []
            result = run_ndlocr(args.root.resolve(), args.image.resolve(), regions)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
