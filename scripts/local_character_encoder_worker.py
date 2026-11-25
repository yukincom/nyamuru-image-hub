#!/usr/bin/env python3
"""Short-lived offline worker for M1+M2 shared character vision encoder."""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from character_vision_encoder import (
    embed_character_image,
    match_character_embeddings,
    predict_figure_view_and_size,
    recommend_reference_view,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("match", "recommend-view"), required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--model", type=Path)
    return parser.parse_args()


def _decode_b64_image(value: str) -> bytes:
    if value.startswith("data:image/") and "," in value:
        value = value.split(",", 1)[1]
    return base64.b64decode(value, validate=True)


def run_match(image_bytes: bytes, request: dict[str, Any], model_path: Path | None) -> dict[str, Any]:
    query = embed_character_image(image_bytes, model_path=model_path)
    reference_embeddings: list[dict[str, Any]] = []
    for candidate in request.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        cid = str(candidate.get("id") or "").strip()
        if not cid:
            continue
        for raw_img in candidate.get("reference_images") or []:
            if not isinstance(raw_img, str) or not raw_img:
                continue
            ref_emb = embed_character_image(_decode_b64_image(raw_img), model_path=model_path)["embedding"]
            reference_embeddings.append({"id": cid, "embedding": ref_emb})
    match = match_character_embeddings(query["embedding"], reference_embeddings)
    view_info = predict_figure_view_and_size(
        image_bytes, current_size=str(request.get("current_size") or "bust-up"), model_path=model_path,
    )
    return {
        **match,
        "recommended_view": view_info["recommended_view"],
        "suggested_size": view_info["suggested_size"],
        "runtime": query["runtime"],
        "model": query["model"],
    }


def main() -> int:
    args = parse_args()
    try:
        raw_request = sys.stdin.read().strip()
        request = json.loads(raw_request) if raw_request else {}
        image_bytes = args.image.read_bytes()
        model_path = args.model if args.model and args.model.is_file() else None
        if args.mode == "match":
            result = run_match(image_bytes, request, model_path)
        else:
            result = recommend_reference_view(
                image_bytes,
                request.get("available_assets") or [],
                current_size=str(request.get("current_size") or "bust-up"),
                model_path=model_path,
            )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
