"""HTTP request handling for the local image bridge."""

from __future__ import annotations

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from nyamuru_bridge_constants import ALLOWED_ORIGIN, MAX_BODY_BYTES
from nyamuru_bridge_identity import BRIDGE_SERVICE_NAME, LAYOUT_PROTOCOL_VERSION
from nyamuru_vision_state import LocalVisionState
from nyamuru_ocr_util import decode_image_data, normalized_rotation_override
from nyamuru_scanner_sessions import quit_image_capture
from nyamuru_series_catalog_store import SeriesCatalogConflict, discover_reference_text_candidates
from nyamuru_episode_workspace import CoverageReportConflict
from nyamuru_panel_actions import PanelActionLLMUnavailable
from nyamuru_comfy_draft import ComfyUIUnavailable
from nyamuru_project_store import load_project, save_project
from nyamuru_editor_voice import EditorVoiceError
from nyamuru_agent_connection import connection_status
from nyamuru_agent_chat import AgentChatUnavailable
from nyamuru_model_connections import image_generation_connections


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "NyamuruLocalBridge/0.2"

    @property
    def state(self) -> LocalVisionState:
        return self.server.state  # type: ignore[attr-defined]

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin is None:
            return None
        return origin if ALLOWED_ORIGIN.fullmatch(origin) else ""

    def send_json(self, status: int, payload: object) -> None:
        if isinstance(payload, dict):
            payload = {
                **payload,
                "service": BRIDGE_SERVICE_NAME,
                "layout_protocol_version": LAYOUT_PROTOCOL_VERSION,
            }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        if self.allowed_origin() == "":
            self.send_json(403, {"error": "このOriginからの接続は許可されていません"})
            return
        self.send_response(204)
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.allowed_origin() == "":
            self.send_json(403, {"error": "このOriginからの接続は許可されていません"})
            return
        if urlparse(self.path).path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "service": BRIDGE_SERVICE_NAME,
                "layout_protocol_version": LAYOUT_PROTOCOL_VERSION,
                **self.state.check(),
            })
        else:
            self.send_json(404, {"error": "Not found"})

    def read_json(self) -> dict[str, Any]:
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            raise ValueError("Content-Typeはapplication/jsonで送信してください")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Lengthが正しくありません") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("リクエストサイズが上限を超えています")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("JSONオブジェクトが必要です")
        return value

    def do_POST(self) -> None:
        if self.allowed_origin() == "":
            self.send_json(403, {"error": "このOriginからの接続は許可されていません"})
            return
        try:
            body = self.read_json()
            path = urlparse(self.path).path
            if path == "/api/image-generation/connections":
                self.send_json(200, image_generation_connections(body, self.state.qwen_jobs, self.state.panel_drafts))
                return
            if path == "/api/agent/chat":
                self.send_json(200, self.state.agent_chat.respond(body))
                return
            if path == "/api/agent/status":
                if body:
                    raise ValueError('接続確認に追加項目は指定できません')
                self.send_json(200, connection_status(self.state.panel_actions.endpoint))
                return
            if path == "/api/voice/transcribe":
                self.send_json(200, self.state.editor_voice.transcribe(body))
                return
            if path == "/api/voice/classify":
                self.send_json(200, self.state.voice_intent.classify(body))
                return
            # 保存先pathを受け付けず、固定catalogの確認済み一覧だけを公開する。
            if path == "/api/human-pose/catalog":
                self.send_json(200, self.state.human_poses.catalog(include_previews=True))
                return
            if path == "/api/human-pose/scene":
                self.send_json(200, self.state.human_poses.scene(body.get("pose_id"), body.get("catalog_sha256"), body.get("include_base", True)))
                return
            if path == "/api/series/directory/choose":
                result = self.state.series_catalogs.choose_directory(body.get("default_directory"))
                if result.get("cancelled") is not True:
                    directory = Path(str(result["series_directory"]))
                    result["reference"] = self.state.panel_actions.suggest_reference_text(
                        discover_reference_text_candidates(directory, "series"),
                        "series",
                    )
                self.send_json(200, result)
                return
            if path == "/api/episode-workspace/select":
                self.send_json(200, self.state.episode_workspaces.select(body.get("default_directory")))
                return
            if path == "/api/episode-workspace/project/save":
                directory = self.state.episode_workspaces.directory(body.get("workspace_token"))
                self.send_json(200, save_project(directory, body.get("snapshot"), body.get("expected_revision")))
                return
            if path == "/api/episode-workspace/project/load":
                directory = self.state.episode_workspaces.directory(body.get("workspace_token"))
                self.send_json(200, load_project(directory))
                return
            if path == "/api/episode-workspace/reference-suggest":
                candidates = self.state.episode_workspaces.reference_candidates(body.get("workspace_token"))
                self.send_json(200, {
                    "ok": True,
                    **self.state.panel_actions.suggest_reference_text(candidates, "episode"),
                })
                return
            if path == "/api/episode-workspace/prepare":
                self.send_json(200, self.state.episode_workspaces.prepare(body.get("workspace_token")))
                return
            if path == "/api/episode-workspace/choose-text":
                self.send_json(200, self.state.episode_workspaces.choose_text(body.get("workspace_token")))
                return
            if path == "/api/episode-workspace/source-coverage/save":
                self.send_json(200, self.state.episode_workspaces.save_source_coverage(
                    body.get("workspace_token"),
                    body.get("episode_id"),
                    body.get("report"),
                ))
                return
            if path == "/api/episode-workspace/choose-images":
                self.send_json(200, self.state.episode_workspaces.choose_images(
                    body.get("workspace_token"),
                    body.get("max_files"),
                ))
                return
            if path == "/api/series/reference-text/choose":
                self.send_json(200, self.state.series_catalogs.choose_reference_text(
                    body.get("series_id"),
                    body.get("default_directory"),
                ))
                return
            if path == "/api/scanner/open":
                session = self.state.scanners.start()
                try:
                    subprocess.run(["/usr/bin/open", "-b", "com.apple.Image_Capture"], check=True, timeout=10)
                except Exception:
                    self.state.scanners.cancel(session["session_id"])
                    raise
                self.send_json(200, {"ok": True, **session})
                return
            if path == "/api/scanner/collect":
                self.send_json(200, self.state.scanners.collect(body.get("session_id")))
                return
            if path == "/api/scanner/pending":
                self.send_json(200, self.state.scanners.pending())
                return
            if path == "/api/scanner/resume":
                self.send_json(200, self.state.scanners.resume())
                return
            if path == "/api/scanner/discard-pending":
                self.send_json(200, self.state.scanners.discard_pending())
                return
            if path == "/api/scanner/commit":
                self.send_json(200, self.state.scanners.commit(body.get("session_id")))
                return
            if path == "/api/scanner/finish":
                quit_image_capture()
                self.send_json(200, self.state.scanners.finish(body.get("session_id")))
                return
            if path == "/api/scanner/cancel":
                session_id = body.get("session_id")
                if not isinstance(session_id, str):
                    raise ValueError("スキャン待機セッションが見つかりません")
                quit_image_capture()
                self.send_json(200, self.state.scanners.cancel(session_id))
                return
            if path == "/api/layout/analyze":
                rotation_override = normalized_rotation_override(body.get("rotation_override_degrees"))
                with self.state.analysis_lock:
                    result = self.state.analyze(decode_image_data(body.pop("image", None)), rotation_override)
                self.send_json(200, result)
                return
            if path == "/api/figure-performance/analyze":
                with self.state.analysis_lock:
                    result = self.state.analyze_figure_performance(
                        decode_image_data(body.pop("image", None)),
                        body.get("current_size"),
                        body.get("vlm_model"),
                    )
                self.send_json(200, result)
                return
            if path == "/api/character-reference/analyze":
                with self.state.analysis_lock:
                    result = self.state.analyze_character_reference(
                        decode_image_data(body.pop("image", None)),
                        body.get("target_character"),
                        body.get("vlm_model"),
                    )
                self.send_json(200, result)
                return
            if path == "/api/character-reference/analyze-set":
                with self.state.analysis_lock:
                    result = self.state.analyze_character_reference_set(
                        body.get("series_id"),
                        body.get("character_catalog_id"),
                        body.get("asset_ids"),
                        body.get("target_character"),
                        body.get("vlm_model"),
                        supplied_images_value=body.get("images"),
                    )
                self.send_json(200, result)
                return
            if path == "/api/character-match/analyze":
                with self.state.analysis_lock:
                    result = self.state.analyze_character_match(
                        decode_image_data(body.pop("image", None)),
                        body.get("candidates"),
                        body.get("current_size"),
                        body.get("vlm_model"),
                    )
                self.send_json(200, result)
                return
            if path == "/api/panel-actions/suggest":
                with self.state.panel_action_lock:
                    result = self.state.panel_actions.suggest(body)
                self.send_json(200, result)
                return
            if path == "/api/panel-draft/generate":
                self.send_json(200, self.state.panel_draft_jobs.generate(body))
                return
            if path == "/api/qwen-generation/prepare":
                with self.state.panel_action_lock:
                    result = self.state.qwen_jobs.prepare(body, self.state.panel_actions.translate_image_generation_prompt)
                self.send_json(200, result)
                return
            if path == "/api/qwen-generation/submit":
                self.send_json(200, self.state.qwen_jobs.submit(body))
                return
            if path == "/api/qwen-generation/reconcile":
                self.send_json(200, self.state.qwen_jobs.reconcile(body))
                return
            if path == "/api/qwen-generation/list":
                self.send_json(200, self.state.qwen_jobs.list(body))
                return
            if path == "/api/qwen-generation/delete":
                self.send_json(200, self.state.qwen_jobs.delete(body))
                return
            if path == "/api/layer-generation/cache/list":
                self.send_json(200, self.state.generation_cache.summary())
                return
            if path == "/api/layer-generation/cache/delete":
                self.send_json(200, self.state.generation_cache.delete(body))
                return
            if path == "/api/panel-draft/list":
                self.send_json(200, self.state.panel_draft_jobs.list(body))
                return
            if path == "/api/panel-draft/reconcile":
                self.send_json(200, self.state.panel_draft_jobs.reconcile(body))
                return
            if path == "/api/panel-draft/review":
                self.send_json(200, self.state.panel_draft_jobs.review(body))
                return
            if path == "/api/series/load":
                self.send_json(200, self.state.series_catalogs.load(body.get("series_name"), body.get("series_id")))
                return
            if path == "/api/series/list":
                self.send_json(200, self.state.series_catalogs.list_catalogs())
                return
            if path == "/api/series/draft/begin":
                self.send_json(200, self.state.series_catalogs.begin_draft(
                    body.get("series_name"),
                    body.get("series_id"),
                    body.get("episode_id"),
                ))
                return
            if path == "/api/series/draft/discard":
                self.send_json(200, self.state.series_catalogs.discard_draft(body.get("draft_token")))
                return
            if path == "/api/series/draft/commit":
                self.send_json(200, self.state.series_catalogs.commit_draft(body.get("draft_token")))
                return
            if path == "/api/series/save":
                self.send_json(200, self.state.series_catalogs.save(
                    body.get("series_name"),
                    body.get("series_id"),
                    body.get("omny_yaml"),
                    body.get("expected_revision"),
                    body.get("series_directory"),
                    body.get("series_text_relative_path"),
                ))
                return
            if path == "/api/series/discard-unsaved":
                self.send_json(200, self.state.series_catalogs.discard_unsaved(
                    body.get("series_name"),
                    body.get("series_id"),
                    body.get("episode_id"),
                ))
                return
            if path == "/api/series/character-text/status":
                self.send_json(200, self.state.series_catalogs.character_text_status(body.get("series_id")))
                return
            if path == "/api/series/character-text/link":
                self.send_json(200, self.state.series_catalogs.link_character_text(
                    body.get("series_name"),
                    body.get("series_id"),
                    body.get("default_directory"),
                ))
                return
            if path == "/api/series/character-text/sync":
                self.send_json(200, self.state.series_catalogs.sync_character_text(
                    body.get("series_id"),
                    body.get("markdown"),
                    body.get("active_character_ids"),
                    body.get("archive"),
                ))
                return
            if path == "/api/series/character-text/restore":
                self.send_json(200, self.state.series_catalogs.restore_character_text(
                    body.get("series_id"),
                    body.get("deletion_id"),
                ))
                return
            if path == "/api/series/character-images/save":
                self.send_json(200, self.state.series_catalogs.save_character_image(
                    body.get("series_id"),
                    body.get("character_catalog_id"),
                    body.get("original_name"),
                    decode_image_data(body.pop("image", None)),
                ))
                return
            if path == "/api/series/background-models/save":
                self.send_json(200, self.state.series_catalogs.save_background_model(
                    body.get("series_id"), body.get("stage"), body.pop("model_data", None),
                ))
                return
            if path == "/api/series/background-models/load":
                self.send_json(200, self.state.series_catalogs.load_background_model(
                    body.get("series_id"), body.get("stage_id"), body.get("format"),
                    body.get("verify_only", False),
                ))
                return
            if path == "/api/series/character-images/load":
                self.send_json(200, self.state.series_catalogs.load_character_image(
                    body.get("series_id"),
                    body.get("character_catalog_id"),
                    body.get("asset_id"),
                ))
                return
            if path == "/api/series/character-images/delete":
                self.send_json(200, self.state.series_catalogs.delete_character_image(
                    body.get("series_id"),
                    body.get("character_catalog_id"),
                    body.get("asset_id"),
                ))
                return
            if path == "/api/analog-assets/save":
                self.send_json(200, self.state.analog_assets.save(
                    body.get("episode_id"),
                    body.get("work_title"),
                    body.get("kind"),
                    body.get("asset_id"),
                    decode_image_data(body.pop("image", None)),
                ))
                return
            if path == "/api/analog-assets/load":
                self.send_json(200, self.state.analog_assets.load(
                    body.get("work_key"),
                    body.get("kind"),
                    body.get("file_name"),
                ))
                return
            self.send_json(404, {"error": "Not found"})
        except (SeriesCatalogConflict, CoverageReportConflict) as exc:
            self.send_json(409, {"error": str(exc)})
        except EditorVoiceError as exc:
            self.send_json(exc.status_code, {"error": str(exc)})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except (PanelActionLLMUnavailable, ComfyUIUnavailable, AgentChatUnavailable) as exc:
            self.send_json(503, {"error": str(exc)})
        except subprocess.SubprocessError as exc:
            self.send_json(500, {"error": f"スキャナーアプリを操作できませんでした: {exc}"})
        except Exception as exc:
            print(f"[bridge] error: {exc}", file=sys.stderr)
            self.send_json(500, {"error": f"ローカル処理に失敗しました: {exc}"})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[bridge] {self.address_string()} {fmt % args}")
