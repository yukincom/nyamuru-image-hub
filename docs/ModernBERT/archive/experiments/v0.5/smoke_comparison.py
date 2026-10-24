"""一時領域の極小モデルで全比較経路を確認する。精度実験ではない。"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import torch
from tokenizers import Tokenizer, models, processors
from transformers import (
    ModernBertConfig,
    ModernBertForSequenceClassification,
    PreTrainedTokenizerFast,
)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment_root", type=Path)
    parser.add_argument("fixture_root", type=Path)
    args = parser.parse_args()
    source, fixture = args.experiment_root.resolve(), args.fixture_root.resolve()
    if fixture.exists():
        raise ValueError("fixture must be a new directory")
    names = json.loads((source / "bundle-files.json").read_text())["files"]
    source_hashes = {name: sha(source / name) for name in names}
    fixture.mkdir(parents=True)
    for name in names:
        path = fixture / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, path)
    config = json.loads((fixture / "experiment.json").read_text())
    config.update(
        model="nyamuru-smoke/tiny-modernbert",
        revision="1" * 40,
        epochs=1,
        batch_size=648,
    )
    write_json(fixture / "experiment.json", config)
    write_json(
        fixture / "input-sha256.json", {name: sha(fixture / name) for name in names}
    )
    write_json(
        fixture / "setup.json",
        {"kind": "CPU integration fixture; no accuracy evidence"},
    )
    (fixture / "pip-freeze.txt").write_text(
        "\n".join(
            sorted(
                f"{dist.metadata['Name']}=={dist.version}"
                for dist in importlib.metadata.distributions()
            )
        )
        + "\n"
    )
    snapshot = (
        fixture
        / "hf-cache/models--nyamuru-smoke--tiny-modernbert/snapshots"
        / config["revision"]
    )
    snapshot.mkdir(parents=True)
    vocab = {"[PAD]": 0, "[UNK]": 1, "[CLS]": 2, "[SEP]": 3}
    tokens = Tokenizer(models.WordLevel(vocab, unk_token="[UNK]"))
    tokens.post_processor = processors.TemplateProcessing(
        single="[CLS] $A [SEP]", special_tokens=[("[CLS]", 2), ("[SEP]", 3)]
    )
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokens,
        unk_token="[UNK]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        model_max_length=128,
    )
    tokenizer.save_pretrained(snapshot)
    contract = json.loads((source / "source/labels.json").read_text())
    torch.manual_seed(0)
    model = ModernBertForSequenceClassification(
        ModernBertConfig(
            vocab_size=4,
            hidden_size=8,
            intermediate_size=16,
            num_hidden_layers=1,
            num_attention_heads=1,
            num_labels=19,
            max_position_embeddings=128,
            local_attention=64,
            pad_token_id=0,
            cls_token_id=2,
            sep_token_id=3,
            bos_token_id=2,
            eos_token_id=3,
            label2id=contract["label2id"],
            id2label={int(key): value for key, value in contract["id2label"].items()},
        )
    )
    model.save_pretrained(snapshot)
    env = dict(
        os.environ,
        NYAMURU_EXPERIMENT_ROOT=str(fixture),
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
    )
    started = time.perf_counter()
    with (fixture / "smoke.log").open("w") as log:
        subprocess.run(
            [sys.executable, str(fixture / "comparison.py"), "run", "--device", "cpu"],
            cwd=fixture,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )
        archive = fixture / "smoke-results.zip"
        subprocess.run(
            [
                sys.executable,
                str(fixture / "comparison.py"),
                "pack",
                "--output",
                str(archive),
            ],
            cwd=fixture,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )
        extracted = fixture / "downloaded-artifact"
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(extracted)
        before = {
            str(p.relative_to(extracted)): sha(p)
            for p in extracted.rglob("*")
            if p.is_file()
        }
        subprocess.run(
            [
                sys.executable,
                str(fixture / "comparison.py"),
                "verify",
                "--root",
                str(extracted),
            ],
            cwd=fixture,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )
        after = {
            str(p.relative_to(extracted)): sha(p)
            for p in extracted.rglob("*")
            if p.is_file()
        }
    assert before == after, "downloaded artifact mutated during verification"
    assert source_hashes == {name: sha(source / name) for name in names}, (
        "real experiment input changed"
    )
    summary = json.loads((fixture / "comparison-summary.json").read_text())
    result = {
        "status": "passed",
        "scope": "tiny CPU model / placeholder tokenizer only; no accuracy evidence",
        "conditions": 3,
        "trials": 18,
        "checkpoints": 9,
        "checked_predictions": summary["checked_predictions"],
        "wall_seconds": time.perf_counter() - started,
        "downloaded_artifact_unchanged": True,
        "real_inputs_unchanged": True,
        "source_sha256": source_hashes,
        "result_archive_sha256": sha(archive),
    }
    write_json(fixture / "smoke-verification.json", result)
    print(
        json.dumps(
            {key: value for key, value in result.items() if key != "source_sha256"}
        )
    )


if __name__ == "__main__":
    main()
