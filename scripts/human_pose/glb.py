"""GLBの骨構成とバッファを標準ライブラリで読む。"""
import json
import math
import struct

from .files import canonical, sha256


# 外部bufferや未対応圧縮を黙って扱わず、自己完結したGLBを検査する。
def read_glb(path):
    raw = path.read_bytes()
    if len(raw) < 20 or struct.unpack_from('<4sII', raw) != (b'glTF', 2, len(raw)):
        raise ValueError('GLB headerが不正です')
    offset, chunks = 12, {}
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ValueError('GLB chunk headerが不正です')
        size, kind = struct.unpack_from('<II', raw, offset)
        offset += 8
        if offset + size > len(raw) or kind in chunks:
            raise ValueError('GLB chunkが不正です')
        chunks[kind] = raw[offset:offset + size]
        offset += size
    data = json.loads(chunks[0x4E4F534A])
    if any(buffer.get('uri') for buffer in data.get('buffers', [])):
        raise ValueError('外部bufferは使えません')
    return data, chunks.get(0x004E4942, b'')


def accessor(data, binary, index):
    item = data['accessors'][index]
    if 'sparse' in item or item.get('normalized'):
        raise ValueError('未対応accessorです')
    view = data['bufferViews'][item['bufferView']]
    formats = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}
    dimensions = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    fmt = '<' + formats[item['componentType']] * dimensions[item['type']]
    stride = view.get('byteStride', struct.calcsize(fmt))
    start = view.get('byteOffset', 0) + item.get('byteOffset', 0)
    return [list(struct.unpack_from(fmt, binary, start + row * stride)) for row in range(item['count'])]


def node_trs(node):
    if 'matrix' in node:
        raise ValueError('boneはlocal TRSで保存してください')
    return {key: node.get(key, default) for key, default in (
        ('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1]))}


# signatureはbone名・親・rest姿勢に限定し、JSONの整形に依存させない。
def rig_contract(path):
    data, binary = read_glb(path)
    if len(data.get('skins', [])) != 1 or len(data.get('meshes', [])) != 1:
        raise ValueError('meshとskinが各1個必要です')
    joints = set(data['skins'][0]['joints'])
    nodes = data['nodes']
    parents = {child: index for index, node in enumerate(nodes) for child in node.get('children', [])}
    bones = [{'name': nodes[index]['name'],
              'parent': nodes[parents[index]]['name'] if parents.get(index) in joints else None,
              'rest': node_trs(nodes[index])} for index in data['skins'][0]['joints']]
    bones.sort(key=lambda bone: bone['name'])
    if len({bone['name'] for bone in bones}) != len(bones):
        raise ValueError('bone名が重複しています')
    for primitive in data['meshes'][0]['primitives']:
        attributes = primitive['attributes']
        if set(key for key in attributes if key.startswith('JOINTS_')) != {'JOINTS_0'}:
            raise ValueError('runtimeのweightは4本以内にしてください')
        weights = accessor(data, binary, attributes['WEIGHTS_0'])
        if any(not all(math.isfinite(weight) for weight in row) or abs(sum(row) - 1) > 1e-5 or min(row) < 0 for row in weights):
            raise ValueError('runtimeのweightが正規化されていません')
    return {'schema_version': 1, 'rig_signature': sha256(canonical(bones)), 'bones': bones,
            'base_glb_sha256': sha256(path.read_bytes()), 'unit': 'meter',
            'up': '+Y', 'forward': '+Z', 'floor_axis': 'Y', 'floor_value': 0,
            'blender_to_gltf': ['x', 'z', '-y'], 'rotation_format': 'xyzw',
            'bone_local_axes': 'blender_local_except_top_bone_world_axis_conversion',
            'transform_space': 'absolute_parent_local', 'placement_root': 'human_rig',
            'bone_root': 'root', 'runtime_weight_limit': 4}
