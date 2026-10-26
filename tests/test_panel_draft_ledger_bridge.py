import importlib.util
from http.client import BadStatusLine, IncompleteRead
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from PIL import Image
except ImportError:
    Image = None


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
SPEC = importlib.util.spec_from_file_location("nyamuru_local_bridge_panel_draft_ledger", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)

import nyamuru_episode_workspace as episode_workspace


JOB_ID = "11111111-1111-4111-8111-111111111111"
ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
RETRY_ID = "33333333-3333-4333-8333-333333333333"
EPISODE_ID = "44444444-4444-4444-8444-444444444444"


class BrokenJsonResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    @staticmethod
    def read(_maximum):
        return b'{"prompt_id":'


def valid_png(color=(255, 255, 255), *, size=(512, 512)):
    if Image is None:
        raise unittest.SkipTest("Pillowがあるproduction bridge環境で実行する画像境界testです")
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format="PNG")
    return output.getvalue()


def plan():
    return {
        "page_number": 3,
        "panel_id": 2,
        "profile": bridge.PANEL_DRAFT_PROFILE,
        "positive_prompt": "Japanese comic panel, アキとユウが話す",
        "negative_prompt": "extra people, text, speech bubble",
        "checkpoint": bridge.PANEL_DRAFT_CHECKPOINT,
        "width": bridge.PANEL_DRAFT_WIDTH,
        "height": bridge.PANEL_DRAFT_HEIGHT,
        "steps": bridge.PANEL_DRAFT_STEPS,
        "cfg": bridge.PANEL_DRAFT_CFG,
        "seed": bridge.PANEL_DRAFT_SEED,
    }


def generation_body(token):
    return {
        **plan(),
        "workspace_token": token,
        "job_id": JOB_ID,
        "attempt_id": ATTEMPT_ID,
        "retry_of_attempt_id": None,
        "series_id": "series-one",
        "episode_id": EPISODE_ID,
        "omny_snapshot": "manga:\n  meta:\n    episode_id: 4444\n",
    }


class PanelDraftLedgerTest(unittest.TestCase):
    def make_ledger(self, root):
        episode = root / "episode"
        ledger_root = episode / "draft_data" / "nyamuru"
        ledger_root.mkdir(parents=True)
        return bridge.PanelDraftLedger(episode, ledger_root)

    def begin(self, ledger, attempt_id=ATTEMPT_ID, retry_of=None, current_plan=None):
        current_plan = current_plan or plan()
        return ledger.begin_attempt(
            job_id=JOB_ID,
            attempt_id=attempt_id,
            retry_of_attempt_id=retry_of,
            series_id="series-one",
            episode_id=EPISODE_ID,
            page_number=3,
            panel_id=2,
            omny_snapshot="manga:\n  meta: {}\n",
            plan_snapshot=current_plan,
            workflow_snapshot=bridge.ComfyUIDraftGenerator.workflow(current_plan),
        )

    def test_stores_content_addressed_snapshots_outputs_and_resolves_only_verified_composite(self):
        with tempfile.TemporaryDirectory() as directory_name:
            ledger = self.make_ledger(Path(directory_name))
            record, created = self.begin(ledger)
            self.assertTrue(created)
            self.assertEqual(set(record["artifacts"]), {"omny_snapshot", "plan_snapshot", "workflow_snapshot"})
            self.assertTrue(record["artifacts"]["omny_snapshot"]["workspace_relative_path"].endswith(".yaml"))
            self.assertFalse(record["artifacts"]["omny_snapshot"]["workspace_relative_path"].endswith(".omny.yaml"))
            ledger.set_status(ATTEMPT_ID, "queued")
            original_png = valid_png((120, 130, 140))
            composite_png = valid_png((230, 0, 18))
            completed = ledger.complete_success(
                ATTEMPT_ID,
                original_png=original_png,
                manga_base_png=composite_png,
                source_file_name="page_0003_panel_0002_00001_.png",
                source_subfolder="manga_base_drafts",
                download_name="manga-base_page_0003_panel_0002_seed_2026082901.png",
                provenance={"schema_version": 1, "status": "succeeded"},
            )

            self.assertEqual(completed["status"], "succeeded")
            self.assertEqual(
                set(completed["artifacts"]),
                {"omny_snapshot", "plan_snapshot", "workflow_snapshot", "original_comfy_output", "manga_base_composite", "provenance"},
            )
            composite = completed["artifacts"]["manga_base_composite"]
            resolved = ledger.resolve_succeeded_artifact(
                JOB_ID,
                ATTEMPT_ID,
                composite["sha256"],
                expected_omny_sha256=completed["artifacts"]["omny_snapshot"]["sha256"],
                expected_plan_sha256=completed["artifacts"]["plan_snapshot"]["sha256"],
                expected_workflow_sha256=completed["artifacts"]["workflow_snapshot"]["sha256"],
            )
            self.assertEqual(resolved["bytes"], composite_png)
            self.assertEqual(resolved["role"], "manga_base_composite")
            self.assertEqual(
                set(resolved["verified_bundle"]),
                {"omny_snapshot", "plan_snapshot", "workflow_snapshot", "manga_base_composite"},
            )
            with self.assertRaisesRegex(ValueError, "role"):
                ledger.resolve_succeeded_artifact(
                    JOB_ID,
                    ATTEMPT_ID,
                    composite["sha256"],
                    expected_omny_sha256=completed["artifacts"]["omny_snapshot"]["sha256"],
                    expected_plan_sha256=completed["artifacts"]["plan_snapshot"]["sha256"],
                    expected_workflow_sha256=completed["artifacts"]["workflow_snapshot"]["sha256"],
                    role="original_comfy_output",
                )
            with self.assertRaisesRegex(ValueError, "bundle"):
                ledger.resolve_succeeded_artifact(
                    RETRY_ID,
                    ATTEMPT_ID,
                    composite["sha256"],
                    expected_omny_sha256=completed["artifacts"]["omny_snapshot"]["sha256"],
                    expected_plan_sha256=completed["artifacts"]["plan_snapshot"]["sha256"],
                    expected_workflow_sha256=completed["artifacts"]["workflow_snapshot"]["sha256"],
                )
            with self.assertRaisesRegex(ValueError, "bundle"):
                ledger.resolve_succeeded_artifact(
                    JOB_ID,
                    ATTEMPT_ID,
                    composite["sha256"],
                    expected_omny_sha256="f" * 64,
                    expected_plan_sha256=completed["artifacts"]["plan_snapshot"]["sha256"],
                    expected_workflow_sha256=completed["artifacts"]["workflow_snapshot"]["sha256"],
                )

            artifact_path = ledger.episode_root / composite["workspace_relative_path"]
            artifact_path.write_bytes(composite_png + b"tampered")
            with self.assertRaisesRegex(ValueError, "SHA-256|サイズ"):
                ledger.resolve_succeeded_artifact(
                    JOB_ID,
                    ATTEMPT_ID,
                    composite["sha256"],
                    expected_omny_sha256=completed["artifacts"]["omny_snapshot"]["sha256"],
                    expected_plan_sha256=completed["artifacts"]["plan_snapshot"]["sha256"],
                    expected_workflow_sha256=completed["artifacts"]["workflow_snapshot"]["sha256"],
                )

    def test_legacy_yaml_artifact_is_reused_without_rewrite_or_duplicate(self):
        with tempfile.TemporaryDirectory() as directory_name:
            ledger = self.make_ledger(Path(directory_name))
            record, _ = self.begin(ledger)
            artifact = record["artifacts"]["omny_snapshot"]
            current = ledger.episode_root / artifact["workspace_relative_path"]
            legacy = current.with_suffix(".omny.yaml")
            current.rename(legacy)
            with ledger._connect() as connection:
                connection.execute("UPDATE artifacts SET relative_path=? WHERE sha256=?",
                                   (legacy.relative_to(ledger.root).as_posix(), artifact["sha256"]))
            before = legacy.read_bytes(), legacy.stat().st_mtime_ns
            reopened = bridge.PanelDraftLedger(ledger.episode_root, ledger.root)
            repeated, created = self.begin(reopened)
            self.assertFalse(created)
            self.assertTrue(repeated["artifacts"]["omny_snapshot"]["workspace_relative_path"].endswith(".omny.yaml"))
            self.begin(reopened, RETRY_ID, ATTEMPT_ID)
            self.assertEqual(reopened.read_attempt_artifact(RETRY_ID, "omny_snapshot", 1024), before[0])
            self.assertEqual((legacy.read_bytes(), legacy.stat().st_mtime_ns), before)
            self.assertFalse(current.exists())
            legacy.write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "整合性"):
                self.begin(reopened)
            self.assertFalse(current.exists())

    def test_resolver_rejects_artifact_symlink_even_when_it_stays_inside_ledger(self):
        with tempfile.TemporaryDirectory() as directory_name:
            ledger = self.make_ledger(Path(directory_name))
            self.begin(ledger)
            ledger.set_status(ATTEMPT_ID, "queued")
            original_png = valid_png((120, 130, 140))
            composite_png = valid_png((0, 215, 232))
            completed = ledger.complete_success(
                ATTEMPT_ID,
                original_png=original_png,
                manga_base_png=composite_png,
                source_file_name="draft.png",
                source_subfolder="manga_base_drafts",
                download_name="manga-base_draft.png",
                provenance={"schema_version": 1},
            )
            composite = completed["artifacts"]["manga_base_composite"]
            artifact_path = ledger.episode_root / composite["workspace_relative_path"]
            replacement = ledger.root / "replacement.png"
            replacement.write_bytes(composite_png)
            artifact_path.unlink()
            artifact_path.symlink_to(replacement)

            with self.assertRaisesRegex(ValueError, "symlink"):
                ledger.resolve_succeeded_artifact(
                    JOB_ID,
                    ATTEMPT_ID,
                    composite["sha256"],
                    expected_omny_sha256=completed["artifacts"]["omny_snapshot"]["sha256"],
                    expected_plan_sha256=completed["artifacts"]["plan_snapshot"]["sha256"],
                    expected_workflow_sha256=completed["artifacts"]["workflow_snapshot"]["sha256"],
                )

    def test_attempt_is_idempotent_and_retry_requires_new_attempt_with_explicit_parent(self):
        with tempfile.TemporaryDirectory() as directory_name:
            ledger = self.make_ledger(Path(directory_name))
            first, created = self.begin(ledger)
            duplicate, duplicate_created = self.begin(ledger)
            self.assertTrue(created)
            self.assertFalse(duplicate_created)
            self.assertEqual(first["attempt_id"], duplicate["attempt_id"])

            changed = {**plan(), "positive_prompt": "different"}
            with self.assertRaisesRegex(ValueError, "異なる生成内容"):
                self.begin(ledger, current_plan=changed)
            with self.assertRaisesRegex(ValueError, "異なる生成内容"):
                self.begin(ledger, ATTEMPT_ID, RETRY_ID)
            with self.assertRaisesRegex(ValueError, "retry元"):
                self.begin(ledger, RETRY_ID)
            retried, retried_created = self.begin(ledger, RETRY_ID, ATTEMPT_ID)
            self.assertTrue(retried_created)
            self.assertEqual(retried["attempt_number"], 2)
            self.assertEqual(retried["retry_of_attempt_id"], ATTEMPT_ID)

    def test_review_is_append_only_cas_and_requires_verified_success_artifact(self):
        with tempfile.TemporaryDirectory() as directory_name:
            ledger = self.make_ledger(Path(directory_name))
            self.begin(ledger)
            unknown = ledger.set_status(
                ATTEMPT_ID,
                "outcome_unknown",
                error_code="disconnect",
                error_message="connection closed",
                provenance={"schema_version": 1, "status": "outcome_unknown"},
            )
            self.assertEqual(unknown["status"], "outcome_unknown")
            self.assertEqual(unknown["review"]["decision"], "unreviewed")
            with self.assertRaisesRegex(ValueError, "成功済み"):
                ledger.set_review(
                    ATTEMPT_ID,
                    "rejected",
                    expected_revision_value=0,
                    request_nonce_value="55555555-5555-4555-8555-555555555555",
                    artifact_sha256_value="a" * 64,
                    note_value="構図を見直す",
                )

            ledger.set_status(ATTEMPT_ID, "queued")
            completed = ledger.complete_success(
                ATTEMPT_ID,
                original_png=valid_png((100, 100, 100)),
                manga_base_png=valid_png((255, 255, 255)),
                source_file_name="draft.png",
                source_subfolder="manga_base_drafts",
                download_name="manga-base_draft.png",
                provenance={"schema_version": 2},
            )
            composite_sha = completed["artifacts"]["manga_base_composite"]["sha256"]
            first_nonce = "55555555-5555-4555-8555-555555555555"
            reviewed = ledger.set_review(
                ATTEMPT_ID,
                "rejected",
                expected_revision_value=0,
                request_nonce_value=first_nonce,
                artifact_sha256_value=composite_sha,
                note_value="構図を見直す",
            )
            self.assertEqual(reviewed["status"], "succeeded")
            self.assertEqual(reviewed["review"]["decision"], "rejected")
            self.assertEqual(reviewed["review"]["revision"], 1)
            duplicate = ledger.set_review(
                ATTEMPT_ID,
                "rejected",
                expected_revision_value=0,
                request_nonce_value=first_nonce,
                artifact_sha256_value=composite_sha,
                note_value="構図を見直す",
            )
            self.assertEqual(duplicate["review"]["revision"], 1)
            with self.assertRaisesRegex(ValueError, "更新"):
                ledger.set_review(
                    ATTEMPT_ID,
                    "accepted",
                    expected_revision_value=0,
                    request_nonce_value="66666666-6666-4666-8666-666666666666",
                    artifact_sha256_value=composite_sha,
                )
            accepted = ledger.set_review(
                ATTEMPT_ID,
                "accepted",
                expected_revision_value=1,
                request_nonce_value="77777777-7777-4777-8777-777777777777",
                artifact_sha256_value=composite_sha,
            )
            self.assertEqual(accepted["review"]["revision"], 2)
            self.assertEqual(accepted["review"]["decision"], "accepted")
            with ledger._connect() as connection:
                events = connection.execute(
                    "SELECT revision,decision FROM review_events WHERE attempt_id=? ORDER BY revision", (ATTEMPT_ID,)
                ).fetchall()
                with self.assertRaisesRegex(bridge.sqlite3.IntegrityError, "append-only"):
                    connection.execute("UPDATE review_events SET note='rewrite' WHERE attempt_id=?", (ATTEMPT_ID,))
            self.assertEqual([(row["revision"], row["decision"]) for row in events], [(1, "rejected"), (2, "accepted")])

    def test_rejects_oversized_artifact_and_workspace_symlink_escape(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            ledger = self.make_ledger(root)
            with self.assertRaisesRegex(ValueError, "保存上限"):
                ledger.write_artifact(b"x" * 11, ".json", "application/json", 10)

            episode = root / "other-episode"
            outside = root / "outside"
            episode.mkdir()
            outside.mkdir()
            (episode / "draft_data").symlink_to(outside, target_is_directory=True)
            manager = bridge.EpisodeWorkspaceManager(root / "workspaces.json")
            manager.directories["safe_token_123456789012345678901234"] = episode
            with self.assertRaisesRegex(ValueError, "symlink|外側"):
                manager.ledger_root("safe_token_123456789012345678901234")

    def test_status_audit_keeps_immutable_provenance_sha_and_full_sanitized_error(self):
        with tempfile.TemporaryDirectory() as directory_name:
            ledger = self.make_ledger(Path(directory_name))
            self.begin(ledger)
            long_detail = "x" * 700
            raw_error = f"{ledger.episode_root}/private/file.png {long_detail}"
            record = ledger.set_status(
                ATTEMPT_ID,
                "outcome_unknown",
                error_code="disconnect",
                error_message=raw_error,
                provenance={"schema_version": 2, "executor": {"engine": "ComfyUI"}},
            )
            self.assertEqual(len(record["audit_events"]), 2)
            event = record["audit_events"][-1]
            self.assertEqual(event["error_message"], f"<local-path>/private/file.png {long_detail}")
            self.assertGreater(len(event["error_message"]), 500)
            self.assertEqual(event["provenance_sha256"], event["provenance"]["sha256"])
            raw = ledger.read_attempt_artifact(ATTEMPT_ID, "provenance", bridge.MAX_PANEL_DRAFT_SNAPSHOT_BYTES)
            provenance = json.loads(raw)
            self.assertEqual(provenance["status"], "outcome_unknown")
            self.assertEqual(provenance["error"]["message"], event["error_message"])
            with ledger._connect() as connection:
                with self.assertRaisesRegex(bridge.sqlite3.IntegrityError, "append-only"):
                    connection.execute(
                        "UPDATE status_events SET error_message='rewrite' WHERE event_id=?", (event["event_id"],)
                    )

    def test_rejects_symlinked_sqlite_database(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = root / "episode"
            ledger_root = episode / "draft_data" / "nyamuru"
            ledger_root.mkdir(parents=True)
            outside = root / "outside.sqlite3"
            outside.write_bytes(b"not a database")
            (ledger_root / "ledger.sqlite3").symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "database"):
                bridge.PanelDraftLedger(episode, ledger_root)

    def test_migrates_candidate_v1_schema_to_append_only_v2(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = root / "episode"
            ledger_root = episode / "draft_data" / "nyamuru"
            ledger_root.mkdir(parents=True)
            database = ledger_root / "ledger.sqlite3"
            with bridge.sqlite3.connect(database) as connection:
                connection.executescript(
                    """
                    CREATE TABLE jobs(job_id TEXT PRIMARY KEY,series_id TEXT NOT NULL,episode_id TEXT NOT NULL,
                        page_number INTEGER NOT NULL,panel_id INTEGER NOT NULL,created_at TEXT NOT NULL);
                    CREATE TABLE attempts(attempt_id TEXT PRIMARY KEY,job_id TEXT NOT NULL,attempt_number INTEGER NOT NULL,
                        retry_of_attempt_id TEXT,status TEXT NOT NULL,prompt_id TEXT NOT NULL,created_at TEXT NOT NULL,
                        submitted_at TEXT,finished_at TEXT,source_file_name TEXT,source_subfolder TEXT,download_name TEXT,
                        error_code TEXT,error_message TEXT);
                    CREATE TABLE status_events(event_id INTEGER PRIMARY KEY AUTOINCREMENT,attempt_id TEXT NOT NULL,
                        status TEXT NOT NULL,recorded_at TEXT NOT NULL,detail_json TEXT NOT NULL);
                    CREATE TABLE reviews(attempt_id TEXT PRIMARY KEY,decision TEXT NOT NULL,note TEXT NOT NULL,reviewed_at TEXT);
                    CREATE TABLE artifacts(sha256 TEXT PRIMARY KEY,relative_path TEXT NOT NULL UNIQUE,byte_size INTEGER NOT NULL,
                        media_type TEXT NOT NULL,created_at TEXT NOT NULL);
                    CREATE TABLE attempt_artifacts(attempt_id TEXT NOT NULL,role TEXT NOT NULL,sha256 TEXT NOT NULL,
                        PRIMARY KEY(attempt_id,role));
                    PRAGMA user_version=1;
                    """
                )
                connection.execute(
                    "INSERT INTO jobs(job_id,series_id,episode_id,page_number,panel_id,created_at) VALUES(?,?,?,?,?,?)",
                    (JOB_ID, "series-one", EPISODE_ID, 3, 2, "2026-09-01T00:00:00+00:00"),
                )
                connection.execute(
                    """INSERT INTO attempts(
                           attempt_id,job_id,attempt_number,retry_of_attempt_id,status,prompt_id,created_at
                       ) VALUES(?,?,?,?,?,?,?)""",
                    (ATTEMPT_ID, JOB_ID, 1, None, "created", ATTEMPT_ID, "2026-09-01T00:00:00+00:00"),
                )
                connection.execute(
                    "INSERT INTO status_events(attempt_id,status,recorded_at,detail_json) VALUES(?,?,?,?)",
                    (ATTEMPT_ID, "created", "2026-09-01T00:00:00+00:00", "{}"),
                )
                connection.execute(
                    "INSERT INTO reviews(attempt_id,decision,note,reviewed_at) VALUES(?,?,?,?)",
                    (ATTEMPT_ID, "accepted", "legacy mutable review", "2026-09-01T00:01:00+00:00"),
                )
            ledger = bridge.PanelDraftLedger(episode, ledger_root)
            with ledger._connect() as connection:
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 2)
                columns = {row["name"] for row in connection.execute("PRAGMA table_info(status_events)")}
                self.assertTrue({"provenance_sha256", "error_message"}.issubset(columns))
                table = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='review_events'"
                ).fetchone()
                self.assertIsNotNone(table)
            migrated = ledger.attempt(ATTEMPT_ID)
            self.assertEqual(migrated["review"]["decision"], "unreviewed")
            self.assertEqual(len(migrated["audit_events"]), 1)
            self.assertTrue(migrated["audit_events"][0]["provenance_verified"])


class PanelDraftJobServiceTest(unittest.TestCase):
    def make_service(self, root):
        episode = root / "episode"
        episode.mkdir()
        manager = bridge.EpisodeWorkspaceManager(root / "workspaces.json")
        with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
            selected = manager.select(root)
        manager.prepare(selected["workspace_token"])
        generator = bridge.ComfyUIDraftGenerator(
            "http://127.0.0.1:8188", checkpoint_root=root / "missing-checkpoints",
        )
        return bridge.PanelDraftJobService(manager, generator), selected["workspace_token"]

    def test_uses_caller_attempt_as_comfy_prompt_and_does_not_submit_duplicate(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            image_info = {"filename": "page_0003_panel_0002_00001_.png", "subfolder": "manga_base_drafts", "type": "output"}
            with patch.object(service.generator, "submit", return_value=ATTEMPT_ID) as submit, patch.object(
                service.generator, "wait_for_image", return_value=image_info
            ), patch.object(service.generator, "fetch_image", return_value=valid_png((100, 110, 120))), patch.object(
                service.generator, "manga_base_png", return_value=valid_png((230, 0, 18))
            ):
                result = service.generate(generation_body(token))
                duplicate = service.generate(generation_body(token))

            submit.assert_called_once()
            self.assertEqual(submit.call_args.args[1], ATTEMPT_ID)
            self.assertEqual(result["attempt_id"], ATTEMPT_ID)
            self.assertEqual(result["prompt_id"], ATTEMPT_ID)
            self.assertEqual(duplicate["artifacts"]["manga_base_composite"]["sha256"], result["artifacts"]["manga_base_composite"]["sha256"])
            stored = service.ledger(token).attempt(ATTEMPT_ID)
            success_event = stored["audit_events"][-1]
            provenance_raw = service.ledger(token).read_attempt_artifact(
                ATTEMPT_ID, "provenance", bridge.MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
            )
            provenance = json.loads(provenance_raw)
            self.assertEqual(success_event["provenance_sha256"], stored["artifacts"]["provenance"]["sha256"])
            self.assertEqual(provenance["conversion"]["version"], bridge.MANGA_BASE_TRANSFORM_VERSION)
            self.assertEqual(provenance["conversion"]["palette"], bridge.MANGA_BASE_PALETTE)
            self.assertEqual(provenance["executor"]["bridge"]["panel_draft_version"], bridge.PANEL_DRAFT_BRIDGE_VERSION)
            self.assertEqual(provenance["model"]["checkpoint"]["verification"], "unverified_name_only")
            self.assertEqual(provenance["comfy_output"]["filename"], image_info["filename"])

    def test_recovers_created_attempt_when_same_prompt_history_has_verified_output(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            service, token = self.make_service(root)
            with patch.object(service.generator, "submit", return_value=ATTEMPT_ID), patch.object(
                bridge.PanelDraftLedger, "set_status", side_effect=SystemExit("crash after submit")
            ):
                with self.assertRaisesRegex(SystemExit, "crash after submit"):
                    service.generate(generation_body(token))

            created = service.ledger(token).attempt(ATTEMPT_ID)
            self.assertEqual(created["status"], "created")

            restarted = bridge.PanelDraftJobService(
                bridge.EpisodeWorkspaceManager(root / "workspaces.json"),
                bridge.ComfyUIDraftGenerator(
                    "http://127.0.0.1:8188", checkpoint_root=root / "missing-checkpoints",
                ),
            )
            image_info = {
                "filename": "page_0003_panel_0002_00001_.png",
                "subfolder": "manga_base_drafts",
                "type": "output",
            }
            with patch.object(restarted.generator, "history_image", return_value=image_info), patch.object(
                restarted.generator, "fetch_image", return_value=valid_png((100, 110, 120))
            ), patch.object(restarted.generator, "manga_base_png", return_value=valid_png((255, 255, 255))):
                result = restarted.reconcile({"workspace_token": token, "attempt_id": ATTEMPT_ID})

            self.assertEqual(result["status"], "succeeded")
            recovered = restarted.ledger(token).attempt(ATTEMPT_ID)
            self.assertIsNotNone(recovered["submitted_at"])
            provenance = json.loads(restarted.ledger(token).read_attempt_artifact(
                ATTEMPT_ID, "provenance", bridge.MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
            ))
            self.assertEqual(provenance["recovery"], {
                "from_status": "created",
                "evidence": "comfyui_history_output_for_same_prompt_id",
            })

    def test_broken_prompt_response_is_unknown_not_failed(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            with patch.object(bridge.urllib_request, "urlopen", return_value=BrokenJsonResponse()):
                with self.assertRaisesRegex(bridge.ComfyUIObservationUnavailable, "JSON"):
                    service.generate(generation_body(token))

            record = service.ledger(token).attempt(ATTEMPT_ID)
            self.assertEqual(record["status"], "outcome_unknown")
            self.assertEqual(record["error"]["code"], "submit_outcome_unknown")
            self.assertNotEqual(record["status"], "failed")

    def test_broken_history_during_generate_is_unknown_not_failed(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            with patch.object(service.generator, "submit", return_value=ATTEMPT_ID), patch.object(
                bridge.urllib_request, "urlopen", return_value=BrokenJsonResponse()
            ):
                with self.assertRaisesRegex(bridge.ComfyUIObservationUnavailable, "JSON"):
                    service.generate(generation_body(token))

            record = service.ledger(token).attempt(ATTEMPT_ID)
            self.assertEqual(record["status"], "outcome_unknown")
            self.assertEqual(record["error"]["code"], "execution_outcome_unknown")
            self.assertNotEqual(record["status"], "failed")

    def test_broken_http_transport_during_generate_is_unknown_not_failed(self):
        transport_errors = (
            BadStatusLine("broken status line"),
            IncompleteRead(b"partial", 10),
        )
        for error in transport_errors:
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as directory_name:
                service, token = self.make_service(Path(directory_name))
                with patch.object(service.generator, "submit", return_value=ATTEMPT_ID), patch.object(
                    bridge.urllib_request, "urlopen", side_effect=error
                ):
                    with self.assertRaises(bridge.ComfyUIObservationUnavailable):
                        service.generate(generation_body(token))

                record = service.ledger(token).attempt(ATTEMPT_ID)
                self.assertEqual(record["status"], "outcome_unknown")
                self.assertEqual(record["error"]["code"], "execution_outcome_unknown")
                self.assertNotEqual(record["status"], "failed")

    def test_broken_history_during_reconcile_remains_unknown(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            with patch.object(service.generator, "submit", side_effect=bridge.ComfyUIUnavailable("disconnect")):
                with self.assertRaises(bridge.ComfyUIUnavailable):
                    service.generate(generation_body(token))
            with patch.object(bridge.urllib_request, "urlopen", return_value=BrokenJsonResponse()):
                with self.assertRaisesRegex(bridge.ComfyUIObservationUnavailable, "JSON"):
                    service.reconcile({"workspace_token": token, "attempt_id": ATTEMPT_ID})

            record = service.ledger(token).attempt(ATTEMPT_ID)
            self.assertEqual(record["status"], "outcome_unknown")
            self.assertEqual(record["error"]["code"], "reconcile_unavailable")
            self.assertNotEqual(record["status"], "failed")

    def test_queue_http_error_during_reconcile_remains_unknown(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            with patch.object(service.generator, "submit", side_effect=bridge.ComfyUIUnavailable("disconnect")):
                with self.assertRaises(bridge.ComfyUIUnavailable):
                    service.generate(generation_body(token))
            queue_error = bridge.HTTPError(
                "http://127.0.0.1:8188/queue",
                503,
                "Service Unavailable",
                None,
                None,
            )
            with patch.object(service.generator, "history_image", return_value=None), patch.object(
                bridge.urllib_request, "urlopen", side_effect=queue_error
            ):
                with self.assertRaisesRegex(bridge.ComfyUIObservationUnavailable, "HTTP 503"):
                    service.reconcile({"workspace_token": token, "attempt_id": ATTEMPT_ID})

            record = service.ledger(token).attempt(ATTEMPT_ID)
            self.assertEqual(record["status"], "outcome_unknown")
            self.assertEqual(record["error"]["code"], "reconcile_unavailable")
            self.assertNotEqual(record["status"], "failed")

    def test_timeout_is_unknown_and_restart_reconciles_from_comfy_history_without_retry(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            service, token = self.make_service(root)
            with patch.object(service.generator, "submit", return_value=ATTEMPT_ID), patch.object(
                service.generator, "wait_for_image", side_effect=bridge.ComfyUIUnavailable("timeout")
            ):
                with self.assertRaises(bridge.ComfyUIUnavailable):
                    service.generate(generation_body(token))

            first_record = service.ledger(token).attempt(ATTEMPT_ID)
            self.assertEqual(first_record["status"], "outcome_unknown")

            restarted_manager = bridge.EpisodeWorkspaceManager(root / "workspaces.json")
            restarted = bridge.PanelDraftJobService(
                restarted_manager,
                bridge.ComfyUIDraftGenerator(
                    "http://127.0.0.1:8188", checkpoint_root=root / "missing-checkpoints",
                ),
            )
            image_info = {"filename": "page_0003_panel_0002_00001_.png", "subfolder": "manga_base_drafts", "type": "output"}
            with patch.object(restarted.generator, "history_image", return_value=image_info), patch.object(
                restarted.generator, "fetch_image", return_value=valid_png((100, 110, 120))
            ), patch.object(restarted.generator, "manga_base_png", return_value=valid_png((0, 215, 232))):
                result = restarted.reconcile({"workspace_token": token, "attempt_id": ATTEMPT_ID})

            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(result["attempt_id"], ATTEMPT_ID)

    def test_reconcile_keeps_unknown_when_attempt_is_absent_from_queue_and_history(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            with patch.object(service.generator, "submit", side_effect=bridge.ComfyUIUnavailable("disconnect")):
                with self.assertRaises(bridge.ComfyUIUnavailable):
                    service.generate(generation_body(token))
            with patch.object(service.generator, "history_image", return_value=None), patch.object(
                service.generator, "queue_contains", return_value=False
            ):
                result = service.reconcile({"workspace_token": token, "attempt_id": ATTEMPT_ID})
            self.assertEqual(result["attempt"]["status"], "outcome_unknown")

    def test_reconcile_marks_history_record_without_output_as_failed_not_unknown(self):
        with tempfile.TemporaryDirectory() as directory_name:
            service, token = self.make_service(Path(directory_name))
            with patch.object(service.generator, "submit", side_effect=bridge.ComfyUIUnavailable("disconnect")):
                with self.assertRaises(bridge.ComfyUIUnavailable):
                    service.generate(generation_body(token))
            with patch.object(
                service.generator,
                "json_request",
                return_value={ATTEMPT_ID: {"status": {"status_str": "success"}, "outputs": {}}},
            ):
                result = service.reconcile({"workspace_token": token, "attempt_id": ATTEMPT_ID})
            self.assertEqual(result["attempt"]["status"], "failed")
            self.assertEqual(result["attempt"]["error"]["code"], "comfyui_execution_failed")


class PanelDraftBoundaryTest(unittest.TestCase):
    def test_rejects_non_loopback_bridge_bind(self):
        self.assertEqual(bridge.checked_loopback_bind_host("127.0.0.1"), "127.0.0.1")
        self.assertEqual(bridge.checked_loopback_bind_host("::1"), "::1")
        with self.assertRaisesRegex(ValueError, "loopback"):
            bridge.checked_loopback_bind_host("0.0.0.0")
        with self.assertRaisesRegex(ValueError, "loopback"):
            bridge.checked_loopback_bind_host("192.168.1.10")

    def test_rejects_invalid_png_and_unsafe_comfy_output_paths(self):
        with self.assertRaisesRegex(ValueError, "PNG"):
            bridge.ComfyUIDraftGenerator.validate_png_bytes(b"not a png")
        with self.assertRaisesRegex(ValueError, "サイズ"):
            bridge.ComfyUIDraftGenerator.validate_png_bytes(valid_png(size=(32, 32)))
        with self.assertRaisesRegex(ValueError, "IEND|末尾"):
            bridge.ComfyUIDraftGenerator.validate_png_bytes(valid_png() + b"trailing payload")
        with self.assertRaisesRegex(ValueError, "パレット外"):
            bridge.ComfyUIDraftGenerator.validate_png_bytes(
                valid_png((1, 2, 3)), require_manga_base=True,
            )
        prompt_id = ATTEMPT_ID
        unsafe = {
            prompt_id: {"outputs": {"7": {"images": [{"filename": "../escape.png", "subfolder": "", "type": "output"}]}}}
        }
        with self.assertRaisesRegex(ValueError, "安全"):
            bridge.ComfyUIDraftGenerator.output_image(unsafe, prompt_id)
        with self.assertRaisesRegex(RuntimeError, "生成画像|出力PNG"):
            bridge.ComfyUIDraftGenerator.output_image({prompt_id: {"outputs": {}}}, prompt_id)

    def test_checkpoint_identity_hashes_safe_file_and_marks_missing_name_unverified(self):
        with tempfile.TemporaryDirectory() as directory_name:
            checkpoint_root = Path(directory_name)
            checkpoint = checkpoint_root / bridge.PANEL_DRAFT_CHECKPOINT
            checkpoint.write_bytes(b"checkpoint-fixture")
            generator = bridge.ComfyUIDraftGenerator(
                "http://127.0.0.1:8188", checkpoint_root=checkpoint_root,
            )
            verified = generator.checkpoint_identity(bridge.PANEL_DRAFT_CHECKPOINT)
            self.assertEqual(verified["verification"], "sha256_verified")
            self.assertEqual(verified["byte_size"], len(b"checkpoint-fixture"))
            self.assertEqual(verified["sha256"], bridge.hashlib.sha256(b"checkpoint-fixture").hexdigest())

            missing = bridge.ComfyUIDraftGenerator(
                "http://127.0.0.1:8188", checkpoint_root=checkpoint_root / "missing",
            ).checkpoint_identity(bridge.PANEL_DRAFT_CHECKPOINT)
            self.assertEqual(missing["verification"], "unverified_name_only")
            self.assertIn("unverified_reason", missing)


if __name__ == "__main__":
    unittest.main()
