import base64
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import io
import hashlib
import json
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("project_store", Path(__file__).resolve().parents[1] / "scripts/nyamuru_project_store.py")
store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(store)

BRIDGE_SPEC = importlib.util.spec_from_file_location("project_test_bridge", Path(__file__).resolve().parents[1] / "scripts/nyamuru_local_bridge.py")
bridge = importlib.util.module_from_spec(BRIDGE_SPEC)
sys.modules[BRIDGE_SPEC.name] = bridge
BRIDGE_SPEC.loader.exec_module(bridge)


def snapshot():
    return {"version": 1, "document": {"manga": {
        "meta": {"episode_id": "episode-one", "title": "保存テスト", "style_notes": {"line": "鉛筆"}},
        "layout_spec": {"paper": "B5"},
        "pages": [{"panels": [{"figures": [{"analogImport": {"assetId": "image-one"}}]}]}],
    }}, "assets": [{"id": "image-one", "type": "image/png", "data": base64.b64encode(b"test-image").decode()}]}


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGioAAAAASUVORK5CYII=")


def placed_snapshot():
    value = snapshot()
    value["assets"].append({"id": "original-one", "type": "image/png", "data": base64.b64encode(PNG).decode()})
    value["document"]["manga"]["image_assets"] = [{
        "id": "asset-one", "storageId": "original-one", "sha256": hashlib.sha256(PNG).hexdigest(),
        "mediaType": "image/png", "originalName": "こゆき.png", "widthPx": 1, "heightPx": 1, "byteLength": len(PNG),
    }]
    value["document"]["manga"]["pages"][0]["images"] = [{
        "id": "placement-one", "assetId": "asset-one", "bbox": {"x": 10, "y": 20, "w": 30, "h": 40},
        "crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "opacity": 1, "hidden": False, "locked": False,
    }]
    return value


class ProjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_full_roundtrip_and_hidden_location(self):
        doc = snapshot()
        result = store.save_project(self.root, doc, None)
        self.assertEqual(set(p.name for p in self.root.iterdir()), {".nyamuru"})
        loaded = store.load_project(self.root)
        self.assertEqual(loaded["snapshot"], doc)
        self.assertEqual(loaded["revision"], result["revision"])
        doc["document"]["manga"]["meta"]["title"] = "編集後"
        newer = store.save_project(self.root, doc, result["revision"])
        self.assertNotEqual(newer["revision"], result["revision"])
        self.assertEqual(store.load_project(self.root)["snapshot"], doc)

    def test_different_episode_and_stale_revision_do_not_overwrite(self):
        original = snapshot()
        saved = store.save_project(self.root, original, None)
        other = deepcopy(original)
        other["document"]["manga"]["meta"]["episode_id"] = "other"
        with self.assertRaisesRegex(ValueError, "別の作品"):
            store.save_project(self.root, other, saved["revision"])
        for revision in (None, "stale"):
            with self.assertRaisesRegex(ValueError, "更新されています"):
                store.save_project(self.root, original, revision)
        self.assertEqual(store.load_project(self.root)["snapshot"], original)

    def test_missing_image_and_invalid_base64_leave_previous_file(self):
        original = snapshot()
        saved = store.save_project(self.root, original, None)
        for broken in ([], [{"id": "image-one", "type": "image/png", "data": "!invalid"}]):
            value = deepcopy(original)
            value["assets"] = broken
            with self.assertRaises(ValueError):
                store.save_project(self.root, value, saved["revision"])
        self.assertEqual(store.load_project(self.root)["snapshot"], original)

    def test_failed_atomic_publish_preserves_previous_and_cleans_owned_temp(self):
        original = snapshot()
        saved = store.save_project(self.root, original, None)
        edited = deepcopy(original)
        edited["document"]["manga"]["meta"]["title"] = "never published"
        with patch.object(store.os, "replace", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                store.save_project(self.root, edited, saved["revision"])
        self.assertEqual(store.load_project(self.root)["snapshot"], original)
        self.assertEqual(set(p.name for p in (self.root / ".nyamuru").iterdir()), {"project.json", ".save.lock", "assets"})
        self.assertFalse(any(p.name.endswith(".tmp") for p in (self.root / ".nyamuru" / "assets").iterdir()))

    def test_binary_originals_deduplicate_and_roundtrip_without_rewriting(self):
        value = placed_snapshot()
        value["assets"].append({**value["assets"][1], "id": "original-copy"})
        saved = store.save_project(self.root, value, None)
        folder = self.root / ".nyamuru"
        manifest = json.loads((folder / "project.json").read_text())
        self.assertEqual(manifest["version"], 2)
        self.assertTrue(all("data" not in entry for entry in manifest["assets"]))
        self.assertEqual(manifest["assets"][1]["path"], manifest["assets"][2]["path"])
        self.assertEqual(len(list((folder / "assets").iterdir())), 2)
        original = folder / manifest["assets"][1]["path"]
        self.assertEqual(original.read_bytes(), PNG)
        original_stat = original.stat()
        value["document"]["manga"]["meta"]["title"] = "配置後"
        saved = store.save_project(self.root, value, saved["revision"])
        self.assertEqual(original.stat().st_ino, original_stat.st_ino)
        self.assertEqual(original.stat().st_mtime_ns, original_stat.st_mtime_ns)
        self.assertEqual(store.load_project(self.root), {"ok": True, "snapshot": value, "revision": saved["revision"]})

    def test_nested_image_owners_roundtrip_and_missing_original_keeps_prior_manifest(self):
        value = placed_snapshot()
        page = value["document"]["manga"]["pages"][0]
        image = page.pop("images")[0]
        page["panels"][0]["images"] = [image]
        page["panels"][0]["background_images"] = [deepcopy(image)]
        content = {key: entry for key, entry in image.items() if key not in ("id", "bbox")}
        page["panels"][0]["figures"][0].update(artwork=deepcopy(content), bbox=deepcopy(image["bbox"]))
        page["page_overlay"] = {"figures": [{"artwork": deepcopy(content), "bbox": deepcopy(image["bbox"])}]}
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        for target in ("panel", "background", "figure", "overlay"):
            with self.subTest(target=target):
                broken = deepcopy(value)
                bad_page = broken["document"]["manga"]["pages"][0]
                owner = bad_page["panels"][0]
                item = (owner["background_images"][0] if target == "background" else owner["images"][0] if target == "panel" else owner["figures"][0]["artwork"]
                        if target == "figure" else bad_page["page_overlay"]["figures"][0]["artwork"])
                item["assetId"] = "missing"
                with self.assertRaises(ValueError):
                    store.save_project(self.root, broken, saved["revision"])
                self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_paint_layers_and_source_metadata_roundtrip_and_bad_reference_is_atomic(self):
        value = placed_snapshot()
        page = value["document"]["manga"]["pages"][0]
        image = page["images"][0]
        image["paint"] = {"version": 1, "width": 1, "height": 1, "dpi": 350, "referenceFrame": {"x": 0.1, "y": 0.2, "w": 0.8, "h": 0.7}, "layers": [{
            "id": "layer", "name": "線画", "visible": True, "locked": False, "opacity": 1, "blend": "normal",
            "image": {"assetId": "asset-one", "crop": deepcopy(image["crop"]), "bbox": deepcopy(image["crop"])},
            "strokes": [{"tool": "pen", "color": "#000000", "size": 1, "points": [{"x": 0, "y": 0, "pressure": .7, "time": 0}]}],
        }]}
        content = {key: entry for key, entry in image.items() if key not in ("id", "bbox")}
        figure = page["panels"][0]["figures"][0]
        figure.update(action="うつむく", refId="character-one", artwork=deepcopy(content), bbox=deepcopy(image["bbox"]))
        page["panels"][0]["bubbles"] = [{"text": "元のセリフ", "paint_overlay": deepcopy(content), "bbox": deepcopy(image["bbox"])}]
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        for invalid in ("reference", "dimensions", "pressure", "bubble", "guide"):
            with self.subTest(invalid=invalid):
                broken = deepcopy(value)
                if invalid == "bubble":
                    broken["document"]["manga"]["pages"][0]["panels"][0]["bubbles"][0]["paint_overlay"]["assetId"] = "missing"
                else:
                    paint = broken["document"]["manga"]["pages"][0]["images"][0]["paint"]
                    if invalid == "reference":
                        paint["layers"][0]["image"]["assetId"] = "missing"
                    elif invalid == "guide":
                        paint["referenceFrame"]["w"] = 0
                    elif invalid == "dimensions":
                        paint["width"] = 2
                    else:
                        paint["layers"][0]["strokes"][0]["points"][0]["pressure"] = 9
                with self.assertRaises(ValueError):
                    store.save_project(self.root, broken, saved["revision"])
                self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_generation_mask_and_materialized_guide_roundtrip(self):
        value = placed_snapshot()
        image = value["document"]["manga"]["pages"][0]["images"][0]
        layer = {"id": "guide", "name": "あたり", "guide": True, "visible": True, "locked": False, "opacity": 1, "blend": "normal", "strokes": [],
                 "generationMask": {"enabled": True, "strokes": [{"tool": "pen", "color": "#ff0000", "size": 1, "points": [{"x": 0, "y": 0, "pressure": .7, "time": 0}]}]}}
        image["paint"] = {"version": 1, "width": 1, "height": 1, "dpi": 350, "guideInitialized": True, "layers": [layer]}
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        for key, invalid in (("guideInitialized", "yes"), ("guide", 1), ("enabled", "yes"), ("color", "red")):
            broken = deepcopy(value)
            paint = broken["document"]["manga"]["pages"][0]["images"][0]["paint"]
            if key == "guideInitialized": paint[key] = invalid
            elif key == "guide": paint["layers"][0][key] = invalid
            elif key == "enabled": paint["layers"][0]["generationMask"][key] = invalid
            else: paint["layers"][0]["generationMask"]["strokes"][0][key] = invalid
            with self.assertRaises(ValueError): store.save_project(self.root, broken, saved["revision"])
            self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_independent_tone_and_coverage_mask_roundtrip(self):
        value = placed_snapshot()
        image = value["document"]["manga"]["pages"][0]["images"][0]
        layer = {"id": "tone", "name": "トーン", "visible": True, "locked": False, "opacity": 1, "blend": "normal", "strokes": [],
                 "tone": {"enabled": True, "lpi": 60, "mode": "fixed", "density": 20, "fill": True, "angle": 45},
                 "mask": {"enabled": True, "reveal": False, "strokes": [{"tool": "pen", "color": "#ffffff", "size": 1, "points": [{"x": 0, "y": 0, "pressure": 1, "time": 0}]}]}}
        image["paint"] = {"version": 1, "width": 1, "height": 1, "dpi": 350, "layers": [layer]}
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        for patch in ({"fill": "yes"}, {"angle": -1}, {"angle": 361}, {"angle": True}, {"mode": "image"}):
            broken = deepcopy(value)
            broken["document"]["manga"]["pages"][0]["images"][0]["paint"]["layers"][0]["tone"].update(patch)
            with self.assertRaises(ValueError): store.save_project(self.root, broken, saved["revision"])
            self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_editable_vector_handles_style_and_antialias_roundtrip(self):
        value = placed_snapshot()
        image = value["document"]["manga"]["pages"][0]["images"][0]
        path = {"id": "curve", "closed": False, "nodes": [{"x": 0, "y": 0, "handleOut": {"x": .2, "y": .3}}, {"x": 1, "y": 1}], "style": {
            "stroke": "#000000", "fill": None, "width": 2, "cap": "round", "join": "miter", "miterLimit": 10,
            "dash": [2, 3], "dashOffset": 0, "alignment": "center", "arrowStart": "none", "arrowEnd": "triangle", "profile": "uniform"}}
        image["paint"] = {"version": 1, "width": 1, "height": 1, "dpi": 350, "layers": [{"id": "vectors", "name": "ベクター", "visible": True, "locked": False, "opacity": 1, "blend": "normal", "strokes": [], "kind": "vector", "antialias": 2, "paths": [path]}]}
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        for key, invalid in (("width", 0), ("dash", [-1]), ("stroke", "#ff00ff"), ("cap", "bad")):
            broken = deepcopy(value)
            broken["document"]["manga"]["pages"][0]["images"][0]["paint"]["layers"][0]["paths"][0]["style"][key] = invalid
            with self.assertRaises(ValueError):
                store.save_project(self.root, broken, saved["revision"])
            self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_selection_masks_and_transparent_vector_strokes_roundtrip(self):
        value = placed_snapshot()
        image = value["document"]["manga"]["pages"][0]["images"][0]
        style = {"stroke": None, "fill": "#000000", "width": 2, "cap": "round", "join": "miter", "miterLimit": 10, "dash": [], "dashOffset": 0, "alignment": "center", "arrowStart": "none", "arrowEnd": "triangle", "profile": "uniform"}
        mask = [{"x": 0, "y": 0, "w": 1, "h": 1}]
        image["paint"] = {"version": 1, "width": 1, "height": 1, "dpi": 350, "layers": [{"id": "layer", "name": "描画", "visible": True, "locked": False, "opacity": 1, "blend": "normal", "kind": "vector", "paths": [{"id": "v", "closed": True, "nodes": [{"x": 0, "y": 0}], "style": style}], "strokes": [{"tool": "fill", "color": "#ffffff", "size": 1, "points": [{"x": 0, "y": 0, "pressure": 1, "time": 0}], "selection": mask}]}]}
        saved = store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)
        for invalid in (None, {}, [{"x": 0, "y": 0, "w": -1, "h": 1}]):
            broken = deepcopy(value)
            broken["document"]["manga"]["pages"][0]["images"][0]["paint"]["layers"][0]["strokes"][0]["selection"] = invalid
            with self.assertRaises(ValueError):
                store.save_project(self.root, broken, saved["revision"])

    def test_reads_legacy_inline_snapshot_and_migrates_only_on_save(self):
        value = snapshot()
        folder = self.root / ".nyamuru"
        folder.mkdir()
        raw = json.dumps(value, ensure_ascii=False).encode()
        (folder / "project.json").write_bytes(raw)
        loaded = store.load_project(self.root)
        self.assertEqual(loaded["snapshot"], value)
        self.assertEqual(loaded["revision"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(set(p.name for p in folder.iterdir()), {"project.json"})
        store.save_project(self.root, value, loaded["revision"])
        self.assertEqual(json.loads((folder / "project.json").read_text())["version"], 2)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_placed_image_reference_and_metadata_are_verified_before_publication(self):
        original = placed_snapshot()
        saved = store.save_project(self.root, original, None)
        manifest_before = (self.root / ".nyamuru" / "project.json").read_bytes()
        for field, bad in (("storageId", "missing"), ("sha256", "0" * 64), ("mediaType", "image/jpeg"),
                           ("widthPx", 2.5), ("heightPx", 0), ("byteLength", len(PNG) + 1), ("originalName", "")):
            with self.subTest(field=field):
                value = deepcopy(original)
                value["document"]["manga"]["image_assets"][0][field] = bad
                with self.assertRaises(ValueError):
                    store.save_project(self.root, value, saved["revision"])
        for mutation in ("missing-reference", "missing-metadata", "duplicate-placement", "wrong-signature"):
            with self.subTest(mutation=mutation):
                value = deepcopy(original)
                manga = value["document"]["manga"]
                if mutation == "missing-reference":
                    manga["pages"][0]["images"][0]["assetId"] = "missing"
                elif mutation == "missing-metadata":
                    del manga["image_assets"]
                elif mutation == "duplicate-placement":
                    manga["pages"][0]["images"] *= 2
                else:
                    value["assets"][1]["type"] = "image/jpeg"
                    manga["image_assets"][0]["mediaType"] = "image/jpeg"
                with self.assertRaises(ValueError):
                    store.save_project(self.root, value, saved["revision"])
        self.assertEqual((self.root / ".nyamuru" / "project.json").read_bytes(), manifest_before)
        self.assertEqual(store.load_project(self.root)["snapshot"], original)

    def test_jpeg_original_and_positive_display_dimensions_roundtrip(self):
        # Complete 1px JPEG. The media header check is independent of positive
        # display dimensions supplied by the importer, which handles EXIF.
        jpeg = base64.b64decode("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==")
        self.assertEqual(store.image_dimensions(jpeg, "image/jpeg"), (1, 1))
        value = placed_snapshot()
        value["assets"][1].update(type="image/jpeg", data=base64.b64encode(jpeg).decode())
        value["document"]["manga"]["image_assets"][0].update(
            mediaType="image/jpeg", originalName="original.jpg", byteLength=len(jpeg),
            sha256=hashlib.sha256(jpeg).hexdigest(), widthPx=12, heightPx=9,
        )
        store.save_project(self.root, value, None)
        self.assertEqual(store.load_project(self.root)["snapshot"], value)

    def test_manifest_traversal_missing_and_changed_originals_are_rejected(self):
        value = placed_snapshot()
        saved = store.save_project(self.root, value, None)
        manifest_file = self.root / ".nyamuru" / "project.json"
        raw = manifest_file.read_bytes()
        manifest = json.loads(raw)
        asset = self.root / ".nyamuru" / manifest["assets"][1]["path"]
        for bad_path in ("../outside", "/tmp/outside", "assets/../project.json", "assets/" + "0" * 64):
            with self.subTest(path=bad_path):
                edited = deepcopy(manifest)
                edited["assets"][1]["path"] = bad_path
                manifest_file.write_text(json.dumps(edited))
                with self.assertRaises(ValueError):
                    store.load_project(self.root)
        manifest_file.write_bytes(raw)
        asset.unlink()
        with self.assertRaisesRegex(ValueError, "原画像"):
            store.load_project(self.root)
        asset.write_bytes(bytes([PNG[0] ^ 1]) + PNG[1:])
        with self.assertRaisesRegex(ValueError, "原画像"):
            store.load_project(self.root)
        before = asset.read_bytes()
        with self.assertRaises(ValueError):
            store.save_project(self.root, value, saved["revision"])
        self.assertEqual(asset.read_bytes(), before)
        self.assertEqual(manifest_file.read_bytes(), raw)

    def test_symlinked_asset_directory_and_original_are_not_followed(self):
        outside = self.root / "outside"
        outside.mkdir()
        folder = self.root / ".nyamuru"
        folder.mkdir()
        (folder / "assets").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            store.save_project(self.root, placed_snapshot(), None)
        self.assertEqual(list(outside.iterdir()), [])
        (folder / "assets").unlink()
        store.save_project(self.root, placed_snapshot(), None)
        manifest = json.loads((folder / "project.json").read_text())
        asset = folder / manifest["assets"][1]["path"]
        target = outside / "untouched.png"
        target.write_bytes(PNG)
        asset.unlink()
        asset.symlink_to(target)
        with self.assertRaises(ValueError):
            store.load_project(self.root)
        self.assertEqual(target.read_bytes(), PNG)

    def test_failed_binary_publication_and_revision_conflict_preserve_previous(self):
        original = snapshot()
        saved = store.save_project(self.root, original, None)
        folder = self.root / ".nyamuru"
        manifest_before = (folder / "project.json").read_bytes()
        originals_before = set((folder / "assets").iterdir())
        with self.assertRaisesRegex(ValueError, "更新されています"):
            store.save_project(self.root, placed_snapshot(), "stale")
        self.assertEqual(set((folder / "assets").iterdir()), originals_before)
        with patch.object(store.os, "link", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                store.save_project(self.root, placed_snapshot(), saved["revision"])
        self.assertEqual(set((folder / "assets").iterdir()), originals_before)
        self.assertEqual((folder / "project.json").read_bytes(), manifest_before)
        self.assertEqual(store.load_project(self.root)["snapshot"], original)

    def test_existing_hash_filename_is_never_overwritten(self):
        original = snapshot()
        saved = store.save_project(self.root, original, None)
        path = self.root / ".nyamuru" / "assets" / hashlib.sha256(PNG).hexdigest()
        path.write_bytes(b"existing corrupt original")
        with self.assertRaises(ValueError):
            store.save_project(self.root, placed_snapshot(), saved["revision"])
        self.assertEqual(path.read_bytes(), b"existing corrupt original")
        self.assertEqual(store.load_project(self.root)["snapshot"], original)

    def test_concurrent_saves_only_one_can_publish_same_revision(self):
        original = snapshot()
        saved = store.save_project(self.root, original, None)
        def update(title):
            edited = deepcopy(original)
            edited["document"]["manga"]["meta"]["title"] = title
            try:
                store.save_project(self.root, edited, saved["revision"])
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=2) as workers:
            self.assertEqual(sorted(workers.map(update, ["one", "two"])), [False, True])

    def test_missing_load_does_not_create_anything(self):
        with self.assertRaisesRegex(ValueError, "保存した作品がありません"):
            store.load_project(self.root)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_hidden_directory_symlink_is_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.root / ".nyamuru").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            store.save_project(self.root, snapshot(), None)
        self.assertEqual(list(outside.iterdir()), [])

    def test_project_symlink_is_not_followed(self):
        directory = self.root / ".nyamuru"
        directory.mkdir()
        target = self.root / "source.json"
        target.write_text(json.dumps(snapshot()))
        (directory / "project.json").symlink_to(target)
        before = target.read_bytes()
        with self.assertRaises(OSError):
            store.save_project(self.root, snapshot(), None)
        self.assertEqual(target.read_bytes(), before)

    def test_size_limit_and_corrupt_file(self):
        with patch.object(store, "MAX_PROJECT_BYTES", 10):
            with self.assertRaisesRegex(ValueError, "保存上限"):
                store.save_project(self.root, snapshot(), None)
        self.assertEqual(list(self.root.iterdir()), [])
        folder = self.root / ".nyamuru"
        folder.mkdir()
        (folder / "project.json").write_text("broken")
        with self.assertRaises(ValueError):
            store.load_project(self.root)

    def test_real_http_dispatch_uses_selected_token_and_returns_protocol_identity(self):
        workspaces = bridge.EpisodeWorkspaceManager(self.root / "registry.json")
        token = "test-project-selected-token"
        workspaces.directories[token] = self.root
        def post(path, body, origin="http://127.0.0.1:4321"):
            handler = object.__new__(bridge.BridgeHandler)
            raw = json.dumps(body).encode()
            handler.headers = {"Content-Length": str(len(raw)), "Content-Type": "application/json", "Origin": origin}
            handler.rfile = io.BytesIO(raw)
            handler.wfile = io.BytesIO()
            handler.path = path
            handler.server = SimpleNamespace(state=SimpleNamespace(episode_workspaces=workspaces))
            statuses = []
            handler.send_response = statuses.append
            handler.send_header = lambda *args: None
            handler.end_headers = lambda: None
            handler.do_POST()
            return statuses[0], json.loads(handler.wfile.getvalue())
        status, saved = post("/api/episode-workspace/project/save", {"workspace_token": token, "snapshot": snapshot(), "expected_revision": None})
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["service"], bridge.BRIDGE_SERVICE_NAME)
        status, loaded = post("/api/episode-workspace/project/load", {"workspace_token": token})
        self.assertEqual(status, 200)
        self.assertEqual(loaded["snapshot"], snapshot())
        self.assertEqual(loaded["revision"], saved["revision"])
        status, _ = post("/api/episode-workspace/project/save", {"workspace_token": "not-selected", "snapshot": snapshot()})
        self.assertEqual(status, 400)
        status, _ = post("/api/episode-workspace/project/load", {"workspace_token": token}, "https://example.com")
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
