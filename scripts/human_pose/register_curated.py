"""検証済み30件のカタログを作り、指定時だけ既存rootへ登録する。"""
import argparse
import copy

from pathlib import Path
from .curated_source import REVISION, TAGS, definitions, prompt_fields
from .files import asset_path, read_json, save_json, sha256, write_original
from .validate_catalog import require, validate_catalog


# Threeの全頂点検証が同じpose bytesに対して完了したものだけを登録する。
def build_catalog(root, stage):
    prior = read_json(asset_path(root, 'catalog.json'))
    validate_catalog(prior, root)
    source_path = asset_path(stage, 'sources/curated/index.json')
    manifest = read_json(source_path)
    runtime = read_json(asset_path(stage, 'poses/three-runtime-validation.json'))
    reports = {row['name']: row for row in runtime.get('cases', [])}
    contract = prior['coordinate_contract']
    require(runtime.get('base_glb_sha256') == contract['base']['sha256'] and
            runtime.get('rig_signature') == contract['rig_signature'], 'Three検証の共通素体が異なります')
    rows = definitions()
    require(len(reports) == len(rows) and len(manifest.get('poses', [])) == len(rows), '30件の変換と検証が必要です')
    catalog = {'schema_version': 2, 'source_revision': REVISION, 'tags': copy.deepcopy(TAGS),
               'coordinate_contract': copy.deepcopy(contract), 'source_manifest_sha256': sha256(source_path.read_bytes()),
               'poses': []}
    for row, provenance in zip(rows, manifest['poses']):
        identifier = row['id']
        report = reports.get(identifier, {})
        require(provenance.get('id') == identifier and report.get('pose_sha256') == provenance['pose']['sha256'] and
                0 <= report.get('max_error_m', float('inf')) < 1e-5, f'Three検証が必要です: {identifier}')
        catalog['poses'].append({'id': identifier, **prompt_fields(row),
            'asset_revision': 1, 'asset_files': {kind: provenance[kind] for kind in ('pose', 'preview')},
            'production_status': 'ready', 'image_reference_eligible': False,
            'source': {'revision': REVISION, 'path': 'sources/curated/index.json', 'license': 'CC0-1.0', 'images': []},
            'review': {'status': 'confirmed', 'user_confirmed': True, 'reviewer': 'user', 'reviewed_at': '2026-10-09'},
            'supports': [], 'normalization_notes': [], 'contact_notes': ['支持面・接触点は未登録。'],
            'approximation_notes': ['共通素体の4weight変形を使用。生成画像との厳密な一致は未確認。']})
    validate_catalog(catalog, stage)
    save_json(asset_path(stage, 'catalog.json'), catalog)
    return catalog


# 既存IDを書き換えず、旧catalogをhash名で退避して最後にcatalogだけを切り替える。
def publish(root, stage, catalog):
    path = asset_path(root, 'catalog.json')
    original = path.read_bytes()
    validate_catalog(catalog, stage)
    current = read_json(path)
    require(current.get('schema_version') == 1 or current == catalog, '別の採用版catalogを上書きできません')
    manifest = read_json(asset_path(stage, 'sources/curated/index.json'))
    names = ['sources/curated/index.json']
    names += [p[kind]['path'] for p in manifest['poses'] for kind in ('pose', 'preview', 'bvh')]
    for kind in ('base', 'rig'):
        relative = catalog['coordinate_contract'][kind]['path']
        require(asset_path(root, relative).read_bytes() == asset_path(stage, relative).read_bytes(), '共通素体が変わりました')
    copies = [(asset_path(root, name), asset_path(stage, name).read_bytes()) for name in names]
    for target, raw in copies:
        require(not target.exists() or target.read_bytes() == raw, f'既存素材と衝突します: {target.name}')
    for target, raw in copies:
        write_original(target, raw)
    validate_catalog(catalog, root)
    require(path.read_bytes() == original, '作業中にcatalogが変わりました')
    write_original(asset_path(root, f'backups/catalog-{sha256(original)}.json'), original)
    save_json(path, catalog)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    catalog = build_catalog(args.root, args.stage)
    if args.publish:
        publish(args.root, args.stage, catalog)
    print({'poses': len(catalog['poses']), 'published': args.publish})
