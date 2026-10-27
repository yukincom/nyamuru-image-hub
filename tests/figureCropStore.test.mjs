import assert from 'node:assert/strict';
import test from 'node:test';
import { collectFigureCropAssetIds } from '../src/lib/figureCropStore.ts';

test('編集中の作品から人物と文字のローカル参照画像IDを重複なく収集する', () => {
  const document = {
    manga: {
      pages: [{
        page_overlay: {
          figures: [{ analogImport: { assetId: 'analog-figure:overlay' } }],
          bubbles: [{ analogTextImport: { assetId: 'analog-text:overlay' } }],
        },
        panels: [{
          figures: [
            { analogImport: { assetId: 'analog-figure:one' } },
            { analogImport: { assetId: 'analog-figure:one' } },
          ],
          bubbles: [
            { analogTextImport: { assetId: 'analog-text:one' } },
            { analogTextImport: { assetId: '  ' } },
          ],
        }],
      }],
    },
  };

  assert.deepEqual(collectFigureCropAssetIds(document).sort(), [
    'analog-figure:one',
    'analog-figure:overlay',
    'analog-text:one',
    'analog-text:overlay',
  ]);
});

import { saveFigureCropAssets, loadFigureCropAsset, deleteFigureCropAssets, pruneFigureCropAssets } from '../src/lib/figureCropStore.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';

test('work images use memory even when browser storage is unavailable; explicit snapshots roundtrip the bytes', async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,get:()=>assert.fail('must not access IndexedDB')});
  const id='test-memory-crop';
  try {
    const blob=new Blob(['test image bytes'],{type:'image/png'});
    await saveFigureCropAssets([{id,blob}]);
    assert.equal(await loadFigureCropAsset(id),blob);
    const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='explicit-save-test';
    doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:10,w:100,h:100},bg:1,action:null,bubbles:[],figures:[{name:'test',analogImport:{schemaVersion:1,assetId:id,sourceRegionId:'one',sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'body',draft:true}}]}];
    const snapshot=await createProjectSnapshot(doc);
    assert.equal(snapshot.assets.length,1);
    await deleteFigureCropAssets([id]);
    assert.equal(await loadFigureCropAsset(id),null);
    const restored=await restoreProjectSnapshot(snapshot);
    const restoredId=restored.manga.pages[0].panels[0].figures[0].analogImport.assetId;
    assert.equal(await (await loadFigureCropAsset(restoredId)).text(),'test image bytes');
    const fresh=await import('../src/lib/figureCropStore.ts?fresh-memory-test');
    assert.equal(await fresh.loadFigureCropAsset(restoredId),null,'a fresh page does not restore cached images');
    await deleteFigureCropAssets([restoredId]);
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);else delete globalThis.indexedDB;
    await deleteFigureCropAssets([id]);
  }
});

test('memory cleanup retains current, Undo/Redo, pending and explicitly protected originals', async () => {
  const ids=['test-current','test-undo','test-pending','test-orphan','original-test','paint-test'];
  await saveFigureCropAssets(ids.map(id=>({id,blob:new Blob([id])})));
  try {
    const count=await pruneFigureCropAssets(['test-current'],()=>['test-undo','test-pending']);
    assert.equal(count,1);
    assert.equal(await loadFigureCropAsset('test-orphan'),null);
    for(const id of ids.filter(id=>id!=='test-orphan'))assert.ok(await loadFigureCropAsset(id),id);
    assert.equal(await pruneFigureCropAssets([],()=>null,()=>true),0);
  } finally { await deleteFigureCropAssets(ids); }
});
