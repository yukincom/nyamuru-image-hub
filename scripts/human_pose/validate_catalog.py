"""カタログの契約とローカル素材を検証する。"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

from .catalog import entries_from_sources
from .constants import CATEGORIES, MODELS, REVISION, ROOT, SOURCE_HASHES
from .files import asset_path, canonical, image_info, read_json, sha256
from .source import validate_template
from .glb import rig_contract
from .pose_contract import validate_pose


# 型とIDを先に検査し、不正値を暗黙の既定値へ変えない。
def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def file_record(value, root=None):
    require(isinstance(value, dict), "素材記録がobjectではありません")
    require(isinstance(value.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", value["sha256"]), "素材hashが不正です")
    require(type(value.get("byte_size")) is int and value["byte_size"] > 0, "素材サイズが不正です")
    path = asset_path(root or Path("/tmp/pose-validation"), value.get("path"))
    if root:
        raw = path.read_bytes()
        require(len(raw) == value["byte_size"] and sha256(raw) == value["sha256"], f"素材hash不一致: {value['path']}")
        return raw


def validate_catalog(catalog, root=None):
    # 配布pose版は専用の出典契約へ分岐し、研究用68件の検証も維持する。
    if isinstance(catalog, dict) and type(catalog.get('schema_version')) is int and catalog['schema_version'] == 2:
        from .curated_catalog import validate_curated_catalog
        return validate_curated_catalog(catalog, root)
    require(isinstance(catalog, dict) and type(catalog.get("schema_version")) is int and catalog["schema_version"] == 1,
            "catalog schemaが不正です")
    require(catalog.get("source_revision") == REVISION, "source revisionが不正です")
    tags, poses = catalog.get("tags"), catalog.get("poses")
    require(isinstance(tags, list) and isinstance(poses, list) and len(poses) == 68, "tag/pose一覧または68件の件数が不正です")
    tag_ids = set()
    for tag in tags:
        require(isinstance(tag, dict) and text(tag.get("id")) and tag["id"] not in tag_ids, "tag IDが不正または重複しています")
        require(text(tag.get("label_ja")) and isinstance(tag.get("aliases"), list) and all(text(x) for x in tag["aliases"]), "tag語彙が不正です")
        tag_ids.add(tag["id"])
    contract = validate_coordinate_contract(catalog.get("coordinate_contract"), root)
    ids, image_hashes, counts = set(), set(), Counter()
    for pose in poses:
        require(isinstance(pose, dict), "poseがobjectではありません")
        identifier = pose.get("id")
        require(isinstance(identifier, str) and re.fullmatch(r"pose-[a-z0-9]+(?:-[a-z0-9]+)*", identifier)
                and identifier not in ids, "pose IDが不正または重複しています")
        ids.add(identifier)
        require(pose.get("category") in {name[3:] for name in CATEGORIES}, "分類が不正です")
        counts[pose["category"]] += 1
        for key in ("label_ja", "label_en", "pose_text_ja", "pose_normalized_text"):
            require(text(pose.get(key)), f"{key}が空です")
        for key in ("tags", "search_aliases", "supports", "normalization_notes", "contact_notes", "approximation_notes"):
            require(isinstance(pose.get(key), list) and all(text(x) for x in pose[key]), f"{key}が不正です")
        require(set(pose["tags"]).issubset(tag_ids), "未定義のtagがあります")
        validate_template(pose.get("pose_template"))
        require(type(pose.get("template_revision")) is int and pose["template_revision"] > 0, "template revisionが不正です")
        segments = pose.get("prompt_segments")
        require(isinstance(segments, list) and bool(segments), "日英segmentがありません")
        segment_ids = set()
        for segment in segments:
            require(isinstance(segment, dict) and text(segment.get("id")) and segment["id"] not in segment_ids, "segment IDが不正です")
            segment_ids.add(segment["id"])
            require(text(segment.get("text_ja")), "segmentの日本語が空です")
            validate_template(segment.get("template_en"))
        require("".join(s["text_ja"] for s in segments) == pose["pose_text_ja"], "日本語本文とsegmentが不一致です")
        require(" ".join(s["template_en"] for s in segments) == pose["pose_template"], "英文本文とsegmentが不一致です")
        source = pose.get("source")
        require(isinstance(source, dict) and source.get("revision") == REVISION, "poseの出典が不正です")
        require(source.get("path") == f"sources/study/pose/{next(name for name in CATEGORIES if name[3:] == pose['category'])}.md",
                "poseの出典pathが不正です")
        require(source.get("license_path") == "sources/LICENSE", "LICENSE参照が不正です")
        images = source.get("images")
        require(isinstance(images, list) and len(images) == 2, "元画像2枚が必要です")
        for model, image in zip(MODELS, images):
            require(image.get("path") == f"poses/{identifier}/references/{model}.webp", "画像とpose ID/modelが不一致です")
            raw = file_record(image, root)
            require(image["sha256"] not in image_hashes, "画像hashが重複しています")
            image_hashes.add(image["sha256"])
            if root:
                dimensions = image_info(raw)
                require(all(image.get(key) == value for key, value in dimensions.items()), "画像寸法/形式が記録と一致しません")
        assets, review = pose.get("asset_files"), pose.get("review")
        require(isinstance(assets, dict) and isinstance(review, dict), "素材/確認状態が不正です")
        require(pose.get("production_status") in {"unmade", "in_progress", "ready"}, "制作状態が不正です")
        require(review.get("status") in {"unreviewed", "changes_requested", "confirmed"}, "確認状態が不正です")
        require(type(review.get("user_confirmed")) is bool and type(pose.get("image_reference_eligible")) is bool, "確認flagが不正です")
        if review["user_confirmed"]:
            require(text(review.get("reviewer")) and text(review.get("reviewed_at")), "利用者確認の記録がありません")
        require((review["status"] == "confirmed") == review["user_confirmed"], "利用者確認と確認状態が矛盾しています")
        require(set(assets).issubset({"pose", "preview", "glb"}), "未対応の姿勢素材です")
        for kind, asset in assets.items():
            expected_name = {"pose": "pose.json", "preview": "preview.png", "glb": "pose.glb"}[kind]
            require(asset.get("path") == f"poses/{identifier}/{expected_name}", "姿勢素材の所属pathが不正です")
            raw = file_record(asset, root)
            if root and kind == "preview":
                require(image_info(raw)["format"] == "PNG", "previewはPNGにしてください")
            if kind == "pose":
                require(root is not None and contract is not None, "姿勢の検証には共通rigと素材rootが必要です")
                saved = json.loads(raw)
                validate_pose(saved, contract)
                require(saved["pose_id"] == identifier and saved["revision"] == pose.get("asset_revision"), "姿勢のID/revisionが不一致です")
                require(saved["user_confirmed"] == review["user_confirmed"], "姿勢の利用者確認が不一致です")
        if pose["production_status"] == "unmade":
            require(not assets and pose.get("asset_revision") is None, "未制作と素材の存在が矛盾しています")
        if pose["production_status"] == "ready" or pose["image_reference_eligible"]:
            require(contract is not None and root is not None and {"pose", "preview"}.issubset(assets), "完成には検証済みrigと姿勢/一覧絵が必要です")
            require(review["status"] == "confirmed" and review["user_confirmed"], "確定素材には利用者の確認が必要です")
        if pose["image_reference_eligible"]:
            require(review["status"] == "confirmed" and review["user_confirmed"], "画像参照には利用者の確認が必要です")
    require(counts == Counter({key[3:]: value for key, value in CATEGORIES.items()}), "分類の件数が出典と違います")
    if root:
        validate_provenance(catalog, root)
    return {"poses": len(ids), "images": len(image_hashes), "categories": dict(counts)}


# 記録だけで完了にせず、GLBから再計算したrigと保存contractを照合する。
def validate_coordinate_contract(value, root):
    require(isinstance(value, dict), "共通座標契約がありません")
    if value.get("status") == "pending_p2":
        return None
    require(value.get("status") == "verified", "共通座標契約の状態が不正です")
    require(value.get("base", {}).get("path") == "models/human_base.glb" and
            value.get("rig", {}).get("path") == "models/human_base.rig.json", "共通素材pathが不正です")
    file_record(value["base"], root)
    raw = file_record(value["rig"], root)
    if root is None:
        return None
    saved = json.loads(raw)
    actual = rig_contract(asset_path(root, value["base"]["path"]))
    require(all(saved.get(key) == data for key, data in actual.items()), "共通rigがGLBと一致しません")
    require(value.get("rig_signature") == actual["rig_signature"], "共通rig signatureが一致しません")
    return saved


# 原文・注釈・manifestを照合し、別IDへの取り違えを検出する。
def validate_provenance(catalog, root):
    manifest = read_json(asset_path(root, "sources/index.json"))
    require(manifest.get("revision") == REVISION, "manifestのrevisionが不正です")
    require(sha256(canonical(manifest)) == catalog.get("source_manifest_sha256"), "manifestが変更されています")
    for relative, value in manifest["files"].items():
        require(value["path"] == relative, "manifestのpathが不一致です")
        file_record(value, root)
    for path, digest in SOURCE_HASHES.items():
        require(sha256(asset_path(root, "sources/" + path).read_bytes()) == digest, "固定原文が変更されています")
    expected = {entry["id"]: entry for entry in entries_from_sources(root)}
    for pose in catalog["poses"]:
        original = expected[pose["id"]]
        for key in ("pose_template", "pose_text_ja", "pose_normalized_text", "prompt_segments", "tags", "label_ja"):
            require(pose[key] == original[key], f"注釈/原文と不一致: {pose['id']} / {key}")
        for key, value in original["source"].items():
            require(pose["source"].get(key) == value, "出典の対応が不一致です")
        for image in pose["source"]["images"]:
            require(image == manifest["files"].get(image["path"]), "画像manifestの対応が不一致です")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    print(validate_catalog(read_json(asset_path(args.root, "catalog.json")), args.root))


if __name__ == "__main__":
    main()
