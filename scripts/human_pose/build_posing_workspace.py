"""Run in the project's existing MPFB Blender profile; only write new workspaces."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.human_pose.editable_rig import activate
from scripts.human_pose.rig import evaluated_points
from scripts.human_pose.posing_tools import add_helpers, apply_basis, normalize_object, set_xyz, setup_view
from scripts.human_pose.pose_library import basis_dict, official_pose, mark_asset, render_preview, write_catalog

TITLES = {'base': '00 初期状態'}


def current_rig():
    return next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')


def capture_vertices(rig):
    return {o.name: [Vector(p) for p, _ in evaluated_points(o)] for o in bpy.context.scene.objects
            if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)}


def error(before, after):
    assert before.keys() == after.keys()
    return max((a-b).length for name in before for a, b in zip(before[name], after[name]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    out = args.output.resolve()
    manifest = json.loads((out/'input-manifest.json').read_text())
    source = next(row for row in manifest if row['key'] == 'base')
    backup = out/'input-backups/base.blend'
    assert hashlib.sha256(backup.read_bytes()).hexdigest() == source['sha256'], backup
    records = []
    for key in TITLES:
        bpy.ops.wm.open_mainfile(filepath=str(out/'input-backups'/f'{key}.blend'), load_ui=False, use_scripts=False)
        rig = current_rig()
        before = capture_vertices(rig)
        normalize_object(rig)
        set_xyz(rig)
        assert error(before, capture_vertices(rig)) < 0.0001, key
        records.append({'key': key, 'name': TITLES[key], 'category': '初期化', 'basis': basis_dict(rig),
                        'description': '素体の初期状態に戻すためのアセットです。'})
    # Load BVH only into temporary copies of the base rig; original rest matrices survive.
    bpy.ops.wm.open_mainfile(filepath=str(out/'input-backups/base.blend'), load_ui=False, use_scripts=False)
    rig = current_rig()
    selected = json.loads((out/'selected-presets.json').read_text())
    for item in selected:
        path = out/'preset-sources'/item['path']
        assert item['license'] == 'CC0-1.0' and item['status'] == 'accepted'
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
        meta_path = path.with_suffix('.meta')
        if meta_path.exists():
            metadata = meta_path.read_text()
            declared = [line.split(None, 1)[1].strip().lower()
                        for line in metadata.splitlines()
                        if line.strip().lower().startswith('license ')]
            # Some metadata omits a license; its primary distribution table is
            # the recorded evidence. An explicit conflicting license is rejected.
            assert not declared or all(value in ('cc0', 'cc-0') for value in declared), path
        assert item['distribution_url'] and item['license_evidence']
        description = (f"作者: {item['author']}\n配布元: {item['url']}\n配布表: {item['distribution_url']}\nライセンス: CC0 1.0\n"
                       f"用途: {item['use']}\n変換: 現在の体格・IKリグ用に変換し接地を補正。小物は別途配置。\n"
                       'https://creativecommons.org/publicdomain/zero/1.0/')
        records.append({'key': path.stem, 'name': item['name'], 'category': item['category'],
                        'basis': official_pose(rig, path), 'description': description,
                        'author': item['author'], 'license': item['license'],
                        'source': str(path), 'sha256': item['sha256']})
    (out/'pose-records.json').write_text(json.dumps(records, ensure_ascii=False), encoding='utf-8')
    preview_dir = out/'ready/previews'
    preview_dir.mkdir(parents=True, exist_ok=True)
    results = []
    keys = ['base']
    for key in keys:
        bpy.ops.wm.open_mainfile(filepath=str(out/'input-backups'/f'{key}.blend'), load_ui=False, use_scripts=False)
        rig = current_rig()
        before = capture_vertices(rig)
        normalize_object(rig)
        set_xyz(rig)
        original_pose = basis_dict(rig)
        original = add_helpers(rig)
        preservation_error = error(before, capture_vertices(rig))
        print('PRESERVE', key, preservation_error, flush=True)
        assert preservation_error < 0.0001, (key, preservation_error)
        assets = []
        for row in records:
            apply_basis(rig, row['basis'])
            # Official files contain rotation only. Put their lowest point on the ground.
            if row['category'] != '初期化':
                points = capture_vertices(rig)
                z = min(p.z for values in points.values() for p in values)
                for bone in rig.pose.bones:
                    if not bone.parent:
                        matrix = bone.matrix.copy()
                        matrix.translation.z -= z
                        bone.matrix = matrix
                bpy.context.view_layer.update()
                translated = capture_vertices(rig)
                delta = Vector((0, 0, z))
                assert max((a-b-delta).length for name in points for a, b in
                           zip(points[name], translated[name])) < 0.0001, row['key']
            thumbnail = preview_dir/(row['key']+'.png')
            if key == keys[0]:
                render_preview(rig, thumbnail)
            asset = mark_asset(rig, row['name'], row['category'], row['description'], preview=thumbnail,
                               author=row.get('author', ''), license_name=row.get('license', ''))
            assets.append(asset.name)
        apply_basis(rig, original_pose)
        assert error(before, capture_vertices(rig)) < 0.0001, key
        setup_view(rig, set(original))
        dest = out/'ready' if key == 'base' else out/'ready'/key
        dest.mkdir(parents=True, exist_ok=True)
        write_catalog(dest/'blender_assets.cats.txt')
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(dest/'ポーズ作業台.blend'), check_existing=False)
        results.append({'key': key, 'file': str(dest/'ポーズ作業台.blend'), 'original_bones': len(original),
                        'bones': len(rig.data.bones), 'max_vertex_error': preservation_error, 'assets': assets})
        (out/'build-report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    write_catalog(out/'ready/blender_assets.cats.txt')


if __name__ == '__main__':
    main()
