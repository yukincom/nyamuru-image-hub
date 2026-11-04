"""Verify the package manifest, document snapshots and BagIt payloads."""

from __future__ import annotations

import datetime as dt
import json
import os
import stat
from collections.abc import Mapping
from typing import Any

from production_package_files import (
    PACKAGE_SCHEMA_VERSION,
    PACKAGE_MANIFEST_KIND,
    MANIFEST_FILE_NAME,
    HASH_ALGORITHMS,
    _HEX_256,
    _HEX_512,
    _BAGIT_HEADER,
    ProductionPackageError,
    UnsafeWorkspaceEntry,
    BagItValidationError,
    _read_descriptor,
    _open_root_directory,
    _open_child_directory,
    _open_child_file,
    _open_file_beneath,
    normalize_managed_relative_path,
    _normalize_bag_payload_path,
)
from production_package_staging import _collect_regular_files, _validate_bagit_with_module


class ProductionPackageValidation:
    def _normalize_document(self, value: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise ProductionPackageError("document metadataはobjectで指定してください")
        allowed = ("title", "series_id", "episode_id", "episode_number")
        normalized: dict[str, Any] = {}
        for key in allowed:
            item = value.get(key)
            if key == "episode_number" and item is not None:
                if not isinstance(item, int) or isinstance(item, bool) or item < 0:
                    raise ProductionPackageError("episode_numberは0以上の整数で指定してください")
                normalized[key] = item
                continue
            if item is None and key != "title":
                continue
            if not isinstance(item, str) or not item.strip() or len(item.strip()) > 256:
                raise ProductionPackageError(f"{key}は1〜256文字の文字列で指定してください")
            normalized[key] = item.strip()
        return normalized

    def _document_bytes(self, value: str | bytes, label: str) -> bytes:
        if isinstance(value, str):
            encoded = value.encode("utf-8")
        elif isinstance(value, bytes):
            encoded = value
            try:
                value.decode("utf-8")
            except UnicodeDecodeError as error:
                raise ProductionPackageError(f"{label}はUTF-8で指定してください") from error
        else:
            raise ProductionPackageError(f"{label}は文字列またはUTF-8 bytesで指定してください")
        if not encoded:
            raise ProductionPackageError(f"{label}を空にすることはできません")
        return encoded

    def validate(self, package_directory: str | os.PathLike[str]) -> dict[str, Any]:
        bagit_module = self._require_bagit()
        try:
            package_fd, _ = _open_root_directory(package_directory, label="package")
        except UnsafeWorkspaceEntry as error:
            raise BagItValidationError(str(error)) from error
        try:
            return self._validate_package_fd(package_fd, bagit_module)
        finally:
            os.close(package_fd)

    def _validate_package_fd(self, package_fd: int, bagit_module: Any) -> dict[str, Any]:
        try:
            self._validate_bag_root(package_fd)
            _validate_bagit_with_module(package_fd, bagit_module)
            manifest = self._validate_manifest_payloads_fd(package_fd)
        except BagItValidationError:
            raise
        except ProductionPackageError as error:
            raise BagItValidationError(f"Nyamuru manifest検証に失敗しました: {error}") from error
        except (KeyError, TypeError, ValueError) as error:
            raise BagItValidationError(f"Nyamuru manifest検証に失敗しました: {error}") from error
        return {
            "ok": True,
            "valid": True,
            "schema_version": PACKAGE_SCHEMA_VERSION,
            "payload_count": len(manifest["payloads"]),
            "manifest": manifest,
        }

    def _validate_bag_root(self, package_fd: int) -> None:
        package_device = os.fstat(package_fd).st_dev
        required_files = {
            "bagit.txt",
            "bag-info.txt",
            "manifest-sha256.txt",
            "manifest-sha512.txt",
            "tagmanifest-sha256.txt",
            "tagmanifest-sha512.txt",
        }
        names = set(os.listdir(package_fd))
        if not required_files.issubset(names) or "data" not in names:
            raise BagItValidationError("packageに必須のBagIt fileまたはdata directoryがありません")
        for name in names:
            metadata = os.stat(name, dir_fd=package_fd, follow_symlinks=False)
            if name == "data":
                child, _ = _open_child_directory(
                    package_fd,
                    name,
                    expected_device=package_device,
                    label=name,
                )
                os.close(child)
                continue
            if not stat.S_ISREG(metadata.st_mode):
                raise BagItValidationError(f"package rootに通常file以外があります: {name}")
            descriptor, _ = _open_child_file(
                package_fd,
                name,
                expected_device=package_device,
                label=name,
            )
            os.close(descriptor)
        header_fd = _open_file_beneath(
            package_fd,
            ("bagit.txt",),
            expected_device=package_device,
            label="bagit.txt",
        )
        try:
            header = _read_descriptor(header_fd)
        finally:
            os.close(header_fd)
        if header != _BAGIT_HEADER:
            raise BagItValidationError("bagit.txtがNyamuruのBagIt 1.0 contractと一致しません")

    def _validate_manifest_payloads_fd(self, package_fd: int) -> dict[str, Any]:
        package_device = os.fstat(package_fd).st_dev
        data_fd, _ = _open_child_directory(
            package_fd,
            "data",
            expected_device=package_device,
            label="data",
        )
        try:
            manifest_fd, _ = _open_child_file(
                data_fd,
                MANIFEST_FILE_NAME,
                expected_device=package_device,
                label=f"data/{MANIFEST_FILE_NAME}",
            )
            try:
                manifest_bytes = _read_descriptor(manifest_fd)
            finally:
                os.close(manifest_fd)
            actual_files = _collect_regular_files(
                data_fd,
                prefix=("data",),
                expected_device=package_device,
            )
        finally:
            os.close(data_fd)
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BagItValidationError(f"{MANIFEST_FILE_NAME}を読み取れません: {error}") from error
        self._validate_manifest_shape(manifest)

        actual_by_path = {item["path"]: item for item in actual_files}
        listed_paths: set[str] = set()
        roles_by_path: dict[str, str] = {}
        for payload in manifest["payloads"]:
            payload_path = _normalize_bag_payload_path(payload.get("path"))
            if payload_path in listed_paths:
                raise BagItValidationError(f"manifest payload pathが重複しています: {payload_path}")
            listed_paths.add(payload_path)
            roles_by_path[payload_path] = payload["role"]
            if "source_relative_path" in payload:
                source_relative_path = normalize_managed_relative_path(payload["source_relative_path"])
                expected_payload_path = f"data/workspace/{source_relative_path}"
                if payload_path != expected_payload_path:
                    raise BagItValidationError(
                        f"workspace payload pathとsource_relative_pathが一致しません: {payload_path}"
                    )
            elif payload_path not in (
                manifest["document"]["omny_path"],
                manifest["document"]["omay_path"],
            ):
                raise BagItValidationError(f"sourceのないpayloadが固定document path外にあります: {payload_path}")
            actual = actual_by_path.get(payload_path)
            if actual is None:
                raise BagItValidationError(f"manifest掲載payloadがありません: {payload_path}")
            if actual["byte_size"] != payload["byte_size"]:
                raise BagItValidationError(f"payload sizeがmanifestと一致しません: {payload_path}")
            if actual["sha256"] != payload["sha256"] or actual["sha512"] != payload["sha512"]:
                raise BagItValidationError(f"payload hashがmanifestと一致しません: {payload_path}")

        actual_paths = set(actual_by_path) - {f"data/{MANIFEST_FILE_NAME}"}
        if actual_paths != listed_paths:
            missing = sorted(listed_paths - actual_paths)
            extra = sorted(actual_paths - listed_paths)
            raise BagItValidationError(f"manifestとdata payload一覧が一致しません: missing={missing}, extra={extra}")

        document = manifest["document"]
        if roles_by_path.get(document["omny_path"]) != "story_omny":
            raise BagItValidationError("document.omny_pathがstory_omny payloadを参照していません")
        if roles_by_path.get(document["omay_path"]) != "style_omay":
            raise BagItValidationError("document.omay_pathがstyle_omay payloadを参照していません")
        return manifest

    def _validate_manifest_shape(self, manifest: object) -> None:
        if not isinstance(manifest, dict):
            raise BagItValidationError("manifestはJSON objectである必要があります")
        allowed_root = {"schema_version", "kind", "created_at", "bagit", "document", "payloads"}
        if set(manifest) != allowed_root:
            raise BagItValidationError("manifestのroot fieldsがv1 schemaと一致しません")
        if manifest.get("schema_version") != PACKAGE_SCHEMA_VERSION or manifest.get("kind") != PACKAGE_MANIFEST_KIND:
            raise BagItValidationError("manifestのschema_versionまたはkindが不正です")
        if not isinstance(manifest.get("created_at"), str) or not manifest["created_at"].endswith("Z"):
            raise BagItValidationError("manifest.created_atはUTC日時である必要があります")
        try:
            parsed_created_at = dt.datetime.fromisoformat(manifest["created_at"].replace("Z", "+00:00"))
        except ValueError as error:
            raise BagItValidationError("manifest.created_atが有効な日時ではありません") from error
        if parsed_created_at.tzinfo is None or parsed_created_at.utcoffset() != dt.timedelta(0):
            raise BagItValidationError("manifest.created_atはUTC日時である必要があります")
        bagit_section = manifest.get("bagit")
        if bagit_section != {"version": "1.0", "algorithms": list(HASH_ALGORITHMS)}:
            raise BagItValidationError("manifest.bagitはBagIt 1.0とsha256/sha512である必要があります")
        document = manifest.get("document")
        if not isinstance(document, dict):
            raise BagItValidationError("manifest.documentはobjectである必要があります")
        required_document = {"title", "omny_path", "omay_path"}
        allowed_document = required_document | {"series_id", "episode_id", "episode_number"}
        if not required_document.issubset(document) or not set(document).issubset(allowed_document):
            raise BagItValidationError("manifest.document fieldsがv1 schemaと一致しません")
        for key in ("title", "omny_path", "omay_path"):
            if not isinstance(document[key], str) or not document[key]:
                raise BagItValidationError(f"manifest.document.{key}が不正です")
        if len(document["title"]) > 256:
            raise BagItValidationError("manifest.document.titleが長すぎます")
        for key in ("series_id", "episode_id"):
            if key in document and (
                not isinstance(document[key], str)
                or not document[key]
                or len(document[key]) > 256
            ):
                raise BagItValidationError(f"manifest.document.{key}が不正です")
        if "episode_number" in document and (
            not isinstance(document["episode_number"], int)
            or isinstance(document["episode_number"], bool)
            or document["episode_number"] < 0
        ):
            raise BagItValidationError("manifest.document.episode_numberが不正です")
        if document["omny_path"] not in ("data/name/document.yaml", "data/name/document.omny.yaml"):
            raise BagItValidationError("manifest.document.omny_pathが固定pathと一致しません")
        if document["omay_path"] not in ("data/style/settings.yaml", "data/style/document.omay.yaml"):
            raise BagItValidationError("manifest.document.omay_pathが固定pathと一致しません")
        payloads = manifest.get("payloads")
        if not isinstance(payloads, list) or len(payloads) < 2:
            raise BagItValidationError("manifest.payloadsにはOMNY/OMAYが必要です")
        valid_roles = {
            "story_omny",
            "style_omay",
            "editable_psd",
            "reference_asset",
            "coverage_report",
            "workspace_payload",
        }
        for payload in payloads:
            if not isinstance(payload, dict):
                raise BagItValidationError("manifest.payloadはobjectである必要があります")
            required = {"role", "path", "media_type", "byte_size", "sha256", "sha512"}
            allowed = required | {"source_relative_path"}
            if not required.issubset(payload) or not set(payload).issubset(allowed):
                raise BagItValidationError("manifest.payload fieldsがv1 schemaと一致しません")
            if payload["role"] not in valid_roles:
                raise BagItValidationError(f"manifest payload roleが不正です: {payload['role']!r}")
            if (
                not isinstance(payload["media_type"], str)
                or not payload["media_type"]
                or len(payload["media_type"]) > 255
            ):
                raise BagItValidationError("manifest payload media_typeが不正です")
            if (
                not isinstance(payload["byte_size"], int)
                or isinstance(payload["byte_size"], bool)
                or payload["byte_size"] < 0
            ):
                raise BagItValidationError("manifest payload byte_sizeが不正です")
            if not isinstance(payload["sha256"], str) or not _HEX_256.fullmatch(payload["sha256"]):
                raise BagItValidationError("manifest payload sha256が不正です")
            if not isinstance(payload["sha512"], str) or not _HEX_512.fullmatch(payload["sha512"]):
                raise BagItValidationError("manifest payload sha512が不正です")
