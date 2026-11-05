"""Validate panel draft parameters and bind the fixed ComfyUI workflow."""

from __future__ import annotations

import unicodedata
from typing import Any


PANEL_DRAFT_CHECKPOINT = "animagine-xl-3.1.safetensors"
PANEL_DRAFT_PROFILE = "manga-base"
PANEL_DRAFT_WIDTH = 512
PANEL_DRAFT_HEIGHT = 512
PANEL_DRAFT_STEPS = 20
PANEL_DRAFT_CFG = 6.0
PANEL_DRAFT_SEED = 2026082901

class PanelDraftWorkflow:
    @staticmethod
    def checked_text(value: object, label: str, maximum: int, *, required: bool = False) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label}の形式が正しくありません")
        text = unicodedata.normalize("NFKC", value).strip()
        if required and not text:
            raise ValueError(f"{label}が空です")
        if len(text) > maximum:
            raise ValueError(f"{label}が長すぎます")
        return text

    @staticmethod
    def checked_integer(value: object, label: str, minimum: int, maximum: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
            raise ValueError(f"{label}の値が正しくありません")
        return value

    @classmethod
    def normalized_request(cls, body: dict[str, Any]) -> dict[str, Any]:
        page_number = cls.checked_integer(body.get("page_number"), "ページ番号", 1, 100000)
        panel_id = cls.checked_integer(body.get("panel_id"), "コマ番号", 1, 1000000)
        profile = cls.checked_text(body.get("profile"), "生成プロファイル", 100, required=True)
        if profile != PANEL_DRAFT_PROFILE:
            raise ValueError("作画用ラフではmanga-baseプロファイルだけを使用できます")
        checkpoint = cls.checked_text(body.get("checkpoint"), "チェックポイント", 200, required=True)
        if checkpoint != PANEL_DRAFT_CHECKPOINT:
            raise ValueError("作画用ラフでは固定のAnimagineチェックポイントだけを使用できます")

        fixed_integers = {
            "width": PANEL_DRAFT_WIDTH,
            "height": PANEL_DRAFT_HEIGHT,
            "steps": PANEL_DRAFT_STEPS,
        }
        for key, expected in fixed_integers.items():
            if body.get(key) != expected:
                raise ValueError("作画用ラフの解像度とステップ数は固定です")
        cfg = body.get("cfg")
        if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or float(cfg) != PANEL_DRAFT_CFG:
            raise ValueError("作画用ラフのCFGは固定です")
        if body.get("seed") != PANEL_DRAFT_SEED:
            raise ValueError("作画用ラフのシードは固定です")

        return {
            "page_number": page_number,
            "panel_id": panel_id,
            "profile": profile,
            "positive_prompt": cls.checked_text(body.get("positive_prompt"), "ポジティブプロンプト", 12000, required=True),
            "negative_prompt": cls.checked_text(body.get("negative_prompt"), "ネガティブプロンプト", 8000, required=True),
            "checkpoint": checkpoint,
            "width": PANEL_DRAFT_WIDTH,
            "height": PANEL_DRAFT_HEIGHT,
            "steps": PANEL_DRAFT_STEPS,
            "cfg": PANEL_DRAFT_CFG,
            "seed": PANEL_DRAFT_SEED,
        }

    @staticmethod
    def workflow(value: dict[str, Any]) -> dict[str, Any]:
        prefix = f"manga_base_drafts/page_{value['page_number']:04d}_panel_{value['panel_id']:04d}"
        return {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": value["checkpoint"]},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["1", 1], "text": value["positive_prompt"]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["1", 1], "text": value["negative_prompt"]},
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": value["width"], "height": value["height"], "batch_size": 1},
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                    "seed": value["seed"],
                    "control_after_generate": "fixed",
                    "steps": value["steps"],
                    "cfg": value["cfg"],
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            "7": {
                "class_type": "SaveImage",
                "inputs": {"filename_prefix": prefix, "images": ["6", 0]},
            },
        }
