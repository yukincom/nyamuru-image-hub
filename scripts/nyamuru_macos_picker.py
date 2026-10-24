"""macOS osascript pickers for episode/series/workspace paths."""

from __future__ import annotations

import os
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


def choose_workspace_files(default_directory: Path, kind: str, multiple: bool) -> list[Path] | None:
    if kind not in {"image", "text", "character-text"}:
        raise ValueError("選択するファイルの種類が正しくありません")
    type_name = "public.image" if kind == "image" else "public.text"
    prompt = (
        "人物・ネーム画像を選んでください" if kind == "image"
        else "人物設定の参照テキストを選んでください" if kind == "character-text"
        else "作品情報・舞台設定の参照テキストを選んでください"
    )
    script = """
function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const picked = app.chooseFile({
    withPrompt: argv[0],
    defaultLocation: Path(argv[1]),
    ofType: [argv[2]],
    multipleSelectionsAllowed: argv[3] === "true",
  });
  const files = Array.isArray(picked) ? picked : [picked];
  return files.map((file) => file.toString()).join("\\n");
}
"""
    selected = run_macos_picker(script, prompt, str(default_directory), type_name, "true" if multiple else "false")
    if selected is None:
        return None
    return [Path(value).expanduser().resolve() for value in selected.splitlines() if value.strip()]
