"""既存rigを動かし、glTFと共通のlocal TRSへ変換する。"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector


# Blender Z-upとglTF Y-upを、行列の同じ変換で往復する。
AXIS = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def decompose_trs(matrix):
    translation, rotation, scale = matrix.decompose()
    return {'translation': list(translation), 'rotation': [rotation.x, rotation.y, rotation.z, rotation.w],
            'scale': list(scale)}


def compose_trs(value):
    x, y, z, w = value['rotation']
    return Matrix.LocRotScale(Vector(value['translation']), Quaternion((w, x, y, z)), Vector(value['scale']))


def to_trs(matrix):
    return decompose_trs(AXIS @ matrix @ AXIS.inverted())


def from_trs(value):
    return AXIS.inverted() @ compose_trs(value) @ AXIS


# glTF exporterは骨のlocal軸を維持し、最上位boneだけ世界軸を変える。
def bone_trs(matrix, has_parent):
    return decompose_trs(matrix if has_parent else AXIS @ matrix)


def reset_pose(rig):
    rig.matrix_world = Matrix.Identity(4)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def capture_pose(rig):
    return {'root': to_trs(rig.matrix_world), 'bones': {
        bone.name: bone_trs(bone.parent.matrix.inverted() @ bone.matrix if bone.parent else bone.matrix, bool(bone.parent))
        for bone in rig.pose.bones}}


# 親から再構築し、Blender固有の継承規則をbasis変換へ反映する。
def apply_pose(rig, pose):
    matrices = {}
    def apply(bone):
        if bone.name in matrices:
            return matrices[bone.name]
        parent = apply(bone.parent) if bone.parent else Matrix.Identity(4)
        local = compose_trs(pose['bones'][bone.name])
        matrix = parent @ local if bone.parent else AXIS.inverted() @ local
        options = {'parent_matrix': parent, 'parent_matrix_local': bone.parent.bone.matrix_local} if bone.parent else {}
        bone.matrix_basis = bone.bone.convert_local_to_pose(matrix, bone.bone.matrix_local, invert=True, **options)
        matrices[bone.name] = matrix
        return matrix
    for bone in rig.pose.bones:
        apply(bone)
    rig.matrix_world = from_trs(pose['root'])
    bpy.context.view_layer.update()


def aim_chain(rig, first, end, direction):
    bone = rig.pose.bones[first]
    current = (rig.pose.bones[end].head if end else bone.tail) - bone.head
    turn = current.normalized().rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
    bone.matrix = Matrix.Translation(bone.head) @ turn @ Matrix.Translation(-bone.head) @ bone.matrix
    bpy.context.view_layer.update()


# 関節の位置を保ったまま、長軸まわりのねじれを指定面へ合わせる。
def align_roll(rig, name, end, reference, target):
    bone = rig.pose.bones[name]
    axis = ((rig.pose.bones[end].head if end else bone.tail) - bone.head).normalized()
    deformation = bone.matrix.to_3x3() @ bone.bone.matrix_local.to_3x3().inverted()
    current = deformation @ Vector(reference)
    current -= axis * current.dot(axis)
    desired = Vector(target) - axis * Vector(target).dot(axis)
    if current.length < 1e-6 or desired.length < 1e-6:
        return
    current.normalize()
    desired.normalize()
    angle = math.atan2(axis.dot(current.cross(desired)), current.dot(desired))
    turn = Quaternion(axis, angle).to_matrix().to_4x4()
    bone.matrix = Matrix.Translation(bone.head) @ turn @ Matrix.Translation(-bone.head) @ bone.matrix
    bpy.context.view_layer.update()


def align_limb_plane(rig, first, middle, end):
    a, b, c = (rig.pose.bones[name].head.copy() for name in (first, middle, end))
    ra, rb, rc = (rig.data.bones[name].head_local for name in (first, middle, end))
    reference, normal = (rb - ra).cross(rc - rb), (b - a).cross(c - b)
    if reference.length < 1e-6 or normal.length < 1e-6:
        return
    align_roll(rig, first, middle, reference, normal)
    aim_chain(rig, middle, end, c - rig.pose.bones[middle].head)
    align_roll(rig, middle, end, reference, normal)


# 手の長軸と掌の面を両方指定し、開いた指を休んだ形へ揃える。
def rest_hand(rig, side, direction, palm_normal):
    wrist = 'wrist.' + side
    inverse = rig.matrix_world.to_3x3().inverted()
    forward, normal = (inverse @ Vector(value) for value in (direction, palm_normal))
    forward.normalize()
    normal = (normal - forward * normal.dot(forward)).normalized()
    aim_chain(rig, wrist, 'finger3-1.' + side, forward)
    rest = rig.data.bones
    origin = rest[wrist].head_local
    reference = (rest['finger2-1.' + side].head_local - origin).cross(rest['finger5-1.' + side].head_local - origin)
    reference *= 1 if side == 'R' else -1
    align_roll(rig, wrist, 'finger3-1.' + side, reference, normal)
    for finger in range(2, 6):
        for joint, bend in [(1, 0.10), (2, 0.30), (3, 0.50)]:
            name = f'finger{finger}-{joint}.{side}'
            end = f'finger{finger}-{joint + 1}.{side}' if joint < 3 else None
            aim_chain(rig, name, end, forward + normal * bend)
    for joint, bend in [(1, 0.15), (2, 0.25), (3, 0.35)]:
        name = f'finger1-{joint}.{side}'
        end = f'finger1-{joint + 1}.{side}' if joint < 3 else None
        aim_chain(rig, name, end, forward + normal * bend)


def rotate_local(rig, name, axis, degrees):
    bone = rig.pose.bones[name]
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = bone.rotation_quaternion @ Quaternion(Vector(axis), math.radians(degrees))
    bpy.context.view_layer.update()


# 既存のFK骨だけを使い、肘/膝の曲がる側を指定して二節を近づける。
def reach_world(rig, first, middle, end, target, pole):
    inverse = rig.matrix_world.inverted()
    target, pole = inverse @ Vector(target), inverse @ Vector(pole)
    start = rig.pose.bones[first].head.copy()
    joint = rig.pose.bones[middle].head.copy()
    finish = rig.pose.bones[end].head.copy()
    length_a, length_b = (joint - start).length, (finish - joint).length
    direction = (target - start).normalized()
    distance = max(abs(length_a - length_b) + 1e-5, min((target - start).length, length_a + length_b - 1e-5))
    cosine = max(-1, min(1, (length_a**2 + distance**2 - length_b**2) / (2 * length_a * distance)))
    bend = pole - start
    bend = (bend - direction * bend.dot(direction)).normalized()
    elbow = start + direction * (length_a * cosine) + bend * (length_a * math.sqrt(1 - cosine**2))
    aim_chain(rig, first, middle, elbow - start)
    aim_chain(rig, middle, end, target - rig.pose.bones[middle].head)
    return (rig.matrix_world @ rig.pose.bones[end].head - rig.matrix_world @ target).length


def flat_foot(rig, side, yaw=0):
    bone = rig.pose.bones['foot.' + side]
    world_rotation = Matrix.Rotation(math.radians(yaw), 4, 'Z') @ bone.bone.matrix_local.to_quaternion().to_matrix().to_4x4()
    matrix = rig.matrix_world.inverted().to_quaternion().to_matrix().to_4x4() @ world_rotation
    matrix.translation = bone.head
    bone.matrix = matrix
    bpy.context.view_layer.update()


# 接地点は評価後の足meshから求め、服や全身bboxの下端は使わない。
def evaluated_points(body):
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
    try:
        return [(list(evaluated.matrix_world @ vertex.co), [(item.group, item.weight) for item in vertex.groups])
                for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def foot_contacts(body):
    points = evaluated_points(body)
    contacts = {}
    for side in ('L', 'R'):
        groups = {group.index for group in body.vertex_groups if group.name.endswith('.' + side)
                  and group.name.startswith(('foot', 'toe'))}
        foot = [Vector(point) for point, weights in points if sum(weight for index, weight in weights if index in groups) > 0.5]
        low = min(point.z for point in foot)
        sole = [point for point in foot if point.z < low + 0.002]
        center = sum(sole, Vector()) / len(sole)
        contacts[side] = [center.x, center.y, low]
    return contacts
