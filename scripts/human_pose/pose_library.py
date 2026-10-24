"""Build native Blender pose assets, importing official BVH only on a disposable rig."""
import importlib
from pathlib import Path
import uuid

import bpy
from mathutils import Matrix, Vector

from .editable_rig import activate
from .posing_tools import MPFB, apply_basis, set_xyz

CATALOGS = {name: str(uuid.uuid5(uuid.NAMESPACE_URL, 'human-posing-workspace/' + name))
            for name in ('初期化', '立つ・待つ', '会話・身振り', '座る・休む', '物を持つ・動作')}


def basis_dict(rig):
    return {p.name: [list(row) for row in p.matrix_basis] for p in rig.pose.bones}


def official_pose(rig, path):
    """Compensate the official loader's rest-roll edits before storing a pose."""
    import addon_utils
    addon_utils.enable('io_anim_bvh', default_set=False)
    clone = rig.copy()
    clone.data = rig.data.copy()
    bpy.context.scene.collection.objects.link(clone)
    clone.animation_data_clear()
    set_xyz(clone)
    for bone in clone.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    activate(clone)
    service = importlib.import_module(MPFB + '.services.animationservice').AnimationService
    service.import_bvh_file_as_pose(clone, str(path))
    bpy.context.view_layer.update()
    desired = {p.name: clone.pose.bones[p.name].matrix @ clone.data.bones[p.name].matrix_local.inverted()
               @ p.bone.matrix_local for p in rig.pose.bones}
    values = {}
    for bone in rig.pose.bones:
        kwargs = ({'parent_matrix': desired[bone.parent.name],
                   'parent_matrix_local': bone.parent.bone.matrix_local} if bone.parent else {})
        basis = bone.bone.convert_local_to_pose(desired[bone.name], bone.bone.matrix_local,
                                                invert=True, **kwargs)
        values[bone.name] = [list(row) for row in basis]
    data = clone.data
    bpy.data.objects.remove(clone, do_unlink=True)
    if data.users == 0:
        bpy.data.armatures.remove(data)
    activate(rig)
    return values


def mark_asset(rig, name, category, description, bones=None, preview=None, author='', license_name=''):
    from pose_library.pose_creation import PoseCreationParams, PoseActionCreator
    names = frozenset(bones or rig.pose.bones.keys())
    params = PoseCreationParams(rig, None, None, 1.0, names, name)
    action = PoseActionCreator(params).create()
    # This rig does not use B-Bones. Keep only the loc/rot/scale pose channels.
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in list(bag.fcurves):
                    if '.bbone_' in curve.data_path:
                        bag.fcurves.remove(curve)
    action.asset_mark()
    action.use_fake_user = True
    action.asset_data.catalog_id = CATALOGS[category]
    action.asset_data.description = description
    action.asset_data.author = author or 'Human Pose Workspace'
    action.asset_data.tags.new(category)
    action.asset_data.license = license_name
    if preview:
        image = bpy.data.images.load(str(preview), check_existing=False)
        image.scale(160, 160)
        data = action.preview_ensure()
        data.image_size = image.size
        data.image_pixels_float = list(image.pixels)
        bpy.data.images.remove(image)
    return action


def render_preview(rig, output, size=256, hand=None):
    """Render a real preview of the converted rig instead of a reference skeleton."""
    scene = bpy.context.scene
    old_camera, old_engine = scene.camera, scene.render.engine
    old_resolution = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
    old_path, old_transparent = scene.render.filepath, scene.render.film_transparent
    bodies = [o for o in scene.objects if o.type == 'MESH' and
              any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers) and not o.hide_render]
    if not bodies:
        raise ValueError('No visible deformed mesh')
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = [o.matrix_world @ v.co for o in bodies for v in o.evaluated_get(depsgraph).data.vertices]
    if hand:
        points = [rig.matrix_world @ point for bone in rig.pose.bones
                  if bone.name.startswith(('wrist.', 'finger')) and bone.name.endswith('.' + hand)
                  for point in (bone.head, bone.tail)]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center = (low + high) / 2
    camera_data = bpy.data.cameras.new('Pose thumbnail camera')
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    scene.collection.objects.link(camera)
    direction = Vector((0.28, -1, 0.12) if high.z-low.z > (high.y-low.y)*0.75
                       else (1, -0.3, 0.6)).normalized()
    camera.location = center + direction * 6
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = max(high.z-low.z, high.x-low.x, high.y-low.y) * (1.7 if hand else 1.3)
    scene.camera = camera
    hidden = {o: o.hide_render for o in scene.objects if o.type == 'MESH' and o not in bodies}
    for obj in hidden:
        obj.hide_render = True
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'SINGLE'
        scene.display.shading.single_color = (0.63, 0.72, 0.81)
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.render.resolution_x = scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.film_transparent = True
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
    finally:
        for obj, value in hidden.items():
            obj.hide_render = value
        scene.camera, scene.render.engine = old_camera, old_engine
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = old_resolution
        scene.render.filepath, scene.render.film_transparent = old_path, old_transparent
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)


def write_catalog(path):
    content = '# Blender Asset Catalog Definition\nVERSION 1\n\n'
    content += '\n'.join(f'{value}:{name}:{name}' for name, value in CATALOGS.items()) + '\n'
    Path(path).write_text(content, encoding='utf-8')
