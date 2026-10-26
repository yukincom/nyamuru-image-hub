import hashlib
import importlib.util
import json
from copy import deepcopy
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import tempfile
from threading import Barrier
import unittest
from unittest.mock import patch


BRIDGE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "nyamuru_local_bridge.py"
BRIDGE_SPEC = importlib.util.spec_from_file_location("nyamuru_source_coverage_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(BRIDGE_SPEC)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
sys.modules[BRIDGE_SPEC.name] = bridge
BRIDGE_SPEC.loader.exec_module(bridge)

import nyamuru_episode_workspace as episode_workspace

PACKAGE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "nyamuru_production_package.py"
PACKAGE_SPEC = importlib.util.spec_from_file_location("nyamuru_source_coverage_package", PACKAGE_PATH)
package = importlib.util.module_from_spec(PACKAGE_SPEC)
assert PACKAGE_SPEC and PACKAGE_SPEC.loader
sys.modules[PACKAGE_SPEC.name] = package
PACKAGE_SPEC.loader.exec_module(package)


def seal_analysis(report):
    payload = {
        "source_revision_sha256": report["source"]["source_revision_sha256"],
        "projection_sha256": report["omny"]["projection_sha256"],
        "source_units": report["source_units"],
        "targets": report["targets"],
    }
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    report["analysis_sha256"] = hashlib.sha256(canonical).hexdigest()
    return report


def canonical_sha(value):
    canonical = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def seal_lineage(report):
    source = report["source"]
    source["source_revision_sha256"] = canonical_sha({
        "file_name": source["file_name"],
        "relative_path": source["relative_path"],
        "source_text_sha256": source["source_text_sha256"],
    })
    report["omny"]["projection_sha256"] = canonical_sha({
        "series_id": report["episode"]["series_id"],
        "episode_id": report["episode"]["episode_id"],
        "targets": [{
            "layer": target["layer"],
            "kind": target["kind"],
            "value": target["value"],
            "match_key": target["match_key"],
            "speaker_keys": target["speaker_keys"],
        } for target in report["targets"]],
    })
    return seal_analysis(report)


def valid_report(episode_id="episode-one"):
    source_id = f"source-{'b' * 64}"
    return seal_lineage({
        "schema_name": "nyamuru-source-coverage",
        "schema_version": 1,
        "kind": "source_coverage_report",
        "episode": {
            "series_id": "series-one",
            "episode_id": episode_id,
            "title": "テスト作品",
            "episode_number": "第1話",
        },
        "source": {
            "file_name": "episode.md",
            "relative_path": "origin_data/episode.md",
            "byte_size": 6,
            "line_count": 1,
            "source_text_sha256": "a" * 64,
            "source_revision_sha256": "a" * 64,
        },
        "omny": {
            "omny_revision_sha256": "c" * 64,
            "projection_sha256": "d" * 64,
        },
        "analysis_sha256": "e" * 64,
        "scan_complete": True,
        "verdict": "review_required",
        "summary": {
            "source_units": 1,
            "confirmed": 0,
            "ambiguous": 0,
            "unverified": 1,
            "excluded": 0,
            "context_only": 0,
            "current_decisions": 0,
            "stale_decisions": 0,
            "unresolved_after_review": 1,
        },
        "warnings": [],
        "source_units": [{
            "source_unit_id": source_id,
            "kind": "content",
            "start_line": 1,
            "end_line": 1,
            "excerpt": "未確認",
            "match_text": "未確認",
            "match_key": "未確認",
            "speaker_hint": None,
            "status": "unverified",
            "context_retained": False,
            "candidate_target_ids": [],
            "candidate_total": 0,
        }],
        "targets": [],
        "human_decisions": [],
    })


class SourceCoverageBridgeTest(unittest.TestCase):
    def make_manager(self, root):
        episode = Path(root) / "episode"
        episode.mkdir()
        manager = bridge.EpisodeWorkspaceManager(Path(root) / "workspace-state.json")
        with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
            selected = manager.select(root)
        return episode, manager, selected["workspace_token"]

    def test_saves_content_addressed_report_once_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            report = valid_report()

            first = manager.save_source_coverage(token, "episode-one", report)
            second = manager.save_source_coverage(token, "episode-one", report)

            self.assertTrue(first["created"])
            self.assertFalse(second["created"])
            self.assertEqual(first["relative_path"], second["relative_path"])
            stored = episode / first["relative_path"]
            self.assertTrue(stored.is_file())
            self.assertEqual(stored.stat().st_mode & 0o777, 0o600)
            self.assertEqual(hashlib.sha256(stored.read_bytes()).hexdigest(), first["sha256"])
            self.assertEqual(package._payload_role(first["relative_path"]), "coverage_report")
            self.assertFalse(any(stored.parent.glob("*.tmp")))

    def test_concurrent_identical_save_creates_one_file(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            report = valid_report()
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(
                    lambda _: manager.save_source_coverage(token, "episode-one", report),
                    range(2),
                ))
            self.assertEqual(sorted(result["created"] for result in results), [False, True])
            self.assertEqual(len(list((episode / "name_data" / "coverage").glob("*.json"))), 1)

    def test_independent_managers_racing_first_directory_creation_are_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode = root / "episode"
            episode.mkdir()
            managers = [
                bridge.EpisodeWorkspaceManager(root / f"workspace-state-{index}.json")
                for index in range(2)
            ]
            tokens = []
            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                for manager in managers:
                    tokens.append(manager.select(root)["workspace_token"])

            original_stat = bridge.os.stat
            first_missing_name_data = Barrier(2)

            def synchronize_missing_name_data(path, *args, **kwargs):
                try:
                    return original_stat(path, *args, **kwargs)
                except FileNotFoundError:
                    if path == "name_data" and kwargs.get("dir_fd") is not None:
                        first_missing_name_data.wait(timeout=5)
                    raise

            report = valid_report()
            with patch.object(bridge.os, "stat", side_effect=synchronize_missing_name_data):
                with ThreadPoolExecutor(max_workers=2) as executor:
                    results = list(executor.map(
                        lambda item: item[0].save_source_coverage(item[1], "episode-one", report),
                        zip(managers, tokens),
                    ))

            self.assertEqual(sorted(result["created"] for result in results), [False, True])
            self.assertEqual(len(list((episode / "name_data" / "coverage").glob("*.json"))), 1)

    def test_write_failure_removes_only_the_owned_staging_file(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            original_write = bridge.os.write
            calls = 0

            def fail_after_partial_write(descriptor, data):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return original_write(descriptor, data[:10])
                raise OSError("simulated write failure")

            with patch.object(bridge.os, "write", side_effect=fail_after_partial_write):
                with self.assertRaisesRegex(OSError, "simulated write failure"):
                    manager.save_source_coverage(token, "episode-one", valid_report())

            coverage = episode / "name_data" / "coverage"
            self.assertTrue(coverage.is_dir())
            self.assertEqual(list(coverage.iterdir()), [])
            retried = manager.save_source_coverage(token, "episode-one", valid_report())
            self.assertTrue((episode / retried["relative_path"]).is_file())

    def test_staging_name_swap_does_not_leave_an_attacker_final(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            original_link = bridge.os.link

            def swap_staging_before_link(source, destination, **kwargs):
                source_fd = kwargs["src_dir_fd"]
                bridge.os.unlink(source, dir_fd=source_fd)
                descriptor = bridge.os.open(
                    source,
                    bridge.os.O_WRONLY | bridge.os.O_CREAT | bridge.os.O_EXCL
                    | bridge.os.O_NOFOLLOW | bridge.os.O_CLOEXEC,
                    0o600,
                    dir_fd=source_fd,
                )
                try:
                    bridge.os.write(descriptor, b"ATTACKER")
                finally:
                    bridge.os.close(descriptor)
                return original_link(source, destination, **kwargs)

            with patch.object(bridge.os, "link", side_effect=swap_staging_before_link):
                with self.assertRaisesRegex(OSError, "公開中"):
                    manager.save_source_coverage(token, "episode-one", valid_report())

            coverage = episode / "name_data" / "coverage"
            self.assertEqual(list(coverage.glob("*.json")), [])
            attacker_entries = list(coverage.glob(".source-coverage-*.tmp"))
            self.assertEqual(len(attacker_entries), 1)
            self.assertEqual(attacker_entries[0].read_bytes(), b"ATTACKER")

    def test_coverage_directory_swap_rolls_back_detached_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            original_link = bridge.os.link
            detached = episode / "name_data" / "coverage-detached"

            def swap_directory_before_link(source, destination, **kwargs):
                coverage = episode / "name_data" / "coverage"
                coverage.rename(detached)
                coverage.mkdir()
                return original_link(source, destination, **kwargs)

            with patch.object(bridge.os, "link", side_effect=swap_directory_before_link):
                with self.assertRaisesRegex(ValueError, "差し替え"):
                    manager.save_source_coverage(token, "episode-one", valid_report())

            self.assertEqual(list((episode / "name_data" / "coverage").iterdir()), [])
            self.assertEqual(list(detached.iterdir()), [])

    def test_existing_hash_name_with_different_bytes_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            report = valid_report()
            canonical = json.dumps(
                report, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
            ).encode("utf-8")
            digest = hashlib.sha256(canonical).hexdigest()
            coverage = episode / "name_data" / "coverage"
            coverage.mkdir(parents=True)
            destination = coverage / f"source-coverage-{digest}.json"
            destination.write_bytes(b"different")

            with self.assertRaises(bridge.CoverageReportConflict):
                manager.save_source_coverage(token, "episode-one", report)

            self.assertEqual(destination.read_bytes(), b"different")

    def test_rejects_symlinked_name_data_and_coverage_without_writing_outside(self):
        for symlink_level in ("name_data", "coverage"):
            with self.subTest(symlink_level=symlink_level), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                episode, manager, token = self.make_manager(root)
                outside = root / "outside"
                outside.mkdir()
                if symlink_level == "name_data":
                    (episode / "name_data").symlink_to(outside, target_is_directory=True)
                else:
                    (episode / "name_data").mkdir()
                    (episode / "name_data" / "coverage").symlink_to(outside, target_is_directory=True)

                with self.assertRaises((OSError, ValueError)):
                    manager.save_source_coverage(token, "episode-one", valid_report())

                self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_tampering_unknown_fields_wrong_episode_and_bad_relative_path(self):
        mutations = []
        unknown = valid_report()
        unknown["unexpected"] = True
        mutations.append(unknown)
        wrong_episode = valid_report("different")
        mutations.append(wrong_episode)
        traversal = valid_report()
        traversal["source"]["relative_path"] = "../outside.md"
        mutations.append(traversal)
        bad_summary = valid_report()
        bad_summary["summary"]["confirmed"] = 1
        mutations.append(bad_summary)
        bad_status = valid_report()
        bad_status["source_units"][0]["status"] = "confirmed"
        mutations.append(bad_status)
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            for report in mutations:
                with self.subTest(report=report):
                    with self.assertRaises(ValueError):
                        manager.save_source_coverage(token, "episode-one", report)
            self.assertFalse((episode / "name_data").exists())

    def test_rejects_series_or_source_identity_changed_without_lineage_digest_update(self):
        report = valid_report()
        source_id = report["source_units"][0]["source_unit_id"]
        report["human_decisions"] = [{
            "source_unit_id": source_id,
            "decision": "covered",
            "note": "確認済み",
            "source_revision_sha256": report["source"]["source_revision_sha256"],
            "projection_sha256": report["omny"]["projection_sha256"],
            "stale": False,
        }]
        report["summary"].update({"current_decisions": 1, "unresolved_after_review": 0})
        report["verdict"] = "no_review_required"

        changed_source = deepcopy(report)
        changed_source["source"].update({
            "file_name": "different.md",
            "relative_path": "origin_data/different.md",
        })
        changed_series = deepcopy(report)
        changed_series["episode"]["series_id"] = "different-series"

        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            with self.assertRaisesRegex(ValueError, "source identity"):
                manager.save_source_coverage(token, "episode-one", changed_source)
            with self.assertRaisesRegex(ValueError, "episode identity"):
                manager.save_source_coverage(token, "episode-one", changed_series)
            self.assertFalse((episode / "name_data").exists())

    def test_rejects_changed_analysis_payload_and_context_target_claimed_as_confirmed(self):
        changed_excerpt = valid_report()
        changed_excerpt["source_units"][0]["excerpt"] = "hash更新なしの改変"

        false_confirmed = valid_report()
        context_target_id = f"target-{'f' * 64}"
        false_confirmed["targets"] = [{
            "target_id": context_target_id,
            "layer": "context_retained",
            "kind": "setting_situation",
            "locator": "/manga/setting/situation",
            "value": "未確認",
            "match_key": "未確認",
            "speaker_keys": [],
        }]
        false_confirmed["source_units"][0].update({
            "status": "confirmed",
            "context_retained": False,
            "candidate_target_ids": [context_target_id],
            "candidate_total": 1,
        })
        false_confirmed["summary"].update({
            "confirmed": 1,
            "unverified": 0,
            "unresolved_after_review": 0,
        })
        false_confirmed["verdict"] = "no_review_required"
        seal_lineage(false_confirmed)

        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            with self.assertRaisesRegex(ValueError, "analysis hash"):
                manager.save_source_coverage(token, "episode-one", changed_excerpt)
            with self.assertRaisesRegex(ValueError, "layer"):
                manager.save_source_coverage(token, "episode-one", false_confirmed)
            self.assertFalse((episode / "name_data").exists())

    def test_rejects_report_over_8_mib_before_creating_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            episode, manager, token = self.make_manager(directory)
            report = valid_report()
            report["targets"] = [{
                "target_id": f"target-{index:064x}",
                "layer": "storyboard_evidenced",
                "kind": "panel_action",
                "locator": f"/manga/pages/0/panels/{index}/action",
                "value": "あ" * 5_000,
                "match_key": "あ" * 5_000,
                "speaker_keys": [],
            } for index in range(600)]
            seal_lineage(report)

            with self.assertRaisesRegex(ValueError, "8MiB"):
                manager.save_source_coverage(token, "episode-one", report)

            self.assertFalse((episode / "name_data").exists())

    def test_choose_text_returns_only_relative_identity_for_workspace_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode, manager, token = self.make_manager(root)
            inside = episode / "origin_data" / "episode.md"
            inside.parent.mkdir()
            raw = b"\xef\xbb\xbf" + "# 話\n".encode("utf-8")
            inside.write_bytes(raw)
            outside = root / "outside.md"
            outside.write_text("外部", encoding="utf-8")

            with patch.object(episode_workspace, "choose_workspace_files", return_value=[inside.resolve()]):
                inside_result = manager.choose_text(token)
            with patch.object(episode_workspace, "choose_workspace_files", return_value=[outside.resolve()]):
                outside_result = manager.choose_text(token)

            self.assertEqual(inside_result["relative_path"], "origin_data/episode.md")
            self.assertEqual(inside_result["byte_size"], len(raw))
            self.assertEqual(inside_result["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(inside_result["text"], "# 話\n")
            self.assertIsNone(outside_result["relative_path"])
            self.assertNotIn(str(outside), json.dumps(outside_result, ensure_ascii=False))

    def test_choose_text_rejects_workspace_ancestor_swapped_to_external_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode, manager, token = self.make_manager(root)
            source_directory = episode / "origin_data"
            source_directory.mkdir()
            source = source_directory / "episode.md"
            source.write_text("INSIDE", encoding="utf-8")
            selected_path = source.resolve()
            external_directory = root / "external"
            external_directory.mkdir()
            (external_directory / "episode.md").write_text("OUTSIDE", encoding="utf-8")

            def swap_ancestor(*_args):
                source_directory.rename(episode / "origin_data-original")
                source_directory.symlink_to(external_directory, target_is_directory=True)
                return [selected_path]

            with patch.object(episode_workspace, "choose_workspace_files", side_effect=swap_ancestor):
                with self.assertRaisesRegex(ValueError, "symlink|安全"):
                    manager.choose_text(token)

    def test_choose_text_enforces_utf8_and_exact_five_mib_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode, manager, token = self.make_manager(root)
            source = episode / "boundary.txt"
            source.write_bytes(b"a" * bridge.MAX_WORKSPACE_TEXT_BYTES)
            with patch.object(episode_workspace, "choose_workspace_files", return_value=[source.resolve()]):
                accepted = manager.choose_text(token)
            self.assertEqual(accepted["byte_size"], bridge.MAX_WORKSPACE_TEXT_BYTES)

            source.write_bytes(b"a" * (bridge.MAX_WORKSPACE_TEXT_BYTES + 1))
            with patch.object(episode_workspace, "choose_workspace_files", return_value=[source.resolve()]):
                with self.assertRaisesRegex(ValueError, "5MiB"):
                    manager.choose_text(token)

            source.write_bytes(b"\xff")
            with patch.object(episode_workspace, "choose_workspace_files", return_value=[source.resolve()]):
                with self.assertRaisesRegex(ValueError, "UTF-8"):
                    manager.choose_text(token)

    def test_accepts_actual_cli_report_without_contract_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode, manager, token = self.make_manager(root)
            source = root / "episode.md"
            source.write_text("# SOURCE_A\nSOURCE_TEXT_A\n", encoding="utf-8")
            fixture = (Path(__file__).resolve().parent / "fixtures" / "source-coverage.yaml").read_text(encoding="utf-8")
            omny = root / "story.omny.yaml"
            omny.write_text(fixture.replace('episode_id: "source-coverage-fixture"', 'episode_id: "episode-one"', 1), encoding="utf-8")
            cli = Path(__file__).resolve().parents[1] / "scripts" / "nyamuru_source_coverage.ts"
            result = subprocess.run(
                ["node", "--no-warnings", "--experimental-strip-types", str(cli),
                 "--source", str(source), "--omny", str(omny)],
                check=True, capture_output=True, text=True,
            )
            report = json.loads(result.stdout)

            saved = manager.save_source_coverage(token, "episode-one", report)

            self.assertTrue((episode / saved["relative_path"]).is_file())


if __name__ == "__main__":
    unittest.main()
