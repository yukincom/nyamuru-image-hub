"""Local vision state, service wiring and image analysis pipelines."""

from __future__ import annotations

import importlib.util
import hashlib
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nyamuru_bridge_constants import (
    PANEL_ACTION_LLM_MODE_MANAGED,
    PANEL_ACTION_LLM_MODE_AUTO,
    PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED,
    FIGURE_PERFORMANCE_SIZES,
    CHARACTER_REFERENCE_VIEWS,
)
from nyamuru_bridge_identity import LAYOUT_PROTOCOL_VERSION
from nyamuru_layout_geometry import (
    MAX_PANEL_AREA_RATIO,
    detect_panel_boxes,
    deduplicate_panel_boxes,
    detect_panel_segments,
    infer_panel_shapes_from_segments,
    recover_missing_panel_rows,
    single_page_role,
    sort_panel_boxes_reading_order,
    strip_reading_order,
    printed_four_panel_strips,
    text_in_header,
    detector_regions,
    detector_boxes,
    detected_person_regions,
    exclude_non_panel_regions,
    exclude_paired_title_header_boxes,
)
from nyamuru_worker_runtime import (
    DEFAULT_VLM_MODEL_LABEL,
    huggingface_hub_cache,
    default_vlm_paths,
    run_local_worker,
    run_figure_performance_worker,
    run_character_reference_worker,
    run_character_reference_set_worker,
    run_character_match_worker,
)
from nyamuru_ocr_util import usable_ocr_lines, rotated_image_bytes, decode_image_data
from nyamuru_scanner_sessions import ScannerSessions
from nyamuru_analog_asset_store import DEFAULT_IMAGE_HUB_ROOT, AnalogAssetStore
from nyamuru_series_catalog_store import DEFAULT_SERIES_CATALOG_ROOT, SeriesCatalogStore
from nyamuru_episode_workspace import EpisodeWorkspaceManager
from nyamuru_panel_actions import (
    DEFAULT_PANEL_ACTION_LLM_URL,
    SHARED_PANEL_ACTION_LLM_MODEL,
    PanelActionSuggester,
)
from nyamuru_comfy_draft import DEFAULT_COMFYUI_URL, ComfyUIDraftGenerator
from nyamuru_panel_draft_jobs import PanelDraftJobService
from qwen_generation import QwenGenerationService
from generation_store import GenerationCacheStore, DEFAULT_CACHE_ROOT
from nyamuru_human_pose_store import HumanPoseStore
from nyamuru_editor_voice import EditorVoiceService
from nyamuru_voice_intent import VoiceIntentService
from nyamuru_agent_chat import AgentChatService


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


class LocalVisionState:
    def __init__(
        self,
        vision_root: Path,
        vision_python: Path,
        rtdetr_model: Path,
        baberu_model: Path,
        series_root: Path = DEFAULT_SERIES_CATALOG_ROOT,
        image_hub_root: Path = DEFAULT_IMAGE_HUB_ROOT,
        panel_action_llm_url: str = DEFAULT_PANEL_ACTION_LLM_URL,
        comfyui_url: str = DEFAULT_COMFYUI_URL,
        vlm_python: Path | None = None,
        vlm_model: Path | None = None,
        vlm_model_label: str = DEFAULT_VLM_MODEL_LABEL,
        wd_expression_model: Path | None = None,
        wd_expression_tags: Path | None = None,
        wd_expression_threshold: float = 0.35,
        panel_action_llm_mode: str = PANEL_ACTION_LLM_MODE_AUTO,
    ):
        self.vision_root = vision_root.expanduser().absolute()
        self.rtdetr_python = vision_python.expanduser().absolute()
        self.rtdetr_model = rtdetr_model.expanduser().absolute()
        self.baberu_model = baberu_model.expanduser().absolute()
        vlm_defaults = default_vlm_paths()
        selected_vlm_python = vlm_python or vlm_defaults["vlm_python"]
        selected_vlm_model = vlm_model or vlm_defaults["vlm_model"]
        if not isinstance(selected_vlm_python, Path) or not isinstance(selected_vlm_model, Path):
            raise TypeError("VLMのローカルパスが正しくありません")
        self.vlm_python = selected_vlm_python.expanduser().absolute()
        self.vlm_model = selected_vlm_model.expanduser().absolute()
        self.vlm_model_label = vlm_model_label.strip() or DEFAULT_VLM_MODEL_LABEL
        self.vlm_cache_root = huggingface_hub_cache()
        self.wd_expression_model = (
            wd_expression_model or self.vision_root / "models" / "wd-vit-tagger-v3" / "model.onnx"
        ).expanduser().absolute()
        self.wd_expression_tags = (
            wd_expression_tags or self.vision_root / "models" / "wd-vit-tagger-v3" / "selected_tags.csv"
        ).expanduser().absolute()
        self.wd_expression_threshold = max(0.0, min(1.0, float(wd_expression_threshold)))
        self.editor_voice = EditorVoiceService()
        self.voice_intent = VoiceIntentService()
        self.scanners = ScannerSessions()
        self.episode_workspaces = EpisodeWorkspaceManager()
        self.series_catalogs = SeriesCatalogStore(series_root)
        self.human_poses = HumanPoseStore(Path(__file__).resolve().parents[1] / '.human_pose')
        self.analog_assets = AnalogAssetStore(image_hub_root)
        if panel_action_llm_mode not in {
            PANEL_ACTION_LLM_MODE_AUTO,
            PANEL_ACTION_LLM_MODE_MANAGED,
            PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED,
        }:
            raise ValueError("文章LLMの所有モードが正しくありません")
        self.panel_action_llm_mode = panel_action_llm_mode
        self.panel_actions = PanelActionSuggester(
            panel_action_llm_url,
            SHARED_PANEL_ACTION_LLM_MODEL
            if panel_action_llm_mode in {PANEL_ACTION_LLM_MODE_AUTO, PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED}
            else None,
        )
        self.panel_drafts = ComfyUIDraftGenerator(comfyui_url)
        self.agent_chat = AgentChatService(self.panel_actions.endpoint, self.panel_actions.request_model)
        self.panel_draft_jobs = PanelDraftJobService(self.episode_workspaces, self.panel_drafts)
        self.qwen_jobs = QwenGenerationService(endpoint=comfyui_url)
        self.generation_cache = GenerationCacheStore(DEFAULT_CACHE_ROOT)
        # HTTP経由のRT-DETR/OCR/WD/VLMを一列にする。外部のLLMやComfyUIはこのlockの対象外。
        self.analysis_lock = threading.Lock()
        self.panel_action_lock = threading.Lock()

    def resolve_vlm_model(self, requested_model_value: object = None) -> tuple[Path, str]:
        requested = requested_model_value.strip() if isinstance(requested_model_value, str) else ""
        if not requested:
            return self.vlm_model, self.vlm_model_label
        label = requested
        if label == self.vlm_model_label:
            return self.vlm_model, label
        if not re.fullmatch(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+", label) or len(label) > 200:
            raise ValueError("VLMモデルはローカルキャッシュの Hugging Face モデルIDで指定してください")
        cache_root = self.vlm_cache_root / f"models--{label.replace('/', '--')}"
        reference = cache_root / "refs" / "main"
        revision = ""
        try:
            revision = reference.read_text(encoding="utf-8").strip()
        except OSError:
            snapshots = [path for path in (cache_root / "snapshots").glob("*") if path.is_dir()]
            if len(snapshots) == 1:
                return snapshots[0].absolute(), label
        if re.fullmatch(r"[0-9a-fA-F]{7,64}", revision):
            snapshot = (cache_root / "snapshots" / revision).absolute()
            if snapshot.is_dir():
                return snapshot, label
        raise FileNotFoundError(f"指定したVLMモデルはローカルキャッシュにありません: {label}")

    def vlm_available(self, model: Path | None = None) -> bool:
        selected_model = model or self.vlm_model
        weights_available = (
            (selected_model / "model.safetensors.index.json").is_file()
            or any(selected_model.glob("*.safetensors"))
        )
        return (
            self.vlm_python.is_file()
            and selected_model.is_dir()
            and (selected_model / "config.json").is_file()
            and weights_available
            and Path(__file__).with_name("local_figure_performance_worker.py").is_file()
            and Path(__file__).with_name("local_character_reference_worker.py").is_file()
            and Path(__file__).with_name("local_character_match_worker.py").is_file()
        )

    def wd_expression_available(self) -> bool:
        return (
            self.wd_expression_model.is_file()
            and self.wd_expression_tags.is_file()
            and Path(__file__).with_name("local_wd_expression_tagger.py").is_file()
            and importlib.util.find_spec("onnxruntime") is not None
        )

    def expression_tagging(self, image_bytes: bytes) -> dict[str, Any]:
        if not self.wd_expression_available():
            return {}
        try:
            # WDのONNX sessionも短命workerに所有させ、VLM起動前にプロセスごと解放する。
            return run_local_worker(
                python=Path(sys.executable), engine="wd-expression", root=self.vision_root,
                image_bytes=image_bytes, model=self.wd_expression_model,
                request={"tags_path": str(self.wd_expression_tags), "threshold": self.wd_expression_threshold},
            )
        except Exception as exc:
            # WD is a local expression aid. Its absence or a damaged optional model
            # must not disable the established Qwen-only figure-reading path.
            print(f"[bridge] WD expression hint skipped: {exc}", file=sys.stderr)
            return {}

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

    def check(self) -> dict[str, Any]:
        return {
            "rtdetr_available": self.rtdetr_python.is_file() and self.rtdetr_model.is_file(),
            "vision_python": str(self.rtdetr_python),
            "rtdetr_model": str(self.rtdetr_model),
            "baberu_available": (
                self.rtdetr_python.is_file()
                and (self.baberu_model / "onnx_infer.py").is_file()
                and (self.baberu_model / "onnx" / "vision_int4.onnx").is_file()
                and (self.baberu_model / "onnx" / "decoder_prefill_int8.onnx").is_file()
                and (self.baberu_model / "onnx" / "decoder_step_int8.onnx").is_file()
                and (self.baberu_model / "tokenizer" / "vocab.json").is_file()
            ),
            "baberu_model": str(self.baberu_model),
            "vlm_available": self.vlm_available(),
            "vlm_python": str(self.vlm_python),
            "vlm_model": str(self.vlm_model),
            "vlm_model_label": self.vlm_model_label,
            "vlm_external_network": False,
            "wd_expression_available": self.wd_expression_available(),
            "wd_expression_model": str(self.wd_expression_model),
            "wd_expression_tags": str(self.wd_expression_tags),
            "wd_expression_threshold": self.wd_expression_threshold,
            "scanner_available": Path("/System/Applications/Image Capture.app").is_dir(),
            "image_hub_root": str(self.analog_assets.root),
            "panel_action_llm_url": self.panel_actions.endpoint,
            "panel_action_llm_mode": self.panel_action_llm_mode,
            "image_generation_lifecycle_version": 2,
            "comfyui_url": self.panel_drafts.endpoint,
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

    def analyze(
        self,
        image_bytes: bytes,
        rotation_override: int | None = None,
    ) -> dict[str, Any]:
        if rotation_override is None:
            raise ValueError("解析前にプレビューで画像を正立させてください")
        upright_bytes = rotated_image_bytes(image_bytes, rotation_override)

        detection = run_local_worker(
            python=self.rtdetr_python,
            engine="rtdetr",
            root=self.vision_root,
            image_bytes=upright_bytes,
            model=self.rtdetr_model,
            confidence=0.2,
        )
        all_frames = detector_boxes(detection, "frames", max_area_ratio=1.0)
        page_role = single_page_role(detection, all_frames, upright_bytes)
        raw_rtdetr_boxes = [box for box in all_frames if box[2] * box[3] <= MAX_PANEL_AREA_RATIO]
        segments = detect_panel_segments(upright_bytes) if raw_rtdetr_boxes and not page_role else []
        rtdetr_boxes, rtdetr_excluded = exclude_non_panel_regions(raw_rtdetr_boxes, detection, segments=segments)
        rtdetr_boxes, rtdetr_headers = exclude_paired_title_header_boxes(rtdetr_boxes)
        rtdetr_boxes = deduplicate_panel_boxes(rtdetr_boxes, segments=segments)
        if page_role or rtdetr_boxes:
            layout_boxes, detector_name = rtdetr_boxes, "RT-DETR"
            if page_role == "borderless":
                layout_boxes = all_frames
            elif page_role == "title":
                layout_boxes = []
            selected_excluded = rtdetr_excluded
            selected_headers = rtdetr_headers
        else:
            raw_opencv_boxes = detect_panel_boxes(upright_bytes)
            opencv_boxes, opencv_excluded = exclude_non_panel_regions(raw_opencv_boxes, detection)
            opencv_boxes, opencv_headers = exclude_paired_title_header_boxes(opencv_boxes)
            opencv_boxes = deduplicate_panel_boxes(opencv_boxes)
            layout_boxes, detector_name = opencv_boxes, "OpenCV補助"
            selected_excluded = opencv_excluded
            selected_headers = opencv_headers
        recovered_row_count = 0
        if rtdetr_boxes and not page_role:
            layout_boxes = recover_missing_panel_rows(layout_boxes, segments, detection)
            recovered_row_count = len(layout_boxes) - len(rtdetr_boxes)
        elif layout_boxes and not raw_rtdetr_boxes and not page_role:
            segments = detect_panel_segments(upright_bytes)
        layout_boxes = sort_panel_boxes_reading_order(layout_boxes)
        # The thin-title path already established a layout. Only investigate
        # still-unclassified frames for a pair of taller, lettered titles.
        printed_strips = None
        if not selected_headers and len(layout_boxes) == 10:
            printed_strips = printed_four_panel_strips(layout_boxes, detection, segments)
        if printed_strips:
            layout_boxes, selected_headers = printed_strips
            panel_shapes = [{"type": "rect", "x": x, "y": y, "w": w, "h": h} for x, y, w, h in layout_boxes]
        elif page_role == "borderless":
            panel_shapes = [{"type": "rect", "x": 0, "y": 0, "w": 1, "h": 1}]
        else:
            panel_shapes = infer_panel_shapes_from_segments(layout_boxes, segments)
        if len(panel_shapes) != len(layout_boxes):
            raise RuntimeError(
                "コマ形状と検出枠の対応が崩れたため、誤った配置を返さず解析を中止しました"
            )
        order = range(len(layout_boxes)) if printed_strips else strip_reading_order(layout_boxes, selected_headers)
        panels = [
            {
                "id": f"panel-{index + 1:03d}",
                "detector_box": [round(value, 6) for value in layout_boxes[i]],
                "shape": panel_shapes[i],
            }
            for index, i in enumerate(order)
        ]
        detected_count = len(panel_shapes)

        text_regions = []
        buckets = detection.get("detections") if isinstance(detection.get("detections"), dict) else {}
        if isinstance(buckets.get("texts"), list):
            text_regions = [item for item in buckets["texts"] if isinstance(item, dict)]
        if text_regions and page_role != "title":
            ocr_payload = run_local_worker(
                python=self.rtdetr_python,
                engine="baberu",
                root=self.vision_root,
                image_bytes=upright_bytes,
                model=self.baberu_model,
                request={"regions": text_regions},
            )
            ocr_lines = usable_ocr_lines(ocr_payload, borderless=page_role == "borderless")
            if printed_strips:
                ocr_lines = [line for line in ocr_lines if not any(
                    text_in_header(line["bbox"], header) for header in selected_headers
                )]
        else:
            ocr_lines = []

        if detected_count:
            result = {
                "layout_protocol_version": LAYOUT_PROTOCOL_VERSION,
                "panels": panels,
                "reason": f"{detector_name}と枠線解析で復元した{detected_count}個のコマ形状を、テンプレートへ変換せず編集開始位置として使用します。",
            }
            if page_role == "borderless":
                result["reason"] = "人物が描かれた全面の絵を、原稿の四隅まで1コマとして取り込みます。"
            if recovered_row_count:
                result["reason"] += f" 原稿の仕切り線から中間の{recovered_row_count}コマを補いました。"
            if sum(selected_excluded.values()):
                result["reason"] += f" 文字・人物との信頼度競合で弱い枠候補を{sum(selected_excluded.values())}個除外しました。"
            if selected_headers:
                result["reason"] += f" 本文コマ直前の対になったタイトル枠を{len(selected_headers)}個除外しました。"
        else:
            result = {
                "layout_protocol_version": LAYOUT_PROTOCOL_VERSION,
                "panels": [],
                "reason": "専用検出器で読み取れるコマ領域が見つかりませんでした。手動プリセットを選ぶか、コマ枠を描き足して再解析してください。",
            }
            if page_role == "title":
                result["reason"] = "文字が中央にまとまった表紙と判定しました。用紙の外枠と題字を本文のコマやふきだしとして取り込みません。"
        result["structure"] = {
            "engine": detector_name,
            "excluded_as_text_count": selected_excluded["texts"],
            "excluded_as_face_count": selected_excluded["faces"],
            "excluded_as_body_count": selected_excluded["bodies"],
            "excluded_as_header_count": len(selected_headers),
            "text_region_count": len(detector_boxes(detection, "texts", max_area_ratio=0.45)),
            "face_region_count": len(detector_boxes(detection, "faces", max_area_ratio=0.45)),
            "body_region_count": len(detector_boxes(detection, "bodies", max_area_ratio=0.82)),
            "polygon_panel_count": sum(1 for shape in panel_shapes if shape.get("type") == "polygon"),
        }
        result["ocr"] = {
            "engine": "Baberu OCR",
            "lines": ocr_lines,
        }
        if printed_strips:
            result["structure"]["independent_four_panel_strips"] = True
        result["people"] = {
            "regions": detected_person_regions(detection),
        }
        return result
