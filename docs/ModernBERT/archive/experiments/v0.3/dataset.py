"""正本の原文・ラベルIDを保持し、モデルにはtextだけを渡す。"""

import hashlib
import json
import os
import re
import unicodedata
from collections import Counter
from pathlib import Path

CODE_ROOT = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("NYAMURU_EXPERIMENT_ROOT", CODE_ROOT)).resolve()
V03 = (ROOT / "legacy/v02/split-plan.json").is_file()
CONTRACT = json.loads((ROOT / "source/labels.json").read_text())
LABEL_TO_ID = CONTRACT["label2id"]
LABEL_TO_ID = dict(sorted(LABEL_TO_ID.items(), key=lambda item: item[1]))
SPLITS = (
    ("train", "dev", "test", "legacy_dev", "legacy_test")
    if V03
    else ("train", "dev", "test")
)
FROZEN_FILES = [
    "train.py",
    "dataset.py",
    "evaluation.py",
    "experiment.json",
    "source/labels.json",
    "source/candidates.jsonl",
    "source/review.md",
    "source/manifest.json",
    "handoff.json",
    "requirements-train.txt",
    "split-plan.json",
    "family-review.json",
    "data-report.json",
    "corpus.json",
    "curation/2026-10-17-v02-variants/candidates.jsonl",
    "curation/2026-10-17-v02-variants/manifest.json",
    "curation/2026-10-17-v02-variants/semantic-review.json",
    "curation/2026-10-17-v02-variants/review.md",
]

if V03:
    FROZEN_FILES = json.loads((ROOT / "bundle-files.json").read_text())["files"]

SHARED_CODE = {
    "dataset.py",
    "evaluation.py",
    "train.py",
    "verify_results.py",
    "build_colab.py",
    "v03_data.py",
    "prepare_v03.py",
    "test_v03_pipeline.py",
}


def input_path(name):
    """Versioned input data stays in ROOT; only explicitly shared code may fall back."""
    relative = Path(name)
    require(
        not relative.is_absolute() and ".." not in relative.parts, "unsafe input path"
    )
    path = ROOT / relative
    if not path.is_file() and name in SHARED_CODE:
        return CODE_ROOT / name
    return path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_rows(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines()]


def normalized(text):
    text = unicodedata.normalize("NFKC", text).casefold()
    return "".join(c for c in text if unicodedata.category(c)[0] not in "PZS")


def model_example(row):
    # Do not prepend label descriptions, context, slots, tags, notes or group IDs.
    return {"text": row["text"], "labels": LABEL_TO_ID[row["label"]]}


def read_splits(data_dir=ROOT / "data"):
    return {name: read_rows(Path(data_dir) / f"{name}.jsonl") for name in SPLITS}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_corpus_lines():
    manifest = json.loads((ROOT / "corpus.json").read_text())
    lines, seen, texts = [], set(), set()
    fields = {
        "id",
        "text",
        "label",
        "slots",
        "group",
        "tags",
        "note",
        "source",
        "review_status",
    }
    for item in manifest["sources"]:
        relative = Path(item["path"])
        require(
            not relative.is_absolute() and ".." not in relative.parts,
            "unsafe corpus path",
        )
        path = ROOT / relative
        require(digest(path) == item["sha256"], f"corpus changed: {relative}")
        source_bytes = path.read_bytes()
        require(source_bytes.endswith(b"\n"), f"corpus must end with LF: {relative}")
        source_lines = source_bytes.splitlines(keepends=True)
        require(len(source_lines) == item["n"], f"corpus count differs: {relative}")
        for line in source_lines:
            row = json.loads(line)
            require(
                set(row) == fields | set(item.get("extra_fields", [])),
                "corpus fields differ",
            )
            require(
                re.fullmatch(
                    r"(?:nyamuru_voice_[0-9]{3,4}|nyamuru_massive_(?:raw|adapt)_[0-9]+)",
                    row["id"],
                )
                is not None,
                "invalid corpus ID",
            )
            require(row["id"] not in seen, "duplicate corpus ID")
            require(
                isinstance(row["text"], str) and row["text"].strip(),
                "empty corpus text",
            )
            require(
                normalized(row["text"]) not in texts, "duplicate normalized corpus text"
            )
            require(row["label"] in LABEL_TO_ID, "unknown corpus label")
            require(
                isinstance(row["slots"], dict) and isinstance(row["tags"], list),
                "invalid corpus metadata",
            )
            require(
                isinstance(row["group"], str) and row["group"], "missing corpus group"
            )
            require(
                row["source"]
                in {
                    "codex_synthetic",
                    "user_supplied_example",
                    "massive_human_localized",
                    "massive_derived_synthetic",
                },
                "unknown provenance",
            )
            seen.add(row["id"])
            texts.add(normalized(row["text"]))
        lines.extend(source_lines)
    require(len(lines) == manifest["n"], "total corpus count differs")
    return lines


def read_corpus():
    return [json.loads(line) for line in read_corpus_lines()]


def validate(splits, *, plan=None):
    handoff = json.loads((ROOT / "handoff.json").read_text())
    for name, expected in handoff["source_sha256"].items():
        require(digest(ROOT / "source" / name) == expected, f"source changed: {name}")
    require(list(LABEL_TO_ID.values()) == list(range(19)), "label IDs changed")
    require(
        CONTRACT["id2label"] == {str(i): label for label, i in LABEL_TO_ID.items()},
        "reverse labels differ",
    )
    source = read_corpus()
    originals = {r["id"]: r for r in source}
    require(len(originals) == len(source), "source IDs/count differ")
    require(set(splits) == set(SPLITS), "required split names differ")
    if plan is None:
        plan = json.loads((ROOT / "split-plan.json").read_text())
    assignment = plan["assignments"]
    require(set(assignment) == set(originals), "assignment IDs differ")
    if V03:
        from v03_data import validate_v03

        validate_v03(splits, source, plan)
        return
    owners, groups, families, texts = {}, {}, {}, {}
    for split, rows in splits.items():
        require(bool(rows), f"{split}: empty")
        for row in rows:
            ident = row["id"]
            require(
                re.fullmatch(
                    r"(?:nyamuru_voice_[0-9]{3,4}|nyamuru_massive_(?:raw|adapt)_[0-9]+)",
                    ident,
                )
                is not None,
                "invalid ID",
            )
            require(
                ident in originals and row == originals[ident],
                f"{ident}: original row changed",
            )
            require(ident not in owners, f"{ident}: duplicated across splits")
            owners[ident] = split
            require(
                assignment[ident]["split"] == split,
                f"{ident}: split differs from frozen plan",
            )
            require(row["label"] in LABEL_TO_ID, f"{ident}: unknown label")
            require(
                isinstance(row["text"], str) and row["text"].strip(),
                f"{ident}: empty text",
            )
            for values, key in [
                (groups, row["group"]),
                (families, assignment[ident]["family"]),
                (texts, normalized(row["text"])),
            ]:
                if values is texts:
                    require(key not in values, f"{ident}: duplicate normalized text")
                require(
                    key not in values or values[key] == split,
                    f"{ident}: group/family crosses splits",
                )
                values[key] = split
    require(set(owners) == set(originals), "source rows missing")
    minimums = json.loads((ROOT / "corpus.json").read_text())["minimum_per_label"]
    for split, rows in splits.items():
        counts = Counter(r["label"] for r in rows)
        require(
            all(counts[label] >= minimums[split] for label in LABEL_TO_ID),
            f"{split}: insufficient class coverage",
        )
    for link in json.loads((ROOT / "family-review.json").read_text())["merge_groups"]:
        require(
            len({groups[g] for g in link["groups"]}) == 1,
            "reviewed contrast family crosses splits",
        )


def data_report(splits, data_dir=ROOT / "data"):
    plan_path = Path(data_dir).parent / "split-plan.json"
    plan = json.loads(plan_path.read_text())
    return {
        "schema_version": 1,
        "model_fields": ["text"],
        "target_field": "label",
        "source_sha256": digest(ROOT / "source/candidates.jsonl"),
        "corpus_sha256": digest(ROOT / "corpus.json"),
        "corpus": json.loads((ROOT / "corpus.json").read_text()),
        "label_contract_sha256": digest(ROOT / "source/labels.json"),
        "split_plan_sha256": digest(plan_path),
        "family_review_sha256": digest(ROOT / "family-review.json"),
        "splits": {
            split: {
                "n": len(rows),
                "sha256": digest(Path(data_dir) / f"{split}.jsonl"),
                "labels": {
                    label: sum(r["label"] == label for r in rows)
                    for label in LABEL_TO_ID
                },
                "missing_labels": [
                    label
                    for label in LABEL_TO_ID
                    if not any(r["label"] == label for r in rows)
                ],
                "groups": len({r["group"] for r in rows}),
                "families": len({plan["assignments"][r["id"]]["family"] for r in rows}),
                "sources": dict(Counter(r["source"] for r in rows)),
            }
            for split, rows in splits.items()
        },
    }
