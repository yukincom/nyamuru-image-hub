"""明示した入力ファイルだけで、全セル実行できるColabノートブックを作る。"""

import ast
import hashlib
import json
import zipfile

from dataset import ROOT, V03, V04, input_path

ARCHIVE = "nyamuru-voice-v02-inputs.zip"
NOTEBOOK = "Nyamuru_Voice_ModernBERT_v0.2_19分類_2026-10-17.ipynb"
REMOTE = "/content/nyamuru-voice-v02-20261017"
RESULT = "/content/nyamuru-voice-v02-colab-results.zip"
FILES = [
    "dataset.py",
    "evaluation.py",
    "train.py",
    "verify_results.py",
    "test_pipeline.py",
    "prepare_data.py",
    "build_colab.py",
    "requirements-train.txt",
    "experiment.json",
    "handoff.json",
    "implementation-provenance.json",
    "family-review.json",
    "split-plan.json",
    "data-report.json",
    "tokenization-check.json",
    "README.md",
    "docs/2026-10-17-v02-protocol.md",
    "docs/2026-10-17-v02-split-review.md",
    "source/labels.json",
    "source/candidates.jsonl",
    "source/review.md",
    "source/manifest.json",
    "corpus.json",
    "curation/2026-10-17-v02-variants/candidates.jsonl",
    "curation/2026-10-17-v02-variants/manifest.json",
    "curation/2026-10-17-v02-variants/semantic-review.json",
    "curation/2026-10-17-v02-variants/review.md",
    "data/train.jsonl",
    "data/dev.jsonl",
    "data/test.jsonl",
]

if V03:
    ARCHIVE = "nyamuru-voice-v03-inputs.zip"
    NOTEBOOK = "Nyamuru_Voice_ModernBERT_v0.3_19分類_2026-10-18.ipynb"
    REMOTE = "/content/nyamuru-voice-v03-20261018"
    RESULT = "/content/nyamuru-voice-v03-colab-results.zip"
    FILES = json.loads((ROOT / "bundle-files.json").read_text())["files"]

if V04:
    ARCHIVE = "nyamuru-voice-v04-inputs.zip"
    NOTEBOOK = "Nyamuru_Voice_ModernBERT_v0.4_19分類_2026-10-18.ipynb"
    REMOTE = "/content/nyamuru-voice-v04-20261018"
    RESULT = "/content/nyamuru-voice-v04-colab-results.zip"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    from dataset import data_report, read_splits, validate

    validate(read_splits())
    assert data_report(read_splits()) == json.loads(
        (ROOT / "data-report.json").read_text()
    )
    hashes = {name: sha(input_path(name).read_bytes()) for name in FILES}
    (ROOT / "input-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
    # Stable ZIP headers make the bundle reproducible from the same contents.
    with zipfile.ZipFile(
        ROOT / ARCHIVE, "w", zipfile.ZIP_DEFLATED, compresslevel=2
    ) as archive:
        for name in FILES + ["input-sha256.json"]:
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 17, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, input_path(name).read_bytes(), compresslevel=2)
    archive_hash = sha((ROOT / ARCHIVE).read_bytes())
    upload = f"""from google.colab import files
from pathlib import Path
import hashlib, json, zipfile
uploaded = files.upload()
assert list(uploaded) == [{ARCHIVE!r}], 'Select the Nyamuru input ZIP'
assert hashlib.sha256(uploaded[{ARCHIVE!r}]).hexdigest() == {archive_hash!r}, 'Input ZIP differs'
ROOT = Path({REMOTE!r})
assert not ROOT.exists(), 'Use a fresh runtime; existing results are not overwritten'
ROOT.mkdir()
with zipfile.ZipFile({ARCHIVE!r}) as archive:
    assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in archive.namelist())
    archive.extractall(ROOT)
for name, expected in json.loads((ROOT/'input-sha256.json').read_text()).items():
    assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == expected, name
del uploaded
print('INPUT HASHES VERIFIED: 19 labels; text only; see data-report.json for counts')
"""
    setup = f"""from pathlib import Path
import subprocess, sys, time, json
ROOT = Path({REMOTE!r})
start = time.perf_counter()
subprocess.run(['nvidia-smi'], check=True)
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'uv'], check=True)
subprocess.run([sys.executable, '-m', 'uv', 'venv', '--python', '3.11.14', str(ROOT/'.venv')], check=True)
PYTHON = str(ROOT/'.venv/bin/python')
subprocess.run([sys.executable, '-m', 'uv', 'pip', 'install', '--python', PYTHON, '-r', str(ROOT/'requirements-train.txt')], check=True)
subprocess.run([PYTHON, '-c', "import torch; assert torch.cuda.is_available(); print(torch.__version__, torch.cuda.get_device_name())"], check=True)
subprocess.run([PYTHON, '-m', 'unittest', 'discover', '-s', str(ROOT), '-p', 'test_*.py', '-v'], cwd=ROOT, check=True)
download = "from huggingface_hub import snapshot_download; snapshot_download('sbintuitions/modernbert-ja-30m', revision='8cb03f54cb9e30e72459e5f1cedc6d89c7d8dcb5', token=False, cache_dir='{REMOTE}/hf-cache', allow_patterns=['config.json','model.safetensors','tokenizer.json','tokenizer_config.json','special_tokens_map.json','tokenizer.model','spiece.model','README.md','LICENSE'])"
subprocess.run([PYTHON, '-c', download], check=True)
(ROOT/'setup.json').write_text(json.dumps({{'setup_seconds':time.perf_counter()-start, 'notebook_python':sys.version, 'training_python':PYTHON}}, indent=2))
(ROOT/'pip-freeze.txt').write_bytes(subprocess.check_output([sys.executable, '-m', 'uv', 'pip', 'freeze', '--python', PYTHON]))
print('SETUP VERIFIED; starting six training trials')
"""
    run = f"""from pathlib import Path
import subprocess, json
ROOT = Path({REMOTE!r})
PYTHON = str(ROOT/'.venv/bin/python')
command = [PYTHON, '-u', str(ROOT/'train.py'), '--device', 'cuda']
(ROOT/'command.json').write_text(json.dumps(command, ensure_ascii=False, indent=2))
with (ROOT/'training.log').open('w') as log:
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        log.write(line); log.flush()
        if '"event"' in line or 'Error' in line or 'Traceback' in line: print(line, end='', flush=True)
    code = process.wait()
assert code == 0, 'Training failed; inspect training.log'
subprocess.run([PYTHON, str(ROOT/'verify_results.py')], cwd=ROOT, check=True)
print('ALL SIX TRIALS AND THREE CHECKPOINT EVALUATIONS VERIFIED')
"""
    pack = f"""from pathlib import Path
import hashlib, json, zipfile
ROOT = Path({REMOTE!r})
manifest = json.loads((ROOT/'reports/manifest.json').read_text())
assert manifest.get('finished_at_utc')
assert len(manifest['selected_checkpoints']) == 3
assert json.loads((ROOT/'reports/verification.json').read_text())['status'] == 'verified'
selected = [ROOT/'weights'/value['path'] for value in manifest['selected_checkpoints'].values()]
inputs = set(json.loads((ROOT/'input-sha256.json').read_text())) | {{'input-sha256.json','setup.json','pip-freeze.txt','command.json','training.log'}}
paths = [p for p in ROOT.rglob('*') if p.is_file() and (
    str(p.relative_to(ROOT)) in inputs or p.is_relative_to(ROOT/'reports') or
    (p.is_relative_to(ROOT/'weights') and (p.suffix in {{'.json','.jsonl'}} or any(p.is_relative_to(s) for s in selected))))]
hashes = {{str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
(ROOT/'artifact-sha256.json').write_text(json.dumps(hashes, indent=2))
archive = Path({RESULT!r})
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=2) as output:
    for p in sorted(paths)+[ROOT/'artifact-sha256.json']: output.write(p, p.relative_to(ROOT))
print(json.dumps({{'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'GPU': manifest.get('cuda',{{}}).get('gpu_name'), 'elapsed_seconds': manifest['elapsed_seconds']}}, ensure_ascii=False, indent=2))
print((ROOT/'reports/report.md').read_text())
"""

    def md(source):
        return {
            "cell_type": "markdown",
            "metadata": {},
            "source": source.splitlines(True),
        }

    def code(source):
        ast.parse(source)
        return {
            "cell_type": "code",
            "metadata": {},
            "execution_count": None,
            "outputs": [],
            "source": source.splitlines(True),
        }

    note = """# ニャムル音声操作：ModernBERT 19分類

元316件の原文を保持し、全19分類へ32件ずつ追加した924件。入力は発話本文だけ、slots・注釈・画面状態は入力しません。
原groupと近い対照例をまとめ、train/dev/testすべてに全19分類を確保。合成例の保留文型であり、実利用者発話やASRの評価ではありません。

1. 「ランタイム」→「ランタイムのタイプを変更」でGPU（T4等）を選ぶ。
2. 「ランタイム」→「すべてのセルを実行」。最初の入力欄で **nyamuru-voice-v02-inputs.zip** を選ぶ。
3. 以降は環境準備→6試行→検証→保存→ダウンロードまで順番に実行。途中のエラーはそのセルを確認する。
4. **nyamuru-voice-v02-colab-results.zip** を保存して、このチャットへ渡す。3モデルと結果の確認後にGPUを解放する。

3 seed（42/43/44）×2学習率（2e-5/5e-5）、10 epoch、batch16、128 token、float32/SDPA。切り詰めなし。devだけで条件を選び、その後testを評価します。
ドギドのデータや学習済み重みは使いません。ASR、引数解決、アプリ接続、自動採用は含みません。
"""
    if V03:
        note = (ROOT / "notebook-introduction.md").read_text()
    nb = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "colab": {"name": NOTEBOOK},
            "kernelspec": {"display_name": "Python 3", "name": "python3"},
            "accelerator": "GPU",
        },
        "cells": [
            md(note),
            code(upload),
            md("## 環境準備"),
            code(setup),
            md("## 学習と結果検証"),
            code(run),
            md("## 3モデルと結果を保存"),
            code(pack),
            code(f"from google.colab import files\nfiles.download({RESULT!r})\n"),
        ],
    }
    for index, cell in enumerate(nb["cells"]):
        cell["id"] = f"nyamuru-{index:02d}"
    (ROOT / NOTEBOOK).write_text(json.dumps(nb, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "archive": ARCHIVE,
                "sha256": archive_hash,
                "bytes": (ROOT / ARCHIVE).stat().st_size,
                "notebook": NOTEBOOK,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
