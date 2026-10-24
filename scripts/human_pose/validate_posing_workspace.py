"""Exercise saved workspaces in stock Blender, with no MPFB addon dependency."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.human_pose.build_posing_workspace import capture_vertices, current_rig, error
from scripts.human_pose.editable_rig import activate


def apply_asset(rig, action):
    if rig.mode != 'POSE':
        bpy.ops.object.mode_set(mode='POSE')
    visibility = {c.name: c.is_visible for c in rig.data.collections}
    for collection in rig.data.collections:
        collection.is_visible = True
    bpy.ops.pose.select_all(action='DESELECT')
    for collection in rig.data.collections:
        collection.is_visible = visibility[collection.name]
    rig.pose.apply_pose_from_action(action, evaluation_time=1.0)
    bpy.context.view_layer.update()


def skin_signature(rig):
    result = {}
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers):
            continue
        groups = {group.index: group.name for group in obj.vertex_groups}
        value = [(list(v.co), [(groups[g.group], g.weight) for g in v.groups]) for v in obj.data.vertices]
        result[obj.name] = hashlib.sha256(repr(value).encode()).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = args.output
    inputs = json.loads((out/'input-manifest.json').read_text())
    builds = json.loads((out/'build-report.json').read_text())
    selected = json.loads((out/'selected-presets.json').read_text())
    records = json.loads((out/'pose-records.json').read_text())
    for item in inputs:
        assert hashlib.sha256(Path(item['source']).read_bytes()).hexdigest() == item['sha256']
    results = []
    for row in builds:
        source = next(item for item in inputs if item['key'] == row['key'])
        assert hashlib.sha256(Path(source['source']).read_bytes()).hexdigest() == source['sha256']
        bpy.ops.wm.open_mainfile(filepath=source['backup'], load_ui=False, use_scripts=False)
        rig = current_rig()
        before = capture_vertices(rig)
        skin = skin_signature(rig)
        rests = {b.name: (b.matrix_local.copy(), b.parent.name if b.parent else None, b.use_deform)
                 for b in rig.data.bones}
        bpy.ops.wm.open_mainfile(filepath=row['file'], load_ui=False, use_scripts=False)
        rig = current_rig()
        activate(rig)
        assert skin_signature(rig) == skin
        preservation = error(before, capture_vertices(rig))
        assert preservation < 0.0001, (row['key'], preservation)
        for name, (matrix, parent, deform) in rests.items():
            bone = rig.data.bones[name]
            assert (bone.parent.name if bone.parent else None) == parent
            assert bone.use_deform == deform
            assert max(abs(a-b) for ra, rb in zip(matrix, bone.matrix_local) for a, b in zip(ra, rb)) < 1e-6
        assert len(rig.data.bones) == len(rests) + 20
        assert all(not b.use_deform for b in rig.data.bones if b.name not in rests)
        assert all(not c.use_stretch for p in rig.pose.bones for c in p.constraints if c.type == 'IK')
        assets = sorted((a for a in bpy.data.actions if a.asset_data), key=lambda a: a.name)
        assert len(assets) == len(selected) + 1, len(assets)
        by_key = lambda key: bpy.data.actions[next(r['name'] for r in records if r['key'] == key)]
        for item in selected:
            assert bpy.data.actions[item['name']].asset_data.license == 'CC0-1.0'
            assert item['url'] in bpy.data.actions[item['name']].asset_data.description
        bounds = []
        for action in assets:
            apply_asset(rig, action)
            vertices = capture_vertices(rig)
            points = [p for values in vertices.values() for p in values]
            assert all(math.isfinite(value) for point in points for value in point), action.name
            extent = [max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
            assert max(extent) < 4 and min(extent) > 0.05, (action.name, extent)
            assert action.preview.image_size[0] > 0, action.name
            bounds.append({'asset': action.name, 'extent': extent})
        # Full pose can be recovered after applying all other assets.
        apply_asset(rig, by_key('base'))
        restored = error(before, capture_vertices(rig))
        assert restored < 0.0001, (row['key'], 'restore', restored)
        # The master grip moves four fingers, leaves the thumb/right hand independent.
        apply_asset(rig, by_key('base'))
        tip_before = rig.pose.bones['finger2-3.L'].tail.copy()
        thumb_before = rig.pose.bones['finger1-3.L'].tail.copy()
        right_before = rig.pose.bones['finger2-3.R'].tail.copy()
        rig.pose.bones['master_grip.L'].rotation_euler.x = 0.8
        bpy.context.view_layer.update()
        curl_movement = (rig.pose.bones['finger2-3.L'].tail-tip_before).length
        assert curl_movement > 0.02, curl_movement
        assert (rig.pose.bones['finger1-3.L'].tail-thumb_before).length < 1e-5
        assert (rig.pose.bones['finger2-3.R'].tail-right_before).length < 1e-5
        # Move a reachable hand target; evaluated wrist must follow it.
        apply_asset(rig, by_key('standing01'))
        wrist = rig.pose.bones['wrist.L']
        previous = wrist.head.copy()
        control = rig.pose.bones['hand_ik.L']
        matrix = control.matrix.copy()
        matrix.translation += Vector((0, -0.025, 0.025))
        control.matrix = matrix
        bpy.context.view_layer.update()
        hand_moved = (wrist.head-previous).length
        target_error = (wrist.head-control.head).length
        assert hand_moved > 0.01 and target_error < 0.005, (hand_moved, target_error)
        apply_asset(rig, by_key('standing01'))
        foot = rig.pose.bones['foot.L']
        previous = foot.head.copy()
        control = rig.pose.bones['foot_ik.L']
        matrix = control.matrix.copy()
        matrix.translation += Vector((0, -0.025, 0.05))
        control.matrix = matrix
        bpy.context.view_layer.update()
        foot_moved = (foot.head-previous).length
        foot_error = (foot.head-control.head).length
        assert foot_moved > 0.03 and foot_error < 0.005, (foot_moved, foot_error)
        apply_asset(rig, by_key('standing01'))
        # Native left/right flipped paste is reversible for all selected bones.
        bpy.ops.object.mode_set(mode='POSE')
        for collection in rig.data.collections:
            collection.is_visible = True
        bpy.ops.pose.select_all(action='SELECT')
        mirror_before = capture_vertices(rig)
        bpy.ops.pose.copy()
        bpy.ops.pose.paste(flipped=True)
        bpy.context.view_layer.update()
        bpy.ops.pose.copy()
        bpy.ops.pose.paste(flipped=True)
        bpy.context.view_layer.update()
        mirror_error = error(mirror_before, capture_vertices(rig))
        assert mirror_error < 0.0001, mirror_error
        results.append({'key': row['key'], 'initial_error': preservation, 'restore_error': restored,
                        'assets': len(assets), 'grip_movement': curl_movement, 'hand_target_error': target_error, 'hand_movement': hand_moved,
                        'foot_movement': foot_moved, 'foot_target_error': foot_error,
                        'mirror_roundtrip_error': mirror_error, 'asset_bounds': bounds})
        print('VALIDATED', row['key'], preservation, restored, target_error, mirror_error, flush=True)
    (out/'validation-report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
