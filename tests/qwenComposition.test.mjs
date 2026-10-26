import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { buildQwenCompositionPlan, qwenCompositionLayout, qwenCompositionTextRuns, qwenPanelImageLayers } from '../src/lib/qwenComposition.ts';
import { selectHumanPose } from '../src/lib/humanPoseSelection.ts';
import { confirmHumanPoseCameraPrompt } from '../src/lib/humanPoseScene.ts';
import { panelShapePoints } from '../src/lib/canvasGeometry.ts';
import { applyArtworkSettings } from '../src/lib/artworkRules.ts';
import { parseMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createFrameArtwork } from '../src/lib/imagePlacement.ts';

test('export composition draws native OCR text independently and above visible raster layers',()=>{
 const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/analog\.referenceHidden|loadFigureCropAsset\(analog\.assetId/);
 const start=source.indexOf('if (bubble.paint_overlay && !bubble.paint_overlay.hidden)');
 assert.ok(start>=0);
 const text=source.indexOf("drawText(context, bubble, bubbleTextFrame",start);
 assert.ok(text>start);
 assert.doesNotMatch(source.slice(start,text),/guideFor/);
});

function fixture() {
  const { manga } = createEmptyWorkspaceDocument();
  Object.assign(manga.meta, { series_id: 'series', episode_id: 'episode', format: 'モノクロ漫画' });
  manga.characters = ['a', 'b', 'c', 'd'].map(key => ({ localId: key, catalog_id: `catalog-${key}`, name: `人物${key}`, visual_prompt: `${key}の服装` }));
  manga.materials = manga.characters.map(character => ({ type: 'character', key: `${character.name}資料`, characterId: character.localId, source_image: { asset_id: `sheet-${character.localId}` } }));
  const figure = key => ({ name: `人物${key}`, refId: key, size: 'bust-up', action: `${key}の表情`, bbox: { x: 20, y: 25, w: 35, h: 45 } });
  manga.pages[0].canvas = { w: 210, h: 297, unit: 'mm' };
  manga.pages[0].panels = [
    { id: 1, shape: { type: 'polygon', points: [[10, 10], [110, 20], [100, 90], [10, 80]] }, bg: 1, background_description: '窓のある室内', action: '話し合う',
      figures: [figure('a'), figure('b'), { name: '時計', kind: 'prop', bbox: { x: 10, y: 10, w: 10, h: 10 } }],
      bubbles: [{ text: '「日本語」\nそのまま！', speaker: '人物a', bbox: { x: 70, y: 20, w: 25, h: 35 }, shape: 'thought' }],
      screen_text: [{ text: 'ドン！', orientation: 'vertical', bbox: { x: 10, y: 40, w: 10, h: 20 } }] },
    { id: 2, shape: { type: 'rect', x: 10, y: 110, w: 190, h: 80 }, bg: 0, action: null, figures: [figure('b'), figure('c')], bubbles: [{ text: '二コマ目' }] },
  ];
  manga.pages[0].page_overlay = { frame: false, layer: 'above_panel_frames', figures: [figure('d')], bubbles: [{ text: '前景の台詞' }] };
  return manga;
}

test('generated composition images and their layer marker survive document save and reload',()=>{
 const doc=createEmptyWorkspaceDocument(),asset={id:'generated',storageId:'saved-generated',sha256:'a'.repeat(64),mediaType:'image/png',originalName:'result.png',widthPx:600,heightPx:900,byteLength:500};
 doc.manga.image_assets=[asset];
 doc.manga.pages[0].images=[{...createFrameArtwork(asset,{x:0,y:0,w:210,h:297}),'generationScope':'page'}];
 doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:10,w:80,h:100},bg:0,action:null,bubbles:[],images:[{...createFrameArtwork(asset,{x:10,y:10,w:80,h:100}),generationScope:'panel'}]}];
 const restored=parseMangaYaml(toStoredMangaYaml(doc));
 assert.deepEqual(restored.manga.pages[0].images,doc.manga.pages[0].images);
 assert.deepEqual(restored.manga.pages[0].panels[0].images,doc.manga.pages[0].panels[0].images);
});

test('panel and page plans have exact scope, stable character order and individual reference bindings', () => {
  const manga = fixture(), before = structuredClone(manga);
  const panel = buildQwenCompositionPlan(manga, 0, 0, 'panel');
  assert.equal(panel.scope, 'panel'); assert.equal(panel.ownerKey, 'panel'); assert.equal(panel.panelId, 1); assert.equal(panel.overlay, false);
  assert.deepEqual(panel.characterKeys, ['a', 'b']); assert.deepEqual(panel.candidates.map(candidate => candidate.characterKeys), [['a'], ['b']]);
  assert.deepEqual(panel.outputFrame, { x: 10, y: 10, w: 100, h: 80 }); assert.equal(panel.width, 1024); assert.equal(panel.height, 819);
  assert.match(panel.prompt, /Character 1「人物a」/); assert.match(panel.prompt, /Character 2「人物b」/); assert.doesNotMatch(panel.prompt, /人物c|前景の台詞/);
  const page = buildQwenCompositionPlan(manga, 0, 1, 'page');
  assert.equal(page.ownerKey, 'page'); assert.equal(page.panelId, 0); assert.deepEqual(page.characterKeys, ['a', 'b', 'c', 'd']);
  assert.deepEqual(page.candidates.map(candidate => candidate.characterKeys), [['a'], ['b'], ['c'], ['d']]);
  assert.deepEqual(page.literalText, ['「日本語」\nそのまま！', 'ドン！', '二コマ目', '前景の台詞']);
  assert.deepEqual(page.outputFrame, { x: 0, y: 0, w: 210, h: 297 }); assert.equal(page.width, 724); assert.equal(page.height, 1024);
  assert.deepEqual(manga, before);
});

test('all people get a primary reference before extra sheets fill the nine available slots', () => {
  const manga = fixture();
  for (let index = 0; index < 12; index++) manga.materials.unshift({ type: 'character', key: `追加${index}`, characterId: 'a', catalog_id: `material-${index}`, source_image: { asset_id: `extra-${index}` } });
  manga.characters[0].primary_material_catalog_id = 'material-5';
  const plan = buildQwenCompositionPlan(manga, 0, 0, 'page');
  assert.equal(plan.candidates.length, 9); assert.equal(plan.candidates[0].source.asset_id, 'extra-5');
  assert.deepEqual(plan.candidates.slice(0, 4).map(candidate => candidate.characterKeys), [['a'], ['b'], ['c'], ['d']]);
  assert.ok(plan.candidates.every(candidate => candidate.characterKeys.length === 1));
});

test('reference identity never falls back to names or to a conflicting local character binding', () => {
  const manga = fixture();
  manga.materials.unshift({ type: 'character', key: '紛らわしい資料', characterId: 'c', character_catalog_id: 'catalog-a', source_image: { asset_id: 'wrong' } });
  manga.materials.push({ type: 'character', key: '旧形式のa資料', character_catalog_id: 'catalog-a', source_image: { asset_id: 'legacy-a' } });
  const plan = buildQwenCompositionPlan(manga, 0, 0, 'panel');
  assert.ok(!plan.candidates.some(candidate => candidate.source.asset_id === 'wrong'));
  assert.deepEqual(plan.candidates.find(candidate => candidate.source.asset_id === 'legacy-a').characterKeys, ['a']);
  delete manga.pages[0].panels[0].figures[0].refId;
  manga.characters.push({ name: '人物a', catalog_id: 'unnamed-id' });
  assert.throws(() => buildQwenCompositionPlan(manga, 0, 0, 'panel'), /登場人物を指定/);
});

test('missing registered sources or catalog binding and too many people fail explicitly', () => {
  for (const change of [manga => { manga.materials = []; }, manga => { delete manga.characters[0].catalog_id; }, manga => { manga.materials[0].source_image = {}; }]) {
    const manga = fixture(); change(manga); assert.throws(() => buildQwenCompositionPlan(manga, 0, 0, 'panel'), /資料/);
  }
  const manga = fixture();
  for (let index = 0; index < 8; index++) { const key = `extra-${index}`; manga.characters.push({ localId: key, catalog_id: key, name: key }); manga.pages[0].panels[0].figures.push({ refId: key, name: key }); }
  assert.throws(() => buildQwenCompositionPlan(manga, 0, 0, 'panel'), /9人以下/);
});

test('composition snapshot preserves polygon, positions, order and text while excluding generated whole-image results', () => {
  const manga = fixture(), panel = manga.pages[0].panels[0];
  const image = (id, generationScope) => ({ id, generationScope, assetId: id, bbox: { x: 14, y: 20, w: 25, h: 40 }, opacity: 1, crop: { x: 0, y: 0, w: 25, h: 40 }, hidden: false, locked: false });
  panel.images = [image('user-image'), image('old-panel', 'panel')]; panel.background_images = [image('user-background'), image('old-page', 'page')];
  manga.pages[0].images = [image('user-page'), image('old-full', 'page')];
  delete manga.pages[0].page_overlay.figures[0].bbox;
  const before = structuredClone(manga), layout = qwenCompositionLayout(manga, 0, 0, 'page');
  assert.deepEqual(panelShapePoints(layout.panels[0].panel), panel.shape.points);
  assert.deepEqual(layout.panels[0].panel.images.map(image => image.id), ['user-image']);
  assert.deepEqual(layout.panels[0].panel.background_images.map(image => image.id), ['user-background']);
  assert.deepEqual(layout.images.map(image => image.id), ['user-page']);
  const exportLayout=qwenCompositionLayout(manga,0,0,'page',true);
  assert.deepEqual(exportLayout.panels[0].panel.images.map(image=>image.id),['user-image','old-panel']);
  assert.deepEqual(exportLayout.panels[0].panel.background_images.map(image=>image.id),['user-background','old-page']);
  assert.deepEqual(exportLayout.images.map(image=>image.id),['user-page','old-full']);
  assert.equal(layout.panels[2].overlay, true); assert.ok(layout.panels[2].panel.figures[0].bbox.w > 0);
  assert.equal(layout.panels[0].panel.bubbles[0].text, panel.bubbles[0].text);
  layout.panels[0].panel.figures[0].bbox.x = 999; assert.deepEqual(manga, before);
});

test('page direct drawing is composited above panel frames and below foreground figures and bubbles',()=>{
  const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
  const ordinary=source.indexOf("layout.images.filter(image=>!image.paintScope&&!image.bubbleOriginal&&!image.generationScope)");
  const frames=source.indexOf("panelFrameVisible(entry.panel)");
  const direct=source.indexOf("layout.images.filter(image=>image.paintScope==='page')");
  const overlay=source.indexOf("layout.panels.filter(entry => entry.overlay)");
  const bubbles=source.indexOf("for (const entry of layout.panels) {",direct);
  assert.ok(ordinary>0&&ordinary<frames&&frames<direct&&direct<overlay&&overlay<bubbles);
});

test('panel direct drawing stays above ordinary images and below screen text regardless of storage order',()=>{
  const image=(id,paintScope)=>({id,paintScope,assetId:id,bbox:{x:0,y:0,w:10,h:10},opacity:1,crop:{x:0,y:0,w:10,h:10},hidden:false,locked:false});
  const layers=qwenPanelImageLayers([image('direct-a','panel'),image('ordinary-a'),{...image('generated'),generationScope:'panel'},image('wrong-scope','page'),image('ordinary-b'),image('direct-b','panel')]);
  assert.deepEqual(layers.ordinary.map(item=>item.id),['ordinary-a','ordinary-b']);
  assert.deepEqual(layers.direct.map(item=>item.id),['direct-a','direct-b']);
  assert.deepEqual(layers.generated.map(item=>item.id),['generated']);
  const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
  const ordinary=source.indexOf('await drawImages(imageLayers.ordinary)');
  const direct=source.indexOf('await drawImages(imageLayers.direct)');
  const screenText=source.indexOf('entry.panel.screen_text',direct);
  assert.ok(ordinary>0&&ordinary<direct&&direct<screenText);
});

test('completed compositions cover editable text and frames but remain below original crops',()=>{
  const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
  const overlayText=source.indexOf("overlayTextFallbackBox(layout.frame, index)");
  const bubbles=source.indexOf('const SVG_NS');
  const generated=source.indexOf('await drawImages(qwenPanelImageLayers(entry.panel.images).generated)');
  const original=source.indexOf('Original crops are independent topmost');
  assert.ok(overlayText>0&&overlayText<bubbles&&bubbles<generated&&generated<original);
  assert.match(source,/dpi = canvas\.width \/ frame\.w \* 25\.4/);
});

test('hidden panels and bubbles do not enter page literals, while invalid selection and dimensions fail', () => {
  const manga = fixture(); manga.pages[0].panels[1].layer = { hidden: true }; manga.pages[0].panels[0].bubbles[0].hidden = true;
  const plan = buildQwenCompositionPlan(manga, 0, 0, 'page');
  assert.deepEqual(plan.characterKeys, ['a', 'b', 'd']); assert.deepEqual(plan.literalText, ['ドン！', '前景の台詞']);
  assert.throws(() => qwenCompositionLayout(manga, 0, 1, 'panel'), /非表示/);
  assert.throws(() => qwenCompositionLayout(manga, 9, 0, 'page'), /見つかりません/);
  assert.throws(() => qwenCompositionLayout(manga, 0, 9, 'panel'), /見つかりません/);
  manga.pages[0].canvas.w = 0; assert.throws(() => qwenCompositionLayout(manga, 0, 0, 'page'), /範囲が不正/);
});

test('integrated artwork settings, backgrounds, exact text and Unicode emphasis survive planning', () => {
  const manga = fixture();
  applyArtworkSettings(manga, { version: 1, groups: [{ id: 'common', label: '共通', scope: 'common', enabled: true }, { id: 'full', label: '全体', scope: 'integrated', enabled: true }],
    fragments: [{ groupId: 'common', kind: 'style', text: '独自の線の指定' }, { groupId: 'full', kind: 'layout', text: '独自のページ指定' }] });
  const plan = buildQwenCompositionPlan(manga, 0, 0, 'panel');
  for (const text of ['独自の線の指定', '独自のページ指定', '窓のある室内', 'ドン！', 'aの表情', 'aの服装']) assert.ok(plan.prompt.includes(text), text);
  for (const literal of plan.literalText) assert.ok(plan.prompt.includes(literal), literal);
  const item = { text: 'A𠮷\n句読点。', text_weights: [{ start: 1, end: 3, fontWeight: 800 }] };
  const runs = qwenCompositionTextRuns(item); assert.equal(runs.map(run => run.text).join(''), item.text);
  assert.deepEqual(runs[1], { text: '𠮷', fontWeight: 800 }); assert.equal(runs[2].text, '\n');
});

test('hidden figures are omitted from identity and instructions unless their original guide is visible', () => {
  const manga = fixture();
  manga.pages[0].panels[0].figures[1].artwork = { hidden: true };
  manga.pages[0].page_overlay.figures[0].artwork = { hidden: true };
  let plan = buildQwenCompositionPlan(manga, 0, 0, 'panel');
  assert.deepEqual(plan.characterKeys, ['a']); assert.doesNotMatch(plan.prompt, /bの表情|bの服装/);
  plan = buildQwenCompositionPlan(manga, 0, 0, 'panel', { '0:figure-1': true });
  assert.deepEqual(plan.characterKeys, ['a', 'b']); assert.match(plan.prompt, /bの表情/);
  plan = buildQwenCompositionPlan(manga, 0, 0, 'page'); assert.deepEqual(plan.characterKeys, ['a', 'b', 'c']);
  plan = buildQwenCompositionPlan(manga, 0, 0, 'page', { 'overlay:figure-0': true }); assert.deepEqual(plan.characterKeys, ['a', 'b', 'c', 'd']);
});

test('3D image pose preserves the image crop without adding conflicting drawing-range words', () => {
  const manga = fixture(), figure = manga.pages[0].panels[0].figures[0], digest = 'a'.repeat(64);
  const row = JSON.parse(readFileSync(new URL('../scripts/human_pose/data/curated-standing.json', import.meta.url)))[0];
  figure.human_pose = selectHumanPose({ ...row, template_revision: 1, production_status: 'ready', review: { status: 'confirmed', user_confirmed: true },
    asset_files: { preview: {} }, prompt_segments: [{ id: 'pose', text_ja: row.pose_text_ja, template_en: row.pose_template }] }, digest);
  Object.assign(figure.human_pose, { input_mode: 'image', edited_text_ja: '古いポーズ文', scene: { version: 1,
    source: { base_sha256: digest, rig_sha256: digest, pose_sha256: digest, rig_signature: digest, pose_revision: 1 },
    placement: { position: [0, 0, 0], yaw_degrees: 0 }, camera: { position: [3, 2, 5], target: [0, 1, 0], fov: 40 }, projection: 'perspective', up: [0, 1, 0], frame: { width: 512, height: 1024 } } });
  figure.human_pose.camera_prompt = confirmHumanPoseCameraPrompt(figure.human_pose.scene, { centre: [0, 1, 0], world_facing_degrees: 0 });
  manga.pages[0].panels[0].figures[1].size = 'full';
  let plan = buildQwenCompositionPlan(manga, 0, 0, 'panel');
  assert.match(plan.prompt, /3Dポーズの姿勢・視点・切り取り/); assert.doesNotMatch(plan.prompt, /胸から上|古いポーズ文/);
  figure.human_pose.input_mode = 'prompt'; plan = buildQwenCompositionPlan(manga, 0, 0, 'panel');
  assert.match(plan.prompt, /描写範囲は胸から上/); assert.match(plan.prompt, /古いポーズ文/);
});
