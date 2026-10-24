"""見た目の保存だけでなく、接続・関節操作・変形データの保持を検査する。"""
import hashlib
import json
import math

import bpy
from mathutils import Matrix

from scripts.human_pose.editable_rig import HELPER_NAMES, LIMBS, open_pose_mode
from scripts.human_pose.inspection import matrix_rows, mesh_record
from scripts.human_pose.rig import apply_pose, capture_pose, evaluated_points


def bodies_for(rig):
    return [obj for obj in bpy.context.scene.objects if obj.type == 'MESH'
            and any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers)]


def snapshot(rig):
    bodies = bodies_for(rig)
    return {'rest': {bone.name: {'parent': bone.parent.name if bone.parent else None,
                               'matrix': matrix_rows(bone.matrix_local), 'deform': bone.use_deform,
                               'inherit_scale': bone.inherit_scale} for bone in rig.data.bones},
            'root': matrix_rows(rig.matrix_world),
            'basis': {p.name: matrix_rows(p.matrix_basis) for p in rig.pose.bones},
            'meshes': {obj.name: mesh_record(obj) for obj in bodies},
            'weights': {obj.name: hashlib.sha256(json.dumps(
                [[(g.group, g.weight) for g in v.groups] for v in obj.data.vertices]).encode()).hexdigest()
                for obj in bodies},
            'points': {obj.name: [point for point, _ in evaluated_points(obj)] for obj in bodies}}


def max_point_error(before, after):
    from mathutils import Vector
    if before.keys() != after.keys():
        raise AssertionError('比較するmeshが変わりました')
    error = 0.0
    for key in before:
        assert len(before[key]) == len(after[key]), key
        error = max(error, max((Vector(a) - Vector(b)).length for a, b in zip(before[key], after[key])))
    return error


def assert_preserved(before, after):
    for key in ('rest', 'root', 'weights'):
        assert before[key] == after[key], key
    basis_error = max(abs(a - b) for name, matrix in before['basis'].items()
                      for ra, rb in zip(matrix, after['basis'][name]) for a, b in zip(ra, rb))
    # 接続時に消える浮動小数の移動残差だけを許し、実際のpose変更を検出する。
    assert basis_error < 1e-6, ('basis', basis_error)
    for name, mesh in before['meshes'].items():
        for key in ('vertices', 'polygons', 'coordinates_sha256', 'shape_keys', 'vertex_groups'):
            assert mesh[key] == after['meshes'][name][key], (name, key)
    error = max_point_error(before['points'], after['points'])
    assert error < 1e-5, error
    return error


# 実骨を回したときも途中の補助骨との相対行列が一定で、関節が離れない。
def validate_editing(rig):
    object_transform = {key: tuple(getattr(rig, key)) for key in
                        ('location', 'rotation_quaternion', 'rotation_euler', 'rotation_axis_angle', 'scale')}
    assert len(rig.data.bones) == 163
    assert rig.data.show_bone_custom_shapes
    assert not any(p.constraints for p in rig.pose.bones)
    for bone in rig.data.bones:
        pose = rig.pose.bones[bone.name]
        if bone.parent:
            assert all(pose.lock_location), bone.name
            if (bone.head_local - bone.parent.tail_local).length < 1e-8:
                assert bone.use_connect, bone.name
        assert all(pose.lock_scale), bone.name
    for name in HELPER_NAMES:
        bone, pose = rig.data.bones[name], rig.pose.bones[name]
        assert not bone.hide and not bone.hide_select, name
        assert list(pose.lock_rotation) == [True, False, True], name
        assert not pose.lock_rotation_w and pose.lock_rotations_4d, name
        assert len(bone.collections) == 1 and not bone.collections[0].is_visible, name
    initial = {p.name: p.matrix_basis.copy() for p in rig.pose.bones}
    initial_channels = {p.name: {key: tuple(getattr(p, key)) for key in object_transform}
                        for p in rig.pose.bones}
    rows = []
    for part, end in LIMBS.items():
        for side in ('L', 'R'):
            name = part + '01.' + side
            pose, helper, joint = (rig.pose.bones[n] for n in (name, part + '02.' + side, end + '.' + side))
            assert pose.custom_shape and not pose.use_custom_shape_bone_size
            assert not pose.custom_shape.users_collection
            visible_tip = pose.matrix @ pose.custom_shape.data.vertices[1].co
            assert (visible_tip - joint.head).length < 1e-5, name
            relative = pose.matrix.inverted() @ helper.matrix
            fixed_head = pose.head.copy()
            old_tip = joint.head.copy()
            pose.matrix_basis = initial[name] @ Matrix.Rotation(math.radians(25), 4, 'X')
            bpy.context.view_layer.update()
            head_error = (pose.head - fixed_head).length
            relative_error = max(abs(a - b) for ra, rb in zip(relative, pose.matrix.inverted() @ helper.matrix)
                                 for a, b in zip(ra, rb))
            tip_error = (pose.matrix @ pose.custom_shape.data.vertices[1].co - joint.head).length
            gap = max((pose.tail - helper.head).length, (helper.tail - joint.head).length)
            moved = (joint.head - old_tip).length
            assert head_error < 1e-5 and relative_error < 1e-5 and tip_error < 1e-5 and gap < 1e-5, name
            assert moved > 0.01, (name, moved)
            rows.append({'bone': name, 'joint_movement_m': moved, 'max_gap_m': gap,
                         'shape_tip_error_m': tip_error, 'helper_relative_error': relative_error})
            pose.matrix_basis = initial[name]
            bpy.context.view_layer.update()
    # 補助骨の長軸ねじりは残し、頭と尾を動かさず実際にskinへ伝わることを確認する。
    twist_rows = []
    for name in sorted(HELPER_NAMES):
        helper = rig.pose.bones[name]
        head, tail = helper.head.copy(), helper.tail.copy()
        points = {obj.name: [p for p, _ in evaluated_points(obj)] for obj in bodies_for(rig)}
        helper.matrix_basis = initial[name] @ Matrix.Rotation(math.radians(25), 4, 'Y')
        bpy.context.view_layer.update()
        moved = max_point_error(points, {obj.name: [p for p, _ in evaluated_points(obj)] for obj in bodies_for(rig)})
        gap = max((helper.head - head).length, (helper.tail - tail).length)
        assert gap < 1e-5 and moved > 1e-5, (name, gap, moved)
        twist_rows.append({'bone': name, 'endpoint_movement_m': gap, 'skin_movement_m': moved})
        helper.matrix_basis = initial[name]
        bpy.context.view_layer.update()
    bodies = bodies_for(rig)
    before = {obj.name: [p for p, _ in evaluated_points(obj)] for obj in bodies}
    pose = capture_pose(rig)
    apply_pose(rig, pose)
    error = max_point_error(before, {obj.name: [p for p, _ in evaluated_points(obj)] for obj in bodies})
    assert error < 1e-5, error
    for name, channels in initial_channels.items():
        for key, value in channels.items():
            setattr(rig.pose.bones[name], key, value)
    for key, value in object_transform.items():
        setattr(rig, key, value)
    bpy.context.view_layer.update()
    open_pose_mode(rig)
    return {'bone_count': len(rig.data.bones), 'connected_count': sum(b.use_connect for b in rig.data.bones),
            'twist_helpers': len(HELPER_NAMES), 'joint_rotation_tests': rows, 'twist_tests': twist_rows,
            'json_roundtrip_error_m': error, 'translation_locks_checked': True}
