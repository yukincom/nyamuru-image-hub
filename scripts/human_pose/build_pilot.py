"""確認用の6姿勢を、新しい比較folderへ仮出力する。"""
import argparse
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.files import read_json, save_json, sha256
from scripts.human_pose.editable_rig import activate, open_pose_mode, prepare_rig_editing
from scripts.human_pose.pilot_pose import make_pose
from scripts.human_pose.pilot_render import create_supports, mannequin, render_one
from scripts.human_pose.pilot_specs import PILOTS
from scripts.human_pose.pose_contract import validate_pose
from scripts.human_pose.render_base import render_views
from scripts.human_pose.rig import AXIS, apply_pose, capture_pose, reset_pose
from scripts.human_pose.validate_rig import point_error, positions, runtime_mesh


# 表示中の同じ4weight meshと既存rigを、手直し用の別blendへ保存する。
def save_editable(folder, body, runtime, rig, pose):
    body.hide_set(True)
    runtime.hide_set(False)
    runtime.hide_render = False
    prepare_rig_editing(rig)
    rig['human_pose_id'] = pose['pose_id']
    rig['human_pose_revision'] = pose['revision']
    rig['human_pose_source_json'] = str((folder / 'pose.json').resolve())
    open_pose_mode(rig)
    bpy.ops.wm.save_as_mainfile(filepath=str((folder / 'editable.blend').resolve()), check_existing=False)
    bpy.ops.object.mode_set(mode='OBJECT')


# 仮出力は既存folderを上書きせず、利用者確認flagも付けない。
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--revision', type=int, default=1)
    parser.add_argument('--references', type=Path)
    parser.add_argument('--editable', action='store_true', help='同じ姿勢を手直しできるblendも保存する')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.output.mkdir(parents=True, exist_ok=False)
    models = args.root / 'models'
    metadata = read_json(models / 'human_base.metadata.json')
    contract = read_json(models / 'human_base.rig.json')
    if metadata['validation_status'] != 'verified_for_pilot':
        raise ValueError('共通素体の検証が必要です')
    for item in metadata['files'].values():
        if sha256((models / item['name']).read_bytes()) != item['sha256']:
            raise ValueError('共通素体のhashが変わりました')
    catalog = {pose['id']: pose for pose in read_json(args.root / 'catalog.json')['poses']}
    manifest = {'base_glb_sha256': contract['base_glb_sha256'], 'rig_signature': contract['rig_signature'],
                'revision': args.revision, 'user_confirmed': False, 'cases': []}
    for spec in PILOTS:
        bpy.ops.wm.open_mainfile(filepath=str(models / 'human_base.blend'), load_ui=False, use_scripts=False)
        body, rig = bpy.data.objects['human_base'], bpy.data.objects['human_rig']
        activate(rig)
        runtime = runtime_mesh(models / 'human_base.glb', rig, body.data.materials[0])
        body.hide_render = True
        supports, contacts = make_pose(rig, runtime, spec['key'])
        pose = {'schema_version': 1, 'pose_id': spec['id'], 'revision': args.revision,
                'rig_signature': contract['rig_signature'], 'base_glb_sha256': contract['base_glb_sha256'],
                'transform_space': 'absolute_parent_local', 'user_confirmed': False,
                'interpretation_notes': spec['interpretation'], 'source_comparison': spec['source_comparison'],
                'approximation_notes': spec['approximation'], 'supports': supports, 'contacts': contacts, **capture_pose(rig)}
        # 生成した多面図は寸法の正本にせず、参照元とhashを姿勢へ紐付ける。
        if args.references:
            model = 'qwen-image-2.1' if spec['key'] == 'lying' else 'krea-2'
            sheet = 'squat-v3.png' if spec['key'] == 'squat' else spec['key'] + '.png'
            paths = {'source': args.root / 'poses' / spec['id'] / 'references' / (model + '.webp'),
                     'multiview': args.references / sheet, 'prompts': args.references / 'prompts.json'}
            pose['reference_images'] = {kind: {'path': str(path.resolve().relative_to(args.root.resolve())),
                'sha256': sha256(path.read_bytes())} for kind, path in paths.items()}
        validate_pose(pose, contract)
        before = positions(runtime)
        reset_pose(rig)
        apply_pose(rig, pose)
        after = positions(runtime)
        error = point_error(before, after)
        if error > 1e-5:
            raise ValueError(f"姿勢を再構築できません: {spec['key']}: {error}")
        folder = args.output / spec['key']
        folder.mkdir()
        support_objects = create_supports(supports)
        directions = {'front': (0, -1, 0.08), 'oblique': (0.9, -1, 0.3)}
        if spec['key'] == 'lying':
            directions['oblique'] = (1.2, -0.8, 1.7)
        pose['comparison_cameras'] = render_views([runtime, *support_objects], folder, 'guide')
        pose['comparison_camera'] = render_one([runtime, *support_objects], folder / 'guide.png', directions[spec['view']])
        if spec['key'] == 'lying':
            pose['top_comparison_camera'] = render_one([runtime, *support_objects], folder / 'guide-top.png', (0, 0, 1))
        if args.editable:
            save_editable(folder, body, runtime, rig, pose)
        runtime.hide_render = True
        simple = mannequin(rig)
        pose['preview_camera'] = render_one([*simple, *support_objects], folder / 'preview.png', directions[spec['view']], simple=True)
        save_json(folder / 'pose.json', pose)
        save_json(folder / 'expected-runtime-points.json', [list(AXIS @ point) for point in after])
        entry = {'name': spec['key'], 'pose_id': spec['id'], 'label_ja': catalog[spec['id']]['label_ja'],
                 'roundtrip_error_m': error, 'contacts': contacts,
                 'files': {name: {'sha256': sha256((folder / name).read_bytes()), 'byte_size': (folder / name).stat().st_size}
                           for name in ('pose.json', 'preview.png', 'guide.png')}}
        if args.editable:
            entry['files']['editable.blend'] = {'sha256': sha256((folder / 'editable.blend').read_bytes()),
                                               'byte_size': (folder / 'editable.blend').stat().st_size}
        manifest['cases'].append(entry)
        save_json(args.output / 'pilot.json', manifest)
    print({'output': str(args.output), 'poses': len(manifest['cases']), 'user_confirmed': False})


if __name__ == '__main__':
    main()
