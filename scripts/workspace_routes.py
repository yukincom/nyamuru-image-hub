"""POST routes for series catalogs, episode workspaces, and analog assets."""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from nyamuru_ocr_util import decode_image_data
from project_file_picker import choose_project_files
from nyamuru_project_store import export_yaml_files, load_project, save_project
from nyamuru_series_catalog_store import discover_reference_text_candidates

if TYPE_CHECKING:
    from nyamuru_bridge_http import BridgeHandler


def file_picker_directory(handler: BridgeHandler, body: dict[str, Any]) -> object:
    if body.get("series_id"):
        catalogs = handler.state.series_catalogs
        metadata = catalogs.metadata_for(catalogs.checked_id(body["series_id"])) or {}
        reference = catalogs.character_text_reference(metadata)
        registered = reference.get("series_directory") or metadata.get("series_directory")
        if registered and Path(registered).is_dir():
            return registered
    return body.get("default_directory")


def handle_workspace_post(handler: BridgeHandler, path: str, body: dict[str, Any]) -> None:
    if path == "/api/series/directory/choose":
        result = handler.state.series_catalogs.choose_directory(body.get("default_directory"))
        if result.get("cancelled") is not True:
            directory = Path(str(result["series_directory"]))
            result["reference"] = handler.state.panel_actions.suggest_reference_text(
                discover_reference_text_candidates(directory, "series"),
                "series",
            )
        handler.send_json(200, result)
        return
    if path == "/api/episode-workspace/select":
        handler.send_json(200, handler.state.episode_workspaces.select(file_picker_directory(handler, body)))
        return
    if path == "/api/episode-workspace/project/save":
        directory = handler.state.episode_workspaces.directory(body.get("workspace_token"))
        handler.send_json(200, save_project(directory, body.get("snapshot"), body.get("expected_revision")))
        return
    if path == "/api/episode-workspace/project/load":
        directory = handler.state.episode_workspaces.directory(body.get("workspace_token"))
        handler.send_json(200, load_project(directory))
        return
    if path == "/api/episode-workspace/export-yaml":
        directory = handler.state.episode_workspaces.directory(body.get("workspace_token"))
        handler.send_json(200, export_yaml_files(directory, body.get("files")))
        return
    if path == "/api/episode-workspace/reference-suggest":
        candidates = handler.state.episode_workspaces.reference_candidates(body.get("workspace_token"))
        handler.send_json(200, {
            "ok": True,
            **handler.state.panel_actions.suggest_reference_text(candidates, "episode"),
        })
        return
    if path == "/api/episode-workspace/prepare":
        handler.send_json(200, handler.state.episode_workspaces.prepare(body.get("workspace_token")))
        return
    if path == "/api/episode-workspace/choose-files":
        handler.send_json(200, choose_project_files(
            file_picker_directory(handler, body), body.get("accept", ""), body.get("multiple") is True,
        ))
        return
    if path == "/api/episode-workspace/choose-text":
        handler.send_json(200, handler.state.episode_workspaces.choose_text(body.get("workspace_token"), file_picker_directory(handler, body)))
        return
    if path == "/api/episode-workspace/source-coverage/save":
        handler.send_json(200, handler.state.episode_workspaces.save_source_coverage(
            body.get("workspace_token"),
            body.get("episode_id"),
            body.get("report"),
        ))
        return
    if path == "/api/episode-workspace/choose-images":
        handler.send_json(200, handler.state.episode_workspaces.choose_images(
            body.get("workspace_token"),
            body.get("max_files"),
            body.get("default_directory"),
        ))
        return
    if path == "/api/series/reference-text/choose":
        handler.send_json(200, handler.state.series_catalogs.choose_reference_text(
            body.get("series_id"),
            body.get("default_directory"),
        ))
        return
    if path == "/api/series/load":
        handler.send_json(200, handler.state.series_catalogs.load(body.get("series_name"), body.get("series_id")))
        return
    if path == "/api/series/list":
        handler.send_json(200, handler.state.series_catalogs.list_catalogs())
        return
    if path == "/api/series/draft/begin":
        handler.send_json(200, handler.state.series_catalogs.begin_draft(
            body.get("series_name"),
            body.get("series_id"),
            body.get("episode_id"),
        ))
        return
    if path == "/api/series/draft/discard":
        handler.send_json(200, handler.state.series_catalogs.discard_draft(body.get("draft_token")))
        return
    if path == "/api/series/draft/commit":
        handler.send_json(200, handler.state.series_catalogs.commit_draft(body.get("draft_token")))
        return
    if path == "/api/series/save":
        handler.send_json(200, handler.state.series_catalogs.save(
            body.get("series_name"),
            body.get("series_id"),
            body.get("omny_yaml"),
            body.get("expected_revision"),
            body.get("series_directory"),
            body.get("series_text_relative_path"),
        ))
        return
    if path == "/api/series/discard-unsaved":
        handler.send_json(200, handler.state.series_catalogs.discard_unsaved(
            body.get("series_name"),
            body.get("series_id"),
            body.get("episode_id"),
        ))
        return
    if path == "/api/series/character-text/status":
        handler.send_json(200, handler.state.series_catalogs.character_text_status(body.get("series_id")))
        return
    if path == "/api/series/character-text/link":
        handler.send_json(200, handler.state.series_catalogs.link_character_text(
            body.get("series_name"),
            body.get("series_id"),
            body.get("default_directory"),
        ))
        return
    if path == "/api/series/character-text/sync":
        handler.send_json(200, handler.state.series_catalogs.sync_character_text(
            body.get("series_id"),
            body.get("markdown"),
            body.get("active_character_ids"),
            body.get("archive"),
        ))
        return
    if path == "/api/series/character-text/restore":
        handler.send_json(200, handler.state.series_catalogs.restore_character_text(
            body.get("series_id"),
            body.get("deletion_id"),
        ))
        return
    if path == "/api/series/character-images/save":
        handler.send_json(200, handler.state.series_catalogs.save_character_image(
            body.get("series_id"),
            body.get("character_catalog_id"),
            body.get("original_name"),
            decode_image_data(body.pop("image", None)),
        ))
        return
    if path == "/api/series/background-models/save":
        handler.send_json(200, handler.state.series_catalogs.save_background_model(
            body.get("series_id"), body.get("stage"), body.pop("model_data", None),
        ))
        return
    if path == "/api/series/background-models/load":
        handler.send_json(200, handler.state.series_catalogs.load_background_model(
            body.get("series_id"), body.get("stage_id"), body.get("format"),
            body.get("verify_only", False),
        ))
        return
    if path == "/api/series/character-images/load":
        handler.send_json(200, handler.state.series_catalogs.load_character_image(
            body.get("series_id"),
            body.get("character_catalog_id"),
            body.get("asset_id"),
        ))
        return
    if path == "/api/series/character-images/delete":
        handler.send_json(200, handler.state.series_catalogs.delete_character_image(
            body.get("series_id"),
            body.get("character_catalog_id"),
            body.get("asset_id"),
        ))
        return
    if path == "/api/analog-assets/save":
        handler.send_json(200, handler.state.analog_assets.save(
            body.get("episode_id"),
            body.get("work_title"),
            body.get("kind"),
            body.get("asset_id"),
            decode_image_data(body.pop("image", None)),
        ))
        return
    if path == "/api/analog-assets/load":
        handler.send_json(200, handler.state.analog_assets.load(
            body.get("work_key"),
            body.get("kind"),
            body.get("file_name"),
        ))
        return
    handler.send_json(404, {"error": "Not found"})
