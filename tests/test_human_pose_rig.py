"""保存姿勢の取り違えと壊れたGLBを拒否する。"""
import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from scripts.human_pose.glb import read_glb, rig_contract
from scripts.human_pose.pose_contract import validate_pose
from scripts.human_pose.files import sha256
from scripts.human_pose.pilot_specs import PILOTS
from scripts.human_pose.register_pilot import load_pilot, register_pilot


TRS = {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1]}
CONTRACT = {'rig_signature': 'a' * 64, 'base_glb_sha256': 'b' * 64, 'bones': [{'name': 'root'}]}
POSE = {'schema_version': 1, 'pose_id': 'pose-fixture', 'revision': 1, 'rig_signature': 'a' * 64,
        'base_glb_sha256': 'b' * 64, 'transform_space': 'absolute_parent_local',
        'root': TRS, 'bones': {'root': TRS}, 'user_confirmed': False}


class PoseContractTests(unittest.TestCase):
    def test_provisional_and_confirmed_are_distinct(self):
        self.assertTrue(validate_pose(POSE, CONTRACT))
        value = copy.deepcopy(POSE)
        value['user_confirmed'] = True
        with self.assertRaises(ValueError):
            validate_pose(value, CONTRACT)
        value.update(reviewer='利用者', reviewed_at='2026-10-09T12:00:00+09:00')
        self.assertTrue(validate_pose(value, CONTRACT))

    def test_rejects_wrong_asset_and_missing_or_unknown_bone(self):
        for key, wrong in [('rig_signature', 'c' * 64), ('base_glb_sha256', 'd' * 64),
                           ('bones', {}), ('bones', {'other': TRS}), ('schema_version', True),
                           ('revision', 0), ('transform_space', 'world'), ('user_confirmed', 1)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_pose({**POSE, key: wrong}, CONTRACT)

    def test_rejects_nonfinite_deformed_scale_and_invalid_quaternion(self):
        for key, wrong in [('translation', [0, float('nan'), 0]), ('translation', [True, 0, 0]),
                           ('rotation', [0, 0, 0, 0]), ('scale', [1, 2, 1])]:
            value = copy.deepcopy(POSE)
            value['bones']['root'] = {**TRS, key: wrong}
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_pose(value, CONTRACT)


# 小さな実GLB形式のfixtureで、4本制限と署名の出所を検査する。
class GlbContractTests(unittest.TestCase):
    def write_glb(self, path, extra_weights=False):
        data = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 16}],
                'bufferViews': [{'buffer': 0, 'byteLength': 16}],
                'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC4', 'count': 1}],
                'nodes': [{'name': 'human_rig', 'children': [1]}, {'name': 'root'}],
                'skins': [{'joints': [1]}], 'meshes': [{'primitives': [{'attributes': {'JOINTS_0': 0, 'WEIGHTS_0': 0}}]}]}
        if extra_weights:
            data['meshes'][0]['primitives'][0]['attributes']['JOINTS_1'] = 0
        encoded = json.dumps(data).encode()
        encoded += b' ' * (-len(encoded) % 4)
        binary = struct.pack('<4f', 1, 0, 0, 0)
        raw = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(encoded) + 8 + len(binary))
        raw += struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
        raw += struct.pack('<II', len(binary), 0x004E4942) + binary
        path.write_bytes(raw)

    def test_signature_uses_actual_rest_and_rejects_eight_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'base.glb'
            self.write_glb(path)
            result = rig_contract(path)
            self.assertEqual(result['bones'], [{'name': 'root', 'parent': None, 'rest': TRS}])
            self.assertEqual(result['unit'], 'meter')
            self.write_glb(path, extra_weights=True)
            with self.assertRaisesRegex(ValueError, '4本'):
                rig_contract(path)

    def test_invalid_glb_header_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'base.glb'
            path.write_bytes(b'not a GLB')
            with self.assertRaises(ValueError):
                read_glb(path)


# 別revisionの検証結果や確認済みflagを、未確認試作へ紛れ込ませない。
class PilotValidationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.folder = self.root / 'review/pilot'
        (self.root / 'models').mkdir()
        (self.root / 'models/human_base.rig.json').write_text(json.dumps(CONTRACT))
        self.manifest = {'base_glb_sha256': CONTRACT['base_glb_sha256'], 'rig_signature': CONTRACT['rig_signature'],
                         'revision': 1, 'user_confirmed': False, 'cases': []}
        self.runtime = {key: self.manifest[key] for key in ('base_glb_sha256', 'rig_signature')}
        self.runtime['cases'] = []
        for spec in PILOTS:
            folder = self.folder / spec['key']
            folder.mkdir(parents=True)
            raw = json.dumps({**POSE, 'pose_id': spec['id'], 'approximation_notes': ['近似']}).encode()
            records = {}
            for filename, value in [('pose.json', raw), ('preview.png', b'preview'), ('guide.png', b'guide')]:
                (folder / filename).write_bytes(value)
                records[filename] = {'sha256': sha256(value), 'byte_size': len(value)}
            self.manifest['cases'].append({'name': spec['key'], 'pose_id': spec['id'], 'files': records})
            self.runtime['cases'].append({'name': spec['key'], 'pose_sha256': sha256(raw), 'max_error_m': 0})
        self.save()
        # 画像decodeはcatalog/storeの実画像試験に任せ、ここでは検証記録の対応を調べる。
        decoding = patch('scripts.human_pose.register_pilot.image_info', return_value={'format': 'PNG'})
        decoding.start()
        self.addCleanup(decoding.stop)

    def save(self):
        (self.folder / 'pilot.json').write_text(json.dumps(self.manifest))
        (self.folder / 'three-runtime-validation.json').write_text(json.dumps(self.runtime))

    def test_accepts_exact_six_provisional_poses(self):
        self.assertEqual(len(load_pilot(self.root, 'review/pilot')), 6)

    def test_rejects_runtime_report_for_different_pose(self):
        self.runtime['cases'][0]['pose_sha256'] = '0' * 64
        self.save()
        with self.assertRaisesRegex(ValueError, 'runtime'):
            load_pilot(self.root, 'review/pilot')

    def test_rejects_confirmation_flag_and_duplicate_case(self):
        self.manifest['user_confirmed'] = True
        self.save()
        with self.assertRaises(ValueError):
            load_pilot(self.root, 'review/pilot')
        self.manifest['user_confirmed'] = False
        self.manifest['cases'][1] = self.manifest['cases'][0]
        self.save()
        with self.assertRaises(ValueError):
            load_pilot(self.root, 'review/pilot')

    def test_rejects_changed_comparison_image(self):
        (self.folder / PILOTS[0]['key'] / 'guide.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash'):
            load_pilot(self.root, 'review/pilot')

    def test_registration_preserves_review_and_notes_on_repeat(self):
        review = {'status': 'changes_requested', 'user_confirmed': False, 'note': '修正してほしい'}
        catalog = {'poses': [{'id': spec['id'], 'review': review, 'asset_files': {},
                              'approximation_notes': ['利用者のメモ']} for spec in PILOTS]}
        path = self.root / 'catalog.json'
        path.write_text(json.dumps(catalog))
        # catalog全体の検証は既存fixtureで扱い、再登録時の保存状態だけを検査する。
        with patch('scripts.human_pose.register_pilot.validate_catalog'):
            register_pilot(self.root, 'review/pilot')
            first = path.read_bytes()
            register_pilot(self.root, 'review/pilot')
        self.assertEqual(path.read_bytes(), first)
        for pose in json.loads(first)['poses']:
            self.assertEqual(pose['review'], review)
            self.assertEqual(pose['approximation_notes'], ['利用者のメモ', '近似'])


if __name__ == '__main__':
    unittest.main()
