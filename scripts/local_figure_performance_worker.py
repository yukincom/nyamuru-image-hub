#!/usr/bin/env python3
"""Read one cropped manga-name figure with a local MLX VLM."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from figure_observations import (
    CATALOG,
    ENTRIES,
    FIGURE_SIZES,
    FRAMINGS,
    BODY_AXES,
    VIEW_ANGLES,
    HORIZONTAL_FACING,
    POSTURES,
    LIMB_SIDES,
    JOINT_STATES,
    LIMB_VISIBILITY,
    extract_json_object,
    short_text,
    normalized_strings,
    normalized_enum,
    normalized_limb_entries,
    normalized_view,
    english_observation,
    normalized_part,
    normalized_bbox,
    model_expression_sentence,
    normalized_expression,
    normalize_analysis,
    safe_pose_draft,
    compose_action,
)


PROMPT_VERSION = "figure-performance-v4-face-crop"
PERFORMANCE_MAX_TOKENS = 2400

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True, action="append")
    parser.add_argument("--max-tokens", type=int, default=PERFORMANCE_MAX_TOKENS)
    return parser.parse_args()


def normalize_expression_hints(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    hints: list[dict[str, Any]] = []
    for raw in value[:12]:
        if not isinstance(raw, dict):
            continue
        tag = " ".join(str(raw.get("tag") or "").split())[:80]
        text = " ".join(str(raw.get("text") or "").split())[:180]
        try:
            score = max(0.0, min(1.0, float(raw.get("score") or 0.0)))
        except (TypeError, ValueError):
            score = 0.0
        try:
            threshold = max(0.0, min(1.0, float(raw.get("threshold") or 0.0)))
        except (TypeError, ValueError):
            threshold = 0.0
        if tag and text and all(item["tag"] != tag for item in hints):
            hints.append({
                "tag": tag,
                "text": text,
                "score": round(score, 4),
                "threshold": round(threshold, 4),
            })
    return hints


def expression_hint_prompt(value: object) -> str:
    hints = normalize_expression_hints(value)
    # A closed mouth by itself is common in neutral reference art and adds no
    # useful emotional distinction. Keep it in provenance, but do not bias Qwen
    # unless another expression component makes the combination informative.
    if {item["tag"] for item in hints} == {"closed_mouth"}:
        return ""
    if not hints:
        return ""
    lines = "\n".join(f'- {item["text"]} (confidence {item["score"]:.2f})' for item in hints)
    return f"""

Expression-only visual hints from a local WD Tagger:
{lines}

Tentative candidate cues, not observations. They must not affect pose or character matching. Use a hint only if the visible strokes independently support it. A single cue cannot establish strong emotion.
"""


def normalized_sha256(value: object) -> str:
    text = short_text(value, 64).lower()
    return text if re.fullmatch(r"[a-f0-9]{64}", text) else ""


def normalized_probability(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return round(max(0.0, min(1.0, number)), 4)


def normalize_expression_hint_source(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict) or short_text(value.get("provider"), 40) != "wd-tagger":
        return None
    structural: dict[str, float] = {}
    raw_structural = value.get("structural_thresholds")
    if isinstance(raw_structural, dict):
        for raw_key, raw_value in list(raw_structural.items())[:16]:
            key = short_text(raw_key, 80)
            probability = normalized_probability(raw_value)
            if key and probability is not None:
                structural[key] = probability
    return {
        "provider": "wd-tagger",
        "model": short_text(value.get("model"), 120),
        "revision": short_text(value.get("revision"), 40),
        "model_sha256": normalized_sha256(value.get("model_sha256")),
        "tags_sha256": normalized_sha256(value.get("tags_sha256")),
        "verified_pinned_artifacts": value.get("verified_pinned_artifacts") is True,
        "threshold": normalized_probability(value.get("threshold")),
        "structural_thresholds": structural,
        "expression_only": value.get("expression_only") is True,
    }


def attach_expression_hint_provenance(
    expression: dict[str, Any],
    expression_tagging: dict[str, Any],
) -> dict[str, Any]:
    """Attach auxiliary candidates without promoting them to observed expression facts."""
    tag_hints = normalize_expression_hints(expression_tagging.get("hints"))
    if not tag_hints:
        return expression
    expression["tag_hints"] = tag_hints
    source = normalize_expression_hint_source(expression_tagging.get("source"))
    if source is not None:
        expression["hint_source"] = source
    return expression


def expression_prompt_text(expression_hints: object = None) -> str:
    slot_codes = {"brows": "b", "eyes": "e", "mouth": "m", "extras": "x"}
    catalogue = "\n".join(
        f'{entry["id"]} {entry["category"]} {"W" if entry["role"] == "whole_expression" else "F"} '
        f'{"".join(slot_codes[slot] for slot in entry["slots"])} {entry["prompt"]} | {entry["visual_description_en"]}'
        for entry in ENTRIES.values()
    )
    return Path(__file__).with_name("qwen_face_expression_prompt.txt").read_text(encoding="utf-8") + catalogue + expression_hint_prompt(expression_hints)


def pose_prompt_text(locate_face: bool) -> str:
    face_keys = ',\n "subject_face_status":"located|no_face|ambiguous|unreadable",\n "subject_face":{"bbox":[0.0,0.0,1.0,1.0],"reason":""}' if locate_face else ""
    prompt = f"""Read the person in this cropped manga storyboard as drawn. Return only one JSON object. All descriptions are short English phrases. Ignore writing and construction lines. Use unrotated image directions. Report visible head, torso, limbs and contacts independently; never infer proportions, unseen limbs, or motion from tilt alone. Distinguish a cut at the image edge from occlusion. Decide framing and posture separately: a standing figure may be cropped at the chest. Preserve anatomical sides only if clear; otherwise use unknown. Describe the subject's visible pose only, excluding expression, in pose_draft.

Return these keys:
{{
 "framing":"face_closeup|bust_up|waist_up|knee_up|full_body|full_body_compact|other|uncertain",
 "edge_truncation":{{"cropped_by_image_edge":false,"cropped_parts":[],"fully_visible_parts":[],"occluded_but_not_cropped_parts":[]}},
 "canvas_orientation":{{"body_axis":"upright|upside_down|horizontal_head_left|horizontal_head_right|diagonal_head_up_left|diagonal_head_up_right|diagonal_head_down_left|diagonal_head_down_right|uncertain","head_relative_to_pelvis":"above|below|image_left|image_right|uncertain","is_upside_down":false}},
 "view_direction":{{"head":{{"view_angle":"front|three_quarter_front|profile|three_quarter_back|back|uncertain","horizontal_facing":"image_left|image_right|center|away|uncertain","evidence":[]}},"torso":{{"view_angle":"","horizontal_facing":"","evidence":[]}},"head_torso_twist":"none|slight|clear|uncertain"}},
 "pose":{{"base_posture":"standing|sitting|kneeling|crouching|lying|reclining|curled|running|airborne_or_falling|other|uncertain","torso_shape":"","arms":[{{"side":"left|right|unknown","image_direction":"","elbow":"straight|slightly_bent|bent|uncertain","hand_position_or_contact":"","visibility":"full|partial|cropped|uncertain"}}],"legs":[{{"side":"","image_direction":"","knee":"","foot_position_or_contact":"","visibility":""}}],"support_or_contact":"","action_candidate":""}},
 "pose_draft":"","confidence":"high|medium|low","uncertainties":[]{face_keys}
}}"""
    if locate_face:
        prompt += """
Also return subject_face_status: "located", "no_face", "ambiguous", or "unreadable". For "located", include subject_face: {"bbox":[left,top,right,bottom],"reason":"..."} for the visible face belonging to this cropped figure. Coordinates are normalized to 0..1 in this unrotated image. Enclose the whole face including brows, chin and surface marks. Use its anatomical connection to the body, not its expression. For a hidden or indistinct face use "unreadable", for no face use "no_face", and when multiple faces cannot be uniquely associated use "ambiguous"; in these cases return subject_face: null. Do not analyze the facial expression."""
    return prompt


def prepare_image(source: Path) -> tuple[Path, int, int]:
    from PIL import Image, ImageOps

    opened = ImageOps.exif_transpose(Image.open(source)).convert("RGBA")
    white = Image.new("RGBA", opened.size, (255, 255, 255, 255))
    image = Image.alpha_composite(white, opened).convert("RGB")
    width, height = image.size
    image.thumbnail((1280, 1280))
    temporary = tempfile.NamedTemporaryFile(prefix="nyamuru-figure-performance-", suffix=".jpg", delete=False)
    temporary.close()
    target = Path(temporary.name)
    image.save(target, format="JPEG", quality=94, optimize=True)
    return target, width, height


@contextmanager
def face_target_image(figure: Path, supplied: Path | None, bbox: list[float]):
    """Use original face pixels. If Qwen localized it, crop the source, never the pose thumbnail."""
    from PIL import Image, ImageOps

    source_path = supplied if supplied is not None else figure
    crop_needed = supplied is None and bbox != [0, 0, 1, 1]
    with Image.open(source_path) as source:
        oriented = source.getexif().get(274, 1) != 1
        image = ImageOps.exif_transpose(source) if oriented else source
        if crop_needed:
            w, h = image.size
            x1, y1, x2, y2 = bbox
            image = image.crop((math.floor(x1*w), math.floor(y1*h), math.ceil(x2*w), math.ceil(y2*h)))
        # mlx-vlm converts images to RGB, dropping alpha. Flatten translucent
        # pixels onto white here so black line art on transparent black stays visible.
        translucent = False
        if "A" in image.getbands() or "transparency" in image.info:
            rgba = image.convert("RGBA")
            translucent = rgba.getchannel("A").getextrema()[0] < 255
            if translucent:
                white = Image.new("RGBA", image.size, "white")
                image = Image.alpha_composite(white, rgba).convert("RGB")
        if not (crop_needed or oriented or translucent):
            yield source_path
            return
        with tempfile.NamedTemporaryFile(prefix="nyamuru-expression-face-", suffix=".png") as temporary:
            image.save(temporary, format="PNG")
            temporary.flush()
            yield Path(temporary.name)


def infer_object(model, processor, prompt: str, image_path: Path, max_tokens: int, *, face: bool = False):
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    response = generate(
        model, processor, apply_chat_template(processor, model.config, prompt, num_images=1),
        image=str(image_path), max_tokens=max_tokens, temp=0.0, repetition_penalty=1.05, verbose=False,
    )
    try:
        return extract_json_object(response.text, face=face)
    except ValueError:
        if not face:
            raise
        # The face pass alone returned truncated/malformed JSON. Retain the
        # independently completed pose and identity. Model and I/O errors propagate.
        return {"faces": [], "read_status": "unreadable"}


def read_performance(model, processor, figure: Path, prepared: Path, current_size: str, max_tokens: int,
                     expression_tagging: dict[str, Any], face_image: Path | None, face_bbox: object):
    bbox = normalized_bbox(face_bbox)
    if face_bbox is not None and bbox is None:
        raise ValueError("人物内の顔の座標が不正です")
    if face_image is not None and (not face_image.is_file() or bbox is None):
        raise ValueError("顔の原寸画像と人物内の座標が必要です")
    locate = bbox is None
    pose = infer_object(model, processor, pose_prompt_text(locate), prepared, max_tokens)
    subject = pose.get("subject_face")
    reason = ""
    if locate and pose.get("subject_face_status") == "located" and isinstance(subject, dict):
        reason = english_observation(subject.get("reason"), 380)
        bbox = normalized_bbox(subject.get("bbox")) if reason else None
    if bbox is None:
        status = normalized_enum(pose.get("subject_face_status"), {"ambiguous", "unreadable", "no_face"}, "unreadable")
        reading = {"faces": [], "read_status": status}
    else:
        with face_target_image(figure, face_image, bbox) as target:
            reading = infer_object(model, processor, expression_prompt_text(expression_tagging.get("hints")),
                                   target, PERFORMANCE_MAX_TOKENS, face=True)
        # Persist coordinates within the figure (not within this second image).
        raw_faces = reading["faces"]
        reading["read_status"] = "unreadable"  # An empty/unusable response for a located face needs review.
        for face in raw_faces:
            if not isinstance(face, dict):
                continue
            if len(raw_faces) == 1:
                face["bbox"] = bbox
            elif face_image is None and (local := normalized_bbox(face.get("bbox"))):
                x1, y1, x2, y2 = bbox
                face["bbox"] = [x1 + (x2-x1)*local[0], y1 + (y2-y1)*local[1],
                                x1 + (x2-x1)*local[2], y1 + (y2-y1)*local[3]]
            else:
                # A supplied detector crop can extend beyond the figure; its local
                # coordinates cannot safely be projected from the clipped bbox.
                face["bbox"] = None
        if len(raw_faces) == 1 and reason:
            reading["target_evidence_en"] = reason
    analysis = normalize_analysis(pose, reading, current_size)
    if not locate and reading.get("faces"):
        attach_expression_hint_provenance(analysis["expression"], expression_tagging)
    return analysis


def analyze(
    model_path: Path,
    image_path: Path,
    current_size: str,
    max_tokens: int,
    expression_tagging: dict[str, Any] | None = None,
    face_image: Path | None = None,
    face_bbox: object = None,
) -> dict[str, Any]:
    if not model_path.is_dir() or not (model_path / "config.json").is_file():
        raise FileNotFoundError("ローカルVLMモデルが見つかりません")
    if not image_path.is_file():
        raise FileNotFoundError("解析対象の人物切り抜きが見つかりません")

    from mlx_vlm import load

    prepared_path, width, height = prepare_image(image_path)
    try:
        model, processor = load(str(model_path))
        analysis = read_performance(
            model, processor, image_path, prepared_path, current_size, max(900, min(max_tokens, PERFORMANCE_MAX_TOKENS)),
            expression_tagging or {}, face_image, face_bbox,
        )
        return {
            "suggested_action": compose_action(analysis),
            "suggested_size": analysis["framing"]["size"],
            "analysis": analysis,
            "image": {"width_px": width, "height_px": height},
            "prompt_version": PROMPT_VERSION,
        }
    finally:
        prepared_path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    try:
        request = json.loads(sys.stdin.read() or "{}")
        current_size = request.get("current_size", "bust-up")
        if current_size not in FIGURE_SIZES:
            current_size = "bust-up"
        expression_tagging = request.get("expression_tagging")
        if not isinstance(expression_tagging, dict):
            expression_tagging = {}
        if len(args.image) > 2:
            raise ValueError("人物画像と顔画像は各1枚までです")
        result = analyze(
            args.model.resolve(),
            args.image[0].resolve(),
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
