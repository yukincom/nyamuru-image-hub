"""Interactive guards for this MPFB rig; these are not anatomical guarantees."""
from math import radians


def add_limits(rig):
    """Keep MPFB's IK limits. Add guards only to the FK/controller bones."""
    count = sum(p.use_ik_limit_x or p.use_ik_limit_y or p.use_ik_limit_z for p in rig.pose.bones)
    for bone in rig.pose.bones:
        limits = None
        if bone.name.startswith('spine'):
            limits = [(-40, 40), (-45, 45), (-40, 40)]
        elif bone.name.startswith('neck'):
            limits = [(-45, 45), (-50, 50), (-40, 40)]
        elif bone.name == 'head':
            limits = [(-60, 60), (-75, 75), (-50, 50)]
        elif '_grip.' in bone.name:
            limits = [(-20, 105), (0, 0), (0, 0)]
        elif bone.name.startswith('finger'):
            limits = ([(-60, 110), (-60, 60), (-85, 85)] if bone.name.startswith('finger1')
                      else [(-30, 115), (-25, 25), (-45, 45)])
        if limits:
            constraint = bone.constraints.new('LIMIT_ROTATION')
            constraint.name = '操作範囲（調整可能）'
            constraint.owner_space = 'LOCAL'
            constraint.euler_order = 'XYZ'
            constraint.use_transform_limit = True
            for axis, (low, high) in zip('xyz', limits):
                setattr(constraint, 'use_limit_' + axis, True)
                setattr(constraint, 'min_' + axis, radians(low))
                setattr(constraint, 'max_' + axis, radians(high))
            count += 1
    return count
