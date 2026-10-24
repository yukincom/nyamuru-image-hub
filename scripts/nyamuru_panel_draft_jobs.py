"""Panel draft generation, reconciliation, listing, and review orchestration."""

from __future__ import annotations

import json
import platform
from datetime import datetime, timezone
from typing import Any

from nyamuru_bridge_identity import BRIDGE_SERVICE_NAME, LAYOUT_PROTOCOL_VERSION
from nyamuru_episode_workspace import EpisodeWorkspaceManager
from nyamuru_panel_draft_ledger import (
    MAX_PANEL_DRAFT_OMNY_BYTES,
    MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
    PANEL_DRAFT_PROVENANCE_VERSION,
    PanelDraftLedger,
)
from nyamuru_comfy_draft import (
    ComfyUIDraftGenerator,
    ComfyUIUnavailable,
    MANGA_BASE_PALETTE,
    MANGA_BASE_PALETTE_VERSION,
    MANGA_BASE_TRANSFORM_VERSION,
)


PANEL_DRAFT_BRIDGE_VERSION = "panel-draft-ledger-v2"


class PanelDraftJobService:
    def __init__(self, workspaces: EpisodeWorkspaceManager, generator: ComfyUIDraftGenerator):
        self.workspaces = workspaces
        self.generator = generator

    def ledger(self, workspace_token: object) -> PanelDraftLedger:
        episode_root, ledger_root = self.workspaces.ledger_root(workspace_token)
        return PanelDraftLedger(episode_root, ledger_root)

    @staticmethod
    def checked_integer(value: object, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"{label}が正しくありません")
        return value

    @staticmethod
    def load_plan(ledger: PanelDraftLedger, attempt_id: str) -> dict[str, Any]:
        raw = ledger.read_attempt_artifact(attempt_id, "plan_snapshot", MAX_PANEL_DRAFT_SNAPSHOT_BYTES)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("保存済み生成planを読み取れません") from exc
        if not isinstance(value, dict):
            raise ValueError("保存済み生成planの形式が正しくありません")
        return ComfyUIDraftGenerator.normalized_request(value)

    def provenance(
        self,
        record: dict[str, Any],
        value: dict[str, Any],
        *,
        status: str,
        error_code: str | None = None,
        error_message: str | None = None,
        comfy_output: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        try:
            import PIL
            pillow_version = PIL.__version__
        except ImportError:
            pillow_version = "unavailable"
        result: dict[str, Any] = {
            "schema_version": PANEL_DRAFT_PROVENANCE_VERSION,
            "kind": "panel_draft_execution",
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "job_id": record["job_id"],
            "attempt_id": record["attempt_id"],
            "attempt_number": record["attempt_number"],
            "status": status,
            "source": {
                "series_id": record["series_id"],
                "episode_id": record["episode_id"],
                "page_number": record["page_number"],
                "panel_id": record["panel_id"],
            },
            "executor": {
                "engine": "ComfyUI",
                "transport": "loopback-http",
                "prompt_id": record["prompt_id"],
                "queue_authority": "comfyui:/prompt,/queue,/history",
                "bridge": {
                    "service": BRIDGE_SERVICE_NAME,
                    "layout_protocol_version": LAYOUT_PROTOCOL_VERSION,
                    "panel_draft_version": PANEL_DRAFT_BRIDGE_VERSION,
                },
                "runtime": {
                    "python": platform.python_version(),
                    "pillow": pillow_version,
                },
            },
            "model": {
                "checkpoint": self.generator.checkpoint_identity(value["checkpoint"]),
                "profile": value["profile"],
                "width": value["width"],
                "height": value["height"],
                "steps": value["steps"],
                "cfg": value["cfg"],
                "seed": value["seed"],
                "sampler": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
            },
            "conversion": {
                "version": MANGA_BASE_TRANSFORM_VERSION,
                "palette_version": MANGA_BASE_PALETTE_VERSION,
                "palette": MANGA_BASE_PALETTE,
            },
            "inputs": {
                role: artifact
                for role, artifact in record["artifacts"].items()
                if role in {"omny_snapshot", "plan_snapshot", "workflow_snapshot"}
            },
            "policy": {
                "automatic_retry": False,
                "automatic_review_acceptance": False,
                "automatic_omny_update": False,
            },
        }
        if comfy_output is not None:
            result["comfy_output"] = {
                "filename": comfy_output["filename"],
                "subfolder": comfy_output["subfolder"],
                "type": comfy_output["type"],
            }
        if error_code:
            result["error"] = {"code": error_code, "message": error_message or ""}
        return result

    def _outcome(
        self,
        ledger: PanelDraftLedger,
        record: dict[str, Any],
        value: dict[str, Any],
        status: str,
        code: str,
        error: BaseException | str,
    ) -> dict[str, Any]:
        message = PanelDraftLedger.sanitized_error(error, ledger.episode_root)
        provenance = self.provenance(record, value, status=status, error_code=code, error_message=message)
        return ledger.set_status(
            record["attempt_id"], status, error_code=code, error_message=message, provenance=provenance,
        )

    def _result(self, ledger: PanelDraftLedger, record: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
        artifact = record["artifacts"].get("manga_base_composite")
        if record["status"] != "succeeded" or not isinstance(artifact, dict):
            return {"ok": True, "attempt": record}
        resolved = ledger.resolve_succeeded_artifact(
            record["job_id"],
            record["attempt_id"],
            artifact["sha256"],
            expected_omny_sha256=record["artifacts"]["omny_snapshot"]["sha256"],
            expected_plan_sha256=record["artifacts"]["plan_snapshot"]["sha256"],
            expected_workflow_sha256=record["artifacts"]["workflow_snapshot"]["sha256"],
        )
        image_info = {
            "filename": record["source_file_name"] or "comfy-output.png",
            "subfolder": record["source_subfolder"] or "",
            "type": "output",
        }
        result = self.generator.result_payload(value, record["prompt_id"], image_info, resolved["bytes"])
        result.update({
            "job_id": record["job_id"],
            "attempt_id": record["attempt_id"],
            "attempt_number": record["attempt_number"],
            "status": record["status"],
            "review": record["review"],
            "artifacts": record["artifacts"],
            "audit_events": record["audit_events"],
        })
        return result

    def _complete(
        self,
        ledger: PanelDraftLedger,
        record: dict[str, Any],
        value: dict[str, Any],
        image_info: dict[str, str],
    ) -> dict[str, Any]:
        original = self.generator.fetch_image(image_info)
        composite = self.generator.manga_base_png(original)
        provenance = self.provenance(record, value, status="succeeded", comfy_output=image_info)
        if record["status"] == "created":
            provenance["recovery"] = {
                "from_status": "created",
                "evidence": "comfyui_history_output_for_same_prompt_id",
            }
        download_name = (
            f"manga-base_page_{value['page_number']:04d}_panel_{value['panel_id']:04d}"
            f"_seed_{value['seed']}.png"
        )
        completed = ledger.complete_success(
            record["attempt_id"],
            original_png=original,
            manga_base_png=composite,
            source_file_name=image_info["filename"],
            source_subfolder=image_info["subfolder"],
            download_name=download_name,
            provenance=provenance,
            recovering_created_from_history=record["status"] == "created",
        )
        return self._result(ledger, completed, value)

    def generate(self, body: dict[str, Any]) -> dict[str, Any]:
        ledger = self.ledger(body.get("workspace_token"))
        value = self.generator.normalized_request(body)
        job_id = PanelDraftLedger.checked_id(body.get("job_id"), "job ID")
        attempt_id = PanelDraftLedger.checked_id(body.get("attempt_id"), "attempt ID")
        retry_value = body.get("retry_of_attempt_id")
        retry_of_attempt_id = None if retry_value in (None, "") else PanelDraftLedger.checked_id(retry_value, "retry元attempt ID")
        series_id = PanelDraftLedger.checked_source_id(body.get("series_id"), "シリーズID", required=False)
        episode_id = PanelDraftLedger.checked_source_id(body.get("episode_id"), "エピソードID")
        omny_snapshot = PanelDraftLedger.checked_snapshot(
            body.get("omny_snapshot"), "OMNY snapshot", MAX_PANEL_DRAFT_OMNY_BYTES,
        )
        workflow = self.generator.workflow(value)
        record, created = ledger.begin_attempt(
            job_id=job_id,
            attempt_id=attempt_id,
            retry_of_attempt_id=retry_of_attempt_id,
            series_id=series_id,
            episode_id=episode_id,
            page_number=value["page_number"],
            panel_id=value["panel_id"],
            omny_snapshot=omny_snapshot,
            plan_snapshot=value,
            workflow_snapshot=workflow,
        )
        if not created:
            if record["status"] == "succeeded":
                return self._result(ledger, record, value)
            if record["status"] == "failed":
                raise ValueError("このattemptは失敗済みです。再生成には新しいattempt IDが必要です")
            return self.reconcile({"workspace_token": body.get("workspace_token"), "attempt_id": attempt_id}, wait=True)

        try:
            self.generator.submit(value, attempt_id)
            record = ledger.set_status(
                attempt_id, "queued", provenance=self.provenance(record, value, status="queued"),
            )
        except Exception as exc:
            # POST後は壊れた200応答や途中切断でもqueue受理済みか否かを証明できない。
            # failedへ確定せず、同一prompt IDのqueue/history再照合まで自動retryしない。
            self._outcome(ledger, record, value, "outcome_unknown", "submit_outcome_unknown", exc)
            raise

        try:
            image_info = self.generator.wait_for_image(attempt_id)
            return self._complete(ledger, record, value, image_info)
        except ComfyUIUnavailable as exc:
            self._outcome(ledger, record, value, "outcome_unknown", "execution_outcome_unknown", exc)
            raise
        except Exception as exc:
            self._outcome(ledger, record, value, "failed", "execution_failed", exc)
            raise

    def reconcile(self, body: dict[str, Any], wait: bool = False) -> dict[str, Any]:
        ledger = self.ledger(body.get("workspace_token"))
        attempt_id = PanelDraftLedger.checked_id(body.get("attempt_id"), "attempt ID")
        record = ledger.attempt(attempt_id)
        value = self.load_plan(ledger, attempt_id)
        if record["status"] == "succeeded":
            return self._result(ledger, record, value)
        if record["status"] == "failed":
            return {"ok": True, "attempt": record}
        try:
            image_info = self.generator.wait_for_image(attempt_id) if wait else self.generator.history_image(attempt_id)
            if image_info is not None:
                return self._complete(ledger, record, value, image_info)
            if self.generator.queue_contains(attempt_id):
                queued = ledger.set_status(
                    attempt_id, "queued", provenance=self.provenance(record, value, status="queued"),
                )
                return {"ok": True, "attempt": queued}
            unknown = self._outcome(
                ledger, record, value, "outcome_unknown", "not_in_comfyui_queue_or_history",
                "ComfyUIのqueueまたはhistoryでattemptを確認できません",
            )
            return {"ok": True, "attempt": unknown}
        except ComfyUIUnavailable as exc:
            self._outcome(ledger, record, value, "outcome_unknown", "reconcile_unavailable", exc)
            raise
        except RuntimeError as exc:
            failed = self._outcome(ledger, record, value, "failed", "comfyui_execution_failed", exc)
            return {"ok": True, "attempt": failed}
        except Exception as exc:
            failed = self._outcome(ledger, record, value, "failed", "artifact_validation_failed", exc)
            raise ValueError(failed["error"]["message"]) from exc

    def list(self, body: dict[str, Any]) -> dict[str, Any]:
        ledger = self.ledger(body.get("workspace_token"))
        page_number = self.checked_integer(body.get("page_number"), "ページ番号")
        panel_id = self.checked_integer(body.get("panel_id"), "コマ番号")
        return {"ok": True, "attempts": ledger.list_attempts(page_number, panel_id)}

    def review(self, body: dict[str, Any]) -> dict[str, Any]:
        ledger = self.ledger(body.get("workspace_token"))
        attempt = ledger.set_review(
            body.get("attempt_id"),
            body.get("decision"),
            expected_revision_value=body.get("expected_revision"),
            request_nonce_value=body.get("request_nonce"),
            artifact_sha256_value=body.get("artifact_sha256"),
            note_value=body.get("note"),
        )
        return {"ok": True, "attempt": attempt}
