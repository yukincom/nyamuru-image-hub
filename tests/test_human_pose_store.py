"""固定素材の読込、原本保全、境界・差し替えの拒否を検証する。"""
import base64
from copy import deepcopy
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import nyamuru_human_pose_store as store_module
from scripts.generation_store import canonical, sha256
from scripts.human_pose.catalog import build_catalog, entries_from_sources
from scripts.human_pose.constants import CATEGORIES, COMMON_KEYS, DATA, MODELS, REVISION
from scripts.human_pose.glb import rig_contract
from scripts.human_pose.source import common_sections
from scripts.human_pose import validate_catalog as validator

try:
    from PIL import Image
except ImportError:
    Image = None


TRS = {"translation": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]}


# 実素材を使わず、固定注釈と合成原文・画像で68件の小さな素材庫を作る。
def fixture(root):
    def write(relative, raw, details=None):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return {"path": relative, "byte_size": len(raw), "sha256": sha256(raw), **(details or {})}

    common = "".join(f"# {key}\n- shared {key}\n" for key in sorted(COMMON_KEYS))
    shared = common_sections(common)
    links = ["full-body", "slim-woman", "study-hair", "white-t-shirt-and-jeans", "looking-left"]
    prompt = ". ".join([shared[key] for key in links] + ["she stands"]) + "."
    files = {"sources/common.md": write("sources/common.md", common.encode()),
             "sources/LICENSE": write("sources/LICENSE", b"Synthetic test fixture only\n")}
    cards = []
    for category in CATEGORIES:
        blocks = []
        for entry in json.loads((DATA / f"{category}.json").read_text()):
            slug = entry["slug"]
            blocks.append(f"# {slug}.png\n" + "".join(f"- [x](../../common.md#{key})\n" for key in links) + "- she stands\n")
            cards.append(f'<figure class="card"><img src="krea-2/pose/{slug}.webp"><p>{prompt}</p></figure>')
        relative = f"sources/study/pose/{category}.md"
        files[relative] = write(relative, "\n".join(blocks).encode())
    files["sources/pose-page.html"] = write("sources/pose-page.html", "".join(cards).encode())
    hashes = {key.removeprefix("sources/"): item["sha256"] for key, item in files.items() if key.endswith(".md") or key.endswith("LICENSE")}
    entries = entries_from_sources(root)
    for index, entry in enumerate(entries):
        for model_index, model in enumerate(MODELS):
            stream = io.BytesIO()
            Image.new("RGB", (2, 2), (index * 2 + model_index, 30, 50)).save(stream, "WEBP", lossless=True)
            relative = f"poses/{entry['id']}/references/{model}.webp"
            files[relative] = write(relative, stream.getvalue(), {"width": 2, "height": 2, "format": "WEBP"})
    manifest = {"revision": REVISION, "files": files}
    write("sources/index.json", canonical(manifest))
    catalog = build_catalog(root, entries, manifest)

    # 一つのboneを持つGLBでP2の実体照合も通す。
    data = {"asset": {"version": "2.0"}, "buffers": [{"byteLength": 16}],
            "bufferViews": [{"buffer": 0, "byteLength": 16}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "type": "VEC4", "count": 1}],
            "nodes": [{"name": "human_rig", "children": [1]}, {"name": "root"}],
            "skins": [{"joints": [1]}], "meshes": [{"primitives": [{"attributes": {"JOINTS_0": 0, "WEIGHTS_0": 0}}]}]}
    encoded = json.dumps(data).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary = struct.pack("<4f", 1, 0, 0, 0)
    glb = struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(binary))
    glb += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    glb += struct.pack("<II", len(binary), 0x004E4942) + binary
    base = write("models/human_base.glb", glb)
    rig = rig_contract(root / base["path"])
    catalog["coordinate_contract"] = {"status": "verified", "rig_signature": rig["rig_signature"],
                                      "base": base, "rig": write("models/human_base.rig.json", canonical(rig))}
    selected = catalog["poses"][0]
    selected.update(production_status="in_progress", asset_revision=1)
    pose = {"schema_version": 1, "pose_id": selected["id"], "revision": 1,
            "rig_signature": rig["rig_signature"], "base_glb_sha256": base["sha256"],
            "transform_space": "absolute_parent_local", "root": TRS, "bones": {"root": TRS}, "user_confirmed": False}
    stream = io.BytesIO()
    Image.new("RGBA", (3, 4), (128, 128, 128, 255)).save(stream, "PNG")
    selected["asset_files"] = {"pose": write(f"poses/{selected['id']}/pose.json", canonical(pose)),
                              "preview": write(f"poses/{selected['id']}/preview.png", stream.getvalue())}
    write("catalog.json", canonical(catalog))
    return hashes


class StoreInputTests(unittest.TestCase):
    def test_invalid_kind_and_id_fail_without_opening_root(self):
        store = store_module.HumanPoseStore(Path("/nonexistent-pose-fixture"))
        for identifier, kind in [(None, "../base"), (None, []), ("pose-x", "base"), ("", "rig"),
                                 (None, "pose"), ("../outside", "preview"), ("pose-X", "pose"), (True, "pose")]:
            with self.subTest(identifier=identifier, kind=kind), self.assertRaises(ValueError):
                store.asset(identifier, kind)

    def test_missing_root_is_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve() / "missing"
            with self.assertRaises(ValueError):
                store_module.HumanPoseStore(root).catalog()
            self.assertFalse(root.exists())

    def test_scene_input_is_rejected_before_opening_root(self):
        store = store_module.HumanPoseStore(Path('/nonexistent-pose-fixture'))
        for identifier, digest in [(None, 'a' * 64), ('../outside', 'a' * 64), ('pose-test', []), ('pose-test', 'ABC')]:
            with patch.object(store, '_load') as load, self.subTest(identifier=identifier), self.assertRaises(ValueError):
                store.scene(identifier, digest)
            load.assert_not_called()

    def test_top_level_bridge_import_works_outside_repository(self):
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, sys.argv[1]); import nyamuru_human_pose_store", str(scripts)],
                                    cwd=directory, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


@unittest.skipUnless(Image, "既存のPillow入りPythonで素材検証を実行してください")
class HumanPoseStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline = tempfile.TemporaryDirectory()
        cls.base = Path(cls.baseline.name).resolve()
        cls.source_hashes = fixture(cls.base)

    @classmethod
    def tearDownClass(cls):
        cls.baseline.cleanup()

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name).resolve()
        self.root = self.parent / "poses"
        shutil.copytree(self.base, self.root)
        self.store = store_module.HumanPoseStore(self.root)
        self.catalog = json.loads((self.root / "catalog.json").read_bytes())
        self.pose_id = self.catalog["poses"][0]["id"]
        # 上流原文の固定hashだけを合成原文へ対応させ、validator本体は使う。
        source_patch = patch.object(validator, "SOURCE_HASHES", self.source_hashes)
        source_patch.start()
        self.addCleanup(source_patch.stop)

    def save_catalog(self):
        (self.root / "catalog.json").write_bytes(canonical(self.catalog))

    def record(self, relative, raw):
        (self.root / relative).write_bytes(raw)
        return {"path": relative, "byte_size": len(raw), "sha256": sha256(raw)}

    def test_catalog_preserves_unconfirmed_state_without_writing(self):
        before = {str(path.relative_to(self.root)): (path.read_bytes(), path.stat().st_mtime_ns) for path in self.root.rglob("*") if path.is_file()}
        result = self.store.catalog()
        self.assertEqual(result["catalog"], self.catalog)
        self.assertEqual(result["catalog_sha256"], sha256(before["catalog.json"][0]))
        self.assertFalse(result["catalog"]["poses"][0]["review"]["user_confirmed"])
        result["catalog"]["poses"][0]["review"]["user_confirmed"] = True
        self.assertEqual(before, {str(path.relative_to(self.root)): (path.read_bytes(), path.stat().st_mtime_ns) for path in self.root.rglob("*") if path.is_file()})
        self.assertFalse(self.store.catalog()["catalog"]["poses"][0]["review"]["user_confirmed"])

    def test_all_public_kinds_return_verified_original_bytes(self):
        for kind, expected in {**store_module.COMMON_FILES, **{kind: f"poses/{self.pose_id}/{name}" for kind, name in store_module.POSE_FILES.items()}}.items():
            with self.subTest(kind=kind):
                result = self.store.asset(None if kind in store_module.COMMON_FILES else self.pose_id, kind)
                raw = (self.root / expected).read_bytes()
                self.assertEqual(base64.b64decode(result["data"]), raw)
                self.assertEqual(result["sha256"], sha256(raw))
                self.assertEqual(result["byte_size"], len(raw))
                self.assertEqual(result["mime_type"], store_module.MEDIA_TYPES[kind])
                self.assertEqual(result["usage"], "comparison_only" if kind.startswith("reference_") else "pose_asset")

    def test_scene_requires_the_selected_catalog_and_confirmed_pose(self):
        digest = self.store.catalog()['catalog_sha256']
        with self.assertRaisesRegex(ValueError, '版が異なります'):
            self.store.scene(self.pose_id, '0' * 64)
        with self.assertRaisesRegex(ValueError, '確認済み'):
            self.store.scene(self.pose_id, digest)

    def test_scene_assets_share_one_validated_snapshot(self):
        # _load本体のsnapshot検証は既存testで照合。このtestはready判定とbundleを検査する。
        catalog, digest, files = self.store._load()
        catalog['poses'][0].update(production_status='ready', review={'status': 'confirmed', 'user_confirmed': True})
        with patch.object(self.store, '_load', return_value=(catalog, digest, files)) as load:
            result = self.store.scene(self.pose_id, digest)
        load.assert_called_once_with()
        for kind in ('base', 'rig', 'pose'):
            item = result[kind]
            expected = store_module.COMMON_FILES.get(kind, f'poses/{self.pose_id}/pose.json')
            self.assertEqual(base64.b64decode(item['data']), files[expected])
            self.assertEqual(item['catalog_sha256'], digest)
        self.assertEqual(result['pose_id'], self.pose_id)
        self.assertNotIn('reference_krea', result)

    def test_skeleton_scene_omits_mesh_and_preserves_source_identity(self):
        catalog, digest, files = self.store._load()
        catalog['poses'][0].update(production_status='ready', review={'status': 'confirmed', 'user_confirmed': True})
        with patch.object(self.store, '_load', return_value=(catalog, digest, files)) as load:
            result = self.store.scene(self.pose_id, digest, False)
        load.assert_called_once_with()
        self.assertEqual(result['representation'], 'skeleton')
        self.assertEqual(result['base_sha256'], catalog['coordinate_contract']['base']['sha256'])
        self.assertNotIn('base', result)
        for kind in ('rig', 'pose'):
            self.assertEqual(result[kind]['catalog_sha256'], digest)
        for invalid in (None, 0, 'false', []):
            with self.assertRaisesRegex(ValueError, '読込指定'):
                self.store.scene(self.pose_id, digest, invalid)

    def test_unknown_id_and_unregistered_assets_are_rejected(self):
        for identifier, kind in [("pose-not-in-catalog", "pose"), (self.catalog["poses"][1]["id"], "pose")]:
            with self.subTest(identifier=identifier), self.assertRaises(ValueError):
                self.store.asset(identifier, kind)

    # 見込み: 同じ固定path readerで表示GLBを読むことで、catalogのbaseを変更せず女性素材を返せる。
    # 合格: 要求時のみGLB/rigを返し、原catalog/base不変、欠損・hash・path差替え・symlink拒否。合成素材/API境界のみ。
    def test_female_body_model_uses_fixed_assets_and_keeps_catalog_identity(self):
        catalog, digest, files = self.store._load()
        catalog['poses'][0].update(production_status='ready', review={'status': 'confirmed', 'user_confirmed': True})
        records = {}
        for kind, relative in store_module.BODY_MODEL_FILES.items():
            raw = (self.root / store_module.COMMON_FILES['base' if kind == 'body_base' else 'rig']).read_bytes()
            records['glb' if kind == 'body_base' else 'rig'] = self.record(relative, raw)
        metadata = {'version': 1, 'id': 'bodychan-female', 'reference_rig_sha256': catalog['coordinate_contract']['rig']['sha256'], 'files': records}
        path = self.root / store_module.BODY_MODEL_METADATA
        path.write_bytes(canonical(metadata))
        with patch.object(self.store, '_load', return_value=(catalog, digest, files)):
            normal = self.store.scene(self.pose_id, digest, False)
            self.assertNotIn('body_model', normal)
            result = self.store.scene(self.pose_id, digest, False, body_model='bodychan-female')
            self.assertEqual({key: value for key, value in result.items() if key != 'body_model'}, normal)
            self.assertEqual(result['body_model']['id'], 'bodychan-female')
            self.assertEqual(base64.b64decode(result['body_model']['base']['data']), files['models/human_base.glb'])
            for changed in [dict(metadata, reference_rig_sha256='0' * 64), dict(metadata, files={**records, 'glb': {**records['glb'], 'path': '../outside'}})]:
                path.write_bytes(canonical(changed))
                with self.assertRaises(ValueError):
                    self.store.scene(self.pose_id, digest, False, body_model='bodychan-female')
            path.write_bytes(canonical(metadata))
            body = self.root / store_module.BODY_MODEL_FILES['body_base']
            body.write_bytes(body.read_bytes() + b'bad')
            with self.assertRaisesRegex(ValueError, 'hash'):
                self.store.scene(self.pose_id, digest, False, body_model='bodychan-female')
            body.unlink()
            body.symlink_to(self.root / 'models/human_base.glb')
            with self.assertRaises(ValueError):
                self.store.scene(self.pose_id, digest, False, body_model='bodychan-female')
        self.assertEqual((self.root / 'models/human_base.glb').read_bytes(), files['models/human_base.glb'])

    # 見込み: 未知IDを読込前に拒否すれば、モデル名をpathや任意素材指定として使わない。
    # 合格: 不正値ではroot未読込。登録fileの欠損と容量制限も拒否。実モデルの重さ・変形は対象外。
    def test_female_body_model_rejects_unknown_missing_and_oversized_assets(self):
        for model in ['../bodykun', '', False, [], {}]:
            with patch.object(self.store, '_load') as load, self.assertRaises(ValueError):
                self.store.scene(self.pose_id, 'a' * 64, False, body_model=model)
            load.assert_not_called()
        catalog, digest, files = self.store._load()
        catalog['poses'][0].update(production_status='ready', review={'status': 'confirmed', 'user_confirmed': True})
        with patch.object(self.store, '_load', return_value=(catalog, digest, files)):
            with self.assertRaises(ValueError):
                self.store.scene(self.pose_id, digest, False, body_model='bodychan-female')
            records = {kind: self.record(relative, files['models/human_base.glb' if kind == 'body_base' else 'models/human_base.rig.json']) for kind, relative in store_module.BODY_MODEL_FILES.items()}
            (self.root / store_module.BODY_MODEL_METADATA).write_bytes(canonical({'version': 1, 'id': 'bodychan-female',
                'reference_rig_sha256': catalog['coordinate_contract']['rig']['sha256'], 'files': {'glb': records['body_base'], 'rig': records['body_rig']}}))
            with patch.object(store_module, 'MAX_FILE_BYTES', 16), self.assertRaises(ValueError):
                self.store.scene(self.pose_id, digest, False, body_model='bodychan-female')
        self.catalog["coordinate_contract"] = {"status": "pending_p2"}
        first = self.catalog["poses"][0]
        first.update(production_status="unmade", asset_files={}, asset_revision=None)
        self.save_catalog()
        self.assertEqual(self.store.catalog()["catalog"]["coordinate_contract"]["status"], "pending_p2")
        with self.assertRaises(ValueError):
            self.store.asset(None, "base")

    def test_confirmed_review_is_preserved_and_not_fabricated(self):
        first = self.catalog["poses"][0]
        first.update(production_status="ready", image_reference_eligible=True)
        first["review"] = {"status": "confirmed", "user_confirmed": True, "reviewer": "fixture reviewer", "reviewed_at": "2026-10-09"}
        relative = first["asset_files"]["pose"]["path"]
        pose = json.loads((self.root / relative).read_bytes())
        pose.update(user_confirmed=True, reviewer="fixture reviewer", reviewed_at="2026-10-09")
        first["asset_files"]["pose"] = self.record(relative, canonical(pose))
        self.save_catalog()
        self.assertEqual(self.store.catalog()["catalog"]["poses"][0]["review"], first["review"])
        first["review"]["user_confirmed"] = False
        self.save_catalog()
        with self.assertRaises(ValueError):
            self.store.catalog()

    def test_invalid_catalog_json_schema_and_id_are_rejected(self):
        original = deepcopy(self.catalog)
        for mutate in [lambda value: value.update(schema_version=99),
                       lambda value: value["poses"][0].update(id="../outside"),
                       lambda value: value["poses"][0].update(image_reference_eligible=True)]:
            self.catalog = deepcopy(original)
            mutate(self.catalog)
            self.save_catalog()
            with self.assertRaises(ValueError):
                self.store.catalog()
        (self.root / "catalog.json").write_bytes(b"{broken")
        with self.assertRaises(ValueError):
            self.store.catalog()

    def test_missing_and_corrupt_registered_assets_are_rejected(self):
        for relative in ["models/human_base.glb", f"poses/{self.pose_id}/preview.png", f"poses/{self.pose_id}/references/{MODELS[0]}.webp"]:
            path = self.root / relative
            original = path.read_bytes()
            with self.subTest(relative=relative):
                path.unlink()
                with self.assertRaises(ValueError):
                    self.store.catalog()
                path.write_bytes(b"corrupt")
                with self.assertRaises(ValueError):
                    self.store.catalog()
                path.write_bytes(original)

    def test_manifest_hash_and_record_hash_are_checked(self):
        path = self.root / "sources/index.json"
        raw = path.read_bytes()
        path.write_bytes(raw + b" ")
        self.assertEqual(self.store.catalog()["catalog"], self.catalog)
        value = json.loads(raw)
        value["revision"] = "wrong"
        path.write_bytes(canonical(value))
        with self.assertRaises(ValueError):
            self.store.catalog()
        path.write_bytes(raw)
        self.catalog["coordinate_contract"]["base"]["sha256"] = "0" * 64
        self.save_catalog()
        with self.assertRaises(ValueError):
            self.store.catalog()

    def test_traversal_and_unlisted_manifest_paths_are_rejected(self):
        path = self.root / "sources/index.json"
        original = path.read_bytes()
        for relative in ["../outside", "/etc/passwd", "sources/../../outside", "models/human_base.blend"]:
            value = json.loads(original)
            value["files"][relative] = {"path": relative, "byte_size": 1, "sha256": "a" * 64}
            path.write_bytes(canonical(value))
            self.catalog["source_manifest_sha256"] = sha256(canonical(value))
            self.save_catalog()
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                self.store.catalog()

    def test_root_intermediate_and_file_symlinks_are_rejected(self):
        linked = self.parent / "linked"
        linked.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            store_module.HumanPoseStore(linked).catalog()
        with self.assertRaises(ValueError):
            store_module.HumanPoseStore(linked / "unused").catalog()
        for relative in ["sources", "catalog.json", "models/human_base.glb"]:
            path = self.root / relative
            outside = self.parent / "outside"
            path.rename(outside)
            path.symlink_to(outside, target_is_directory=outside.is_dir())
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                self.store.catalog()
            path.unlink()
            outside.rename(path)

    def test_directory_and_file_size_limits_are_rejected(self):
        path = self.root / "catalog.json"
        original = path.read_bytes()
        path.unlink()
        path.mkdir()
        with self.assertRaises(ValueError):
            self.store.catalog()
        path.rmdir()
        path.write_bytes(original)
        for name, limit in [("MAX_JSON_BYTES", 20), ("MAX_FILE_BYTES", 20), ("MAX_TOTAL_BYTES", len(original) + 1)]:
            with self.subTest(name=name), patch.object(store_module, name, limit), self.assertRaises(ValueError):
                self.store.catalog()

    def test_pose_and_rig_semantics_are_verified_beyond_hash(self):
        for record in [self.catalog["coordinate_contract"]["rig"], self.catalog["poses"][0]["asset_files"]["pose"]]:
            path = self.root / record["path"]
            raw = path.read_bytes()
            saved_record = dict(record)
            value = json.loads(raw)
            value["rig_signature"] = "0" * 64
            record.update(self.record(record["path"], canonical(value)))
            self.save_catalog()
            with self.assertRaises(ValueError):
                self.store.catalog()
            path.write_bytes(raw)
            record.update(saved_record)

    def test_reference_decode_and_declared_webp_are_verified(self):
        image = self.catalog["poses"][0]["source"]["images"][0]
        manifest_path = self.root / "sources/index.json"
        manifest = json.loads(manifest_path.read_bytes())
        stream = io.BytesIO()
        Image.new("RGB", (2, 2), (1, 2, 3)).save(stream, "PNG")
        for raw, declared in [(b"not an image", "WEBP"), (stream.getvalue(), "PNG")]:
            image.update(self.record(image["path"], raw), format=declared)
            manifest["files"][image["path"]] = image
            manifest_path.write_bytes(canonical(manifest))
            self.catalog["source_manifest_sha256"] = sha256(canonical(manifest))
            self.save_catalog()
            with self.subTest(declared=declared), self.assertRaises(ValueError):
                self.store.catalog()

    def test_returned_asset_is_the_same_bytes_used_by_validator(self):
        path = self.root / f"poses/{self.pose_id}/preview.png"
        original = path.read_bytes()
        actual_validate = store_module.validate_catalog

        def replace_after_validation(catalog, root):
            result = actual_validate(catalog, root)
            path.write_bytes(b"replaced after validation")
            return result

        with patch.object(store_module, "validate_catalog", side_effect=replace_after_validation):
            result = self.store.asset(self.pose_id, "preview")
        self.assertEqual(base64.b64decode(result["data"]), original)
        with self.assertRaises(ValueError):
            self.store.asset(self.pose_id, "preview")


if __name__ == "__main__":
    unittest.main()
