"""Extract local training pairs from Nyamuru project snapshots without external transmission."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _iter_pages(project_data: dict[str, Any]) -> list[dict[str, Any]]:
    manga = project_data.get("manga") if isinstance(project_data.get("manga"), dict) else {}
    pages = manga.get("pages") if isinstance(manga.get("pages"), list) else []
    return [page for page in pages if isinstance(page, dict)]


def _iter_bubble_owners(page: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    owners: list[tuple[str, dict[str, Any]]] = []
    for panel in page.get("panels") or []:
        if isinstance(panel, dict):
            owners.append((f"panel-{panel.get('id', '?')}", panel))
    overlay = page.get("page_overlay")
    if isinstance(overlay, dict):
        owners.append(("page_overlay", overlay))
    return owners


def extract_ocr_correction_pairs(project_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect (crop_asset_id, ocr_text, corrected_text, shape) records from edited bubbles."""
    pairs: list[dict[str, Any]] = []
    for page in _iter_pages(project_data):
        page_num = page.get("page")
        for owner_label, owner in _iter_bubble_owners(page):
            for bubble in owner.get("bubbles") or []:
                if not isinstance(bubble, dict):
                    continue
                analog = bubble.get("analogTextImport")
                if not isinstance(analog, dict):
                    continue
                asset_id = str(analog.get("assetId") or "").strip()
                if not asset_id:
                    continue
                corrected = str(bubble.get("text") or "").strip()
                raw_ocr = str(analog.get("ocrText") or "").strip()
                pairs.append({
                    "page": page_num,
                    "owner": owner_label,
                    "asset_id": asset_id,
                    "raw_ocr": raw_ocr,
                    "corrected_text": corrected,
                    "was_corrected": bool(corrected and corrected != raw_ocr),
                    "shape": str(bubble.get("shape") or "normal"),
                    "bbox": bubble.get("bbox"),
                })
    return pairs


def extract_layout_annotations(project_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect panel shapes, reading order, figure boxes, and bubble speaker links per page."""
    annotations: list[dict[str, Any]] = []
    for page in _iter_pages(project_data):
        panels = [p for p in (page.get("panels") or []) if isinstance(p, dict)]
        overlay = page.get("page_overlay") if isinstance(page.get("page_overlay"), dict) else {}
        annotations.append({
            "page": page.get("page"),
            "canvas": page.get("canvas"),
            "panels": [
                {
                    "id": p.get("id"),
                    "shape": p.get("shape"),
                    "figure_count": len(p.get("figures") or []),
                    "bubble_count": len(p.get("bubbles") or []),
                    "speaker_links": [
                        {
                            "bubble_bbox": b.get("bbox"),
                            "speaker_id": b.get("speakerId"),
                            "speaker": b.get("speaker"),
                            "shape": b.get("shape"),
                        }
                        for b in (p.get("bubbles") or [])
                        if isinstance(b, dict) and (b.get("speakerId") or b.get("speaker"))
                    ],
                }
                for p in panels
            ],
            "overlay_figure_count": len(overlay.get("figures") or []),
            "overlay_bubble_count": len(overlay.get("bubbles") or []),
        })
    return annotations


def extract_character_match_pairs(project_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect (analog_asset_id, character_id, view, size) tuples from linked figures."""
    manga = project_data.get("manga") if isinstance(project_data.get("manga"), dict) else {}
    chars = {
        c.get("localId"): c
        for c in (manga.get("characters") or [])
        if isinstance(c, dict) and isinstance(c.get("localId"), str)
    }
    pairs: list[dict[str, Any]] = []
    for page in _iter_pages(project_data):
        page_num = page.get("page")
        for owner_label, owner in _iter_bubble_owners(page):
            for figure in owner.get("figures") or []:
                if not isinstance(figure, dict):
                    continue
                analog = figure.get("analogImport")
                ref_id = figure.get("refId")
                if not isinstance(analog, dict) or not isinstance(ref_id, str) or not ref_id:
                    continue
                asset_id = str(analog.get("assetId") or "").strip()
                if not asset_id:
                    continue
                char = chars.get(ref_id, {})
                pairs.append({
                    "page": page_num,
                    "owner": owner_label,
                    "asset_id": asset_id,
                    "character_id": ref_id,
                    "catalog_id": char.get("catalog_id"),
                    "size": figure.get("size") or "bust-up",
                    "bbox": figure.get("bbox"),
                })
    return pairs


def extract_project_training_samples(project_json_path: Path) -> dict[str, Any]:
    """Read a local `.nyamuru/project.json` file and summarize all flywheel samples."""
    data = json.loads(Path(project_json_path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("project.json の形式が正しくありません")
    ocr_pairs = extract_ocr_correction_pairs(data)
    layout_annotations = extract_layout_annotations(data)
    character_pairs = extract_character_match_pairs(data)
    return {
        "source": str(project_json_path),
        "ocr_pairs": ocr_pairs,
        "layout_annotations": layout_annotations,
        "character_match_pairs": character_pairs,
        "summary": {
            "ocr_total": len(ocr_pairs),
            "ocr_corrected": sum(1 for item in ocr_pairs if item["was_corrected"]),
            "pages": len(layout_annotations),
            "character_matches": len(character_pairs),
        },
    }
