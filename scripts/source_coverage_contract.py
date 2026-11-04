"""Validate source coverage reports, identifiers and target units for the episode."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from pathlib import PurePosixPath
from typing import Any
from nyamuru_series_catalog_store import MAX_WORKSPACE_TEXT_BYTES, SERIES_ID_PATTERN


MAX_SOURCE_COVERAGE_REPORT_BYTES = 8 * 1024 * 1024
MAX_SOURCE_COVERAGE_UNITS = 10_000
MAX_SOURCE_COVERAGE_TARGETS = 50_000
SOURCE_COVERAGE_SCHEMA_NAME = "nyamuru-source-coverage"
SOURCE_COVERAGE_SHA_PATTERN = re.compile(r"^[a-f0-9]{64}$")
SOURCE_COVERAGE_SOURCE_ID_PATTERN = re.compile(r"^source-[a-f0-9]{64}$")
SOURCE_COVERAGE_TARGET_ID_PATTERN = re.compile(r"^target-[a-f0-9]{64}$")

class CoverageReportConflict(RuntimeError):
    """Raised when an immutable coverage report name already has different bytes."""


class SourceCoverageContract:
    @staticmethod
    def _coverage_exact_keys(value: object, expected: set[str], label: str) -> dict[str, Any]:
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError(f"{label}の項目がstrict v1 schemaと一致しません")
        return value

    @staticmethod
    def _coverage_string(value: object, label: str, maximum: int, *, allow_empty: bool = True) -> str:
        if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value):
            raise ValueError(f"{label}が正しくありません")
        return value

    @staticmethod
    def _coverage_integer(value: object, label: str, minimum: int, maximum: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
            raise ValueError(f"{label}が正しくありません")
        return value

    @staticmethod
    def _coverage_sha(value: object, label: str) -> str:
        if not isinstance(value, str) or not SOURCE_COVERAGE_SHA_PATTERN.fullmatch(value):
            raise ValueError(f"{label}が正しいSHA-256ではありません")
        return value

    @classmethod
    def _checked_coverage_report(
        cls,
        report_value: object,
        expected_episode_id_value: object,
    ) -> tuple[bytes, str]:
        if not isinstance(expected_episode_id_value, str) \
                or not SERIES_ID_PATTERN.fullmatch(expected_episode_id_value):
            raise ValueError("coverage reportのエピソードIDが正しくありません")
        expected_episode_id = expected_episode_id_value
        report = cls._coverage_exact_keys(report_value, {
            "schema_name", "schema_version", "kind", "episode", "source", "omny",
            "analysis_sha256", "scan_complete", "verdict", "summary", "warnings",
            "source_units", "targets", "human_decisions",
        }, "coverage report")
        if report["schema_name"] != SOURCE_COVERAGE_SCHEMA_NAME \
                or report["schema_version"] != 1 \
                or report["kind"] != "source_coverage_report" \
                or report["scan_complete"] is not True:
            raise ValueError("coverage reportのschemaまたは完了状態が正しくありません")
        if report["verdict"] not in {"no_review_required", "review_required", "reviewed_with_gaps"}:
            raise ValueError("coverage reportのverdictが正しくありません")

        episode = cls._coverage_exact_keys(
            report["episode"], {"series_id", "episode_id", "title", "episode_number"}, "episode",
        )
        series_id = cls._coverage_string(episode["series_id"], "シリーズID", 1_000)
        episode_id = cls._coverage_string(episode["episode_id"], "エピソードID", 1_000, allow_empty=False)
        cls._coverage_string(episode["title"], "作品名", 5_000)
        cls._coverage_string(episode["episode_number"], "話数", 1_000)
        if episode_id != expected_episode_id:
            raise ValueError("coverage reportが現在のエピソードIDと一致しません")

        source = cls._coverage_exact_keys(
            report["source"],
            {
                "file_name", "relative_path", "byte_size", "line_count",
                "source_text_sha256", "source_revision_sha256",
            },
            "source",
        )
        file_name = cls._coverage_string(source["file_name"], "原作・台本ファイル名", 255, allow_empty=False)
        if file_name in {".", ".."} or "/" in file_name or "\\" in file_name or "\x00" in file_name:
            raise ValueError("原作・台本ファイル名が正しくありません")
        relative_path = source["relative_path"]
        if relative_path is not None:
            relative_path = cls._coverage_string(relative_path, "原作・台本の相対path", 1_024, allow_empty=False)
            raw_parts = relative_path.split("/")
            parsed = PurePosixPath(relative_path)
            if parsed.is_absolute() or "\\" in relative_path or any(part in {"", ".", ".."} for part in raw_parts):
                raise ValueError("原作・台本の相対pathが正しくありません")
        cls._coverage_integer(source["byte_size"], "原作・台本のbyte数", 1, MAX_WORKSPACE_TEXT_BYTES)
        line_count = cls._coverage_integer(source["line_count"], "原作・台本の行数", 1, 50_000)
        source_text_sha = cls._coverage_sha(source["source_text_sha256"], "原作・台本text")
        source_sha = cls._coverage_sha(source["source_revision_sha256"], "原作・台本revision")
        try:
            source_revision_data = json.dumps({
                "file_name": file_name,
                "relative_path": relative_path,
                "source_text_sha256": source_text_sha,
            }, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        except (TypeError, ValueError, UnicodeEncodeError) as exc:
            raise ValueError("原作・台本revisionをcanonical JSONへ変換できません") from exc
        expected_source_sha = hashlib.sha256(source_revision_data).hexdigest()
        if not secrets.compare_digest(source_sha, expected_source_sha):
            raise ValueError("原作・台本revisionがsource identityと一致しません")

        omny = cls._coverage_exact_keys(
            report["omny"], {"omny_revision_sha256", "projection_sha256"}, "omny",
        )
        cls._coverage_sha(omny["omny_revision_sha256"], "OMNY revision")
        projection_sha = cls._coverage_sha(omny["projection_sha256"], "OMNY projection")
        analysis_sha = cls._coverage_sha(report["analysis_sha256"], "coverage analysis")

        warnings = report["warnings"]
        if not isinstance(warnings, list) or len(warnings) > 32 \
                or any(not isinstance(item, str) or not item or len(item) > 200 for item in warnings) \
                or len(set(warnings)) != len(warnings):
            raise ValueError("coverage reportのwarningが正しくありません")

        targets = report["targets"]
        if not isinstance(targets, list) or len(targets) > MAX_SOURCE_COVERAGE_TARGETS:
            raise ValueError("coverage reportのtarget数が上限を超えています")
        target_ids: set[str] = set()
        target_layer_by_id: dict[str, str] = {}
        projection_targets: list[dict[str, Any]] = []
        for target_value in targets:
            target = cls._coverage_exact_keys(
                target_value,
                {"target_id", "layer", "kind", "locator", "value", "match_key", "speaker_keys"},
                "coverage target",
            )
            target_id = target["target_id"]
            if not isinstance(target_id, str) or not SOURCE_COVERAGE_TARGET_ID_PATTERN.fullmatch(target_id) \
                    or target_id in target_ids:
                raise ValueError("coverage target IDが正しくないか重複しています")
            target_ids.add(target_id)
            if target["layer"] not in {"context_retained", "storyboard_evidenced"}:
                raise ValueError("coverage target layerが正しくありません")
            target_layer_by_id[target_id] = target["layer"]
            cls._coverage_string(target["kind"], "coverage target kind", 100, allow_empty=False)
            locator = cls._coverage_string(target["locator"], "coverage target locator", 2_000, allow_empty=False)
            if not locator.startswith("/"):
                raise ValueError("coverage target locatorが正しくありません")
            cls._coverage_string(target["value"], "coverage target value", 5_000, allow_empty=False)
            cls._coverage_string(target["match_key"], "coverage target match key", 5_000, allow_empty=False)
            speakers = target["speaker_keys"]
            if not isinstance(speakers, list) or len(speakers) > 64 \
                    or any(not isinstance(item, str) or not item or len(item) > 500 for item in speakers) \
                    or len(set(speakers)) != len(speakers):
                raise ValueError("coverage targetの話者情報が正しくありません")
            projection_targets.append({
                "layer": target["layer"],
                "kind": target["kind"],
                "value": target["value"],
                "match_key": target["match_key"],
                "speaker_keys": speakers,
            })

        try:
            projection_data = json.dumps({
                "series_id": series_id,
                "episode_id": episode_id,
                "targets": projection_targets,
            }, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        except (TypeError, ValueError, UnicodeEncodeError) as exc:
            raise ValueError("OMNY projectionをcanonical JSONへ変換できません") from exc
        expected_projection_sha = hashlib.sha256(projection_data).hexdigest()
        if not secrets.compare_digest(projection_sha, expected_projection_sha):
            raise ValueError("OMNY projection hashがepisode identityとtargetに一致しません")

        source_units = report["source_units"]
        if not isinstance(source_units, list) or not source_units or len(source_units) > MAX_SOURCE_COVERAGE_UNITS:
            raise ValueError("coverage reportのsource unit数が上限を超えています")
        source_ids: set[str] = set()
        statuses: list[str] = []
        context_count = 0
        source_kind_by_id: dict[str, str] = {}
        for unit_value in source_units:
            unit = cls._coverage_exact_keys(unit_value, {
                "source_unit_id", "kind", "start_line", "end_line", "excerpt", "match_text",
                "match_key", "speaker_hint", "status", "context_retained", "candidate_target_ids",
                "candidate_total",
            }, "source unit")
            source_id = unit["source_unit_id"]
            if not isinstance(source_id, str) or not SOURCE_COVERAGE_SOURCE_ID_PATTERN.fullmatch(source_id) \
                    or source_id in source_ids:
                raise ValueError("source unit IDが正しくないか重複しています")
            source_ids.add(source_id)
            if unit["kind"] not in {"content", "excluded"}:
                raise ValueError("source unit kindが正しくありません")
            source_kind_by_id[source_id] = unit["kind"]
            start_line = cls._coverage_integer(unit["start_line"], "source unit開始行", 1, line_count)
            end_line = cls._coverage_integer(unit["end_line"], "source unit終了行", start_line, line_count)
            cls._coverage_string(unit["excerpt"], "source excerpt", 2_000)
            cls._coverage_string(unit["match_text"], "source match text", 2_000)
            cls._coverage_string(unit["match_key"], "source match key", 2_000)
            if unit["speaker_hint"] is not None:
                cls._coverage_string(unit["speaker_hint"], "source speaker hint", 100, allow_empty=False)
            status = unit["status"]
            if status not in {"confirmed", "ambiguous", "unverified", "excluded"} \
                    or (unit["kind"] == "excluded") != (status == "excluded"):
                raise ValueError("source unit statusが正しくありません")
            statuses.append(status)
            if not isinstance(unit["context_retained"], bool):
                raise ValueError("source unitのcontext判定が正しくありません")
            context_count += int(unit["context_retained"])
            candidates = unit["candidate_target_ids"]
            if not isinstance(candidates, list) or len(candidates) > 32 \
                    or any(not isinstance(item, str) or item not in target_ids for item in candidates) \
                    or len(set(candidates)) != len(candidates):
                raise ValueError("source unitの候補targetが正しくありません")
            candidate_total = cls._coverage_integer(
                unit["candidate_total"], "source unit候補総数", len(candidates), MAX_SOURCE_COVERAGE_TARGETS,
            )
            if len(candidates) != min(candidate_total, 32):
                raise ValueError("source unitの候補省略数がcontractと一致しません")
            candidate_layers = {target_layer_by_id[item] for item in candidates}
            if len(candidate_layers) > 1:
                raise ValueError("source unitの候補target layerが混在しています")
            expected_context_retained = candidate_layers == {"context_retained"}
            if unit["context_retained"] is not expected_context_retained:
                raise ValueError("source unitのcontext判定が候補target layerと一致しません")
            if status == "excluded":
                if candidate_total or unit["context_retained"] or unit["match_key"] or unit["speaker_hint"] is not None:
                    raise ValueError("excluded source unitに照合結果が含まれています")
            elif status == "confirmed":
                if candidate_total != 1 or unit["context_retained"]:
                    raise ValueError("confirmed source unitの候補数またはlayerが正しくありません")
            elif status == "ambiguous":
                if candidate_total < 2 or unit["context_retained"]:
                    raise ValueError("ambiguous source unitの候補数またはlayerが正しくありません")
        if "content" not in source_kind_by_id.values():
            raise ValueError("coverage reportに監査できる本文行がありません")

        try:
            analysis_data = json.dumps({
                "source_revision_sha256": source_sha,
                "projection_sha256": projection_sha,
                "source_units": source_units,
                "targets": targets,
            }, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        except (TypeError, ValueError, UnicodeEncodeError) as exc:
            raise ValueError("coverage analysisをcanonical JSONへ変換できません") from exc
        expected_analysis_sha = hashlib.sha256(analysis_data).hexdigest()
        if not secrets.compare_digest(analysis_sha, expected_analysis_sha):
            raise ValueError("coverage analysis hashが分析内容と一致しません")

        decisions = report["human_decisions"]
        if not isinstance(decisions, list) or len(decisions) > MAX_SOURCE_COVERAGE_UNITS:
            raise ValueError("coverage reportのhuman decision数が上限を超えています")
        decided_ids: set[str] = set()
        current_decision_ids: set[str] = set()
        stale_count = 0
        for decision_value in decisions:
            decision = cls._coverage_exact_keys(decision_value, {
                "source_unit_id", "decision", "note", "source_revision_sha256", "projection_sha256", "stale",
            }, "human decision")
            source_id = decision["source_unit_id"]
            if source_id not in source_ids or source_id in decided_ids or source_kind_by_id[source_id] != "content":
                raise ValueError("human decisionのsource unitが正しくありません")
            decided_ids.add(source_id)
            if decision["decision"] not in {"covered", "not_covered", "not_applicable"}:
                raise ValueError("human decisionの値が正しくありません")
            cls._coverage_string(decision["note"], "human decision note", 1_000)
            decision_source_sha = cls._coverage_sha(decision["source_revision_sha256"], "decision source revision")
            decision_projection_sha = cls._coverage_sha(decision["projection_sha256"], "decision projection revision")
            stale = decision_source_sha != source_sha or decision_projection_sha != projection_sha
            if decision["stale"] is not stale:
                raise ValueError("human decisionのstale判定がrevisionと一致しません")
            if stale:
                stale_count += 1
            else:
                current_decision_ids.add(source_id)

        summary = cls._coverage_exact_keys(report["summary"], {
            "source_units", "confirmed", "ambiguous", "unverified", "excluded", "context_only",
            "current_decisions", "stale_decisions", "unresolved_after_review",
        }, "coverage summary")
        expected_counts = {
            "source_units": len(source_units),
            "confirmed": statuses.count("confirmed"),
            "ambiguous": statuses.count("ambiguous"),
            "unverified": statuses.count("unverified"),
            "excluded": statuses.count("excluded"),
            "context_only": context_count,
            "current_decisions": len(current_decision_ids),
            "stale_decisions": stale_count,
            "unresolved_after_review": sum(
                1 for unit in source_units
                if unit["kind"] == "content" and unit["status"] != "confirmed"
                and unit["source_unit_id"] not in current_decision_ids
            ),
        }
        for key, expected in expected_counts.items():
            if cls._coverage_integer(summary[key], f"coverage summary {key}", 0, MAX_SOURCE_COVERAGE_UNITS) != expected:
                raise ValueError(f"coverage summaryの{key}が実データと一致しません")
        current_not_covered = any(
            decision["source_unit_id"] in current_decision_ids and decision["decision"] == "not_covered"
            for decision in decisions
        )
        expected_verdict = (
            "review_required" if expected_counts["unresolved_after_review"]
            else "reviewed_with_gaps" if current_not_covered
            else "no_review_required"
        )
        if report["verdict"] != expected_verdict:
            raise ValueError("coverage reportのverdictがsummaryと一致しません")
        try:
            data = json.dumps(
                report, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
            ).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ValueError("coverage reportをcanonical JSONへ変換できません") from exc
        if len(data) > MAX_SOURCE_COVERAGE_REPORT_BYTES:
            raise ValueError("coverage reportが8MiBを超えています")
        return data, hashlib.sha256(data).hexdigest()
