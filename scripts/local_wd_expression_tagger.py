#!/usr/bin/env python3
"""Extract expression-only visual hints with a local WD Tagger ONNX model."""

from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path
from typing import Any, Callable


MODEL_LABEL = "SmilingWolf/wd-vit-tagger-v3"
PINNED_REVISION = "7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f"
PINNED_MODEL_SHA256 = "35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6"
PINNED_TAGS_SHA256 = "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217"
DEFAULT_THRESHOLD = 0.35
MAX_HINTS = 12
STRUCTURAL_TAG_THRESHOLDS = {
    # On simplified manga faces these direct shapes score below WD's general
    # threshold even when clearly drawn. Keep the lower thresholds narrow and
    # evidence-backed; do not lower thresholds for emotion-family labels.
    "wide-eyed": 0.10,
    "v-shaped_eyebrows": 0.08,
}

# This is intentionally an exact allowlist. General WD tags about identity, body,
# clothes, text, ratings, and image composition must never reach the expression
# prompt merely because they happen to score highly.
EXPRESSION_ENGLISH: dict[str, str] = {
    "blush": "blush marks are visible on the cheeks",
    "light_blush": "faint blush marks are visible on the cheeks",
    "nose_blush": "blush is concentrated around the nose",
    "full-face_blush": "strong blush covers much of the face",
    "blush_stickers": "stylized blush marks are visible on the cheeks",
    "smile": "the mouth has a smile-like upward curve; judge the final smile strength from the image",
    "light_smile": "the mouth has a faint smile-like curve",
    "grin": "the mouth shows a broad grin",
    "smirk": "the mouth shows an asymmetric smirk",
    "evil_smile": "the mouth shows a menacing smile",
    "evil_grin": "the mouth shows a menacing grin",
    "seductive_smile": "the mouth shows a deliberate alluring smile",
    "nervous_smile": "the mouth shows an uneasy smile",
    "false_smile": "the mouth shows a strained or forced smile",
    "forced_smile": "the mouth shows a strained or forced smile",
    "crazy_smile": "the mouth shows an unusually intense smile",
    "laughing": "the person appears to be laughing",
    "happy": "the visible expression appears happy",
    "open_mouth": "the mouth is open",
    "closed_mouth": "the mouth is closed",
    "teeth": "teeth are visible",
    "upper_teeth_only": "only the upper teeth are visible",
    "lower_teeth_only": "only the lower teeth are visible",
    "clenched_teeth": "the teeth are clenched",
    "tongue_out": "the tongue is sticking out",
    "wavy_mouth": "the mouth is drawn as a wavy line",
    "sideways_mouth": "the mouth is shifted or pulled to one side",
    "triangle_mouth": "the mouth is drawn as a triangle",
    "chestnut_mouth": "the mouth is drawn as a wide rounded triangle",
    "dot_mouth": "the mouth is drawn as a small dot",
    "rectangular_mouth": "the mouth is drawn as a rectangle",
    "no_mouth": "no mouth is visibly drawn",
    "pout": "the mouth is pouting",
    "closed_eyes": "both eyes are closed",
    "one_eye_closed": "one eye is closed",
    "half-closed_eyes": "both eyes are half closed",
    "half-closed_eye": "one visible eye is half closed",
    "narrowed_eyes": "the eyes are narrowed",
    "wide-eyed": "the eyes are opened wide",
    "v-shaped_eyebrows": "the eyebrows form a sharp V shape",
    "raised_eyebrows": "both eyebrows are raised",
    "raised_eyebrow": "one eyebrow is raised",
    "furrowed_brow": "the brow is furrowed",
    "angry": "a coarse expression tag suggests anger; verify the eyebrows, eyes, and mouth",
    "annoyed": "a coarse expression tag suggests annoyance; verify the eyebrows, eyes, and mouth",
    "embarrassed": "a coarse expression tag suggests embarrassment; verify the face directly",
    "surprised": "a coarse expression tag suggests surprise; verify eye opening, eyebrows, and mouth",
    "scared": "a coarse expression tag suggests fear; verify the eyes, eyebrows, and mouth",
    "sad": "a coarse expression tag suggests sadness; verify the eyes, eyebrows, and mouth",
    "nervous": "a coarse expression tag suggests nervousness; verify the face directly",
    "confused": "a coarse expression tag suggests confusion; verify the face directly",
    "worried": "a coarse expression tag suggests worry; verify the eyes, eyebrows, and mouth",
    "sleepy": "a coarse expression tag suggests sleepiness; verify eyelid opening from the image",
    "crying": "the person is visibly crying",
    "crying_with_eyes_open": "the person is crying with open eyes",
    "tears": "tears are visible",
    "tearing_up": "tears are beginning to form",
    "streaming_tears": "tears are streaming down the face",
    "happy_tears": "tears accompany an apparently happy expression",
    "sweat": "sweat marks are visible on the face",
    "sweatdrop": "a manga sweat-drop symbol is visible",
    "flying_sweatdrops": "multiple manga sweat-drop symbols are visible",
    "nervous_sweating": "sweat marks accompany an uneasy expression",
    "very_sweaty": "many sweat marks are visible",
    "trembling": "the face or body has trembling marks",
    "shaded_face": "part of the face is shaded to emphasize the expression",
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def source_identity(model_path: Path, tags_path: Path) -> dict[str, Any]:
    model_sha256 = file_sha256(model_path)
    tags_sha256 = file_sha256(tags_path)
    verified = model_sha256 == PINNED_MODEL_SHA256 and tags_sha256 == PINNED_TAGS_SHA256
    return {
        "model": MODEL_LABEL if verified else "local WD expression tagger override",
        "revision": PINNED_REVISION if verified else "",
        "model_sha256": model_sha256,
        "tags_sha256": tags_sha256,
        "verified_pinned_artifacts": verified,
    }


def load_tag_rows(path: Path) -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            name = str(row.get("name") or "").strip()
            try:
                category = int(row.get("category") or -1)
            except (TypeError, ValueError):
                category = -1
            rows.append((name, category))
    if not rows:
        raise ValueError("WD Taggerのタグ一覧が空です")
    return rows


def expression_hints_from_scores(
    tag_rows: list[tuple[str, int]],
    scores: list[float],
    *,
    threshold: float = DEFAULT_THRESHOLD,
    limit: int = MAX_HINTS,
) -> list[dict[str, Any]]:
    if len(tag_rows) != len(scores):
        raise ValueError("WD Taggerの出力数とタグ一覧が一致しません")
    candidates: list[tuple[float, str, str, float]] = []
    for (tag, category), raw_score in zip(tag_rows, scores):
        score = float(raw_score)
        natural = EXPRESSION_ENGLISH.get(tag)
        required_score = min(threshold, STRUCTURAL_TAG_THRESHOLDS.get(tag, threshold))
        if category == 0 and natural and score >= required_score:
            candidates.append((score, tag, natural, required_score))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    return [
        {
            "tag": tag,
            "score": round(score, 4),
            "threshold": round(required_score, 4),
            "text": natural,
        }
        for score, tag, natural, required_score in candidates[: max(0, min(limit, MAX_HINTS))]
    ]


class WdExpressionTagger:
    """Reuse the ONNX session inside one short-lived worker, never in the bridge."""

    def __init__(
        self,
        model_path: Path,
        tags_path: Path,
        *,
        threshold: float = DEFAULT_THRESHOLD,
        session_factory: Callable[[str], Any] | None = None,
    ):
        self.model_path = model_path.expanduser().absolute()
        self.tags_path = tags_path.expanduser().absolute()
        self.threshold = max(0.0, min(1.0, float(threshold)))
        self._session_factory = session_factory
        self._session: Any | None = None
        self._tag_rows: list[tuple[str, int]] | None = None
        self._source_identity: dict[str, Any] | None = None

    def _load(self) -> tuple[Any, list[tuple[str, int]]]:
        if self._session is None:
            if not self.model_path.is_file() or not self.tags_path.is_file():
                raise FileNotFoundError("WD Taggerのローカルモデルが見つかりません")
            self._source_identity = source_identity(self.model_path, self.tags_path)
            if self._session_factory is None:
                import onnxruntime

                self._session = onnxruntime.InferenceSession(
                    str(self.model_path),
                    providers=["CPUExecutionProvider"],
                )
            else:
                self._session = self._session_factory(str(self.model_path))
        if self._tag_rows is None:
            self._tag_rows = load_tag_rows(self.tags_path)
        return self._session, self._tag_rows

    @staticmethod
    def _input_size(session: Any) -> int:
        shape = list(session.get_inputs()[0].shape)
        for value in shape:
            if isinstance(value, int) and value >= 128:
                return value
        return 448

    @staticmethod
    def _prepare_image(image_bytes: bytes, size: int) -> Any:
        import numpy
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(image_bytes)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
            white = Image.new("RGBA", image.size, (255, 255, 255, 255))
            image = Image.alpha_composite(white, image).convert("RGB")
        side = max(image.size)
        square = Image.new("RGB", (side, side), "white")
        square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
        resized = square.resize((size, size), Image.Resampling.BICUBIC)
        rgb = numpy.asarray(resized, dtype=numpy.float32)
        bgr = rgb[:, :, ::-1]
        return numpy.expand_dims(bgr, axis=0)

    def analyze(self, image_bytes: bytes) -> dict[str, Any]:
        session, tag_rows = self._load()
        input_meta = session.get_inputs()[0]
        image = self._prepare_image(image_bytes, self._input_size(session))
        raw = session.run(None, {input_meta.name: image})[0]
        scores = raw[0].tolist() if getattr(raw, "ndim", 0) >= 2 else raw.tolist()
        hints = expression_hints_from_scores(tag_rows, scores, threshold=self.threshold)
        return {
            "hints": hints,
            "source": {
                "provider": "wd-tagger",
                **(self._source_identity or source_identity(self.model_path, self.tags_path)),
                "threshold": self.threshold,
                "structural_thresholds": STRUCTURAL_TAG_THRESHOLDS,
                "expression_only": True,
            },
        }
