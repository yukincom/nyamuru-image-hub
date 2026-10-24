"""固定poolのv0.3を組み立てる。旧924件の分割を保存し、既存の学習経路へ渡す。"""

import json
import shutil
import tempfile
from pathlib import Path

from dataset import ROOT, V03, data_report, digest, read_corpus_lines, validate
from v03_data import families_for

GENERATED = [
    "corpus.json",
    "split-plan.json",
    "data-report.json",
    *[f"data/{s}.jsonl" for s in ["train", "dev", "test", "legacy_dev", "legacy_test"]],
]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def prepare():
    if not V03:
        raise ValueError("set NYAMURU_EXPERIMENT_ROOT to experiments/v0.3")
    if any((ROOT / name).exists() for name in GENERATED) or any(
        (ROOT / name).exists() for name in ["weights", "reports"]
    ):
        raise ValueError("frozen outputs/results already exist; never overwrite")
    specification = json.loads((ROOT / "pool-sources.json").read_text())
    sources = []
    for item in specification["sources"]:
        raw = (ROOT / item["path"]).read_bytes()
        rows = [json.loads(line) for line in raw.splitlines()]
        base = {
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
        sources.append(
            dict(
                item,
                n=len(rows),
                sha256=digest(ROOT / item["path"]),
                extra_fields=sorted(set(rows[0]) - base),
            )
        )
    corpus = {
        "schema_version": 3,
        "n": sum(i["n"] for i in sources),
        "sources": sources,
        "minimum_per_label": {
            "train": 12,
            "dev": 4,
            "test": 4,
            "legacy_dev": 4,
            "legacy_test": 4,
        },
        "model_fields": ["text"],
        "legacy_eligible_for_acceptance": False,
    }
    with tempfile.TemporaryDirectory(prefix="nyamuru-v03-prepare-") as directory:
        stage = Path(directory) / "input"
        shutil.copytree(ROOT, stage)
        write_json(stage / "corpus.json", corpus)
        import unittest.mock

        import dataset

        with unittest.mock.patch("dataset.ROOT", stage):
            raw_lines = read_corpus_lines()
            rows = [json.loads(line) for line in raw_lines]
            row_bytes = {json.loads(line)["id"]: line for line in raw_lines}
            by_id = {r["id"]: r for r in rows}
            family = families_for(rows, stage)
            old_plan = json.loads((stage / "legacy/v02/split-plan.json").read_text())[
                "assignments"
            ]
            owners = {
                ident: value["split"]
                if value["split"] == "train"
                else "legacy_" + value["split"]
                for ident, value in old_plan.items()
            }
            for item in sources:
                if item.get("allowed_split"):
                    for line in (stage / item["path"]).read_text().splitlines():
                        ident = json.loads(line)["id"]
                        if ident in owners:
                            raise ValueError("new source repeats legacy ID")
                        owners[ident] = item["allowed_split"]
            if set(owners) != set(by_id):
                raise ValueError("unassigned rows")
            assignments = {
                ident: {"split": owners[ident], "family": family[ident]}
                for ident in by_id
            }
            plan = {
                "schema_version": 3,
                "method": "fixed official pools and reviewed family isolation; legacy holdouts retired",
                "test_used_for_selection": False,
                "assignments": assignments,
            }
            write_json(stage / "split-plan.json", plan)
            splits = {
                s: [r for r in rows if owners[r["id"]] == s] for s in dataset.SPLITS
            }
            for split in ["dev", "test"]:
                legacy = [
                    json.loads(line)
                    for line in (stage / "legacy/v02/data" / f"{split}.jsonl")
                    .read_text()
                    .splitlines()
                ]
                splits["legacy_" + split] = legacy
            (stage / "data").mkdir(exist_ok=True)
            for split, selected in splits.items():
                (stage / "data" / f"{split}.jsonl").write_bytes(
                    b"".join(row_bytes[r["id"]] for r in selected)
                )
            validate(splits, plan=plan)
            write_json(stage / "data-report.json", data_report(splits, stage / "data"))
        published = []
        try:
            for name in GENERATED:
                target = ROOT / name
                target.parent.mkdir(parents=True, exist_ok=True)
                # Exclusive create also prevents a concurrent preparer replacing frozen data.
                with target.open("xb") as out:
                    published.append(target)
                    out.write((stage / name).read_bytes())
        except BaseException:
            for target in published:
                target.unlink()
            raise
    print(
        json.dumps(
            {
                "status": "prepared",
                "n": corpus["n"],
                "splits": {s: len(r) for s, r in splits.items()},
            }
        )
    )


if __name__ == "__main__":
    prepare()
