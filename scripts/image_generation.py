"""Cloud API image generation helper for Nyamuru.

直接それを示すもの以外は、内部の関数名やコメントには汎用的な名称を使う。
"""
from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_CLOUD_IMAGE_MODEL = "gemini-3.1-flash-image"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
LOCAL_KEY_PATH = Path.home() / ".nyamuru" / "cloud_api_key"
LEGACY_KEY_PATH = Path.home() / ".nyamuru" / "gemini_api_key"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SUPPORTED_ASPECT_RATIOS: tuple[tuple[str, float], ...] = (
    ("1:1", 1.0),
    ("2:3", 2.0 / 3.0),
    ("3:2", 3.0 / 2.0),
    ("3:4", 3.0 / 4.0),
    ("4:3", 4.0 / 3.0),
    ("4:5", 4.0 / 5.0),
    ("5:4", 5.0 / 4.0),
    ("9:16", 9.0 / 16.0),
    ("16:9", 16.0 / 9.0),
)


def _natural_sort_key(path: Path) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name)]


def _read_local_api_key() -> str:
    for candidate in (LOCAL_KEY_PATH, LEGACY_KEY_PATH):
        try:
            if candidate.is_file():
                val = candidate.read_text(encoding="utf-8").strip()
                if val:
                    return val
        except OSError:
            continue
    return ""


def get_cloud_api_key_status() -> dict[str, object]:
    env_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if env_key:
        return {"configured": True, "source": "env"}
    local_key = _read_local_api_key()
    if local_key:
        return {"configured": True, "source": "local"}
    return {"configured": False, "source": "none"}


def resolve_cloud_api_key() -> str:
    env_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if env_key:
        return env_key
    local_key = _read_local_api_key()
    if local_key:
        return local_key
    raise ValueError("APIキーが未設定です。環境設定のクラウドAPI設定から保存してください。")


def save_cloud_api_key(api_key: object) -> dict[str, object]:
    if not isinstance(api_key, str):
        raise ValueError("APIキーが不正です")
    cleaned = api_key.strip()
    if not cleaned:
        for candidate in (LOCAL_KEY_PATH, LEGACY_KEY_PATH):
            if candidate.exists():
                candidate.unlink()
        return {"ok": True, **get_cloud_api_key_status()}
    LOCAL_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_KEY_PATH.write_text(cleaned + "\n", encoding="utf-8")
    try:
        os.chmod(LOCAL_KEY_PATH, 0o600)
    except OSError:
        pass
    return {"ok": True, **get_cloud_api_key_status()}


def list_cloud_image_models() -> dict[str, Any]:
    api_key = resolve_cloud_api_key()
    req = urllib.request.Request(
        GEMINI_API_BASE,
        headers={"x-goog-api-key": api_key},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"モデル一覧取得エラー ({exc.code}): {detail[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"クラウドAPIへの接続に失敗しました: {exc.reason}") from exc

    models: list[dict[str, str]] = []
    for entry in raw.get("models") or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "")
        short_id = name.removeprefix("models/")
        methods = entry.get("supportedGenerationMethods") or []
        if "generateContent" not in methods:
            continue
        lower = short_id.lower()
        if "image" in lower or "banana" in lower:
            models.append({
                "id": short_id,
                "label": str(entry.get("displayName") or short_id),
            })
    return {"ok": True, "models": models}


def _mime_type_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    return "image/png"


def _find_page_name_sketch(episode_dir: Path | None, page_number: int) -> Path | None:
    if not episode_dir or not episode_dir.is_dir():
        return None
    origin_dir = episode_dir / "origin_data"
    if origin_dir.is_dir():
        scans = sorted(
            [p for p in origin_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS],
            key=_natural_sort_key,
        )
        idx = page_number - 1
        if 0 <= idx < len(scans):
            return scans[idx]
    guide = episode_dir / f"{page_number:02d}.png"
    if guide.is_file():
        return guide
    return None


def _find_character_references(
    series_dir: Path | None,
    episode_dir: Path | None,
    characters: list[dict[str, Any]],
    page_spec: dict[str, Any],
    limit: int = 2,
) -> list[tuple[str, Path]]:
    search_roots: list[Path] = []
    for base in [series_dir, episode_dir.parent if episode_dir else None]:
        if not base or not base.is_dir():
            continue
        for sub in ("character_data/できたやつ", "character_data", "characters", "キャラクター"):
            candidate = base / sub
            if candidate.is_dir() and candidate not in search_roots:
                search_roots.append(candidate)
    if not search_roots:
        return []

    all_images: list[Path] = []
    for root in search_roots:
        for item in sorted(root.rglob("*"), key=_natural_sort_key):
            if item.is_file() and item.suffix.lower() in IMAGE_EXTENSIONS and item not in all_images:
                all_images.append(item)
    if not all_images:
        return []

    panel_names: list[str] = []
    for panel in page_spec.get("panels") or []:
        for fig in panel.get("figures") or []:
            name = str(fig.get("name") or "").strip()
            if name and name not in panel_names:
                panel_names.append(name)

    selected: list[tuple[str, Path]] = []
    used_paths: set[Path] = set()
    for name in panel_names:
        if len(selected) >= limit:
            break
        char_entry = next((c for c in characters if str(c.get("name") or "").strip() == name), {})
        ref_keys = [str(r.get("key") or "") for r in (char_entry.get("reference_images") or []) if isinstance(r, dict)]
        aliases = [name, *ref_keys]
        if name == "小雪":
            aliases.append("koyuki")
        elif name == "ジプト":
            aliases.extend(["jipt", "gpt"])
        match = next(
            (img for img in all_images if img not in used_paths and any(alias and alias.lower() in img.stem.lower() for alias in aliases)),
            None,
        )
        if match:
            used_paths.add(match)
            selected.append((name, match))
    return selected


def _panel_position_label(panel: dict[str, Any], page_spec: dict[str, Any]) -> str:
    shape = panel.get("shape") if isinstance(panel.get("shape"), dict) else {}
    if shape.get("type") != "rect":
        return ""
    canvas = page_spec.get("canvas") if isinstance(page_spec.get("canvas"), dict) else {}
    cw = float(canvas.get("w") or 182)
    ch = float(canvas.get("h") or 257)
    x = float(shape.get("x") or 0)
    y = float(shape.get("y") or 0)
    w = float(shape.get("w") or 0)
    h = float(shape.get("h") or 0)
    cx = (x + w / 2) / max(1.0, cw)
    cy = (y + h / 2) / max(1.0, ch)
    v = "top" if cy < 0.38 else "bottom" if cy > 0.68 else "middle"
    h_pos = "full-width" if w / max(1.0, cw) > 0.65 else "left" if cx < 0.5 else "right"
    return f"{v} {h_pos}"


def build_cloud_page_prompt(
    cloud_spec: dict[str, Any],
    page_spec: dict[str, Any],
    has_name_sketch: bool,
    char_ref_names: list[str] | int,
) -> str:
    render_options = cloud_spec.get("render_options") or {}
    include_background = render_options.get("include_background") is not False
    include_bubbles = render_options.get("include_bubbles") is True
    include_handwritten = render_options.get("include_handwritten") is not False
    include_screen_text = render_options.get("include_screen_text") is not False
    include_panel_borders = render_options.get("include_panel_borders") is True

    artwork_rules = cloud_spec.get("artwork_rules") if isinstance(cloud_spec.get("artwork_rules"), dict) else {}
    raw_style_notes = [str(s).strip() for s in (artwork_rules.get("style_notes") or []) if str(s).strip()]
    style_notes = [s for s in raw_style_notes if not s.startswith("[style] 作品の出力形式")]
    negative_prompt = str(cloud_spec.get("negative_prompt") or artwork_rules.get("negative_prompt") or "").strip()

    ref_names = char_ref_names if isinstance(char_ref_names, list) else []
    char_label_map = {name: f"Character Ref {i + 1}" for i, name in enumerate(ref_names)}
    char_ref_count = len(ref_names) if isinstance(char_ref_names, list) else int(char_ref_names)

    lines: list[str] = [
        "Finish as monochrome black-and-white Japanese manga line art.",
    ]
    if has_name_sketch:
        lines.append(
            "Use the rough name sketch for the exact panel layout, character poses, head angles, framing, and expressions."
        )
    if char_ref_count > 0:
        lines.append("Use the attached character reference sheet(s) in order (Character Ref 1, Character Ref 2, ...) for each character's visual design, even in small/distant panels. Never write character labels as text.")

    if include_panel_borders:
        lines.append("Draw black manga panel borders with white gutters.")
    else:
        lines.append("境界線はすべて細い水色（#78b4e6）の単線で出力する（Draw every dividing border line strictly as a thin pale sky-blue #78b4e6 line only).")

    if not include_bubbles:
        lines.append("Omit all speech balloons and dialogue text from the rough sketch; draw only the characters, poses, expressions, and the panel backgrounds/SFX listed below.")

    for idx, panel in enumerate(page_spec.get("panels") or [], 1):
        pos_label = _panel_position_label(panel, page_spec)
        header = f"- Panel {idx}" + (f" ({pos_label})" if pos_label else "") + ":"
        parts: list[str] = [header]
        fig_refs = [
            char_label_map[str(f.get("name") or "").strip()]
            for f in (panel.get("figures") or [])
            if str(f.get("name") or "").strip() in char_label_map
        ]
        if fig_refs:
            parts.append(f"draw {', '.join(fig_refs)};")
        bg = panel.get("background") if isinstance(panel.get("background"), dict) else {}
        if include_background:
            bg_desc = str(bg.get("description") or "").strip()
            if bg_desc:
                parts.append(f"background={bg_desc};")
        else:
            parts.append("background=plain pure white only;")

        handwritten = [b.get("text") for b in (panel.get("bubbles") or []) if b.get("kind") == "handwritten" and b.get("text")]
        if include_handwritten and handwritten:
            parts.append(f"vertical handwritten SFX={', '.join(str(t) for t in handwritten)};")

        speech = [b.get("text") for b in (panel.get("bubbles") or []) if b.get("kind") != "handwritten" and b.get("text")]
        if include_bubbles and speech:
            parts.append(f"speech bubbles={', '.join(str(t) for t in speech)};")

        screen_texts = [s.get("text") for s in (panel.get("screen_text") or []) if s.get("text")]
        if include_screen_text and screen_texts:
            parts.append(f"typeset text={', '.join(str(t) for t in screen_texts)};")

        lines.append(" ".join(parts))

    if style_notes:
        lines.append("Positive style: " + " / ".join(style_notes))
    if negative_prompt:
        lines.append("Negative / avoid: " + negative_prompt)

    return "\n".join(lines)


def _closest_aspect_ratio(width: object, height: object) -> str:
    try:
        w = float(width)
        h = float(height)
    except (TypeError, ValueError):
        return "3:4"
    if w <= 0 or h <= 0:
        return "3:4"
    target = w / h
    return min(SUPPORTED_ASPECT_RATIOS, key=lambda item: abs(item[1] - target))[0]


def _decode_data_url_part(data_url: object) -> dict[str, Any] | None:
    if not isinstance(data_url, str) or not data_url.strip():
        return None
    match = re.match(r"^data:([^;,]+);base64,(.+)$", data_url.strip(), flags=re.DOTALL)
    if not match:
        return None
    mime_type = match.group(1).strip() or "image/png"
    b64 = re.sub(r"\s+", "", match.group(2))
    if not b64:
        return None
    return {"inline_data": {"mime_type": mime_type, "data": b64}}


def _call_cloud_image_api(
    *,
    api_key: str,
    chosen_model: str,
    parts: list[dict[str, Any]],
    aspect_ratio: str,
) -> tuple[bytes, str]:
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio},
        },
    }

    url = f"{GEMINI_API_BASE}/{chosen_model}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "Connection": "close",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw_resp = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"クラウドAPIエラー ({exc.code}): {detail[:400]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"クラウドAPIへの接続に失敗しました: {exc.reason}") from exc

    candidates = raw_resp.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict) and inline.get("data"):
                mime_type = str(inline.get("mimeType") or inline.get("mime_type") or "image/png")
                return base64.b64decode(inline["data"]), mime_type
    raise RuntimeError("クラウドAPIから画像が返されませんでした")


def _format_style_line(output_format: str) -> str:
    fmt = output_format.strip()
    if "カラー" in fmt or "color" in fmt.lower():
        return "Finish as full-color Japanese manga illustration with clean line art and flat shading."
    if "グレースケール" in fmt or "gray" in fmt.lower():
        return "Finish as grayscale Japanese manga line art with smooth gray tonal shading."
    return "Finish as monochrome black-and-white Japanese manga line art."


def build_cloud_single_prompt(
    *,
    target_kind: str,
    label: str = "",
    character_name: str = "",
    action: str = "",
    background_description: str = "",
    literal_text: list[str] | None = None,
    output_format: str = "",
    style_notes: list[str] | None = None,
    negative_prompt: str = "",
    has_character_refs: bool = False,
    has_reference_image: bool = False,
    has_pose_image: bool = False,
    has_correction_image: bool = False,
    has_composition_image: bool = False,
) -> str:
    lines: list[str] = [_format_style_line(output_format)]

    if target_kind == "background":
        lines.append("Draw the background scenery only. Do not draw any characters, speech balloons, or panel borders.")
        if has_reference_image:
            lines.append("Follow the attached rough sketch/guide for the exact layout, perspective, and framing.")
        if background_description.strip():
            lines.append(f"Background description: {background_description.strip()}")
    elif target_kind in {"handwritten", "typeset"}:
        text_items = [str(t).strip() for t in (literal_text or []) if str(t).strip()]
        kind_desc = "handwritten manga sound-effect lettering" if target_kind == "handwritten" else "clean manga typeset lettering"
        lines.append(f"Draw only the {kind_desc} on a plain pure white background. Do not draw characters, scenery, or borders.")
        if text_items:
            lines.append("Exact text: " + " / ".join(text_items))
        if has_reference_image:
            lines.append("Follow the attached guide for text placement, shape, and scale.")
    elif target_kind in {"panel", "page"}:
        if has_composition_image:
            lines.append("Follow the attached page/panel layout guide for panel shapes, character placement, framing, and composition.")
        if has_character_refs:
            lines.append("Use the attached character reference sheet(s) for each character's visual design and drawing style.")
    else:
        subject = character_name.strip() or label.strip()
        if has_character_refs:
            lines.append(
                "Use the attached character reference sheet(s) for the character's face shape, eyes, hairstyle, outfit, accessories, and drawing style."
            )
        if has_reference_image:
            lines.append(
                "Use the attached rough character sketch/guide for the exact pose, body orientation, framing, camera angle, and facial expression."
            )
        if has_pose_image:
            lines.append(
                "Follow the attached 3D pose reference for body posture and framing; do not keep mannequin colors or joint markers."
            )
        if has_correction_image:
            lines.append(
                "Apply the edits indicated by the attached correction markup while keeping all other parts unchanged, and remove all markup lines."
            )
        if subject:
            lines.append(f"Subject: {subject}.")
        if action.strip():
            lines.append(f"Expression and action: {action.strip()}")
        lines.append(
            "Draw a single isolated subject on a plain pure white background. Do not draw panel borders, speech balloons, text, or background scenery."
        )

    cleaned_notes = [
        str(s).strip()
        for s in (style_notes or [])
        if str(s).strip() and not str(s).strip().startswith("[style] 作品の出力形式")
    ]
    if cleaned_notes:
        lines.append("Positive style: " + " / ".join(cleaned_notes))
    if negative_prompt.strip():
        lines.append("Negative / avoid: " + negative_prompt.strip())

    return "\n".join(lines)


def generate_cloud_single_image(
    *,
    model: str,
    target_kind: str = "figure",
    label: str = "",
    character_name: str = "",
    action: str = "",
    background_description: str = "",
    literal_text: list[str] | None = None,
    output_format: str = "",
    style_notes: list[str] | None = None,
    negative_prompt: str = "",
    width: int | float | None = None,
    height: int | float | None = None,
    cutout_white_background: bool = False,
    character_references: list[dict[str, Any]] | None = None,
    reference_image: str | None = None,
    pose_image: str | None = None,
    correction_image: str | None = None,
    composition_image: str | None = None,
) -> dict[str, Any]:
    api_key = resolve_cloud_api_key()
    chosen_model = (model or DEFAULT_CLOUD_IMAGE_MODEL).strip()

    parts: list[dict[str, Any]] = []
    char_ref_count = 0
    for entry in character_references or []:
        if not isinstance(entry, dict):
            continue
        decoded = _decode_data_url_part(entry.get("image"))
        if decoded:
            parts.append(decoded)
            char_ref_count += 1

    ref_part = _decode_data_url_part(reference_image)
    if ref_part:
        parts.append(ref_part)

    pose_part = _decode_data_url_part(pose_image)
    if pose_part:
        parts.append(pose_part)

    corr_part = _decode_data_url_part(correction_image)
    if corr_part:
        parts.append(corr_part)

    comp_part = _decode_data_url_part(composition_image)
    if comp_part:
        parts.append(comp_part)

    prompt = build_cloud_single_prompt(
        target_kind=target_kind,
        label=label,
        character_name=character_name,
        action=action,
        background_description=background_description,
        literal_text=literal_text,
        output_format=output_format,
        style_notes=style_notes,
        negative_prompt=negative_prompt,
        has_character_refs=char_ref_count > 0,
        has_reference_image=ref_part is not None,
        has_pose_image=pose_part is not None,
        has_correction_image=corr_part is not None,
        has_composition_image=comp_part is not None,
    )
    parts.append({"text": prompt})

    aspect_ratio = _closest_aspect_ratio(width, height)
    raw_bytes, mime_type = _call_cloud_image_api(
        api_key=api_key,
        chosen_model=chosen_model,
        parts=parts,
        aspect_ratio=aspect_ratio,
    )

    if cutout_white_background:
        try:
            from qwen_background import remove_white_background
            raw_bytes = remove_white_background(raw_bytes)
            mime_type = "image/png"
        except Exception:
            pass

    return {
        "ok": True,
        "model": chosen_model,
        "mime_type": mime_type,
        "image_base64": base64.b64encode(raw_bytes).decode("ascii"),
    }


def generate_cloud_page_image(
    *,
    episode_dir: Path | None,
    series_dir: Path | None,
    page_number: int,
    model: str,
    cloud_spec: dict[str, Any],
) -> dict[str, Any]:
    api_key = resolve_cloud_api_key()
    chosen_model = (model or DEFAULT_CLOUD_IMAGE_MODEL).strip()
    pages = cloud_spec.get("pages") or []
    page_spec = next((p for p in pages if int(p.get("page") or 0) == page_number), pages[0] if pages else {})
    characters = cloud_spec.get("characters") or []

    name_sketch = _find_page_name_sketch(episode_dir, page_number)
    char_refs = _find_character_references(series_dir, episode_dir, characters, page_spec, limit=2 if name_sketch else 3)
    ref_paths: list[Path] = [*[path for _, path in char_refs], *([name_sketch] if name_sketch else [])]

    prompt = build_cloud_page_prompt(
        cloud_spec=cloud_spec,
        page_spec=page_spec,
        has_name_sketch=name_sketch is not None,
        char_ref_names=[name for name, _ in char_refs],
    )

    parts: list[dict[str, Any]] = []
    for ref in ref_paths:
        encoded = base64.b64encode(ref.read_bytes()).decode("ascii")
        parts.append({"inline_data": {"mime_type": _mime_type_for_path(ref), "data": encoded}})
    parts.append({"text": prompt})

    raw_bytes, mime_type = _call_cloud_image_api(
        api_key=api_key,
        chosen_model=chosen_model,
        parts=parts,
        aspect_ratio="3:4",
    )
    ext = "jpg" if "jpeg" in mime_type else "webp" if "webp" in mime_type else "png"
    saved_path = ""
    if episode_dir and episode_dir.is_dir():
        target_path = episode_dir / f"cloud_page_{page_number:02d}.{ext}"
        try:
            target_path.write_bytes(raw_bytes)
            saved_path = str(target_path)
        except OSError:
            saved_path = ""
    return {
        "ok": True,
        "model": chosen_model,
        "mime_type": mime_type,
        "image_base64": base64.b64encode(raw_bytes).decode("ascii"),
        "saved_path": saved_path,
        "used_references": [p.name for p in ref_paths],
    }
