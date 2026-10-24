"""代表姿勢のFKと、支持面に対する接触位置を作る。"""
import math

import bpy
from mathutils import Matrix, Vector

from scripts.human_pose.rig import AXIS, aim_chain, align_limb_plane, evaluated_points, flat_foot, foot_contacts, reach_world, reset_pose, rest_hand, rotate_local


def bone_point(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].head


def arm_down(rig, side):
    sign = 1 if side == 'L' else -1
    aim_chain(rig, 'upperarm01.' + side, 'lowerarm01.' + side, (sign * 0.25, -0.03, -1))
    aim_chain(rig, 'lowerarm01.' + side, 'wrist.' + side, (sign * 0.12, -0.14, -1))


# 利用者が近いと評価した初期候補の掌・指の向きを保持する。
def grip_pole(rig):
    for finger in range(2, 6):
        for joint, angle in [(1, 65), (2, 75), (3, 45)]:
            rotate_local(rig, f'finger{finger}-{joint}.R', (1, 0, 0), angle)
    for joint, angle in [(1, 30), (2, 35), (3, 20)]:
        rotate_local(rig, f'finger1-{joint}.R', (1, 0, 0), angle)


def ground_feet(rig, body):
    rig.location.z -= min(point[2] for point in foot_contacts(body).values())
    bpy.context.view_layer.update()


def region_points(body, prefixes):
    groups = {group.index for group in body.vertex_groups if group.name.startswith(prefixes)}
    return [Vector(point) for point, weights in evaluated_points(body)
            if sum(weight for index, weight in weights if index in groups) > 0.5]


# 支持物は人体と同じm単位で保存し、viewerでも同じ形を作れるようにする。
def support(identifier, kind, point, **shape):
    return {'id': identifier, 'kind': kind, 'position': list(AXIS @ Vector(point)), **shape}


def make_pose(rig, body, key):
    reset_pose(rig)
    for side in ('L', 'R'):
        arm_down(rig, side)
    supports, contacts = [], {}
    if key == 'standing':
        rig.rotation_euler.y = math.radians(-3)
        rig.location = (0.06, 0, -0.005)
        bpy.context.view_layer.update()
        for side, target in [('L', (0.065, -0.018, 0.0544)), ('R', (-0.06, -0.08, 0.0544))]:
            reach_world(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side,
                        target, (target[0], -0.6, 0.4))
            align_limb_plane(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side)
        contacts['supporting_foot'] = 'L'
    elif key == 'wall':
        rig.rotation_euler.y = math.radians(10)
        rig.location.z = -0.008
        bpy.context.view_layer.update()
        right_shoulder = bone_point(rig, 'upperarm01.R')
        for side in ('L', 'R'):
            # この共通素体の右かかと表面は足首軸より約18mm外側。
            ankle_x = right_shoulder.x + 0.018 + (0.075 if side == 'L' else 0)
            reach_world(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side,
                        (ankle_x, -0.045, 0.0544), (ankle_x, -0.6, 0.4))
            align_limb_plane(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side)
        aim_chain(rig, 'upperarm01.R', 'lowerarm01.R', (-0.40, -0.03, -1))
        aim_chain(rig, 'lowerarm01.R', 'wrist.R', (-0.16, -0.14, -1))
    elif key == 'pole':
        for side, sign in [('L', 1), ('R', -1)]:
            aim_chain(rig, 'upperleg01.' + side, 'lowerleg01.' + side, (-sign * 0.035, 0, -1))
            aim_chain(rig, 'lowerleg01.' + side, 'foot.' + side, (0, 0, -1))
        aim_chain(rig, 'upperarm01.R', 'lowerarm01.R', (-0.48, -0.20, -1))
        aim_chain(rig, 'lowerarm01.R', 'wrist.R', (-0.45, -0.15, 1))
        grip_pole(rig)
    elif key == 'seated':
        for side, sign in [('L', 1), ('R', -1)]:
            aim_chain(rig, 'upperleg01.' + side, 'lowerleg01.' + side, (-sign * 0.16, -1, -0.35))
            aim_chain(rig, 'lowerleg01.' + side, 'foot.' + side, (0, 0, -1))
    elif key == 'squat':
        rig.location = (0, 0.15, -0.47)
        bpy.context.view_layer.update()
        for side, sign in [('L', 1), ('R', -1)]:
            reach_world(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side,
                        (sign * 0.10, 0.07, 0.0544), (sign * 0.20, -0.65, 0.35))
        rotate_local(rig, 'spine04', (1, 0, 0), 18)
    elif key == 'lying':
        rig.matrix_world = Matrix.Rotation(-math.pi / 2, 4, 'X')
        bpy.context.view_layer.update()
        back = region_points(body, ('spine', 'pelvis', 'head', 'neck'))
        rig.location.z -= min(point.z for point in back)
        bpy.context.view_layer.update()
        for side, sign in [('L', 1), ('R', -1)]:
            reach_world(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side,
                        (sign * 0.035, 0.39 if side == 'L' else 0.48, 0.0544), (sign * 0.035, 0.4, 0.7))
    else:
        raise ValueError('未定義の代表姿勢です')
    if key in {'standing', 'wall', 'pole'}:
        for side, sign in [('L', 1), ('R', -1)]:
            if key == 'pole' and side == 'R':
                continue
            direction = rig.matrix_world.to_3x3() @ Vector((0, 0, -1))
            normal = rig.matrix_world.to_3x3() @ Vector((-sign, 0, 0))
            rest_hand(rig, side, direction, normal)
    # 多面図の体側の腕を保ち、仰向けでは手首を床へ近づける。
    if key == 'lying':
        for side, sign in [('L', 1), ('R', -1)]:
            reach_world(rig, 'upperarm01.' + side, 'lowerarm01.' + side, 'wrist.' + side,
                        (sign * 0.17, 0.64, 0.045), (sign * 0.16, 0.83, 0.045))
            align_limb_plane(rig, 'upperarm01.' + side, 'lowerarm01.' + side, 'wrist.' + side)
            rest_hand(rig, side, (0, -1, 0), (-sign * 0.7, 0, -1))
    for side in ('L', 'R'):
        if key in {'seated', 'squat', 'lying'}:
            align_limb_plane(rig, 'upperleg01.' + side, 'lowerleg01.' + side, 'foot.' + side)
        flat_foot(rig, side, (18 if side == 'L' else -18) if key == 'squat' else 0)
    if key != 'lying':
        ground_feet(rig, body)
    if key in {'seated', 'squat'}:
        for side, sign in [('L', 1), ('R', -1)]:
            knee = bone_point(rig, 'lowerleg01.' + side)
            if key == 'squat':
                target = (0.022 if side == 'L' else -0.006, knee.y - (0.015 if side == 'L' else 0.045), knee.z + (0.08 if side == 'L' else 0.095))
                pole = (sign * 0.15, knee.y + (0.12 if side == 'L' else 0.24), knee.z + 0.08)
            else:
                target = (-0.005 if side == 'L' else -0.045, knee.y + 0.15, knee.z + (0.181 if side == 'L' else 0.166))
                pole = (sign * 0.14, knee.y + 0.28, knee.z + 0.16)
            reach_world(rig, 'upperarm01.' + side, 'lowerarm01.' + side, 'wrist.' + side, target, pole)
            align_limb_plane(rig, 'upperarm01.' + side, 'lowerarm01.' + side, 'wrist.' + side)
            if key == 'seated':
                rest_hand(rig, side, (-0.2 if side == 'L' else 0.1, -1, -0.5), (0, 0.4, -1))
            else:
                rest_hand(rig, side, (0, -0.35, -1), (0, 1, -0.25))
    if key == 'wall':
        points = [Vector(point) for point, _ in evaluated_points(body)]
        edge = max(points, key=lambda point: point.x)
        wall_x = edge.x + 0.002
        supports.append(support('wall', 'box', (wall_x + 0.025, 0.06, 0.68), size=[0.05, 1.40, 0.38]))
        contacts['shoulder'] = {'side': 'L', 'point': list(AXIS @ edge), 'surface_gap_m': 0.002}
    elif key == 'pole':
        palm = (bone_point(rig, 'finger2-1.R') + bone_point(rig, 'finger4-1.R')) / 2
        palm += Vector((0, -0.023, -0.015))
        supports.append(support('pole', 'cylinder', (palm.x, palm.y, 0.72), radius=0.012, height=1.44))
        contacts['hand'] = {'side': 'R', 'point': list(AXIS @ palm), 'finger_grip_approximated': True}
    elif key == 'seated':
        hip = bone_point(rig, 'root')
        points = [point for point in region_points(body, ('root', 'pelvis', 'upperleg01')) if point.y >= hip.y - 0.04]
        low = min(point.z for point in points)
        bottom = [point for point in points if point.z <= low + 0.003]
        center = sum(bottom, Vector()) / len(bottom)
        center.z = low
        contacts['seat'] = {'point': list(AXIS @ center), 'forward': [0, 0, 1], 'surface_gap_m': 0}
        supports.append(support('seat', 'cylinder', (center.x, center.y, low - 0.018), radius=0.22, height=0.036))
        for index, (x, y) in enumerate([(-0.14, -0.14), (0.14, -0.14), (-0.14, 0.14), (0.14, 0.14)]):
            supports.append(support(f'stool-leg-{index}', 'cylinder', (center.x + x, center.y + y, (low - 0.036) / 2),
                                    radius=0.016, height=low - 0.036))
    elif key == 'lying':
        back = region_points(body, ('spine', 'pelvis', 'head', 'neck'))
        low = min(back, key=lambda point: point.z)
        contacts['back'] = {'point': list(AXIS @ low), 'surface_gap_m': low.z}
    contacts['feet'] = {side: list(AXIS @ Vector(point)) for side, point in foot_contacts(body).items()}
    return supports, contacts
