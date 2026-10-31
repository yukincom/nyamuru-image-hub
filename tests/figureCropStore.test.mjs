import assert from 'node:assert/strict';
import test from 'node:test';
import { collectFigureCropAssetIds } from '../src/lib/figureCropStore.ts';
import { beginFigureCropImport, onFigureCropAssetsChanged } from '../src/lib/figureCropStore.ts';
import { workspaceHistory } from '../src/lib/workspaceHistory.ts';
import { characterImageCacheId, browserCatalogImageIds, saveBrowserCatalog } from '../src/lib/browserCatalog.ts';
import { toSeriesCatalogMangaYaml } from '../src/lib/manga.ts';
import { prepareBackgroundStage } from '../src/lib/background3d.ts';
import { loadBackgroundStage } from '../src/lib/backgroundStageStore.ts';
import { cubeGlb } from './background3dFixture.mjs';

// 見込み: 作品・履歴・資料・取り込みの参照で画像を保持し、参照がなくなれば回収する。
// 合格: 実メモリストアのBlob有無と保存往復を比較する。ブラウザーの画面やGCの実行時刻は確認しない。

// 見込み: アナログ参照は配置先にかかわらず保持する。合格: 人物・文字・ページ前景のIDを重複なく返す。範囲: 参照収集関数。
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

// 見込み: 回収と明示保存は独立する。合格: IndexedDBなしでも保存した画像を同じbytesへ復元でき、新しいページには残らない。範囲: 実ストアと保存codec。
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

// 見込み: IDの接頭辞は保持理由にならない。合格: current/Undo/Redoだけを残し、通常・原本・描画の未参照3件を削除する。範囲: 実メモリストア。
test('memory cleanup retains references and evicts unused originals and paint images', async () => {
  const ids=['test-current','test-undo','test-redo','test-orphan','original-test','paint-test'];
  await saveFigureCropAssets(ids.map(id=>({id,blob:new Blob([id])})));
  try {
    const count=await pruneFigureCropAssets(['test-current'],()=>['test-undo','test-redo']);
    assert.equal(count,3);
    for(const id of ids.slice(0,3))assert.ok(await loadFigureCropAsset(id),id);
    for(const id of ids.slice(3))assert.equal(await loadFigureCropAsset(id),null,id);
    assert.equal(await pruneFigureCropAssets([],()=>null),0);
  } finally { await deleteFigureCropAssets(ids); }
});

// 見込み: metadataだけの画像を回収し、非表示・固定・内部レイヤー・編集中画像と登録資料は残す。
// 合格: 使用中storageIdのみ収集し、人物資料の所属IDと3Dモデルも含める。範囲: 実参照collector、描画はしない。
test('collection follows placements, live paint and registered materials rather than the asset catalog', () => {
  const doc=createEmptyWorkspaceDocument(),page=doc.manga.pages[0];
  doc.manga.meta.series_id='series';
  const ids=['page','panel','background','figure','bubble','overlay','layer','pending','unused'];
  doc.manga.image_assets=ids.map(id=>({id,storageId:`original-${id}`}));
  const image=id=>({assetId:id,hidden:true,locked:true});
  page.images=[image('page')];
  page.panels=[{images:[image('panel')],background_images:[image('background')],figures:[{artwork:image('figure')}],bubbles:[{paint_overlay:{...image('bubble'),paint:{layers:[{image:{assetId:'layer'}}]}}}]}];
  page.page_overlay={figures:[{artwork:image('overlay')}]};
  doc.manga.characters=[{localId:'local',catalog_id:'character'}];
  doc.manga.materials=[{characterId:'local',source_image:{asset_id:'ref'}}];
  doc.manga.background_stages=[{storageId:'original-stage'}];
  assert.deepEqual(collectFigureCropAssetIds(doc,['pending']).sort(),[
    ...ids.filter(id=>id!=='unused').map(id=>`original-${id}`),'original-stage',characterImageCacheId('series','character','ref'),
  ].sort());
});

// 見込み: 履歴の寿命と画像の寿命を揃える。合格: Undo/Redo可能な画像は復元し、上限超過・Redo分岐・縮小で失った画像だけnullになる。範囲: 実履歴とストア。
test('history eviction, redo branching and resizing release the corresponding blobs', async () => {
  const ids=['original-a','original-b','original-c','original-d'];
  const document=id=>{const doc=createEmptyWorkspaceDocument();doc.manga.image_assets=ids.map(id=>({id,storageId:id}));doc.manga.pages[0].images=[{assetId:id}];return doc;};
  const h=workspaceHistory(2);let current=document(ids[0]);
  const prune=()=>pruneFigureCropAssets([current,...h.past,...h.future].flatMap(doc=>collectFigureCropAssetIds(doc)));
  const edit=async id=>{await saveFigureCropAssets([{id,blob:new Blob([id])}]);h.record(current);current=document(id);await prune();};
  await saveFigureCropAssets([{id:ids[0],blob:new Blob([ids[0]])}]);
  try{
    await edit(ids[1]);await edit(ids[2]);await edit(ids[3]);
    assert.equal(await loadFigureCropAsset(ids[0]),null);
    current=h.undo(current);await prune();assert.equal(await (await loadFigureCropAsset(ids[3])).text(),ids[3]);
    current=h.redo(current);assert.equal(current.manga.pages[0].images[0].assetId,ids[3]);
    current=h.undo(current);current=h.undo(current);await prune();
    assert.ok(await loadFigureCropAsset(ids[2]));assert.ok(await loadFigureCropAsset(ids[3]));
    await edit(ids[0]);assert.equal(await loadFigureCropAsset(ids[2]),null);assert.equal(await loadFigureCropAsset(ids[3]),null);
    await edit(ids[2]);h.resize(1);await prune();assert.equal(await loadFigureCropAsset(ids[1]),null);
    assert.ok(await loadFigureCropAsset(ids[0]));assert.ok(await loadFigureCropAsset(ids[2]));
  }finally{await deleteFigureCropAssets(ids);}
});

// 見込み: 重なった取り込みは全て完了するまで公開前画像を保護する。合格: 途中の回収0件、最後のfinally相当で再回収1回、重複解放では通知しない。範囲: 実ストア。
test('pending imports defer collection until the last commit or cancellation', async () => {
  const keep='original-imported',orphan='original-cancelled';let references=[],notifications=0;
  const unsubscribe=onFigureCropAssetsChanged(()=>{notifications++;void pruneFigureCropAssets(references);});
  const endA=beginFigureCropImport(),endB=beginFigureCropImport();
  try{
    await saveFigureCropAssets([keep,orphan].map(id=>({id,blob:new Blob([id])})));
    assert.equal(await pruneFigureCropAssets([]),0);assert.ok(await loadFigureCropAsset(orphan));
    endA();endA();assert.equal(notifications,0);assert.equal(await pruneFigureCropAssets([]),0);
    references=[keep];endB();assert.equal(notifications,1);
    assert.equal(await loadFigureCropAsset(orphan),null);assert.ok(await loadFigureCropAsset(keep));
    endB();assert.equal(notifications,1);
  }finally{endA();endB();unsubscribe();await deleteFigureCropAssets([keep,orphan]);}
});

// 見込み: 別ページのストアは共有しない。合格: 同じIDでもこのページの回収は別ページ相当のBlobを消さない。範囲: 独立moduleを使い、実ブラウザーの複数タブは未確認。
test('another page does not block this page cleanup or lose its own images', async () => {
  const other=await import('../src/lib/figureCropStore.ts?other-page-retention');const id='original-shared-name';
  try{
    await saveFigureCropAssets([{id,blob:new Blob(['here'])}]);await other.saveFigureCropAssets([{id,blob:new Blob(['there'])}]);
    await pruneFigureCropAssets([]);assert.equal(await loadFigureCropAsset(id),null);assert.equal(await (await other.loadFigureCropAsset(id)).text(),'there');
  }finally{await deleteFigureCropAssets([id]);await other.deleteFigureCropAssets([id]);}
});

// 見込み: 別作品への切替後に原本復元が遅れて完了しても不要なBlobを残さない。合格: 旧応答は直後に回収し、現作品の応答は保持。範囲: 実復元関数とstore、通信だけ遅延Promise。
test('late restore responses are collected against the latest document references', async () => {
  const {stage,blob}=await prepareBackgroundStage(cubeGlb());stage.seriesId='fixture-series';
  let references=[stage.storageId],done,started,cleanup;
  const gate=new Promise(resolve=>done=resolve),entered=new Promise(resolve=>started=resolve);
  const unsubscribe=onFigureCropAssetsChanged(()=>{cleanup=pruneFigureCropAssets([],()=>references);});
  try{
    const restored=loadBackgroundStage(stage,{load:loadFigureCropAsset,restore:async()=>{started();return gate;},cache:saveFigureCropAssets});
    await entered;references=[];await pruneFigureCropAssets(references);done(blob);
    assert.equal(await restored,blob);await cleanup;assert.equal(await loadFigureCropAsset(stage.storageId),null);
    references=[stage.storageId];await loadBackgroundStage(stage,{load:loadFigureCropAsset,restore:async()=>blob,cache:saveFigureCropAssets});
    await cleanup;assert.equal(await loadFigureCropAsset(stage.storageId),blob);
  }finally{done(blob);unsubscribe();await deleteFigureCropAssets([stage.storageId]);}
});

// 見込み: 利用者指定のシリーズ資料は紙面未配置でも保持する。合格: 台帳更新前は保持、資料を外した後は回収。範囲: 実台帳の保存と参照収集、ディスク保存なし。
test('registered series images stay usable until the catalog stops referring to them', async () => {
  const doc=createEmptyWorkspaceDocument();doc.manga.meta.series='series';doc.manga.meta.series_id='retention-series';
  doc.manga.characters=[{name:'A',role:'',scope:'series',localId:'local',catalog_id:'person'}];
  const sha='a'.repeat(64),id=characterImageCacheId('retention-series','person',`image-${sha}`);
  doc.manga.materials=[{key:'image',type:'character',scope:'series',localId:'material',catalog_id:'material',characterId:'local',character_catalog_id:'person',keywords:[],note:'',source_image:{schema_version:1,asset_id:`image-${sha}`,file_name:`characters/person/image-${sha}.png`,original_name:'image.png',media_type:'image/png',byte_size:1,width_px:1,height_px:1,sha256:sha}}];
  const {stage,blob}=await prepareBackgroundStage(cubeGlb());doc.manga.background_stages=[stage];
  doc.manga.materials.push({key:'stage',type:'background',scope:'series',catalog_id:'stage-material',keywords:[],source_stage_id:stage.id});
  const saved=await saveBrowserCatalog('series','retention-series',toSeriesCatalogMangaYaml(doc),'');
  try{
    await saveFigureCropAssets([{id,blob:new Blob(['ref'])},{id:stage.storageId,blob}]);await pruneFigureCropAssets(browserCatalogImageIds());
    assert.ok(await loadFigureCropAsset(id));assert.equal(await loadFigureCropAsset(stage.storageId),blob);
    doc.manga.materials=[];await saveBrowserCatalog('series','retention-series',toSeriesCatalogMangaYaml(doc),saved.revision);
    await pruneFigureCropAssets(browserCatalogImageIds());assert.equal(await loadFigureCropAsset(id),null);assert.equal(await loadFigureCropAsset(stage.storageId),null);
  }finally{await deleteFigureCropAssets([id,stage.storageId]);}
});
