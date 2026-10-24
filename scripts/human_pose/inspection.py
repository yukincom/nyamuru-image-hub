"""Blenderの形状・リグ・外部参照を変更せずに調べる。"""
import hashlib
import json

import bpy


def matrix_rows(matrix):
    return [[round(float(value), 9) for value in row] for row in matrix]


def points_hash(points):
    values = [[round(float(value), 7) for value in point] for point in points]
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()


# 元メッシュと評価後のメッシュを分けて記録する。
def mesh_record(obj):
    mesh = obj.data
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    result = evaluated.to_mesh()
    try:
        points = [obj.matrix_world @ vertex.co for vertex in result.vertices]
        bounds = [[min(point[axis] for point in points), max(point[axis] for point in points)] for axis in range(3)]
        evaluated_record = {"vertices": len(result.vertices), "polygons": len(result.polygons), "bounds": bounds,
                            "coordinates_sha256": points_hash(points)}
    finally:
        evaluated.to_mesh_clear()
    shapes = []
    if mesh.shape_keys:
        for key in mesh.shape_keys.key_blocks:
            shapes.append({"name": key.name, "value": key.value, "mute": key.mute,
                           "vertices": len(key.data), "coordinates_sha256": points_hash(point.co for point in key.data)})
    groups = {group.index: group.name for group in obj.vertex_groups}
    weighted = sum(any(group.weight > 0 for group in vertex.groups if group.group in groups) for vertex in mesh.vertices)
    return {"vertices": len(mesh.vertices), "polygons": len(mesh.polygons),
            "coordinates_sha256": points_hash(vertex.co for vertex in mesh.vertices), "shape_keys": shapes,
            "vertex_groups": list(groups.values()), "vertices_with_groups": weighted,
            "evaluated": evaluated_record}


def modifier_record(modifier):
    value = {"name": modifier.name, "type": modifier.type, "viewport": modifier.show_viewport, "render": modifier.show_render}
    for key in ("use_axis", "use_clip", "use_mirror_merge", "merge_threshold", "vertex_group", "invert_vertex_group", "levels", "render_levels"):
        if hasattr(modifier, key):
            setting = getattr(modifier, key)
            value[key] = list(setting) if key == "use_axis" else setting
    for key in ("object", "mirror_object"):
        if hasattr(modifier, key):
            target = getattr(modifier, key)
            value[key] = target.name if target else None
    return value


# boneのrest行列と現在のpose行列を別に保存する。
def rig_record(obj):
    bones = []
    for bone in obj.data.bones:
        pose = obj.pose.bones[bone.name]
        bones.append({"name": bone.name, "parent": bone.parent.name if bone.parent else None,
                      "connected": bone.use_connect, "hidden": bone.hide, "select_locked": bone.hide_select,
                      "location_locked": list(pose.lock_location), "rotation_locked": list(pose.lock_rotation),
                      "custom_shape": pose.custom_shape.name if pose.custom_shape else None,
                      "deform": bone.use_deform, "inherit_scale": bone.inherit_scale,
                      "head": list(bone.head_local), "tail": list(bone.tail_local),
                      "rest_matrix": matrix_rows(bone.matrix_local), "basis_matrix": matrix_rows(pose.matrix_basis),
                      "constraints": [{"name": constraint.name, "type": constraint.type, "influence": constraint.influence}
                                      for constraint in pose.constraints]})
    return {"pose_position": obj.data.pose_position, "bones": bones}


def animation_record(block):
    animation = getattr(block, "animation_data", None)
    if not animation:
        return None
    drivers = [{"path": driver.data_path, "index": driver.array_index, "expression": driver.driver.expression,
                "valid": driver.is_valid} for driver in animation.drivers]
    return {"action": animation.action.name if animation.action else None, "drivers": drivers,
            "nla_tracks": [track.name for track in animation.nla_tracks]}


def inspect_scene():
    objects = []
    for obj in bpy.data.objects:
        value = {"name": obj.name, "type": obj.type, "parent": obj.parent.name if obj.parent else None,
                 "hide_render": obj.hide_render, "hidden": obj.hide_get(), "matrix_world": matrix_rows(obj.matrix_world),
                 "modifiers": [modifier_record(modifier) for modifier in obj.modifiers],
                 "animation": animation_record(obj), "custom_property_keys": list(obj.keys())}
        if obj.type == "MESH":
            value["mesh"] = mesh_record(obj)
            value["shape_animation"] = animation_record(obj.data.shape_keys) if obj.data.shape_keys else None
        if obj.type == "ARMATURE":
            value["rig"] = rig_record(obj)
        objects.append(value)
    return {"blender_version": bpy.app.version_string, "unit_system": bpy.context.scene.unit_settings.system,
            "unit_scale": bpy.context.scene.unit_settings.scale_length, "objects": objects,
            "images": [{"name": image.name, "source": image.source, "path": image.filepath,
                        "packed": bool(image.packed_file)} for image in bpy.data.images],
            "libraries": [library.filepath for library in bpy.data.libraries],
            "actions": [action.name for action in bpy.data.actions]}
