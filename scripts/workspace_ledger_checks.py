"""Inspect the episode ledger schema, artifacts and relations in read-only mode."""

from __future__ import annotations

from collections.abc import Mapping
import re
import sqlite3

from workspace_inspection_contract import (
    LEDGER_RELATIVE_PATH,
    LEDGER_SCHEMA_VERSION,
    LEDGER_REQUIRED_TABLES,
    LEDGER_REQUIRED_TRIGGERS,
    LEDGER_COLUMN_CONTRACTS,
    LEDGER_FOREIGN_KEY_CONTRACTS,
    LEDGER_UNIQUE_CONTRACTS,
    LEDGER_CHECK_CONTRACTS,
    LEDGER_TRIGGER_CONTRACTS,
    LEDGER_REQUIRED_INPUT_ROLES,
    LEDGER_REQUIRED_SUCCESS_ROLES,
    ARTIFACT_PATH_PATTERN,
    SHA256_PATTERN,
    MAX_LEDGER_BYTES,
    _safe_relative_path,
    _normalized_schema_sql,
    _normalized_trigger_sql,
)


class WorkspaceLedgerChecks:
    def _inspect_ledger(self, episode_fd: int, expected_device: int) -> None:
        snapshot = self.files.get(("episode", LEDGER_RELATIVE_PATH))
        if snapshot is None:
            self._observe(
                "ledger_absent",
                "info",
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳はまだ作成されていません",
            )
            return
        data = self._read_snapshot_file(
            episode_fd,
            "episode",
            LEDGER_RELATIVE_PATH,
            expected_device,
            MAX_LEDGER_BYTES,
            "ledger",
        )
        if data is None:
            return
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        try:
            connection.deserialize(data)
            connection.execute("PRAGMA query_only = ON")
            quick_check = [row[0] for row in connection.execute("PRAGMA quick_check").fetchall()]
            if quick_check != ["ok"]:
                self._observe(
                    "ledger_quick_check_failed",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite quick_checkが失敗しました",
                    {"result_count": len(quick_check), "sample": quick_check[:5]},
                )
            else:
                self._observe(
                    "ledger_quick_check_ok",
                    "ok",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite quick_checkに合格しました",
                )
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                self._observe(
                    "ledger_foreign_key_failed",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite foreign key整合性に違反があります",
                    {"violation_count": len(foreign_keys)},
                )
            else:
                self._observe(
                    "ledger_foreign_key_ok",
                    "ok",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "SQLite foreign key整合性に合格しました",
                )
            schema_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            schema_status = "ok" if schema_version == LEDGER_SCHEMA_VERSION else "not_inspected"
            self._observe(
                "ledger_schema_version",
                schema_status,
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳のschema versionを確認しました",
                {"observed": schema_version, "supported": LEDGER_SCHEMA_VERSION},
                incomplete=schema_version != LEDGER_SCHEMA_VERSION,
            )
            objects = connection.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','trigger')"
            ).fetchall()
            tables = {str(row["name"]): row for row in objects if row["type"] == "table"}
            triggers = {str(row["name"]): row for row in objects if row["type"] == "trigger"}
            missing_tables = sorted(LEDGER_REQUIRED_TABLES - tables.keys())
            missing_triggers = sorted(LEDGER_REQUIRED_TRIGGERS - triggers.keys())
            invalid_tables = self._invalid_ledger_tables(connection, tables)
            invalid_triggers = self._invalid_ledger_triggers(triggers)
            self._observe(
                "ledger_required_objects",
                "ok" if not missing_tables and not missing_triggers and not invalid_tables and not invalid_triggers
                else "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳のcolumn・制約・foreign key・append-only triggerを確認しました",
                {
                    "missing_tables": missing_tables,
                    "missing_triggers": missing_triggers,
                    "invalid_tables": invalid_tables,
                    "invalid_triggers": invalid_triggers,
                },
            )
            if missing_tables or invalid_tables:
                return
            self._inspect_ledger_artifacts(connection)
            self._inspect_ledger_relations(connection)
        except (sqlite3.DatabaseError, ValueError, OverflowError) as error:
            self._observe(
                "ledger_unreadable",
                "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "制作ジョブ台帳をSQLiteとして検査できません",
                {"error_type": type(error).__name__},
            )
        finally:
            connection.close()

    @staticmethod
    def _quoted_identifier(value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    def _invalid_ledger_tables(
        self,
        connection: sqlite3.Connection,
        tables: Mapping[str, sqlite3.Row],
    ) -> list[str]:
        issues: list[str] = []
        for table_name, expected_columns in LEDGER_COLUMN_CONTRACTS.items():
            if table_name not in tables:
                continue
            quoted_table = self._quoted_identifier(table_name)
            column_rows = connection.execute(f"PRAGMA table_info({quoted_table})").fetchall()
            actual_columns = tuple(
                (str(row["name"]), str(row["type"]).upper(), int(row["notnull"]), int(row["pk"]))
                for row in column_rows
            )
            if actual_columns != expected_columns:
                issues.append(f"{table_name}:columns")
            foreign_key_rows = connection.execute(f"PRAGMA foreign_key_list({quoted_table})").fetchall()
            actual_foreign_keys = {
                (str(row["from"]), str(row["table"]), str(row["to"])) for row in foreign_key_rows
            }
            if actual_foreign_keys != LEDGER_FOREIGN_KEY_CONTRACTS[table_name]:
                issues.append(f"{table_name}:foreign_keys")
            actual_unique: set[tuple[str, ...]] = set()
            for index in connection.execute(f"PRAGMA index_list({quoted_table})").fetchall():
                if int(index["unique"]) != 1:
                    continue
                quoted_index = self._quoted_identifier(str(index["name"]))
                columns = tuple(
                    str(row["name"])
                    for row in connection.execute(f"PRAGMA index_info({quoted_index})").fetchall()
                )
                actual_unique.add(columns)
            if not LEDGER_UNIQUE_CONTRACTS[table_name].issubset(actual_unique):
                issues.append(f"{table_name}:unique_constraints")
            schema_sql = tables[table_name]["sql"]
            normalized_sql = _normalized_schema_sql(schema_sql) if isinstance(schema_sql, str) else ""
            if any(fragment not in normalized_sql for fragment in LEDGER_CHECK_CONTRACTS.get(table_name, ())):
                issues.append(f"{table_name}:check_constraints")
        return sorted(set(issues))

    def _invalid_ledger_triggers(self, triggers: Mapping[str, sqlite3.Row]) -> list[str]:
        issues: list[str] = []
        for trigger_name, (table_name, operation) in LEDGER_TRIGGER_CONTRACTS.items():
            row = triggers.get(trigger_name)
            if row is None:
                continue
            sql = row["sql"]
            normalized = _normalized_trigger_sql(sql) if isinstance(sql, str) else ""
            pattern = re.compile(
                rf"^create trigger(?: if not exists)? {re.escape(trigger_name)} "
                rf"before {operation} on {re.escape(table_name)} begin "
                r"select raise\(abort,\s*'[^']+'\); end$"
            )
            if str(row["tbl_name"]) != table_name or pattern.fullmatch(normalized) is None:
                issues.append(trigger_name)
        return sorted(issues)

    def _inspect_ledger_artifacts(self, connection: sqlite3.Connection) -> None:
        rows = connection.execute(
            "SELECT sha256,relative_path,byte_size,media_type FROM artifacts ORDER BY relative_path"
        ).fetchall()
        listed_paths: set[str] = set()
        for row in rows:
            sha256 = row["sha256"]
            relative_path = row["relative_path"]
            byte_size = row["byte_size"]
            media_type = row["media_type"]
            safe = isinstance(relative_path, str) and _safe_relative_path(relative_path) is not None
            match = ARTIFACT_PATH_PATTERN.fullmatch(relative_path) if safe else None
            metadata_valid = (
                isinstance(sha256, str)
                and SHA256_PATTERN.fullmatch(sha256) is not None
                and match is not None
                and match.group(1) == sha256[:2]
                and match.group(2) == sha256
                and isinstance(byte_size, int)
                and byte_size >= 0
                and isinstance(media_type, str)
                and bool(media_type)
            )
            if metadata_valid and match is not None:
                expected_media_type = {
                    ".json": "application/json",
                    ".yaml": "application/yaml",
                    ".omny.yaml": "application/yaml",
                    ".png": "image/png",
                }[match.group(3)]
                metadata_valid = media_type == expected_media_type
            if not metadata_valid:
                self._observe(
                    "ledger_artifact_metadata_invalid",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "artifact行のpathまたはmetadataが不正です",
                    {"sha256": sha256 if isinstance(sha256, str) else "", "path_safe": safe},
                )
                continue
            listed_paths.add(relative_path)
            workspace_path = f"draft_data/nyamuru/{relative_path}"
            snapshot = self.files.get(("episode", workspace_path))
            if snapshot is None:
                self._observe(
                    "ledger_artifact_missing",
                    "error",
                    "episode",
                    workspace_path,
                    "台帳が参照するartifact fileがありません",
                    {"sha256": sha256},
                )
                continue
            mismatches: list[str] = []
            if snapshot["sha256"] != sha256:
                mismatches.append("sha256")
            if snapshot["byte_size"] != byte_size:
                mismatches.append("byte_size")
            if mismatches:
                self._observe(
                    "ledger_artifact_mismatch",
                    "error",
                    "episode",
                    workspace_path,
                    "台帳とartifact fileの内容が一致しません",
                    {"fields": mismatches, "expected_sha256": sha256},
                )
        artifact_prefix = "draft_data/nyamuru/artifacts/sha256/"
        for (root, path), snapshot in sorted(self.files.items()):
            if root != "episode" or not path.startswith(artifact_prefix):
                continue
            ledger_relative = path.removeprefix("draft_data/nyamuru/")
            match = ARTIFACT_PATH_PATTERN.fullmatch(ledger_relative)
            if (
                match is None
                or match.group(1) != match.group(2)[:2]
                or snapshot["sha256"] != match.group(2)
            ):
                self._observe(
                    "artifact_path_not_canonical",
                    "warning",
                    "episode",
                    path,
                    "content-addressed artifact directoryに非canonical fileがあります",
                    {},
                )
                continue
            if ledger_relative not in listed_paths:
                observation = self._observe(
                    "artifact_not_listed_in_ledger",
                    "warning",
                    "episode",
                    path,
                    "artifact fileは存在しますが台帳行がありません",
                    {"sha256": snapshot["sha256"]},
                )
                self._infer(
                    "possible_orphan_artifact",
                    "warning",
                    "episode",
                    path,
                    "孤立artifactの可能性があります。移動や削除はせず人間が参照元を確認してください",
                    [observation],
                )
        self._observe(
            "ledger_artifact_inventory",
            "ok",
            "episode",
            LEDGER_RELATIVE_PATH,
            "台帳artifact inventoryを検査しました",
            {"row_count": len(rows)},
        )

    def _inspect_ledger_relations(self, connection: sqlite3.Connection) -> None:
        attempts = connection.execute(
            """
            SELECT a.attempt_id,a.status,
                   GROUP_CONCAT(aa.role, ',') AS roles,
                   (SELECT se.status FROM status_events se
                     WHERE se.attempt_id=a.attempt_id ORDER BY se.event_id DESC LIMIT 1) AS latest_status
              FROM attempts a
              LEFT JOIN attempt_artifacts aa ON aa.attempt_id=a.attempt_id
             GROUP BY a.attempt_id,a.status ORDER BY a.attempt_id
            """
        ).fetchall()
        for row in attempts:
            roles = set(str(row["roles"] or "").split(",")) - {""}
            missing = sorted(LEDGER_REQUIRED_INPUT_ROLES - roles)
            if row["status"] == "succeeded":
                missing.extend(sorted(LEDGER_REQUIRED_SUCCESS_ROLES - roles))
            if missing:
                self._observe(
                    "attempt_required_artifact_missing",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "attemptに必須artifact roleがありません",
                    {"attempt_id": row["attempt_id"], "missing_roles": sorted(set(missing))},
                )
            if row["latest_status"] != row["status"]:
                self._observe(
                    "attempt_latest_status_mismatch",
                    "error",
                    "episode",
                    LEDGER_RELATIVE_PATH,
                    "attempt状態と最新status eventが一致しません",
                    {
                        "attempt_id": row["attempt_id"],
                        "attempt_status": row["status"],
                        "latest_event_status": row["latest_status"],
                    },
                )
        missing_provenance = int(
            connection.execute(
                "SELECT COUNT(*) FROM status_events WHERE provenance_sha256 IS NULL OR provenance_sha256=''"
            ).fetchone()[0]
        )
        if missing_provenance:
            self._observe(
                "status_event_provenance_missing",
                "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "status eventにprovenance artifactがありません",
                {"count": missing_provenance},
            )
        review_mismatches = connection.execute(
            """
            SELECT re.review_event_id,re.attempt_id,a.status,re.artifact_sha256,aa.sha256 AS output_sha256
              FROM review_events re
              JOIN attempts a ON a.attempt_id=re.attempt_id
              LEFT JOIN attempt_artifacts aa ON aa.attempt_id=re.attempt_id
                                            AND aa.role='manga_base_composite'
             WHERE a.status!='succeeded' OR aa.sha256 IS NULL OR re.artifact_sha256!=aa.sha256
             ORDER BY re.review_event_id
            """
        ).fetchall()
        for row in review_mismatches:
            self._observe(
                "review_target_mismatch",
                "error",
                "episode",
                LEDGER_RELATIVE_PATH,
                "review eventが成功済み4値artifactを参照していません",
                {"attempt_id": row["attempt_id"], "review_event_id": row["review_event_id"]},
            )
        self._observe(
            "ledger_relation_inventory",
            "ok",
            "episode",
            LEDGER_RELATIVE_PATH,
            "attempt・status event・review参照を検査しました",
            {"attempt_count": len(attempts), "review_mismatch_count": len(review_mismatches)},
        )
