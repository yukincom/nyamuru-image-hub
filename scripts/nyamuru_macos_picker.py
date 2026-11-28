"""macOS osascript pickers for episode/series/workspace paths."""

from __future__ import annotations

import os
import json
import mimetypes
import subprocess
import sys
from pathlib import Path


def run_macos_picker(script: str, *arguments: str) -> str | None:
    if sys.platform != "darwin":
        raise RuntimeError("フォルダから選ぶ機能は現在macOSで利用できます")
    completed = subprocess.run(
        ["/usr/bin/osascript", "-l", "JavaScript", "-e", script, "--", *arguments],
        check=False,
        capture_output=True,
        text=True,
        timeout=5 * 60,
    )
    if completed.returncode == 0:
        return completed.stdout.strip()
    error = completed.stderr.strip()
    if "-128" in error or "User canceled" in error or "ユーザによってキャンセル" in error:
        return None
    raise RuntimeError(error or "macOSのファイル選択画面を開けませんでした")


def default_picker_directory(value: object) -> Path:
    if isinstance(value, (str, os.PathLike)) and str(value).strip():
        candidate = Path(value).expanduser()
        if candidate.is_dir():
            return candidate.resolve()
    documents = Path.home() / "Documents"
    return documents.resolve() if documents.is_dir() else Path.home().resolve()


def choose_episode_directory(default_directory: Path) -> Path | None:
    script = """
function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const picked = app.chooseFolder({
    withPrompt: argv[0],
    defaultLocation: Path(argv[1]),
  });
  return picked.toString();
}
"""
    selected = run_macos_picker(
        script,
        "このエピソードの保存先を選んでください。新しいフォルダもここで作成できます。",
        str(default_directory),
    )
    return Path(selected).expanduser().resolve() if selected else None


def choose_series_directory(default_directory: Path) -> Path | None:
    script = """
function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const picked = app.chooseFolder({
    withPrompt: argv[0],
    defaultLocation: Path(argv[1]),
  });
  return picked.toString();
}
"""
    selected = run_macos_picker(
        script,
        "シリーズ全体のフォルダを選んでください。人物の参照テキストをこの中から探します。",
        str(default_directory),
    )
    return Path(selected).expanduser().resolve() if selected else None


def choose_workspace_files(default_directory: Path, kind: str, multiple: bool, accept: str = "") -> list[Path] | None:
    if kind not in {"image", "text", "character-text", "file"}:
        raise ValueError("選択するファイルの種類が正しくありません")
    type_name = "public.image" if kind == "image" else "public.text"
    prompt = (
        "人物・ネーム画像を選んでください" if kind == "image"
        else "人物設定の参照テキストを選んでください" if kind == "character-text"
        else "作品情報・舞台設定の参照テキストを選んでください"
    )
    file_types = [type_name]
    if kind == "file":
        extensions = [value[1:] for value in accept.split(",") if value.startswith(".")]
        mime_types = [value for value in accept.split(",") if "/" in value]
        guessed = [extension[1:] for value in mime_types for extension in mimetypes.guess_all_extensions(value)]
        file_types = extensions or list(dict.fromkeys(guessed)) or ["public.item"]
        prompt = "作品に読み込むファイルを選んでください"
    script = """
function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const picked = app.chooseFile({
    withPrompt: argv[0],
    defaultLocation: Path(argv[1]),
    ofType: JSON.parse(argv[2]),
    multipleSelectionsAllowed: argv[3] === "true",
  });
  const files = Array.isArray(picked) ? picked : [picked];
  return JSON.stringify(files.map((file) => file.toString()));
}
"""
    selected = run_macos_picker(script, prompt, str(default_directory), json.dumps(file_types), "true" if multiple else "false")
    if selected is None:
        return None
    return [Path(value).expanduser().resolve() for value in json.loads(selected)]


def choose_import_images_with_options(default_directory: Path) -> dict | None:
    if sys.platform != "darwin":
        return None
    script = """
function run(argv) {
  ObjC.import("AppKit");
  ObjC.import("Foundation");

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  app.activateIgnoringOtherApps(true);

  const panel = $.NSOpenPanel.openPanel;
  panel.canChooseFiles = true;
  panel.canChooseDirectories = false;
  panel.allowsMultipleSelection = true;
  panel.message = "作品に読み込む画像を選んでください";
  panel.prompt = "選択";
  panel.directoryURL = $.NSURL.fileURLWithPathIsDirectory(argv[0], true);
  panel.allowedFileTypes = $.NSArray.arrayWithArray(["png", "jpg", "jpeg", "webp"]);

  let cbSplit, cbTrans, rbFig, rbBg;
  function syncState() {
    const splitOn = cbSplit.state === $.NSControlStateValueOn;
    const figOn = rbFig.state === $.NSControlStateValueOn;
    rbFig.enabled = splitOn;
    rbBg.enabled = splitOn;
    cbTrans.enabled = splitOn && figOn;
  }

  ObjC.registerSubclass({
    name: "NyamuruImportAccessoryTarget",
    superclass: "NSObject",
    methods: {
      "onCheck:": {
        types: ["void", ["id"]],
        implementation: function(_sender) {
          syncState();
        }
      },
      "onRadio:": {
        types: ["void", ["id"]],
        implementation: function(sender) {
          if (sender === rbFig) {
            rbFig.state = $.NSControlStateValueOn;
            rbBg.state = $.NSControlStateValueOff;
          } else {
            rbFig.state = $.NSControlStateValueOff;
            rbBg.state = $.NSControlStateValueOn;
          }
          syncState();
        }
      }
    }
  });

  const target = $.NyamuruImportAccessoryTarget.alloc.init;
  const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 440, 68));

  cbSplit = $.NSButton.checkboxWithTitleTargetAction("コマで分ける", target, "onCheck:");
  cbSplit.frame = $.NSMakeRect(12, 38, 190, 22);
  cbSplit.state = $.NSControlStateValueOff;

  cbTrans = $.NSButton.checkboxWithTitleTargetAction("白背景を透過する", target, "onCheck:");
  cbTrans.frame = $.NSMakeRect(220, 38, 200, 22);
  cbTrans.state = $.NSControlStateValueOn;

  rbFig = $.NSButton.radioButtonWithTitleTargetAction("キャラクターへ配置", target, "onRadio:");
  rbFig.frame = $.NSMakeRect(12, 10, 190, 22);
  rbFig.state = $.NSControlStateValueOn;

  rbBg = $.NSButton.radioButtonWithTitleTargetAction("背景へ配置", target, "onRadio:");
  rbBg.frame = $.NSMakeRect(220, 10, 200, 22);
  rbBg.state = $.NSControlStateValueOff;

  syncState();
  view.addSubview(cbSplit);
  view.addSubview(cbTrans);
  view.addSubview(rbFig);
  view.addSubview(rbBg);

  panel.accessoryView = view;
  panel.accessoryViewDisclosed = true;

  if (panel.runModal !== $.NSModalResponseOK) {
    return JSON.stringify({ cancelled: true, paths: [] });
  }

  const urls = panel.URLs;
  const paths = [];
  for (let i = 0; i < urls.count; i++) {
    paths.push(ObjC.unwrap(urls.objectAtIndex(i).path));
  }
  return JSON.stringify({
    cancelled: false,
    paths,
    options: {
      splitByPanels: cbSplit.state === $.NSControlStateValueOn,
      splitTarget: rbBg.state === $.NSControlStateValueOn ? "background" : "figure",
      transparentWhite: cbTrans.state === $.NSControlStateValueOn,
    },
  });
}
"""
    raw = run_macos_picker(script, str(default_directory))
    if raw is None:
        return {"cancelled": True, "paths": [], "options": None}
    return json.loads(raw)
