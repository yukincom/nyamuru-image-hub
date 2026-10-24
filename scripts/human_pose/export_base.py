"""現在の素体を保持して、編集用blendとリグ付きGLBを派生保存する。"""
import argparse
import json
from pathlib import Path
import re
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.files import save_json, sha256
from scripts.human_pose.inspection import inspect_scene
from scripts.human_pose.render_base import render_views


# 指定原本を唯一の入力にし、既存の派生編集を上書きしない。
def ensure_output(output):
    output.mkdir(parents=True, exist_ok=True)
    metadata_path = output / "human_base.metadata.json"
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text())
        for entry in metadata["files"].values():
            path = output / entry["name"]
            if not path.is_file() or sha256(path.read_bytes()) != entry["sha256"]:
                raise ValueError("派生素材に変更があります。再生成で上書きできません")
        raise ValueError("派生素材は作成済みです。更新は別revisionで行ってください")
    if (output / "human_base.blend").exists() or (output / "human_base.glb").exists():
        raise ValueError("記録のない既存素材を上書きできません")


def generic_names(body, rig, forbidden):
    body.name = "human_base"
    body.data.name = "human_base_mesh"
    rig.name = "human_rig"
    rig.data.name = "human_rig_data"
    for collection in bpy.data.collections:
        collection.name = "human_collection"
    for obj in bpy.data.objects:
        if obj.type in {"LIGHT", "CAMERA"}:
            obj.name = "human_" + obj.type.lower()
            obj.data.name = obj.name + "_data"
    for world in bpy.data.worlds:
        world.name = "human_world"
    for mesh in bpy.data.meshes:
        if mesh.shape_keys:
            mesh.shape_keys.name = "human_shape_keys"
            for key in mesh.shape_keys.key_blocks:
                if key.name.startswith("Nyamuru_"):
                    key.name = "human_proportion_adjustment"
    for group in body.vertex_groups:
        if group.name.startswith("Nyamuru_"):
            old = group.name
            group.name = "human_body_mask"
            for modifier in body.modifiers:
                if getattr(modifier, "vertex_group", None) == old:
                    modifier.vertex_group = group.name
    scene = bpy.context.scene
    for key in list(scene.keys()):
        if key.startswith("nyamuru_"):
            del scene[key]
    scene["human_base_source_sha256"] = forbidden["source_sha256"]
    scene.name = "human_base_scene"
    for block in [*bpy.data.objects, *bpy.data.meshes, *bpy.data.armatures, *bpy.data.materials, *bpy.data.actions]:
        if forbidden["name"].lower() in block.name.lower():
            block.name = re.sub(re.escape(forbidden["name"]), "human", block.name, flags=re.IGNORECASE)


def gray_material(body):
    material = bpy.data.materials.new("human_material")
    material.use_nodes = True
    material.diffuse_color = (0.64, 0.64, 0.64, 1)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = material.diffuse_color
    shader.inputs["Roughness"].default_value = 0.85
    body.data.materials.clear()
    body.data.materials.append(material)
    for polygon in body.data.polygons:
        polygon.material_index = 0


# 表示時の体形とhelper maskを焼き込み、ウェイトと骨は残す。
def export_runtime(body, rig, path):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    armatures = [modifier for modifier in body.modifiers if modifier.type == "ARMATURE"]
    if len(armatures) != 1 or armatures[0].object != rig:
        raise ValueError("単一の共通rigに結び付いた素体が必要です")
    if any(constraint for pose in rig.pose.bones for constraint in pose.constraints):
        raise ValueError("constraintの焼き込み規則を先に確認してください")
    disabled = [(modifier, modifier.show_viewport) for modifier in armatures]
    for modifier, _ in disabled:
        modifier.show_viewport = False
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(body.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
    for modifier, visible in disabled:
        modifier.show_viewport = visible
    runtime = bpy.data.objects.new("human_runtime", mesh)
    bpy.context.scene.collection.objects.link(runtime)
    runtime.matrix_world = body.matrix_world.copy()
    runtime.parent = rig
    for group in body.vertex_groups:
        runtime.vertex_groups.new(name=group.name)
    modifier = runtime.modifiers.new("human_skin", "ARMATURE")
    modifier.object = rig
    bpy.ops.object.select_all(action="DESELECT")
    runtime.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = runtime
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_animations=False, export_skins=True, export_morph=False,
                              export_yup=True, export_apply=False, export_all_influences=False,
                              export_rest_position_armature=True, export_extras=False,
                              export_cameras=False, export_lights=False)
    bpy.data.objects.remove(runtime, do_unlink=True)
    bpy.data.meshes.remove(mesh)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--remove-name", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    source = args.source.resolve(strict=True)
    source_hash = sha256(source.read_bytes())
    ensure_output(args.output)
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    bodies = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(bodies) != 1 or len(rigs) != 1:
        raise ValueError("素体meshとrigの選定が必要です")
    body, rig = bodies[0], rigs[0]
    before = inspect_scene()
    old_mesh = next(obj["mesh"] for obj in before["objects"] if obj["type"] == "MESH")
    generic_names(body, rig, {"name": args.remove_name, "source_sha256": source_hash})
    gray_material(body)
    after = inspect_scene()
    new_mesh = next(obj["mesh"] for obj in after["objects"] if obj["type"] == "MESH")
    if old_mesh["coordinates_sha256"] != new_mesh["coordinates_sha256"] or old_mesh["evaluated"] != new_mesh["evaluated"]:
        raise ValueError("汎用名への変更で形状が変わりました")
    if [(s["value"], s["coordinates_sha256"]) for s in old_mesh["shape_keys"]] != [(s["value"], s["coordinates_sha256"]) for s in new_mesh["shape_keys"]]:
        raise ValueError("shape keyが変わりました")
    if args.remove_name.lower() in json.dumps(after).lower():
        raise ValueError("固有名が監査情報に残っています")
    if after["libraries"] or any(image["path"] for image in after["images"]):
        raise ValueError("外部参照の確認が必要です")
    render = render_views([body], args.review)
    blend, glb = args.output / "human_base.blend", args.output / "human_base.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    export_runtime(body, rig, glb)
    if sha256(source.read_bytes()) != source_hash:
        raise ValueError("原本hashが変わりました")
    metadata = {"schema_version": 1, "revision": "base-1", "source_sha256": source_hash,
                "source_byte_size": source.stat().st_size, "blender_version": bpy.app.version_string,
                "geometry_preserved": True, "shape_keys_preserved": True, "inspection": after, "render": render,
                "files": {kind: {"name": path.name, "sha256": sha256(path.read_bytes()), "byte_size": path.stat().st_size}
                          for kind, path in (("blend", blend), ("glb", glb))},
                "runtime_weight_limit": 4, "authoring_weights_preserved": True,
                "validation_status": "pending_rig_and_visual_checks"}
    save_json(args.output / "human_base.metadata.json", metadata)
    print("派生素体を保存。原本保持・形状保持。GLBのrig/表示検証は次工程。")


if __name__ == "__main__":
    main()
