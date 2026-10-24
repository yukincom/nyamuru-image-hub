"""採用poseを背景Blenderで読み、共通163骨へ焼き込む（原本は保存しない）。"""
import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.build_posing_workspace import current_rig
from scripts.human_pose.curated_source import REVISION, definitions
from scripts.human_pose.files import read_json, save_json, sha256, write_original
from scripts.human_pose.pose_contract import validate_pose
from scripts.human_pose.rig import AXIS, apply_pose, bone_trs, capture_pose
from scripts.human_pose.validate_posing_workspace import apply_asset
from scripts.human_pose.validate_rig import point_error, positions, runtime_mesh


# IK helperは変形骨の評価済み行列へ焼き込み、元の親/restが変わっていないことも確認する。
def capture(rig, contract):
    for entry in contract['bones']:
        bone = rig.data.bones[entry['name']]
        if (bone.parent.name if bone.parent else None) != entry['parent']:
            raise ValueError('共通素体と親骨が異なります')
        rest = bone_trs(bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local,
                        bool(bone.parent))
        if any(max(abs(a-b) for a, b in zip(rest[key], entry['rest'][key])) > 1e-5 for key in ('translation', 'scale')):
            raise ValueError('共通素体とrest位置が異なります')
        if abs(abs(sum(a*b for a, b in zip(rest['rotation'], entry['rest']['rotation']))) - 1) > 1e-5:
            raise ValueError('共通素体とrest回転が異なります')
    saved = capture_pose(rig)
    saved['bones'] = {entry['name']: saved['bones'][entry['name']] for entry in contract['bones']}
    return saved


# 一覧PNGと同じcamera規則を保存する。生成用の撮影確認には転用しない。
def preview_camera(rig):
    graph = bpy.context.evaluated_depsgraph_get()
    bodies = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and
              any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]
    points = [o.matrix_world @ v.co for o in bodies for v in o.evaluated_get(graph).data.vertices]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = (low+high)/2
    direction = Vector((0.28, -1, 0.12) if high.z-low.z > (high.y-low.y)*0.75 else (1, -0.3, 0.6)).normalized()
    rotation = (-direction).to_track_quat('-Z', 'Y')
    return {'projection': 'orthographic', 'position': list(AXIS @ (target+direction*6)),
            'target': list(AXIS @ target), 'up': list(AXIS.to_3x3() @ (rotation @ Vector((0, 1, 0)))),
            'orthographic_scale': max(high-low)*1.3, 'aspect': 1}


def record(path, root):
    raw = path.read_bytes()
    return {'path': path.relative_to(root).as_posix(), 'sha256': sha256(raw), 'byte_size': len(raw)}


def export(root, workspace, output):
    root, workspace, output = root.resolve(), workspace.resolve(), output.resolve()
    rows = definitions()
    if read_json(workspace/'selected-presets.json') != [row['source'] for row in rows]:
        # 配布時の並び順には依存せず、内容だけを照合する。
        actual = sorted(read_json(workspace/'selected-presets.json'), key=lambda row: row['name'])
        if actual != [row['source'] for row in rows]:
            raise ValueError('選択済み30件の配布元記録が一致しません')
    output.mkdir(parents=True, exist_ok=False)
    contract = read_json(root/'models/human_base.rig.json')
    if sha256((root/'models/human_base.glb').read_bytes()) != contract['base_glb_sha256']:
        raise ValueError('共通素体のhashが変わりました')
    for name in ('human_base.glb', 'human_base.rig.json'):
        write_original(output/'models'/name, (root/'models'/name).read_bytes())
    manifest = {'revision': REVISION, 'poses': []}
    for row in rows:
        number, identifier = row['display_number'], row['id']
        corrected = number in {17, 23}
        scene = (workspace/f'recapture-20261009/asset-{number}-user-corrected.blend' if corrected
                 else workspace/'ready/ポーズ作業台.blend')
        source_hash = sha256(scene.read_bytes())
        bpy.ops.wm.open_mainfile(filepath=str(scene), load_ui=False, use_scripts=False)
        rig = current_rig()
        if not corrected:
            apply_asset(rig, bpy.data.actions[row['source']['name']])
        camera = preview_camera(rig)
        pose = {'schema_version': 1, 'pose_id': identifier, 'revision': 1,
                'rig_signature': contract['rig_signature'], 'base_glb_sha256': contract['base_glb_sha256'],
                'transform_space': 'absolute_parent_local', 'user_confirmed': True,
                'reviewer': 'user', 'reviewed_at': '2026-10-09', 'supports': [], 'contacts': {},
                'preview_camera': camera, 'comparison_camera': camera,
                'approximation_notes': ['支持面・接触点の登録と生成用の撮影確認は未実施。'], **capture(rig, contract)}
        validate_pose(pose, contract)
        body = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.materials) and
                    any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers))
        before = positions(runtime_mesh(root/'models/human_base.glb', rig, body.data.materials[0]))
        # 同じ共通素体へFKだけで再適用し、helper除去による変形差を検出する。
        bpy.ops.wm.open_mainfile(filepath=str(root/'models/human_base.blend'), load_ui=False, use_scripts=False)
        base, rig = bpy.data.objects['human_base'], bpy.data.objects['human_rig']
        apply_pose(rig, pose)
        after = positions(runtime_mesh(root/'models/human_base.glb', rig, base.data.materials[0]))
        difference = point_error(before, after)
        if difference >= 1e-5:
            raise ValueError(f'共通素体への焼込みに差があります: {number}: {difference}m')
        folder = output/'poses'/identifier
        save_json(folder/'pose.json', pose)
        save_json(folder/'expected-runtime-points.json', [list(AXIS @ point) for point in before])
        write_original(folder/'preview.png', (workspace/f'ポーズPNG/{number}.png').read_bytes())
        bvh = workspace/'preset-sources'/row['source']['path']
        raw = bvh.read_bytes()
        if sha256(raw) != row['source']['sha256']:
            raise ValueError('配布BVHのhashが一致しません')
        write_original(folder/'source.bvh', raw)
        if sha256(scene.read_bytes()) != source_hash:
            raise ValueError('出力中に原本blendが変わりました')
        manifest['poses'].append({'id': identifier, 'source': row['source'],
            'original_gemini_prompt': row['original_gemini_prompt'],
            'scene': {'path': str(scene), 'sha256': source_hash, 'user_corrected': corrected},
            'roundtrip_error_m': difference, 'bvh': record(folder/'source.bvh', output),
            'pose': record(folder/'pose.json', output), 'preview': record(folder/'preview.png', output)})
    save_json(output/'sources/curated/index.json', manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    export(args.root, args.workspace, args.output)
