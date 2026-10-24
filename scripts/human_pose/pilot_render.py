"""保存姿勢から単純な人型を作り、一覧絵と比較cameraを描く。"""
from pathlib import Path

import bpy
from mathutils import Vector

from scripts.human_pose.render_base import configure_render, fit_camera, world_bounds
from scripts.human_pose.rig import AXIS


def ellipsoid(name, center, scale, color, rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=center)
    obj = bpy.context.object
    obj.name, obj.scale, obj.color = name, scale, (*color, 1)
    if rotation:
        obj.rotation_euler = rotation.to_euler()
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


# 左右を見分けられる単純な立体にし、顔・衣類・指は足さない。
def mannequin(rig):
    objects = []
    point = lambda name: rig.matrix_world @ rig.pose.bones[name].head
    def limb(name, start, end, radius, color):
        first, last = point(start), point(end)
        rotation = (last - first).to_track_quat('Z', 'Y')
        objects.append(ellipsoid(name, (first + last) / 2, (radius, radius, (last - first).length / 2 + radius * 0.2), color, rotation))
        objects.append(ellipsoid(name + '_joint', first, (radius,) * 3, color))
    torso = (0.33, 0.39, 0.47)
    limb('simple_torso', 'spine05', 'neck01', 0.087, torso)
    limb('simple_neck', 'neck01', 'head', 0.035, torso)
    pelvis = (point('upperleg01.L') + point('upperleg01.R')) / 2
    rotation = (point('spine01') - pelvis).to_track_quat('Z', 'Y')
    objects.append(ellipsoid('simple_pelvis', pelvis, (0.115, 0.075, 0.08), torso, rotation))
    head = rig.pose.bones['head']
    center = rig.matrix_world @ ((head.head + head.tail) / 2)
    objects.append(ellipsoid('simple_head', center, (0.092, 0.082, 0.108), (0.48, 0.55, 0.64),
                             (rig.matrix_world.to_3x3() @ (head.tail - head.head)).to_track_quat('Z', 'Y')))
    for side, color in [('L', (0.29, 0.49, 0.66)), ('R', (0.48, 0.51, 0.56))]:
        limb('simple_shoulder' + side, 'neck01', 'upperarm01.' + side, 0.04, color)
        for first, end, radius in [('upperarm01', 'lowerarm01', 0.032), ('lowerarm01', 'wrist', 0.025),
                                    ('upperleg01', 'lowerleg01', 0.049), ('lowerleg01', 'foot', 0.036)]:
            limb(first + side, first + '.' + side, end + '.' + side, radius, color)
        for part, scale in [('wrist', (0.028, 0.055, 0.014)), ('foot', (0.04, 0.095, 0.022))]:
            bone = rig.pose.bones[part + '.' + side]
            location = rig.matrix_world @ ((bone.head + bone.tail) / 2)
            objects.append(ellipsoid(part + side, location, scale, color, (rig.matrix_world @ bone.matrix).to_quaternion()))
    return objects


def create_supports(definitions):
    objects = []
    for item in definitions:
        position = AXIS.inverted() @ Vector(item['position'])
        if item['kind'] == 'box':
            bpy.ops.mesh.primitive_cube_add(size=1, location=position)
            obj = bpy.context.object
            x, y, z = item['size']
            obj.scale = (x, z, y)
        else:
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=item['radius'], depth=item['height'], location=position)
            obj = bpy.context.object
        obj.name = 'support_' + item['id']
        obj.color = (0.72, 0.69, 0.61, 1)
        objects.append(obj)
    return objects


def render_one(objects, output: Path, direction, *, simple=False):
    scene, camera = configure_render()
    scene.display.shading.color_type = 'OBJECT' if simple else 'SINGLE'
    if simple:
        scene.render.resolution_x, scene.render.resolution_y = 320, 400
        scene.display.shading.show_shadows = False
    minimum, maximum = world_bounds(objects)
    center = (minimum + maximum) / 2
    camera.data.type = 'ORTHO'
    span = fit_camera(camera, center, minimum, maximum, direction, scene)
    camera.location = center + Vector(direction).normalized() * span * 3
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    return {'projection': 'orthographic', 'position': list(AXIS @ camera.location), 'target': list(AXIS @ center),
            'up': list(AXIS.to_3x3() @ (camera.rotation_euler.to_matrix() @ Vector((0, 1, 0)))),
            'orthographic_scale': span, 'aspect': scene.render.resolution_x / scene.render.resolution_y}
