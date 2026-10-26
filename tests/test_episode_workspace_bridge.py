import base64
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "nyamuru_local_bridge.py"
SPEC = importlib.util.spec_from_file_location("nyamuru_local_bridge_episode_workspace", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)

import nyamuru_series_catalog_store as series_catalog_store
import nyamuru_episode_workspace as episode_workspace


class EpisodeWorkspaceManagerTest(unittest.TestCase):
    def test_registry_failures_preserve_saved_state_and_clean_temporary_files(self):
        for failure in ("serialize", "fsync", "chmod", "replace"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory_name:
                root = Path(directory_name)
                state = root / "workspace-state.json"
                manager = bridge.EpisodeWorkspaceManager(state)
                manager._persist()
                before = state.read_bytes()
                keep = root / "tmp-user-owned"
                keep.write_bytes(b"keep")
                manager.directories["a" * 32] = root.resolve()
                target = episode_workspace.json if failure == "serialize" else episode_workspace.os
                name = "dump" if failure == "serialize" else failure
                with patch.object(target, name, side_effect=OSError("injected failure")):
                    with self.assertRaisesRegex(OSError, "injected"):
                        manager._persist()
                self.assertEqual(state.read_bytes(), before)
                self.assertEqual(set(root.iterdir()), {state, keep})
                manager._persist()
                self.assertEqual(bridge.EpisodeWorkspaceManager(state).directories, manager.directories)

    def test_selects_one_shot_or_series_episode_without_requiring_an_origin_folder_name(self):
        with tempfile.TemporaryDirectory() as directory_name:
            episode = Path(directory_name) / "no.1.5"
            episode.mkdir()
            (episode / "元データ").mkdir()
            manager = bridge.EpisodeWorkspaceManager(Path(directory_name) / "workspace-state.json")

            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                selected = manager.select(episode.parent)

            self.assertFalse(selected["cancelled"])
            self.assertEqual(selected["directory"], str(episode.resolve()))
            self.assertEqual(selected["series_directory"], str(episode.parent.resolve()))
            self.assertTrue((episode / "元データ").is_dir())
            self.assertFalse((episode / "name_data").exists())

    def test_prepares_only_nyamuru_managed_directories_and_reuses_existing_ones(self):
        with tempfile.TemporaryDirectory() as directory_name:
            episode = Path(directory_name) / "読み切り"
            episode.mkdir()
            origin = episode / "origin_data"
            origin.mkdir()
            source = origin / "scan.jpeg"
            source.write_bytes(b"original")
            (episode / "draft_data").mkdir()
            manager = bridge.EpisodeWorkspaceManager(Path(directory_name) / "workspace-state.json")
            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                selected = manager.select(episode.parent)

            result = manager.prepare(selected["workspace_token"])

            self.assertEqual(result["managed_directories"], list(bridge.EPISODE_WORKSPACE_DIRECTORIES))
            self.assertEqual(set(result["created"]), {"name_data", "manuscript_data", "export_data"})
            self.assertEqual(source.read_bytes(), b"original")
            for name in bridge.EPISODE_WORKSPACE_DIRECTORIES:
                self.assertTrue((episode / name).is_dir())

    def test_file_pickers_start_from_episode_and_return_selected_text_and_images(self):
        with tempfile.TemporaryDirectory() as directory_name:
            episode = Path(directory_name) / "episode"
            episode.mkdir()
            text_file = episode / "元データ" / "plot.md"
            text_file.parent.mkdir()
            text_file.write_text("# あらすじ\n本文", encoding="utf-8")
            image_file = episode / "元データ" / "scan.png"
            image_file.write_bytes(b"\x89PNG\r\n\x1a\nimage")
            manager = bridge.EpisodeWorkspaceManager(Path(directory_name) / "workspace-state.json")
            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                selected = manager.select(episode.parent)
            token = selected["workspace_token"]

            with patch.object(episode_workspace, "choose_workspace_files", return_value=[text_file]) as choose_text:
                text_result = manager.choose_text(token)
            with patch.object(episode_workspace, "choose_workspace_files", return_value=[image_file]) as choose_images:
                image_result = manager.choose_images(token, 10)

            choose_text.assert_called_once_with(episode.resolve(), "text", False)
            choose_images.assert_called_once_with(episode.resolve(), "image", True)
            self.assertEqual(text_result["text"], "# あらすじ\n本文")
            self.assertEqual(image_result["files"][0]["filename"], "scan.png")
            encoded = image_result["files"][0]["image"].split(",", 1)[1]
            self.assertEqual(base64.b64decode(encoded), image_file.read_bytes())

    def test_name_collision_does_not_leave_partially_created_directories(self):
        with tempfile.TemporaryDirectory() as directory_name:
            episode = Path(directory_name) / "episode"
            episode.mkdir()
            (episode / "manuscript_data").write_text("collision", encoding="utf-8")
            manager = bridge.EpisodeWorkspaceManager(Path(directory_name) / "workspace-state.json")
            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                selected = manager.select(episode.parent)

            with self.assertRaisesRegex(ValueError, "manuscript_data"):
                manager.prepare(selected["workspace_token"])

            self.assertFalse((episode / "name_data").exists())
            self.assertFalse((episode / "draft_data").exists())
            self.assertFalse((episode / "export_data").exists())

    def test_cancel_does_not_register_a_workspace(self):
        with tempfile.TemporaryDirectory() as directory_name:
            manager = bridge.EpisodeWorkspaceManager(Path(directory_name) / "workspace-state.json")
            with patch.object(episode_workspace, "choose_episode_directory", return_value=None):
                result = manager.select("")
            self.assertTrue(result["cancelled"])
            self.assertEqual(manager.directories, {})

    def test_discovers_episode_text_but_excludes_character_markdown(self):
        with tempfile.TemporaryDirectory() as directory_name:
            episode = Path(directory_name) / "no.1.5"
            story = episode / "origin_data" / "text" / "origin_name.md"
            character = episode / "character.md"
            story.parent.mkdir(parents=True)
            story.write_text("# あらすじ\nこの話の本文", encoding="utf-8")
            character.write_text("# 登場人物\n### 主人公", encoding="utf-8")
            manager = bridge.EpisodeWorkspaceManager(Path(directory_name) / "workspace-state.json")
            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                selected = manager.select(episode.parent)

            candidates = manager.reference_candidates(selected["workspace_token"])

            self.assertEqual(candidates[0]["relative_path"], "origin_data/text/origin_name.md")
            self.assertNotIn("character.md", [item["relative_path"] for item in candidates])

    def test_recovers_opaque_workspace_token_after_bridge_restart(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            episode = root / "episode"
            episode.mkdir()
            state_path = root / "workspace-state.json"
            first = bridge.EpisodeWorkspaceManager(state_path)
            with patch.object(episode_workspace, "choose_episode_directory", return_value=episode):
                selected = first.select(root)

            recovered = bridge.EpisodeWorkspaceManager(state_path)

            self.assertEqual(recovered.directory(selected["workspace_token"]), episode.resolve())
            self.assertEqual(state_path.stat().st_mode & 0o777, 0o600)


class SeriesReferenceTextTest(unittest.TestCase):
    def test_candidate_discovery_never_reads_symlinks_outside_the_series_root(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name)
            series = root / "作品"
            series.mkdir()
            outside = root / "outside-secret.md"
            outside.write_text("# シリーズ設定\nOUTSIDE-SECRET", encoding="utf-8")
            (series / "series_setting.md").symlink_to(outside)

            candidates = bridge.discover_reference_text_candidates(series, "series")

            self.assertEqual(candidates, [])

    def test_character_markdown_is_the_series_reference_candidate(self):
        with tempfile.TemporaryDirectory() as directory_name:
            series = Path(directory_name) / "作品"
            character = series / "character_data" / "character.md"
            story = series / "no.1.5" / "origin_data" / "text" / "origin_name.md"
            character.parent.mkdir(parents=True)
            story.parent.mkdir(parents=True)
            character.write_text("# 登場人物設定\n\n### 主人公", encoding="utf-8")
            story.write_text("# あらすじ\nこの話の本文", encoding="utf-8")

            candidates = bridge.discover_reference_text_candidates(series, "series")
            suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
            result = suggester.suggest_reference_text(candidates, "series")

            self.assertEqual(result["suggestion"]["file_name"], "character.md")
            self.assertEqual(result["suggestion"]["selected_by"], "rules")

    def test_series_setting_and_fuzzy_world_text_are_both_candidates(self):
        with tempfile.TemporaryDirectory() as directory_name:
            series = Path(directory_name) / "作品"
            text = series / "text"
            character = series / "character_data" / "character.md"
            exact = text / "series_setting.md"
            fuzzy = text / "世界観の設定.text"
            episode = series / "no.1" / "origin_data" / "text" / "origin_name.md"
            character.parent.mkdir(parents=True)
            text.mkdir(parents=True)
            episode.parent.mkdir(parents=True)
            character.write_text("# 登場人物設定\n\n### 主人公", encoding="utf-8")
            exact.write_text("# シリーズ設定\n\n## ジャンル\n現代SF", encoding="utf-8")
            fuzzy.write_text("# 世界観\n夢と現実を行き来する。", encoding="utf-8")
            episode.write_text("# あらすじ\n今回の話", encoding="utf-8")

            candidates = bridge.discover_reference_text_candidates(series, "series")
            by_name = {item["file_name"]: item for item in candidates}

            self.assertEqual(by_name["series_setting.md"]["kind"], "series-setting")
            self.assertTrue(by_name["series_setting.md"]["recommended"])
            self.assertEqual(by_name["世界観の設定.text"]["kind"], "series-setting")
            self.assertEqual(by_name["character.md"]["kind"], "characters")
            self.assertNotIn("origin_name.md", by_name)

            suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
            with patch.object(suggester, "request_json_completion") as llm:
                result = suggester.suggest_reference_text(candidates, "series")
            llm.assert_not_called()
            self.assertEqual({item["file_name"] for item in result["candidates"]}, {
                "series_setting.md", "世界観の設定.text", "character.md",
            })

    def test_close_episode_candidates_remain_ambiguous_without_starting_llm(self):
        candidates = [
            {"candidate_id": "a", "relative_path": "notes-a.md", "file_name": "notes-a.md", "text": "A", "excerpt": "A", "score": 20, "signals": []},
            {"candidate_id": "b", "relative_path": "notes-b.md", "file_name": "notes-b.md", "text": "B", "excerpt": "B", "score": 20, "signals": []},
        ]
        suggester = bridge.PanelActionSuggester("http://127.0.0.1:8080/v1/chat/completions")
        with patch.object(suggester, "request_json_completion") as llm:
            result = suggester.suggest_reference_text(candidates, "episode")
        llm.assert_not_called()
        self.assertTrue(result["ambiguous"])
        self.assertIsNone(result["suggestion"])

    def test_catalog_remembers_series_directory_and_reference_text(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name) / "catalogs"
            series_directory = Path(directory_name) / "作品"
            text_file = series_directory / "character_data" / "character.md"
            text_file.parent.mkdir(parents=True)
            text_file.write_text("# 登場人物設定\n\n### 主人公", encoding="utf-8")
            store = bridge.SeriesCatalogStore(root)

            store.save(
                "猫の旅",
                "series-one",
                "manga: {}\n",
                "",
                str(series_directory),
                "character_data/character.md",
            )

            self.assertEqual(store.list_catalogs()["series"], [{
                "series_id": "series-one",
                "series_name": "猫の旅",
                "updated_at": store.metadata_for("series-one")["updated_at"],
                "series_directory": str(series_directory.resolve()),
                "series_text_file_name": "character.md",
            }])
            with patch.object(series_catalog_store, "choose_workspace_files", return_value=[text_file]) as chooser:
                result = store.choose_reference_text("series-one", "")
            chooser.assert_called_once_with(series_directory.resolve(), "character-text", False)
            self.assertEqual(result["relative_path"], "character_data/character.md")
            self.assertEqual(result["text"], "# 登場人物設定\n\n### 主人公")

    def test_reference_picker_does_not_save_an_unconfirmed_catalog(self):
        with tempfile.TemporaryDirectory() as directory_name:
            root = Path(directory_name) / "catalogs"
            series_directory = Path(directory_name) / "新シリーズ"
            series_directory.mkdir()
            text_file = series_directory / "series.md"
            text_file.write_text("## シリーズ共通", encoding="utf-8")
            store = bridge.SeriesCatalogStore(root)

            with patch.object(series_catalog_store, "choose_workspace_files", return_value=[text_file]):
                result = store.choose_reference_text("new-series", str(series_directory))

            self.assertFalse(result["cancelled"])
            self.assertFalse(root.exists())


if __name__ == "__main__":
    unittest.main()
