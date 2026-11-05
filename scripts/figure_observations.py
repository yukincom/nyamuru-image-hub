"""Normalize pose, framing, facial features and their readable action description."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


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
