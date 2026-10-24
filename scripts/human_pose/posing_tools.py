"""Add MPFB's native IK/grip helpers to copies of the original deformation rig."""
import importlib

import bpy
from mathutils import Matrix

from .editable_rig import activate, open_pose_mode
from .pose_limits import add_limits

MPFB = 'bl_ext.nyamuru_experiment.mpfb'
SETTINGS = {
    'arm_helpers_type': 'LOWERUPPER', 'arm_parenting_strategy': 'NONE',
    'arm_target_rotates_hand': True, 'arm_target_rotates_lower_arm': False,
    'leg_helpers_type': 'LOWERUPPER', 'leg_parenting_strategy': 'NONE',
    'leg_target_rotates_foot': True, 'leg_target_rotates_lower_leg': False,
    'finger_helpers_type': 'GRIP_AND_MASTER', 'hide_fk': False,
}
GUIDE = """人体ポーズ作業台

下のポーズ一覧をダブルクリックして適用します。
全身を適用: 3D画面へマウスを移し Option+A で骨を選択解除してから適用。
詳細な骨を選択して隠した場合は、全ボーンコレクションを表示してから選択解除。
一部だけ適用: その部分の骨を選択してから適用（例: 手だけ）。
サムネイルをドラッグすると、今の姿勢との混ぜ具合を調整できます。

青=L（本人の左）、緑=R（本人の右）、黄色=中央。
hand_ik: Gで手を移動、Rで手首を回転。
foot_ik: Gで足を移動、Rで足首を回転。手足のIKは伸縮しません。
elbow_ik / knee_ik: Gで肘・膝の位置と曲がる向きを調整。
root（腰）: G/Rで胴体を動かします。手足はIKの位置に残ります。
全身をまとめて動かす: Tabでオブジェクトモード→G/R→Tabで戻る。
master_grip: R→X→X で4本の指をまとめて曲げる。親指はfinger1_grip。
finger2〜5_grip: 同じ操作で指を個別に曲げる。
首・頭・背骨: Rで回転。詳細な指は骨コレクション「指の詳細」を表示。
補助骨はねじり専用です。通常は隠したまま使います。

選択した骨のコピー: Cmd+C。貼付け: Cmd+V。反転貼付け: Cmd+Shift+V。
全身の左右反転: 選択解除し、ポーズアセットを右クリックして「ポーズに適用(反転)」。
全身の初期化は「00 初期状態」を適用してください。
Alt+G/RだけではIKの位置と体がそろわないため、全身リセットには使いません。

肘・膝のIK制限と、指・首・背骨の回転制限を設定済みです。
可動制限は極端な操作を抑える目安です。体同士・床・小物の衝突は防ぎません。
ポーズ集は無料配布素材から選んだものです。手作りの姿勢は収録していません。
椅子や棒の位置はポーズアセットに含まれません。体格と接地を調整して使います。
保存はCmd+S。元の編集ファイルとバックアップは別に保持しています。
"""


def set_xyz(rig):
    for bone in rig.pose.bones:
        basis = bone.matrix_basis.copy()
        bone.rotation_mode = 'XYZ'
        bone.matrix_basis = basis


def normalize_object(rig):
    """Bake object placement into root pose, keeping mesh parenting unchanged."""
    world = rig.matrix_world.copy()
    roots = {p.name: world @ p.matrix for p in rig.pose.bones if not p.parent}
    rig.matrix_world = Matrix.Identity(4)
    for name, matrix in roots.items():
        rig.pose.bones[name].matrix = matrix
    bpy.context.view_layer.update()


def mute_constraints(rig, state):
    for bone in rig.pose.bones:
        for constraint in bone.constraints:
            constraint.mute = state


def snap_controls(rig, matrices):
    for side in ('L', 'R'):
        for control, joint in [('hand', 'wrist'), ('foot', 'foot')]:
            rig.pose.bones[f'{control}_ik.{side}'].matrix = matrices[f'{joint}.{side}']
        for control, joint in [('elbow', 'lowerarm01'), ('knee', 'lowerleg01')]:
            bone = rig.pose.bones[f'{control}_ik.{side}']
            matrix = bone.bone.matrix_local.copy()
            matrix.translation = matrices[f'{joint}.{side}'].translation
            bone.matrix = matrix
    bpy.context.view_layer.update()


def apply_basis(rig, values):
    mute_constraints(rig, True)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix(values.get(bone.name, Matrix.Identity(4)))
    bpy.context.view_layer.update()
    matrices = {p.name: p.matrix.copy() for p in rig.pose.bones}
    snap_controls(rig, matrices)
    mute_constraints(rig, False)
    bpy.context.view_layer.update()


def add_helpers(rig):
    activate(rig)
    if any(p.constraints for p in rig.pose.bones):
        raise ValueError('Expected the original rig without constraints')
    original = {p.name: p.matrix_basis.copy() for p in rig.pose.bones}
    rests = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for side in ('left', 'right'):
        for kind, cls in [('arm', 'ArmHelpers'), ('leg', 'LegHelpers'), ('finger', 'FingerHelpers')]:
            module = importlib.import_module(f'{MPFB}.entities.rigging.righelpers.{kind}helpers.{kind}helpers')
            getattr(module, cls).get_instance(side, SETTINGS).apply_ik(rig)
    activate(rig)
    for bone in rig.pose.bones:
        if bone.name not in original:
            bone.bone.use_deform = False
            for word, suffix in [('left_', '.L'), ('right_', '.R')]:
                if bone.name.startswith(word):
                    bone.name = bone.name[len(word):] + suffix
                    break
        for constraint in list(bone.constraints):
            constraint.mute = True
            if bone.name.startswith('finger1_grip.') and constraint.type == 'COPY_ROTATION':
                bone.constraints.remove(constraint)
            elif bone.name.startswith('finger') and constraint.type == 'COPY_ROTATION':
                constraint.mix_mode = 'ADD'
                # The control angle denotes each joint's curl, not one third of it.
                constraint.influence = 1.0
        if bone.custom_shape and bone.custom_shape.name.startswith(('helper', 'mpfb', 'circle', 'cube')):
            bone.custom_shape.hide_render = True
    # Helper shapes need no scene membership and must not appear as render/export geometry.
    for bone in rig.pose.bones:
        if bone.name not in original and bone.custom_shape:
            shape = bone.custom_shape
            for collection in list(shape.users_collection):
                collection.objects.unlink(shape)
    set_xyz(rig)
    add_limits(rig)
    apply_basis(rig, original)
    for name, matrix in rests.items():
        assert max(abs(a-b) for ra, rb in zip(matrix, rig.data.bones[name].matrix_local)
                   for a, b in zip(ra, rb)) < 1e-6, name
    setup_view(rig, set(original))
    return list(original)


def setup_view(rig, original):
    names = ('手足・指のコントローラー', '胴体・首・頭', '指の詳細', '関節の詳細', '補助骨・顔・足指')
    collections = {n: rig.data.collections.get(n) or rig.data.collections.new(n) for n in names}
    # Hidden selected bones would silently restrict native pose-asset application.
    for collection in rig.data.collections:
        collection.is_visible = True
    open_pose_mode(rig)
    for collection in rig.data.collections:
        collection.is_visible = collection.name in names[:2]
    for bone in rig.data.bones:
        pose = rig.pose.bones[bone.name]
        group = (names[0] if bone.name not in original else names[1]
                 if bone.name.startswith(('root', 'pelvis', 'spine', 'neck', 'head', 'clavicle', 'shoulder'))
                 else names[2] if bone.name.startswith(('finger', 'metacarpal'))
                 else names[3] if bone.name.startswith(('upperarm01', 'lowerarm01', 'upperleg01', 'lowerleg01', 'foot.', 'wrist.'))
                 else names[4])
        for collection in list(bone.collections):
            collection.unassign(bone)
        collections[group].assign(bone)
        bone.hide = bone.hide_select = False
        bone.color.palette = 'THEME04' if bone.name.endswith('.L') else 'THEME03' if bone.name.endswith('.R') else 'THEME09'
        pose.lock_scale = (True,) * 3
        if bone.name not in original:
            pose.lock_location = (False,) * 3 if '_ik.' in bone.name else (True,) * 3
            pose.lock_rotation = (False,) * 3 if bone.name.startswith(('hand_', 'foot_')) else (False, True, True) if '_grip.' in bone.name else (True,) * 3
    for collection in list(rig.data.collections):
        if collection.name not in names and not collection.bones and not collection.children:
            rig.data.collections.remove(collection)
    rig.show_in_front = True
    rig['posing_workspace_version'] = 1
    guide = bpy.data.texts.get('ポーズの操作方法') or bpy.data.texts.new('ポーズの操作方法')
    guide.clear()
    guide.write(GUIDE)
    open_pose_mode(rig)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'DOPESHEET_EDITOR' and area.height < 350:
                area.type = 'FILE_BROWSER'
                area.ui_type = 'ASSETS'
                if getattr(area.spaces.active, 'params', None):
                    area.spaces.active.params.asset_library_reference = 'LOCAL'
            elif area.type == 'VIEW_3D':
                area.spaces.active.show_region_asset_shelf = True
