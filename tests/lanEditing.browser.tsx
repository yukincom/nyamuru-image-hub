import { render } from 'preact';
import { useState } from 'preact/hooks';
import App from '../src/components/App';
import sampleYaml from '../src/content/sample.omny.yaml?raw';
import { parseMangaYaml, STORAGE_KEY } from '../src/lib/manga';
import { createPortableProject, restorePortableProject, portableProjectBlob } from '../src/lib/portableProject';
import { prepareImageAsset, createImagePlacement } from '../src/lib/imagePlacement';
import { saveFigureCropAssets, deleteFigureCropAssets, loadFigureCropAsset } from '../src/lib/figureCropStore';
import { saveCharacterReferenceImage, loadCharacterReferenceImage } from '../src/lib/localBridge';
import { characterImageCacheId, listBrowserCatalogs, loadBrowserCatalog, saveBrowserCatalog } from '../src/lib/browserCatalog';
import { toSeriesCatalogMangaYaml } from '../src/lib/manga';
import { prepareDocumentForSeriesSave } from '../src/lib/seriesCatalog';
import { blobRevision, writeProjectFile } from '../src/lib/browserFiles';
import { isLanClient } from '../src/lib/clientRuntime';
import '../src/styles/global.css';

if (location.origin !== 'http://127.0.0.1:4346' || !isLanClient) throw Error('Dedicated LAN test origin required');
const png = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2ioAAAAASUVORK5CYII='), c => c.charCodeAt(0))], { type: 'image/png' });
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
let generatedFile: Blob | null = null;
let opfsHandle: FileSystemFileHandle | null = null;
async function testHandle() {
  const root = await navigator.storage.getDirectory();
  return opfsHandle ??= await root.getFileHandle('lan-roundtrip.nyamuru', { create: true });
}
// File picker stub only: actual file writes use the browser's origin-private filesystem.
Object.assign(window, {
  showSaveFilePicker: testHandle,
  showOpenFilePicker: async () => [await testHandle()],
});
async function coldRoundtrip() {
  const source = prepareDocumentForSeriesSave(parseMangaYaml(sampleYaml));
  source.manga.meta.title = 'LAN保存・資料画像の検証'; source.manga.meta.episode_id = 'lan-ui-fixture';
  source.manga.meta.series_id = 'lan-ui-series';
  const image = await prepareImageAsset(new File([png], 'test.png', { type: 'image/png' }));
  await saveFigureCropAssets([{ id: image.storageId, blob: png }]);
  source.manga.image_assets = [image];
  source.manga.pages[0].panels[0].images = [createImagePlacement(image, { x: 40, y: 80, w: 30, h: 30 })];
  const owner = source.manga.characters[0]; owner.scope = 'series'; owner.catalog_id ||= 'lan-ui-character';
  const reference = await saveCharacterReferenceImage(png, '人物資料.png', source.manga.meta.series_id, owner.catalog_id);
  source.manga.materials.push({ key: 'LAN人物資料', type: 'character', scope: 'series', keywords: [], characterId: owner.localId,
    character_catalog_id: owner.catalog_id, catalog_id: 'lan-ui-reference', source_image: reference.sourceImage });
  const file = await createPortableProject(source);
  const characterKey = characterImageCacheId(source.manga.meta.series_id, owner.catalog_id, reference.sourceImage.asset_id);
  await deleteFigureCropAssets([image.storageId, characterKey]);
  assert(!await loadFigureCropAsset(characterKey), 'cold cache precondition');
  const restored = await restorePortableProject(JSON.parse(await portableProjectBlob(file).text()));
  assert(Boolean(await loadFigureCropAsset(restored.manga.image_assets![0].storageId)), 'image restored');
  assert(Boolean(await loadCharacterReferenceImage(restored.manga.meta.series_id, owner.catalog_id, reference.sourceImage.asset_id)), 'character image restored');
  const old = await loadBrowserCatalog(restored.manga.meta.series, restored.manga.meta.series_id);
  const saved = await saveBrowserCatalog(restored.manga.meta.series, restored.manga.meta.series_id, toSeriesCatalogMangaYaml(restored), old.revision);
  let conflicted = false;
  try { await saveBrowserCatalog(restored.manga.meta.series, restored.manga.meta.series_id, toSeriesCatalogMangaYaml(restored), 'stale'); } catch { conflicted = true; }
  assert(conflicted && Boolean(saved.revision), 'stale series revision rejected');
  assert((await listBrowserCatalogs()).some(item => item.seriesId === restored.manga.meta.series_id), 'local catalog visible');
  generatedFile = portableProjectBlob(file);
  const writable = await (await testHandle()).createWritable(); await writable.write(generatedFile); await writable.close();
  return 'PASS: PNG原本・人物資料画像の空キャッシュ復元、シリーズ競合拒否、編集PC内の実ファイル書込';
}
function Controls() {
  const [result, setResult] = useState('待機中');
  const run = async () => { try { setResult(await coldRoundtrip()); } catch (error) { setResult(`FAIL: ${error instanceof Error ? error.stack : String(error)}`); } };
  return <aside style="padding:8px;background:#fff4d5;position:relative;z-index:3000">
    <button onClick={run}>画像込み保存を検証</button>
    <button onClick={async () => { try { const file = await (await testHandle()).getFile(); setResult(`保存ファイル: ${file.size} bytes / ${JSON.parse(await file.text()).snapshot.document.manga.meta.title}`); } catch (e) { setResult(String(e)); } }}>保存ファイルを確認</button>
    <button onClick={async () => { const writable = await (await testHandle()).createWritable(); await writable.write('external edit'); await writable.close(); setResult('外部変更を作成しました'); }}>外部変更を模擬</button>
    <button onClick={async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle('lan-concurrent-test.nyamuru', { create: true });
        const revision = await blobRevision(await handle.getFile());
        const outcomes = await Promise.allSettled(['first', 'second'].map(text => writeProjectFile(new Blob([text]), { handle, revision })));
        assert(outcomes.filter(item => item.status === 'fulfilled').length === 1, 'exactly one save succeeds');
        assert(outcomes.filter(item => item.status === 'rejected').length === 1, 'conflicting save rejected');
        setResult('PASS: 実ファイルへの同時保存は1件成功・1件競合拒否');
      } catch (e) { setResult(`FAIL: ${String(e)}`); }
    }}>同時保存を検証</button>
    <button onClick={() => { localStorage.removeItem(STORAGE_KEY); location.reload(); }}>白紙起動へ</button>
    <output style="display:block;white-space:pre-wrap" aria-live="polite">{result}</output>
  </aside>;
}
render(<Controls />, document.getElementById('test-controls')!);
render(<App />, document.getElementById('app')!);
