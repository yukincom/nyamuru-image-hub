"""検証した試作を未確認のまま登録し、既存素材は上書きしない。"""
import argparse
import copy
import json
from pathlib import Path

from .files import asset_path, image_info, read_json, save_json, sha256, write_original
from .pilot_specs import PILOTS
from .pose_contract import validate_pose
from .validate_catalog import file_record, require, validate_catalog


# 実際に検証したposeのhashと対応させ、古い検証結果を流用しない。
def load_pilot(root, relative):
    manifest = read_json(asset_path(root, f'{relative}/pilot.json'))
    contract = read_json(asset_path(root, 'models/human_base.rig.json'))
    runtime = read_json(asset_path(root, f'{relative}/three-runtime-validation.json'))
    for value in (manifest, runtime):
        require(value.get('base_glb_sha256') == contract['base_glb_sha256'] and
                value.get('rig_signature') == contract['rig_signature'], '試作の共通素体が一致しません')
    require(manifest.get('user_confirmed') is False, 'この処理は未確認の試作だけを扱います')
    expected = {spec['key']: spec['id'] for spec in PILOTS}
    cases = manifest.get('cases', [])
    reports = {entry['name']: entry for entry in runtime['cases']}
    require(len(cases) == len(expected) and {entry['name']: entry['pose_id'] for entry in cases} == expected,
            '代表6件のIDが一致しません')
    loaded = []
    for case in cases:
        name = case['name']
        files = {}
        for filename in ('pose.json', 'preview.png', 'guide.png'):
            record = {**case['files'][filename], 'path': f'{relative}/{name}/{filename}'}
            files[filename] = file_record(record, root)
            if filename.endswith('.png'):
                require(image_info(files[filename])['format'] == 'PNG', '比較画像はPNGにしてください')
        pose = json.loads(files['pose.json'])
        validate_pose(pose, contract)
        require(pose['pose_id'] == case['pose_id'] and pose['revision'] == manifest['revision'] and
                pose['user_confirmed'] is False, '試作の姿勢記録が一致しません')
        report = reports.get(name, {})
        require(report.get('pose_sha256') == sha256(files['pose.json']) and
                0 <= report.get('max_error_m', float('inf')) < 1e-5, 'この姿勢のruntime検証が必要です')
        loaded.append((case, pose, files))
    return loaded


def register_pilot(root, relative):
    catalog_path = asset_path(root, 'catalog.json')
    original = catalog_path.read_bytes()
    catalog = read_json(catalog_path)
    validate_catalog(catalog, root)
    result = copy.deepcopy(catalog)
    entries = {entry['id']: entry for entry in result['poses']}
    copies = []
    for case, pose, files in load_pilot(root, relative):
        entry = entries[case['pose_id']]
        require(not entry['review']['user_confirmed'], '確認済み素材は上書きできません')
        assets = dict(entry['asset_files'])
        for kind, filename in [('pose', 'pose.json'), ('preview', 'preview.png')]:
            relative_path = f"poses/{case['pose_id']}/{filename}"
            path, raw = asset_path(root, relative_path), files[filename]
            require(not path.exists() or path.read_bytes() == raw, '別の試作素材が既にあります')
            copies.append((path, raw))
            assets[kind] = {'path': relative_path, 'sha256': sha256(raw), 'byte_size': len(raw)}
        entry.update(asset_revision=pose['revision'], asset_files=assets, production_status='in_progress',
                     image_reference_eligible=False,
                     approximation_notes=list(dict.fromkeys(entry['approximation_notes'] + pose['approximation_notes'])))
    # 全件の衝突を先に検査し、途中で失敗してもcatalogを変更しない。
    for path, raw in copies:
        write_original(path, raw)
    validate_catalog(result, root)
    require(catalog_path.read_bytes() == original, '作業中にcatalogが変わりました')
    save_json(catalog_path, result)
    return {'registered': len(copies) // 2, 'user_confirmed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--pilot', required=True)
    args = parser.parse_args()
    print(register_pilot(args.root, args.pilot))
