"""Series model originals use synthetic files and temporary stores only."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SPEC = importlib.util.spec_from_file_location("series_background_test_bridge", SCRIPTS / "nyamuru_local_bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)
import nyamuru_bridge_http as bridge_http
import nyamuru_series_background_store as store


def glb():
    positions = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    header = {"asset": {"version": "2.0", "generator": "synthetic"}, "scene": 0, "scenes": [{"nodes": [0]}],
              "nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
              "buffers": [{"byteLength": len(positions)}], "bufferViews": [{"buffer": 0, "byteLength": len(positions)}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}]}
    data = json.dumps(header, separators=(",", ":")).encode()
    data += b" " * (-len(data) % 4)
    return (struct.pack("<4sIIII", b"glTF", 2, 28 + len(data) + len(positions), len(data), 0x4e4f534a)
            + data + struct.pack("<II", len(positions), 0x004e4942) + positions)


def fbx(version=None):
    if version is None:
        return b"; FBX 7.4.0 project file\nFBXHeaderExtension: {\n FBXHeaderVersion: 1003\n FBXVersion: 7400\n}\nObjects: {}\n"
    return b"Kaydara FBX Binary  \x00\x1a\x00" + struct.pack("<I", version) + bytes(25 if version >= 7500 else 13)


def request(data=None, model_format="glb", series_id="series-one"):
    data = glb() if data is None else data
    digest = hashlib.sha256(data).hexdigest()
    return {"series_id": series_id,
            "stage": {"id": f"stage-{digest}", "storageId": "stage-browser-cache", "name": f"背景.{model_format}",
                      "sha256": digest, "byteLength": len(data), "format": model_format},
            "model_data": base64.b64encode(data).decode("ascii")}


class SeriesBackgroundStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "series-common"
        self.store = store.SeriesBackgroundStore(self.root)

    def save(self, payload=None, target=None):
        payload = request() if payload is None else payload
        return (target or self.store).save(payload["series_id"], payload["stage"], payload["model_data"])

    def load(self, payload=None, target=None):
        payload = request() if payload is None else payload
        return (target or self.store).load(payload["series_id"], payload["stage"]["id"], payload["stage"]["format"])

    def path(self, payload=None):
        payload = request() if payload is None else payload
        stage = payload["stage"]
        return self.root / payload["series_id"] / "backgrounds" / f"{stage['sha256']}.{stage['format']}"

    def test_missing_models_are_read_only_and_save_needs_no_catalog_metadata(self):
        payload = request()
        self.assertEqual(self.load(payload), {"found": False, "series_id": "series-one",
                                              "stage_id": payload["stage"]["id"], "format": "glb"})
        self.assertFalse(self.root.exists())
        self.assertEqual(self.save(payload), {"ok": True, "series_id": "series-one",
                                              "stage_id": payload["stage"]["id"], "created": True})
        self.assertEqual(self.path(payload).read_bytes(), glb())
        self.assertFalse((self.root / "series-one" / "catalog.json").exists())
        reloaded = self.load(payload, store.SeriesBackgroundStore(self.root))
        self.assertEqual(reloaded, {"found": True, "series_id": "series-one", "stage_id": payload["stage"]["id"],
                                    "format": "glb", "model_data": payload["model_data"]})

    def test_ascii_and_binary_fbx_preserve_original_bytes(self):
        for raw in (fbx(), fbx(7400), fbx(7500)):
            with self.subTest(size=len(raw)):
                payload = request(raw, "fbx")
                self.save(payload)
                self.assertEqual(self.path(payload).read_bytes(), raw)
                self.assertEqual(base64.b64decode(self.load(payload)["model_data"]), raw)

    def test_duplicate_save_does_not_rewrite_an_original(self):
        payload = request()
        self.save(payload)
        before = self.path(payload).stat()
        payload["stage"].update(name="別の表示名.glb", storageId="restored-project-cache")
        self.assertFalse(self.save(payload)["created"])
        after = self.path(payload).stat()
        self.assertEqual((after.st_ino, after.st_mtime_ns), (before.st_ino, before.st_mtime_ns))
        self.assertEqual(list(self.path(payload).parent.iterdir()), [self.path(payload)])

    def test_separate_series_and_models_do_not_share_mutable_paths(self):
        first, second = request(), request(series_id="series-two")
        self.save(first)
        self.assertFalse(self.load(second)["found"])
        self.save(second)
        self.path(first).unlink()
        self.assertFalse(self.load(first)["found"])
        self.assertTrue(self.load(second)["found"])
        self.assertEqual(self.path(second).read_bytes(), glb())

    def test_invalid_metadata_or_base64_cannot_create_a_store(self):
        mutations = [("id", "stage-" + "0" * 64), ("id", "../other"), ("sha256", "A" * 64),
                     ("byteLength", True), ("byteLength", 0), ("byteLength", len(glb()) + 1),
                     ("byteLength", store.MAX_PROJECT_BYTES + 1), ("name", ""), ("name", []),
                     ("storageId", ""), ("storageId", 3), ("format", "obj"), ("format", []),
                     ("format", "glb/../../outside")]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                payload = request()
                payload["stage"][field] = value
                with self.assertRaises(ValueError):
                    self.save(payload)
        for value in (None, [], "", "data:model/gltf-binary;base64," + request()["model_data"],
                      "!" * len(request()["model_data"])):
            with self.subTest(model_data=value):
                payload = request()
                payload["model_data"] = value
                with self.assertRaises(ValueError):
                    self.save(payload)
        self.assertFalse(self.root.exists())

    def test_series_and_load_path_inputs_cannot_escape_the_store(self):
        for series in (None, [], "", ".", "..", "../outside", "/outside", "one/two", "one\\two", "a" * 129):
            with self.subTest(series=series):
                payload = request(series_id=series)
                with self.assertRaises(ValueError):
                    self.save(payload)
                with self.assertRaises(ValueError):
                    self.load(payload)
        for stage_id, model_format in (("../outside", "glb"), ("stage-" + "a" * 64, "../../outside"),
                                        ("stage-" + "A" * 64, "glb"), ([], "glb"), (request()["stage"]["id"], {})):
            with self.subTest(stage_id=stage_id, model_format=model_format), self.assertRaises(ValueError):
                self.store.load("series-one", stage_id, model_format)
        self.assertFalse(self.root.exists())

    def test_model_header_validation_is_independent_of_correct_hash(self):
        raw = glb()
        malformed = [(b"bad!" + raw[4:], "glb"), (raw[:4] + struct.pack("<I", 1) + raw[8:], "glb"),
                     (raw[:-1], "glb"), (raw + b"trailing", "glb"),
                     (raw[:20] + b"!" + raw[21:], "glb"), (fbx().replace(b"7400", b"6100"), "fbx"),
                     (fbx(7400)[:26], "fbx"), (raw, "fbx"), (fbx(), "glb")]
        for data, model_format in malformed:
            with self.subTest(data=data[:24], model_format=model_format), self.assertRaises(ValueError):
                self.save(request(data, model_format))
        self.assertFalse(self.root.exists())

    def test_corruption_fails_load_and_cannot_be_overwritten_by_save(self):
        payload = request()
        self.save(payload)
        corrupt = glb().replace(b"synthetic", b"Synthetic")
        self.path(payload).write_bytes(corrupt)
        for operation in (lambda: self.load(payload), lambda: self.save(payload)):
            with self.assertRaisesRegex(ValueError, "ハッシュ"):
                operation()
        self.assertEqual(self.path(payload).read_bytes(), corrupt)
        self.assertEqual(list(self.path(payload).parent.iterdir()), [self.path(payload)])

    def test_symlinks_are_rejected_at_root_series_directory_and_model(self):
        for component in ("root", "series", "backgrounds", "model", "missing-model"):
            with self.subTest(component=component), tempfile.TemporaryDirectory(dir=self.base) as temporary:
                base = Path(temporary)
                root, outside = base / "root", base / "outside"
                outside.mkdir()
                original = outside / "original.glb"
                original.write_bytes(glb())
                payload = request()
                if component == "root":
                    root.symlink_to(outside, target_is_directory=True)
                else:
                    root.mkdir()
                    series = root / payload["series_id"]
                    if component == "series":
                        series.symlink_to(outside, target_is_directory=True)
                    else:
                        series.mkdir()
                        backgrounds = series / "backgrounds"
                        if component == "backgrounds":
                            backgrounds.symlink_to(outside, target_is_directory=True)
                        else:
                            backgrounds.mkdir()
                            model = backgrounds / f"{payload['stage']['sha256']}.glb"
                            model.symlink_to(original if component == "model" else outside / "missing.glb")
                target = store.SeriesBackgroundStore(root)
                for operation in (lambda: self.save(payload, target), lambda: self.load(payload, target)):
                    with self.assertRaises(ValueError):
                        operation()
                self.assertEqual(list(outside.iterdir()), [original])
                self.assertEqual(original.read_bytes(), glb())

    def test_non_regular_model_files_fail_without_blocking(self):
        payload = request()
        model = self.path(payload)
        model.parent.mkdir(parents=True)
        os.mkfifo(model)
        for operation in (lambda: self.save(payload), lambda: self.load(payload)):
            with self.assertRaises(ValueError):
                operation()

    def test_shared_project_size_limit_applies_before_decoding_and_reading(self):
        payload = request()
        with patch.object(store, "MAX_PROJECT_BYTES", len(glb()) - 1):
            with self.assertRaises(ValueError):
                self.save(payload)
        self.assertFalse(self.root.exists())
        with patch.object(store, "MAX_PROJECT_BYTES", len(glb())):
            self.save(payload)
            self.assertTrue(self.load(payload)["found"])
        with patch.object(store, "MAX_PROJECT_BYTES", len(glb()) - 1), self.assertRaises(ValueError):
            self.load(payload)

    def test_simultaneous_saves_publish_one_complete_original(self):
        payload = request()
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: self.save(payload, store.SeriesBackgroundStore(self.root)), range(12)))
        self.assertEqual(sum(result["created"] for result in results), 1)
        self.assertEqual(self.path(payload).read_bytes(), glb())
        self.assertEqual(list(self.path(payload).parent.iterdir()), [self.path(payload)])

    def test_failed_publication_removes_temporary_files_and_can_be_retried(self):
        payload = request()
        with patch.object(store.os, "link", side_effect=OSError("disk failure")), self.assertRaises(ValueError):
            self.save(payload)
        self.assertEqual(list(self.path(payload).parent.iterdir()), [])
        self.assertTrue(self.save(payload)["created"])
        self.assertEqual(self.path(payload).read_bytes(), glb())

    def test_catalog_save_after_model_and_draft_rollback_keep_existing_originals(self):
        payload = request()
        catalogs = bridge.SeriesCatalogStore(self.root)
        catalogs.save_background_model(payload["series_id"], payload["stage"], payload["model_data"])
        yaml = "manga:\n  meta:\n    episode_id: episode-one\n"
        catalogs.save("合成シリーズ", "series-one", yaml, "")
        self.assertEqual(catalogs.load_background_model("series-one", payload["stage"]["id"], "glb")["model_data"], payload["model_data"])
        draft = catalogs.begin_draft("合成シリーズ", "series-one", "episode-two")
        additional = request(fbx(), "fbx")
        catalogs.save_background_model("series-one", additional["stage"], additional["model_data"])
        catalogs.discard_draft(draft["draft_token"])
        self.assertTrue(catalogs.load_background_model("series-one", payload["stage"]["id"], "glb")["found"])
        self.assertFalse(catalogs.load_background_model("series-one", additional["stage"]["id"], "fbx")["found"])

    def post(self, path, body, origin="http://127.0.0.1:4325"):
        handler = object.__new__(bridge.BridgeHandler)
        raw = json.dumps(body).encode()
        handler.headers = {"Content-Length": str(len(raw)), "Content-Type": "application/json", "Origin": origin}
        handler.rfile, handler.wfile = io.BytesIO(raw), io.BytesIO()
        handler.path = path
        handler.server = SimpleNamespace(state=SimpleNamespace(series_catalogs=bridge.SeriesCatalogStore(self.root)))
        statuses = []
        handler.send_response = statuses.append
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        handler.do_POST()
        return statuses[0], json.loads(handler.wfile.getvalue())

    def test_http_contract_and_existing_origin_gate_without_starting_a_server(self):
        payload = request()
        status, saved = self.post("/api/series/background-models/save", payload, "https://untrusted.example")
        self.assertEqual(status, 403)
        self.assertFalse(self.root.exists())
        status, saved = self.post("/api/series/background-models/save", payload)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["series_id"], payload["series_id"])
        self.assertEqual(saved["stage_id"], payload["stage"]["id"])
        self.assertTrue(saved["created"])
        self.assertEqual(saved["service"], bridge.BRIDGE_SERVICE_NAME)
        read = {"series_id": "series-one", "stage_id": payload["stage"]["id"], "format": "glb"}
        status, loaded = self.post("/api/series/background-models/load", read)
        self.assertEqual(status, 200, loaded)
        self.assertEqual(loaded["model_data"], payload["model_data"])
        self.assertEqual(loaded["format"], "glb")
        status, loaded = self.post("/api/series/background-models/load", read, "https://untrusted.example")
        self.assertEqual(status, 403)
        status, missing = self.post("/api/series/background-models/load", {**read, "series_id": "series-two"})
        self.assertEqual(status, 200)
        self.assertFalse(missing["found"])
        self.assertNotIn("model_data", missing)
        status, _ = self.post("/api/series/background-models/load", {**read, "format": "../../outside"})
        self.assertEqual(status, 400)

    def test_http_body_limit_rejects_before_any_write(self):
        payload = request()
        self.assertEqual(bridge.MAX_BODY_BYTES, store.MAX_PROJECT_BYTES)
        with patch.object(bridge_http, "MAX_BODY_BYTES", len(json.dumps(payload).encode()) - 1):
            status, _ = self.post("/api/series/background-models/save", payload)
        self.assertEqual(status, 400)
        self.assertFalse(self.root.exists())

    def test_http_verify_only_reads_and_validates_without_returning_model_data(self):
        payload = request()
        read = {"series_id": payload["series_id"], "stage_id": payload["stage"]["id"],
                "format": payload["stage"]["format"], "verify_only": True}
        status, missing = self.post("/api/series/background-models/load", read)
        self.assertEqual(status, 200)
        self.assertFalse(missing["found"])
        self.assertNotIn("model_data", missing)
        self.assertNotIn("byte_length", missing)
        self.assertFalse(self.root.exists())
        self.save(payload)
        original = self.path(payload).stat()
        with patch.object(store.base64, "b64encode", side_effect=AssertionError("probe must not encode the original")):
            status, found = self.post("/api/series/background-models/load", read)
        self.assertEqual(status, 200, found)
        self.assertEqual({key: found[key] for key in ("found", "series_id", "stage_id", "format", "byte_length")},
                         {"found": True, "series_id": payload["series_id"], "stage_id": payload["stage"]["id"],
                          "format": "glb", "byte_length": len(glb())})
        self.assertNotIn("model_data", found)
        after = self.path(payload).stat()
        self.assertEqual((after.st_ino, after.st_mtime_ns), (original.st_ino, original.st_mtime_ns))
        status, full = self.post("/api/series/background-models/load", {**read, "verify_only": False})
        self.assertEqual(status, 200, full)
        self.assertEqual(full["model_data"], payload["model_data"])
        self.assertNotIn("byte_length", full)
        for invalid in (None, 1, "true", []):
            with self.subTest(verify_only=invalid):
                status, _ = self.post("/api/series/background-models/load", {**read, "verify_only": invalid})
                self.assertEqual(status, 400)

    def test_http_verify_only_rejects_corruption_even_when_path_and_size_match(self):
        payload = request()
        self.save(payload)
        corrupt = glb().replace(b"synthetic", b"Synthetic")
        self.path(payload).write_bytes(corrupt)
        status, result = self.post("/api/series/background-models/load", {
            "series_id": payload["series_id"], "stage_id": payload["stage"]["id"],
            "format": "glb", "verify_only": True,
        })
        self.assertEqual(status, 400)
        self.assertNotIn("model_data", result)
        self.assertNotIn("found", result)
        self.assertEqual(self.path(payload).read_bytes(), corrupt)

    def test_http_verify_only_checks_model_header_even_when_hash_matches(self):
        payload = request(b"bad!" + glb()[4:])
        model = self.path(payload)
        model.parent.mkdir(parents=True)
        model.write_bytes(base64.b64decode(payload["model_data"]))
        status, result = self.post("/api/series/background-models/load", {
            "series_id": payload["series_id"], "stage_id": payload["stage"]["id"],
            "format": "glb", "verify_only": True,
        })
        self.assertEqual(status, 400)
        self.assertNotIn("model_data", result)
        self.assertNotIn("found", result)


if __name__ == "__main__":
    unittest.main()
