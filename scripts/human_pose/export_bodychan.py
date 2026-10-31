"""指定blendの女性素体を、既存の人体編集用の骨名へ接続した試用GLBとして書き出す。"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.files import save_json
from scripts.human_pose.glb import rig_contract


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(source, root):
    output = root / 'models'
    paths = {kind: output / f'bodychan_female.{suffix}' for kind, suffix in
             [('blend', 'blend'), ('glb', 'glb'), ('rig', 'rig.json'), ('metadata', 'metadata.json')]}
    if any(path.exists() for path in paths.values()):
        raise ValueError('既存の試用モデルを上書きしません')
    source_hash = digest(source)
    reference = json.loads((output / 'human_base.rig.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    original = bpy.data.objects['bodychan-rig']
    original.data.pose_position = 'REST'
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH'
              and obj.name.startswith('bodychan-') and obj.name != 'bodychan-high-heels']
    if len(meshes) != 25:
        raise ValueError(f'女性素体の部品数が想定と異なります: {len(meshes)}')
    for obj in meshes:
        for modifier in obj.modifiers:
            if modifier.type == 'ARMATURE':
                modifier.show_viewport = False
    bpy.context.view_layer.update()
    source_bones = {bone.name: original.matrix_world @ bone.matrix_local for bone in original.data.bones}
    source_lengths = {bone.name: bone.length for bone in original.data.bones}
    mapped = {'root': 'DEF-spine', 'spine05': 'DEF-spine', 'spine03': 'DEF-spine.001',
              'spine02': 'DEF-spine.002', 'spine01': 'DEF-spine.003', 'neck01': 'DEF-spine.004',
              'neck02': 'DEF-spine.005', 'head': 'DEF-spine.006', 'jaw': 'DEF-jaw'}
    for side in ['L', 'R']:
        for target, bone in [('clavicle', 'shoulder'), ('upperarm01', 'upper_arm'), ('upperarm02', 'upper_arm'),
                             ('lowerarm01', 'forearm'), ('lowerarm02', 'forearm'), ('wrist', 'hand'),
                             ('upperleg01', 'thigh'), ('upperleg02', 'thigh'), ('lowerleg01', 'shin'),
                             ('lowerleg02', 'shin'), ('foot', 'foot'), ('pelvis', 'pelvis'), ('breast', 'breast')]:
            suffix = '.001' if target in {'upperarm02', 'lowerarm02', 'upperleg02', 'lowerleg02'} else ''
            mapped[f'{target}.{side}'] = f'DEF-{bone}.{side}{suffix}'
        for f, name in enumerate(['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'], 1):
            for segment in range(1, 4):
                mapped[f'finger{f}-{segment}.{side}'] = f'DEF-{name}.{segment:02d}.{side}'
        for finger in range(1, 5):
            mapped[f'metacarpal{finger}.{side}'] = f'DEF-palm.{finger:02d}.{side}'
        for toe in range(1, 6):
            mapped[f'toe{toe}-1.{side}'] = f'DEF-toe.{side}'
    # The source uses split upper/lower limb bones and an unbroken spine chain.
    # Synthetic intermediate bones retain the editor's topology without moving the source mesh.
    definitions = {bone['name']: bone for bone in reference['bones']}
    worlds, lengths = {}, {}
    height_scale = 1.7 / 1.4

    def native_world(name):
        if name in worlds:
            return worlds[name]
        definition = definitions[name]
        if name in mapped:
            result = source_bones[mapped[name]].copy()
            length = source_lengths[mapped[name]]
        elif name in {'spine04', 'neck03'} or name.startswith('shoulder01.'):
            a, b = ('DEF-spine', 'DEF-spine.001') if name == 'spine04' else ('DEF-spine.005', 'DEF-spine.006')
            if name.startswith('shoulder01.'):
                side = name[-1]
                a, b = f'DEF-shoulder.{side}', f'DEF-upper_arm.{side}'
            result = source_bones[a].copy()
            result.translation = (source_bones[a].translation + source_bones[b].translation) * .5
            length = (source_bones[b].translation - result.translation).length
        else:
            value = definition['rest']
            position = Vector(value['translation']) * height_scale
            rotation = Quaternion((value['rotation'][3], *value['rotation'][:3]))
            local = Matrix.LocRotScale(position, rotation, Vector((1, 1, 1)))
            if definition['parent']:
                result = native_world(definition['parent']) @ local
            else:
                raise ValueError(f'基準骨がありません: {name}')
            length = .025
        worlds[name], lengths[name] = result, max(.002, length)
        return result

    for name in definitions:
        native_world(name)
    weights_to = {value: key for key, value in mapped.items() if not key.startswith('toe')}
    weights_to['DEF-spine'] = 'spine05'
    for side in ['L', 'R']:
        weights_to[f'DEF-toe.{side}'] = f'toe3-1.{side}'
    vertices, faces, weights = [], [], []
    graph = bpy.context.evaluated_depsgraph_get()
    part_records = []
    head_top = None
    for obj in sorted(meshes, key=lambda obj: obj.name):
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=graph)
        offset = len(vertices)
        try:
            groups = {group.index: group.name for group in obj.vertex_groups}
            for vertex in mesh.vertices:
                point = obj.matrix_world @ vertex.co
                vertices.append(tuple(point))
                if obj.name == 'bodychan-head':
                    head_top = max(head_top or point.z, point.z)
                influence = {}
                for group in vertex.groups:
                    name = groups[group.group]
                    if not name.startswith('DEF-') or group.weight <= 1e-8:
                        continue
                    target = weights_to.get(name)
                    if not target:
                        if name.startswith('DEF-lip'):
                            target = 'head'
                        else:
                            raise ValueError(f'未対応の女性モデルのweight: {name}')
                    influence[target] = influence.get(target, 0) + group.weight
                if not influence:
                    raise ValueError(f'weightのない頂点です: {obj.name}/{vertex.index}')
                total = sum(influence.values())
                weights.append({name: value / total for name, value in influence.items()})
            faces.extend(tuple(offset + index for index in polygon.vertices) for polygon in mesh.polygons)
            part_records.append({'name': obj.name, 'vertices': len(mesh.vertices), 'polygons': len(mesh.polygons)})
        finally:
            evaluated.to_mesh_clear()
    # Clear all source datablocks, including the male model, widgets and embedded scripts.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data = bpy.data.armatures.new('bodychan_female_rig')
    armature = bpy.data.objects.new('human_rig', data)
    bpy.context.scene.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name in definitions:
        bone = data.edit_bones.new(name)
        bone.head = worlds[name].translation
        bone.tail = bone.head + worlds[name].to_quaternion() @ Vector((0, lengths[name], 0))
        bone.matrix = worlds[name]
        bone.length = lengths[name]
    for name, definition in definitions.items():
        if definition['parent']:
            data.edit_bones[name].parent = data.edit_bones[definition['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh = bpy.data.meshes.new('bodychan_female_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    body = bpy.data.objects.new('bodychan_female', mesh)
    bpy.context.scene.collection.objects.link(body)
    body.parent = armature
    for name in sorted({name for entry in weights for name in entry}):
        group = body.vertex_groups.new(name=name)
        for index, entry in enumerate(weights):
            if name in entry:
                group.add([index], entry[name], 'REPLACE')
    modifier = body.modifiers.new('bodychan_skin', 'ARMATURE')
    modifier.object = armature
    material = bpy.data.materials.new('bodychan_gray')
    material.diffuse_color = (.66, .68, .69, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Roughness'].default_value = .9
    body.data.materials.append(material)
    for polygon in body.data.polygons:
        polygon.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.wm.save_as_mainfile(filepath=str(paths['blend']), check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(paths['glb']), export_format='GLB', use_selection=True,
                              export_animations=False, export_skins=True, export_morph=False,
                              export_yup=True, export_apply=False, export_all_influences=False,
                              export_rest_position_armature=True, export_extras=False,
                              export_cameras=False, export_lights=False)
    contract = rig_contract(paths['glb'])
    contract['head_length_m'] = head_top - worlds['head'].translation.z
    save_json(paths['rig'], contract)
    metadata = {'version': 1, 'id': 'bodychan-female', 'source_sha256': source_hash,
                'reference_rig_sha256': digest(output / 'human_base.rig.json'),
                'source_vertices': len(vertices), 'source_polygons': len(faces), 'parts': part_records,
                'rest_geometry_preserved': True, 'material': 'single_gray_rough',
                'blender_version': bpy.app.version_string,
                'files': {kind: {'path': f'models/{path.name}', 'sha256': digest(path), 'byte_size': path.stat().st_size}
                          for kind, path in paths.items() if kind != 'metadata'}}
    save_json(paths['metadata'], metadata)
    if digest(source) != source_hash:
        raise ValueError('元のblendが変更されました')
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    export(args.source.resolve(strict=True), args.root.resolve(strict=True))
