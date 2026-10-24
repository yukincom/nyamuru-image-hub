"""版ごとの出典・旧分割・新しい保留評価を検査する。学習はtrain.pyを共用。"""

import json
from collections import Counter, defaultdict


def lineage_config(root):
    """A later version retires prior holdouts without relabeling or moving them to train."""
    path = root / "lineage-plan.json"
    if path.is_file():
        config = json.loads(path.read_text())
        mapping = config["split_map"]
        if (
            mapping.get("train") != "train"
            or any(
                not target.startswith("legacy_")
                for old, target in mapping.items()
                if old != "train"
            )
            or len(set(mapping.values())) != len(mapping)
            or set(config["splits"]) != {"train", "dev", "test", *mapping.values()}
            or len(config["splits"]) != len(set(config["splits"]))
        ):
            raise ValueError("invalid retired split mapping")
        return config
    return {
        "current_version": "v0.3",
        "previous_version": "v0.2",
        "previous_plan": "legacy/v02/split-plan.json",
        "previous_data_dir": "legacy/v02/data",
        "split_map": {"train": "train", "dev": "legacy_dev", "test": "legacy_test"},
        "inherited_row_split_map": {},
        "lineage_link_files": ["curation/2026-10-18-v03-boundaries/family-links.json"],
        "baseline_reports": [
            {
                "version": "v0.2",
                "reports": "legacy/v02-results/reports",
                "split_map": {"dev": "legacy_dev", "test": "legacy_test"},
            }
        ],
    }


def families_for(rows, root):
    """Old family links and reviewed derivation links remain visible after retirement."""
    groups = {r["group"] for r in rows}
    parent = {g: g for g in groups}

    def find(g):
        while parent[g] != g:
            parent[g] = parent[parent[g]]
            g = parent[g]
        return g

    def union(items):
        items = list(items)
        if not items or any(g not in parent for g in items):
            raise ValueError("unknown group in lineage")
        roots = {find(g) for g in items}
        first = min(roots)
        for other in roots:
            parent[other] = first

    config = lineage_config(root)
    old = json.loads((root / config["previous_plan"]).read_text())["assignments"]
    buckets = defaultdict(set)
    by_id = {r["id"]: r for r in rows}
    for ident, value in old.items():
        buckets[value["family"]].add(by_id[ident]["group"])
    for value in buckets.values():
        union(value)
    new_families = defaultdict(set)
    for name in config["lineage_link_files"]:
        for item in json.loads((root / name).read_text())["groups"]:
            new_families[item["family"]].update(
                [item["group"], *item["related_v02_groups"]]
            )
    for value in new_families.values():
        union(value)
    for link in json.loads((root / "family-review.json").read_text())["merge_groups"]:
        union(link["groups"])
    return {r["id"]: find(r["group"]) for r in rows}


def validate_v03(splits, source, plan):
    from dataset import LABEL_TO_ID, ROOT, digest, normalized, read_rows, require

    expected_families = families_for(source, ROOT)
    config = lineage_config(ROOT)
    previous_plan = json.loads((ROOT / config["previous_plan"]).read_text())[
        "assignments"
    ]

    def row_split(row, declared):
        if row["id"] in previous_plan:
            return config["inherited_row_split_map"].get(declared, declared)
        return declared

    originals = {r["id"]: r for r in source}
    require(set(plan["assignments"]) == set(originals), "assignment IDs differ")
    owners, families, groups, texts = {}, defaultdict(set), defaultdict(set), set()
    for split, rows in splits.items():
        require(bool(rows), f"{split}: empty")
        for row in rows:
            ident = row["id"]
            require(
                ident in originals and row == originals[ident],
                f"{ident}: original row changed",
            )
            require(ident not in owners, "duplicate split ID")
            owners[ident] = split
            assigned = plan["assignments"][ident]
            require(assigned["split"] == split, "frozen split differs")
            require(
                assigned["family"] == expected_families[ident], "lineage family differs"
            )
            require(
                "allowed_split" not in row
                or row_split(row, row["allowed_split"]) == split,
                "train-only/public split constraint violated",
            )
            require(normalized(row["text"]) not in texts, "duplicate normalized text")
            texts.add(normalized(row["text"]))
            families[assigned["family"]].add(split)
            groups[row["group"]].add(split)
    require(set(owners) == set(originals), "source rows missing")
    for seen in [groups, families]:
        for memberships in seen.values():
            # Retired examples may share improvement lineage with training. New dev/test may not.
            require(
                len(memberships) == 1
                or memberships <= set(config["split_map"].values()),
                "new holdout family crosses splits",
            )
    for split, minimum in json.loads((ROOT / "corpus.json").read_text())[
        "minimum_per_label"
    ].items():
        counts = Counter(r["label"] for r in splits[split])
        require(
            all(counts[label] >= minimum for label in LABEL_TO_ID),
            f"{split}: class coverage",
        )
    for old_split, new_split in config["split_map"].items():
        old_path = ROOT / config["previous_data_dir"] / f"{old_split}.jsonl"
        old_rows = read_rows(old_path)
        for row in old_rows:
            require(
                originals[row["id"]] == row and owners[row["id"]] == new_split,
                "previous version row/split changed",
            )
        if old_split != "train":
            require(splits[new_split] == old_rows, "legacy rows/order changed")
            if (ROOT / "data" / f"{new_split}.jsonl").is_file():
                require(
                    (ROOT / "data" / f"{new_split}.jsonl").read_bytes()
                    == old_path.read_bytes(),
                    "legacy bytes changed",
                )
    for name, expected in json.loads(
        (ROOT / "preparation-source-snapshot.json").read_text()
    )["files_sha256"].items():
        require(
            digest(ROOT / name) == expected, f"received source snapshot changed: {name}"
        )
    public = {
        str(r["id"]): r
        for r in read_rows(ROOT / "source/public/massive-1.1/ja-JP.jsonl")
    }
    public_owners = {}
    for row in source:
        if "original_corpus" not in row:
            continue
        original = public[str(row["original_id"])]
        require(row["original_text"] == original["utt"], "public original text changed")
        require(
            row["original_label"] == original["intent"], "public original label changed"
        )
        require(
            row["original_partition"] == original["partition"],
            "public original partition changed",
        )
        split = owners[row["id"]]
        require(
            split == row_split(row, original["partition"]),
            "official source partition differs",
        )
        if row["source"] == "massive_human_localized":
            require(row["text"] == original["utt"], "raw public utterance changed")
        else:
            require(
                row["source"] == "massive_derived_synthetic" and split == "train",
                "adapted public data must be train-only",
            )
            require(
                row["text"] != original["utt"], "derived row falsely marked unchanged"
            )
        key = normalized(original["utt"])
        require(
            key not in public_owners or public_owners[key] == split,
            "public source reused across splits",
        )
        public_owners[key] = split
    expected_new = json.loads((ROOT / "corpus.json").read_text())["sources"]
    for item in expected_new:
        if item.get("allowed_split"):
            for row in read_rows(ROOT / item["path"]):
                require(
                    owners[row["id"]] == item["allowed_split"],
                    "source split constraint violated",
                )
