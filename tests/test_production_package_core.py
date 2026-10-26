import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "nyamuru_production_package.py"
SPEC = importlib.util.spec_from_file_location("nyamuru_production_package", MODULE_PATH)
assert SPEC and SPEC.loader
package_core = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package_core)


def file_hash(path, algorithm):
    digest = hashlib.new(algorithm)
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def refresh_fake_payload_manifests(package):
    package = Path(package)
    payload_files = sorted(path for path in (package / "data").rglob("*") if path.is_file())
    for algorithm in ("sha256", "sha512"):
        lines = [
            f"{file_hash(path, algorithm)}  {path.relative_to(package).as_posix()}"
            for path in payload_files
        ]
        (package / f"manifest-{algorithm}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # Both payload manifests are tag files; update them before either tag hash.
    for algorithm in ("sha256", "sha512"):
        tag_manifest = package / f"tagmanifest-{algorithm}.txt"
        tag_paths = [line.split("  ", 1)[1] for line in tag_manifest.read_text(encoding="utf-8").splitlines()]
        tag_manifest.write_text("".join(f"{file_hash(package / path, algorithm)}  {path}\n" for path in tag_paths), encoding="utf-8")


def legacy_snapshot_paths(package):
    manifest_path = package / "data" / "nyamuru-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for key, old_path in (("omny_path", "data/name/document.omny.yaml"), ("omay_path", "data/style/document.omay.yaml")):
        current = manifest["document"][key]
        (package / current).rename(package / old_path)
        manifest["document"][key] = old_path
        next(payload for payload in manifest["payloads"] if payload["path"] == current)["path"] = old_path
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    refresh_fake_payload_manifests(package)
    return manifest


class FakeBagIt:
    def __init__(self):
        self.validation_calls = 0

    def validate_fd(self, package_fd):
        self.validation_calls += 1
        package_device = os.fstat(package_fd).st_dev
        for algorithm in ("sha256", "sha512"):
            manifest_fd = package_core._open_file_beneath(
                package_fd,
                (f"manifest-{algorithm}.txt",),
                expected_device=package_device,
                label=f"manifest-{algorithm}.txt",
            )
            try:
                manifest_text = package_core._read_descriptor(manifest_fd).decode("utf-8")
            finally:
                os.close(manifest_fd)
            for line in manifest_text.splitlines():
                expected, relative_path = line.split("  ", 1)
                target_fd = package_core._open_file_beneath(
                    package_fd,
                    tuple(Path(relative_path).parts),
                    expected_device=package_device,
                    label=relative_path,
                )
                try:
                    _, hashes = package_core._hash_descriptor(target_fd, label=relative_path)
                finally:
                    os.close(target_fd)
                if hashes[algorithm] != expected:
                    raise ValueError(f"invalid {relative_path}")
        return True


class FailingBagIt(FakeBagIt):
    def validate_fd(self, package_fd):
        raise ValueError("synthetic validation failure")


class ProductionPackageCoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name) / "workspace"
        self.workspace.mkdir()
        (self.workspace / "name_data").mkdir()
        (self.workspace / "draft_data").mkdir()
        (self.workspace / "manuscript_data").mkdir()
        (self.workspace / "name_data" / "episode.omny.yaml").write_bytes(
            "manga:\n  meta:\n    title: 合成fixture\n".encode("utf-8")
        )
        self.psd_bytes = b"8BPS\x00\x01\x00\x00\xff\x10synthetic-layer-data\x00\xfe"
        (self.workspace / "draft_data" / "page-001.psd").write_bytes(self.psd_bytes)
        (self.workspace / "manuscript_data" / "preview.png").write_bytes(
            b"\x89PNG\r\n\x1a\nsynthetic-preview"
        )
        (self.workspace / "export_data").mkdir()
        (self.workspace / "export_data" / "must-not-be-scanned.bin").write_bytes(b"ignore me")
        self.clock = lambda: dt.datetime(2026, 9, 1, 2, 3, 4, tzinfo=dt.timezone.utc)

    def tearDown(self):
        self.temp.cleanup()

    def make_core(self, bagit_module=None):
        return package_core.ProductionPackageCore(bagit_module=bagit_module, now=self.clock)

    def selections(self, plan, *paths):
        candidates = {candidate["relative_path"]: candidate for candidate in plan["candidates"]}
        return [
            {
                "relative_path": path,
                "sha256": candidates[path]["sha256"],
                "sha512": candidates[path]["sha512"],
            }
            for path in paths
        ]

    def export_once(self, core, plan=None):
        plan = plan or core.plan(self.workspace)
        result = core.export(
            self.workspace,
            plan_revision=plan["plan_revision"],
            selected_files=self.selections(
                plan,
                "name_data/episode.omny.yaml",
                "draft_data/page-001.psd",
                "manuscript_data/preview.png",
            ),
            omny_yaml=b"manga:\n  meta:\n    title: package snapshot\n",
            omay_yaml="style:\n  line: ink\n".encode("utf-8"),
            document={
                "title": "合成fixture",
                "series_id": "series-fixture",
                "episode_id": "episode-001",
                "episode_number": 1,
            },
        )
        return result, self.workspace / result["package_relative_path"]

    def test_plan_scans_only_managed_directories_and_hashes_each_candidate(self):
        core = self.make_core(None)
        plan = core.plan(self.workspace)

        self.assertFalse(plan["bagit_available"])
        self.assertEqual(plan["algorithms"], ["sha256", "sha512"])
        self.assertEqual(plan["missing_directories"], [])
        self.assertEqual(
            [candidate["relative_path"] for candidate in plan["candidates"]],
            [
                "draft_data/page-001.psd",
                "manuscript_data/preview.png",
                "name_data/episode.omny.yaml",
            ],
        )
        psd = plan["candidates"][0]
        self.assertEqual(psd["role"], "editable_psd")
        self.assertEqual(psd["media_type"], "image/vnd.adobe.photoshop")
        self.assertEqual(psd["byte_size"], len(self.psd_bytes))
        self.assertEqual(psd["sha256"], hashlib.sha256(self.psd_bytes).hexdigest())
        self.assertEqual(psd["sha512"], hashlib.sha512(self.psd_bytes).hexdigest())
        self.assertNotIn("export_data", json.dumps(plan))

    def test_safe_relative_path_rejects_traversal_absolute_and_backslash(self):
        accepted = package_core.normalize_managed_relative_path("draft_data/page 1.psd")
        self.assertEqual(accepted, "draft_data/page 1.psd")
        for value in (
            "../draft_data/page.psd",
            "/draft_data/page.psd",
            "draft_data/../secret",
            "draft_data\\page.psd",
            "export_data/package",
            "draft_data//page.psd",
            "draft_data",
            "",
        ):
            with self.subTest(value=value):
                with self.assertRaises(package_core.UnsafeWorkspaceEntry):
                    package_core.normalize_managed_relative_path(value)
        with self.assertRaises(package_core.UnsafeWorkspaceEntry):
            package_core.normalize_managed_relative_path("draft_data/\ud800.psd")

    def test_plan_uses_unicode_scalar_order_shared_with_typescript(self):
        (self.workspace / "draft_data" / "\uE000.psd").write_bytes(b"bmp-private-use")
        (self.workspace / "draft_data" / "\U00010000.psd").write_bytes(b"supplementary")
        paths = [
            candidate["relative_path"]
            for candidate in self.make_core(None).plan(self.workspace)["candidates"]
            if candidate["relative_path"] in ("draft_data/\uE000.psd", "draft_data/\U00010000.psd")
        ]
        self.assertEqual(paths, ["draft_data/\uE000.psd", "draft_data/\U00010000.psd"])

    def test_plan_rejects_symlinks_and_special_files(self):
        outside = Path(self.temp.name) / "outside.psd"
        outside.write_bytes(b"outside")
        symlink = self.workspace / "draft_data" / "outside.psd"
        symlink.symlink_to(outside)
        with self.assertRaises(package_core.UnsafeWorkspaceEntry):
            self.make_core(None).plan(self.workspace)
        symlink.unlink()

        if hasattr(os, "mkfifo"):
            fifo = self.workspace / "draft_data" / "render.pipe"
            os.mkfifo(fifo)
            try:
                with self.assertRaises(package_core.UnsafeWorkspaceEntry):
                    self.make_core(None).plan(self.workspace)
            finally:
                fifo.unlink()

    def test_plan_rejects_symlinked_managed_directory(self):
        shutil.rmtree(self.workspace / "draft_data")
        outside = Path(self.temp.name) / "outside-directory"
        outside.mkdir()
        (self.workspace / "draft_data").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(package_core.UnsafeWorkspaceEntry):
            self.make_core(None).plan(self.workspace)

    def test_plan_ancestor_swap_cannot_hash_workspace_external_file(self):
        internal = self.workspace / "draft_data" / "sub"
        internal.mkdir()
        (internal / "raced.psd").write_bytes(b"internal")
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        outside_bytes = b"outside-secret"
        (outside / "raced.psd").write_bytes(outside_bytes)
        moved = self.workspace / "draft_data" / "sub-owned"
        fired = False

        def hook(event, details):
            nonlocal fired
            if event == "entry_lstat_done" and details.get("relative_path") == "draft_data/sub":
                fired = True
                internal.rename(moved)
                internal.symlink_to(outside, target_is_directory=True)

        core = package_core.ProductionPackageCore(bagit_module=None, _test_hook=hook)
        with self.assertRaises(package_core.ProductionPackageError):
            core.plan(self.workspace)
        self.assertTrue(fired)
        self.assertNotEqual(
            hashlib.sha256(outside_bytes).hexdigest(),
            hashlib.sha256((moved / "raced.psd").read_bytes()).hexdigest(),
        )

    def test_export_data_swap_cannot_publish_outside_workspace(self):
        outside = Path(self.temp.name) / "outside-export"
        outside.mkdir()
        original = self.workspace / "export_data"
        moved = self.workspace / "export-owned"
        fired = False

        def hook(event, _details):
            nonlocal fired
            if event == "export_fd_opened" and not fired:
                fired = True
                original.rename(moved)
                original.symlink_to(outside, target_is_directory=True)

        core = package_core.ProductionPackageCore(
            bagit_module=FakeBagIt(),
            now=self.clock,
            _test_hook=hook,
            _token_factory=lambda: "redirect-race",
        )
        plan = core.plan(self.workspace)
        with self.assertRaises(package_core.PackagePlanConflict):
            self.export_once(core, plan)
        self.assertTrue(fired)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse(any(path.name.endswith("-package") for path in moved.iterdir()))
        self.assertFalse(any(path.name.startswith(".nyamuru-package-") for path in moved.iterdir()))

    def test_cleanup_never_follows_replaced_staging_name(self):
        outside = Path(self.temp.name) / "outside-victim"
        outside.mkdir()
        sentinel = outside / "keep.txt"
        sentinel.write_bytes(b"keep")
        moved_name = ".owned-staging-moved"
        fired = False

        def hook(event, details):
            nonlocal fired
            if event == "before_cleanup" and not fired:
                fired = True
                export_fd = details["export_fd"]
                staging_name = details["staging_name"]
                os.rename(
                    staging_name,
                    moved_name,
                    src_dir_fd=export_fd,
                    dst_dir_fd=export_fd,
                )
                os.symlink(
                    outside,
                    staging_name,
                    target_is_directory=True,
                    dir_fd=export_fd,
                )

        core = package_core.ProductionPackageCore(
            bagit_module=FailingBagIt(),
            now=self.clock,
            _test_hook=hook,
            _token_factory=lambda: "cleanup-race",
        )
        plan = core.plan(self.workspace)
        with self.assertRaises(package_core.BagItValidationError):
            self.export_once(core, plan)
        self.assertTrue(fired)
        self.assertEqual(sentinel.read_bytes(), b"keep")
        moved = self.workspace / "export_data" / moved_name
        self.assertTrue(moved.is_dir())
        self.assertEqual(list(moved.iterdir()), [])

    def test_publish_revalidates_payload_changed_before_rename(self):
        fired = False

        def hook(event, details):
            nonlocal fired
            if event == "before_publish" and not fired:
                fired = True
                descriptor = os.open(
                    "data/name/document.yaml",
                    os.O_WRONLY | os.O_TRUNC,
                    dir_fd=details["staging_fd"],
                )
                try:
                    os.write(descriptor, b"changed-before-rename\n")
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)

        core = package_core.ProductionPackageCore(
            bagit_module=FakeBagIt(),
            now=self.clock,
            _test_hook=hook,
            _token_factory=lambda: "pre-publish-change",
        )
        plan = core.plan(self.workspace)
        with self.assertRaises(package_core.BagItValidationError):
            self.export_once(core, plan)
        self.assertTrue(fired)
        self.assertEqual(
            {path.name for path in (self.workspace / "export_data").iterdir()},
            {"must-not-be-scanned.bin"},
        )

    def test_publish_revalidates_payload_changed_after_rename(self):
        fired = False

        def hook(event, details):
            nonlocal fired
            if event == "published_before_final_validation" and not fired:
                fired = True
                descriptor = os.open(
                    "data/style/settings.yaml",
                    os.O_WRONLY | os.O_TRUNC,
                    dir_fd=details["staging_fd"],
                )
                try:
                    os.write(descriptor, b"changed-after-rename\n")
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)

        core = package_core.ProductionPackageCore(
            bagit_module=FakeBagIt(),
            now=self.clock,
            _test_hook=hook,
            _token_factory=lambda: "post-publish-change",
        )
        plan = core.plan(self.workspace)
        with self.assertRaises(package_core.BagItValidationError):
            self.export_once(core, plan)
        self.assertTrue(fired)
        self.assertEqual(
            {path.name for path in (self.workspace / "export_data").iterdir()},
            {"must-not-be-scanned.bin"},
        )

    def test_plan_works_without_bagit_but_export_has_a_clear_error(self):
        core = self.make_core(None)
        plan = core.plan(self.workspace)
        with self.assertRaisesRegex(package_core.BagItUnavailable, "bagit-python 1.9.0"):
            core.export(
                self.workspace,
                plan_revision=plan["plan_revision"],
                selected_files=[],
                omny_yaml="omny",
                omay_yaml="omay",
                document={"title": "fixture"},
            )

    def test_export_builds_and_validates_bag_without_changing_payload_bytes(self):
        fake_bagit = FakeBagIt()
        core = self.make_core(fake_bagit)
        result, package = self.export_once(core)

        self.assertTrue(result["ok"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["payload_count"], 5)
        self.assertTrue(package.is_dir())
        self.assertGreaterEqual(fake_bagit.validation_calls, 1)
        self.assertEqual(
            (package / "bagit.txt").read_bytes(),
            b"BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n",
        )
        self.assertTrue((package / "manifest-sha256.txt").is_file())
        self.assertTrue((package / "manifest-sha512.txt").is_file())
        self.assertEqual(
            (package / "data" / "workspace" / "name_data" / "episode.omny.yaml").read_bytes(),
            (self.workspace / "name_data" / "episode.omny.yaml").read_bytes(),
        )
        self.assertEqual(
            (package / "data" / "workspace" / "draft_data" / "page-001.psd").read_bytes(),
            self.psd_bytes,
        )
        self.assertEqual(
            (package / "data" / "name" / "document.yaml").read_bytes(),
            b"manga:\n  meta:\n    title: package snapshot\n",
        )
        self.assertEqual(
            (package / "data" / "style" / "settings.yaml").read_bytes(),
            b"style:\n  line: ink\n",
        )
        self.assertFalse((package / "data" / "export_data").exists())
        self.assertFalse(any(path.name.startswith(".nyamuru-package-") for path in (self.workspace / "export_data").iterdir()))

        manifest = json.loads((package / "data" / "nyamuru-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["bagit"], {"version": "1.0", "algorithms": ["sha256", "sha512"]})
        psd = next(payload for payload in manifest["payloads"] if payload["role"] == "editable_psd")
        self.assertEqual(psd["sha256"], hashlib.sha256(self.psd_bytes).hexdigest())
        self.assertEqual(psd["sha512"], hashlib.sha512(self.psd_bytes).hexdigest())
        self.assertTrue(core.validate(package)["valid"])

    def test_legacy_package_is_validated_read_only_and_unknown_document_paths_are_rejected(self):
        core = self.make_core(FakeBagIt())
        _, package = self.export_once(core)
        schema = json.loads((MODULE_PATH.parents[1] / "schemas" / "nyamuru-package-v1.schema.json").read_text(encoding="utf-8"))
        for key, paths in (("omny_path", ["data/name/document.yaml", "data/name/document.omny.yaml"]),
                           ("omay_path", ["data/style/settings.yaml", "data/style/document.omay.yaml"])):
            self.assertEqual(schema["$defs"]["document"]["properties"][key]["enum"], paths)
        manifest = legacy_snapshot_paths(package)
        for algorithm in ("sha256", "sha512"):
            for line in (package / f"tagmanifest-{algorithm}.txt").read_text(encoding="utf-8").splitlines():
                expected, relative = line.split("  ", 1)
                self.assertEqual(file_hash(package / relative, algorithm), expected)
        before = {path.relative_to(package): (path.read_bytes(), path.stat().st_mtime_ns) for path in package.rglob("*") if path.is_file()}
        self.assertTrue(core.validate(package)["valid"])
        self.assertEqual(before, {path.relative_to(package): (path.read_bytes(), path.stat().st_mtime_ns) for path in package.rglob("*") if path.is_file()})
        for key in ("omny_path", "omay_path"):
            invalid = json.loads(json.dumps(manifest))
            invalid["document"][key] = "data/arbitrary.yaml"
            with self.assertRaisesRegex(package_core.BagItValidationError, "固定path"):
                core._validate_manifest_shape(invalid)

    def test_standard_yaml_roles_use_known_names_and_story_directory_only(self):
        for path, role in (
            ("name_data/story.yaml", "story_omny"),
            ("name_data/story-settings.yaml", "style_omay"),
            ("draft_data/story-generation.yml", "style_omay"),
            ("name_data/legacy.omny.yaml", "story_omny"),
            ("draft_data/legacy.omay.yaml", "style_omay"),
            ("draft_data/arbitrary.yaml", "workspace_payload"),
        ):
            with self.subTest(path=path):
                self.assertEqual(package_core._payload_role(path), role)
                self.assertEqual(package_core._media_type(Path(path)), "application/yaml")

    @unittest.skipUnless(importlib.util.find_spec("jsonschema"), "jsonschema is not installed")
    def test_manifest_schema_accepts_new_and_legacy_fixed_paths(self):
        import jsonschema
        schema = json.loads((MODULE_PATH.parents[1] / "schemas" / "nyamuru-package-v1.schema.json").read_text(encoding="utf-8"))
        core = self.make_core(FakeBagIt())
        _, package = self.export_once(core)
        for manifest in (core.validate(package)["manifest"], legacy_snapshot_paths(package)):
            jsonschema.validate(manifest, schema)
            for key, alternatives in (("omny_path", ("data/name/document.yaml", "data/name/document.omny.yaml")),
                                      ("omay_path", ("data/style/settings.yaml", "data/style/document.omay.yaml"))):
                mismatched = json.loads(json.dumps(manifest))
                mismatched["document"][key] = next(path for path in alternatives if path != manifest["document"][key])
                with self.assertRaises(jsonschema.ValidationError):
                    jsonschema.validate(mismatched, schema)

    def test_export_rechecks_plan_revision_and_selection_hashes(self):
        core = self.make_core(FakeBagIt())
        plan = core.plan(self.workspace)
        (self.workspace / "draft_data" / "page-001.psd").write_bytes(b"changed")
        with self.assertRaises(package_core.PackagePlanConflict):
            self.export_once(core, plan)
        self.assertEqual(list((self.workspace / "export_data").iterdir()), [
            self.workspace / "export_data" / "must-not-be-scanned.bin"
        ])

        refreshed = core.plan(self.workspace)
        bad_selection = self.selections(refreshed, "draft_data/page-001.psd")
        bad_selection[0]["sha256"] = "0" * 64
        with self.assertRaises(package_core.PackagePlanConflict):
            core.export(
                self.workspace,
                plan_revision=refreshed["plan_revision"],
                selected_files=bad_selection,
                omny_yaml="omny",
                omay_yaml="omay",
                document={"title": "fixture"},
            )

    def test_existing_destination_is_never_overwritten(self):
        core = self.make_core(FakeBagIt())
        result, package = self.export_once(core)
        sentinel = (package / "data" / "workspace" / "draft_data" / "page-001.psd").read_bytes()
        with self.assertRaises(package_core.PackageDestinationExists):
            self.export_once(core)
        self.assertEqual(
            (package / "data" / "workspace" / "draft_data" / "page-001.psd").read_bytes(),
            sentinel,
        )
        self.assertEqual(result["package_relative_path"], "export_data/合成fixture-20260901T020304Z-package")

    def test_validate_rejects_payload_tampering(self):
        core = self.make_core(FakeBagIt())
        _, package = self.export_once(core)
        (package / "data" / "workspace" / "draft_data" / "page-001.psd").write_bytes(b"tampered")
        with self.assertRaises(package_core.BagItValidationError):
            core.validate(package)

    def test_validate_rejects_unlisted_payload_even_when_bagit_double_accepts_it(self):
        core = self.make_core(FakeBagIt())
        _, package = self.export_once(core)
        extra = package / "data" / "workspace" / "draft_data" / "unlisted.psd"
        extra.write_bytes(b"unlisted")
        refresh_fake_payload_manifests(package)
        with self.assertRaisesRegex(package_core.BagItValidationError, "一覧が一致"):
            core.validate(package)

    def test_validate_rejects_source_path_that_does_not_match_payload_path(self):
        core = self.make_core(FakeBagIt())
        _, package = self.export_once(core)
        manifest_path = package / "data" / "nyamuru-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        psd = next(payload for payload in manifest["payloads"] if payload["role"] == "editable_psd")
        psd["source_relative_path"] = "name_data/not-the-copied-source.psd"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        refresh_fake_payload_manifests(package)
        with self.assertRaisesRegex(package_core.BagItValidationError, "source_relative_path"):
            core.validate(package)


@unittest.skipUnless(importlib.util.find_spec("bagit"), "bagit-python is not installed")
class RealBagItIntegrationTest(unittest.TestCase):
    def test_real_bagit_round_trip_when_preinstalled(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp) / "workspace"
            (workspace / "draft_data").mkdir(parents=True)
            payload = workspace / "draft_data" / "page.psd"
            payload.write_bytes(b"8BPS-real-bagit-optional-fixture")
            core = package_core.ProductionPackageCore(
                now=lambda: dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc)
            )
            plan = core.plan(workspace)
            candidate = plan["candidates"][0]
            result = core.export(
                workspace,
                plan_revision=plan["plan_revision"],
                selected_files=[{
                    "relative_path": candidate["relative_path"],
                    "sha256": candidate["sha256"],
                    "sha512": candidate["sha512"],
                }],
                omny_yaml="manga: {}\n",
                omay_yaml="style: {}\n",
                document={"title": "real-bagit"},
            )
            package = workspace / result["package_relative_path"]
            self.assertEqual(
                (package / "bagit.txt").read_bytes(),
                b"BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n",
            )
            manifest = json.loads((package / "data" / "nyamuru-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["bagit"]["version"], "1.0")
            self.assertTrue(core.validate(package)["valid"])
            legacy_snapshot_paths(package)
            self.assertTrue(core.validate(package)["valid"])


if __name__ == "__main__":
    unittest.main()
