#!/usr/bin/env python3
"""Read one cropped manga-name figure with a local MLX VLM."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


PROMPT_VERSION = "figure-performance-v2-wd-hints"
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
EYE_STATES = {"open", "half-open", "closed", "mixed", "uncertain"}
PUPIL_VISIBILITY = {"true", "false", "uncertain"}
SMILE_STRENGTHS = {"weak", "medium", "strong"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--max-tokens", type=int, default=1200)
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

Treat these as tentative candidate cues, not observations. Confirm every component directly from the image before recording it as visual evidence or changing an expression family. Emotion-family words are coarse candidates, not final conclusions. Resolve left/right side, gaze, exact curve shape, strength, and any conflict from the image itself. A generic smile hint may support a faint smile or soft smile only when the mouth corners visibly rise, but it never proves a medium or strong smile by itself. A closed-mouth hint alone never implies neutral. If the image does not independently confirm a hint, ignore it. Do not copy raw tag vocabulary into the answer. These hints contain no character identity, clothing, body, rating, or text information and must not affect pose or character matching.

Translate component combinations into a likely manga-expression family instead of defaulting to neutral:
- Clearly wide-open eyes, or a wide-eyed hint confirmed by the image, support faint surprise, attention, alertness, or shock even when the mouth is closed. Preserve the visible eye opening, but a mild eye-opening cue alone must not become high-confidence or strong surprise. If no second cue distinguishes the emotion, name the alternatives and use low or medium confidence.
- Sharp V-shaped eyebrows combined with narrowed or tense eyes and a straight or downturned mouth support anger, annoyance, or determination. Choose the closest visible family; do not call it neutral only because the mouth is closed.
- If the image does not confirm the required combination, keep the family uncertain rather than forcing the hinted emotion.
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


def prompt_text(current_size: str, expression_hints: object = None) -> str:
    # current_size is deliberately only a fallback in normalization. Showing it to the
    # model biases full-body crops toward the importer's default bust-up value.
    _ = current_size
    return """これは日本の漫画ネーム用に描かれた一人分の人物資料です。画像は回転補正されていません。ポーズと表情を別セクションで観測し、性格、台詞、頭身は分析しません。
""" + expression_hint_prompt(expression_hints) + """

目的:
- 画像内で人物が正立、横向き、斜め、逆さのどれかを観測する。
- 頭、胸郭、骨盤の前後左右・斜め向きを分ける。
- 実際に見える腕、手、脚、足だけからポーズを記録する。
- 切り抜き画像の端で切れた部位を検出し、画面外を補完しない。
- 周囲のコマ枠、囲み線、紙の端、薄い裏写りは人物の身体として数えない。

画像方向の定義:
- image_up/down/left/right は画像そのものの上・下・左・右。人物自身の左右ではない。
- body_axis は頭から骨盤へ向かう軸。頭が骨盤より画像下なら upside_down。頭が左または右なら horizontal/diagonal。
- 逆さの人物を正立しているものとして読み替えない。画像のまま報告する。
- 逆さ・横向きだけを根拠に「落下」「飛行」と決めない。接地や運動線が不明なら action_candidate は空にする。

前後左右の定義:
- head/torso view_angle は front, three_quarter_front, profile, three_quarter_back, back, uncertain。
- horizontal_facing は鼻・顔面・胸が画像左を向けば image_left、画像右なら image_right、正面なら center、背面なら away。
- 頭と胴体の向きは別々に観測し、捻りがあれば一致させない。

断ち切りの規則:
- 頭、髪、胴、上腕、前腕、手、腿、膝、下腿、足のうち、輪郭線が切り抜き画像の端に到達して切れた部位だけを列挙する。
- 隠れているだけの部位と、画像端で切れた部位を区別する。
- 見えない関節の曲がり方、手指、画面外の脚を作らない。
- コマ枠ぎりぎりで切れた人物を、横たわっている人物と決めつけない。描写範囲と基本姿勢は別々に判定し、胸から上でも standing などが読み取れれば保持する。

ポーズの規則:
- base_posture は standing, sitting, kneeling, crouching, lying, reclining, curled, running, airborne_or_falling, other, uncertain。
- anatomically_left/right は確実な場合だけ使い、確実に取れた右左は弱めず保持する。不確実なら unknown。
- 腕と脚は、画像上でどちらへ伸びるか、曲がっているか、どこに触れるかを観測する。腕を髪や触角と決めつけない。
- 等身、頭身、体格、服装、年齢は分析しない。
- pose_draft は画像方向、姿勢、見える手足、画像端の断ち切りをまとめた簡潔な日本語1〜2文。

表情の規則:
- まず両目を一つずつ観察する。黒点・黒丸・虹彩が実際に見える時だけ pupil_or_iris_visible=true。瞳が見える目は open または half-open。
- 瞳がなく一本の弧だけの目は closed の第一候補。目の外形は開いて見えるが瞳がない場合は uncertain。
- 完成絵で口角上昇がごく弱くても画像上で確認できる場合は「ほのかな笑顔」または「微笑み」として残す。ただし中〜強い笑顔へ膨らませない。通常顔との差が画像上でも判別できない場合だけ中立。
- 感情を顔へ強く出さない造形もある。目を少し見開く等の弱い単独形状だけなら、可視形状は確定しても感情は「かすかな驚き、注視、警戒などの可能性」と弱め、confidence は low または medium にする。複数の形状が揃う時だけ強い感情を確定する。
- 簡略な漫画ネームでは、両目が瞳のない弧で口がU字・半円、または開眼でも口が大きな開いたU字・半円なら笑顔の根拠になる。
- 上向きの弧だけで笑顔と決めない。閉眼なら山型（∩）、谷型（∪）、浅い弧を分ける。
- 瞳が見える笑顔は原則 weak〜medium。瞳が見えない閉眼でも自動的に strong にせず、高い山型の閉眼と大きく開いた笑い口が揃う場合だけ strong 候補。
- smile_detected=false の場合は smile_observation=null、smile_type_candidates=[]。
- direction_draft は感情候補と可視形状を合わせた現在形1文。台詞や物語から感情を創作しない。
- JSONだけを返す。

{
  "framing":"face_closeup|bust_up|waist_up|knee_up|full_body|full_body_compact|other|uncertain",
  "edge_truncation":{
    "cropped_by_image_edge":false,
    "cropped_parts":[],
    "fully_visible_parts":[],
    "occluded_but_not_cropped_parts":[],
    "edge_evidence":[]
  },
  "canvas_orientation":{
    "body_axis":"upright|upside_down|horizontal_head_left|horizontal_head_right|diagonal_head_up_left|diagonal_head_up_right|diagonal_head_down_left|diagonal_head_down_right|uncertain",
    "head_relative_to_pelvis":"above|below|image_left|image_right|uncertain",
    "is_upside_down":false,
    "evidence":[]
  },
  "view_direction":{
    "head":{"view_angle":"front|three_quarter_front|profile|three_quarter_back|back|uncertain","horizontal_facing":"image_left|image_right|center|away|uncertain","evidence":[]},
    "torso":{"view_angle":"front|three_quarter_front|profile|three_quarter_back|back|uncertain","horizontal_facing":"image_left|image_right|center|away|uncertain","evidence":[]},
    "head_torso_twist":"none|slight|clear|uncertain"
  },
  "pose":{
    "base_posture":"standing|sitting|kneeling|crouching|lying|reclining|curled|running|airborne_or_falling|other|uncertain",
    "torso_shape":"",
    "arms":[{"side":"left|right|unknown","image_direction":"","elbow":"straight|slightly_bent|bent|uncertain","hand_position_or_contact":"","visibility":"full|partial|cropped|uncertain"}],
    "legs":[{"side":"left|right|unknown","image_direction":"","knee":"straight|slightly_bent|bent|uncertain","foot_position_or_contact":"","visibility":"full|partial|cropped|uncertain"}],
    "support_or_contact":"",
    "action_candidate":""
  },
  "expression":{
    "eye_observation":{
      "left":{"pupil_or_iris_visible":"true|false|uncertain","eye_state":"open|half-open|closed|uncertain","visible_evidence":""},
      "right":{"pupil_or_iris_visible":"true|false|uncertain","eye_state":"open|half-open|closed|uncertain","visible_evidence":""},
      "combined_state":"open|half-open|closed|mixed|uncertain"
    },
    "expression_family_candidates":[{"label":"笑顔|中立|怒り|悲しみ|驚き|困惑|その他","visual_evidence":[]}],
    "smile_detected":false,
    "smile_observation":{
      "eye_state":"open|half-open|closed|mixed|uncertain",
      "closed_eye_curve":"山型（∩）|谷型（∪）|浅い弧|水平に近い|非該当|不明",
      "eye_tension":"strong|relaxed|uncertain",
      "gaze":"",
      "mouth_opening":"closed|slightly-open|open|wide-open|uncertain",
      "mouth_shape":"",
      "mouth_corners":"both-up|one-side-up|neutral|uncertain",
      "brows":[],"cheeks":[],"symbols":[],"asymmetry":[],"strength_reason":""
    },
    "smile_type_candidates":[{"label":"","strength":"weak|medium|strong","visual_evidence":[]}],
    "direction_draft":"",
    "confidence":"high|medium|low",
    "uncertainties":[]
  },
  "pose_draft":"",
  "confidence":"high|medium|low",
  "uncertainties":[]
}"""


def extract_json_object(raw: str) -> dict[str, Any]:
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    decoder = json.JSONDecoder()
    for index, char in enumerate(cleaned):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(cleaned[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("VLMの応答にJSONオブジェクトがありません")


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


def normalized_expression(value: dict[str, Any]) -> dict[str, Any]:
    eyes_value = value.get("eye_observation") if isinstance(value.get("eye_observation"), dict) else {}

    def eye(key: str) -> dict[str, str]:
        record = eyes_value.get(key) if isinstance(eyes_value.get(key), dict) else {}
        return {
            "pupil_or_iris_visible": normalized_enum(record.get("pupil_or_iris_visible"), PUPIL_VISIBILITY, "uncertain"),
            "eye_state": normalized_enum(record.get("eye_state"), EYE_STATES - {"mixed"}, "uncertain"),
            "visible_evidence": short_text(record.get("visible_evidence")),
        }

    families: list[dict[str, Any]] = []
    raw_families = value.get("expression_family_candidates") if isinstance(value.get("expression_family_candidates"), list) else []
    for raw in raw_families[:2]:
        record = raw if isinstance(raw, dict) else {}
        label = short_text(record.get("label"), 60)
        if label:
            families.append({"label": label, "visual_evidence": normalized_strings(record.get("visual_evidence"), 6)})

    smile_observation_value = value.get("smile_observation") if isinstance(value.get("smile_observation"), dict) else {}
    smile_candidates: list[dict[str, Any]] = []
    raw_smiles = value.get("smile_type_candidates") if isinstance(value.get("smile_type_candidates"), list) else []
    for raw in raw_smiles[:2]:
        record = raw if isinstance(raw, dict) else {}
        label = short_text(record.get("label"), 80)
        strength = normalized_enum(record.get("strength"), SMILE_STRENGTHS, "weak")
        if label:
            smile_candidates.append({"label": label, "strength": strength, "visual_evidence": normalized_strings(record.get("visual_evidence"), 6)})
    smile_detected = value.get("smile_detected") is True
    return {
        "eyes": {
            "left": eye("left"),
            "right": eye("right"),
            "combined_state": normalized_enum(eyes_value.get("combined_state"), EYE_STATES, "uncertain"),
        },
        "families": families,
        "smile_detected": smile_detected,
        "smile": {
            "eye_state": normalized_enum(smile_observation_value.get("eye_state"), EYE_STATES, "uncertain"),
            "closed_eye_curve": short_text(smile_observation_value.get("closed_eye_curve"), 40),
            "eye_tension": short_text(smile_observation_value.get("eye_tension"), 40),
            "gaze": short_text(smile_observation_value.get("gaze"), 100),
            "mouth_opening": short_text(smile_observation_value.get("mouth_opening"), 40),
            "mouth_shape": short_text(smile_observation_value.get("mouth_shape"), 100),
            "mouth_corners": short_text(smile_observation_value.get("mouth_corners"), 40),
            "brows": normalized_strings(smile_observation_value.get("brows"), 6),
            "cheeks": normalized_strings(smile_observation_value.get("cheeks"), 6),
            "symbols": normalized_strings(smile_observation_value.get("symbols"), 6),
            "asymmetry": normalized_strings(smile_observation_value.get("asymmetry"), 6),
            "strength_reason": short_text(smile_observation_value.get("strength_reason"), 200),
        } if smile_detected else None,
        "smile_candidates": smile_candidates if smile_detected else [],
        "direction_draft": short_text(value.get("direction_draft"), 300),
        "confidence": normalized_enum(value.get("confidence"), {"high", "medium", "low"}, "low"),
        "uncertainties": normalized_strings(value.get("uncertainties")),
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
    if base_posture == "sitting" and "膝" in pose_draft and any(word in pose_draft for word in ("地面", "ついて", "着いて")):
        base_posture = "kneeling"
    suggested_size = current_size if face_only_crop else size_map.get(framing_source, current_size)
    if not face_only_crop and suggested_size not in {"long", "full", "knee-up"} and legs and any(word in pose_draft for word in ("膝", "脚", "足")):
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
    draft = short_text(value, 300)
    if not draft:
        return ""
    forbidden = ("推定", "補完", "描かれていない", "見えない", "おそらく", "と思われる")
    safe_sentences: list[str] = []
    for sentence in re.split(r"[。！？!?]+", draft):
        cleaned = short_text(sentence)
        if not cleaned or any(word in cleaned for word in forbidden):
            continue
        if framing_size != "full" and any(word in cleaned for word in ("脚", "足", "接地")):
            continue
        safe_sentences.append(cleaned)
    return "。".join(safe_sentences)


def compose_action(analysis: dict[str, Any]) -> str:
    orientation = analysis["orientation"]
    pose = analysis["pose"]
    expression = analysis["expression"]
    phrases: list[str] = []

    posture_labels = {
        "standing": "立っている",
        "sitting": "座っている",
        "kneeling": "膝立ちになっている",
        "crouching": "しゃがんでいる",
        "lying": "横たわっている",
        "reclining": "上体を倒してもたれている",
        "curled": "身体を丸めている",
        "running": "走っている",
        "airborne_or_falling": "宙に浮いているか落下中",
    }
    if pose["base"] in posture_labels:
        phrases.append(posture_labels[pose["base"]])
    if orientation["upside_down"]:
        phrases.append("画面上で上下逆さ")
    elif orientation["body_axis"].startswith("diagonal_"):
        phrases.append("身体の軸が画面に対して斜め")
    elif orientation["body_axis"].startswith("horizontal_"):
        phrases.append("身体の軸が画面に対して横向き")

    head = orientation["head"]
    facing = head["horizontal_facing"]
    if head["view_angle"] == "front":
        phrases.append("顔は正面向き")
    elif head["view_angle"] == "profile" and facing in {"image_left", "image_right"}:
        phrases.append(f"顔は画像{'左' if facing == 'image_left' else '右'}向きの横顔")
    elif head["view_angle"] == "three_quarter_front":
        direction = "左" if facing == "image_left" else "右" if facing == "image_right" else ""
        phrases.append(f"顔は{direction}斜め向き")
    elif head["view_angle"] == "back":
        phrases.append("顔は後ろ向き")

    pose_draft = safe_pose_draft(pose["draft"], analysis["framing"]["size"])
    if pose_draft:
        phrases.append(pose_draft)
    elif pose["torso"]:
        phrases.append(pose["torso"])

    direction_labels = {
        "up": "画像上へ",
        "down": "画像下へ",
        "left": "画像左へ",
        "right": "画像右へ",
        "image_up": "画像上へ",
        "image_down": "画像下へ",
        "image_left": "画像左へ",
        "image_right": "画像右へ",
    }
    joint_labels = {
        "straight": "伸ばしている",
        "slightly_bent": "少し曲げている",
        "bent": "曲げている",
    }
    for kind, entries, joint_key, noun in (() if pose_draft else (
        ("腕", pose["arms"], "elbow", "肘"),
        ("脚", pose["legs"], "knee", "膝"),
    )):
        if kind == "脚" and analysis["framing"]["size"] != "full":
            continue
        for limb in entries:
            side = "左" if limb["side"] == "left" else "右" if limb["side"] == "right" else "片"
            direction = direction_labels.get(limb["image_direction"], short_text(limb["image_direction"], 50))
            joint = joint_labels.get(limb[joint_key], "")
            detail = f"{side}{kind}"
            if direction:
                detail += f"を{direction}"
            if joint:
                detail += f"、{noun}を{joint}" if direction else f"の{noun}を{joint}"
            if limb["contact"]:
                detail += f"、{limb['contact']}"
            if limb["visibility"] == "cropped":
                detail += "、画面端で切れている"
            if direction or joint or limb["contact"] or limb["visibility"] == "cropped":
                phrases.append(detail)
    if pose["support_or_contact"]:
        phrases.append(pose["support_or_contact"])

    if expression["smile_detected"] and expression["smile_candidates"]:
        smile = expression["smile_candidates"][0]
        strength = smile["strength"]
        if strength == "strong":
            phrases.append(f"強い{smile['label']}")
        elif strength == "weak":
            label = smile["label"]
            phrases.append(label if label.startswith(("ほのかな", "弱い")) else f"ほのかな{label}")
        else:
            phrases.append(smile["label"])
        smile_observation = expression["smile"] or {}
        if smile_observation.get("eye_state") == "closed":
            phrases.append("目を閉じている")
        curve = smile_observation.get("closed_eye_curve", "")
        if curve and curve not in {"非該当", "不明"}:
            phrases.append(f"閉じた目は{curve}")
        mouth_shape = smile_observation.get("mouth_shape", "")
        if mouth_shape:
            phrases.append(f"口は{mouth_shape}")
    elif expression["direction_draft"]:
        phrases.append(expression["direction_draft"])
    elif expression["families"]:
        phrases.append(f"{expression['families'][0]['label']}の表情")

    for part in analysis["framing"]["cut_off_parts"]:
        phrases.append(f"{part}は画面端で切れている")

    unique: list[str] = []
    for phrase in phrases:
        cleaned = short_text(phrase).strip("。.!！?？")
        if cleaned and cleaned not in unique:
            unique.append(cleaned)
    return "。".join(unique)[:800].rstrip("。") + ("。" if unique else "")


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


def analyze(
    model_path: Path,
    image_path: Path,
    current_size: str,
    max_tokens: int,
    expression_tagging: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not model_path.is_dir() or not (model_path / "config.json").is_file():
        raise FileNotFoundError("ローカルVLMモデルが見つかりません")
    if not image_path.is_file():
        raise FileNotFoundError("解析対象の人物切り抜きが見つかりません")

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    prepared_path: Path | None = None
    try:
        prepared_path, width, height = prepare_image(image_path)
        model, processor = load(str(model_path))
        pose_prompt = apply_chat_template(
            processor,
            model.config,
            prompt_text(current_size, (expression_tagging or {}).get("hints")),
            num_images=1,
        )
        response = generate(
            model,
            processor,
            pose_prompt,
            image=str(prepared_path),
            max_tokens=max(900, min(max_tokens, 1600)),
            temp=0.0,
            repetition_penalty=1.05,
            verbose=False,
        )
        raw_analysis = extract_json_object(response.text)
        expression_analysis = raw_analysis.get("expression") if isinstance(raw_analysis.get("expression"), dict) else {}
        analysis = normalize_analysis(raw_analysis, expression_analysis, current_size)
        analysis["expression"] = attach_expression_hint_provenance(
            analysis["expression"], expression_tagging or {},
        )
        action = compose_action(analysis)
        if not action:
            raise ValueError("人物の演技を読み取れませんでした")
        return {
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
        current_size = request.get("current_size", "bust-up")
        if current_size not in FIGURE_SIZES:
            current_size = "bust-up"
        expression_tagging = request.get("expression_tagging")
        if not isinstance(expression_tagging, dict):
            expression_tagging = {}
        result = analyze(
            args.model.resolve(),
            args.image.resolve(),
            current_size,
            args.max_tokens,
            expression_tagging,
        )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
