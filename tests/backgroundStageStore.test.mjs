import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {cubeGlb} from './background3dFixture.mjs';
import {prepareBackgroundStage,backgroundMaterialStages,namedBackgroundStages} from '../src/lib/background3d.ts';
import {loadBackgroundStage,persistSeriesBackgroundModels} from '../src/lib/backgroundStageStore.ts';
import {parseMangaYaml,toSeriesCatalogMangaYaml,toSeparatedMangaYaml} from '../src/lib/manga.ts';
import {mergeSeriesCatalog,upsertEpisodeIntoSeriesCatalog} from '../src/lib/seriesCatalog.ts';
import {createProjectSnapshot,restoreProjectSnapshot} from '../src/lib/projectPersistence.ts';
const sample=()=>parseMangaYaml(readFileSync(new URL('../src/content/sample.yaml',import.meta.url),'utf8'));
async function fixture(){
 const document=sample(),item=await prepareBackgroundStage(cubeGlb());
 document.manga.meta.series='背景シリーズ';document.manga.meta.series_id='background-series';
 document.manga.background_stages=[item.stage];document.manga.materials=[{localId:'office-local',key:'仕事部屋',type:'background',scope:'series',catalog_id:'office-common',keywords:[],source_stage_id:item.stage.id}];
 return {...item,document};
}
test('シリーズの登録背景は各話から独立して、原本と登録名を次のエピソードへ渡す',async()=>{
 const {document,stage}=await fixture();
 const extra={...stage,id:`stage-${'f'.repeat(64)}`,sha256:'f'.repeat(64),storageId:'episode-only',name:'一度だけ.glb'};
 document.manga.background_stages.push(extra);
 document.manga.materials.push({localId:'episode-local',key:'今回のみ',type:'background',scope:'episode',keywords:[],source_stage_id:extra.id});
 const catalog=parseMangaYaml(toSeriesCatalogMangaYaml(document));
 assert.deepEqual(catalog.manga.background_stages.map(s=>s.id),[stage.id]);assert.equal(catalog.manga.background_stages[0].seriesId,'background-series');
 const next=sample();next.manga.materials=[];
 const merged=mergeSeriesCatalog(next,catalog).document;
 assert.equal(merged.manga.materials[0].source_stage_id,stage.id);assert.equal(namedBackgroundStages(merged)[0].name,'仕事部屋');
 assert.equal(merged.manga.background_stages[0].name,stage.name);assert.equal(backgroundMaterialStages(merged,'series').length,1);
 const publicYaml=toSeparatedMangaYaml(document);assert.ok(!publicYaml.includes('source_stage_id:'));assert.ok(!publicYaml.includes('background_stages:'));
 const saved=upsertEpisodeIntoSeriesCatalog(catalog,merged).document;
 assert.equal(saved.manga.background_stages.length,1);assert.equal(saved.manga.background_stages[0].id,stage.id);
});
test('モデルの差し替え・解除を台帳へ反映し、他の登録や撮影原本を壊さない',async()=>{
 const {document,stage}=await fixture();const initial=parseMangaYaml(toSeriesCatalogMangaYaml(document));
 const replacement={...stage,id:`stage-${'e'.repeat(64)}`,sha256:'e'.repeat(64),storageId:'replacement',name:'新しい仕事部屋.glb'};
 document.manga.background_stages.push(replacement);document.manga.materials[0].source_stage_id=replacement.id;
 let catalog=upsertEpisodeIntoSeriesCatalog(initial,document).document;
 assert.deepEqual(catalog.manga.background_stages.map(s=>s.id),[replacement.id]);assert.equal(document.manga.background_stages.length,2);
 document.manga.materials[0].source_stage_id=null;
 catalog=upsertEpisodeIntoSeriesCatalog(catalog,document).document;assert.equal(catalog.manga.background_stages,undefined);assert.equal(catalog.manga.materials[0].source_stage_id,null);
});
test('キャッシュ消失後はシリーズ原本を検証して再保存する。破損や欠落を成功扱いしない',async()=>{
 const {stage,blob}=await fixture();stage.seriesId='background-series';let restores=0,cached;
 const services={load:async()=>null,restore:async(seriesId,item)=>{assert.equal(seriesId,stage.seriesId);assert.equal(item.id,stage.id);restores++;return blob;},cache:async(items)=>{cached=items;}};
 assert.equal(await loadBackgroundStage(stage,services),blob);assert.equal(restores,1);assert.equal(cached[0].id,stage.storageId);
 await loadBackgroundStage(stage,{...services,load:async()=>blob});assert.equal(restores,1);
 await assert.rejects(loadBackgroundStage(stage,{...services,restore:async()=>null}),/原本/);
 await assert.rejects(loadBackgroundStage(stage,{...services,restore:async()=>new Blob(['broken'])}),/一致/);
 await assert.rejects(loadBackgroundStage(stage,{...services,load:async()=>new Blob(['broken'])}),/一致/);
});
test('シリーズ保存は未撮影の登録原本を先に保存し、失敗時は保存済み印を付けない',async()=>{
 const {document,stage,blob}=await fixture();let calls=0;
 await persistSeriesBackgroundModels(document,'background-series',{exists:async()=>false,load:async()=>blob,save:async(id,item,original)=>{assert.equal(item.seriesId,undefined);assert.equal(id,'background-series');assert.equal(original,blob);calls++;}});
 assert.equal(calls,1);assert.equal(stage.seriesId,'background-series');
 await persistSeriesBackgroundModels(document,'background-series',{exists:async()=>true,load:async()=>assert.fail(),save:async()=>assert.fail()});
 delete stage.seriesId;
 await assert.rejects(persistSeriesBackgroundModels(document,'background-series',{exists:async()=>false,load:async()=>blob,save:async()=>{throw Error('disk failure');}}),/disk failure/);assert.equal(stage.seriesId,undefined);
 document.manga.materials[0].scope='episode';await persistSeriesBackgroundModels(document,'background-series',{exists:async()=>assert.fail(),load:async()=>assert.fail(),save:async()=>assert.fail()});
});
test('背景登録だけでも作品保存に原本を含め、復元後もカードの参照を保持する',async()=>{
 const {document,stage,blob}=await fixture();const snapshot=await createProjectSnapshot(document,async id=>id===stage.storageId?blob:null);
 assert.match(stage.storageId,/^original-/);
 assert.equal(snapshot.assets.length,1);let cached;
 const restored=await restoreProjectSnapshot(snapshot,async items=>{cached=items;});
 assert.equal(restored.manga.materials[0].source_stage_id,stage.id);assert.notEqual(restored.manga.background_stages[0].storageId,stage.storageId);assert.equal(cached.length,1);assert.match(restored.manga.background_stages[0].storageId,/^original-/);
 const bad=structuredClone(document);bad.manga.materials[0].source_stage_id='stage-missing';await assert.rejects(createProjectSnapshot(bad),/背景資料/);
});

test('モデルを知らない古い作品の保存はシリーズの登録モデルを失わない',async()=>{
 const {document,stage}=await fixture();const catalog=parseMangaYaml(toSeriesCatalogMangaYaml(document)),old=structuredClone(document);
 delete old.manga.materials[0].source_stage_id;delete old.manga.background_stages;
 const saved=upsertEpisodeIntoSeriesCatalog(catalog,old).document;
 assert.equal(saved.manga.materials[0].source_stage_id,stage.id);assert.equal(saved.manga.background_stages[0].id,stage.id);
 old.manga.materials[0].source_stage_id=null;
 const detached=mergeSeriesCatalog(old,catalog).document;assert.equal(detached.manga.materials[0].source_stage_id,null);assert.equal(backgroundMaterialStages(detached).length,0);
});
test('保存先が空なら同じシリーズIDでも作品内のモデルを再保存する',async()=>{
 const {document,stage,blob}=await fixture();stage.seriesId='background-series';let writes=0;
 await persistSeriesBackgroundModels(document,'background-series',{exists:async()=>false,load:async()=>blob,save:async()=>{writes++;}});
 assert.equal(writes,1);assert.equal(stage.seriesId,'background-series');
});
