"""Episode workspace registry, reference file selection, and source coverage persistence."""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import secrets
import stat
import tempfile
import threading
from pathlib import Path, PurePosixPath
from typing import Any

from nyamuru_macos_picker import (
    choose_episode_directory,
    choose_workspace_files,
    default_picker_directory,
)
from nyamuru_series_catalog_store import (
    EPISODE_WORKSPACE_DIRECTORIES,
    MAX_WORKSPACE_TEXT_BYTES,
    SERIES_ID_PATTERN,
    WORKSPACE_TEXT_EXTENSIONS,
    discover_reference_text_candidates,
)


DEFAULT_EPISODE_WORKSPACE_STATE_PATH = (
    Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "episode-workspaces.json"
)
MAX_WORKSPACE_IMAGE_BYTES = 40 * 1024 * 1024
MAX_WORKSPACE_IMAGE_TOTAL_BYTES = 96 * 1024 * 1024
MAX_SOURCE_COVERAGE_REPORT_BYTES = 8 * 1024 * 1024
MAX_SOURCE_COVERAGE_UNITS = 10_000
MAX_SOURCE_COVERAGE_TARGETS = 50_000
SOURCE_COVERAGE_SCHEMA_NAME = "nyamuru-source-coverage"
SOURCE_COVERAGE_SHA_PATTERN = re.compile(r"^[a-f0-9]{64}$")
SOURCE_COVERAGE_SOURCE_ID_PATTERN = re.compile(r"^source-[a-f0-9]{64}$")
SOURCE_COVERAGE_TARGET_ID_PATTERN = re.compile(r"^target-[a-f0-9]{64}$")
WORKSPACE_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}


class CoverageReportConflict(RuntimeError):
    """Raised when an immutable coverage report name already has different bytes."""


class EpisodeWorkspaceManager:
    def __init__(self, state_path: Path | None = None):
        self.lock = threading.Lock()
        self.directories: dict[str, Path] = {}
        self.state_path = (state_path or DEFAULT_EPISODE_WORKSPACE_STATE_PATH).expanduser().absolute()
        self._load()

    def _load(self) -> None:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        workspaces = value.get("workspaces") if isinstance(value, dict) else None
        if not isinstance(workspaces, dict):
            return
        recovered: dict[str, Path] = {}
        for token, entry in workspaces.items():
            directory_value = entry.get("directory") if isinstance(entry, dict) else None
            if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{24,128}", token):
                continue
            if not isinstance(directory_value, str) or not directory_value:
                continue
            directory = Path(directory_value).expanduser().resolve()
            if directory.is_dir():
                recovered[token] = directory
        self.directories = recovered

    def _persist(self) -> None:
        payload = {
            "schema_version": 1,
            "workspaces": {
                token: {"directory": str(directory)}
                for token, directory in sorted(self.directories.items())
            },
        }
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.state_path.parent, delete=False) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.state_path)

    def select(self, default_directory_value: object) -> dict[str, Any]:
        selected = choose_episode_directory(default_picker_directory(default_directory_value))
        if selected is None:
            return {"ok": True, "cancelled": True}
        selected = selected.expanduser().resolve()
        if not selected.is_dir():
            raise ValueError("選択したエピソードフォルダが見つかりません")
        token = secrets.token_urlsafe(24)
        with self.lock:
            self.directories[token] = selected
            self._persist()
        return {
            "ok": True,
            "cancelled": False,
            "workspace_token": token,
            "directory": str(selected),
            "folder_name": selected.name,
            "series_directory": str(selected.parent),
        }

    def directory(self, token_value: object) -> Path:
        if not isinstance(token_value, str) or not token_value:
            raise ValueError("エピソード保存先の選択情報がありません")
        with self.lock:
            directory = self.directories.get(token_value)
        if directory is None or not directory.is_dir():
            raise ValueError("エピソード保存先をもう一度選んでください")
        return directory

    def prepare(self, token_value: object) -> dict[str, Any]:
        directory = self.directory(token_value)
        created: list[str] = []
        with self.lock:
            for name in EPISODE_WORKSPACE_DIRECTORIES:
                target = directory / name
                if target.exists() and not target.is_dir():
                    raise ValueError(f"{name}と同名のファイルがあるため、制作フォルダを作成できません")
            for name in EPISODE_WORKSPACE_DIRECTORIES:
                target = directory / name
                if not target.exists():
                    target.mkdir()
                    created.append(name)
        return {
            "ok": True,
            "directory": str(directory),
            "created": created,
            "managed_directories": list(EPISODE_WORKSPACE_DIRECTORIES),
        }

    def ledger_root(self, token_value: object) -> tuple[Path, Path]:
        episode = self.directory(token_value).resolve()
        draft_directory = episode / "draft_data"
        if not draft_directory.is_dir():
            raise ValueError("制作フォルダが準備されていません。保存先を選び直してください")
        if draft_directory.is_symlink():
            raise ValueError("制作フォルダのsymlinkは台帳保存先に使用できません")
        resolved_draft = draft_directory.resolve()
        try:
            resolved_draft.relative_to(episode)
        except ValueError as exc:
            raise ValueError("制作フォルダがエピソード保存先の外側を参照しています") from exc
        root = resolved_draft / "nyamuru"
        if root.exists() and (not root.is_dir() or root.is_symlink()):
            raise ValueError("Nyamuruの制作台帳保存先を安全に使用できません")
        root.mkdir(parents=True, exist_ok=True)
        resolved_root = root.resolve()
        try:
            resolved_root.relative_to(episode)
        except ValueError as exc:
            raise ValueError("Nyamuruの制作台帳保存先がエピソード外を参照しています") from exc
        return episode, resolved_root

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

    @staticmethod
    def _coverage_directory_flags() -> int:
        required = ("O_DIRECTORY", "O_NOFOLLOW", "O_CLOEXEC")
        if any(not hasattr(os, name) for name in required):
            raise ValueError("このOSではcoverage reportを安全に保存できません")
        return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

    @classmethod
    def _open_coverage_root(cls, path: Path) -> int:
        listed = path.stat(follow_symlinks=False)
        if not stat.S_ISDIR(listed.st_mode):
            raise ValueError("エピソード保存先を安全に使用できません")
        descriptor = os.open(path, cls._coverage_directory_flags())
        opened = os.fstat(descriptor)
        if not stat.S_ISDIR(opened.st_mode) or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino):
            os.close(descriptor)
            raise ValueError("エピソード保存先が検証中に変更されました")
        return descriptor

    @classmethod
    def _open_or_create_coverage_directory(cls, parent_fd: int, name: str) -> int:
        try:
            listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.mkdir(name, 0o700, dir_fd=parent_fd)
            except FileExistsError:
                pass
            listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(listed.st_mode):
            raise ValueError(f"{name}をcoverage report保存先に使用できません")
        descriptor = os.open(name, cls._coverage_directory_flags(), dir_fd=parent_fd)
        opened = os.fstat(descriptor)
        parent = os.fstat(parent_fd)
        if not stat.S_ISDIR(opened.st_mode) \
                or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino) \
                or opened.st_dev != parent.st_dev:
            os.close(descriptor)
            raise ValueError(f"{name}が検証中に変更されました")
        return descriptor

    @classmethod
    def _verify_coverage_directory_chain(
        cls,
        episode: Path,
        root_fd: int,
        name_data_fd: int,
        coverage_fd: int,
    ) -> None:
        root_listed = episode.stat(follow_symlinks=False)
        name_data_listed = os.stat("name_data", dir_fd=root_fd, follow_symlinks=False)
        coverage_listed = os.stat("coverage", dir_fd=name_data_fd, follow_symlinks=False)
        root_opened = os.fstat(root_fd)
        name_data_opened = os.fstat(name_data_fd)
        coverage_opened = os.fstat(coverage_fd)
        entries = (
            ("エピソード保存先", root_listed, root_opened),
            ("name_data", name_data_listed, name_data_opened),
            ("coverage", coverage_listed, coverage_opened),
        )
        for label, listed, opened in entries:
            if not stat.S_ISDIR(listed.st_mode) or not stat.S_ISDIR(opened.st_mode) \
                    or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino):
                raise ValueError(f"{label}が保存中に差し替えられました")
        if name_data_opened.st_dev != root_opened.st_dev or coverage_opened.st_dev != root_opened.st_dev:
            raise ValueError("coverage report保存先が別deviceを参照しています")

    @staticmethod
    def _unlink_coverage_entry_if_identity(
        directory_fd: int,
        name: str,
        identity: tuple[int, int],
    ) -> bool:
        try:
            current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            return False
        if identity != (current.st_dev, current.st_ino):
            return False
        os.unlink(name, dir_fd=directory_fd)
        return True

    @classmethod
    def _open_existing_workspace_directory(cls, parent_fd: int, name: str) -> int:
        if name in {"", ".", ".."} or "/" in name or "\\" in name or "\x00" in name:
            raise ValueError("文章ファイルの保存場所を安全に使用できません")
        listed = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(listed.st_mode):
            raise ValueError("文章ファイルの保存場所にsymlinkまたは通常でない項目があります")
        descriptor = os.open(name, cls._coverage_directory_flags(), dir_fd=parent_fd)
        opened = os.fstat(descriptor)
        parent = os.fstat(parent_fd)
        if not stat.S_ISDIR(opened.st_mode) \
                or (listed.st_dev, listed.st_ino) != (opened.st_dev, opened.st_ino) \
                or opened.st_dev != parent.st_dev:
            os.close(descriptor)
            raise ValueError("文章ファイルの保存場所が検証中に変更されました")
        return descriptor

    @classmethod
    def _open_selected_workspace_text(cls, workspace: Path, path: Path) -> tuple[int, str | None]:
        if not path.is_absolute():
            raise ValueError("選択した文章ファイルの場所が正しくありません")
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
        try:
            relative = path.relative_to(workspace)
        except ValueError:
            return os.open(path, flags), None
        parts = relative.parts
        if not parts or any(part in {"", ".", ".."} or "/" in part or "\\" in part or "\x00" in part for part in parts):
            raise ValueError("選択した文章ファイルの相対pathが正しくありません")
        root_fd = cls._open_coverage_root(workspace)
        parent_fd = root_fd
        try:
            for part in parts[:-1]:
                child_fd = cls._open_existing_workspace_directory(parent_fd, part)
                if parent_fd != root_fd:
                    os.close(parent_fd)
                parent_fd = child_fd
            descriptor = os.open(parts[-1], flags, dir_fd=parent_fd)
            opened = os.fstat(descriptor)
            parent = os.fstat(parent_fd)
            if opened.st_dev != parent.st_dev:
                os.close(descriptor)
                raise ValueError("文章ファイルがエピソード保存先の外側を参照しています")
            return descriptor, relative.as_posix()
        finally:
            if parent_fd != root_fd:
                os.close(parent_fd)
            os.close(root_fd)

    @staticmethod
    def _read_coverage_file(directory_fd: int, name: str) -> bytes:
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
        descriptor = os.open(name, flags, dir_fd=directory_fd)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE_COVERAGE_REPORT_BYTES:
                raise CoverageReportConflict("既存coverage reportを安全に確認できません")
            chunks: list[bytes] = []
            remaining = MAX_SOURCE_COVERAGE_REPORT_BYTES + 1
            while remaining > 0:
                chunk = os.read(descriptor, min(1024 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            after = os.fstat(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != \
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise CoverageReportConflict("既存coverage reportが検証中に変更されました")
            data = b"".join(chunks)
            if len(data) > MAX_SOURCE_COVERAGE_REPORT_BYTES:
                raise CoverageReportConflict("既存coverage reportが保存上限を超えています")
            return data
        finally:
            os.close(descriptor)

    def save_source_coverage(
        self,
        token_value: object,
        expected_episode_id_value: object,
        report_value: object,
    ) -> dict[str, Any]:
        data, digest = self._checked_coverage_report(report_value, expected_episode_id_value)
        episode = self.directory(token_value)
        final_name = f"source-coverage-{digest}.json"
        relative_path = f"name_data/coverage/{final_name}"
        with self.lock:
            root_fd = self._open_coverage_root(episode)
            name_data_fd = -1
            coverage_fd = -1
            staging_fd = -1
            temporary_name = f".source-coverage-{secrets.token_hex(16)}.tmp"
            temporary_identity: tuple[int, int] | None = None
            created_final_identity: tuple[int, int] | None = None
            try:
                name_data_fd = self._open_or_create_coverage_directory(root_fd, "name_data")
                os.fsync(root_fd)
                coverage_fd = self._open_or_create_coverage_directory(name_data_fd, "coverage")
                os.fsync(name_data_fd)
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
                staging_fd = os.open(temporary_name, flags, 0o600, dir_fd=coverage_fd)
                metadata = os.fstat(staging_fd)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != 0:
                    raise OSError("coverage reportのstaging fileを開始できません")
                temporary_identity = (metadata.st_dev, metadata.st_ino)
                written = 0
                while written < len(data):
                    count = os.write(staging_fd, data[written:])
                    if count <= 0:
                        raise OSError("coverage reportを書き切れませんでした")
                    written += count
                os.fsync(staging_fd)
                metadata = os.fstat(staging_fd)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != len(data) \
                        or temporary_identity != (metadata.st_dev, metadata.st_ino):
                    raise OSError("coverage reportのstaging fileを検証できません")
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                current_temporary = os.stat(temporary_name, dir_fd=coverage_fd, follow_symlinks=False)
                if temporary_identity != (current_temporary.st_dev, current_temporary.st_ino):
                    raise OSError("coverage reportのstaging fileが公開前に変更されました")
                try:
                    os.link(
                        temporary_name, final_name,
                        src_dir_fd=coverage_fd, dst_dir_fd=coverage_fd, follow_symlinks=False,
                    )
                    created = True
                    published_metadata = os.stat(final_name, dir_fd=coverage_fd, follow_symlinks=False)
                    created_final_identity = (published_metadata.st_dev, published_metadata.st_ino)
                    current_temporary = os.stat(temporary_name, dir_fd=coverage_fd, follow_symlinks=False)
                    if temporary_identity != (current_temporary.st_dev, current_temporary.st_ino) \
                            or temporary_identity != created_final_identity:
                        raise OSError("coverage reportのstaging fileが公開中に変更されました")
                except FileExistsError:
                    existing = self._read_coverage_file(coverage_fd, final_name)
                    if not secrets.compare_digest(existing, data):
                        raise CoverageReportConflict("同じhash名に異なるcoverage reportが既にあります")
                    created = False
                if created:
                    os.fsync(coverage_fd)
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                published = self._read_coverage_file(coverage_fd, final_name)
                if not secrets.compare_digest(published, data):
                    raise CoverageReportConflict("保存したcoverage reportを再検証できません")
                if not self._unlink_coverage_entry_if_identity(coverage_fd, temporary_name, temporary_identity):
                    raise OSError("coverage reportのstaging fileを安全に削除できません")
                temporary_identity = None
                os.fsync(coverage_fd)
                self._verify_coverage_directory_chain(episode, root_fd, name_data_fd, coverage_fd)
                if created:
                    created_final_identity = None
                return {
                    "ok": True,
                    "relative_path": relative_path,
                    "sha256": digest,
                    "created": created,
                    "byte_size": len(data),
                }
            finally:
                removed_entry = False
                if coverage_fd >= 0 and created_final_identity is not None:
                    try:
                        removed_entry = self._unlink_coverage_entry_if_identity(
                            coverage_fd, final_name, created_final_identity,
                        ) or removed_entry
                    except OSError:
                        pass
                if coverage_fd >= 0 and temporary_identity is not None:
                    try:
                        removed_entry = self._unlink_coverage_entry_if_identity(
                            coverage_fd, temporary_name, temporary_identity,
                        ) or removed_entry
                    except OSError:
                        pass
                if coverage_fd >= 0 and removed_entry:
                    try:
                        os.fsync(coverage_fd)
                    except OSError:
                        pass
                if staging_fd >= 0:
                    os.close(staging_fd)
                for descriptor in (coverage_fd, name_data_fd, root_fd):
                    if descriptor >= 0:
                        os.close(descriptor)

    def choose_text(self, token_value: object) -> dict[str, Any]:
        directory = self.directory(token_value)
        selected = choose_workspace_files(directory, "text", False)
        if selected is None:
            return {"ok": True, "cancelled": True}
        if len(selected) != 1:
            raise ValueError("文章ファイルを1つ選んでください")
        path = selected[0]
        if path.suffix.lower() not in WORKSPACE_TEXT_EXTENSIONS:
            raise ValueError("Markdown（.md/.markdown）またはテキスト（.txt/.text）を選んでください")
        if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
            raise ValueError("このOSでは文章ファイルを安全に読み込めません")
        try:
            descriptor, relative_path = self._open_selected_workspace_text(directory, path)
        except OSError as exc:
            raise ValueError("選択した文章ファイルを安全に開けません") from exc
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_WORKSPACE_TEXT_BYTES:
                raise ValueError("文章ファイルが5MiBを超えているか、通常ファイルではありません")
            chunks: list[bytes] = []
            remaining = MAX_WORKSPACE_TEXT_BYTES + 1
            while remaining > 0:
                chunk = os.read(descriptor, min(1024 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            after = os.fstat(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != \
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise ValueError("文章ファイルが読み込み中に変更されました")
            raw = b"".join(chunks)
            if len(raw) > MAX_WORKSPACE_TEXT_BYTES:
                raise ValueError("文章ファイルが5MiBを超えています")
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise ValueError("文章ファイルはUTF-8で保存してください") from exc
        finally:
            os.close(descriptor)
        return {
            "ok": True,
            "cancelled": False,
            "filename": path.name,
            "text": text,
            "relative_path": relative_path,
            "byte_size": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }

    def reference_candidates(self, token_value: object) -> list[dict[str, Any]]:
        return discover_reference_text_candidates(self.directory(token_value), "episode")

    def choose_images(self, token_value: object, max_files_value: object) -> dict[str, Any]:
        directory = self.directory(token_value)
        try:
            max_files = min(12, max(1, int(max_files_value)))
        except (TypeError, ValueError):
            max_files = 10
        selected = choose_workspace_files(directory, "image", True)
        if selected is None:
            return {"ok": True, "cancelled": True, "files": []}
        files: list[dict[str, Any]] = []
        total_bytes = 0
        for path in selected[:max_files]:
            if not path.is_file() or path.suffix.lower() not in WORKSPACE_IMAGE_EXTENSIONS:
                raise ValueError(f"対応していない画像です: {path.name}")
            byte_size = path.stat().st_size
            if byte_size > MAX_WORKSPACE_IMAGE_BYTES:
                raise ValueError(f"画像が40MBを超えています: {path.name}")
            total_bytes += byte_size
            if total_bytes > MAX_WORKSPACE_IMAGE_TOTAL_BYTES:
                raise ValueError("選択した画像の合計が96MBを超えています")
            media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            files.append({
                "filename": path.name,
                "media_type": media_type,
                "image": f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}",
            })
        return {"ok": True, "cancelled": False, "files": files}
