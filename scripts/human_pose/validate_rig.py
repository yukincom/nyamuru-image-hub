"""派生blendとGLBの座標・変形・再構築を検証して撮影する。"""
import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector, kdtree

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.files import read_json, save_json, sha256
from scripts.human_pose.glb import accessor, read_glb, rig_contract
from scripts.human_pose.pose_contract import validate_pose
from scripts.human_pose.render_base import render_views
from scripts.human_pose.rig import AXIS, aim_chain, apply_pose, bone_trs, capture_pose, evaluated_points, foot_contacts, reset_pose, rotate_local


# GLBの頂点と4ウェイトをそのまま使い、別実装の変形結果を比較する。
def runtime_mesh(path, rig, material):
    data, binary = read_glb(path)
    primitive = data['meshes'][0]['primitives'][0]
    attributes = primitive['attributes']
    points = accessor(data, binary, attributes['POSITION'])
    indices = [row[0] for row in accessor(data, binary, primitive['indices'])]
    mesh = bpy.data.meshes.new('human_runtime_validation_mesh')
    mesh.from_pydata([AXIS.inverted() @ Vector(point) for point in points], [],
                     [indices[index:index + 3] for index in range(0, len(indices), 3)])
    mesh.update()
    obj = bpy.data.objects.new('human_runtime_validation', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = rig
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if 'NORMAL' in attributes:
        normals = accessor(data, binary, attributes['NORMAL'])
        mesh.normals_split_custom_set_from_vertices([AXIS.inverted().to_3x3() @ Vector(normal) for normal in normals])
    groups = [obj.vertex_groups.new(name=data['nodes'][node]['name']) for node in data['skins'][0]['joints']]
    weights = accessor(data, binary, attributes['WEIGHTS_0'])
    joints = accessor(data, binary, attributes['JOINTS_0'])
    for index, (row, ids) in enumerate(zip(weights, joints)):
        for weight, joint in zip(row, ids):
            if weight > 0:
                groups[joint].add([index], weight, 'REPLACE')
    modifier = obj.modifiers.new('human_runtime_skin', 'ARMATURE')
    modifier.object = rig
    return obj


def positions(body):
    return [Vector(point) for point, _ in evaluated_points(body)]


def stress(rig, label):
    reset_pose(rig)
    if label == 'arms':
        aim_chain(rig, 'upperarm01.L', 'lowerarm01.L', (0.15, 0, 1))
        aim_chain(rig, 'lowerarm01.L', 'wrist.L', (-0.3, -0.3, 1))
        aim_chain(rig, 'upperarm01.R', 'lowerarm01.R', (-0.1, 0, -1))
        aim_chain(rig, 'lowerarm01.R', 'wrist.R', (-0.1, -1, 0.3))
        rotate_local(rig, 'lowerarm02.R', (0, 1, 0), 60)
        rotate_local(rig, 'wrist.R', (1, 0, 0), 25)
    if label in {'seated', 'deep-knees'}:
        for side, sign in [('L', 1), ('R', -1)]:
            thigh = (sign * 0.1, -1, 0 if label == 'seated' else 0.25)
            shin = (0, 0, -1) if label == 'seated' else (sign * 0.04, 0.65, -1)
            aim_chain(rig, 'upperleg01.' + side, 'lowerleg01.' + side, thigh)
            aim_chain(rig, 'lowerleg01.' + side, 'foot.' + side, shin)
            aim_chain(rig, 'foot.' + side, 'toe1-1.' + side, (0, -1, -0.12))
            aim_chain(rig, 'upperarm01.' + side, 'lowerarm01.' + side, (sign * 0.18, -0.2, -1))
            aim_chain(rig, 'lowerarm01.' + side, 'wrist.' + side, (sign * 0.05, -1, -0.1))
    if label == 'deep-knees':
        rotate_local(rig, 'spine04', (1, 0, 0), 12)


def point_error(left, right):
    if len(left) != len(right):
        raise ValueError('再構築で頂点数が変わりました')
    return max((a - b).length for a, b in zip(left, right))


# 表面の穴を自動修正せず、口・眼などを含む監査値として残す。
def topology(body):
    import bmesh
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        return {'vertices': len(mesh.vertices), 'polygons': len(mesh.polygons),
                'boundary_edges': sum(edge.is_boundary for edge in bm.edges),
                'nonmanifold_nonboundary_edges': sum(not edge.is_manifold and not edge.is_boundary for edge in bm.edges),
                'zero_area_faces': sum(face.calc_area() < 1e-12 for face in bm.faces),
                'mirror_modifiers': sum(modifier.type == 'MIRROR' for modifier in body.modifiers)}
    finally:
        bm.free()
        evaluated.to_mesh_clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--review', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    metadata_path = args.models / 'human_base.metadata.json'
    metadata = read_json(metadata_path)
    for entry in metadata['files'].values():
        if sha256((args.models / entry['name']).read_bytes()) != entry['sha256']:
            raise ValueError('派生素体が変更されています')
    glb = args.models / 'human_base.glb'
    contract = rig_contract(glb)
    bpy.ops.wm.open_mainfile(filepath=str(args.models / 'human_base.blend'), load_ui=False, use_scripts=False)
    body, rig = bpy.data.objects['human_base'], bpy.data.objects['human_rig']
    if any(modifier.type == 'ARMATURE' and modifier.use_deform_preserve_volume for modifier in body.modifiers):
        raise ValueError('体積保持の変形はruntimeとの差を先に検証してください')
    reset_pose(rig)
    for bone in contract['bones']:
        original = rig.data.bones[bone['name']]
        rest = bone_trs(original.parent.matrix_local.inverted() @ original.matrix_local if original.parent else original.matrix_local, bool(original.parent))
        for key in ('translation', 'scale'):
            if max(abs(a - b) for a, b in zip(rest[key], bone['rest'][key])) > 1e-5:
                raise ValueError('bone restがGLBと一致しません: ' + bone['name'])
        if abs(abs(sum(a * b for a, b in zip(rest['rotation'], bone['rest']['rotation']))) - 1) > 1e-5:
            raise ValueError('bone回転がGLBと一致しません: ' + bone['name'])
    contract['foot_contacts_rest'] = {side: list(AXIS @ Vector(point)) for side, point in foot_contacts(body).items()}
    contract['seat_contact'] = 'pose_specific_evaluated_surface'
    save_json(args.models / 'human_base.rig.json', contract)
    runtime = runtime_mesh(glb, rig, body.data.materials[0])
    original_rest, runtime_rest = positions(body), positions(runtime)
    tree = kdtree.KDTree(len(original_rest))
    for index, point in enumerate(original_rest):
        tree.insert(point, index)
    tree.balance()
    correspondence = [tree.find(point)[1] for point in runtime_rest]
    report = {'topology': topology(body), 'rest_runtime_error_m': point_error(runtime_rest, [original_rest[i] for i in correspondence]),
              'rig_signature': contract['rig_signature'], 'base_glb_sha256': contract['base_glb_sha256'],
              'base_blend_sha256': metadata['files']['blend']['sha256'], 'cases': []}
    for label in ('rest', 'arms', 'seated', 'deep-knees'):
        stress(rig, label)
        feet = foot_contacts(runtime)
        rig.location.z -= min(point[2] for point in feet.values())
        bpy.context.view_layer.update()
        pose = {'schema_version': 1, 'pose_id': 'pose-validation-' + label, 'revision': 1,
                'rig_signature': contract['rig_signature'], 'base_glb_sha256': contract['base_glb_sha256'],
                'transform_space': 'absolute_parent_local', 'user_confirmed': False, **capture_pose(rig)}
        validate_pose(pose, contract)
        before, original = positions(runtime), positions(body)
        reset_pose(rig)
        apply_pose(rig, pose)
        after = positions(runtime)
        error = point_error(before, after)
        if error > 1e-5:
            raise ValueError(f'pose往復誤差が大きすぎます: {label}: {error}')
        reduction = point_error(after, [original[i] for i in correspondence])
        folder = args.review / label
        folder.mkdir(parents=True, exist_ok=True)
        save_json(folder / 'pose.json', pose)
        save_json(folder / 'expected-runtime-points.json', [list(AXIS @ point) for point in after])
        body.hide_render = True
        render_views([runtime], folder, 'runtime')
        runtime.hide_render, body.hide_render = True, False
        render_views([body], folder, 'authoring')
        runtime.hide_render = False
        report['cases'].append({'name': label, 'roundtrip_error_m': error, 'four_weight_max_difference_m': reduction,
                                'foot_contacts': {side: list(AXIS @ Vector(point)) for side, point in foot_contacts(runtime).items()}})
    save_json(args.review / 'rig-validation.json', report)
    print(report)


if __name__ == '__main__':
    main()
