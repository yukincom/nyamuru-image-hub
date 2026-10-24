"""30件への切替で、旧素材保全と出典・runtimeの対応が崩れないことを検査する。"""
import base64
from copy import deepcopy
import io
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tests.test_human_pose_store import Image, TRS, fixture
from scripts.human_pose import curated_catalog, register_curated, validate_catalog as validator
from scripts.human_pose.curated_source import definitions, REVISION
from scripts.human_pose.files import canonical, read_json, save_json, sha256
from scripts.nyamuru_human_pose_store import HumanPoseStore


@unittest.skipUnless(Image, 'Pillow入りPythonで実行してください')
class CuratedCatalogTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name).resolve()
        self.root, self.stage = folder/'root', folder/'stage'
        self.root.mkdir()
        hashes = fixture(self.root)
        self.patch(validator, 'SOURCE_HASHES', hashes)
        self.original = (self.root/'catalog.json').read_bytes()
        self.rows = deepcopy(definitions())
        # 配布元のhashだけを小さい合成BVHへ対応させ、登録・検証処理は本体を使う。
        for row in self.rows:
            row['source']['sha256'] = sha256(row['id'].encode())
        self.patch(curated_catalog, 'definitions', lambda: self.rows)
        self.patch(register_curated, 'definitions', lambda: self.rows)
        shutil.copytree(self.root/'models', self.stage/'models')
        contract = read_json(self.stage/'models/human_base.rig.json')
        image = io.BytesIO()
        Image.new('RGBA', (1024, 1024), (150, 150, 150, 255)).save(image, 'PNG')
        manifest, reports = {'revision': REVISION, 'poses': []}, []
        for row in self.rows:
            identifier = row['id']
            pose = {'schema_version': 1, 'pose_id': identifier, 'revision': 1,
                    'rig_signature': contract['rig_signature'], 'base_glb_sha256': contract['base_glb_sha256'],
                    'transform_space': 'absolute_parent_local', 'root': TRS, 'bones': {'root': TRS},
                    'user_confirmed': True, 'reviewer': 'user', 'reviewed_at': '2026-10-09'}
            record = {'id': identifier, 'source': row['source'], 'original_gemini_prompt': row['original_gemini_prompt'],
                      'scene': {'sha256': 'a'*64, 'user_corrected': row['display_number'] in {17, 23}}}
            for kind, name, raw in [('pose', 'pose.json', canonical(pose)), ('preview', 'preview.png', image.getvalue()),
                                    ('bvh', 'source.bvh', identifier.encode())]:
                relative = f'poses/{identifier}/{name}'
                target = self.stage/relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
                record[kind] = {'path': relative, 'sha256': sha256(raw), 'byte_size': len(raw)}
            manifest['poses'].append(record)
            reports.append({'name': identifier, 'pose_sha256': record['pose']['sha256'], 'max_error_m': 0})
        save_json(self.stage/'sources/curated/index.json', manifest)
        save_json(self.stage/'poses/three-runtime-validation.json', {
            'base_glb_sha256': contract['base_glb_sha256'], 'rig_signature': contract['rig_signature'], 'cases': reports})

    def patch(self, module, name, value):
        context = patch.object(module, name, value)
        context.start()
        self.addCleanup(context.stop)

    def test_publish_preserves_old_bytes_and_serves_verified_previews(self):
        previous = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        catalog = register_curated.build_catalog(self.root, self.stage)
        self.assertEqual((self.root/'catalog.json').read_bytes(), self.original)
        register_curated.publish(self.root, self.stage, catalog)
        for name, raw in previous.items():
            if str(name) != 'catalog.json':
                self.assertEqual((self.root/name).read_bytes(), raw)
        self.assertEqual((self.root/f'backups/catalog-{sha256(self.original)}.json').read_bytes(), self.original)
        store = HumanPoseStore(self.root)
        result = store.catalog(include_previews=True)
        self.assertEqual(len(result['previews']), 30)
        for pose in result['catalog']['poses']:
            self.assertEqual(base64.b64decode(result['previews'][pose['id']]), (self.root/pose['asset_files']['preview']['path']).read_bytes())
        self.assertFalse(any(pose['image_reference_eligible'] for pose in result['catalog']['poses']))
        register_curated.publish(self.root, self.stage, catalog)

    def test_changed_pose_requires_new_runtime_report(self):
        path = self.stage/'poses/three-runtime-validation.json'
        report = read_json(path)
        report['cases'][0]['pose_sha256'] = '0'*64
        save_json(path, report)
        with self.assertRaises(ValueError):
            register_curated.build_catalog(self.root, self.stage)
        self.assertEqual((self.root/'catalog.json').read_bytes(), self.original)

    def test_prompt_and_source_swap_are_rejected(self):
        catalog = register_curated.build_catalog(self.root, self.stage)
        bad = deepcopy(catalog)
        bad['poses'][0]['pose_text_ja'] = bad['poses'][1]['pose_text_ja']
        with self.assertRaises(ValueError):
            validator.validate_catalog(bad, self.stage)
        source = self.stage/f"poses/{self.rows[0]['id']}/source.bvh"
        source.write_bytes(b'wrong source')
        with self.assertRaises(ValueError):
            validator.validate_catalog(catalog, self.stage)

    def test_conflict_does_not_replace_active_catalog(self):
        catalog = register_curated.build_catalog(self.root, self.stage)
        path = self.root/catalog['poses'][0]['asset_files']['preview']['path']
        path.parent.mkdir(parents=True)
        path.write_bytes(b'keep existing user material')
        with self.assertRaises(ValueError):
            register_curated.publish(self.root, self.stage, catalog)
        self.assertEqual(path.read_bytes(), b'keep existing user material')
        self.assertEqual((self.root/'catalog.json').read_bytes(), self.original)

    def test_store_rejects_source_symlink(self):
        catalog = register_curated.build_catalog(self.root, self.stage)
        register_curated.publish(self.root, self.stage, catalog)
        path = self.root/f"poses/{self.rows[0]['id']}/source.bvh"
        raw = path.read_bytes()
        path.unlink()
        external = self.root.parent/'external.bvh'
        external.write_bytes(raw)
        path.symlink_to(external)
        with self.assertRaises(ValueError):
            HumanPoseStore(self.root).catalog()


if __name__ == '__main__':
    unittest.main()
