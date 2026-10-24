"""保存した姿勢と共通rigの対応を、Blenderなしで検証する。"""
import math
import re


def require(condition, message):
    if not condition:
        raise ValueError(message)


def transform(value):
    require(isinstance(value, dict) and set(value) == {'translation', 'rotation', 'scale'}, 'TRSのfieldが不正です')
    for key, count in [('translation', 3), ('rotation', 4), ('scale', 3)]:
        array = value[key]
        require(isinstance(array, list) and len(array) == count and
                all(type(number) in (int, float) and math.isfinite(number) for number in array), 'TRSの数値が不正です')
    require(abs(sum(number * number for number in value['rotation']) - 1) < 1e-4, 'quaternionが正規化されていません')
    require(all(abs(number - 1) < 1e-4 for number in value['scale']), '姿勢では体形scaleを変更できません')


# 省略boneを前回の姿勢から継承せず、常に全boneの値を持たせる。
def validate_pose(pose, contract):
    require(isinstance(pose, dict) and type(pose.get('schema_version')) is int and pose['schema_version'] == 1, 'pose schemaが不正です')
    require(pose.get('rig_signature') == contract['rig_signature'], 'rig signatureが一致しません')
    require(pose.get('base_glb_sha256') == contract['base_glb_sha256'], 'base GLBが一致しません')
    require(pose.get('transform_space') == 'absolute_parent_local', 'pose座標系が不正です')
    require(isinstance(pose.get('pose_id'), str) and re.fullmatch(r'pose-[a-z0-9-]+', pose['pose_id']), 'pose IDが不正です')
    require(type(pose.get('revision')) is int and pose['revision'] > 0, 'pose revisionが不正です')
    transform(pose.get('root'))
    bones = pose.get('bones')
    require(isinstance(bones, dict) and set(bones) == {bone['name'] for bone in contract['bones']}, '全boneの姿勢が必要です')
    for value in bones.values():
        transform(value)
    require(pose.get('user_confirmed') in (True, False) and type(pose['user_confirmed']) is bool, '利用者確認が不正です')
    if pose['user_confirmed']:
        require(bool(pose.get('reviewer')) and bool(pose.get('reviewed_at')), '利用者確認の記録がありません')
    return True
