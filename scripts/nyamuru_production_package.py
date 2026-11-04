#!/usr/bin/env python3
"""Create and validate local Nyamuru production packages.

The module deliberately has no bridge or UI dependency.  It scans only the
workspace directories owned by the manga-production workflow, produces a
content-addressed plan, then rechecks that plan immediately before export.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import secrets
import sys
from pathlib import Path
from collections.abc import Callable, Mapping, Sequence
from typing import Any

# The public entry point can also be loaded directly by its file path.
_script_directory = str(Path(__file__).resolve().parent)
if _script_directory not in sys.path:
    sys.path.insert(0, _script_directory)

from production_package_files import (
    PACKAGE_SCHEMA_VERSION,
    PACKAGE_PLAN_KIND,
    PACKAGE_MANIFEST_KIND,
    MANIFEST_FILE_NAME,
    MANAGED_SOURCE_DIRECTORIES,
    EXPORT_DIRECTORY,
    HASH_ALGORITHMS,
    _COPY_CHUNK_SIZE,
    _HEX_256,
    _HEX_512,
    _BAGIT_HEADER,
    _MAX_STAGING_NAME_ATTEMPTS,
    ProductionPackageError,
    UnsafeWorkspaceEntry,
    PackagePlanConflict,
    PackageDestinationExists,
    BagItUnavailable,
    BagItValidationError,
    _canonical_json_bytes,
    _hash_bytes,
    _stat_identity,
    _entry_identity,
    _directory_open_flags,
    _file_open_flags,
    _validate_component,
    _read_descriptor,
    _hash_descriptor,
    _open_root_directory,
    _open_child_directory,
    _open_child_file,
    _open_file_beneath,
    _OwnedEntries,
    _ensure_owned_directory,
    _write_owned_file,
    normalize_managed_relative_path,
    _normalize_bag_payload_path,
)
from production_package_payloads import (
    _media_type,
    _payload_role,
    _safe_package_slug,
    _format_utc,
    ProductionPackagePayloads,
)
from production_package_staging import (
    _atomic_rename_no_replace,
    _open_owned_parent,
    _cleanup_owned_entries,
    _cleanup_owned_root,
    _collect_regular_files,
    _make_bag_fd,
    _BAGIT_FD_VALIDATOR,
    _validate_bagit_with_module,
)
from production_package_validation import ProductionPackageValidation


try:  # Optional by design: planning must work without bagit-python.
    import bagit as _installed_bagit
except ImportError:  # pragma: no cover - depends on the caller's environment
    _installed_bagit = None


_DEFAULT_BAGIT = object()


class ProductionPackageCore(ProductionPackagePayloads, ProductionPackageValidation):
    """Plan, export and validate immutable local production packages."""

    def __init__(
        self,
        *,
        bagit_module: object = _DEFAULT_BAGIT,
        now: Callable[[], dt.datetime] | None = None,
        _test_hook: Callable[[str, Mapping[str, object]], None] | None = None,
        _token_factory: Callable[[], str] | None = None,
        _rename_noreplace: Callable[[int, str, str], None] | None = None,
    ) -> None:
        self._bagit = _installed_bagit if bagit_module is _DEFAULT_BAGIT else bagit_module
        self._now = now or (lambda: dt.datetime.now(dt.timezone.utc))
        self._test_hook = _test_hook
        self._token_factory = _token_factory or (lambda: secrets.token_hex(16))
        self._rename_noreplace = _rename_noreplace or _atomic_rename_no_replace

    @property
    def bagit_available(self) -> bool:
        return self._bagit is not None

    def _trigger(self, event: str, **details: object) -> None:
        if self._test_hook is not None:
            self._test_hook(event, details)

    def _require_bagit(self) -> Any:
        if self._bagit is None:
            raise BagItUnavailable(
                "export/validateには bagit-python 1.9.0 が必要です。"
                "requirements-package.txt を明示的に導入してください"
            )
        return self._bagit

    def export(
        self,
        workspace: str | os.PathLike[str],
        *,
        plan_revision: str,
        selected_files: Sequence[Mapping[str, Any]],
        omny_yaml: str | bytes,
        omay_yaml: str | bytes,
        document: Mapping[str, Any],
    ) -> dict[str, Any]:
        bagit_module = self._require_bagit()
        root_fd, root_metadata = _open_root_directory(workspace, label="workspace")
        export_fd: int | None = None
        staging_fd: int | None = None
        staging_name: str | None = None
        active_name: str | None = None
        staging_identity: tuple[int, int, int] | None = None
        owned = _OwnedEntries()
        completed = False
        try:
            current_plan = self._plan_fd(root_fd, root_metadata)
            if not isinstance(plan_revision, str) or plan_revision != current_plan["plan_revision"]:
                raise PackagePlanConflict("workspaceがplan作成後に変化しました。planを再作成してください")
            selected = self._normalize_selections(selected_files, current_plan["candidates"])
            normalized_document = self._normalize_document(document)
            omny_bytes = self._document_bytes(omny_yaml, "OMNY")
            omay_bytes = self._document_bytes(omay_yaml, "OMAY")
            self._trigger("replan_complete_before_copy", workspace_fd=root_fd)

            try:
                os.mkdir(EXPORT_DIRECTORY, 0o700, dir_fd=root_fd)
            except FileExistsError:
                pass
            export_fd, export_metadata = _open_child_directory(
                root_fd,
                EXPORT_DIRECTORY,
                expected_device=root_metadata.st_dev,
                label=EXPORT_DIRECTORY,
            )
            export_identity = _entry_identity(export_metadata)
            self._trigger("export_fd_opened", workspace_fd=root_fd, export_fd=export_fd)

            created_at = _format_utc(self._now())
            timestamp = created_at.replace("-", "").replace(":", "")
            package_name = f"{_safe_package_slug(normalized_document['title'])}-{timestamp}-package"
            _validate_component(package_name)

            for _attempt in range(_MAX_STAGING_NAME_ATTEMPTS):
                candidate_name = f".nyamuru-package-{self._token_factory()}"
                _validate_component(candidate_name)
                try:
                    os.mkdir(candidate_name, 0o700, dir_fd=export_fd)
                except FileExistsError:
                    continue
                listed = os.stat(candidate_name, dir_fd=export_fd, follow_symlinks=False)
                staging_fd, opened = _open_child_directory(
                    export_fd,
                    candidate_name,
                    expected_device=export_metadata.st_dev,
                    label=candidate_name,
                )
                if _entry_identity(listed) != _entry_identity(opened):
                    os.close(staging_fd)
                    staging_fd = None
                    raise PackagePlanConflict("staging directoryが作成直後に差し替えられました")
                os.fchmod(staging_fd, 0o700)
                staging_name = candidate_name
                active_name = candidate_name
                staging_identity = _entry_identity(opened)
                break
            if staging_fd is None or staging_name is None or staging_identity is None:
                raise ProductionPackageError("安全なstaging directory名を作成できません")
            self._trigger(
                "staging_fd_opened",
                export_fd=export_fd,
                staging_fd=staging_fd,
                staging_name=staging_name,
            )

            data_fd = _ensure_owned_directory(staging_fd, ("data",), owned)
            os.close(data_fd)
            payloads: list[dict[str, Any]] = []
            omny_path = "data/name/document.yaml"
            omay_path = "data/style/settings.yaml"
            omny_details = _write_owned_file(
                staging_fd,
                ("data", "name", "document.yaml"),
                omny_bytes,
                owned,
            )
            omay_details = _write_owned_file(
                staging_fd,
                ("data", "style", "settings.yaml"),
                omay_bytes,
                owned,
            )
            payloads.append(
                {
                    "role": "story_omny",
                    "path": omny_path,
                    "media_type": "application/yaml",
                    **omny_details,
                }
            )
            payloads.append(
                {
                    "role": "style_omay",
                    "path": omay_path,
                    "media_type": "application/yaml",
                    **omay_details,
                }
            )
            payloads.extend(
                self._copy_selected_file(
                    root_fd,
                    root_metadata.st_dev,
                    staging_fd,
                    owned,
                    candidate,
                )
                for candidate in selected
            )
            payloads.sort(key=lambda payload: payload["path"])

            manifest = {
                "schema_version": PACKAGE_SCHEMA_VERSION,
                "kind": PACKAGE_MANIFEST_KIND,
                "created_at": created_at,
                "bagit": {"version": "1.0", "algorithms": list(HASH_ALGORITHMS)},
                "document": {
                    **normalized_document,
                    "omny_path": omny_path,
                    "omay_path": omay_path,
                },
                "payloads": payloads,
            }
            manifest_bytes = json.dumps(
                manifest,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            ).encode("utf-8") + b"\n"
            _write_owned_file(staging_fd, ("data", MANIFEST_FILE_NAME), manifest_bytes, owned)
            _make_bag_fd(
                staging_fd,
                package_name=package_name,
                bagging_date=created_at[:10],
                owned=owned,
            )
            self._trigger("bagit_complete", staging_fd=staging_fd)

            self._trigger(
                "before_publish",
                workspace_fd=root_fd,
                export_fd=export_fd,
                staging_fd=staging_fd,
                staging_name=staging_name,
                package_name=package_name,
            )
            self._assert_export_identity(root_fd, export_fd, export_identity)
            current_staging = os.stat(staging_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(current_staging) != staging_identity:
                raise PackagePlanConflict("publish直前にstaging directoryが差し替えられました")
            # Validate after the final caller-visible hook, then recheck every
            # pathname identity because validation can be long for large PSDs.
            self._validate_package_fd(staging_fd, bagit_module)
            self._assert_export_identity(root_fd, export_fd, export_identity)
            current_staging = os.stat(staging_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(current_staging) != staging_identity:
                raise PackagePlanConflict("publish最終検証中にstaging directoryが差し替えられました")
            self._rename_noreplace(export_fd, staging_name, package_name)
            active_name = package_name
            os.fsync(export_fd)
            self._assert_export_identity(root_fd, export_fd, export_identity)
            published = os.stat(package_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(published) != staging_identity:
                raise PackagePlanConflict("publish後のpackage identityがstagingと一致しません")
            self._trigger(
                "published_before_final_validation",
                workspace_fd=root_fd,
                export_fd=export_fd,
                staging_fd=staging_fd,
                package_name=package_name,
            )
            validation = self._validate_package_fd(staging_fd, bagit_module)
            self._assert_export_identity(root_fd, export_fd, export_identity)
            published = os.stat(package_name, dir_fd=export_fd, follow_symlinks=False)
            if _entry_identity(published) != staging_identity:
                raise PackagePlanConflict("publish後最終検証中にpackageが差し替えられました")
            completed = True
            return {
                "ok": True,
                "schema_version": PACKAGE_SCHEMA_VERSION,
                "package_relative_path": f"{EXPORT_DIRECTORY}/{package_name}",
                "plan_revision": current_plan["plan_revision"],
                "payload_count": len(payloads),
                "algorithms": list(HASH_ALGORITHMS),
                "valid": validation["valid"],
            }
        finally:
            if (
                not completed
                and export_fd is not None
                and staging_fd is not None
                and active_name is not None
                and staging_identity is not None
            ):
                self._trigger(
                    "before_cleanup",
                    export_fd=export_fd,
                    staging_fd=staging_fd,
                    staging_name=active_name,
                )
                _cleanup_owned_root(
                    export_fd,
                    active_name,
                    staging_fd,
                    staging_identity,
                    owned,
                )
            if staging_fd is not None:
                os.close(staging_fd)
            if export_fd is not None:
                os.close(export_fd)
            os.close(root_fd)

    def _assert_export_identity(
        self,
        workspace_fd: int,
        export_fd: int,
        expected: tuple[int, int, int],
    ) -> None:
        try:
            listed = os.stat(EXPORT_DIRECTORY, dir_fd=workspace_fd, follow_symlinks=False)
        except FileNotFoundError as error:
            raise PackagePlanConflict("export_dataが処理中に移動されました") from error
        opened = os.fstat(export_fd)
        if _entry_identity(listed) != expected or _entry_identity(opened) != expected:
            raise PackagePlanConflict("export_dataが処理中に差し替えられました")


__all__ = [
    "BagItUnavailable",
    "BagItValidationError",
    "PackageDestinationExists",
    "PackagePlanConflict",
    "ProductionPackageCore",
    "ProductionPackageError",
    "UnsafeWorkspaceEntry",
    "normalize_managed_relative_path",
]
