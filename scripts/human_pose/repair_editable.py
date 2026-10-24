"""既存blendの形状と姿勢を保持し、編集操作だけを別ファイルへ修正する。"""
import argparse
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.editable_rig import open_pose_mode, prepare_rig_editing
from scripts.human_pose.files import save_json, sha256
from scripts.human_pose.validate_editable import assert_preserved, snapshot, validate_editing


def repair(source, output):
    source, output = source.resolve(strict=True), output.resolve()
    if source == output or output.exists():
        raise ValueError('修正先には未作成の別ファイルを指定してください')
    source_hash = sha256(source.read_bytes())
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=True, use_scripts=False)
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError('単一のrigが必要です')
    rig = rigs[0]
    rig_name = rig.name
    before = snapshot(rig)
    prepared = prepare_rig_editing(rig)
    setup_error = assert_preserved(before, snapshot(rig))
    validation = validate_editing(rig)
    validation['setup_vertex_error_m'] = setup_error
    validation['repair_vertex_error_m'] = assert_preserved(before, snapshot(rig))
    open_pose_mode(rig)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    bpy.ops.wm.open_mainfile(filepath=str(output), load_ui=True, use_scripts=False)
    rig = bpy.data.objects[rig_name]
    validation['reload_vertex_error_m'] = assert_preserved(before, snapshot(rig))
    assert rig.mode == 'POSE' and bpy.context.view_layer.objects.active == rig
    validation['reopened_in_pose_mode'] = True
    validation['reload_checks'] = validate_editing(rig)
    assert sha256(source.read_bytes()) == source_hash, '検証中に元ファイルが変更されています'
    report = {'source': str(source), 'source_sha256': source_hash, 'output': str(output),
              'output_sha256': sha256(output.read_bytes()), 'editing': prepared, 'validation': validation}
    save_json(output.with_suffix('.validation.json'), report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    report = repair(args.source, args.output)
    print({'output': report['output'], 'validation': report['validation']})


if __name__ == '__main__':
    main()
