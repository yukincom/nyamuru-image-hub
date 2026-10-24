"""Synthetic model and paint snapshots exercise the actual atomic project store."""
import base64
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("background_project_store", Path(__file__).resolve().parents[1] / "scripts/nyamuru_project_store.py")
store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(store)

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGioAAAAASUVORK5CYII=")


def glb():
    # One triangle, with embedded positions, exercises both JSON and BIN chunks.
    binary = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    header = {"asset": {"version": "2.0", "generator": "synthetic bridge test"}, "scenes": [{"nodes": [0]}], "scene": 0,
              "nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
              "buffers": [{"byteLength": len(binary)}], "bufferViews": [{"buffer": 0, "byteLength": len(binary)}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 0]}]}
    data = json.dumps(header, separators=(",", ":")).encode()
    data += b" " * (-len(data) % 4)
    return struct.pack("<4sIIII", b"glTF", 2, 28 + len(data) + len(binary), len(data), 0x4e4f534a) + data + struct.pack("<II", len(binary), 0x004e4942) + binary


def ascii_fbx():
    return b"; FBX 7.4.0 project file\nFBXHeaderExtension: {\n    FBXHeaderVersion: 1003\n    FBXVersion: 7400\n}\nObjects: {\n}\n"


def binary_fbx(version=7400):
    # Empty synthetic binary scene: complete magic/version and null root record.
    return b"Kaydara FBX Binary  \x00\x1a\x00" + struct.pack("<I", version) + bytes(25 if version >= 7500 else 13)


def capture(source="builtin:cube"):
    return {"version": 1, "sourceId": source, "camera": {"position": [4, 3, 5], "target": [0, 0, 0], "fov": 40},
            "light": {"azimuth": 45, "elevation": 50}, "outlineWidth": 4, "detailWidth": 2, "creaseAngle": 35,
            "detail": 1, "lineGap": .2, "blackAmount": 15, "toneEnabled": True, "toneDensity": 20, "toneLpi": 60,
            "frame": {"x": 0, "y": 0, "w": 1, "h": 1}, "layerIds": ["line-layer"]}


def stroke(**changes):
    return {"tool": "pen", "color": "#000000", "size": 1, "points": [{"x": 0, "y": 0, "pressure": .5, "time": 0}], **changes}


def layer():
    style = {"stroke": "#000000", "fill": None, "width": 2, "cap": "round", "join": "miter", "miterLimit": 10,
             "dash": [], "dashOffset": 0, "alignment": "center", "arrowStart": "none", "arrowEnd": "none", "profile": "uniform"}
    return {"id": "line-layer", "name": "3D 線画", "visible": True, "locked": False, "opacity": 1, "blend": "normal", "kind": "vector", "strokes": [],
            "paths": [{"id": "path-one", "closed": False, "nodes": [{"x": 0, "y": 0}, {"x": 1, "y": 1}], "style": style}]}


def snapshot(model=None, model_format="glb"):
    image = {"id": "flat-preview", "storageId": "image-original", "sha256": hashlib.sha256(PNG).hexdigest(), "byteLength": len(PNG),
             "originalName": "synthetic.png", "mediaType": "image/png", "widthPx": 1, "heightPx": 1}
    paint = {"version": 1, "width": 1, "height": 1, "dpi": 600, "layers": [layer()], "background3d": capture()}
    placement = {"id": "placement", "assetId": image["id"], "crop": {"x": 0, "y": 0, "w": 1, "h": 1},
                 "bbox": {"x": 0, "y": 0, "w": 20, "h": 20}, "opacity": 1, "hidden": False, "locked": False, "paint": paint}
    value = {"version": 1, "document": {"manga": {"meta": {"episode_id": "background-test"}, "image_assets": [image],
             "pages": [{"panels": [{"background_images": [placement], "figures": [], "bubbles": []}]}]}},
             "assets": [{"id": image["storageId"], "type": "image/png", "data": base64.b64encode(PNG).decode()}]}
    if model is not None:
        digest = hashlib.sha256(model).hexdigest()
        stage = {"id": f"stage-{digest}", "storageId": "stage-original", "name": f"synthetic.{model_format}", "sha256": digest,
                 "byteLength": len(model), "format": model_format}
        value["document"]["manga"]["background_stages"] = [stage]
        value["assets"].append({"id": stage["storageId"], "type": store.MODEL_MEDIA_TYPES[model_format], "data": base64.b64encode(model).decode()})
        paint["background3d"]["sourceId"] = stage["id"]
    return value


def paint_of(value):
    return value["document"]["manga"]["pages"][0]["panels"][0]["background_images"][0]["paint"]


def replace_model(value, data):
    """Keep hashes/metadata correct when testing only a malformed container header."""
    stage = value["document"]["manga"]["background_stages"][0]
    digest = hashlib.sha256(data).hexdigest()
    stage.update(id=f"stage-{digest}", sha256=digest, byteLength=len(data))
    value["assets"][1]["data"] = base64.b64encode(data).decode()
    paint_of(value)["background3d"]["sourceId"] = stage["id"]


class BackgroundProjectStoreTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_glb_shared_by_two_captures_roundtrips_with_one_immutable_binary(self):
        value = snapshot(glb())
        panels = value["document"]["manga"]["pages"][0]["panels"]
        panels.append(deepcopy(panels[0]))
        panels[1]["background_images"][0]["paint"]["background3d"]["camera"]["position"] = [7, 2, 4]
        paint_of(value)["background3d"]["cutaway"] = {"enabled": True, "depth": .25}
        paint_of(value)["background3d"]["objectVisibility"] = [{"mesh": 0, "mode": "show"}, {"mesh": 1, "mode": "hide"}]
        paint_of(value)["background3d"]["focusMesh"] = 0
        paint_of(value)["background3d"]["focusPoint"] = [0.1, 0.2, 0.3]
        paint_of(value)["background3d"]["camera"]["shift"] = [0.13, -0.08]
        paint_of(value)["background3d"]["light"].update(preset="evening", intensity=.7, bounce=1.3, windowMesh=0, ceiling=False)
        paint_of(value)["background3d"]["toneThreshold"] = 62
        panels[1]["background_images"][0]["paint"]["background3d"]["cutaway"] = {"enabled": False, "depth": .4}
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root), {"ok": True, "snapshot": value, "revision": saved["revision"]})
        folder = self.root / ".nyamuru"
        manifest = json.loads((folder / "project.json").read_text())
        self.assertEqual(manifest["version"], 2)
        self.assertEqual(len(manifest["assets"]), 2)
        self.assertEqual(len(list((folder / "assets").iterdir())), 2)
        model_entry = next(entry for entry in manifest["assets"] if entry["type"] == "model/gltf-binary")
        original = folder / model_entry["path"]
        self.assertEqual(original.read_bytes(), glb())
        self.assertEqual(original.name, hashlib.sha256(glb()).hexdigest())
        before = original.stat()
        paint_of(value)["background3d"]["light"]["azimuth"] = -80
        store.save_project(self.root, value, saved["revision"])
        self.assertEqual((original.stat().st_ino, original.stat().st_mtime_ns), (before.st_ino, before.st_mtime_ns))
        self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_ascii_and_binary_fbx_original_bytes_roundtrip(self):
        for label, model in (("ascii", ascii_fbx()), ("binary7400", binary_fbx()), ("binary7500", binary_fbx(7500))):
            with self.subTest(label=label):
                destination = self.root / label
                destination.mkdir()
                value = snapshot(model, "fbx")
                store.save_project(destination, value, None)
                self.assertEqual(store.load_project(destination)["snapshot"], value)
                self.assertEqual((destination / ".nyamuru" / "assets" / hashlib.sha256(model).hexdigest()).read_bytes(), model)

    def test_builtin_cube_requires_no_model_asset(self):
        value = snapshot()
        store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        self.assertEqual(len(list((self.root / ".nyamuru" / "assets").iterdir())), 1)

    def test_bad_model_metadata_hash_mime_or_missing_source_never_publish(self):
        original = snapshot(glb())
        saved = store.save_project(self.root, original, None)
        before = (self.root / ".nyamuru" / "project.json").read_bytes()
        mutations = [
            ("id", "stage-" + "0" * 64), ("sha256", "0" * 64), ("sha256", "A" * 64),
            ("byteLength", len(glb()) + 1), ("byteLength", True), ("name", ""), ("storageId", "missing"), ("format", "obj"),
        ]
        for field, invalid in mutations:
            with self.subTest(field=field, invalid=invalid):
                value = deepcopy(original)
                value["document"]["manga"]["background_stages"][0][field] = invalid
                with self.assertRaises(ValueError):
                    store.save_project(self.root, value, saved["revision"])
        for mutation in ("wrong-mime", "wrong-hash", "missing-asset", "unknown-source", "missing-metadata", "duplicate-stage"):
            with self.subTest(mutation=mutation):
                value = deepcopy(original)
                if mutation == "wrong-mime":
                    value["assets"][1]["type"] = "application/vnd.autodesk.fbx"
                elif mutation == "wrong-hash":
                    value["assets"][1]["data"] = base64.b64encode(glb().replace(b"synthetic", b"Synthetic")).decode()
                elif mutation == "missing-asset":
                    value["assets"].pop()
                elif mutation == "unknown-source":
                    paint_of(value)["background3d"]["sourceId"] = "stage-" + "0" * 64
                elif mutation == "missing-metadata":
                    del value["document"]["manga"]["background_stages"]
                else:
                    value["document"]["manga"]["background_stages"] *= 2
                with self.assertRaises(ValueError):
                    store.save_project(self.root, value, saved["revision"])
        self.assertEqual((self.root / ".nyamuru" / "project.json").read_bytes(), before)
        self.assertEqual(store.load_project(self.root)["snapshot"], original)

    def test_glb_header_length_chunks_and_json_are_checked_independently_of_hash(self):
        raw = glb()
        malformed = [b"bad!" + raw[4:], raw[:4] + struct.pack("<I", 1) + raw[8:], raw[:-1], raw + b"trailing",
                     raw[:12] + struct.pack("<I", len(raw)) + raw[16:], raw[:16] + b"BIN\0" + raw[20:],
                     raw[:20] + b"!" + raw[21:], raw.replace(b'"2.0"', b'"1.0"')]
        for data in malformed:
            with self.subTest(data=data[:20]):
                value = snapshot(raw)
                replace_model(value, data)
                with self.assertRaises(ValueError):
                    store.validate_snapshot(value)

    def test_fbx_header_version_and_record_bounds_are_checked_independently_of_hash(self):
        binary = binary_fbx()
        malformed = [binary[:26], b"bad" + binary[3:], binary[:23] + struct.pack("<I", 6200) + binary[27:],
                     binary[:27] + struct.pack("<IIIB", 10000, 0, 0, 0),
                     ascii_fbx().replace(b"7400", b"6100"), b"unrelated text\nFBXVersion: 7400\n"]
        for data in malformed:
            with self.subTest(data=data[:27]):
                value = snapshot(binary, "fbx")
                replace_model(value, data)
                with self.assertRaises(ValueError):
                    store.validate_snapshot(value)

    def test_changed_or_missing_model_file_fails_load_and_preserves_manifest(self):
        original = snapshot(glb())
        saved = store.save_project(self.root, original, None)
        folder = self.root / ".nyamuru"
        manifest = (folder / "project.json").read_bytes()
        model = folder / "assets" / hashlib.sha256(glb()).hexdigest()
        corrupt = glb().replace(b"synthetic", b"Synthetic")
        model.write_bytes(corrupt)
        with self.assertRaises(ValueError):
            store.load_project(self.root)
        with self.assertRaises(ValueError):
            store.save_project(self.root, original, saved["revision"])
        self.assertEqual(model.read_bytes(), corrupt)
        self.assertEqual((folder / "project.json").read_bytes(), manifest)
        model.unlink()
        with self.assertRaises(ValueError):
            store.load_project(self.root)

    def test_capture_ranges_and_finite_camera_frame_values_are_enforced(self):
        changes = [("version", True), ("sourceId", "builtin:unknown"), ("camera.position", [0, 0, 0]), ("camera.position", [1, 2]),
                   ("camera.position", [float("nan"), 2, 3]), ("camera.target", [1e13, 0, 0]), ("camera.fov", 151),
                   ("camera.shift", None), ("camera.shift", []), ("camera.shift", [1]), ("camera.shift", [1, 2, 3]), ("camera.shift", [True, 0]), ("camera.shift", [float("nan"), 0]), ("camera.shift", [0, float("inf")]),
                   ("light.azimuth", 361), ("light.elevation", -91), ("light.preset", "night"), ("light.intensity", 0), ("light.intensity", True), ("light.bounce", 2.1), ("light.windowMesh", -1), ("light.windowMesh", True), ("light.windowMesh", .5), ("light.ceiling", 1), ("toneThreshold", -1), ("toneThreshold", 101), ("toneThreshold", True), ("outlineWidth", 0), ("detailWidth", 1001),
                   ("creaseAngle", -1), ("detail", 1.1), ("lineGap", 1), ("blackAmount", 101), ("toneEnabled", 1),
                   ("toneDensity", -1), ("toneLpi", 0), ("frame.x", float("inf")), ("frame.w", 0),
                   ("layerIds", [""]), ("layerIds", ["x"] * 65), ("cutaway", None), ("cutaway", []),
                   ("cutaway", {"enabled": 1, "depth": .25}), ("cutaway", {"enabled": True, "depth": float("nan")}),
                   ("cutaway", {"enabled": True, "depth": .46}), ("cutaway", {"enabled": True, "depth": .04}),
                   ("objectVisibility", None), ("objectVisibility", {}), ("objectVisibility", [None]),
                   ("objectVisibility", [{"mesh": -1, "mode": "show"}]), ("objectVisibility", [{"mesh": True, "mode": "hide"}]),
                   ("objectVisibility", [{"mesh": 0, "mode": "auto"}]), ("objectVisibility", [{"mesh": 0, "mode": "show"}, {"mesh": 0, "mode": "hide"}]),
                   ("focusPoint", None), ("focusPoint", [1, 2]), ("focusPoint", [1, 2, True]), ("focusPoint", [1, 2, float("nan")]), ("focusPoint", [1, 2, 3]), ("focusMesh", None), ("focusMesh", -1), ("focusMesh", 0.5), ("focusMesh", True), ("focusMesh", "0"), ("focusMesh", 9007199254740992)]
        for field, invalid in changes:
            with self.subTest(field=field):
                value = snapshot()
                target = paint_of(value)["background3d"]
                parts = field.split(".")
                for key in parts[:-1]:
                    target = target[key]
                target[parts[-1]] = invalid
                with self.assertRaises(ValueError):
                    store.validate_snapshot(value)

    def test_source_checks_cover_page_panel_figure_bubble_and_overlay_artwork(self):
        for location in ("page", "panel", "background", "figure", "bubble", "overlay-figure", "overlay-bubble"):
            with self.subTest(location=location):
                value = snapshot()
                page = value["document"]["manga"]["pages"][0]
                panel = page["panels"][0]
                image = panel.pop("background_images")[0]
                image["paint"]["background3d"]["sourceId"] = "missing"
                if location in ("page", "panel", "background"):
                    (page if location == "page" else panel)["background_images" if location == "background" else "images"] = [image]
                else:
                    owner = page.setdefault("page_overlay", {}) if location.startswith("overlay") else panel
                    is_bubble = location.endswith("bubble")
                    owner["bubbles" if is_bubble else "figures"] = [{"paint_overlay" if is_bubble else "artwork": image}]
                with self.assertRaises(ValueError):
                    store.validate_snapshot(value)

    def test_six_vector_colors_fill_mask_and_tone_roundtrip_without_changing_case(self):
        value = snapshot()
        paint_layer = paint_of(value)["layers"][0]
        template = paint_layer["paths"][0]
        paint_layer["paths"] = []
        for index, color in enumerate(store.PAINT_INKS):
            path = deepcopy(template)
            path["id"] = f"path-{index}"
            path["style"].update(stroke=color.upper(), fill=color)
            paint_layer["paths"].append(path)
        paint_layer["strokes"] = [stroke(tool="rectangle", fill="#00FF00"), stroke(color="#12ab34")]
        paint_layer["mask"] = {"enabled": True, "reveal": False, "strokes": [stroke(fill="#FFFF00")]}
        paint_layer["tone"] = {"enabled": True, "lpi": 60, "mode": "fixed", "density": 35, "origin": {"x": -2.5, "y": 4}}
        store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_invalid_vector_palette_stroke_fill_mask_and_tone_are_rejected(self):
        mutations = [
            ("paths.0.style.stroke", "#ff00ff"), ("paths.0.style.fill", "#123456"), ("strokes.0.fill", "#ff00ff"),
            ("mask.enabled", 1), ("mask.reveal", None), ("mask.strokes", {}), ("mask.strokes.0.points.0.pressure", 2),
            ("mask.strokes.0.size", 0), ("mask.strokes.0.fill", "#123456"), ("tone.enabled", 1), ("tone.lpi", 0),
            ("tone.lpi", 1001), ("tone.mode", "bad"), ("tone.density", 101), ("tone.origin.x", float("nan")),
        ]
        for field, invalid in mutations:
            with self.subTest(field=field):
                value = snapshot()
                target = paint_of(value)["layers"][0]
                target.update(strokes=[stroke()], mask={"enabled": True, "reveal": True, "strokes": [stroke()]},
                              tone={"enabled": True, "lpi": 60, "mode": "image", "density": 20, "origin": {"x": 0, "y": 0}})
                parts = field.split(".")
                for part in parts[:-1]:
                    target = target[int(part)] if isinstance(target, list) else target[part]
                target[parts[-1]] = invalid
                with self.assertRaises(ValueError):
                    store.validate_snapshot(value)

    def test_model_binary_cannot_replace_an_analog_image_reference(self):
        value = snapshot(glb())
        value["document"]["manga"]["pages"][0]["panels"][0]["figures"] = [{"analogImport": {"assetId": "stage-original"}}]
        with self.assertRaises(ValueError):
            store.validate_snapshot(value)


if __name__ == "__main__":
    unittest.main()
