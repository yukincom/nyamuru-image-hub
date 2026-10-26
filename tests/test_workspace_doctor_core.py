from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "nyamuru_workspace_doctor.py"
SPEC = importlib.util.spec_from_file_location("nyamuru_workspace_doctor", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
doctor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(doctor)


def managed_workspace(root: Path) -> Path:
    episode = root / "episode"
    episode.mkdir(parents=True)
    for name in doctor.MANAGED_EPISODE_DIRECTORIES:
        (episode / name).mkdir()
    return episode


def create_ledger(episode: Path) -> Path:
    root = episode / "draft_data" / "nyamuru"
    (root / "artifacts" / "sha256").mkdir(parents=True)
    database = root / "ledger.sqlite3"
    connection = sqlite3.connect(database)
    connection.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE jobs (
            job_id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL,
            episode_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            panel_id INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE attempts (
            attempt_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL REFERENCES jobs(job_id),
            attempt_number INTEGER NOT NULL,
            retry_of_attempt_id TEXT REFERENCES attempts(attempt_id),
            status TEXT NOT NULL CHECK(status IN ('created','queued','succeeded','failed','outcome_unknown')),
            prompt_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            submitted_at TEXT,
            finished_at TEXT,
            source_file_name TEXT,
            source_subfolder TEXT,
            download_name TEXT,
            error_code TEXT,
            error_message TEXT,
            UNIQUE(job_id,attempt_number)
        );
        CREATE TABLE artifacts (
            sha256 TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL UNIQUE,
            byte_size INTEGER NOT NULL,
            media_type TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE status_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
            status TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            detail_json TEXT NOT NULL,
            provenance_sha256 TEXT REFERENCES artifacts(sha256),
            error_message TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE reviews (
            attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id),
            decision TEXT NOT NULL CHECK(decision IN ('unreviewed','accepted','rejected')),
            note TEXT NOT NULL,
            reviewed_at TEXT
        );
        CREATE TABLE attempt_artifacts (
            attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
            role TEXT NOT NULL,
            sha256 TEXT NOT NULL REFERENCES artifacts(sha256),
            PRIMARY KEY(attempt_id,role)
        );
        CREATE TABLE review_events (
            review_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
            revision INTEGER NOT NULL CHECK(revision >= 1),
            request_nonce TEXT NOT NULL,
            decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
            note TEXT NOT NULL,
            reviewed_at TEXT NOT NULL,
            artifact_sha256 TEXT NOT NULL REFERENCES artifacts(sha256),
            UNIQUE(attempt_id,revision),
            UNIQUE(attempt_id,request_nonce)
        );
        CREATE UNIQUE INDEX review_events_request_nonce_unique ON review_events(request_nonce);
        CREATE TRIGGER status_events_no_update
        BEFORE UPDATE ON status_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER status_events_no_delete
        BEFORE DELETE ON status_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER review_events_no_update
        BEFORE UPDATE ON review_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER review_events_no_delete
        BEFORE DELETE ON review_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
        PRAGMA user_version=2;
        """
    )
    connection.commit()
    connection.close()
    return database


def add_artifact(
    episode: Path,
    data: bytes,
    suffix: str = ".json",
    *,
    listed: bool = True,
    relative_override: str | None = None,
    media_type: str = "application/json",
) -> tuple[str, Path]:
    sha256 = hashlib.sha256(data).hexdigest()
    ledger_root = episode / "draft_data" / "nyamuru"
    relative = relative_override or f"artifacts/sha256/{sha256[:2]}/{sha256}{suffix}"
    target = ledger_root / relative
    if relative_override is None:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    if listed:
        connection = sqlite3.connect(ledger_root / "ledger.sqlite3")
        connection.execute(
            "INSERT INTO artifacts(sha256,relative_path,byte_size,media_type,created_at) VALUES(?,?,?,?,?)",
            (sha256, relative, len(data), media_type, "2026-09-01T00:00:00+00:00"),
        )
        connection.commit()
        connection.close()
    return sha256, target


def valid_png(width: int = 32, height: int = 24, tail: bytes = b"test") -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + (13).to_bytes(4, "big")
        + b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + tail
    )


def create_series(root: Path, *, external_path: str | None = None) -> Path:
    series_root = root / "series-common"
    directory = series_root / "series-one"
    directory.mkdir(parents=True)
    omny = b"manga:\n  title: test\n"
    (directory / "series.yaml").write_bytes(omny)
    metadata = {
        "series_id": "series-one",
        "series_name": "Test Series",
        "revision": hashlib.sha256(omny).hexdigest(),
    }
    if external_path is not None:
        metadata["series_directory"] = external_path
        metadata["character_text_reference"] = {
            "series_directory": external_path,
            "relative_path": "character.md",
        }
    (directory / "catalog.json").write_text(json.dumps(metadata), encoding="utf-8")
    image = valid_png()
    digest = hashlib.sha256(image).hexdigest()
    image_directory = directory / "characters" / "character-one"
    image_directory.mkdir(parents=True)
    (image_directory / f"image-{digest}.png").write_bytes(image)
    return series_root


def tree_snapshot(root: Path) -> list[tuple[str, str, int, str]]:
    items: list[tuple[str, str, int, str]] = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        if path.is_symlink():
            items.append((relative, "symlink", metadata.st_mode, os.readlink(path)))
        elif path.is_dir():
            items.append((relative, "directory", metadata.st_mode, ""))
        elif path.is_file():
            items.append((relative, "file", metadata.st_mode, hashlib.sha256(path.read_bytes()).hexdigest()))
        else:
            items.append((relative, "special", metadata.st_mode, ""))
    return items


def codes(report: dict) -> set[str]:
    return {item["code"] for item in report["observations"]}


class WorkspaceDoctorCoreTest(unittest.TestCase):
    def test_contract_accepts_the_current_production_ledger_schema(self):
        bridge_spec = importlib.util.spec_from_file_location(
            "nyamuru_local_bridge_doctor_contract",
            REPO_ROOT / "scripts" / "nyamuru_local_bridge.py",
        )
        assert bridge_spec is not None and bridge_spec.loader is not None
        bridge = importlib.util.module_from_spec(bridge_spec)
        sys.modules[bridge_spec.name] = bridge
        bridge_spec.loader.exec_module(bridge)
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            ledger_root = episode / "draft_data" / "nyamuru"
            ledger_root.mkdir()
            bridge.PanelDraftLedger(episode, ledger_root)

            report = doctor.WorkspaceDoctor().scan(episode)
            contract = next(item for item in report["observations"] if item["code"] == "ledger_required_objects")

            self.assertEqual(contract["status"], "ok")
            self.assertEqual(contract["evidence"]["invalid_tables"], [])
            self.assertEqual(contract["evidence"]["invalid_triggers"], [])

    def test_clean_episode_ledger_and_series_are_healthy(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            create_ledger(episode)
            (episode / "name_data" / "story.omny.yaml").write_text("manga: {}\n", encoding="utf-8")
            series_root = create_series(root)

            report = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)

            self.assertTrue(report["scan_complete"])
            self.assertEqual(report["verdict"], "healthy")
            self.assertIn("ledger_quick_check_ok", codes(report))
            self.assertIn("series_catalog_identity", codes(report))
            self.assertIn("character_image_integrity", codes(report))
            self.assertTrue(all(not Path(item["path"]).is_absolute() for item in report["snapshot"]["files"]))
            self.assertTrue(all(item["requires_human_review"] for item in report["inferences"]))

    def test_series_catalog_standard_legacy_and_migrated_names_are_read_only(self):
        for case in ("legacy-only", "both-identical", "both-conflict", "migrated", "legacy-modified", "legacy-removed", "current-missing", "bad-origin"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory_name:
                root = Path(directory_name)
                episode = managed_workspace(root)
                create_ledger(episode)
                series_root = create_series(root)
                directory = series_root / "series-one"
                current, legacy = directory / "series.yaml", directory / "series.omny.yaml"
                legacy.write_bytes(current.read_bytes())
                metadata_path = directory / "catalog.json"
                metadata = json.loads(metadata_path.read_text())
                if case == "legacy-only":
                    current.unlink()
                elif case == "both-conflict":
                    legacy.write_bytes(b"different")
                elif case not in ("both-identical",):
                    metadata["legacy_source"] = {"file_name": legacy.name, "sha256": hashlib.sha256(legacy.read_bytes()).hexdigest()}
                    current.write_bytes(b"manga:\r\n  title: new\r\n")
                    metadata["revision"] = hashlib.sha256(current.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
                    if case == "legacy-modified":
                        legacy.write_bytes(b"external update")
                    elif case == "legacy-removed":
                        legacy.unlink()
                    elif case == "current-missing":
                        current.unlink()
                    elif case == "bad-origin":
                        metadata["legacy_source"] = "invalid"
                    metadata_path.write_text(json.dumps(metadata))
                before = tree_snapshot(series_root)
                report = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)
                self.assertEqual(tree_snapshot(series_root), before)
                observation = next(item for item in report["observations"] if item["code"] == "series_catalog_names")
                compatible = case in ("legacy-only", "both-identical", "migrated", "legacy-removed")
                self.assertEqual(observation["evidence"]["compatible"], compatible)
                self.assertEqual(report["verdict"] == "healthy", compatible)

    def test_scan_does_not_change_tree_or_sqlite_bytes(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            create_ledger(episode)
            series_root = create_series(root)
            before = tree_snapshot(root)

            first = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)
            middle = tree_snapshot(root)
            second = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)
            after = tree_snapshot(root)

            self.assertEqual(before, middle)
            self.assertEqual(before, after)
            self.assertEqual(first["snapshot"], second["snapshot"])

    def test_symlink_is_not_followed_or_leaked(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            outside = root / "outside-secret.txt"
            outside.write_text("DO-NOT-READ-SECRET", encoding="utf-8")
            (episode / "name_data" / "outside-link").symlink_to(outside)

            report = doctor.WorkspaceDoctor().scan(episode)
            serialized = json.dumps(report, ensure_ascii=False)

            self.assertIn("symlink_not_followed", codes(report))
            self.assertNotIn("DO-NOT-READ-SECRET", serialized)
            self.assertNotIn(str(outside), serialized)
            self.assertFalse(any(item["path"].endswith("outside-link") for item in report["snapshot"]["files"]))

    def test_root_descriptor_remains_pinned_after_ancestor_swap(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            (episode / "name_data" / "inside.txt").write_text("inside", encoding="utf-8")
            outside = managed_workspace(root / "outside-container")
            (outside / "name_data" / "sentinel.txt").write_text("outside sentinel", encoding="utf-8")
            moved = root / "episode-moved"

            def swap(event: str, _detail: dict) -> None:
                if event == "episode_root_opened":
                    episode.rename(moved)
                    episode.symlink_to(outside, target_is_directory=True)

            report = doctor.WorkspaceDoctor(hook=swap).scan(episode)
            paths = {item["path"] for item in report["snapshot"]["files"]}

            self.assertIn("name_data/inside.txt", paths)
            self.assertNotIn("name_data/sentinel.txt", paths)

    def test_file_change_during_scan_makes_report_incomplete(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            target = episode / "name_data" / "changing.txt"
            target.write_text("before", encoding="utf-8")
            changed = False

            def mutate(event: str, detail: dict) -> None:
                nonlocal changed
                if event == "file_opened" and detail.get("path") == "name_data/changing.txt" and not changed:
                    changed = True
                    target.write_text("after with a different size", encoding="utf-8")

            report = doctor.WorkspaceDoctor(hook=mutate).scan(episode)

            self.assertFalse(report["scan_complete"])
            self.assertEqual(report["verdict"], "incomplete")
            self.assertIn("file_changed_during_read", codes(report))
            self.assertFalse(any(item["path"] == "name_data/changing.txt" for item in report["snapshot"]["files"]))

    def test_corrupt_ledger_is_reported_without_rewrite(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            database = episode / "draft_data" / "nyamuru" / "ledger.sqlite3"
            database.parent.mkdir()
            database.write_bytes(b"not sqlite")
            before = database.read_bytes()

            report = doctor.WorkspaceDoctor().scan(episode)

            self.assertIn("ledger_unreadable", codes(report))
            self.assertEqual(database.read_bytes(), before)
            self.assertEqual(report["verdict"], "attention")

    def test_valid_missing_mismatched_and_orphan_artifacts_are_distinguished(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            create_ledger(episode)
            _valid_sha, _valid_path = add_artifact(episode, b'{"valid":true}')
            _missing_sha, missing_path = add_artifact(episode, b'{"missing":true}')
            missing_path.unlink()
            mismatch_sha, mismatch_path = add_artifact(episode, b'{"original":true}')
            mismatch_path.write_bytes(b'{"tampered":true}')
            orphan_sha, orphan_path = add_artifact(episode, b'{"orphan":true}', listed=False)

            report = doctor.WorkspaceDoctor().scan(episode)
            observations = report["observations"]

            self.assertIn("ledger_artifact_missing", codes(report))
            self.assertIn("ledger_artifact_mismatch", codes(report))
            self.assertIn("artifact_not_listed_in_ledger", codes(report))
            self.assertTrue(any(item["code"] == "possible_orphan_artifact" for item in report["inferences"]))
            self.assertEqual(orphan_path.read_bytes(), b'{"orphan":true}')
            self.assertTrue(any(item["evidence"].get("expected_sha256") == mismatch_sha for item in observations))
            self.assertTrue(any(item["evidence"].get("sha256") == orphan_sha for item in observations))

    def test_standard_and_legacy_yaml_artifacts_are_read_only_and_valid(self):
        with tempfile.TemporaryDirectory() as directory_name:
            episode = managed_workspace(Path(directory_name))
            create_ledger(episode)
            paths = [add_artifact(episode, f"manga: {{title: '{suffix}'}}\n".encode(), suffix,
                                  media_type="application/yaml")[1] for suffix in (".yaml", ".omny.yaml")]
            before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths]
            report = doctor.WorkspaceDoctor().scan(episode)
            self.assertEqual(report["verdict"], "healthy")
            self.assertNotIn("ledger_artifact_metadata_invalid", codes(report))
            self.assertEqual(before, [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths])

    def test_malicious_ledger_path_does_not_escape_episode(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            create_ledger(episode)
            outside = root / "sentinel.json"
            outside.write_text("outside-do-not-read", encoding="utf-8")
            add_artifact(episode, b"outside-do-not-read", relative_override="../../../../sentinel.json")

            report = doctor.WorkspaceDoctor().scan(episode)
            serialized = json.dumps(report, ensure_ascii=False)

            self.assertIn("ledger_artifact_metadata_invalid", codes(report))
            self.assertNotIn(str(outside), serialized)
            self.assertNotIn("outside-do-not-read", serialized)

    def test_attempt_relation_errors_are_reported(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            database = create_ledger(episode)
            connection = sqlite3.connect(database)
            connection.execute(
                "INSERT INTO jobs VALUES(?,?,?,?,?,?)",
                ("job", "series", "episode", 1, 1, "2026-09-01T00:00:00+00:00"),
            )
            connection.execute(
                """INSERT INTO attempts(
                    attempt_id,job_id,attempt_number,retry_of_attempt_id,status,prompt_id,created_at
                ) VALUES(?,?,?,?,?,?,?)""",
                ("attempt", "job", 1, None, "succeeded", "prompt", "2026-09-01T00:00:00+00:00"),
            )
            connection.commit()
            connection.close()

            report = doctor.WorkspaceDoctor().scan(episode)

            self.assertIn("attempt_required_artifact_missing", codes(report))
            self.assertIn("attempt_latest_status_mismatch", codes(report))

    def test_same_name_unrelated_trigger_does_not_satisfy_append_only_contract(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            database = create_ledger(episode)
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                DROP TRIGGER status_events_no_update;
                CREATE TRIGGER status_events_no_update
                AFTER INSERT ON jobs BEGIN SELECT 1; END;
                """
            )
            connection.commit()
            connection.close()

            report = doctor.WorkspaceDoctor().scan(episode)
            contract = next(item for item in report["observations"] if item["code"] == "ledger_required_objects")

            self.assertEqual(contract["status"], "error")
            self.assertIn("status_events_no_update", contract["evidence"]["invalid_triggers"])
            self.assertEqual(report["verdict"], "attention")

    def test_series_revision_image_and_external_reference_checks(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            outside = root / "external-series"
            outside.mkdir()
            (outside / "character.md").write_text("PRIVATE EXTERNAL TEXT", encoding="utf-8")
            series_root = create_series(root, external_path=str(outside))
            catalog_path = series_root / "series-one" / "catalog.json"
            metadata = json.loads(catalog_path.read_text(encoding="utf-8"))
            metadata["revision"] = "0" * 64
            catalog_path.write_text(json.dumps(metadata), encoding="utf-8")
            image_path = next((series_root / "series-one" / "characters").rglob("*.png"))
            image_path.write_bytes(image_path.read_bytes() + b"tampered")

            report = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)
            serialized = json.dumps(report, ensure_ascii=False)

            identity = next(item for item in report["observations"] if item["code"] == "series_catalog_identity")
            image = next(item for item in report["observations"] if item["code"] == "character_image_integrity")
            self.assertEqual(identity["status"], "error")
            self.assertEqual(image["status"], "error")
            self.assertIn("external_reference_not_followed", codes(report))
            self.assertNotIn(str(outside), serialized)
            self.assertNotIn("PRIVATE EXTERNAL TEXT", serialized)

    def test_recovery_assets_are_observed_but_never_purged(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            series_root = create_series(root)
            series = series_root / "series-one"
            deleted = series / "deleted-characters" / "expired.json"
            deleted.parent.mkdir()
            deleted.write_text(
                json.dumps(
                    {
                        "series_id": "series-one",
                        "expires_at": "2000-01-01T00:00:00+00:00",
                        "omny_yaml": "manga: {}",
                    }
                ),
                encoding="utf-8",
            )
            history = series / "character-text-history" / "old.md"
            history.parent.mkdir()
            history.write_text("history", encoding="utf-8")
            draft = series_root / ".drafts" / ("a" * 32)
            draft.mkdir(parents=True)
            (draft / "manifest.json").write_text(
                json.dumps({"draft_token": "a" * 32, "series_id": "series-one"}),
                encoding="utf-8",
            )
            before = tree_snapshot(series_root)

            report = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)

            self.assertEqual(tree_snapshot(series_root), before)
            self.assertTrue(deleted.exists())
            self.assertTrue(history.exists())
            self.assertIn("recovery_assets_present", codes(report))
            self.assertIn("series_drafts_present", codes(report))
            self.assertTrue(all(item["requires_human_review"] for item in report["inferences"]))

    def test_baseline_comparison_detects_exact_added_removed_and_changed_files(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            first_path = episode / "name_data" / "first.txt"
            removed_path = episode / "draft_data" / "removed.txt"
            first_path.write_text("before", encoding="utf-8")
            removed_path.write_text("remove", encoding="utf-8")
            baseline = doctor.WorkspaceDoctor().scan(episode)

            exact = doctor.WorkspaceDoctor().scan(episode, baseline=baseline)
            self.assertTrue(exact["comparison"]["matches"])

            first_path.write_text("after", encoding="utf-8")
            removed_path.unlink()
            (episode / "manuscript_data" / "added.txt").write_text("add", encoding="utf-8")
            changed = doctor.WorkspaceDoctor().scan(episode, baseline=baseline)

            self.assertFalse(changed["comparison"]["matches"])
            self.assertEqual(changed["comparison"]["added"], [{"root": "episode", "path": "manuscript_data/added.txt"}])
            self.assertEqual(changed["comparison"]["removed"], [{"root": "episode", "path": "draft_data/removed.txt"}])
            self.assertEqual(changed["comparison"]["changed"][0]["path"], "name_data/first.txt")
            self.assertIn("sha256", changed["comparison"]["changed"][0]["fields"])

    def test_invalid_baseline_and_scan_limit_never_report_healthy(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            (episode / "name_data" / "one.txt").write_text("one", encoding="utf-8")
            (episode / "name_data" / "two.txt").write_text("two", encoding="utf-8")

            invalid = doctor.WorkspaceDoctor().scan(episode, baseline={"kind": "other"})
            limited = doctor.WorkspaceDoctor(max_files=1).scan(episode)

            self.assertEqual(invalid["verdict"], "incomplete")
            self.assertIsNone(invalid["comparison"])
            self.assertIn("baseline_contract_invalid", codes(invalid))
            self.assertEqual(limited["verdict"], "incomplete")
            self.assertIn("scan_limit_reached", codes(limited))

    def test_stale_revision_rejects_a_tampered_baseline_file_list(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            keep = episode / "name_data" / "keep.txt"
            removed = episode / "draft_data" / "removed.txt"
            keep.write_text("keep", encoding="utf-8")
            removed.write_text("remove", encoding="utf-8")
            baseline = doctor.WorkspaceDoctor().scan(episode)
            tampered = json.loads(json.dumps(baseline))
            tampered["snapshot"]["files"] = [
                item for item in tampered["snapshot"]["files"] if item["path"] != "draft_data/removed.txt"
            ]
            removed.unlink()

            report = doctor.WorkspaceDoctor().scan(episode, baseline=tampered)

            self.assertEqual(report["verdict"], "incomplete")
            self.assertIsNone(report["comparison"])
            self.assertIn("baseline_revision_mismatch", codes(report))

    def test_report_validates_against_strict_schema_when_jsonschema_is_available(self):
        schema = json.loads(
            (REPO_ROOT / "schemas" / "nyamuru-workspace-doctor-v1.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(schema["properties"]["kind"]["const"], doctor.REPORT_KIND)
        try:
            from jsonschema import Draft202012Validator
        except ImportError:
            self.skipTest("jsonschema is an optional local QA dependency")
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            create_ledger(episode)
            series_root = create_series(root)
            backslash_path = episode / "name_data" / "bad\\name.txt"
            backslash_path.write_text("before", encoding="utf-8")
            baseline = doctor.WorkspaceDoctor().scan(episode, series_root=series_root)
            backslash_path.write_text("after", encoding="utf-8")
            report = doctor.WorkspaceDoctor().scan(episode, series_root=series_root, baseline=baseline)

            Draft202012Validator.check_schema(schema)
            Draft202012Validator(schema).validate(baseline)
            Draft202012Validator(schema).validate(report)
            self.assertEqual(report["comparison"]["changed"][0]["path"], "name_data/bad\\name.txt")

    def test_cli_outputs_report_and_never_writes_a_report_file(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = managed_workspace(root)
            before = tree_snapshot(root)
            result = subprocess.run(
                [sys.executable, str(MODULE_PATH), "--episode", str(episode), "--no-series", "--compact"],
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["kind"], doctor.REPORT_KIND)
            self.assertEqual(tree_snapshot(root), before)
            self.assertFalse(any(path.name.endswith("doctor-report.json") for path in root.rglob("*")))


if __name__ == "__main__":
    unittest.main()
