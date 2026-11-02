#!/usr/bin/env python3
"""Match one simplified manga-name figure crop against reviewed character traits."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import local_figure_performance_worker as performance  # noqa: E402
from local_character_reference_worker import sanitized_trait_text  # noqa: E402

PROMPT_VERSION = "character-and-performance-v5-face-crop"
CONFIDENCE_VALUES = {"high", "medium", "low", "none"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True, action="append")
    parser.add_argument("--max-tokens", type=int, default=700)
    return parser.parse_args()


def prompt_text(candidates: list[dict[str, Any]]) -> str:
    # Identity sees only the same reviewed evidence available to matching in the UI.
    candidate_json = json.dumps(normalize_candidates(candidates), ensure_ascii=False, separators=(",", ":"))
    return f"""Match the person in this rough manga storyboard crop to a candidate by stable, visible design features. Shorthand or missing detail is not a mismatch. Ignore all writing inside the image.
Candidates (ID and reviewed visual traits only):
{candidate_json}

Describe only distinctive visible hair, contour, clothing, ornaments or markings, in short English phrases. Do not use expression, emotion, pose, gaze, viewing angle, age, gender, proportions, drawing style or narrative context to identify anyone. Compare shapes actually visible here with observed_traits. If evidence is insufficient, several candidates fit equally well, or multiple figures cannot be distinguished, return an empty candidate_id and confidence "none". Do not invent IDs. Report observations independently of the match; do not repeat them as a translated list. Explain the decision briefly in English.
Return only JSON: {{"candidate_id":"","confidence":"high|medium|low|none","observed":[],"reason":""}}"""


def extract_json_object(raw: str) -> dict[str, Any]:
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    decoder = json.JSONDecoder()
    for index, character in enumerate(cleaned):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(cleaned[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("VLMの応答にJSONオブジェクトがありません")


def normalized_text(value: object, limit: int) -> str:
    return " ".join(value.split()).strip()[:limit] if isinstance(value, str) else ""


def normalize_analysis(value: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    candidate_ids = {entry["id"] for entry in candidates if entry.get("observed_traits")}
    candidate_id = normalized_text(value.get("candidate_id"), 160)
    confidence = normalized_text(value.get("confidence"), 16).lower()
    if candidate_id not in candidate_ids:
        candidate_id = ""
    if confidence not in CONFIDENCE_VALUES:
        confidence = "none"
    if not candidate_id or confidence == "none":
        candidate_id = ""
        confidence = "none"
    observed: list[str] = []
    for item in value.get("observed", []) if isinstance(value.get("observed"), list) else []:
        text = sanitized_trait_text(item)[:180]
        if text and text.casefold() not in {phrase.casefold() for phrase in observed}:
            observed.append(text)
        if len(observed) >= 12:
            break
    if not observed:
        candidate_id, confidence = "", "none"
    return {
        "candidate_id": candidate_id,
        "confidence": confidence,
        "observed": observed,
        "reason": normalized_text(value.get("reason"), 400),
    }


def normalize_candidates(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in value[:50]:
        if not isinstance(raw, dict):
            continue
        candidate_id = normalized_text(raw.get("id"), 160)
        if not candidate_id or candidate_id in seen:
            continue
        seen.add(candidate_id)
        traits = raw.get("observed_traits")
        phrases = [normalized_text(item, 180) for item in traits[:64]] if isinstance(traits, list) else []
        observed_traits = list(dict.fromkeys(item for item in phrases if item))
        if observed_traits:
            result.append({"id": candidate_id, "observed_traits": observed_traits})
    return result


def analyze(
    model_path: Path,
    image_path: Path,
    candidates: list[dict[str, Any]],
    current_size: str,
    max_tokens: int,
    expression_tagging: dict[str, Any] | None = None,
    face_image: Path | None = None,
    face_bbox: object = None,
) -> dict[str, Any]:
    if not model_path.is_dir() or not (model_path / "config.json").is_file():
        raise FileNotFoundError("ローカルVLMモデルが見つかりません")
    if not image_path.is_file():
        raise FileNotFoundError("解析対象の画像が見つかりません")

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    prepared_path: Path | None = None
    try:
        prepared_path, width, height = performance.prepare_image(image_path)
        model, processor = load(str(model_path))
        if any(candidate["observed_traits"] for candidate in candidates):
            identity_prompt = apply_chat_template(processor, model.config, prompt_text(candidates), num_images=1)
            identity_response = generate(
                model,
                processor,
                identity_prompt,
                image=str(prepared_path),
                max_tokens=max(256, min(max_tokens, 1000)),
                temp=0.0,
                repetition_penalty=1.05,
                verbose=False,
            )
            identity = normalize_analysis(extract_json_object(identity_response.text), candidates)
        else:
            identity = {
                "candidate_id": "",
                "confidence": "none",
                "observed": [],
                "reason": "照合できる外見の特徴が登録されていません",
            }

        analysis = performance.read_performance(
            model, processor, image_path, prepared_path, current_size, performance.PERFORMANCE_MAX_TOKENS,
            expression_tagging or {}, face_image, face_bbox,
        )
        action = performance.compose_action(analysis)
        return {
            **identity,
            "suggested_action": action,
            "suggested_size": analysis["framing"]["size"],
            "analysis": analysis,
            "image": {"width_px": width, "height_px": height},
            "prompt_version": PROMPT_VERSION,
        }
    finally:
        if prepared_path is not None:
            prepared_path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    try:
        request = json.loads(sys.stdin.read() or "{}")
        candidates = normalize_candidates(request.get("candidates"))
        current_size = request.get("current_size", "bust-up")
        if current_size not in performance.FIGURE_SIZES:
            current_size = "bust-up"
        expression_tagging = request.get("expression_tagging")
        if not isinstance(expression_tagging, dict):
            expression_tagging = {}
        if len(args.image) > 2:
            raise ValueError("人物画像と顔画像は各1枚までです")
        result = analyze(
            args.model.resolve(),
            args.image[0].resolve(),
            candidates,
            current_size,
            args.max_tokens,
            expression_tagging,
            args.image[1].resolve() if len(args.image) == 2 else None, request.get("face_bbox"),
        )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
