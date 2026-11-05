#!/usr/bin/env python3
"""Extract character design features from whole reference sheets with the configured local MLX VLM.

アナログネームとは異なるパイプライン、一枚のイラストからデザインを抽出する。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from character_reference_descriptions import (
    PROMPT_VERSION,
    FIELDS,
    REFERENCE_VIEWS,
    IDENTITY_GUARD,
    GENERIC_TRAIT,
    prompt_text,
    reference_set_prompt_text,
    normalize_reference_view,
    extract_json_object,
    sanitized_trait_text,
    normalized_strings,
    normalized_evidence,
    normalize_analysis,
    normalize_reference_set_analysis,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, action="append", required=True)
    parser.add_argument("--max-tokens", type=int, default=1200)
    return parser.parse_args()


def prepare_whole_reference_image(source: Path, maximum: tuple[int, int] = (1600, 1600)) -> tuple[Path, int, int]:
    """アナログネームとは異なるパイプライン、一枚のイラスト全体（無切り抜き）をVLM入力用に整形する。"""
    from PIL import Image, ImageOps

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        width, height = image.size
        if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
            rgba = image.convert("RGBA")
            paper = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            image = Image.alpha_composite(paper, rgba).convert("RGB")
        else:
            image = image.convert("RGB")
        prepared = image.copy()

    prepared.thumbnail(maximum)
    temporary = tempfile.NamedTemporaryFile(prefix="nyamuru-character-reference-sheet-", suffix=".jpg", delete=False)
    temporary.close()
    target = Path(temporary.name)
    prepared.save(target, format="JPEG", quality=92, optimize=True)
    return target, width, height


def analyze(
    model_path: Path,
    image_path: Path,
    target_character: str,
    max_tokens: int,
) -> dict[str, Any]:
    """アナログネームとは異なるパイプライン、一枚のイラストからデザインを抽出する。"""
    if not model_path.is_dir() or not (model_path / "config.json").is_file():
        raise FileNotFoundError("ローカルVLMモデルが見つかりません")
    if not image_path.is_file():
        raise FileNotFoundError("解析対象の画像が見つかりません")

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    prepared_path: Path | None = None
    try:
        prepared_path, width, height = prepare_whole_reference_image(image_path)
        model, processor = load(str(model_path))
        prompt = apply_chat_template(
            processor,
            model.config,
            prompt_text(target_character),
            num_images=1,
        )
        response = generate(
            model,
            processor,
            prompt,
            image=[str(prepared_path)],
            max_tokens=max(512, min(max_tokens, 1200)),
            temp=0.0,
            repetition_penalty=1.05,
            verbose=False,
        )
        raw_object = extract_json_object(response.text)
        analysis = normalize_analysis(raw_object)
        reference_view = normalize_reference_view(raw_object)
        return {
            **analysis,
            "reference_view": reference_view,
            "image": {"width_px": width, "height_px": height},
            "analysis_views": ["設定画全体（一枚のイラストから全デザイン特徴を抽出）"],
            "prompt_version": PROMPT_VERSION,
        }
    finally:
        if prepared_path is not None:
            prepared_path.unlink(missing_ok=True)


def analyze_reference_set(
    model_path: Path,
    image_paths: list[Path],
    target_character: str,
    max_tokens: int,
) -> dict[str, Any]:
    """アナログネームとは異なるパイプライン、複数枚のイラスト全体からデザインを抽出する。"""
    if not model_path.is_dir() or not (model_path / "config.json").is_file():
        raise FileNotFoundError("ローカルVLMモデルが見つかりません")
    if not 2 <= len(image_paths) <= 12 or any(not path.is_file() for path in image_paths):
        raise ValueError("一括解析する人物資料画像は2〜12枚にしてください")

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    prepared_paths: list[Path] = []
    try:
        for path in image_paths:
            prepared, _, _ = prepare_whole_reference_image(path)
            prepared_paths.append(prepared)
        model, processor = load(str(model_path))
        prompt = apply_chat_template(
            processor,
            model.config,
            reference_set_prompt_text(len(prepared_paths), target_character),
            num_images=len(prepared_paths),
        )
        response = generate(
            model,
            processor,
            prompt,
            image=[str(path) for path in prepared_paths],
            max_tokens=max(640, min(max_tokens, 1200)),
            temp=0.0,
            repetition_penalty=1.05,
            verbose=False,
        )
        analysis = normalize_reference_set_analysis(
            extract_json_object(response.text),
            len(image_paths),
        )
        return {
            **analysis,
            "image_count": len(image_paths),
            "analysis_passes": ["whole_sheet"],
            "prompt_version": PROMPT_VERSION,
        }
    finally:
        for prepared_path in prepared_paths:
            prepared_path.unlink(missing_ok=True)


def single_analysis_as_set(result: dict[str, Any]) -> dict[str, Any]:
    recognition = normalize_analysis(result)["recognition"]
    statistics = {
        field: [{
            "trait": trait,
            "image_indexes": [1],
            "image_count": 1,
            "complementary_view_only": False,
        } for trait in recognition[field]["observed"]]
        for field in FIELDS if field != "ambiguous_design"
    }
    return {
        **result,
        "recognition": recognition,
        "reference_views": [normalize_reference_view(result)],
        "reference_view_confidences": ["high" if normalize_reference_view(result) != "other" else "low"],
        "trait_statistics": statistics,
        "image_count": 1,
    }


def main() -> int:
    args = parse_args()
    try:
        request = json.loads(sys.stdin.read() or "{}")
        target_character = request.get("target_character", "")
        if not isinstance(target_character, str):
            target_character = ""
        image_paths = [path.resolve() for path in args.image]
        if len(image_paths) == 1:
            result = analyze(
                args.model.resolve(),
                image_paths[0],
                target_character.strip()[:100],
                args.max_tokens,
            )
            if request.get("set_analysis") is True:
                result = single_analysis_as_set(result)
        else:
            result = analyze_reference_set(
                args.model.resolve(),
                image_paths,
                target_character.strip()[:100],
                args.max_tokens,
            )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
