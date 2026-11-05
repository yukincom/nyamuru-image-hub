"""Analyze figure performance, reference sheets and character matches with the active vision state."""

from __future__ import annotations

import hashlib
import re
import subprocess
from datetime import datetime, timezone
from typing import Any
from nyamuru_bridge_constants import FIGURE_PERFORMANCE_SIZES, CHARACTER_REFERENCE_VIEWS
from nyamuru_worker_runtime import (
    run_figure_performance_worker,
    run_character_reference_worker,
    run_character_reference_set_worker,
    run_character_match_worker,
)
from nyamuru_ocr_util import decode_image_data


def valid_performance_action(action: object, analysis: object) -> bool:
    if not isinstance(action, str) or len(action) > 800:
        return False
    if action.strip():
        return True
    # No visible performance is a valid result; a missing or malformed response is not.
    expression = analysis.get("expression") if isinstance(analysis, dict) else None
    return (isinstance(expression, dict) and isinstance(expression.get("faces"), list)
            and bool(expression.get("catalog_version"))
            and isinstance(expression.get("catalog_sha256"), str)
            and bool(re.fullmatch(r"[a-f0-9]{64}", expression["catalog_sha256"])))


class VisionCharacterAnalysis:
    def expression_worker_fields(
        self, figure_image: bytes, face_image: bytes | None, face_bbox: object,
    ) -> dict[str, Any]:
        if face_image is None and face_bbox is None:
            # Qwen will localize the face in its pose pass. Whole-body WD tags are unrelated.
            return {}
        from local_figure_performance_worker import normalized_bbox
        box = normalized_bbox(face_bbox)
        if box is None or (face_image is None and box != [0, 0, 1, 1]):
            raise ValueError("表情用の顔の切り抜きと人物内の位置が一致しません")
        if face_image is not None and not face_image:
            raise ValueError("表情用の顔画像が空です")
        return {
            "face_bbox": box, "face_image_bytes": face_image,
            "expression_tagging": self.expression_tagging(figure_image if face_image is None else face_image),
        }

    def analyze_figure_performance(
        self, image_bytes: bytes, current_size: object, requested_vlm_model: object = None,
        *, face_image_bytes: bytes | None = None, face_bbox: object = None,
    ) -> dict[str, Any]:
        if not isinstance(current_size, str) or current_size not in FIGURE_PERFORMANCE_SIZES:
            raise ValueError("人物の描写範囲が正しくありません")
        selected_model, selected_label = self.resolve_vlm_model(requested_vlm_model)
        if not self.vlm_available(selected_model):
            raise FileNotFoundError(
                "Qwen3-VL/MLXのローカル環境が見つかりません。`npm run bridge:check-vlm`で配置を確認してください"
            )
        try:
            result = run_figure_performance_worker(
                python=self.vlm_python,
                model=selected_model,
                image_bytes=image_bytes,
                current_size=current_size,
                **self.expression_worker_fields(image_bytes, face_image_bytes, face_bbox),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("人物演技のローカルVLM解析が時間内に完了しませんでした") from exc
        action = result.get("suggested_action")
        suggested_size = result.get("suggested_size")
        analysis = result.get("analysis")
        if not valid_performance_action(action, analysis):
            raise RuntimeError("人物演技の候補形式が正しくありません")
        if not isinstance(suggested_size, str) or suggested_size not in FIGURE_PERFORMANCE_SIZES:
            suggested_size = current_size
        if not isinstance(analysis, dict):
            raise RuntimeError("人物演技の観察結果形式が正しくありません")
        return {
            "action": action.strip(),
            "suggested_size": suggested_size,
            "analysis": analysis,
            "analyzer": {
                "provider": "local",
                "runtime": "mlx-vlm",
                "model": selected_label,
                "prompt_version": str(result.get("prompt_version") or ""),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    def analyze_character_reference(
        self, image_bytes: bytes, target_character_value: object, requested_vlm_model: object = None,
    ) -> dict[str, Any]:
        # アナログネームとは異なるパイプライン、一枚のイラストからデザインを抽出する。
        target_character = target_character_value.strip()[:100] if isinstance(target_character_value, str) else ""
        selected_model, selected_label = self.resolve_vlm_model(requested_vlm_model)
        if not self.vlm_available(selected_model):
            raise FileNotFoundError(
                "Qwen3-VL/MLXのローカル環境が見つかりません。`npm run bridge:check-vlm`で配置を確認してください"
            )
        try:
            result = run_character_reference_worker(
                python=self.vlm_python,
                model=selected_model,
                image_bytes=image_bytes,
                target_character=target_character,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("人物資料のローカルVLM解析が時間内に完了しませんでした") from exc
        recognition = result.get("recognition")
        if not isinstance(recognition, dict):
            raise RuntimeError("人物資料の照合特徴形式が正しくありません")
        reference_view = result.get("reference_view")
        if not isinstance(reference_view, str) or reference_view not in CHARACTER_REFERENCE_VIEWS:
            reference_view = "other"
        return {
            "recognition": recognition,
            "reference_view": reference_view,
            "analyzer": {
                "provider": "local",
                "runtime": "mlx-vlm",
                "model": selected_label,
                "prompt_version": str(result.get("prompt_version") or ""),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    def analyze_character_reference_set(
        self,
        series_id_value: object,
        character_id_value: object,
        asset_ids_value: object,
        target_character_value: object,
        requested_vlm_model: object = None,
        supplied_images_value: object = None,
    ) -> dict[str, Any]:
        # アナログネームとは異なるパイプライン、一枚のイラストからデザインを抽出する。
        if not isinstance(asset_ids_value, list) or not 1 <= len(asset_ids_value) <= 12:
            raise ValueError("一括解析する人物資料画像は1〜12枚にしてください")
        asset_ids: list[str] = []
        for value in asset_ids_value:
            if not isinstance(value, str) or not re.fullmatch(r"image-[a-f0-9]{64}", value) or value in asset_ids:
                raise ValueError("一括解析する人物資料画像のIDが正しくありません")
            asset_ids.append(value)
        target_character = target_character_value.strip()[:100] if isinstance(target_character_value, str) else ""
        selected_model, selected_label = self.resolve_vlm_model(requested_vlm_model)
        if not self.vlm_available(selected_model):
            raise FileNotFoundError(
                "Qwen3-VL/MLXのローカル環境が見つかりません。`npm run bridge:check-vlm`で配置を確認してください"
            )
        image_payloads: list[bytes] = []
        if supplied_images_value is not None and (
            not isinstance(supplied_images_value, list) or len(supplied_images_value) != len(asset_ids)
        ):
            raise ValueError("人物資料画像とIDの件数が一致しません")
        total_bytes = 0
        for index, asset_id in enumerate(asset_ids):
            if supplied_images_value is None:
                loaded = self.series_catalogs.read_character_image(series_id_value, character_id_value, asset_id)
                if loaded.get("found") is not True:
                    raise FileNotFoundError("一括解析する人物資料画像が見つかりません")
                image_payload = loaded.pop("image_bytes")
            else:
                image_payload = decode_image_data(supplied_images_value[index])
                if not image_payload.startswith(b"\x89PNG\r\n\x1a\n") or hashlib.sha256(image_payload).hexdigest() != asset_id[6:]:
                    raise ValueError("人物資料画像の内容がIDと一致しません")
            total_bytes += len(image_payload)
            if total_bytes > 80 * 1024 * 1024:
                raise ValueError("一括解析する人物資料画像の合計サイズは80MB以内にしてください")
            image_payloads.append(image_payload)
        try:
            result = run_character_reference_set_worker(
                python=self.vlm_python,
                model=selected_model,
                image_bytes=image_payloads,
                target_character=target_character,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("人物資料の一括解析が時間内に完了しませんでした") from exc
        recognition = result.get("recognition")
        raw_views = result.get("reference_views")
        raw_confidences = result.get("reference_view_confidences")
        if not isinstance(recognition, dict) or not isinstance(raw_views, list) or len(raw_views) != len(asset_ids):
            raise RuntimeError("人物資料の一括解析結果形式が正しくありません")
        views = [view if isinstance(view, str) and view in CHARACTER_REFERENCE_VIEWS else "other" for view in raw_views]
        confidences = [
            value if value in {"high", "medium", "low"} else "low"
            for value in (raw_confidences if isinstance(raw_confidences, list) else [])
        ]
        if len(confidences) != len(asset_ids):
            confidences = ["low"] * len(asset_ids)
        statistics = result.get("trait_statistics") if isinstance(result.get("trait_statistics"), dict) else {}
        return {
            "recognition": recognition,
            "reference_views": [
                {"asset_id": asset_id, "view": view, "confidence": confidence}
                for asset_id, view, confidence in zip(asset_ids, views, confidences)
            ],
            "trait_statistics": statistics,
            "analyzer": {
                "provider": "local",
                "runtime": "mlx-vlm",
                "model": selected_label,
                "prompt_version": str(result.get("prompt_version") or ""),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    def analyze_character_match(
        self,
        image_bytes: bytes,
        candidates_value: object,
        current_size: object,
        requested_vlm_model: object = None,
        *, face_image_bytes: bytes | None = None, face_bbox: object = None,
    ) -> dict[str, Any]:
        if not isinstance(candidates_value, list):
            raise ValueError("照合候補が正しくありません")
        if not isinstance(current_size, str) or current_size not in FIGURE_PERFORMANCE_SIZES:
            raise ValueError("人物の描写範囲が正しくありません")
        candidates: list[dict[str, Any]] = []
        used_ids: set[str] = set()
        for value in candidates_value[:50]:
            if not isinstance(value, dict):
                continue
            candidate_id = value.get("id")
            if not isinstance(candidate_id, str) or not candidate_id.strip() or len(candidate_id) > 160:
                continue
            if candidate_id in used_ids:
                continue
            used_ids.add(candidate_id)
            raw_traits = value.get("observed_traits")
            traits = [item.strip()[:180] for item in raw_traits[:64] if isinstance(item, str) and item.strip()] if isinstance(raw_traits, list) else []
            candidates.append({
                "id": candidate_id,
                "observed_traits": list(dict.fromkeys(traits)),
            })
        selected_model, selected_label = self.resolve_vlm_model(requested_vlm_model)
        if not self.vlm_available(selected_model):
            raise FileNotFoundError(
                "Qwen3-VL/MLXのローカル環境が見つかりません。`npm run bridge:check-vlm`で配置を確認してください"
            )
        try:
            result = run_character_match_worker(
                python=self.vlm_python,
                model=selected_model,
                image_bytes=image_bytes,
                candidates=candidates,
                current_size=current_size,
                **self.expression_worker_fields(image_bytes, face_image_bytes, face_bbox),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("人物照合のローカルVLM解析が時間内に完了しませんでした") from exc
        candidate_id = result.get("candidate_id")
        confidence = result.get("confidence")
        observed = result.get("observed")
        reason = result.get("reason")
        action = result.get("suggested_action")
        suggested_size = result.get("suggested_size")
        analysis = result.get("analysis")
        if not isinstance(candidate_id, str) or candidate_id not in used_ids:
            candidate_id = ""
        if confidence not in {"high", "medium", "low", "none"}:
            confidence = "none"
        if not candidate_id or confidence == "none":
            candidate_id = ""
            confidence = "none"
        if not isinstance(observed, list) or any(not isinstance(item, str) for item in observed):
            observed = []
        if not isinstance(reason, str):
            reason = ""
        if not valid_performance_action(action, analysis):
            raise RuntimeError("人物演技の候補形式が正しくありません")
        if not isinstance(suggested_size, str) or suggested_size not in FIGURE_PERFORMANCE_SIZES:
            suggested_size = current_size
        if not isinstance(analysis, dict):
            raise RuntimeError("人物演技の観察結果形式が正しくありません")
        return {
            "candidate_id": candidate_id,
            "confidence": confidence,
            "observed": [item.strip()[:180] for item in observed[:12] if item.strip()],
            "reason": reason.strip()[:400],
            "action": action.strip(),
            "suggested_size": suggested_size,
            "analysis": analysis,
            "analyzer": {
                "provider": "local",
                "runtime": "mlx-vlm",
                "model": selected_label,
                "prompt_version": str(result.get("prompt_version") or ""),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        }
