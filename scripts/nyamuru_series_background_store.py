"""Immutable 3D model originals shared by a local series catalog."""
from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
import re
import secrets
from contextlib import contextmanager

from nyamuru_project_store import DIRECTORY_FLAGS, MAX_PROJECT_BYTES, MODEL_MEDIA_TYPES, read_regular_file, validate_model_header


SERIES_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
STAGE_ID_PATTERN = re.compile(r"stage-([a-f0-9]{64})")


def checked_series_id(value: object) -> str:
    if not isinstance(value, str) or not SERIES_ID_PATTERN.fullmatch(value):
        raise ValueError("シリーズの内部IDが正しくありません")
    return value


def checked_model(stage_id: object, model_format: object) -> tuple[str, str]:
    match = STAGE_ID_PATTERN.fullmatch(stage_id) if isinstance(stage_id, str) else None
    if not match or not isinstance(model_format, str) or model_format not in MODEL_MEDIA_TYPES:
        raise ValueError("3D背景の原本IDまたは形式が正しくありません")
    return match[1], model_format


def verify_model(data: bytes, digest: str, model_format: str) -> None:
    if not data or len(data) > MAX_PROJECT_BYTES or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError("3D背景の原本サイズまたはハッシュが一致しません")
    try:
        validate_model_header(data, model_format)
    except ValueError as error:
        raise ValueError("3D背景の原本形式を確認できません") from error


class SeriesBackgroundStore:
    def __init__(self, root: Path):
        self.root = root.expanduser().absolute()

    @contextmanager
    def directory(self, series_id: str, create: bool):
        # Open each untrusted component relative to its parent descriptor. A
        # symlink substitution cannot redirect reads or publication elsewhere.
        if create:
            self.root.mkdir(parents=True, exist_ok=True)
        descriptors = []
        try:
            descriptors.append(os.open(self.root, DIRECTORY_FLAGS))
            for name in (series_id, "backgrounds"):
                parent = descriptors[-1]
                if create:
                    try:
                        os.mkdir(name, mode=0o700, dir_fd=parent)
                        os.fsync(parent)
                    except FileExistsError:
                        pass
                descriptors.append(os.open(name, DIRECTORY_FLAGS, dir_fd=parent))
            yield descriptors[-1]
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    @staticmethod
    def read_model(folder: int, name: str, digest: str, model_format: str) -> bytes:
        data = read_regular_file(folder, name, MAX_PROJECT_BYTES)
        verify_model(data, digest, model_format)
        return data

    def save(self, series_id_value: object, stage_value: object, model_data_value: object) -> dict:
        series_id = checked_series_id(series_id_value)
        if not isinstance(stage_value, dict):
            raise ValueError("3D背景の保存情報が正しくありません")
        digest, model_format = checked_model(stage_value.get("id"), stage_value.get("format"))
        size = stage_value.get("byteLength")
        if (stage_value.get("sha256") != digest or type(size) is not int or not 0 < size <= MAX_PROJECT_BYTES
                or not isinstance(stage_value.get("storageId"), str) or not stage_value["storageId"]
                or not isinstance(stage_value.get("name"), str) or not stage_value["name"]):
            raise ValueError("3D背景の保存情報が正しくありません")
        if not isinstance(model_data_value, str) or len(model_data_value) != 4 * ((size + 2) // 3):
            raise ValueError("3D背景の原本データまたはサイズが正しくありません")
        try:
            data = base64.b64decode(model_data_value, validate=True)
        except ValueError as error:
            raise ValueError("3D背景の原本データが正しくありません") from error
        if len(data) != size:
            raise ValueError("3D背景の原本サイズが一致しません")
        verify_model(data, digest, model_format)
        name = f"{digest}.{model_format}"
        created = False
        try:
            with self.directory(series_id, create=True) as folder:
                try:
                    self.read_model(folder, name, digest, model_format)
                except FileNotFoundError:
                    temporary = f".model-{secrets.token_hex(12)}.tmp"
                    try:
                        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
                        with os.fdopen(fd, "wb") as stream:
                            stream.write(data)
                            stream.flush()
                            os.fsync(stream.fileno())
                        try:
                            # Publishing a complete temporary file never replaces
                            # an existing original, including concurrent saves.
                            os.link(temporary, name, src_dir_fd=folder, dst_dir_fd=folder, follow_symlinks=False)
                            created = True
                        except FileExistsError:
                            self.read_model(folder, name, digest, model_format)
                    finally:
                        try:
                            os.unlink(temporary, dir_fd=folder)
                        except FileNotFoundError:
                            pass
                    os.fsync(folder)
        except OSError as error:
            raise ValueError("3D背景の原本を保存できません。保存先を確認してください") from error
        return {"ok": True, "series_id": series_id, "stage_id": stage_value["id"], "created": created}

    def load(self, series_id_value: object, stage_id_value: object, format_value: object, verify_only: object = False) -> dict:
        series_id = checked_series_id(series_id_value)
        digest, model_format = checked_model(stage_id_value, format_value)
        if type(verify_only) is not bool:
            raise ValueError("3D背景の原本確認方法が正しくありません")
        result = {"found": False, "series_id": series_id, "stage_id": stage_id_value, "format": model_format}
        try:
            with self.directory(series_id, create=False) as folder:
                data = self.read_model(folder, f"{digest}.{model_format}", digest, model_format)
        except FileNotFoundError:
            return result
        except OSError as error:
            raise ValueError("3D背景の原本を読み込めません。保存先を確認してください") from error
        if verify_only:
            return {**result, "found": True, "byte_length": len(data)}
        return {**result, "found": True, "model_data": base64.b64encode(data).decode("ascii")}
