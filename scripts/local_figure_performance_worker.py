#!/usr/bin/env python3
"""Read one cropped manga-name figure with a local MLX VLM."""

from __future__ import annotations

import argparse
import json
import math
from contextlib import contextmanager
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


PROMPT_VERSION = "figure-performance-v4-face-crop"
PERFORMANCE_MAX_TOKENS = 2400
CATALOG = json.loads(Path(__file__).with_name("expression_catalog.json").read_text(encoding="utf-8"))
ENTRIES = {entry["id"]: entry for entry in CATALOG["entries"]}
FIGURE_SIZES = {"long", "full", "knee-up", "waist-up", "bust-up", "shoulder-up", "face", "face-detail", "hand", "foot", "part"}
FRAMINGS = {"face_closeup", "bust_up", "waist_up", "knee_up", "full_body", "full_body_compact", "other", "uncertain"}
BODY_AXES = {
    "upright",
    "upside_down",
    "horizontal_head_left",
    "horizontal_head_right",
    "diagonal_head_up_left",
    "diagonal_head_up_right",
    "diagonal_head_down_left",
    "diagonal_head_down_right",
    "uncertain",
}
VIEW_ANGLES = {"front", "three_quarter_front", "profile", "three_quarter_back", "back", "uncertain"}
HORIZONTAL_FACING = {"image_left", "image_right", "center", "away", "uncertain"}
POSTURES = {
    "standing",
    "sitting",
    "kneeling",
    "crouching",
    "lying",
    "reclining",
    "curled",
    "running",
    "airborne_or_falling",
    "other",
    "uncertain",
}
LIMB_SIDES = {"left", "right", "unknown"}
JOINT_STATES = {"straight", "slightly_bent", "bent", "uncertain"}
LIMB_VISIBILITY = {"full", "partial", "cropped", "uncertain"}


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


def extract_json_object(raw: str, *, face: bool = False) -> dict[str, Any]:
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    start = cleaned.find("{")
    if start < 0:
        raise ValueError("VLMの応答にJSONオブジェクトがありません")
    try:
        result, _ = json.JSONDecoder().raw_decode(cleaned[start:])
    except json.JSONDecodeError as exc:
        raise ValueError("人物の演技のJSONが途中で切れているか、形式が正しくありません") from exc
    if face:
        if not isinstance(result.get("faces"), list):
            raise ValueError("顔表情のJSONにfacesがありません")
    elif not isinstance(result.get("pose"), dict) or not isinstance(result.get("framing"), str):
        raise ValueError("人物の演技のJSONに必要な項目がありません")
    return result


def short_text(value: object, limit: int = 160) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()[:limit]


def normalized_strings(value: object, limit: int = 10) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = short_text(item)
        if text and text not in result:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def normalized_enum(value: object, allowed: set[str], fallback: str) -> str:
    return value if isinstance(value, str) and value in allowed else fallback


def normalized_limb_entries(value: object, joint_key: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for raw in value[:4]:
        record = raw if isinstance(raw, dict) else {}
        result.append({
            "side": normalized_enum(record.get("side"), LIMB_SIDES, "unknown"),
            "image_direction": short_text(record.get("image_direction"), 80),
            joint_key: normalized_enum(record.get(joint_key), JOINT_STATES, "uncertain"),
            "contact": short_text(record.get("hand_position_or_contact") if joint_key == "elbow" else record.get("foot_position_or_contact"), 120),
            "visibility": normalized_enum(record.get("visibility"), LIMB_VISIBILITY, "uncertain"),
        })
    return result


def normalized_view(value: object) -> dict[str, Any]:
    record = value if isinstance(value, dict) else {}
    return {
        "view_angle": normalized_enum(record.get("view_angle"), VIEW_ANGLES, "uncertain"),
        "horizontal_facing": normalized_enum(record.get("horizontal_facing"), HORIZONTAL_FACING, "uncertain"),
        "evidence": normalized_strings(record.get("evidence"), 6),
    }


def english_observation(raw: object, limit: int = 160) -> str:
    phrase = short_text(raw, limit).strip(".")
    if (not re.search("[a-zA-Z]", phrase)
            or re.search(r"[\u3040-\u30ff\u3400-\u9fff]|<image\d+>", phrase, re.IGNORECASE)):
        return ""
    return phrase


def normalized_part(raw: object, slot: str) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    reason = short_text(raw.get("reason"), 380)
    reason = reason if english_observation(reason, 380) else ""
    extract = english_observation(raw.get("extract_en"), 200)
    evidence = (reason or extract) if slot == "base_emotion" else (extract or reason)
    if not evidence:
        return None
    code = raw.get("id")
    entry = ENTRIES.get(code) if isinstance(code, str) else None
    # A bad catalog citation must never erase independent observations, another
    # part's match, or the model's sentence. Keep only validated dictionary IDs.
    if entry and (raw.get("prompt") not in (None, entry["prompt"])
                  or (slot == "base_emotion" and (entry["role"] != "whole_expression" or entry["category"] > "C07"))
                  or (slot != "base_emotion" and slot not in entry["slots"])):
        entry = None
    if slot == "base_emotion" and not entry:
        return None
    source = "catalog" if entry and evidence.casefold() in entry["visual_description_en"].casefold() else "observation"
    part = {"id": entry["id"] if entry else None, "prompt": entry["prompt"] if entry else None,
            "source": source, "evidence_en": evidence, "reason": reason}
    if extract:
        part["extract_en"] = extract
    if slot == "eyes":
        symbolic = raw.get("is_symbolic_eye")
        part["is_symbolic_eye"] = symbolic if type(symbolic) is bool else None
    return part


def normalized_bbox(raw: object) -> list[float] | None:
    if not isinstance(raw, list) or len(raw) != 4 or any(type(n) not in (int, float) for n in raw):
        return None
    x1, y1, x2, y2 = raw
    if 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1:
        return raw
    return None


def model_expression_sentence(raw: object) -> str | None:
    # Only the language model writes the generator instruction. If it is missing or
    # invalid, keep the observations for review without inventing a replacement.
    if not isinstance(raw, str):
        return None
    sentence = " ".join(raw.split())
    if (len(sentence) > 800 or not english_observation(sentence, 800)
            or re.search(r"\b(?:sketch(?:y)?|pencil|rough|blank pupils|S\d{3})\b|<image\s*\d+>", sentence, re.I)):
        return None
    return sentence


def normalized_expression(value: dict[str, Any]) -> dict[str, Any]:
    raw_faces = value.get("faces")
    faces: list[dict[str, Any]] = []
    if not isinstance(raw_faces, list):
        raw_faces = []
    reliable_ids = True
    for index, raw in enumerate(raw_faces, start=1):
        expected_id = f"face_{index:02d}"
        if not isinstance(raw, dict) or raw.get("face_id") != expected_id:
            # Keep the other evidence, but never apply a possibly misidentified face.
            reliable_ids = False
        if not isinstance(raw, dict):
            continue
        mapping = raw.get("parts_mapping")
        if not isinstance(mapping, dict):
            mapping = {}
        parts = {key: normalized_part(mapping.get(key), key) for key in ("base_emotion", "brows", "eyes", "mouth")}
        extras = []
        raw_extras = mapping.get("extras")
        for extra in raw_extras if isinstance(raw_extras, list) else []:
            part = normalized_part(extra, "extras")
            if part and part not in extras:
                extras.append(part)
        parts["extras"] = extras
        observed_parts = [p for slot, p in parts.items() if slot != "extras" and p] + extras
        labels = {part["prompt"] for part in observed_parts if part["prompt"]}
        tags = [tag for tag in normalized_strings(raw.get("selected_tags"), 86) if tag in labels]
        sentence = model_expression_sentence(raw.get("qwen_image21_prompt_en")) if observed_parts else None
        faces.append({
            "face_id": expected_id,
            "bbox": normalized_bbox(raw.get("bbox")),
            "confidence": normalized_enum(raw.get("confidence"), {"high", "medium", "low"}, "low"),
            "parts_mapping": parts,
            "selected_tags": tags,
            "qwen_image21_prompt_en": sentence,
        })
    target = value.get("target_face_id")
    target_evidence = english_observation(value.get("target_evidence_en"))
    if len(raw_faces) == len(faces) == 1:
        target = faces[0]["face_id"]
    elif not reliable_ids or not any(face["face_id"] == target for face in faces) or not target_evidence:
        target = None
    selected = next((face for face in faces if face["face_id"] == target), None)
    if not faces:
        status = normalized_enum(value.get("read_status"), {"no_face", "ambiguous", "unreadable"}, "no_face")
    elif not selected:
        status = "ambiguous"
    else:
        status = "read" if selected["qwen_image21_prompt_en"] else "unreadable"
    return {
        "read_status": status,
        "catalog_version": CATALOG["version"],
        "catalog_sha256": CATALOG["source_sha256"],
        "target_face_id": target,
        "target_evidence_en": (target_evidence or None) if target else None,
        "faces": faces,
    }


def normalize_analysis(pose_value: dict[str, Any], expression_value: dict[str, Any], current_size: str) -> dict[str, Any]:
    framing_source = normalized_enum(pose_value.get("framing"), FRAMINGS, "uncertain")
    size_map = {
        "face_closeup": "face",
        "bust_up": "bust-up",
        "waist_up": "waist-up",
        "knee_up": "knee-up",
        "full_body": "full",
        "full_body_compact": "full",
    }
    edge_value = pose_value.get("edge_truncation") if isinstance(pose_value.get("edge_truncation"), dict) else {}
    canvas_value = pose_value.get("canvas_orientation") if isinstance(pose_value.get("canvas_orientation"), dict) else {}
    view_value = pose_value.get("view_direction") if isinstance(pose_value.get("view_direction"), dict) else {}
    raw_pose = pose_value.get("pose") if isinstance(pose_value.get("pose"), dict) else {}
    body_axis = normalized_enum(canvas_value.get("body_axis"), BODY_AXES, "uncertain")
    pose_draft = short_text(pose_value.get("pose_draft"), 300)
    arms = normalized_limb_entries(raw_pose.get("arms"), "elbow")
    legs = normalized_limb_entries(raw_pose.get("legs"), "knee")
    base_posture = normalized_enum(raw_pose.get("base_posture"), POSTURES, "uncertain")
    face_only_crop = current_size in {"face", "face-detail"}
    if face_only_crop or framing_source == "face_closeup":
        base_posture = "uncertain"
        arms = []
        legs = []
        body_axis = "uncertain"
        pose_draft = ""
    visible_pose = safe_pose_draft(pose_draft, "full")
    if base_posture == "sitting" and re.search(r"\bknees?\b[^.;]*\b(ground|floor)\b", visible_pose, re.I):
        base_posture = "kneeling"
    suggested_size = current_size if face_only_crop else size_map.get(framing_source, current_size)
    if not face_only_crop and suggested_size not in {"long", "full", "knee-up"} and legs and re.search(r"\b(knees?|legs?|foot|feet)\b", visible_pose, re.I):
        suggested_size = "full"
    visible_parts = [] if face_only_crop else normalized_strings(edge_value.get("fully_visible_parts"))
    cut_off_parts = [] if face_only_crop else normalized_strings(edge_value.get("cropped_parts"))
    occluded_parts = [] if face_only_crop else normalized_strings(edge_value.get("occluded_but_not_cropped_parts"))
    return {
        "framing": {
            "size": suggested_size,
            "source": "face_closeup" if face_only_crop else framing_source,
            "visible_parts": visible_parts,
            "cut_off_parts": cut_off_parts,
            "occluded_parts": occluded_parts,
            "cropped_by_image_edge": False if face_only_crop else edge_value.get("cropped_by_image_edge") is True,
        },
        "orientation": {
            "body_axis": body_axis,
            "head_relative_to_pelvis": "" if face_only_crop else short_text(canvas_value.get("head_relative_to_pelvis"), 40),
            "upside_down": False if face_only_crop else canvas_value.get("is_upside_down") is True or body_axis == "upside_down",
            "head": normalized_view(view_value.get("head")),
            "torso": normalized_view({}) if face_only_crop else normalized_view(view_value.get("torso")),
            "head_torso_twist": "" if face_only_crop else short_text(view_value.get("head_torso_twist"), 40),
        },
        "pose": {
            "base": base_posture,
            "torso": "" if face_only_crop else short_text(raw_pose.get("torso_shape")),
            "arms": arms,
            "legs": legs,
            "support_or_contact": "" if face_only_crop else short_text(raw_pose.get("support_or_contact")),
            "action_candidate": "" if face_only_crop else short_text(raw_pose.get("action_candidate")),
            "draft": pose_draft,
        },
        "expression": normalized_expression(expression_value),
        "confidence": normalized_enum(pose_value.get("confidence"), {"high", "medium", "low"}, "low"),
        "uncertain": normalized_strings(pose_value.get("uncertainties")),
    }


def safe_pose_draft(value: object, framing_size: str) -> str:
    draft = english_observation(value, 300)
    sentences = []
    for sentence in re.split(r"[.!?;]+", draft):
        if re.search(r"\b(perhaps|probably|inferred|imagined|unseen|not visible|not shown|not drawn|out of frame)\b", sentence, re.I):
            continue
        if framing_size not in {"full", "long", "knee-up"} and re.search(r"\b(legs?|knees?|foot|feet)\b", sentence, re.I):
            continue
        if sentence.strip():
            sentences.append(sentence.strip())
    return ". ".join(sentences)


def compose_action(analysis: dict[str, Any]) -> str:
    orientation = analysis["orientation"]
    pose = analysis["pose"]
    framing = analysis["framing"]
    expression = analysis["expression"]
    target_sentence = next((face["qwen_image21_prompt_en"] for face in expression["faces"]
                            if face["face_id"] == expression["target_face_id"]), None)
    phrases = []
    draft = safe_pose_draft(pose["draft"], framing["size"])
    posture = {"curled": "curled up", "airborne_or_falling": "airborne or falling"}.get(pose["base"], pose["base"])
    if posture not in {"other", "uncertain"} and posture not in draft.lower():
        phrases.append(posture.capitalize())
    axis = orientation["body_axis"]
    if orientation["upside_down"]:
        phrases.append("Upside down in the image")
    elif axis.startswith(("horizontal_", "diagonal_")):
        phrases.append(axis.replace("_head_", " with the head ").replace("_", " ").capitalize())

    view = orientation["head"]
    if view["view_angle"] != "uncertain":
        directions = {"front": "front view", "back": "back view", "profile": "profile",
                      "three_quarter_front": "three-quarter front view", "three_quarter_back": "three-quarter back view"}
        direction = directions[view["view_angle"]]
        if view["horizontal_facing"] in {"image_left", "image_right"}:
            direction += " toward image " + view["horizontal_facing"].split("_")[1]
        phrases.append("Head in " + direction)
    if draft:
        phrases.append(draft)
    else:
        phrases.append(english_observation(pose["torso"]))
        for kind, entries, joint_key in (("arm", pose["arms"], "elbow"), ("leg", pose["legs"], "knee")):
            if kind == "leg" and framing["size"] not in {"full", "long", "knee-up"}:
                continue
            for limb in entries:
                details = []
                direction = english_observation(limb["image_direction"])
                if direction and direction != "uncertain":
                    details.append("toward " + direction.replace("_", " "))
                if limb[joint_key] != "uncertain":
                    details.append(joint_key + " " + limb[joint_key].replace("_", " "))
                if limb["contact"]:
                    details.append(english_observation(limb["contact"]))
                if limb["visibility"] == "cropped":
                    details.append("cut by the image edge")
                if any(details):
                    label = kind if limb["side"] == "unknown" else limb["side"] + " " + kind
                    phrases.append(label.capitalize() + ": " + ", ".join(filter(None, details)))
    phrases.append(safe_pose_draft(pose["support_or_contact"], framing["size"]))
    for part in framing["cut_off_parts"]:
        if english_observation(part):
            phrases.append(part + " cut by the image edge")

    sentences = []
    seen = set()
    for phrase in phrases:
        cleaned = phrase.rstrip(" .") if phrase else ""
        if cleaned and cleaned.casefold() not in seen:
            sentences.append(cleaned[:1].upper() + cleaned[1:] + ".")
            seen.add(cleaned.casefold())
    # The editable field is limited to 800 characters. Keep the expression first,
    # fitting complete sentences rather than cutting the final word in half.
    action = target_sentence or ""
    for sentence in sentences:
        if sentence != target_sentence and len(action) + len(sentence) + bool(action) <= 800:
            action += (" " if action else "") + sentence
    return action


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
