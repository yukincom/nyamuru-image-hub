"""Blenderをbackgroundで起動し、原本を保存せず監査する入口。"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.human_pose.inspection import inspect_scene


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    source = args.source.resolve(strict=True)
    if source == args.output.resolve():
        raise ValueError("原本を出力先にできません")
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    bpy.context.view_layer.update()
    result = inspect_scene()
    result["source_sha256"] = before
    result["source_byte_size"] = source.stat().st_size
    if hashlib.sha256(source.read_bytes()).hexdigest() != before:
        raise RuntimeError("原本が変更されています")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"監査保存: {args.output}; 原本hash保持: {before}")


if __name__ == "__main__":
    main()
