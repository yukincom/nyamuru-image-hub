#!/usr/bin/env python3
"""One-shot workers for the optional local manga detectors."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--engine",
        choices=("page-detector", "text-ocr", "expression-tagger", "rtdetr", "baberu", "wd-expression"),
        required=True,
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--confidence", type=float, default=0.2)
    return parser.parse_args()


# 旧->新: 旧=run_rtdetr/load_baberu/run_baberu(モデル名固定) -> 新=detect_page_elements/load_text_ocr_engine/recognize_page_text_regions(機能名)＋M4個人筆跡OCR優先読込・shape_hint引継
def detect_page_elements(root: Path, image: Path, model: Path | None, confidence: float) -> dict[str, Any]:
    from rtdetr_onnx import detect_manga_page_elements

    model_path = model or root / "models" / "rtdetrv4-x-manga109s_v2" / "model.onnx"
    return detect_manga_page_elements(image, model_path=model_path, conf_threshold=confidence)


def load_text_ocr_engine(model_dir: Path):
    module_path = model_dir / "onnx_infer.py"
    spec = importlib.util.spec_from_file_location("nyamuru_baberu", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"OCRエンジンを読み込めません: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BaberuOnnxOCR(
        model_dir / "onnx",
        model_dir / "tokenizer",
        vision="vision_int4.onnx",
    )


def recognize_page_text_regions(root: Path, image: Path, regions: list[dict[str, Any]], model: Path | None) -> dict[str, Any]:
    """Recognize each detected text region without changing its placement box."""

    from PIL import Image, ImageOps

    model_dir = (model or root / "models" / "baberu-ocr").resolve()
    engine = load_text_ocr_engine(model_dir)
    with Image.open(image) as opened:
        page = ImageOps.exif_transpose(opened).convert("RGB")
    lines: list[dict[str, Any]] = []
    for index, region in enumerate(regions[:32]):
        bbox = region.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            x1, y1, x2, y2 = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        left = max(0, min(page.width, round(min(x1, x2))))
        top = max(0, min(page.height, round(min(y1, y2))))
        right = max(0, min(page.width, round(max(x1, x2))))
        bottom = max(0, min(page.height, round(max(y1, y2))))
        if right <= left or bottom <= top:
            continue
        # 認識だけ少し余白を持たせ、配置bboxは検出器の領域をそのまま維持する。
        pad_x = max(2, round((right - left) * 0.04))
        pad_y = max(2, round((bottom - top) * 0.04))
        crop = page.crop((
            max(0, left - pad_x),
            max(0, top - pad_y),
            min(page.width, right + pad_x),
            min(page.height, bottom + pad_y),
        ))
        text = str(engine(crop)).strip()
        region_id = str(region.get("id", index))
        line_entry: dict[str, Any] = {
            "id": f"rtdetr-{region_id}",
            "text": text,
            "bbox": [left, top, right - left, bottom - top],
            "confidence": float(region.get("score", 0.0) or 0.0),
            "vertical": (bottom - top) > (right - left),
            "detection_source": "rtdetr-text",
            "group_id": f"rtdetr-text-{region_id}",
            "unreadable": not bool(text),
        }
        shape_hint = region.get("bubble_shape_hint")
        if isinstance(shape_hint, str) and shape_hint.strip():
            line_entry["bubble_shape_hint"] = shape_hint.strip()
        lines.append(line_entry)
    return {
        "engine": "Baberu OCR",
        "width": page.width,
        "height": page.height,
        "region_lines": lines,
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
        if args.engine in ("page-detector", "rtdetr"):
            result = detect_page_elements(args.root.resolve(), args.image.resolve(), args.model, args.confidence)
        elif args.engine in ("text-ocr", "baberu"):
            regions = request.get("regions") if isinstance(request.get("regions"), list) else []
            result = recognize_page_text_regions(args.root.resolve(), args.image.resolve(), regions, args.model)
        elif args.engine in ("expression-tagger", "wd-expression"):
            from local_wd_expression_tagger import WdExpressionTagger

            if args.model is None:
                raise ValueError("WDのモデルが指定されていません")
            tagger = WdExpressionTagger(
                args.model, Path(request["tags_path"]), threshold=float(request["threshold"]),
            )
            result = tagger.analyze(args.image.read_bytes())
        else:
            raise ValueError(f"未対応の解析エンジンです: {args.engine}")
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
