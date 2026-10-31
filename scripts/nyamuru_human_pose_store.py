"""人体ポーズ素材を固定IDで読み、検証済みの内容だけを返す。"""
from __future__ import annotations

import base64
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
from types import SimpleNamespace

# bridgeの直接起動でも、既存human_pose packageを同じ配置から読む。
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.generation_store import directory_fd, open_child_directory, read_regular_at, sha256
from scripts.human_pose.constants import CATEGORIES, MODELS
from scripts.human_pose.files import asset_path
from scripts.human_pose.validate_catalog import validate_catalog


POSE_ID = re.compile(r"pose-[a-z0-9]+(?:-[a-z0-9]+)*")
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
SOURCE_FILES = {"sources/index.json", "sources/common.md", "sources/LICENSE", "sources/pose-page.html"}
SOURCE_FILES.update(f"sources/study/pose/{category}.md" for category in CATEGORIES)
SOURCE_FILES.add("sources/curated/index.json")
COMMON_FILES = {"base": "models/human_base.glb", "rig": "models/human_base.rig.json"}
BODY_MODEL_FILES = {"body_base": "models/bodychan_female.glb", "body_rig": "models/bodychan_female.rig.json"}
BODY_MODEL_METADATA = "models/bodychan_female.metadata.json"
POSE_FILES = {"pose": "pose.json", "preview": "preview.png",
              "reference_krea": f"references/{MODELS[0]}.webp",
              "reference_qwen": f"references/{MODELS[1]}.webp"}
MEDIA_TYPES = {"base": "model/gltf-binary", "rig": "application/json", "pose": "application/json",
               "preview": "image/png", "reference_krea": "image/webp", "reference_qwen": "image/webp"}


# validatorが必要とする固定ファイルだけを、開いたrootから相対的に読む。
def _allowed_file(relative: str) -> bool:
    if relative in {"catalog.json", *SOURCE_FILES, *COMMON_FILES.values(), *BODY_MODEL_FILES.values(), BODY_MODEL_METADATA}:
        return True
    parts = relative.split("/")
    return (len(parts) >= 3 and parts[0] == "poses" and bool(POSE_ID.fullmatch(parts[1]))
            and "/".join(parts[2:]) in {*POSE_FILES.values(), "pose.glb", "source.bvh"})


class _Snapshot:
    def __init__(self, root: Path, descriptor: int):
        self.root, self.descriptor = root, descriptor
        self.files: dict[str, bytes] = {}
        self.total = 0

    def read(self, relative: str) -> bytes:
        if relative in self.files:
            return self.files[relative]
        asset_path(self.root, relative)
        if not _allowed_file(relative):
            raise ValueError("人体ポーズの固定素材以外は読み込めません")
        parts = relative.split("/")
        limit = MAX_JSON_BYTES if relative.endswith(".json") else MAX_FILE_BYTES
        with ExitStack() as stack:
            folder = self.descriptor
            for part in parts[:-1]:
                folder = open_child_directory(folder, part)
                stack.callback(os.close, folder)
            info = os.stat(parts[-1], dir_fd=folder, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("ポーズ素材には通常ファイルを指定してください")
            raw, _ = read_regular_at(folder, parts[-1], min(limit, MAX_TOTAL_BYTES - self.total))
        self.total += len(raw)
        self.files[relative] = raw
        return raw


# P1/P2のvalidatorへ同じbytesを渡し、検証後の差し替えを返さない。
class _SnapshotPath:
    def __init__(self, snapshot: _Snapshot, parts: tuple[str, ...] = ()):
        self.snapshot, self.parts = snapshot, parts

    def __truediv__(self, part: str):
        return _SnapshotPath(self.snapshot, self.parts + (part,))

    def absolute(self):
        return self

    def resolve(self):
        return self

    def is_relative_to(self, other):
        return self.snapshot is other.snapshot and self.parts[:len(other.parts)] == other.parts

    def is_symlink(self):
        # 実ファイルのリンク判定はsnapshot.readのO_NOFOLLOWで行う。
        return False

    def read_bytes(self):
        return self.snapshot.read("/".join(self.parts))

    def read_text(self, encoding="utf-8"):
        return self.read_bytes().decode(encoding)

    def stat(self):
        return SimpleNamespace(st_size=len(self.read_bytes()))


class HumanPoseStore:
    def __init__(self, root: Path):
        self.root = Path(root).absolute()

    def _load(self):
        try:
            with directory_fd(self.root) as descriptor:
                snapshot = _Snapshot(self.root, descriptor)
                raw = snapshot.read("catalog.json")
                catalog = json.loads(raw)
                validate_catalog(catalog, _SnapshotPath(snapshot))
                if any(image.get("format") != "WEBP" for pose in catalog["poses"] for image in pose["source"]["images"]):
                    raise ValueError("比較用の原画像はWebPで登録してください")
                return catalog, sha256(raw), snapshot.files
        except FileNotFoundError as error:
            raise ValueError("ポーズカタログまたは登録素材が見つかりません") from error
        except (OSError, UnicodeError, KeyError, TypeError, AttributeError, IndexError, StopIteration, struct.error) as error:
            raise ValueError("ポーズカタログまたは登録素材の形式を確認できません") from error

    # 状態と利用者確認はそのまま返し、読込によって更新しない。
    def catalog(self, *, include_previews=False) -> dict:
        catalog, digest, files = self._load()
        result = {"catalog": catalog, "catalog_sha256": digest}
        # 30画像ごとに素体を再検証せず、同じsnapshotの一覧画像をまとめて返す。
        if include_previews:
            result['previews'] = {pose['id']: base64.b64encode(files[pose['asset_files']['preview']['path']]).decode('ascii')
                for pose in catalog['poses'] if pose.get('production_status') == 'ready'
                and pose.get('review', {}).get('user_confirmed') and 'preview' in pose['asset_files']}
        return result

    # 共通素材はpose_id=None、個別素材はcatalogにあるIDだけを受け付ける。
    def asset(self, pose_id: str | None, kind: str) -> dict:
        if not isinstance(kind, str) or kind not in MEDIA_TYPES:
            raise ValueError("ポーズ素材の種類が不正です")
        if kind in COMMON_FILES:
            if pose_id is not None:
                raise ValueError("共通素材にポーズIDは指定できません")
        elif not isinstance(pose_id, str) or not POSE_ID.fullmatch(pose_id):
            raise ValueError("ポーズIDが不正です")
        catalog, digest, files = self._load()
        return self._asset_from_snapshot(catalog, digest, files, pose_id, kind)

    def scene(self, pose_id: str, catalog_sha256: str, include_base: bool = True, body_model: str | None = None) -> dict:
        if not isinstance(include_base, bool):
            raise ValueError("素体の読込指定が不正です")
        if body_model is not None and body_model != 'bodychan-female':
            raise ValueError("表示モデルの指定が不正です")
        if not isinstance(pose_id, str) or not POSE_ID.fullmatch(pose_id):
            raise ValueError("ポーズIDが不正です")
        if not isinstance(catalog_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", catalog_sha256):
            raise ValueError("ポーズカタログのhashが不正です")
        catalog, digest, files = self._load()
        if digest != catalog_sha256:
            raise ValueError("選択時とポーズカタログの版が異なります。ポーズの指定を解除し、選び直してください")
        pose = next((entry for entry in catalog["poses"] if entry["id"] == pose_id), None)
        if (pose is None or pose.get("production_status") != "ready"
                or pose.get("review", {}).get("status") != "confirmed"
                or pose.get("review", {}).get("user_confirmed") is not True):
            raise ValueError("確認済みのポーズだけを3Dで開けます")
        result = {"pose_id": pose_id, "catalog_sha256": digest,
                "representation": "mesh" if include_base else "skeleton",
                "base_sha256": catalog["coordinate_contract"]["base"]["sha256"],
                **{kind: self._asset_from_snapshot(catalog, digest, files, None if kind in COMMON_FILES else pose_id, kind)
                   for kind in (("base", "rig", "pose") if include_base else ("rig", "pose"))}}
        if body_model:
            result['body_model'] = self._body_model(catalog, digest)
        return result

    def _body_model(self, catalog, digest):
        # Same fixed-path, no-symlink reader as the catalog. Display assets do not change its base contract.
        try:
            with directory_fd(self.root) as descriptor:
                snapshot = _Snapshot(self.root, descriptor)
                metadata = json.loads(snapshot.read(BODY_MODEL_METADATA))
                if (metadata.get('version') != 1 or metadata.get('id') != 'bodychan-female'
                        or metadata.get('reference_rig_sha256') != catalog['coordinate_contract']['rig']['sha256']):
                    raise ValueError('女性モデルとポーズ骨格の対応が不正です')
                result = {'id': 'bodychan-female'}
                for kind, path in BODY_MODEL_FILES.items():
                    record = metadata.get('files', {}).get('glb' if kind == 'body_base' else 'rig', {})
                    raw = snapshot.read(path)
                    if record.get('path') != path or record.get('byte_size') != len(raw) or record.get('sha256') != sha256(raw):
                        raise ValueError('女性モデルのサイズまたはhashが一致しません')
                    if kind == 'body_base' and (len(raw) < 20 or struct.unpack_from('<4sII', raw) != (b'glTF', 2, len(raw))):
                        raise ValueError('女性モデルがGLB形式ではありません')
                    result['base' if kind == 'body_base' else 'rig'] = {
                        'pose_id': None, 'kind': kind, 'catalog_sha256': digest, 'usage': 'pose_asset',
                        'mime_type': 'model/gltf-binary' if kind == 'body_base' else 'application/json',
                        'sha256': record['sha256'], 'byte_size': len(raw), 'data': base64.b64encode(raw).decode('ascii')}
                return result
        except (OSError, UnicodeError, KeyError, TypeError, AttributeError, struct.error) as error:
            raise ValueError('女性モデルを読み込めません。試用モデルの登録を確認してください') from error

    @staticmethod
    def _asset_from_snapshot(catalog, digest, files, pose_id, kind) -> dict:
        if kind in COMMON_FILES:
            record = catalog["coordinate_contract"].get(kind)
            expected = COMMON_FILES[kind]
        else:
            pose = next((entry for entry in catalog["poses"] if entry["id"] == pose_id), None)
            if pose is None:
                raise ValueError("登録されていないポーズIDです")
            expected = f"poses/{pose_id}/{POSE_FILES[kind]}"
            if kind.startswith("reference_"):
                record = next((item for item in pose["source"]["images"] if item["path"] == expected), None)
            else:
                record = pose["asset_files"].get(kind)
        if not isinstance(record, dict) or record.get("path") != expected or expected not in files:
            raise ValueError("指定したポーズ素材は登録されていません")
        raw = files[expected]
        if len(raw) != record["byte_size"] or sha256(raw) != record["sha256"]:
            raise ValueError("ポーズ素材のサイズまたはhashが一致しません")
        return {"pose_id": pose_id, "kind": kind, "catalog_sha256": digest,
                "mime_type": MEDIA_TYPES[kind], "byte_size": len(raw), "sha256": record["sha256"],
                "data": base64.b64encode(raw).decode("ascii"),
                "usage": "comparison_only" if kind.startswith("reference_") else "pose_asset"}
