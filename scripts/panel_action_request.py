"""Normalize and validate the panels, figures, and dialogue in an action request."""

from __future__ import annotations

import re
import unicodedata
from typing import Any


class PanelActionRequest:
    @staticmethod
    def checked_text(value: object, name: str, maximum: int, required: bool = False) -> str:
        if value is None and not required:
            return ""
        if not isinstance(value, str):
            raise ValueError(f"{name}は文字列で指定してください")
        normalized = unicodedata.normalize("NFKC", value).strip()
        if required and not normalized:
            raise ValueError(f"{name}を入力してください")
        if len(normalized) > maximum:
            raise ValueError(f"{name}が長すぎます")
        return normalized

    @staticmethod
    def checked_number(value: object, name: str) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise ValueError(f"{name}は1以上の整数で指定してください")
        return value

    @classmethod
    def normalized_dialogues(cls, raw_dialogues: object, name: str) -> list[dict[str, Any]]:
        if not isinstance(raw_dialogues, list) or len(raw_dialogues) > 40:
            raise ValueError(f"{name}のセリフ情報が多すぎます")
        dialogues = []
        for index, raw in enumerate(raw_dialogues):
            if not isinstance(raw, dict):
                raise ValueError(f"{name}のセリフ情報の形式が正しくありません")
            text = cls.checked_text(raw.get("text"), f"{name}のセリフ{index + 1}", 1000)
            if text:
                dialogues.append({
                    "speaker": cls.checked_text(raw.get("speaker"), f"{name}のセリフ{index + 1}の話者", 120),
                    "text": text,
                    "monologue": raw.get("monologue") is True,
                    "offscreen": raw.get("offscreen") is True,
                    "shape": cls.checked_text(raw.get("shape"), f"{name}のセリフ{index + 1}のフキダシ形状", 40),
                })
        return dialogues

    @classmethod
    def normalized_panel(cls, raw: object, name: str) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError(f"{name}の形式が正しくありません")
        raw_people = raw.get("people", [])
        if not isinstance(raw_people, list) or len(raw_people) > 20:
            raise ValueError(f"{name}の人物情報が多すぎます")
        return {
            "page_number": cls.checked_number(raw.get("page_number"), f"{name}のページ番号"),
            "panel_id": cls.checked_number(raw.get("panel_id"), f"{name}のコマ番号"),
            "panel_action": cls.checked_text(raw.get("panel_action"), f"{name}のト書き", 4000),
            "people": [cls.checked_text(value, f"{name}の人物", 120, required=True) for value in raw_people],
            "dialogues": cls.normalized_dialogues(raw.get("dialogues", []), name),
        }

    @classmethod
    def normalized_request(cls, body: dict[str, Any]) -> dict[str, Any]:
        raw_figures = body.get("figures")
        if not isinstance(raw_figures, list) or not 1 <= len(raw_figures) <= 20:
            raise ValueError("人物は1人以上20人以下で指定してください")
        figures = []
        ids: set[str] = set()
        for index, raw in enumerate(raw_figures):
            if not isinstance(raw, dict):
                raise ValueError("人物情報の形式が正しくありません")
            item_id = cls.checked_text(raw.get("id"), f"人物{index + 1}のID", 80, required=True)
            if not re.fullmatch(r"[A-Za-z0-9._:-]+", item_id) or item_id in ids:
                raise ValueError("人物のIDが不正または重複しています")
            ids.add(item_id)
            figures.append({
                "id": item_id,
                "name": cls.checked_text(raw.get("name"), f"人物{index + 1}の名前", 120, required=True),
                "description": cls.checked_text(raw.get("description"), f"人物{index + 1}の説明", 1000),
                "current_action": cls.checked_text(raw.get("current_action"), f"人物{index + 1}の現在のアクション", 4000),
                "size": cls.checked_text(raw.get("size"), f"人物{index + 1}の描写範囲", 40),
                "role": cls.checked_text(raw.get("role"), f"人物{index + 1}のあつかい", 40),
            })

        raw_work = body.get("work")
        if not isinstance(raw_work, dict):
            raise ValueError("作品情報の形式が正しくありません")
        raw_setting = raw_work.get("setting", {})
        if not isinstance(raw_setting, dict):
            raise ValueError("舞台設定の形式が正しくありません")
        raw_characters = body.get("characters", [])
        if not isinstance(raw_characters, list) or len(raw_characters) > 200:
            raise ValueError("登場人物情報が多すぎます")
        characters = []
        for index, raw in enumerate(raw_characters):
            if not isinstance(raw, dict):
                raise ValueError("登場人物情報の形式が正しくありません")
            characters.append({
                "name": cls.checked_text(raw.get("name"), f"登場人物{index + 1}の名前", 120, required=True),
                "description": cls.checked_text(raw.get("description"), f"登場人物{index + 1}の人物像", 2000),
            })
        return {
            "work": {
                "series_title": cls.checked_text(raw_work.get("series_title"), "作品タイトル", 300),
                "subtitle": cls.checked_text(raw_work.get("subtitle"), "サブタイトル", 300),
                "episode_number": cls.checked_text(raw_work.get("episode_number"), "話数", 80),
                "synopsis": cls.checked_text(raw_work.get("synopsis"), "あらすじ", 12000),
                "setting": {
                    "location": cls.checked_text(raw_setting.get("location"), "場所", 1000),
                    "time": cls.checked_text(raw_setting.get("time"), "時間帯", 500),
                    "weather": cls.checked_text(raw_setting.get("weather"), "天候", 500),
                },
            },
            "characters": characters,
            "previous_panel": cls.normalized_panel(body.get("previous_panel"), "前のコマ") if body.get("previous_panel") is not None else None,
            "current_panel": cls.normalized_panel(body.get("current_panel"), "現在のコマ"),
            "next_panel": cls.normalized_panel(body.get("next_panel"), "次のコマ") if body.get("next_panel") is not None else None,
            "figures": figures,
        }
