"""163骨の変形契約を保ち、既存の関節だけを手で操作できる表示にする。"""
import bpy
from mathutils import Vector


VERSION = 1
LIMBS = {'upperarm': 'lowerarm01', 'lowerarm': 'wrist',
         'upperleg': 'lowerleg01', 'lowerleg': 'foot'}
HELPER_NAMES = {part + '02.' + side for part in LIMBS for side in ('L', 'R')}
GUIDE_NAME = 'ポーズの操作方法'
GUIDE = """ポーズの操作方法

ポーズモードで色付きの骨をクリックし、Rで回転します。
肩→肘→手首、股関節→膝→足首の位置で曲がります。
肘は前腕の長い骨、膝は脛の長い骨を選びます。
Rの後にX/Y/Zで軸を指定できます。Escで取消し、Cmd+Zで元に戻せます。
全身の移動は腰のrootを選んでG、全身の向きはrootを選んでRです。
手足のG移動によるIK操作はありません。関節ごとにRで調整します。
指もRで操作できます。顔・足指は骨コレクション「顔・足指（詳細）」を表示します。
補助骨はねじれを分担する内部骨です。通常は非表示です。
ねじりを調整するときは骨コレクション「補助骨（ねじり専用）」を表示します。
補助骨はR、Y、Yで骨の長軸まわりに回転できます。曲げ方向・移動・拡縮はロック済みです。
保存はCmd+S。元に戻せるよう、別名保存してから練習しても大丈夫です。
"""


def activate(rig):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    rig.hide_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig


# sceneにリンクしない形状はboneから保存され、通常meshやGLBへ混入しない。
def limb_shape(rig, name, end):
    pose = rig.pose.bones[name]
    finish = pose.matrix.inverted() @ rig.pose.bones[end].head
    axis = finish.normalized()
    tangent = axis.cross(Vector((1, 0, 0)))
    if tangent.length < 0.1:
        tangent = axis.cross(Vector((0, 0, 1)))
    tangent.normalize()
    bitangent = axis.cross(tangent).normalized()
    center = finish * 0.25
    width = min(0.014, finish.length * 0.065)
    vertices = [Vector(), finish, center + tangent * width, center + bitangent * width,
                center - tangent * width, center - bitangent * width]
    edges = [(tip, ring) for tip in (0, 1) for ring in range(2, 6)]
    edges += [(2, 3), (3, 4), (4, 5), (5, 2)]
    old = pose.custom_shape
    mesh = bpy.data.meshes.new('human_pose_widget_' + name)
    mesh.from_pydata(vertices, edges, [])
    mesh.update()
    shape = bpy.data.objects.new(mesh.name, mesh)
    shape['human_pose_widget'] = VERSION
    shape.hide_render = True
    pose.custom_shape = shape
    pose.use_custom_shape_bone_size = False
    pose.custom_shape_scale_xyz = (1, 1, 1)
    pose.custom_shape_translation = (0, 0, 0)
    pose.custom_shape_rotation_euler = (0, 0, 0)
    pose.custom_shape_transform = None
    if hasattr(pose, 'custom_shape_wire_width'):
        pose.custom_shape_wire_width = 2.0
    if old and old.get('human_pose_widget') and old.users == 0:
        old_mesh = old.data
        bpy.data.objects.remove(old)
        if old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)


# 接続によりrest行列が動かない、一致済みの端だけを接続する。
def prepare_rig_editing(rig):
    if rig.type != 'ARMATURE' or not HELPER_NAMES.issubset(rig.pose.bones.keys()):
        raise ValueError('対応する分割骨付きリグではありません')
    activate(rig)
    before = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    bpy.ops.object.mode_set(mode='EDIT')
    connected = []
    for bone in rig.data.edit_bones:
        if bone.parent and (bone.head - bone.parent.tail).length < 1e-8:
            bone.use_connect = True
            connected.append(bone.name)
    bpy.ops.object.mode_set(mode='OBJECT')
    if any(max(abs(a - b) for ra, rb in zip(before[bone.name], bone.matrix_local)
               for a, b in zip(ra, rb)) > 1e-6 for bone in rig.data.bones):
        raise ValueError('接続によってrest行列が変わりました。保存しません')
    collections = {name: rig.data.collections.get(name) or rig.data.collections.new(name)
                   for name in ('体の操作', '指', '顔・足指（詳細）', '補助骨（ねじり専用）')}
    for collection in collections.values():
        collection.is_visible = collection.name in ('体の操作', '指')
    main = ('root', 'pelvis', 'spine', 'clavicle', 'shoulder', 'upperarm', 'lowerarm',
            'wrist', 'upperleg', 'lowerleg', 'foot', 'neck', 'head')
    for bone in rig.data.bones:
        pose = rig.pose.bones[bone.name]
        helper = bone.name in HELPER_NAMES
        group = ('補助骨（ねじり専用）' if helper else '指' if bone.name.startswith(('finger', 'metacarpal'))
                 else '体の操作' if bone.name.startswith(main) else '顔・足指（詳細）')
        for collection in list(bone.collections):
            collection.unassign(bone)
        collections[group].assign(bone)
        bone.hide = False
        bone.hide_select = False
        bone.show_wire = True
        pose.lock_location = (bone.parent is not None,) * 3
        pose.lock_scale = (True,) * 3
        if helper:
            pose.lock_rotation = (True, False, True)
            pose.lock_rotations_4d = True
            pose.lock_rotation_w = False
        bone.color.palette = 'THEME04' if bone.name.endswith('.L') else 'THEME03' if bone.name.endswith('.R') else 'THEME09'
    bpy.context.view_layer.update()
    for part, end in LIMBS.items():
        for side in ('L', 'R'):
            limb_shape(rig, part + '01.' + side, end + '.' + side)
    rig.show_in_front = True
    rig.data.show_bone_custom_shapes = True
    rig.data.display_type = 'OCTAHEDRAL'
    rig['human_pose_editing_version'] = VERSION
    guide = bpy.data.texts.get(GUIDE_NAME) or bpy.data.texts.new(GUIDE_NAME)
    guide.clear()
    guide.write(GUIDE)
    return {'version': VERSION, 'connected_bones': connected, 'twist_helpers': sorted(HELPER_NAMES),
            'bone_count': len(rig.data.bones), 'new_bones': 0, 'new_constraints': 0}


def open_pose_mode(rig):
    activate(rig)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='DESELECT')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.overlay.show_relationship_lines = False
                area.spaces.active.overlay.show_extras = False
                if bpy.context.scene.camera:
                    area.spaces.active.region_3d.view_perspective = 'CAMERA'
