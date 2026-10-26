import importlib.util
import base64
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

try:
    from PIL import Image
except ImportError:
    Image = None


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
SPEC = importlib.util.spec_from_file_location("nyamuru_local_bridge", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)
import nyamuru_vision_state as vision_state

import nyamuru_layout_geometry as layout_geometry
import nyamuru_scanner_sessions as scanner_sessions
import nyamuru_series_catalog_store as series_catalog_store


def valid_panel_draft_png(color=(255, 255, 255)):
    if Image is None:
        raise unittest.SkipTest("Pillowがあるproduction bridge環境で実行する画像境界testです")
    output = io.BytesIO()
    Image.new("RGB", (bridge.PANEL_DRAFT_WIDTH, bridge.PANEL_DRAFT_HEIGHT), color).save(output, format="PNG")
    return output.getvalue()

class ScannerSessionsTest(unittest.TestCase):
    def test_decodes_cocoa_unicode_escape_in_document_name(self):
        completed = type("Completed", (), {"stdout": r"\u30b9\u30ad\u30e3\u30f3" + "\n"})()
        with patch.object(bridge.subprocess, "run", return_value=completed):
            self.assertEqual(bridge.image_capture_preference("IK_documentName", "scan"), "スキャン")

    def test_quits_image_capture_by_bundle_identifier(self):
        with patch.object(bridge.subprocess, "run") as run:
            bridge.quit_image_capture()

        run.assert_called_once_with(
            [
                "/usr/bin/osascript",
                "-e",
                'if application id "com.apple.Image_Capture" is running then tell application id "com.apple.Image_Capture" to quit',
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_keeps_scans_until_human_commit_and_deletes_only_then(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            old_scan = directory / "スキャン.jpeg"
            old_scan.write_bytes(b"old")
            manager = bridge.ScannerSessions(directory / "scanner-state.json")
            with (
                patch.object(scanner_sessions, "scanner_destination", return_value=directory),
                patch.object(scanner_sessions, "scanner_document_prefix", return_value="スキャン"),
                patch.object(scanner_sessions, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
                patch.object(scanner_sessions, "SCANNER_STABLE_SECONDS", 0),
            ):
                session = manager.start()
                new_scan = directory / "スキャン 1.jpeg"
                new_scan.write_bytes(b"new")
                unrelated = directory / "vacation.jpeg"
                unrelated.write_bytes(b"keep")

                self.assertEqual(manager.collect(session["session_id"])["files"], [])
                batch = manager.collect(session["session_id"])
                self.assertEqual([item["filename"] for item in batch["files"]], ["スキャン 1.jpeg"])
                self.assertTrue(new_scan.exists())

                self.assertEqual(manager.finish(session["session_id"]), {"ok": True, "retained": ["スキャン 1.jpeg"]})
                self.assertTrue(new_scan.exists())
                result = manager.commit(session["session_id"])
                self.assertEqual(result, {"deleted": 1, "errors": []})
                self.assertFalse(new_scan.exists())
                self.assertTrue(old_scan.exists())
                self.assertTrue(unrelated.exists())
                self.assertIsNone(manager.active)

    def test_explicit_cancel_deletes_scan_source(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            manager = bridge.ScannerSessions(directory / "scanner-state.json")
            with (
                patch.object(scanner_sessions, "scanner_destination", return_value=directory),
                patch.object(scanner_sessions, "scanner_document_prefix", return_value="scan"),
                patch.object(scanner_sessions, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
                patch.object(scanner_sessions, "SCANNER_STABLE_SECONDS", 0),
            ):
                session = manager.start()
                source = directory / "scan 1.jpg"
                source.write_bytes(b"source")
                manager.collect(session["session_id"])
                self.assertEqual(len(manager.collect(session["session_id"])["files"]), 1)
                result = manager.cancel(session["session_id"])
                self.assertEqual(result, {"deleted": 1, "errors": []})
                self.assertFalse(source.exists())
                self.assertIsNone(manager.active)

    def test_recovers_scan_after_forced_restart_without_deleting_it(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            state_path = directory / "scanner-state.json"
            with (
                patch.object(scanner_sessions, "scanner_destination", return_value=directory),
                patch.object(scanner_sessions, "scanner_document_prefix", return_value="scan"),
                patch.object(scanner_sessions, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
            ):
                first_manager = bridge.ScannerSessions(state_path)
                first_manager.start()
                source = directory / "scan 1.jpg"
                source.write_bytes(b"source")

                restarted_manager = bridge.ScannerSessions(state_path)
                pending = restarted_manager.pending()
                self.assertTrue(pending["pending"])
                self.assertEqual(pending["count"], 1)
                self.assertTrue(source.exists())

                resumed = restarted_manager.resume()
                self.assertEqual([item["filename"] for item in resumed["files"]], ["scan 1.jpg"])
                self.assertTrue(source.exists())
                restarted_manager.commit(resumed["session_id"])
                self.assertFalse(source.exists())
                self.assertFalse(state_path.exists())

    def test_caps_one_session_at_ten_files(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            manager = bridge.ScannerSessions(directory / "scanner-state.json")
            with (
                patch.object(scanner_sessions, "scanner_destination", return_value=directory),
                patch.object(scanner_sessions, "scanner_document_prefix", return_value="scan"),
                patch.object(scanner_sessions, "scanner_preview", return_value=("image/jpeg", "cHJldmlldw==")),
                patch.object(scanner_sessions, "SCANNER_STABLE_SECONDS", 0),
            ):
                session = manager.start()
                for index in range(12):
                    (directory / f"scan {index:02}.jpg").write_bytes(str(index).encode())
                manager.collect(session["session_id"])
                batch = manager.collect(session["session_id"])
                self.assertEqual(len(batch["files"]), 10)
                self.assertTrue(batch["complete"])
                self.assertEqual(batch["total"], 10)
                result = manager.cancel(session["session_id"])
                self.assertEqual(result, {"deleted": 10, "errors": []})
                self.assertTrue((directory / "scan 10.jpg").exists())
                self.assertTrue((directory / "scan 11.jpg").exists())


class SeriesCatalogStoreTest(unittest.TestCase):
    PNG = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )

    def test_saves_catalog_in_stable_id_folder_and_loads_it_by_name(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            saved = store.save("ねこ漫画", "", "manga:\n  materials: []\n", "")

            self.assertRegex(saved["series_id"], bridge.SERIES_ID_PATTERN)
            catalog_dir = Path(saved["directory"])
            self.assertTrue((catalog_dir / "series.omny.yaml").exists())
            loaded = store.load("ねこ漫画", "")
            self.assertTrue(loaded["found"])
            self.assertEqual(loaded["series_id"], saved["series_id"])
            self.assertIn("materials", loaded["omny_yaml"])

    def test_renaming_series_keeps_the_same_internal_id(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            first = store.save("仮題", "series-123", "manga:\n  materials: []\n", "")
            second = store.save("正式タイトル", first["series_id"], "manga:\n  materials: []\n", first["revision"])

            self.assertEqual(second["series_id"], "series-123")
            self.assertFalse(store.load("仮題", "")["found"])
            self.assertTrue(store.load("正式タイトル", "")["found"])

    def test_unchanged_save_keeps_bytes_timestamps_and_reference_after_validation(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            refs = root / "references"
            refs.mkdir()
            text = refs / "characters.md"
            text.write_text("登場人物", encoding="utf-8")
            store = bridge.SeriesCatalogStore(root / "catalogs")
            source = "manga:\n  materials: []\n"
            saved = store.save("猫の旅", "series-one", source, "", str(refs), text.name)
            metadata = store.metadata_for("series-one")
            metadata["character_text_reference"]["relinked_at"] = "existing relink history"
            store.write_metadata("series-one", metadata)
            folder = Path(saved["directory"])
            before = {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in folder.iterdir()}
            with patch.object(series_catalog_store.tempfile, "NamedTemporaryFile", side_effect=AssertionError("no write")):
                repeated = store.save("猫の旅", "series-one", source, saved["revision"], str(refs), text.name)
                self.assertEqual(repeated, saved)
                with self.assertRaises(bridge.SeriesCatalogConflict):
                    store.save("猫の旅", "series-one", source, "")
                with self.assertRaisesRegex(ValueError, "見つかりません"):
                    store.save("猫の旅", "series-one", source, saved["revision"], str(refs), "missing.md")
            self.assertEqual(before, {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in folder.iterdir()})
            reference = store.metadata_for("series-one")["character_text_reference"]
            changed = refs / "new.md"
            changed.write_text("追加資料", encoding="utf-8")
            updated = store.save("猫の旅", "series-one", source, saved["revision"], str(refs), changed.name)
            next_reference = store.metadata_for("series-one")["character_text_reference"]
            self.assertEqual(updated["revision"], saved["revision"])
            self.assertEqual(next_reference["reference_id"], reference["reference_id"])
            self.assertEqual(next_reference["relative_path"], changed.name)
            self.assertNotEqual(next_reference["linked_at"], reference["linked_at"])
            store.save("猫の冒険", "series-one", source, saved["revision"])
            self.assertTrue(store.load("猫の冒険", "")["found"])

    def test_unknown_id_reuses_same_named_series(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            first = store.save("猫の旅", "series-123", "manga:\n  title: first\n", "")
            recovered = store.save("猫の旅", "offline-created-id", "manga:\n  title: second\n", first["revision"])

            self.assertEqual(recovered["series_id"], first["series_id"])
            self.assertFalse((Path(directory_name) / "offline-created-id").exists())
            self.assertIn("second", store.load("猫の旅", "")["omny_yaml"])

    def test_existing_series_cannot_be_renamed_to_another_catalog_name(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            first = store.save("猫の旅", "series-one", "manga:\n  title: cats\n", "")
            store.save("犬の旅", "series-two", "manga:\n  title: dogs\n", "")

            with self.assertRaisesRegex(bridge.SeriesCatalogConflict, "別シリーズ台帳"):
                store.save("犬の旅", first["series_id"], "manga:\n  title: wrong\n", first["revision"])

            self.assertIn("cats", store.load("猫の旅", "series-one")["omny_yaml"])

    def test_stale_revision_cannot_overwrite_a_newer_catalog(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            first = store.save("猫の旅", "series-123", "manga:\n  title: first\n", "")
            stale_revision = store.load("猫の旅", "")["revision"]
            newer = store.save("猫の旅", first["series_id"], "manga:\n  title: newer\n", stale_revision)

            with self.assertRaisesRegex(bridge.SeriesCatalogConflict, "別の画面または話"):
                store.save("猫の旅", first["series_id"], "manga:\n  title: stale\n", stale_revision)

            loaded = store.load("猫の旅", "")
            self.assertEqual(loaded["revision"], newer["revision"])
            self.assertIn("newer", loaded["omny_yaml"])

    def test_rejects_path_like_series_id(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            with self.assertRaisesRegex(ValueError, "内部ID"):
                store.save("作品", "../outside", "manga:\n  materials: []\n", "")

    def test_lists_saved_catalogs_without_incomplete_directories(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            first = store.save("猫の旅", "series-one", "manga:\n  materials: []\n", "")
            (root / "incomplete").mkdir()
            (root / "incomplete" / "catalog.json").write_text(
                json.dumps({"series_name": "未完成"}), encoding="utf-8"
            )

            listed = store.list_catalogs()["series"]
            self.assertEqual([(item["series_id"], item["series_name"]) for item in listed], [(first["series_id"], "猫の旅")])

    def test_discards_unsaved_new_series_with_its_character_images(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            source = 'manga:\n  meta:\n    episode_id: "episode-one"\n'
            store.save("仮シリーズ", "series-one", source, "")
            store.save_character_image("series-one", "character-one", "gray.png", self.PNG)

            discarded = store.discard_unsaved("仮シリーズ", "series-one", "episode-one")

            self.assertTrue(discarded["deleted"])
            self.assertFalse((root / "series-one").exists())

    def test_series_draft_discard_deletes_new_catalog_and_images(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            draft = store.begin_draft("仮シリーズ", "series-one", "episode-one")
            store.save("仮シリーズ", "series-one", 'manga:\n  meta:\n    episode_id: "episode-one"\n', "")
            store.save_character_image("series-one", "character-one", "gray.png", self.PNG)

            discarded = store.discard_draft(draft["draft_token"])

            self.assertTrue(discarded["discarded"])
            self.assertFalse((root / "series-one").exists())

    def test_series_draft_discard_restores_existing_catalog_and_deleted_image(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            first = store.save("猫の旅", "series-one", "manga:\n  title: before\n", "")
            saved_image = store.save_character_image("series-one", "character-one", "gray.png", self.PNG)
            draft = store.begin_draft("猫の旅", "series-one", "episode-two")
            store.save("猫の旅", "series-one", "manga:\n  title: after\n", first["revision"])
            store.delete_character_image("series-one", "character-one", saved_image["source_image"]["asset_id"])

            store.discard_draft(draft["draft_token"])

            self.assertIn("before", store.load("猫の旅", "series-one")["omny_yaml"])
            loaded_image = store.load_character_image("series-one", "character-one", saved_image["source_image"]["asset_id"])
            self.assertTrue(loaded_image["found"])

    def test_series_draft_commit_keeps_changes(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            first = store.save("猫の旅", "series-one", "manga:\n  title: before\n", "")
            draft = store.begin_draft("猫の旅", "series-one", "episode-two")
            store.save("猫の旅", "series-one", "manga:\n  title: after\n", first["revision"])

            committed = store.commit_draft(draft["draft_token"])

            self.assertTrue(committed["committed"])
            self.assertIn("after", store.load("猫の旅", "series-one")["omny_yaml"])

    def test_listing_rolls_back_an_abandoned_series_draft(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            first = store.save("猫の旅", "series-one", "manga:\n  title: before\n", "")
            store.begin_draft("猫の旅", "series-one", "episode-two")
            store.save("猫の旅", "series-one", "manga:\n  title: after\n", first["revision"])

            listed = store.list_catalogs()["series"]

            self.assertEqual([item["series_name"] for item in listed], ["猫の旅"])
            self.assertIn("before", store.load("猫の旅", "series-one")["omny_yaml"])

    def test_unsaved_series_discard_rejects_another_episode_or_series_name(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            source = 'manga:\n  meta:\n    episode_id: "episode-one"\n'
            store.save("残すシリーズ", "series-one", source, "")

            with self.assertRaises(bridge.SeriesCatalogConflict):
                store.discard_unsaved("別シリーズ", "series-one", "episode-one")
            with self.assertRaises(bridge.SeriesCatalogConflict):
                store.discard_unsaved("残すシリーズ", "series-one", "episode-two")

            self.assertTrue((root / "series-one" / "series.omny.yaml").is_file())

    def test_character_images_live_under_the_series_and_deduplicate_by_sha256(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            store.save("猫の旅", "series-one", "manga:\n  materials: []\n", "")
            first = store.save_character_image("series-one", "character-one", "gray.png", self.PNG)
            second = store.save_character_image("series-one", "character-one", "same.png", self.PNG)

            source = first["source_image"]
            self.assertTrue(first["created"])
            self.assertFalse(second["created"])
            self.assertEqual(second["source_image"]["asset_id"], source["asset_id"])
            self.assertEqual(len(list((root / "series-one" / "characters" / "character-one").glob("*.png"))), 1)
            self.assertEqual(source["file_name"], f"characters/character-one/{source['asset_id']}.png")
            self.assertEqual(source["original_name"], "gray.png")
            sanitized = store.save_character_image("series-one", "character-one", "folder\\design.jpeg", self.PNG)
            self.assertEqual(sanitized["source_image"]["original_name"], "design.jpeg")
            loaded = store.load_character_image("series-one", "character-one", source["asset_id"])
            self.assertTrue(loaded["found"])
            self.assertEqual(loaded["asset_id"], source["asset_id"])
            self.assertTrue(bridge.decode_image_data(loaded["image"]).startswith(b"\x89PNG"))
            self.assertTrue(store.delete_character_image("series-one", "character-one", source["asset_id"])["deleted"])
            self.assertFalse(store.load_character_image("series-one", "character-one", source["asset_id"])["found"])

    def test_character_image_rejects_unknown_series_and_path_components(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.SeriesCatalogStore(Path(directory_name))
            with self.assertRaisesRegex(ValueError, "先にシリーズ資料"):
                store.save_character_image("missing", "character-one", "gray.png", self.PNG)
            store.save("猫の旅", "series-one", "manga:\n  materials: []\n", "")
            with self.assertRaisesRegex(ValueError, "キャラクター"):
                store.save_character_image("series-one", "../outside", "gray.png", self.PNG)

    def test_character_image_load_rejects_content_that_no_longer_matches_asset_hash(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            store = bridge.SeriesCatalogStore(root)
            store.save("猫の旅", "series-one", "manga:\n  materials: []\n", "")
            saved = store.save_character_image("series-one", "character-one", "gray.png", self.PNG)
            source = saved["source_image"]
            image_path = root / "series-one" / source["file_name"]
            tampered = bytearray(self.PNG)
            tampered[-5] ^= 0x01
            image_path.write_bytes(tampered)

            with self.assertRaisesRegex(ValueError, "ハッシュ"):
                store.load_character_image("series-one", "character-one", source["asset_id"])

            repaired = store.save_character_image("series-one", "character-one", "gray.png", self.PNG)
            self.assertFalse(repaired["created"])
            self.assertTrue(store.load_character_image("series-one", "character-one", source["asset_id"])["found"])

    def test_character_text_links_from_series_folder_syncs_and_keeps_30_day_restore_data(self):
        with tempfile.TemporaryDirectory() as directory_name:
            base = Path(directory_name)
            catalog_root = base / "catalogs"
            series_root = base / "呼応変異"
            text_path = series_root / "character_data" / "character.md"
            text_path.parent.mkdir(parents=True)
            text_path.write_text(
                "# 登場人物設定\n\n**ユキ**\n好奇心が強い。\n\n## 制作メモ\n### 雨の回\n傘を持たせる。\n",
                encoding="utf-8",
            )
            store = bridge.SeriesCatalogStore(catalog_root)
            first = store.save("呼応変異", "series-one", "manga:\n  materials: []\n", "")

            with (
                patch.object(series_catalog_store, "choose_workspace_files", return_value=[text_path]) as choose_text,
                patch.object(store, "character_text_candidates") as search_candidates,
            ):
                linked = store.link_character_text("呼応変異", "series-one", series_root)

            self.assertTrue(linked["linked"])
            self.assertEqual(linked["file_name"], "character.md")
            self.assertIn("ユキ", linked["text"])
            choose_text.assert_called_once_with(series_root.resolve(), "character-text", False)
            search_candidates.assert_not_called()
            archive_yaml = "manga:\n  characters:\n    - name: ユキ\n"
            synced = store.sync_character_text(
                "series-one",
                '<!-- nyamuru-series-character-catalog v1 series-id="series-one" -->\n'
                "# 登場人物設定\n\n## キャラクター\n\n"
                "<!-- /nyamuru-series-character-catalog -->\n",
                [],
                {
                    "character_catalog_id": "character-yuki",
                    "character_name": "ユキ",
                    "omny_yaml": archive_yaml,
                },
            )
            self.assertTrue(synced["linked"])
            self.assertTrue(synced["archived"])
            current_text = text_path.read_text(encoding="utf-8")
            self.assertIn("<!-- /nyamuru-series-character-catalog -->", current_text)
            self.assertIn("## 制作メモ\n### 雨の回\n傘を持たせる。", current_text)
            self.assertNotIn("**ユキ**", current_text)
            deleted = synced["deleted_characters"]
            self.assertEqual(deleted[0]["character_name"], "ユキ")
            self.assertEqual(
                datetime.fromisoformat(deleted[0]["expires_at"]) - datetime.fromisoformat(deleted[0]["deleted_at"]),
                timedelta(days=30),
            )
            restored = store.restore_character_text("series-one", deleted[0]["deletion_id"])
            self.assertTrue(restored["found"])
            self.assertEqual(restored["omny_yaml"], archive_yaml)

            store.sync_character_text(
                "series-one",
                '<!-- nyamuru-series-character-catalog v1 series-id="series-one" -->\n'
                "# 登場人物設定\n\n## キャラクター\n\n### 復元後\n\n"
                "<!-- /nyamuru-series-character-catalog -->\n",
                ["character-yuki"],
                None,
            )
            self.assertEqual(store.list_deleted_characters("series-one"), [])
            self.assertEqual(text_path.read_text(encoding="utf-8").count("## 制作メモ"), 1)
            self.assertIn("### 復元後", text_path.read_text(encoding="utf-8"))
            self.assertTrue((catalog_root / "series-one" / "character-text-history").is_dir())

            second = store.save("呼応変異", "series-one", "manga:\n  materials: [updated]\n", first["revision"])
            self.assertEqual(second["series_id"], "series-one")
            metadata = store.metadata_for("series-one")
            self.assertEqual(metadata["character_text_reference"]["relative_path"], "character_data/character.md")

    def test_character_text_relinks_after_series_folder_moves(self):
        with tempfile.TemporaryDirectory() as directory_name:
            base = Path(directory_name)
            original = base / "original" / "series"
            moved = base / "moved" / "series"
            text_path = original / "character_data" / "character.md"
            text_path.parent.mkdir(parents=True)
            text_path.write_text("# 登場人物設定\n\n**ユキ**\n人物像。\n", encoding="utf-8")
            store = bridge.SeriesCatalogStore(base / "catalogs")
            store.save("作品", "series-one", "manga:\n  materials: []\n", "")
            with patch.object(series_catalog_store, "choose_workspace_files", return_value=[text_path]):
                store.link_character_text("作品", "series-one", original)

            moved.parent.mkdir(parents=True)
            original.rename(moved)
            status = store.character_text_status("series-one")
            self.assertFalse(status["linked"])
            self.assertTrue(status["needs_relink"])
            with patch.object(series_catalog_store, "choose_series_directory", return_value=moved):
                relinked = store.link_character_text("作品", "series-one", moved)
            self.assertTrue(relinked["linked"])
            self.assertEqual(relinked["relative_path"], "character_data/character.md")


class OrientationResultTest(unittest.TestCase):
    def test_accepts_only_valid_manual_rotation_override(self):
        self.assertIsNone(bridge.normalized_rotation_override(None))
        self.assertEqual(bridge.normalized_rotation_override("180"), 180)
        with self.assertRaisesRegex(ValueError, "0・90・180・270"):
            bridge.normalized_rotation_override(45)

    def test_analysis_refuses_an_unconfirmed_orientation(self):
        with self.assertRaisesRegex(ValueError, "画像を正立"):
            bridge.LocalVisionState.analyze(object(), b"image", None)


class AnalogAssetStoreTest(unittest.TestCase):
    PNG = b"\x89PNG\r\n\x1a\nlocal-test"

    def test_does_not_create_image_hub_until_an_asset_is_saved(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name) / "Image-Hub"
            bridge.AnalogAssetStore(root)
            self.assertFalse(root.exists())

    def test_saves_figures_and_texts_under_one_episode_with_a_manifest(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name) / "Image-Hub"
            store = bridge.AnalogAssetStore(root)
            figure = store.save("episode-123", "猫漫画", "figures", "analog-figure:one", self.PNG)
            text = store.save("episode-123", "猫漫画", "texts", "analog-text:one", self.PNG)

            self.assertTrue((root / "episode-123" / "figures" / figure["file_name"]).is_file())
            self.assertTrue((root / "episode-123" / "texts" / text["file_name"]).is_file())
            manifest = json.loads((root / "episode-123" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(set(manifest["assets"]), {"analog-figure:one", "analog-text:one"})
            loaded = store.load("episode-123", "texts", text["file_name"])
            self.assertTrue(loaded["found"])
            self.assertEqual(bridge.decode_image_data(loaded["image"]), self.PNG)

    def test_same_asset_id_overwrites_the_same_file_instead_of_making_garbage(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name) / "Image-Hub"
            store = bridge.AnalogAssetStore(root)
            first = store.save("episode-123", "猫漫画", "figures", "analog-figure:one", self.PNG)
            second = store.save("episode-123", "猫漫画", "figures", "analog-figure:one", self.PNG)

            self.assertEqual(first["file_name"], second["file_name"])
            self.assertEqual(len(list((root / "episode-123" / "figures").glob("*.png"))), 1)

    def test_rejects_path_traversal_and_unknown_asset_kinds(self):
        with tempfile.TemporaryDirectory() as directory_name:
            store = bridge.AnalogAssetStore(Path(directory_name) / "Image-Hub")
            with self.assertRaisesRegex(ValueError, "エピソードID"):
                store.save("../outside", "猫漫画", "figures", "analog-figure:one", self.PNG)
            with self.assertRaisesRegex(ValueError, "figures または texts"):
                store.save("episode-123", "猫漫画", "other", "analog-figure:one", self.PNG)


class LocalVisionResultTest(unittest.TestCase):
    def test_every_success_response_identifies_this_bridge_and_protocol(self):
        handler = object.__new__(bridge.BridgeHandler)
        handler.wfile = io.BytesIO()
        handler.send_response = lambda _status: None
        handler.send_header = lambda _name, _value: None
        handler.end_headers = lambda: None
        handler.allowed_origin = lambda: None

        handler.send_json(200, {"ok": True})

        payload = json.loads(handler.wfile.getvalue())
        self.assertEqual(payload["service"], bridge.BRIDGE_SERVICE_NAME)
        self.assertEqual(payload["layout_protocol_version"], bridge.LAYOUT_PROTOCOL_VERSION)

    def test_formats_rtdetr_outputs_into_stable_detection_buckets(self):
        detector_path = Path(__file__).parents[1] / "scripts" / "rtdetr_onnx.py"
        detector_spec = importlib.util.spec_from_file_location("rtdetr_onnx", detector_path)
        detector = importlib.util.module_from_spec(detector_spec)
        assert detector_spec and detector_spec.loader
        detector_spec.loader.exec_module(detector)
        buckets = detector.detection_buckets(
            [2, 0, 1, 3, 99],
            [[1, 2, 30, 40], [4, 5, 20, 50], [6, 7, 8, 9], [10, 11, 12, 13], [0, 0, 1, 1]],
            [0.9, 0.8, 0.1, 0.7, 0.99],
            0.2,
        )
        self.assertEqual([item["id"] for item in buckets["frames"]], ["f0"])
        self.assertEqual([item["id"] for item in buckets["bodies"]], ["b0"])
        self.assertEqual(buckets["texts"], [])
        self.assertEqual([item["id"] for item in buckets["faces"]], ["face0"])

    def test_bridge_text_quality_keeps_japanese_above_latin_garbage(self):
        self.assertGreater(bridge.ocr_text_quality("こんにちは"), bridge.ocr_text_quality("AAAAAAAAAAAA"))

    def test_timed_out_worker_is_terminated_and_its_source_image_is_deleted(self):
        created_processes = []

        class TimedOutProcess:
            returncode = None
            stdin = stdout = stderr = None

            def __init__(self, command, **_kwargs):
                self.command = command
                self.communicate_calls = 0
                self.terminated = False
                created_processes.append(self)

            def communicate(self, **_kwargs):
                self.communicate_calls += 1
                if self.communicate_calls == 1:
                    raise bridge.subprocess.TimeoutExpired(self.command, 90)
                return "", ""

            def terminate(self):
                self.terminated = True
                self.returncode = -15

            def wait(self, timeout=None):
                return self.returncode

            def kill(self):
                self.returncode = -9

            def poll(self):
                return self.returncode

        with tempfile.TemporaryDirectory() as directory_name:
            python = Path(directory_name) / "python"
            python.write_text("")
            with patch.object(bridge.subprocess, "Popen", TimedOutProcess):
                with self.assertRaises(bridge.subprocess.TimeoutExpired):
                    bridge.run_local_worker(
                        python=python,
                        engine="rtdetr",
                        root=Path(directory_name),
                        image_bytes=b"source",
                    )

        process = created_processes[0]
        image_path = Path(process.command[process.command.index("--image") + 1])
        self.assertTrue(process.terminated)
        self.assertFalse(image_path.exists())
        self.assertNotIn(process, bridge.ACTIVE_WORKERS)

    def test_shutdown_gate_prevents_a_new_model_worker_from_starting(self):
        with tempfile.TemporaryDirectory() as directory_name:
            python = Path(directory_name) / "python"
            python.write_text("")
            bridge.WORKER_SHUTDOWN_EVENT.set()
            try:
                with patch.object(bridge.subprocess, "Popen") as popen:
                    with self.assertRaisesRegex(RuntimeError, "終了処理中"):
                        bridge.run_local_worker(
                            python=python,
                            engine="rtdetr",
                            root=Path(directory_name),
                            image_bytes=b"source",
                        )
                popen.assert_not_called()
            finally:
                bridge.WORKER_SHUTDOWN_EVENT.clear()

    def test_default_models_are_owned_by_this_repository(self):
        with patch.dict(bridge.os.environ, {}, clear=True):
            paths = bridge.default_vision_paths()
        self.assertEqual(paths["vision_root"], bridge.DEFAULT_VISION_ROOT)
        self.assertEqual(paths["baberu_model"], bridge.DEFAULT_VISION_ROOT / "models" / "baberu-ocr")
        self.assertEqual(
            paths["baberu_model"].relative_to(bridge.REPO_ROOT),
            Path(".local-vision/models/baberu-ocr"),
        )

    def test_analysis_returns_versioned_panel_records_and_skips_baberu_without_text(self):
        state = bridge.LocalVisionState(
            Path("/tmp/nyamuru-test-vision"),
            Path("/tmp/nyamuru-test-vision/.venv/bin/python"),
            Path("/tmp/nyamuru-test-vision/model.onnx"),
            Path("/tmp/nyamuru-test-vision/baberu-ocr"),
        )
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "frames": [{"score": 0.9, "bbox": [50, 50, 950, 650]}],
                "texts": [],
                "faces": [],
                "bodies": [],
            },
        }
        shape = {"type": "rect", "x": 0.05, "y": 50 / 1400, "w": 0.9, "h": 600 / 1400}
        with (
            patch.object(vision_state, "rotated_image_bytes", return_value=b"upright"),
            patch.object(vision_state, "run_local_worker", return_value=detection) as run_worker,
            patch.object(vision_state, "detect_panel_shapes", return_value=[shape]),
        ):
            result = state.analyze(b"image", 0)

        self.assertEqual(run_worker.call_count, 1, "文字候補がなければBaberuワーカーを起動しない")
        self.assertEqual(result["layout_protocol_version"], bridge.LAYOUT_PROTOCOL_VERSION)
        self.assertEqual(result["panels"], [{
            "id": "panel-001",
            "detector_box": [0.05, round(50 / 1400, 6), 0.9, round(600 / 1400, 6)],
            "shape": shape,
        }])
        self.assertNotIn("panel_boxes", result)
        self.assertNotIn("panel_shapes", result)

    def test_orders_detected_panels_top_to_bottom_and_right_to_left(self):
        boxes = [
            (0.05, 0.52, 0.4, 0.4),
            (0.55, 0.04, 0.4, 0.4),
            (0.05, 0.05, 0.4, 0.4),
            (0.55, 0.53, 0.4, 0.4),
        ]
        self.assertEqual(bridge.sort_panel_boxes_reading_order(boxes), [
            (0.55, 0.04, 0.4, 0.4),
            (0.05, 0.05, 0.4, 0.4),
            (0.55, 0.53, 0.4, 0.4),
            (0.05, 0.52, 0.4, 0.4),
        ])

    def test_removes_enclosing_frame_but_keeps_the_two_panels_inside_it(self):
        right = (0.42, 0.00, 0.58, 0.45)
        enclosing = (0.00, 0.00, 1.00, 0.46)
        left = (0.00, 0.00, 0.66, 0.45)

        self.assertEqual(
            bridge.deduplicate_panel_boxes([right, enclosing, left]),
            [right, left],
        )

    def test_recovers_only_rtdetr_supported_diagonal_panel_dividers(self):
        boxes = [
            (0.00, 0.00, 0.66, 0.45),
            (0.42, 0.00, 0.58, 0.45),
            (0.00, 0.45, 1.00, 0.24),
            (0.00, 0.69, 1.00, 0.28),
        ]
        segments = [
            (0.42, 0.00, 0.47, 0.09),
            (0.48, 0.11, 0.54, 0.22),
            (0.55, 0.24, 0.61, 0.35),
            (0.62, 0.37, 0.66, 0.45),
            (0.90, 0.45, 0.82, 0.51),
            (0.81, 0.52, 0.74, 0.58),
            (0.72, 0.60, 0.65, 0.67),
        ]

        shapes = bridge.infer_panel_shapes_from_segments(boxes, segments)

        self.assertEqual(len(shapes), 4)
        self.assertTrue(all(shape["type"] == "polygon" for shape in shapes))
        self.assertAlmostEqual(shapes[0]["points"][0][0], 0.42, places=2)
        self.assertAlmostEqual(shapes[1]["points"][2][0], 0.66, places=2)
        self.assertAlmostEqual(shapes[2]["points"][0][0], 0.00, places=2)
        self.assertAlmostEqual(shapes[2]["points"][1][0], 1.00, places=2)
        self.assertAlmostEqual(shapes[-1]["points"][0][1], 0.69, places=2)

    def test_keeps_shapes_in_detector_reading_order_for_tall_and_stacked_panels(self):
        # 金城05型。読み順は右の縦長コマ、左上、左中、左下だが、
        # 形状推定側の厳密な行グループは左上を先に列挙していた。
        boxes = [
            (0.482441, 0.054645, 0.428140, 0.906881),
            (0.085303, 0.050096, 0.387032, 0.555154),
            (0.092876, 0.502370, 0.371544, 0.141094),
            (0.083087, 0.576056, 0.409090, 0.390086),
        ]

        shapes = bridge.infer_panel_shapes_from_segments(boxes, [])

        self.assertEqual(len(shapes), len(boxes))
        for shape, box in zip(shapes, boxes):
            shape_box = bridge._shape_bounds(shape)
            self.assertGreater(bridge._box_iou(box, shape_box), 0.70)

    def test_recovers_horizontal_diagonal_dividers_between_stacked_panels(self):
        # 金城05型の左列。上中境界は右上がり、中下境界は右下がり。
        boxes = [
            (0.50, 0.00, 0.50, 1.00),
            (0.00, 0.00, 0.50, 0.58),
            (0.00, 0.50, 0.50, 0.15),
            (0.00, 0.60, 0.50, 0.40),
        ]
        segments = [
            (0.00, 0.58, 0.24, 0.542),
            (0.26, 0.548, 0.50, 0.50),
            (0.00, 0.60, 0.24, 0.624),
            (0.26, 0.616, 0.50, 0.65),
        ]

        shapes = bridge.infer_panel_shapes_from_segments(boxes, segments)

        self.assertEqual(len(shapes), len(boxes))
        right_tall, upper, middle, lower = shapes
        self.assertAlmostEqual(right_tall["points"][0][0], 0.50, places=5)
        self.assertAlmostEqual(upper["points"][3][1], 0.58, places=2)
        self.assertAlmostEqual(upper["points"][2][1], 0.50, places=2)
        self.assertAlmostEqual(middle["points"][0][1], 0.58, places=2)
        self.assertAlmostEqual(middle["points"][1][1], 0.50, places=2)
        self.assertAlmostEqual(middle["points"][3][1], 0.60, places=2)
        self.assertAlmostEqual(middle["points"][2][1], 0.65, places=2)
        self.assertAlmostEqual(lower["points"][0][1], 0.60, places=2)
        self.assertAlmostEqual(lower["points"][1][1], 0.65, places=2)

    def test_horizontal_recovery_preserves_staggered_vertical_boundaries(self):
        # scan01 topology: upper divider at .44, middle divider at .50.
        # A slight horizontal slope must not import a shared column envelope.
        boxes = [
            (.44, 0, .56, .34), (0, 0, .44, .34),
            (.50, .34, .50, .36), (0, .34, .50, .36),
            (0, .70, 1, .30),
        ]
        segments = [(0, .34, 1, .33), (0, .70, 1, .70)]
        shapes = bridge.infer_panel_shapes_from_segments(boxes, segments)
        self.assertEqual(len(shapes), 5)
        for index, divider in [(0, .44), (2, .50)]:
            self.assertAlmostEqual(shapes[index]["points"][0][0], divider, places=5)
            self.assertAlmostEqual(shapes[index]["points"][3][0], divider, places=5)
            self.assertAlmostEqual(shapes[index + 1]["points"][1][0], divider, places=5)
            self.assertAlmostEqual(shapes[index + 1]["points"][2][0], divider, places=5)
        self.assertLess(shapes[0]["points"][2][1], shapes[0]["points"][3][1])

    def test_two_four_panel_strips_keep_all_eight_frames_with_horizontal_slopes(self):
        boxes = [(x, .10 + row * .20, .35, .18) for row in range(4) for x in [.52, .14]]
        segments = [(x, .29 + row * .20, x + .35, .285 + row * .20)
                    for row in range(3) for x in [.14, .52]]
        shapes = bridge.infer_panel_shapes_from_segments(boxes, segments)
        self.assertEqual(len(shapes), 8)
        for shape, box in zip(shapes, boxes):
            bounds = bridge._shape_bounds(shape)
            self.assertAlmostEqual(bounds[0], box[0], places=5)
            self.assertAlmostEqual(bounds[2], box[2], places=5)
            self.assertGreater(bridge._box_iou(bounds, box), .85)

    def test_horizontal_candidate_does_not_import_unrelated_vertical_candidate(self):
        row = {"type": "polygon", "points": [[.20, .10], [.80, .10], [.85, .90], [.25, .90]]}
        column = {"type": "polygon", "points": [[.10, .20], [.90, .30], [.90, .80], [.10, .90]]}
        # A stronger horizontal candidate must not inherit artwork mistaken for
        # a vertical divider by the independent row candidate.
        with patch.object(layout_geometry, "_order_shapes_by_detector_boxes", side_effect=[[row], [column]]):
            shape = bridge.infer_panel_shapes_from_segments([(.1, .1, .8, .8)], [])[0]
        for point, side in zip(shape["points"], [0, 1, 1, 0]):
            x, y = point
            self.assertAlmostEqual(x, .1 if side == 0 else .9, places=5)
        for x, y in shape["points"][:2]:
            self.assertAlmostEqual(y, .2 + (x - .1) * .1 / .8, places=5)
        for x, y in shape["points"][2:]:
            self.assertAlmostEqual(y, .9 - (x - .1) * .1 / .8, places=5)

    def test_degenerate_horizontal_candidate_falls_back_to_detector_box(self):
        box = (.1, .1, .8, .8)
        row = {"type": "polygon", "points": [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]}
        column = {"type": "polygon", "points": [[.5, .1], [.5, .2], [.5, .8], [.5, .9]]}
        with patch.object(layout_geometry, "_order_shapes_by_detector_boxes", side_effect=[[row], [column]]):
            self.assertEqual(bridge.infer_panel_shapes_from_segments([box], [])[0], row)

    def test_rejects_diagonal_candidate_that_matches_only_at_one_endpoint(self):
        boxes = [
            (0.00, 0.00, 0.66, 0.45),
            (0.42, 0.00, 0.58, 0.45),
        ]
        # 上端は本来の境界に近い一方、下端は人物・フキダシ線へ逸れた候補。
        # 中央位置だけで選ぶと、左コマへ食い込み「だよね」を右コマへ
        # 誤所属させていた。
        misleading_segments = [
            (0.42, 0.00, 0.44, 0.09),
            (0.445, 0.11, 0.47, 0.22),
            (0.475, 0.24, 0.505, 0.35),
            (0.51, 0.37, 0.54, 0.45),
        ]

        shapes = bridge.infer_panel_shapes_from_segments(boxes, misleading_segments)

        self.assertEqual(len(shapes), 2)
        # RT-DETRの外接矩形が持つ両端（上0.42・下0.66）へ戻す。
        self.assertAlmostEqual(shapes[0]["points"][0][0], 0.42, places=5)
        self.assertAlmostEqual(shapes[0]["points"][3][0], 0.66, places=5)
        self.assertAlmostEqual(shapes[1]["points"][1][0], 0.42, places=5)
        self.assertAlmostEqual(shapes[1]["points"][2][0], 0.66, places=5)

    def test_tall_panel_does_not_bridge_two_stacked_neighbors_into_columns(self):
        boxes = [
            (0.002469, 0.000340, 0.997115, 0.404115),
            (-0.000111, 0.404419, 0.999988, 0.189048),
            (0.509040, 0.593864, 0.490889, 0.402305),
            (-0.000146, 0.595362, 0.507987, 0.186529),
            (0.000257, 0.782560, 0.507145, 0.214589),
        ]
        misleading_character_lines = [
            (0.271, 0.594, 0.337, 0.997),
            (0.506, 0.594, 0.490, 0.997),
        ]

        shapes = bridge.infer_panel_shapes_from_segments(boxes, misleading_character_lines)

        self.assertEqual(len(shapes), 5)
        self.assertAlmostEqual(shapes[2]["points"][0][0], 0.509040, places=5)
        self.assertAlmostEqual(shapes[2]["points"][3][1], 0.996169, places=5)
        self.assertAlmostEqual(shapes[3]["points"][0][0], -0.000146, places=5)
        self.assertAlmostEqual(shapes[3]["points"][3][1], 0.781891, places=5)
        self.assertAlmostEqual(shapes[4]["points"][0][1], 0.782560, places=5)

    def test_rejects_full_page_frame_from_rtdetr(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {"frames": [
                {"score": 0.9, "bbox": [0, 0, 1000, 1400]},
                {"score": 0.8, "bbox": [40, 50, 960, 600]},
            ]},
        }
        self.assertEqual(bridge.detector_boxes(detection, "frames"), [(0.04, 50 / 1400, 0.92, 550 / 1400)])

    def test_rejects_frame_that_duplicates_a_text_region(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "texts": [{"score": 0.9, "bbox": [105, 105, 395, 295]}],
                "faces": [],
                "bodies": [],
            },
        }
        boxes = [(0.1, 0.07, 0.3, 0.15)]
        kept, excluded = bridge.exclude_non_panel_regions(boxes, detection)
        self.assertEqual(kept, [])
        self.assertEqual(excluded, {"texts": 1, "faces": 0, "bodies": 0})

    def test_keeps_panel_that_only_contains_text_and_a_person(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "texts": [{"score": 0.9, "bbox": [120, 120, 220, 320]}],
                "faces": [{"score": 0.9, "bbox": [300, 220, 420, 340]}],
                "bodies": [{"score": 0.9, "bbox": [260, 200, 480, 620]}],
            },
        }
        boxes = [(0.05, 0.04, 0.9, 0.42)]
        kept, excluded = bridge.exclude_non_panel_regions(boxes, detection)
        self.assertEqual(kept, boxes)
        self.assertEqual(excluded, {"texts": 0, "faces": 0, "bodies": 0})

    def test_rejects_only_decisively_weaker_rtdetr_frame_in_cross_class_conflict(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "frames": [{"id": "weak-frame", "score": 0.5, "bbox": [100, 100, 400, 310]}],
                "texts": [{"id": "strong-text", "score": 0.9, "bbox": [105, 105, 395, 305]}],
                "faces": [],
                "bodies": [],
            },
        }
        boxes = bridge.detector_boxes(detection, "frames")
        kept, excluded = bridge.exclude_non_panel_regions(boxes, detection)
        self.assertEqual(kept, [])
        self.assertEqual(excluded, {"texts": 1, "faces": 0, "bodies": 0})

    def test_one03_keeps_eight_story_panels_despite_cross_class_overlap(self):
        detection = {
            "page": {"width": 600, "height": 848},
            "detections": {
                "frames": [
                    {"id": "f0", "score": 0.9598, "bbox": [85.42, 301.68, 294.02, 440.30]},
                    {"id": "f1", "score": 0.9582, "bbox": [85.55, 599.22, 293.71, 738.38]},
                    {"id": "f2", "score": 0.9580, "bbox": [304.61, 301.34, 514.15, 440.81]},
                    {"id": "f3", "score": 0.9564, "bbox": [305.47, 153.32, 513.95, 290.78]},
                    {"id": "f4", "score": 0.9543, "bbox": [85.43, 153.46, 293.99, 290.68]},
                    {"id": "f5", "score": 0.9383, "bbox": [85.47, 451.11, 293.70, 588.26]},
                    {"id": "f6", "score": 0.9087, "bbox": [305.47, 450.78, 514.20, 588.54]},
                    {"id": "f7", "score": 0.8437, "bbox": [305.09, 109.67, 514.40, 142.61]},
                    {"id": "f8", "score": 0.7785, "bbox": [84.97, 109.19, 294.52, 142.63]},
                    {"id": "f9", "score": 0.7324, "bbox": [306.18, 600.13, 511.84, 738.06]},
                ],
                "texts": [
                    {"id": "t1", "score": 0.8228, "bbox": [310.66, 454.70, 505.41, 583.73]},
                    {"id": "t2", "score": 0.7917, "bbox": [319.08, 116.05, 493.48, 139.27]},
                    {"id": "t3", "score": 0.6643, "bbox": [308.03, 603.69, 503.10, 736.72]},
                    {"id": "t6", "score": 0.2787, "bbox": [306.18, 600.13, 511.84, 738.06]},
                ],
                "faces": [],
                "bodies": [
                    {"id": "b16", "score": 0.2276, "bbox": [327.37, 302.57, 513.18, 440.15]},
                ],
            },
        }

        raw_boxes = bridge.detector_boxes(detection, "frames")
        kept, excluded = bridge.exclude_non_panel_regions(raw_boxes, detection)
        panels, removed_headers = bridge.exclude_paired_title_header_boxes(kept)
        panels = bridge.deduplicate_panel_boxes(panels)

        self.assertEqual(len(raw_boxes), 10)
        self.assertEqual(excluded, {"texts": 0, "faces": 0, "bodies": 0})
        self.assertEqual(removed_headers, 2)
        self.assertEqual(len(panels), 8)
        self.assertTrue(all(box[3] > 0.15 for box in panels))

    def test_fuses_bodies_with_only_unmatched_faces_as_person_regions(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "faces": [
                    {"score": 0.9, "bbox": [300, 220, 420, 340]},
                    {"score": 0.8, "bbox": [700, 180, 800, 280]},
                ],
                "bodies": [
                    {"score": 0.9, "bbox": [260, 200, 480, 620]},
                    {"score": 0.7, "bbox": [270, 210, 475, 610]},
                ],
            },
        }
        self.assertEqual(bridge.detected_person_regions(detection), [
            {"id": "bodies-0", "source": "body", "confidence": 0.9, "bbox": [0.26, 0.142857, 0.22, 0.3]},
            {"id": "faces-1", "source": "face", "confidence": 0.8, "bbox": [0.7, 0.128571, 0.1, 0.071429]},
        ])

    def test_fuses_face_that_substantially_overlaps_browser_shifted_body(self):
        detection = {
            "page": {"width": 1000, "height": 1000},
            "detections": {
                "faces": [
                    {"id": "top-face", "score": 0.54, "bbox": [489, 153, 667, 316]},
                    {"id": "separate-face", "score": 0.51, "bbox": [720, 120, 810, 220]},
                ],
                "bodies": [
                    {"id": "top-body", "score": 0.31, "bbox": [284, 71, 567, 371]},
                    {"id": "foreground-body", "score": 0.38, "bbox": [439, 257, 1000, 871]},
                ],
            },
        }

        self.assertEqual(
            [region["id"] for region in bridge.detected_person_regions(detection)],
            ["top-body", "foreground-body", "separate-face"],
        )

    def test_splits_giant_body_proposal_when_distinct_people_explain_it(self):
        detection = {
            "page": {"width": 724, "height": 1048},
            "detections": {
                "faces": [
                    {"id": "face0", "score": 0.64, "bbox": [187, 636, 313, 758]},
                    {"id": "face1", "score": 0.57, "bbox": [283, 142, 364, 217]},
                    {"id": "face2", "score": 0.53, "bbox": [447, 435, 725, 906]},
                ],
                "bodies": [
                    {"id": "b0", "score": 0.53, "bbox": [154, 587, 423, 1036]},
                    {"id": "b2", "score": 0.42, "bbox": [87, 75, 724, 912]},
                    {"id": "b3", "score": 0.38, "bbox": [317, 270, 725, 912]},
                    {"id": "b4", "score": 0.37, "bbox": [189, 73, 723, 913]},
                    {"id": "b5", "score": 0.34, "bbox": [291, 127, 724, 914]},
                    {"id": "b6", "score": 0.30, "bbox": [196, 75, 544, 527]},
                    {"id": "b7", "score": 0.28, "bbox": [206, 75, 413, 388]},
                ],
            },
        }

        regions = bridge.detected_person_regions(detection)
        self.assertEqual([region["id"] for region in regions], ["b0", "b3", "b6"])

    def test_does_not_split_one_body_from_upper_and_lower_fragments(self):
        detection = {
            "page": {"width": 1000, "height": 1400},
            "detections": {
                "faces": [{"id": "face0", "score": 0.9, "bbox": [410, 190, 520, 310]}],
                "bodies": [
                    {"id": "whole", "score": 0.9, "bbox": [300, 150, 650, 1150]},
                    {"id": "upper", "score": 0.75, "bbox": [320, 170, 630, 650]},
                    {"id": "lower", "score": 0.7, "bbox": [330, 620, 620, 1130]},
                ],
            },
        }

        self.assertEqual(
            [region["id"] for region in bridge.detected_person_regions(detection)],
            ["whole"],
        )

    def test_filters_giant_and_latin_garbage_ocr_regions(self):
        payload = {
            "width": 1000,
            "height": 1400,
            "region_lines": [
                {"id": "good", "text": "ものようになる。", "bbox": [600, 100, 140, 180], "confidence": 0.7, "group_id": "rtdetr-text-2"},
                {"id": "bad", "text": "AAAAAAAAAAAA", "bbox": [50, 50, 100, 100], "confidence": 0.8},
            ],
            "detected_lines": [
                {"id": "page", "text": "誤検出", "bbox": [0, 0, 1000, 1400], "confidence": 0.9},
            ],
        }
        lines = bridge.usable_ocr_lines(payload)
        self.assertEqual([line["id"] for line in lines], ["good"])
        self.assertEqual(lines[0]["group_id"], "rtdetr-text-2")
        self.assertFalse(lines[0]["needs_review"])

    def test_keeps_unreadable_baberu_region_for_manual_entry(self):
        payload = {
            "width": 1000,
            "height": 1400,
            "region_lines": [{
                "id": "unreadable",
                "text": "",
                "bbox": [600, 100, 140, 180],
                "confidence": 0.7,
                "detection_source": "rtdetr-text",
                "needs_review": True,
                "unreadable": True,
            }],
        }
        lines = bridge.usable_ocr_lines(payload)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["text"], "")
        self.assertTrue(lines[0]["unreadable"])
        self.assertTrue(lines[0]["needs_review"])
        self.assertEqual(lines[0]["source"], "rtdetr-text")


class PanelActionSuggesterTest(unittest.TestCase):
    class FakeResponse:
        def __init__(self, payload):
            self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size):
            return self.payload

    def request_body(self):
        return {
            "action_mode": "reconcile",
            "work": {
                "series_title": "ふたりの放課後",
                "subtitle": "秘密の相談",
                "episode_number": "第3話",
                "synopsis": "アキがユキへ秘密を打ち明け、二人の関係が変わり始める。",
                "setting": {"location": "放課後の教室", "time": "夕方", "weather": "雨"},
            },
            "characters": [
                {"name": "アキ", "description": "慎重な主人公"},
                {"name": "ユキ", "description": "快活な友人"},
            ],
            "previous_panel": {
                "page_number": 1, "panel_id": 1, "panel_action": "アキが言葉を探す。", "people": ["アキ"],
                "dialogues": [{"speaker": "アキ", "text": "あのさ", "monologue": False, "offscreen": False, "shape": "normal"}],
            },
            "current_panel": {
                "page_number": 1, "panel_id": 2, "panel_action": "アキがユキを見て驚く。カメラは二人の正面。", "people": ["アキ", "ユキ"],
                "dialogues": [
                    {"speaker": "アキ", "text": "本当に？", "monologue": True, "offscreen": False, "shape": "thought"},
                    {"speaker": "ユキ", "text": "うん", "monologue": False, "offscreen": False, "shape": "normal"},
                ],
            },
            "next_panel": {
                "page_number": 2, "panel_id": 1, "panel_action": "ユキが笑う。", "people": ["ユキ"],
                "dialogues": [{"speaker": "ユキ", "text": "よかった", "monologue": False, "offscreen": False, "shape": "normal"}],
            },
            "figures": [
                {"id": "figure-0", "name": "アキ", "description": "慎重な主人公", "current_action": "", "size": "bust-up", "role": "main"},
                {"id": "figure-2", "name": "ユキ", "description": "快活な友人", "current_action": "", "size": "waist-up", "role": "sub"},
            ],
        }


    def test_rejects_non_local_llm_endpoint(self):
        with self.assertRaisesRegex(ValueError, "localhost"):
            bridge.PanelActionSuggester("https://example.com/v1/chat/completions")

    def test_image_translation_preserves_reference_order_and_hash(self):
        from generation_store import canonical, sha256
        source = {"prompt": "夕方の教室", "references": [{"file": "image-1.png", "label": "キャンバス"}]}
        english = {"prompt": "A classroom at dusk.", "references": [{"file": "image-1.png", "label": "Canvas"}]}
        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        with patch.object(suggester, "request_json_completion", return_value=(english, {})) as request:
            result = suggester.translate_image_generation_prompt(source)
        self.assertEqual(result, {**english, "request_sha256": sha256(canonical(source))})
        self.assertEqual(request.call_args.kwargs["temperature"], 0)
        self.assertEqual(request.call_args.kwargs["timeout_seconds"], 300)

    def test_image_translation_rejects_retargeting_and_untranslated_labels(self):
        source = {"prompt": "夕方の教室", "references": [{"file": "image-1.png", "label": "キャンバス"}]}
        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        for ref in ({"file": "image-2.png", "label": "Canvas"}, {"file": "image-1.png", "label": "キャンバス"}):
            with patch.object(suggester, "request_json_completion", return_value=({"prompt": "A classroom", "references": [ref]}, {})):
                with self.assertRaisesRegex(ValueError, "英訳"):
                    suggester.translate_image_generation_prompt(source)

    def test_image_translation_restores_group_dialogue_before_validating_source_hash(self):
        from generation_store import canonical, sha256
        source = {"owner_key": "panel", "prompt": "台詞：「こんにちは」", "literal_text": ["こんにちは"],
                  "references": [{"file": "image-1.png", "label": "人物資料"}]}
        english = {"prompt": "A person saying __NYAMURU_LITERAL_0__.",
                   "references": [{"file": "image-1.png", "label": "Character reference"}]}
        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        with patch.object(suggester, "request_json_completion", return_value=(english, {})) as request:
            result = suggester.translate_image_generation_prompt(source)
        self.assertEqual(result["prompt"], "A person saying こんにちは.")
        self.assertEqual(result["request_sha256"], sha256(canonical(source)))
        self.assertEqual(request.call_args.args[1]["prompt"], "台詞：「__NYAMURU_LITERAL_0__」")
        self.assertEqual(english["prompt"], "A person saying __NYAMURU_LITERAL_0__.")

    def test_rejects_duplicate_placement_ids(self):
        body = self.request_body()
        body["figures"][1]["id"] = "figure-0"
        with self.assertRaisesRegex(ValueError, "重複"):
            bridge.PanelActionSuggester.normalized_request(body)

    def test_reconciliation_accepts_long_existing_action_and_empty_result(self):
        body = self.request_body()
        body["figures"][0]["current_action"] = "既存" * 1000
        self.assertEqual(len(bridge.PanelActionSuggester.normalized_request(body)["figures"][0]["current_action"]), 2000)
        completion = {"choices": [{"message": {"content": json.dumps({"actions": [{"id": "figure-0", "action": ""}, {"id": "figure-2", "action": "うなずく"}]})}}]}
        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        with patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)) as request:
            self.assertEqual(suggester.suggest(body)["actions"][0]["action"], "")
        sent = json.loads(request.call_args.args[0].data)
        self.assertGreaterEqual(sent["max_tokens"], 2 * len(body["figures"][0]["current_action"]))
        body["figures"][0]["current_action"] = "a" * 4001
        with self.assertRaises(ValueError):
            bridge.PanelActionSuggester.normalized_request(body)

    def test_reconciliation_rejects_old_append_client_before_calling_llm(self):
        body = self.request_body()
        del body["action_mode"]
        with patch.object(bridge.urllib_request, "urlopen") as request, self.assertRaisesRegex(ValueError, "要求形式"):
            bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions").suggest(body)
        request.assert_not_called()

    def test_reconciliation_sends_dialogue_observations_and_explicit_direction_together(self):
        body = self.request_body()
        body["current_panel"]["panel_action"] = "アキが怪訝な表情をする。"
        body["figures"][0]["current_action"] = "顔は画像右向きの横顔。開眼で口がわずかに開いている。困惑や驚きの可能性あり。\n顔は右向きの横顔。"
        complete = "顔は画像右向きの横顔。目は開き、口はわずかに開いている。怪訝な表情。"
        actions = [{"id": "figure-0", "action": complete}, {"id": "figure-2", "action": ""}]
        completion = {"choices": [{"message": {"content": json.dumps({"actions": actions})}}]}
        with patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)) as request:
            result = bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions").suggest(body)
        sent = json.loads(request.call_args.args[0].data)
        context = json.loads(sent["messages"][1]["content"])
        self.assertEqual(context["figures"][0]["current_action"], body["figures"][0]["current_action"])
        self.assertEqual(context["current_panel"]["panel_action"], body["current_panel"]["panel_action"])
        self.assertEqual(context["current_panel"]["dialogues"][0], {
            **body["current_panel"]["dialogues"][0], "text": "本当に?",
        })
        self.assertEqual(context["current_panel"]["dialogues"][1], body["current_panel"]["dialogues"][1])
        self.assertEqual(result["action_mode"], "reconcile")
        self.assertEqual(result["actions"], actions)

    def test_reconciliation_accepts_complete_action_over_500_but_rejects_over_4000(self):
        suggester = bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions")
        for length in (700, 4001):
            actions = [{"id": "figure-0", "action": "描" * length}, {"id": "figure-2", "action": ""}]
            completion = {"choices": [{"message": {"content": json.dumps({"actions": actions})}}]}
            with self.subTest(length=length), patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)):
                if length <= 4000:
                    self.assertEqual(suggester.suggest(self.request_body())["actions"], actions)
                else:
                    with self.assertRaisesRegex(ValueError, "本文"):
                        suggester.suggest(self.request_body())

    def test_sends_bounded_json_and_accepts_fenced_model_output(self):
        completion = {
            "model": "default_model",
            "choices": [{
                "message": {
                    "content": "```json\n{\"actions\":[{\"id\":\"figure-0\",\"action\":\"目を見開き、ユキへ顔を向ける\"},{\"id\":\"figure-2\",\"action\":\"小さくうなずく\"}]}\n```"
                }
            }],
        }
        captured = {}

        def fake_urlopen(request, timeout):
            captured["timeout"] = timeout
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return self.FakeResponse(completion)

        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        with patch.object(bridge.urllib_request, "urlopen", side_effect=fake_urlopen):
            result = suggester.suggest(self.request_body())

        self.assertEqual(captured["timeout"], 180)
        self.assertFalse(captured["body"]["stream"])
        self.assertEqual(captured["body"]["temperature"], 0.25)
        self.assertNotIn("model", captured["body"])
        sent_context = json.loads(captured["body"]["messages"][1]["content"])
        self.assertEqual(sent_context["work"]["episode_number"], "第3話")
        self.assertEqual(sent_context["current_panel"]["dialogues"][0]["shape"], "thought")
        self.assertEqual(sent_context["next_panel"]["page_number"], 2)
        self.assertEqual(result["model"], "default_model")
        self.assertEqual([item["id"] for item in result["actions"]], ["figure-0", "figure-2"])

    def test_shared_mode_sends_default_model_for_suggestion_and_translation(self):
        completions = [
            {"choices": [{"message": {"content": json.dumps({
                "actions": [{"id": "figure-0", "action": ""}, {"id": "figure-2", "action": ""}],
            })}}]},
            {"choices": [{"message": {"content": '{"translations": []}'}}]},
        ]
        captured = []

        def fake_urlopen(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            return self.FakeResponse(completions[len(captured) - 1])

        suggester = bridge.PanelActionSuggester(
            "http://127.0.0.1:8080/v1/chat/completions",
            request_model="default_model",
        )
        with patch.object(bridge.urllib_request, "urlopen", side_effect=fake_urlopen):
            suggester.suggest(self.request_body())
            suggester.request_json_completion(
                "system", {"items": []}, temperature=0, max_tokens=100, label="一括英訳",
            )

        self.assertEqual([body["model"] for body in captured], ["default_model", "default_model"])
        with self.assertRaisesRegex(ValueError, "default_model"):
            bridge.PanelActionSuggester(
                "http://127.0.0.1:8080/v1/chat/completions",
                request_model="another-model",
            )

    def test_action_targets_exclude_reference_only_people_and_preserve_sparse_ids(self):
        for ids in (["figure-0", "figure-1"], ["figure-0", "figure-2"]):
            with self.subTest(ids=ids):
                body = self.request_body()
                for figure, item_id in zip(body["figures"], ids):
                    figure["id"] = item_id
                body["characters"].append({"name": "先生", "description": "前のコマにだけ登場する"})
                body["previous_panel"]["people"].append("先生")
                expected = {"actions": [{"id": item_id, "action": ""} for item_id in ids]}
                completion = {"choices": [{"message": {"content": json.dumps(expected)}}]}
                with patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)) as request:
                    result = bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions").suggest(body)
                sent = json.loads(request.call_args.args[0].data)
                prompt = sent["messages"][0]["content"]
                self.assertEqual(json.loads(prompt.splitlines()[-1]), expected)
                self.assertEqual(result["actions"], expected["actions"])
                # Reference-only people still supply context without becoming output slots.
                context = json.loads(sent["messages"][1]["content"])
                self.assertIn("先生", context["previous_panel"]["people"])
                self.assertEqual(len(context["characters"]), 3)

    def test_rejects_extra_person_even_after_all_current_ids_are_returned(self):
        body = self.request_body()
        body["figures"][1]["id"] = "figure-1"
        before = json.dumps(body, ensure_ascii=False)
        completion = {"choices": [{"message": {"content": json.dumps({
            "actions": [{"id": f"figure-{i}", "action": "追加する動作"} for i in range(3)],
        })}}]}
        with (
            patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)),
            patch.object(bridge.sys, "stderr", io.StringIO()),
            self.assertRaisesRegex(ValueError, "入力人物と一致"),
        ):
            bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions").suggest(body)
        self.assertEqual(json.dumps(body, ensure_ascii=False), before)

    def test_bridge_health_reports_the_llm_ownership_mode(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            state = bridge.LocalVisionState(
                root,
                root / "python",
                root / "detector",
                root / "baberu",
                panel_action_llm_mode="external-shared",
            )
        self.assertEqual(state.check()["panel_action_llm_mode"], "external-shared")
        self.assertEqual(state.panel_actions.request_model, "default_model")

    def test_bridge_auto_mode_uses_startup_model_without_selecting_saved_alias(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            state = bridge.LocalVisionState(root, root / "python", root / "detector", root / "baberu")
        self.assertEqual(state.check()["panel_action_llm_mode"], "auto")
        self.assertEqual(state.check()["image_generation_lifecycle_version"], 2)
        self.assertEqual(state.panel_actions.request_model, "default_model")

    def test_rejects_unknown_id_from_model(self):
        completion = {
            "choices": [{"message": {"content": '{"actions":[{"id":"figure-99","action":"創作"}]}'}}],
        }
        suggester = bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions")
        with (
            patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)),
            self.assertRaisesRegex(ValueError, "入力人物と一致"),
        ):
            suggester.suggest(self.request_body())

    def test_identity_mismatch_reports_ids_without_manuscript_or_actions(self):
        for ids, reason in [
            (["figure-0", "figure-99"], "unknown_id"),
            (["figure-0", "figure-0"], "duplicate_id"),
            (["figure-0", 2], "invalid_id_type"),
            (["figure-0"], "missing_id"),
        ]:
            with self.subTest(reason=reason):
                body = self.request_body()
                before = json.dumps(body, ensure_ascii=False)
                completion = {"choices": [{"message": {"content": json.dumps({
                    "actions": [{"id": item_id, "action": "本文は診断ログに記録しない"} for item_id in ids],
                })}}]}
                log = io.StringIO()
                suggester = bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions")
                with (
                    patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)) as request,
                    patch.object(bridge.sys, "stderr", log),
                    self.assertRaises(ValueError) as failure,
                ):
                    suggester.suggest(body)
                diagnostic = json.loads(log.getvalue().split(": ", 1)[1])
                self.assertEqual(diagnostic, {
                    "reason": reason, "page_number": 1, "panel_id": 2,
                    "expected_ids": ["figure-0", "figure-2"],
                    "returned_ids": ids, "returned_count": len(ids),
                })
                self.assertEqual(request.call_count, 1)
                self.assertEqual(json.dumps(body, ensure_ascii=False), before)
                self.assertIn('入力ID: ["figure-0", "figure-2"]', str(failure.exception))
                self.assertIn(f'応答ID: {json.dumps(ids, ensure_ascii=False)}', str(failure.exception))
                self.assertIn("アクションは変更していません", str(failure.exception))
                for secret in ("本文は診断ログに記録しない", body["current_panel"]["panel_action"], body["work"]["synopsis"]):
                    self.assertNotIn(secret, log.getvalue())
                    self.assertNotIn(secret, str(failure.exception))

    def test_identity_diagnostic_is_bounded_and_escapes_control_characters(self):
        actions = [{"id": "bad\n\x1b[31m" + "x" * 1000, "action": "not logged"}] * 100
        log = io.StringIO()
        with patch.object(bridge.sys, "stderr", log):
            error = bridge.PanelActionSuggester.action_identity_error(self.request_body(), actions, "unknown_id", "不一致")
        self.assertEqual(len(log.getvalue().splitlines()), 1)
        diagnostic = json.loads(log.getvalue().split(": ", 1)[1])
        self.assertEqual(diagnostic["returned_count"], 100)
        self.assertEqual(len(diagnostic["returned_ids"]), 20)
        self.assertTrue(all(len(value) == 81 for value in diagnostic["returned_ids"]))
        self.assertNotIn("\x1b", log.getvalue())
        self.assertNotIn("not logged", log.getvalue())
        self.assertLess(len(str(error)), 2500)

    def test_rejects_response_that_omits_a_current_figure(self):
        completion = {
            "choices": [{"message": {"content": '{"actions":[{"id":"figure-0","action":"緊張してユキを見る"}]}'}}],
        }
        suggester = bridge.PanelActionSuggester("http://localhost:8080/v1/chat/completions")
        with (
            patch.object(bridge.urllib_request, "urlopen", return_value=self.FakeResponse(completion)),
            self.assertRaisesRegex(ValueError, "全人物"),
        ):
            suggester.suggest(self.request_body())

    def test_reports_local_server_as_unavailable(self):
        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        with (
            patch.object(bridge.urllib_request, "urlopen", side_effect=bridge.URLError("connection refused")),
            self.assertRaisesRegex(bridge.PanelActionLLMUnavailable, "MLXサーバーを起動"),
        ):
            suggester.suggest(self.request_body())



class ComfyUIDraftGeneratorTest(unittest.TestCase):
    class FakeHeaders:
        def __init__(self, content_type="application/json"):
            self.content_type = content_type

        def get_content_type(self):
            return self.content_type

    class FakeResponse:
        def __init__(self, payload, content_type="application/json"):
            self.payload = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
            self.headers = ComfyUIDraftGeneratorTest.FakeHeaders(content_type)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size):
            return self.payload

    @staticmethod
    def request_body():
        return {
            "attempt_id": "123e4567-e89b-42d3-a456-426614174000",
            "page_number": 3,
            "panel_id": 2,
            "profile": bridge.PANEL_DRAFT_PROFILE,
            "positive_prompt": "Japanese comic panel, アキが驚く",
            "negative_prompt": "text, speech bubble",
            "checkpoint": bridge.PANEL_DRAFT_CHECKPOINT,
            "width": bridge.PANEL_DRAFT_WIDTH,
            "height": bridge.PANEL_DRAFT_HEIGHT,
            "steps": bridge.PANEL_DRAFT_STEPS,
            "cfg": bridge.PANEL_DRAFT_CFG,
            "seed": bridge.PANEL_DRAFT_SEED,
        }

    def test_rejects_non_local_comfyui_endpoint(self):
        with self.assertRaisesRegex(ValueError, "localhost"):
            bridge.ComfyUIDraftGenerator("https://example.com")

    def test_rejects_non_fixed_generation_settings(self):
        body = self.request_body()
        body["profile"] = "finished-anime"
        with self.assertRaisesRegex(ValueError, "manga-base"):
            bridge.ComfyUIDraftGenerator.normalized_request(body)

        body = self.request_body()
        body["width"] = 1024
        with self.assertRaisesRegex(ValueError, "固定"):
            bridge.ComfyUIDraftGenerator.normalized_request(body)

        body = self.request_body()
        body["checkpoint"] = "another-model.safetensors"
        with self.assertRaisesRegex(ValueError, "Animagine"):
            bridge.ComfyUIDraftGenerator.normalized_request(body)

        body = self.request_body()
        body["seed"] = 1
        with self.assertRaisesRegex(ValueError, "シード"):
            bridge.ComfyUIDraftGenerator.normalized_request(body)

    def test_runs_fixed_workflow_and_returns_generated_image(self):
        calls = []
        prompt_id = "123e4567-e89b-42d3-a456-426614174000"

        def fake_urlopen(target, timeout):
            url = target.full_url if isinstance(target, bridge.urllib_request.Request) else target
            calls.append({"url": url, "timeout": timeout, "body": getattr(target, "data", None)})
            if url.endswith("/prompt"):
                return self.FakeResponse({"prompt_id": prompt_id})
            if f"/history/{prompt_id}" in url:
                return self.FakeResponse({
                    prompt_id: {
                        "outputs": {
                            "7": {"images": [{
                                "filename": "page_0003_panel_0002_00001_.png",
                                "subfolder": "manga_base_drafts",
                                "type": "output",
                            }]},
                        },
                    },
                })
            if "/view?" in url:
                return self.FakeResponse(
                    valid_panel_draft_png((120, 130, 140)),
                    "image/png",
                )
            raise AssertionError(f"unexpected URL: {url}")

        generator = bridge.ComfyUIDraftGenerator("http://127.0.0.1:8188")
        with patch.object(bridge.urllib_request, "urlopen", side_effect=fake_urlopen), patch.object(
            generator,
            "manga_base_png",
            return_value=b"\x89PNG\r\n\x1a\nmanga-base",
        ):
            result = generator.generate(self.request_body())

        queued = json.loads(calls[0]["body"].decode("utf-8"))["prompt"]
        submitted = json.loads(calls[0]["body"].decode("utf-8"))
        self.assertEqual(submitted["prompt_id"], prompt_id)
        self.assertEqual(queued["1"]["inputs"]["ckpt_name"], bridge.PANEL_DRAFT_CHECKPOINT)
        self.assertEqual(queued["4"]["inputs"], {"width": 512, "height": 512, "batch_size": 1})
        self.assertEqual(queued["5"]["inputs"]["steps"], 20)
        self.assertEqual(queued["5"]["inputs"]["cfg"], 6.0)
        self.assertEqual(queued["5"]["inputs"]["sampler_name"], "euler")
        self.assertEqual(queued["7"]["inputs"]["filename_prefix"], "manga_base_drafts/page_0003_panel_0002")
        self.assertEqual(result["prompt_id"], prompt_id)
        self.assertEqual(result["file_name"], "page_0003_panel_0002_00001_.png")
        self.assertEqual(result["download_name"], "manga-base_page_0003_panel_0002_seed_2026082901.png")
        self.assertEqual(result["profile"], "manga-base")
        self.assertEqual(result["palette"], bridge.MANGA_BASE_PALETTE)
        self.assertTrue(result["image"].startswith("data:image/png;base64,"))
        self.assertIn("filename=page_0003_panel_0002_00001_.png", calls[2]["url"])

    def test_maps_generated_colors_to_exact_manga_base_palette(self):
        nearest = bridge.ComfyUIDraftGenerator.nearest_manga_base_color
        self.assertEqual(nearest(5, 7, 8), (0, 0, 0, 255))
        self.assertEqual(nearest(220, 20, 30), (230, 0, 18, 255))
        self.assertEqual(nearest(20, 205, 225), (0, 215, 232, 255))
        self.assertEqual(nearest(245, 245, 240), (255, 255, 255, 255))
        self.assertEqual(nearest(150, 150, 150), (230, 0, 18, 255))
        self.assertEqual(nearest(200, 200, 200), (0, 215, 232, 255))
        self.assertEqual(nearest(0, 0, 0, 0), (255, 255, 255, 255))

    def test_keeps_light_tone_between_ink_spans_and_whitens_outer_paper(self):
        dark = (20, 20, 20, 255)
        light = (190, 190, 190, 255)
        pixels = [
            light, dark, light, dark, light,
            light, dark, light, dark, light,
            light, light, light, light, light,
        ]
        paper = bridge.ComfyUIDraftGenerator.paper_pixels_outside_ink(pixels, 5, 3)
        self.assertEqual(paper, {0, 4, 5, 9, 10, 11, 12, 13, 14})


if __name__ == "__main__":
    unittest.main()
