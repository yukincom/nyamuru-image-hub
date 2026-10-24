"""python -m scripts.human_pose.import_study で出典を取り込む。"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .catalog import build_catalog, entries_from_sources
from .constants import MODELS, PAGE_URL, RAW_URL, REVISION, ROOT, SOURCE_HASHES
from .files import asset_path, fetch, image_info, read_json, record, save_json, sha256, write_original
from .source import image_links


# 取得済みファイルは記録したhashと照合する。
def cached(root, relative, manifest):
    path = asset_path(root, relative)
    prior = manifest["files"].get(relative)
    if prior:
        raw = path.read_bytes()
        if prior["path"] != relative or prior["sha256"] != sha256(raw) or prior["byte_size"] != len(raw):
            raise ValueError(f"取得済み素材が変更されています: {relative}")
        return raw
    return None


def import_study(root: Path, source_dir: Path | None = None):
    manifest_path = asset_path(root, "sources/index.json")
    manifest = read_json(manifest_path) if manifest_path.exists() else {"revision": REVISION, "files": {}}
    if manifest.get("revision") != REVISION:
        raise ValueError("出典revisionが一致しません")

    def keep(relative, raw, url, details=None):
        write_original(asset_path(root, relative), raw)
        manifest["files"].setdefault(relative, {**record(relative, raw, url), **(details or {})})
        save_json(manifest_path, manifest)

    for name, digest in SOURCE_HASHES.items():
        relative = f"sources/{name}"
        raw = cached(root, relative, manifest)
        if raw is None:
            raw = (source_dir / name).read_bytes() if source_dir else fetch(RAW_URL + name)
        if sha256(raw) != digest:
            raise ValueError(f"固定revisionの出典hashと違います: {name}")
        keep(relative, raw, RAW_URL + name)

    page_path = "sources/pose-page.html"
    page = cached(root, page_path, manifest)
    if page is None:
        page = fetch(PAGE_URL, 8 * 1024 * 1024)
        keep(page_path, page, PAGE_URL)
    links = image_links(page.decode("utf-8"))
    entries = entries_from_sources(root)
    expected = {(entry["source"]["slug"], model) for entry in entries for model in MODELS}
    if set(links) != expected:
        raise ValueError(f"公開ページと固定出典の画像対応が違います: 欠落{len(expected-set(links))} / 追加{len(set(links)-expected)}")

    # 並列取得し、保存記録は一か所から順に更新する。
    pending = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for entry in entries:
            for model in MODELS:
                relative = f"poses/{entry['id']}/references/{model}.webp"
                raw = cached(root, relative, manifest)
                url = links[entry["source"]["slug"], model]
                if raw is not None:
                    image_info(raw)
                    continue
                pending[pool.submit(fetch, url)] = (relative, url)
        for completed, future in enumerate(as_completed(pending), 1):
            relative, url = pending[future]
            raw = future.result()
            keep(relative, raw, url, image_info(raw))
            if completed % 16 == 0:
                print(f"参照画像: {completed}/{len(pending)}", flush=True)
    images = [value for key, value in manifest["files"].items() if key.startswith("poses/")]
    if len({image["sha256"] for image in images}) != 136:
        raise ValueError("参照画像に同一hashまたは件数不一致があります")
    catalog = build_catalog(root, entries, manifest)
    from .validate_catalog import validate_catalog
    validate_catalog(catalog, root)
    save_json(asset_path(root, "catalog.json"), catalog)
    print(f"68件・136画像を検証して保存: {root}", flush=True)
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--source-dir", type=Path, help="固定hashで検証する取得済みMarkdown")
    args = parser.parse_args()
    import_study(args.root, args.source_dir)


if __name__ == "__main__":
    main()
