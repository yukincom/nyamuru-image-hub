"""Model-agnostic path resolution for Nyamuru local vision, OCR, and lightweight models."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT.parent
DEFAULT_VISION_ROOT = REPO_ROOT / ".local-vision"
DEFAULT_VLM_MODEL_LABEL = "lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit"
DEFAULT_VLM_CACHE = (
    Path.home()
    / ".cache"
    / "huggingface"
    / "hub"
    / "models--lmstudio-community--Qwen3-VL-8B-Instruct-MLX-4bit"
)


def venv_python(venv_root: Path) -> Path:
    if os.name == "nt":
        return venv_root / "Scripts" / "python.exe"
    return venv_root / "bin" / "python"


def cached_model_snapshot(cache_root: Path) -> Path:
    reference = cache_root / "refs" / "main"
    try:
        revision = reference.read_text(encoding="utf-8").strip()
    except OSError:
        return cache_root / "snapshots" / "missing"
    return cache_root / "snapshots" / revision


def huggingface_hub_cache() -> Path:
    configured = os.environ.get("HF_HUB_CACHE", "").strip()
    if configured:
        return Path(configured).expanduser().absolute()
    hf_home = os.environ.get("HF_HOME", "").strip()
    if hf_home:
        return (Path(hf_home).expanduser() / "hub").absolute()
    xdg_cache = os.environ.get("XDG_CACHE_HOME", "").strip()
    if xdg_cache:
        return (Path(xdg_cache).expanduser() / "huggingface" / "hub").absolute()
    return (Path.home() / ".cache" / "huggingface" / "hub").absolute()


def is_valid_text_ocr_dir(model_dir: Path) -> bool:
    return (
        (model_dir / "onnx_infer.py").is_file()
        and (model_dir / "onnx" / "vision_int4.onnx").is_file()
        and (model_dir / "onnx" / "decoder_prefill_int8.onnx").is_file()
        and (model_dir / "onnx" / "decoder_step_int8.onnx").is_file()
        and (model_dir / "tokenizer" / "vocab.json").is_file()
    )


def resolve_page_detector_model(vision_root: Path, explicit_model: Path | None = None) -> Path:
    if explicit_model is not None:
        return explicit_model.expanduser()
    configured = os.environ.get("NYAMURU_PAGE_DETECTOR_MODEL") or os.environ.get("NYAMURU_RTDETR_MODEL")
    if configured:
        return Path(configured).expanduser()
    return vision_root / "models" / "rtdetrv4-x-manga109s_v2" / "model.onnx"


def resolve_text_ocr_model(vision_root: Path, explicit_model: Path | None = None) -> tuple[Path, bool]:
    """Resolve personal handwriting OCR directory first, falling back to standard OCR."""
    if explicit_model is not None:
        resolved = explicit_model.expanduser()
        return resolved, False
    personal_env = os.environ.get("NYAMURU_PERSONAL_OCR_MODEL", "").strip()
    if personal_env:
        candidate = Path(personal_env).expanduser()
        if is_valid_text_ocr_dir(candidate):
            return candidate, True
    personal_default = vision_root / "models" / "ocr-personal"
    if is_valid_text_ocr_dir(personal_default):
        return personal_default, True
    standard_env = os.environ.get("NYAMURU_TEXT_OCR_MODEL") or os.environ.get("NYAMURU_BABERU_MODEL")
    if standard_env:
        return Path(standard_env).expanduser(), False
    return vision_root / "models" / "baberu-ocr", False


def resolve_orientation_model(vision_root: Path, explicit_model: Path | None = None) -> Path:
    if explicit_model is not None:
        return explicit_model.expanduser()
    configured = os.environ.get("NYAMURU_ORIENTATION_MODEL", "").strip()
    if configured:
        return Path(configured).expanduser()
    return vision_root / "models" / "page-orientation" / "model.onnx"


def resolve_character_encoder_model(vision_root: Path, explicit_model: Path | None = None) -> Path:
    if explicit_model is not None:
        return explicit_model.expanduser()
    configured = os.environ.get("NYAMURU_CHARACTER_ENCODER_MODEL", "").strip()
    if configured:
        return Path(configured).expanduser()
    return vision_root / "models" / "character-encoder" / "model.onnx"


def resolve_layout_relation_model(vision_root: Path, explicit_model: Path | None = None) -> Path:
    if explicit_model is not None:
        return explicit_model.expanduser()
    configured = os.environ.get("NYAMURU_LAYOUT_RELATION_MODEL", "").strip()
    if configured:
        return Path(configured).expanduser()
    return vision_root / "models" / "layout-relation" / "model.onnx"


def default_vision_paths() -> dict[str, Path]:
    vision_root = Path(os.environ.get("NYAMURU_VISION_ROOT", DEFAULT_VISION_ROOT)).expanduser()
    vision_python = Path(
        os.environ.get("NYAMURU_VISION_PYTHON", venv_python(vision_root / ".venv"))
    ).expanduser()
    rtdetr_model = resolve_page_detector_model(vision_root)
    baberu_model, _personal_ocr = resolve_text_ocr_model(vision_root)
    preferred_wd_root = vision_root / "models" / "wd-vit-tagger-v3"
    wd_expression_model = Path(
        os.environ.get("NYAMURU_WD_EXPRESSION_MODEL", preferred_wd_root / "model.onnx")
    ).expanduser()
    wd_expression_tags = Path(
        os.environ.get("NYAMURU_WD_EXPRESSION_TAGS", preferred_wd_root / "selected_tags.csv")
    ).expanduser()
    return {
        "vision_root": vision_root,
        "vision_python": vision_python,
        "rtdetr_model": rtdetr_model,
        "baberu_model": baberu_model,
        "page_detector_model": rtdetr_model,
        "text_ocr_model": baberu_model,
        "orientation_model": resolve_orientation_model(vision_root),
        "character_encoder_model": resolve_character_encoder_model(vision_root),
        "layout_relation_model": resolve_layout_relation_model(vision_root),
        "wd_expression_model": wd_expression_model,
        "wd_expression_tags": wd_expression_tags,
    }


def default_vlm_paths() -> dict[str, Path | str]:
    configured_model = os.environ.get("NYAMURU_VLM_MODEL", "").strip()
    model = Path(configured_model).expanduser() if configured_model else cached_model_snapshot(DEFAULT_VLM_CACHE)
    configured_python = os.environ.get("NYAMURU_VLM_PYTHON", "").strip()
    python = Path(configured_python).expanduser() if configured_python else venv_python(TOOLS_ROOT / "ComfyUI" / ".venv")
    return {
        "vlm_python": python,
        "vlm_model": model,
        "vlm_model_label": os.environ.get("NYAMURU_VLM_MODEL_LABEL", DEFAULT_VLM_MODEL_LABEL).strip()
        or DEFAULT_VLM_MODEL_LABEL,
    }
