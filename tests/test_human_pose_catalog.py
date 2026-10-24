"""出典の分離・再実行・不正素材の拒否を検証する。"""
from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest

from scripts.human_pose.catalog import build_catalog, pose_id
from scripts.human_pose.constants import CATEGORIES, COMMON_KEYS, MODELS, REVISION
from scripts.human_pose.files import asset_path, save_json, write_original
from scripts.human_pose.source import common_sections, image_links, page_prompts, parse_study, pose_template, validate_template
from scripts.human_pose.validate_catalog import validate_catalog


def catalog_fixture():
    poses = []
    for category, count in CATEGORIES.items():
        for index in range(count):
            identifier = f"pose-{category}-{index}"
            images = [{"path": f"poses/{identifier}/references/{model}.webp", "sha256": hashlib.sha256(f"{identifier}/{model}".encode()).hexdigest(), "byte_size": 1} for model in MODELS]
            template = "{{subject}} {{verb:stand}}"
            poses.append({"id": identifier, "category": category[3:], "label_ja": "立つ", "label_en": "standing",
                          "tags": ["standing"], "search_aliases": [], "pose_normalized_text": "she stands",
                          "pose_text_ja": "立つ。", "pose_template": template, "template_revision": 1,
                          "prompt_segments": [{"id": "body", "text_ja": "立つ。", "template_en": template}],
                          "source": {"revision": REVISION, "path": f"sources/study/pose/{category}.md", "license_path": "sources/LICENSE", "images": images},
                          "supports": [], "normalization_notes": [], "contact_notes": [], "approximation_notes": [],
                          "production_status": "unmade", "asset_files": {}, "asset_revision": None,
                          "review": {"status": "unreviewed", "user_confirmed": False}, "image_reference_eligible": False})
    return {"schema_version": 1, "source_revision": REVISION, "tags": [{"id": "standing", "label_ja": "立つ", "aliases": []}],
            "poses": poses, "coordinate_contract": {"status": "pending_p2"}}


class SourceTests(unittest.TestCase):
    def test_common_is_separate_from_pose(self):
        common = {key: f"共通 {key}" for key in COMMON_KEYS}
        for camera in ("full-body", "overhead-full-body"):
            links = [camera, "slim-woman", "study-hair", "white-t-shirt-and-jeans", "looking-left"]
            raw = "# standing.png\n" + "\n".join(f"- [x](../../common.md#{key})" for key in links) + "\n- she stands\n"
            entry, = parse_study(raw, common)
            self.assertEqual(entry["pose_source_text"], "she stands")
            self.assertIn("共通 looking-left", entry["original_prompt"])
            self.assertEqual(entry["line"], 1)
            with self.assertRaises(ValueError):
                parse_study(raw + "- a second pose\n", common)
            with self.assertRaises(ValueError):
                parse_study(raw.replace("#looking-left", "#unknown"), common)

    def test_common_multi_bullet_and_duplicate(self):
        self.assertEqual(common_sections("# full body\n- one\n- two\n"), {"full-body": "one. two"})
        with self.assertRaises(ValueError):
            common_sections("# a\n- one\n# a\n- two")

    def test_pronouns_keep_support_objects(self):
        text = pose_template("she leans back with her hands tucked behind her")
        self.assertEqual(text, "{{subject}} {{verb:lean}} back with {{possessive_adjective}} hands tucked behind {{object}}")
        text = pose_template("she stands with her hands behind her back")
        self.assertIn("behind {{possessive_adjective}} back", text)
        self.assertIn("it", pose_template("she sits with one knee up and an arm resting on it"))
        self.assertEqual(pose_id("standing-with-her-arms-crossed"), "pose-standing-with-arms-crossed")

    def test_unknown_tokens_and_malformed_braces(self):
        for text in ("{{verb:fly}}", "{{unknown}}", "{{subject}", "", None):
            with self.assertRaises(ValueError):
                validate_template(text)

    def test_image_urls_come_from_page(self):
        html = '<img src="krea-2/pose/example.webp"><img src="https://other.test/krea-2/pose/example.webp"><img src="qwen-image-2.1/pose/example.webp">'
        links = image_links(html)
        self.assertEqual(set(links), {("example", model) for model in MODELS})
        self.assertTrue(links["example", "krea-2"].endswith("/krea-2/pose/example.webp"))
        with self.assertRaises(ValueError):
            image_links('<img src="../unrelated.png">')

    def test_page_keeps_original_punctuation(self):
        html = '<figure class="card"><img src="krea-2/pose/example.webp"><img src="qwen-image-2.1/pose/example.webp"><p>She stands. One &amp; two.</p></figure>'
        self.assertEqual(page_prompts(html), {"example": "She stands. One & two."})


class CatalogTests(unittest.TestCase):
    def test_text_is_valid_without_pose_glb(self):
        self.assertEqual(validate_catalog(catalog_fixture())["images"], 136)

    def test_inconsistent_catalog_is_rejected(self):
        changes = [
            lambda c: c["poses"].pop(),
            lambda c: c["poses"][1].update(id=c["poses"][0]["id"]),
            lambda c: c["poses"][0].update(tags=["unknown"]),
            lambda c: c["poses"][0].update(pose_template="{{unknown}}"),
            lambda c: c["poses"][0].update(pose_text_ja="違う姿勢"),
            lambda c: c["poses"][0].update(image_reference_eligible=True),
            lambda c: c["poses"][0].update(production_status="ready"),
            lambda c: c["poses"][0]["source"]["images"][0].update(path="../escape.webp"),
            lambda c: c["poses"][0]["review"].update(user_confirmed=True),
            lambda c: c["poses"][0]["review"].update(status="confirmed"),
            lambda c: c.update(coordinate_contract={"status": "verified"}),
            lambda c: c["poses"][1]["source"]["images"][0].update(sha256=c["poses"][0]["source"]["images"][0]["sha256"]),
        ]
        for change in changes:
            with self.subTest(change=change):
                value = catalog_fixture()
                change(value)
                with self.assertRaises(ValueError):
                    validate_catalog(value)

    def test_reimport_preserves_review_and_rejects_changed_text(self):
        catalog = catalog_fixture()
        catalog["poses"][0]["review"]["note"] = "後で利用者が確認する"
        catalog["poses"][0]["approximation_notes"] = ["指先は未制作"]
        catalog["coordinate_contract"] = {"status": "ready", "rig_signature": "kept"}
        catalog["base"] = {"revision": "kept"}
        manifest = {"files": {image["path"]: image for pose in catalog["poses"] for image in pose["source"]["images"]}}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            save_json(root / "catalog.json", catalog)
            updated = build_catalog(root, deepcopy(catalog_fixture()["poses"]), manifest)
            self.assertEqual(updated["poses"][0]["review"], catalog["poses"][0]["review"])
            self.assertEqual(updated["poses"][0]["approximation_notes"], ["指先は未制作"])
            self.assertEqual(updated["coordinate_contract"], catalog["coordinate_contract"])
            self.assertEqual(updated["base"], catalog["base"])
            changed = deepcopy(catalog_fixture()["poses"])
            changed[0]["pose_text_ja"] = "別の文"
            with self.assertRaises(ValueError):
                build_catalog(root, changed, manifest)
            catalog['poses'].append(deepcopy(catalog['poses'][0]))
            save_json(root / 'catalog.json', catalog)
            with self.assertRaises(ValueError):
                build_catalog(root, deepcopy(catalog_fixture()['poses']), manifest)

    def test_path_and_original_protection(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for path in ("../outside", "/tmp/outside", "a/../outside", "a\\b", "./a"):
                with self.assertRaises(ValueError):
                    asset_path(root, path)
            (root / "link").symlink_to("/tmp")
            with self.assertRaises(ValueError):
                asset_path(root, "link/outside")
            output = root / "original"
            write_original(output, b"first")
            write_original(output, b"first")
            with self.assertRaises(ValueError):
                write_original(output, b"replacement")
            self.assertEqual(output.read_bytes(), b"first")


if __name__ == "__main__":
    unittest.main()
