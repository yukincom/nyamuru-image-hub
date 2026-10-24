"""検査用の固定カメラで素体を撮影する。"""
from pathlib import Path
from itertools import product

import bpy
from mathutils import Vector


# 検査用の見え方だけを整え、形状や骨の値は変更しない。
def configure_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 560
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.64, 0.64, 0.64)
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "WORLD"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("human_world")
    scene.world.color = (0.9, 0.92, 0.95)
    camera = scene.camera
    if camera is None:
        data = bpy.data.cameras.new("human_inspection_camera")
        camera = bpy.data.objects.new("human_inspection_camera", data)
        scene.collection.objects.link(camera)
        scene.camera = camera
    return scene, camera


def world_bounds(objects):
    points = []
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
    return Vector([min(point[axis] for point in points) for axis in range(3)]), Vector([max(point[axis] for point in points) for axis in range(3)])


def render_views(objects, output: Path, prefix="base"):
    scene, camera = configure_render()
    minimum, maximum = world_bounds(objects)
    center = (minimum + maximum) / 2
    camera.data.type = "ORTHO"
    output.mkdir(parents=True, exist_ok=True)
    views = {"front": (0, -1, 0), "side": (1, 0, 0), "back": (0, 1, 0), "oblique": (0.8, -1, 0.18)}
    cameras = {}
    for label, direction in views.items():
        span = fit_camera(camera, center, minimum, maximum, direction, scene)
        camera.location = center + Vector(direction).normalized() * span * 3
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(output / f"{prefix}-{label}.png")
        bpy.ops.render.render(write_still=True)
        cameras[label] = {"position": list(camera.location), "target": list(center), "orthographic_scale": span}
    return {"bounds": [list(minimum), list(maximum)], "cameras": cameras}


# 横たわる姿勢も切れないよう、撮影方向ごとの投影幅と高さで収める。
def fit_camera(camera, center, minimum, maximum, direction, scene, margin=1.15):
    camera.rotation_euler = (-Vector(direction)).to_track_quat("-Z", "Y").to_euler()
    inverse = camera.rotation_euler.to_matrix().transposed()
    corners = [inverse @ (Vector(point) - center) for point in product(*zip(minimum, maximum))]
    width = max(point.x for point in corners) - min(point.x for point in corners)
    height = max(point.y for point in corners) - min(point.y for point in corners)
    span = max(height, width * scene.render.resolution_y / scene.render.resolution_x) * margin
    camera.data.ortho_scale = span
    return span
