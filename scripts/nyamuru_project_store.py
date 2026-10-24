"""Atomic local snapshots with immutable, content-addressed image/model originals."""
from __future__ import annotations

import base64
import fcntl
import hashlib
import json
import math
import re
import os
import secrets
import stat
import struct
from contextlib import contextmanager
from pathlib import Path

MAX_PROJECT_BYTES = 96 * 1024 * 1024
PROJECT_FILE = "project.json"
ASSET_DIRECTORY = "assets"
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
IMAGE_MEDIA_TYPES = ("image/png", "image/jpeg", "image/webp")
MODEL_MEDIA_TYPES = {"glb": "model/gltf-binary", "fbx": "application/vnd.autodesk.fbx"}
PAINT_INKS = ("#000000", "#ffffff", "#ff0000", "#0000ff", "#00ff00", "#ffff00")


def number(value: object) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def box(value: object) -> bool:
    return isinstance(value, dict) and all(number(value.get(k)) for k in ("x", "y", "w", "h")) and value["w"] > 0 and value["h"] > 0


def paint_ink(value: object) -> bool:
    return value is None or isinstance(value, str) and value.lower() in PAINT_INKS


def image_dimensions(data: bytes, media_type: str) -> tuple[int, int]:
    """Inspect PNG/JPEG headers without rewriting or decoding the original."""
    if media_type == "image/png":
        if len(data) >= 33 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[8:16] == b"\x00\x00\x00\x0dIHDR":
            return struct.unpack(">II", data[16:24])
    elif media_type == "image/jpeg" and data[:2] == b"\xff\xd8":
        offset = 2
        while offset < len(data):
            if data[offset] != 0xff:
                break
            while offset < len(data) and data[offset] == 0xff:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in (0xd9, 0xda):
                break
            if marker == 0x01 or 0xd0 <= marker <= 0xd7:
                continue
            if offset + 2 > len(data):
                break
            length = int.from_bytes(data[offset:offset + 2], "big")
            if length < 2 or offset + length > len(data):
                break
            if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
                if length < 8:
                    break
                height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
                return width, height
            offset += length
    raise ValueError("配置画像の形式を確認してください")


def validate_model_header(data: bytes, model_format: str) -> None:
    """Check container/header integrity only; never load linked resources or render."""
    if model_format == "glb":
        if len(data) < 20 or data[:4] != b"glTF":
            raise ValueError()
        version, size = struct.unpack_from("<II", data, 4)
        if version != 2 or size != len(data):
            raise ValueError()
        offset = 12
        first = True
        while offset < size:
            if offset + 8 > size:
                raise ValueError()
            length, kind = struct.unpack_from("<II", data, offset)
            offset += 8
            if length % 4 or offset + length > size:
                raise ValueError()
            if first:
                if kind != 0x4e4f534a or not length:
                    raise ValueError()
                header = json.loads(data[offset:offset + length].decode("utf-8"))
                if not isinstance(header, dict) or not isinstance(header.get("asset"), dict) or header["asset"].get("version") != "2.0":
                    raise ValueError()
            elif kind == 0x4e4f534a:
                raise ValueError()
            first = False
            offset += length
        if first:
            raise ValueError()
        return
    if model_format != "fbx":
        raise ValueError()
    signature = b"Kaydara FBX Binary  \x00\x1a\x00"
    if data.startswith(signature):
        if len(data) < 27:
            raise ValueError()
        version = struct.unpack_from("<I", data, 23)[0]
        record_size = 25 if version >= 7500 else 13
        if version < 6400 or len(data) < 27 + record_size:
            raise ValueError()
        record_type = "<QQQB" if version >= 7500 else "<IIIB"
        end, properties, property_bytes, name_length = struct.unpack_from(record_type, data, 27)
        if end == 0:
            if properties or property_bytes or name_length:
                raise ValueError()
        elif end < 27 + record_size + name_length + property_bytes or end > len(data):
            raise ValueError()
        return
    # ASCII FBX exporters place this versioned header before scene/object data.
    header = data[:65536]
    version = re.search(rb"(?m)^\s*FBXVersion\s*:\s*(\d+)\s*$", header)
    if b"\x00" in header or not re.search(rb"(?m)^\s*FBXHeaderExtension\s*:\s*\{", header) or not version or int(version[1]) < 7000:
        raise ValueError()


def validate_background_capture(value: object, stage_ids: set[str]) -> None:
    def within(n, low, high):
        return number(n) and low <= n <= high
    def vector(v):
        return isinstance(v, list) and len(v) == 3 and all(within(n, -1e12, 1e12) for n in v)
    if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1:
        raise ValueError()
    source = value.get("sourceId")
    camera, light = value.get("camera"), value.get("light")
    if (not isinstance(source, str) or source != "builtin:cube" and source not in stage_ids
            or not isinstance(camera, dict) or not vector(camera.get("position")) or not vector(camera.get("target"))
            or math.dist(camera["position"], camera["target"]) < 1e-8 or not within(camera.get("fov"), 5, 150)
            or not isinstance(light, dict) or not within(light.get("azimuth"), -360, 360) or not within(light.get("elevation"), -90, 90)
            or not within(value.get("outlineWidth"), .1, 1000) or not within(value.get("detailWidth"), .1, 1000)
            or not within(value.get("creaseAngle"), 0, 180) or not within(value.get("detail"), 0, 1) or not within(value.get("lineGap"), 0, .9)
            or not within(value.get("blackAmount"), 0, 100) or type(value.get("toneEnabled")) is not bool
            or not within(value.get("toneDensity"), 0, 100) or not within(value.get("toneLpi"), 1, 1000)
            or not box(value.get("frame")) or not isinstance(value.get("layerIds"), list) or len(value["layerIds"]) > 64
            or any(not isinstance(layer_id, str) or not layer_id for layer_id in value["layerIds"])):
        raise ValueError()
    if "shift" in camera and (not isinstance(camera["shift"], list) or len(camera["shift"]) != 2
                              or not all(number(n) for n in camera["shift"])):
        raise ValueError()
    if "cutaway" in value:
        cutaway = value["cutaway"]
        if not isinstance(cutaway, dict) or type(cutaway.get("enabled")) is not bool or not within(cutaway.get("depth"), .05, .45):
            raise ValueError()
    if "objectVisibility" in value:
        rules = value["objectVisibility"]
        if (not isinstance(rules, list) or any(not isinstance(rule, dict)
                or type(rule.get("mesh")) is not int or not 0 <= rule["mesh"] <= 9007199254740991
                or rule.get("mode") not in ("show", "hide") for rule in rules)
                or len({rule["mesh"] for rule in rules}) != len(rules)):
            raise ValueError()
    if "preset" in light and light["preset"] not in ("daylight", "evening", "indoor"):
        raise ValueError()
    if "ceiling" in light and type(light["ceiling"]) is not bool:
        raise ValueError()
    for key, low, high in (("intensity", .1, 4), ("bounce", 0, 2)):
        if key in light and not within(light[key], low, high):
            raise ValueError()
    if "windowMesh" in light and (type(light["windowMesh"]) is not int or not 0 <= light["windowMesh"] <= 9007199254740991):
        raise ValueError()
    if "toneThreshold" in value and not within(value["toneThreshold"], 0, 100):
        raise ValueError()
    if "focusPoint" in value and (not vector(value["focusPoint"]) or "focusMesh" not in value):
        raise ValueError()
    if "focusMesh" in value and (type(value["focusMesh"]) is not int or not 0 <= value["focusMesh"] <= 9007199254740991):
        raise ValueError()


def validate_paint(content: dict, images: dict, stage_ids: set[str] | None = None) -> None:
    """Validate editable layers and their original references before atomic save."""
    if content["assetId"] not in images:
        raise ValueError()
    if "paint" not in content:
        return
    paint = content["paint"]
    image = images[content["assetId"]]
    if (paint["version"] != 1 or any(type(paint[k]) is not int or not 0 < paint[k] <= 16384 for k in ("width", "height"))
            or paint["width"] * paint["height"] > 100_000_000 or not number(paint["dpi"]) or paint["dpi"] <= 0
            or (paint["width"], paint["height"]) != (image["widthPx"], image["heightPx"])
            or not isinstance(paint["layers"], list) or not 1 <= len(paint["layers"]) <= 64
            or ("referenceFrame" in paint and not box(paint["referenceFrame"]))):
        raise ValueError()
    if "guideInitialized" in paint and type(paint["guideInitialized"]) is not bool:
        raise ValueError()
    if "background3d" in paint:
        validate_background_capture(paint["background3d"], stage_ids or set())
    ids = set()
    points = 0
    for layer in paint["layers"]:
        if (not isinstance(layer["id"], str) or not layer["id"] or layer["id"] in ids or not isinstance(layer["name"], str)
                or type(layer["visible"]) is not bool or type(layer["locked"]) is not bool
                or not number(layer["opacity"]) or not 0 <= layer["opacity"] <= 1
                or layer["blend"] not in ("normal", "multiply") or not isinstance(layer["strokes"], list)
                or ("clip" in layer and not box(layer["clip"]))):
            raise ValueError()
        if (layer.get("kind", "raster") not in ("raster", "vector")
                or type(layer.get("antialias", 3)) is not int or layer.get("antialias", 3) not in (0, 1, 2, 3)
                or ("paths" in layer and (layer.get("kind") != "vector" or not isinstance(layer["paths"], list)))):
            raise ValueError()
        path_ids = set()
        def vector_point(point):
            return isinstance(point, dict) and all(number(point.get(k)) for k in ("x", "y"))
        for path in layer.get("paths", []):
            if (not isinstance(path, dict) or not isinstance(path.get("id"), str) or not path["id"] or path["id"] in path_ids
                    or type(path.get("closed")) is not bool or not isinstance(path.get("nodes"), list) or not path["nodes"]):
                raise ValueError()
            path_ids.add(path["id"])
            style = path.get("style", {})
            if (not isinstance(style, dict) or "stroke" not in style or not paint_ink(style["stroke"])
                    or "fill" not in style or not paint_ink(style["fill"])
                    or not number(style.get("width")) or not 0 < style["width"] <= 10000
                    or style.get("cap") not in ("butt", "round", "square") or style.get("join") not in ("miter", "round", "bevel")
                    or not number(style.get("miterLimit")) or not 1 <= style["miterLimit"] <= 1000
                    or not isinstance(style.get("dash"), list) or len(style["dash"]) > 6
                    or any(not number(n) or n <= 0 for n in style["dash"]) or not number(style.get("dashOffset"))
                    or style.get("alignment") not in ("center", "inside", "outside")
                    or any(style.get(k) not in ("none", "triangle", "open", "circle") for k in ("arrowStart", "arrowEnd"))
                    or style.get("profile") not in ("uniform", "taper", "spindle")):
                raise ValueError()
            points += len(path["nodes"])
            if points > 2_000_000:
                raise ValueError()
            for node in path["nodes"]:
                if not vector_point(node) or any(k in node and not vector_point(node[k]) for k in ("handleIn", "handleOut")):
                    raise ValueError()
        ids.add(layer["id"])
        if "image" in layer:
            raster = layer["image"]
            source = images[raster["assetId"]]
            crop = raster["crop"]
            if (not box(raster["bbox"]) or not box(crop) or crop["x"] < 0 or crop["y"] < 0
                    or crop["x"] + crop["w"] > source["widthPx"] or crop["y"] + crop["h"] > source["heightPx"]):
                raise ValueError()
        if "guide" in layer and type(layer["guide"]) is not bool:
            raise ValueError()
        generation_mask = layer.get("generationMask", {})
        if "generationMask" in layer and (not isinstance(generation_mask, dict) or type(generation_mask.get("enabled")) is not bool or not isinstance(generation_mask.get("strokes"), list)):
            raise ValueError()
        mask = layer.get("mask", {})
        if "mask" in layer and (not isinstance(mask, dict) or type(mask.get("enabled")) is not bool or type(mask.get("reveal")) is not bool or not isinstance(mask.get("strokes"), list)):
            raise ValueError()
        if "tone" in layer:
            tone = layer["tone"]
            if (not isinstance(tone, dict) or type(tone.get("enabled")) is not bool or not number(tone.get("lpi")) or not 0 < tone["lpi"] <= 1000
                    or tone.get("mode") not in ("image", "fixed") or not number(tone.get("density")) or not 0 <= tone["density"] <= 100
                    or ("fill" in tone and (type(tone["fill"]) is not bool or tone["fill"] and tone["mode"] != "fixed"))
                    or ("angle" in tone and (not number(tone["angle"]) or not 0 <= tone["angle"] <= 360))
                    or ("origin" in tone and not vector_point(tone["origin"]))):
                raise ValueError()
        for stroke in [*layer["strokes"], *mask.get("strokes", []), *generation_mask.get("strokes", [])]:
            if (stroke["tool"] not in ("pen", "eraser", "line", "rectangle", "ellipse", "fill", "clear")
                    or (stroke["color"] is not None and (not isinstance(stroke["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", stroke["color"])))
                    or not number(stroke["size"]) or stroke["size"] <= 0
                    or not isinstance(stroke["points"], list) or not stroke["points"]):
                raise ValueError()
            if "fill" in stroke and not paint_ink(stroke["fill"]):
                raise ValueError()
            selection = stroke.get("selection")
            if "selection" in stroke and (not isinstance(selection, list) or any(not box(b) for b in selection)):
                raise ValueError()
            if stroke["tool"] in ("fill", "clear") and not isinstance(selection, list):
                raise ValueError()
            points += len(stroke["points"]) + len(selection or [])
            if points > 2_000_000:
                raise ValueError()
            for point in stroke["points"]:
                if not all(number(point[k]) for k in ("x", "y", "pressure", "time")) or not 0 <= point["pressure"] <= 1:
                    raise ValueError()


def validate_snapshot(value: object) -> dict:
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("作品の保存形式に対応していません")
    try:
        manga = value["document"]["manga"]
        episode_id = manga["meta"]["episode_id"]
        pages = manga["pages"]
        assets = value["assets"]
        if not isinstance(episode_id, str) or not episode_id.strip():
            raise ValueError()
        if not isinstance(pages, list) or not isinstance(assets, list):
            raise ValueError()
        by_id = {}
        for asset in assets:
            if not isinstance(asset["id"], str) or not asset["id"] or asset["id"] in by_id:
                raise ValueError()
            if asset["type"] not in (*IMAGE_MEDIA_TYPES, *MODEL_MEDIA_TYPES.values()):
                raise ValueError()
            data = base64.b64decode(asset["data"], validate=True)
            if not data:
                raise ValueError()
            for model_format, media_type in MODEL_MEDIA_TYPES.items():
                if asset["type"] == media_type:
                    validate_model_header(data, model_format)
            by_id[asset["id"]] = (asset["type"], data)
        stages = manga.get("background_stages", [])
        if not isinstance(stages, list):
            raise ValueError()
        stage_ids = set()
        for stage in stages:
            digest = stage["sha256"]
            if (not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)
                    or stage["id"] != f"stage-{digest}" or stage["id"] in stage_ids
                    or not isinstance(stage["storageId"], str) or not stage["storageId"]
                    or not isinstance(stage["name"], str) or not stage["name"] or stage["format"] not in MODEL_MEDIA_TYPES
                    or type(stage["byteLength"]) is not int or stage["byteLength"] <= 0):
                raise ValueError()
            media_type, data = by_id[stage["storageId"]]
            if media_type != MODEL_MEDIA_TYPES[stage["format"]] or stage["byteLength"] != len(data) or digest != hashlib.sha256(data).hexdigest():
                raise ValueError()
            stage_ids.add(stage["id"])
        image_assets = manga.get("image_assets", [])
        if not isinstance(image_assets, list):
            raise ValueError()
        image_ids = set()
        for image in image_assets:
            if not isinstance(image["id"], str) or not image["id"] or image["id"] in image_ids:
                raise ValueError()
            media_type, data = by_id[image["storageId"]]
            if media_type not in ("image/png", "image/jpeg") or media_type != image["mediaType"]:
                raise ValueError()
            if not isinstance(image["originalName"], str) or not image["originalName"]:
                raise ValueError()
            for key in ("byteLength", "widthPx", "heightPx"):
                if type(image[key]) is not int or image[key] <= 0:
                    raise ValueError()
            if image["byteLength"] != len(data) or image["sha256"] != hashlib.sha256(data).hexdigest():
                raise ValueError()
            # Browsers report EXIF-orientation-adjusted JPEG dimensions. Validate
            # the source header, but do not equate its raw axes with UI metadata.
            width, height = image_dimensions(data, media_type)
            if width <= 0 or height <= 0:
                raise ValueError()
            image_ids.add(image["id"])
        image_by_id = {image["id"]: image for image in image_assets}
        for page in pages:
            for owner in [page, *page.get("panels", [])]:
                for collection in ("images", "background_images"):
                    placed = owner.get(collection, [])
                    if not isinstance(placed, list):
                        raise ValueError()
                    placement_ids = set()
                    for image in placed:
                        if not isinstance(image["id"], str) or not image["id"] or image["id"] in placement_ids or image["assetId"] not in image_ids:
                            raise ValueError()
                        placement_ids.add(image["id"])
                        validate_paint(image, image_by_id, stage_ids)
            for owner in [*page.get("panels", []), page.get("page_overlay") or {}]:
                for figure in owner.get("figures", []):
                    if "artwork" in figure:
                        validate_paint(figure["artwork"], image_by_id, stage_ids)
                for bubble in owner.get("bubbles", []):
                    if "paint_overlay" in bubble:
                        validate_paint(bubble["paint_overlay"], image_by_id, stage_ids)
            for owner in [*page.get("panels", []), page.get("page_overlay") or {}]:
                for collection, key in (("figures", "analogImport"), ("bubbles", "analogTextImport")):
                    for item in owner.get(collection, []):
                        if item.get(key) and (item[key]["assetId"] not in by_id or by_id[item[key]["assetId"]][0] not in IMAGE_MEDIA_TYPES):
                            raise ValueError()
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise ValueError("作品データまたは参照画像・3D舞台が不完全です。保存前の作品は変更していません") from error
    return value


def encoded_snapshot(value: dict) -> bytes:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(raw) > MAX_PROJECT_BYTES:
        raise ValueError("画像・3D舞台を含む作品データが保存上限の96MiBを超えています")
    return raw


@contextmanager
def project_directory(directory: Path, create: bool):
    root = os.open(directory, DIRECTORY_FLAGS)
    folder = None
    lock = None
    try:
        if create:
            try:
                os.mkdir(".nyamuru", mode=0o700, dir_fd=root)
            except FileExistsError:
                pass
        folder = os.open(".nyamuru", DIRECTORY_FLAGS, dir_fd=root)
        if create:
            lock = os.open(".save.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            if not stat.S_ISREG(os.fstat(lock).st_mode):
                raise ValueError("保存先のロックファイルが通常のファイルではありません")
            fcntl.flock(lock, fcntl.LOCK_EX)
        yield folder
    finally:
        if lock is not None:
            os.close(lock)
        if folder is not None:
            os.close(folder)
        os.close(root)


def read_regular_file(folder: int, name: str, limit: int) -> bytes:
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError("作品ファイルの形式またはサイズを確認してください")
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("作品ファイルが大きすぎます")
    return raw


def read_asset(folder: int, entry: dict) -> bytes:
    digest = entry["sha256"]
    size = entry["byteLength"]
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("原画像・3D舞台の識別情報が壊れています")
    if entry["path"] != f"{ASSET_DIRECTORY}/{digest}" or type(size) is not int or not 0 < size <= MAX_PROJECT_BYTES:
        raise ValueError("原画像・3D舞台の保存場所またはサイズが壊れています")
    raw = read_regular_file(folder, digest, size)
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("原画像・3D舞台のサイズまたはハッシュが一致しません")
    return raw


def manifest_to_snapshot(folder: int, manifest: object) -> dict:
    if not isinstance(manifest, dict) or manifest.get("version") != 2:
        return validate_snapshot(manifest)
    try:
        entries = manifest["assets"]
        if not isinstance(entries, list):
            raise ValueError()
        # Bound reconstruction before reading binary files, including repeated refs.
        encoded_size = 0
        for entry in entries:
            size = entry["byteLength"]
            if type(size) is not int or not 0 < size <= MAX_PROJECT_BYTES:
                raise ValueError()
            encoded_size += 4 * ((size + 2) // 3)
            if encoded_size > MAX_PROJECT_BYTES:
                raise ValueError("画像・3D舞台を含む作品データが保存上限の96MiBを超えています")
        assets = []
        if entries:
            asset_folder = os.open(ASSET_DIRECTORY, DIRECTORY_FLAGS, dir_fd=folder)
            try:
                for entry in entries:
                    raw = read_asset(asset_folder, entry)
                    assets.append({"id": entry["id"], "type": entry["type"], "data": base64.b64encode(raw).decode("ascii")})
            finally:
                os.close(asset_folder)
        snapshot = {**manifest, "version": 1, "assets": assets}
        encoded_snapshot(snapshot)
        return validate_snapshot(snapshot)
    except (AttributeError, KeyError, TypeError, ValueError, OSError) as error:
        raise ValueError("保存した作品の原画像・3D舞台が不足または破損しています。保存先は変更していません") from error


def read_project(folder: int) -> tuple[dict, str] | None:
    try:
        raw = read_regular_file(folder, PROJECT_FILE, MAX_PROJECT_BYTES)
    except FileNotFoundError:
        return None
    return manifest_to_snapshot(folder, json.loads(raw)), hashlib.sha256(raw).hexdigest()


def load_project(directory: Path) -> dict:
    try:
        with project_directory(directory, create=False) as folder:
            result = read_project(folder)
    except FileNotFoundError:
        result = None
    if result is None:
        raise ValueError("このフォルダには保存した作品がありません。新規作成で指定したエピソードのフォルダを選んでください")
    snapshot, revision = result
    return {"ok": True, "snapshot": snapshot, "revision": revision}


def write_original(folder: int, data: bytes, digest: str) -> None:
    entry = {"path": f"{ASSET_DIRECTORY}/{digest}", "sha256": digest, "byteLength": len(data)}
    try:
        read_asset(folder, entry)
        return
    except FileNotFoundError:
        pass
    name = f".original-{secrets.token_hex(12)}.tmp"
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            # A pre-existing original is never replaced, even in a publication race.
            os.link(name, digest, src_dir_fd=folder, dst_dir_fd=folder, follow_symlinks=False)
        except FileExistsError:
            read_asset(folder, entry)
    finally:
        try:
            os.unlink(name, dir_fd=folder)
        except FileNotFoundError:
            pass


def snapshot_to_manifest(folder: int, value: dict) -> dict:
    entries = []
    if value["assets"]:
        try:
            os.mkdir(ASSET_DIRECTORY, mode=0o700, dir_fd=folder)
        except FileExistsError:
            pass
        asset_folder = os.open(ASSET_DIRECTORY, DIRECTORY_FLAGS, dir_fd=folder)
        try:
            for asset in value["assets"]:
                data = base64.b64decode(asset["data"], validate=True)
                digest = hashlib.sha256(data).hexdigest()
                write_original(asset_folder, data, digest)
                entries.append({"id": asset["id"], "type": asset["type"], "path": f"{ASSET_DIRECTORY}/{digest}", "sha256": digest, "byteLength": len(data)})
            os.fsync(asset_folder)
        finally:
            os.close(asset_folder)
    return {**value, "version": 2, "assets": entries}


def save_project(directory: Path, snapshot: object, expected_revision: object) -> dict:
    value = validate_snapshot(snapshot)
    encoded_snapshot(value)  # The version-1 wire-size limit also applies on disk.
    with project_directory(directory, create=True) as folder:
        previous = read_project(folder)
        if previous:
            if previous[0]["document"]["manga"]["meta"]["episode_id"] != value["document"]["manga"]["meta"]["episode_id"]:
                raise ValueError("このフォルダには別の作品が保存されています。別の保存先を選んでください")
            if expected_revision != previous[1]:
                raise ValueError("保存先の作品が更新されています。「開く」から作品フォルダを開き直してください。現在の編集内容は画面に残しています")
        elif expected_revision is not None:
            raise ValueError("保存済みの作品ファイルが見つかりません。保存先を確認してください")
        raw = encoded_snapshot(snapshot_to_manifest(folder, value))
        name = f".project-{secrets.token_hex(12)}.tmp"
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, PROJECT_FILE, src_dir_fd=folder, dst_dir_fd=folder)
        finally:
            try:
                os.unlink(name, dir_fd=folder)
            except FileNotFoundError:
                pass
    return {"ok": True, "revision": hashlib.sha256(raw).hexdigest()}
