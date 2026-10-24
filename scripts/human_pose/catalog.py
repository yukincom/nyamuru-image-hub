"""原文と注釈からカタログを構成する。"""
import re

from .constants import CATEGORIES, DATA, MODELS, REVISION
from .files import asset_path, canonical, read_json, sha256
from .source import common_sections, page_prompts, parse_study, pose_template


# IDは姿勢の動作名から作り、性別の代名詞を含めない。
def pose_id(slug: str) -> str:
    return "pose-" + re.sub(r"-(?:her|she)(?=-|$)", "", slug)


def entries_from_sources(root):
    common = common_sections(asset_path(root, "sources/common.md").read_text())
    published = page_prompts(asset_path(root, "sources/pose-page.html").read_text())
    entries = []
    for category, count in CATEGORIES.items():
        path = f"sources/study/pose/{category}.md"
        parsed = parse_study(asset_path(root, path).read_text(), common)
        annotations = read_json(DATA / f"{category}.json")
        by_slug = {entry["slug"]: entry for entry in annotations}
        if len(parsed) != count or len(by_slug) != count or {e["slug"] for e in parsed} != set(by_slug):
            raise ValueError(f"出典と注釈の件数が違います: {category}")
        for source in parsed:
            if published.get(source["slug"]) != source["original_prompt"]:
                raise ValueError(f"公開promptと固定Markdownの全文が違います: {source['slug']}")
            annotation = by_slug[source["slug"]]
            english = annotation.get("normalized_text", source["pose_source_text"])
            template = pose_template(english)
            identifier = pose_id(source["slug"])
            notes = ["共通の画角・背景・外見・髪型・衣類・視線指定を除外。ポーズ箇所の原文は別に保存。"]
            if annotation.get("normalization_note"):
                notes.append(annotation["normalization_note"])
            contact = []
            if "pockets" in annotation["tags"]:
                contact.append("ポケットへの手の接触だけを保持。衣類の種類や色は指定しない。素体での代用位置はP3で記録。")
            if "hair-contact" in annotation["tags"]:
                contact.append("髪へ手を通す動作だけを保持。髪型や色は指定しない。素体での代用位置はP3で記録。")
            supports = [tag for tag in annotation["tags"] if tag in {
                "chair", "stool", "floor", "wall", "doorframe", "ledge", "pole", "railing", "strap", "bar", "handle", "door", "ladder"}]
            entries.append({
                "id": identifier, "category": category[3:], "label_ja": annotation["label_ja"],
                "label_en": source["slug"].replace("-", " "), "tags": annotation["tags"], "search_aliases": [],
                "source": {**source, "path": path, "revision": REVISION, "license_path": "sources/LICENSE"},
                "pose_normalized_text": english, "pose_template": template, "template_revision": 1,
                "pose_text_ja": annotation["pose_text_ja"],
                "prompt_segments": [{"id": "body", "text_ja": annotation["pose_text_ja"], "template_en": template}],
                "normalization_notes": notes, "supports": supports, "contact_notes": contact,
                "production_status": "unmade", "asset_revision": None, "asset_files": {},
                "review": {"status": "unreviewed", "user_confirmed": False},
                "approximation_notes": [], "image_reference_eligible": False,
            })
    if len({entry["id"] for entry in entries}) != 68:
        raise ValueError("ポーズIDが重複しています")
    if set(published) != {entry["source"]["slug"] for entry in entries}:
        raise ValueError("公開promptの項目が固定出典と違います")
    return entries


# 同じ出典の再実行では、制作・利用者確認の記録を引き継ぐ。
def build_catalog(root, entries, manifest):
    references = manifest["files"]
    previous_path = asset_path(root, "catalog.json")
    previous = read_json(previous_path) if previous_path.exists() else None
    if previous and (previous.get("schema_version") != 1 or previous.get("source_revision") != REVISION):
        raise ValueError("別の出典またはschemaのカタログは上書きできません")
    if previous:
        poses = previous.get("poses")
        if not isinstance(poses, list) or len(poses) != len(entries) or any(not isinstance(p, dict) or not isinstance(p.get("id"), str) for p in poses):
            raise ValueError("既存カタログの一覧が不正です")
        if len({pose["id"] for pose in poses}) != len(poses):
            raise ValueError("既存カタログに重複IDがあります")
    old = {entry["id"]: entry for entry in previous["poses"]} if previous else {}
    if previous and set(old) != {entry["id"] for entry in entries}:
        raise ValueError("既存カタログのIDが一致しません")
    for entry in entries:
        entry["source"]["images"] = [references[f"poses/{entry['id']}/references/{model}.webp"] for model in MODELS]
        former = old.get(entry["id"])
        if former:
            immutable = ("source", "pose_template", "pose_text_ja", "prompt_segments", "template_revision")
            if any(former.get(key) != entry[key] for key in immutable):
                raise ValueError(f"出典/本文が変わりました。別revisionで確認が必要です: {entry['id']}")
            entry.update(former)
    return {**(previous or {}), "schema_version": 1, "source_revision": REVISION,
            "source_manifest_sha256": sha256(canonical(manifest)),
            "tags": read_json(DATA / "tags.json"), "poses": entries,
            "coordinate_contract": previous.get("coordinate_contract", {"status": "pending_p2"}) if previous else {"status": "pending_p2"}}
