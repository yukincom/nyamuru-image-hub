import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {bubbleStrokeWidthMm,bubbleUsesMonologueTail,isBalloonText} from '../src/lib/bubblePresentation.ts';
import {changeCanvasTextCategory} from '../src/lib/canvasText.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { buildQwenCompositionPlan, qwenCompositionLayout, qwenCompositionTextRuns, qwenPanelImageLayers } from '../src/lib/qwenComposition.ts';
import { selectHumanPose } from '../src/lib/humanPoseSelection.ts';
import { confirmHumanPoseCameraPrompt } from '../src/lib/humanPoseScene.ts';
import { panelShapePoints } from '../src/lib/canvasGeometry.ts';
import { applyArtworkSettings } from '../src/lib/artworkRules.ts';
import { parseMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createFrameArtwork } from '../src/lib/imagePlacement.ts';
import {textStyleOf} from '../src/lib/textStyle.ts';
import {bubbleCssFontFamily} from '../src/lib/bubbleFonts.ts';
import {bubbleTextPosition} from '../src/lib/bubbleClip.ts';
import {bubbleArtIndices} from '../src/lib/panelLayers.ts';
import {letteringFigureIndex} from '../src/lib/bubbleRelations.ts';

function compositionTextRenderer(){
 const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('qwenComposition.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='drawText');assert.ok(declaration);
 return runInNewContext(ts.transpileModule(`(${declaration.getText(ast)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{textStyleOf,bubbleCssFontFamily,bubbleTextPosition,qwenCompositionTextRuns,isBalloonText});
}

test('描き文字の対応キャラクターをコマと前景の指示へ渡し、対応なしも区別する',()=>{
 const {manga}=createEmptyWorkspaceDocument();manga.characters=[{localId:'aki',name:'アキ'}];
 manga.pages[0].panels=[{id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[{text:'かぁぁ',shape:'handwritten',speakerId:'aki',speaker:'古い名前',lettering_depth:'behind'}]}];
 manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'ドン',shape:'handwritten'},{text:'ふわっ',shape:'handwritten',speaker:'アキ'}]};
 const before=structuredClone(manga),plan=buildQwenCompositionPlan(manga,0,0,'page');
 assert.match(plan.prompt,/描き文字、対応キャラクター：アキ）：「かぁぁ」/);
 assert.match(plan.prompt,/描き文字、対応キャラクター：なし）：「ドン」/);
 assert.match(plan.prompt,/描き文字、対応キャラクター：アキ）：「ふわっ」/);
 assert.match(plan.prompt,/発話やしっぽを意味しない/);assert.doesNotMatch(plan.prompt,/古い名前/);
 assert.match(plan.prompt,/対応キャラクター「アキ」の後ろに配置し、重なる部分は人物が文字を隠す/);
 assert.match(plan.prompt,/対応キャラクター「アキ」の手前に配置し、重なる部分は文字を人物より手前に見せる/);
 assert.deepEqual(plan.literalText,['かぁぁ','ドン','ふわっ']);assert.deepEqual(manga,before);
});

test('写植の個別書体と既定書体・部分装飾をコマと前景の生成指示へ渡す',()=>{
 const {manga}=createEmptyWorkspaceDocument();manga.meta.font='Noto Serif JP';
 const text={text:'A😀B',text_style:{font:'Yu Gothic',fontSize:24,fontWeight:700,orientation:'horizontal',textAlign:'center',underline:true},text_runs:[{start:1,end:3,fontWeight:400,italic:true,underline:false}]};
 const panel={id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[{...text,shape:'typeset'}],screen_text:[{text:'既定の書体',orientation:'vertical'}]};
 manga.pages[0].panels=[panel];
 manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景の写植',shape:'typeset'}],screen_text:[{...structuredClone(text),orientation:'horizontal'}]};
 const before=structuredClone(manga);
 for(const scope of ['panel','page']){
  const plan=buildQwenCompositionPlan(manga,0,0,scope);
  const formats=[...plan.prompt.matchAll(/写植の書式：(\{[^\n]*\})。参照画像/g)].map(match=>JSON.parse(match[1]));
  assert.equal(formats.length,scope==='page'?4:2);
  const explicit=formats[0];assert.equal(explicit.font,'Yu Gothic');assert.equal(explicit.fontSizePt,24);assert.equal(explicit.orientation,'horizontal');assert.equal(explicit.textAlign,'center');
  assert.deepEqual(explicit.ranges[1],{start:1,end:3,fontWeight:400,italic:true,underline:false,strikethrough:false});
  assert.equal(formats[1].font,'Noto Serif JP');assert.equal(formats[1].fontSizePt,12);assert.equal(formats[1].orientation,'vertical');
  if(scope==='page'){assert.equal(formats[2].font,'Noto Serif JP');assert.equal(formats[2].fontSizePt,15);assert.equal(formats[3].font,'Yu Gothic');}
  assert.deepEqual(plan.literalText,scope==='page'?['A😀B','既定の書体','前景の写植','A😀B']:['A😀B','既定の書体']);
 }
 assert.deepEqual(manga,before);
});

test('画像合成の行揃えは短い行だけを送り、文字群のアンカー・改行・下線を保持する',()=>{
 const draw=compositionTextRenderer();
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
 for(const orientation of ['horizontal','vertical'])for(const kind of ['bubble','screen_text']){
  const captures=[];
  for(const textAlign of ['left','center','right']){
   const glyphs=[],strokes=[],context={canvas:{width:1000,height:1000},save(){},restore(){},measureText:letter=>({width:{A:11,B:13,C:7,D:9}[letter]}),fillText:(text,x,y)=>glyphs.push({text,x,y}),beginPath(){},moveTo:(x,y)=>strokes.push({x,y}),lineTo(){},stroke(){}};
   draw(context,{text:'AABB\nCC\n\nD',text_position:{x:.3,y:.7},text_style:{orientation,textAlign,fontSize:12},text_runs:[{start:5,end:7,underline:true}]},{x:10,y:20,w:70,h:70},{x:0,y:0,w:100,h:100},kind,'serif');
   assert.equal(glyphs.map(glyph=>glyph.text).join(''),'AABBCCD');captures.push({glyphs,strokes});
  }
  const axis=orientation==='horizontal'?'x':'y',cross=axis==='x'?'y':'x',size=12*25.4/72*10,difference=orientation==='horizontal'?34:2*size;
  for(const [index,factor] of [[1,.5],[2,1]]){
   close(captures[index].glyphs[0][axis],captures[0].glyphs[0][axis]);close(captures[index].glyphs[0][cross],captures[0].glyphs[0][cross]);
   close(captures[index].glyphs[4][axis]-captures[0].glyphs[4][axis],difference*factor);close(captures[index].glyphs[4][cross],captures[0].glyphs[4][cross]);
   close(captures[index].strokes[0][axis]-captures[0].strokes[0][axis],difference*factor);
  }
 }
});

test('種類を切り替えた写植文字と描き文字は狭いbboxでも明示改行と空行を保つ',()=>{
 const draw=compositionTextRenderer();
 for(const orientation of ['horizontal','vertical']){
  const document=createEmptyWorkspaceDocument(),panel={id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[]};
  document.manga.pages[0].panels=[panel];
  panel.screen_text=[{text:'ABCDE\n\nFG',bbox:{x:10,y:10,w:10,h:10},text_style:{orientation,fontSize:12}}];
  let target={pageIndex:0,panelIndex:0,index:0,kind:'screen_text',overlay:false};
  for(const category of ['handwritten','typeset']){
   target=changeCanvasTextCategory(document,target,category);assert.ok(target);
   const bubble=panel.bubbles[target.index],glyphs=[],context={canvas:{width:1000,height:1000},save(){},restore(){},measureText:()=>({width:30}),fillText:(text,x,y)=>glyphs.push({text,x,y})};
   draw(context,bubble,bubble.bbox,{x:0,y:0,w:100,h:100},'bubble','serif');
   const cross=orientation==='horizontal'?'y':'x';
   assert.equal(glyphs.map(g=>g.text).join(''),'ABCDEFG');
   assert.ok(glyphs.slice(0,5).every(g=>g[cross]===glyphs[0][cross]),`${orientation}/${category}: 勝手に折り返さない`);
   assert.equal(glyphs[5][cross],glyphs[6][cross]);
   const expected=2*12*25.4/72*10*1.15;
   assert.ok(Math.abs(Math.abs(glyphs[5][cross]-glyphs[0][cross])-expected)<1e-8,'空行の送りを保つ');
  }
 }
});

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

test('panel bubbles precede frames, page direct drawing and foreground bubbles',()=>{
  const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
  const ordinary=source.indexOf("layout.images.filter(image=>!image.paintScope&&!image.bubbleOriginal&&!image.generationScope)");
  const localBubbles=source.indexOf('await drawBubbles(entry)',ordinary);
  const frames=source.indexOf("panelFrameVisible(entry.panel)");
  const direct=source.indexOf("layout.images.filter(image=>image.paintScope==='page')");
  const overlay=source.indexOf("layout.panels.filter(entry => entry.overlay)");
  const frontBubbles=source.indexOf('await drawBubbles(entry)',overlay);
  assert.ok(ordinary>0&&ordinary<localBubbles&&localBubbles<frames&&frames<direct&&direct<overlay&&overlay<frontBubbles);
  assert.equal(source.match(/await drawBubbles\(entry\)/g)?.length,2,'each scope uses the shared bubble renderer once');
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

test('completed compositions cover native bubble folders and remain below unlinked original crops',()=>{
  const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
  const overlayText=source.indexOf("overlayTextFallbackBox(layout.frame, index)");
  const bubbles=source.indexOf('await drawBubbles(entry)',overlayText);
  const generated=source.indexOf('await drawImages(qwenPanelImageLayers(entry.panel.images).generated)');
  const original=source.indexOf('await drawImages((entry.panel.images??[]).filter(image=>image.bubbleOriginal&&!entry.panel.bubbles.some');
  assert.ok(overlayText>0&&overlayText<bubbles&&bubbles<generated&&generated<original);
  assert.match(source,/await drawImages\(\(panel.images\?\?\[\]\).filter\(image=>image.id===bubble.analogTextImport\?\.originalImageId\)\)/);
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
  const item = { text: 'A𠮷\n句読点。', text_runs: [{ start: 1, end: 3, fontWeight: 800 }] };
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


test('hidden panel and overlay text are omitted from generation literal text',()=>{
 const manga=fixture();manga.pages[0].panels[0].screen_text[0].hidden=true;
 manga.pages[0].page_overlay.screen_text=[{text:'隠した前景文字',hidden:true},{text:'見える前景文字'}];
 const plan=buildQwenCompositionPlan(manga,0,0,'page');
 assert.ok(!plan.literalText.includes('ドン！'));assert.ok(!plan.literalText.includes('隠した前景文字'));assert.ok(plan.literalText.includes('見える前景文字'));
});

// Inspect the SVG sent to the rasterizer by the real per-owner export routine.
test('composition export uses each bubble width for its body, thought tail and join',async()=>{
 const source=readFileSync(new URL('../src/lib/qwenComposition.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('qwenComposition.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='drawBubbles')body=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(body);
 class Element {
  constructor(name,attrs={}){this.name=name;this.attrs={...attrs};this.childNodes=[];}
  setAttribute(key,value){this.attrs[key]=String(value);}
  append(...children){for(const child of children){child.parent=this;this.childNodes.push(child);}}
  remove(){if(this.parent)this.parent.childNodes=this.parent.childNodes.filter(node=>node!==this);}
  cloneNode(){const copy=new Element(this.name,this.attrs);copy.append(...this.childNodes.map(child=>child.cloneNode()));return copy;}
  querySelector(){return this.childNodes.find(node=>node.name==='svg');}
  querySelectorAll(selector){const classes=selector.split(',').map(value=>value.trim().slice(1));return this.childNodes.filter(node=>classes.includes(node.attrs.class));}
  toJSON(){return {name:this.name,attrs:this.attrs,children:this.childNodes};}
 }
 for(const overlay of [false,true]){
  const captured=[],manga={meta:{bubble_line_width_mm:.7}};
  const panel={shape:{type:'rect',x:0,y:0,w:100,h:100},figures:[{bbox:{x:5,y:5,w:10,h:10}}],bubbles:[
   {text:'思考',shape:'thought',line_width_mm:.2,bbox:{x:10,y:10,w:20,h:20}},
   {text:'結合',shape:'normal',join_to:1,line_width_mm:1.4,bbox:{x:40,y:10,w:20,h:20}},
   {text:'既定',shape:'normal',bbox:{x:70,y:10,w:20,h:20}},
  ]};
  const context={manga,canvas:{width:1000,height:1000},frame:{x:0,y:0,w:100,h:100},bubbleStrokeWidthMm,bubbleUsesMonologueTail,letteringGuideVisible:()=>true,SVG_NS:'http://www.w3.org/2000/svg',
   document:{createElement:name=>new Element(name)},svgElement:(name,attrs)=>new Element(name,attrs),panelShapePoints,paintReferenceBox:(_paint,box)=>box,
   bubbleVisible:()=>true,resolveBubbleSpeakerFigureIndex:()=>0,compatibleBubbleClips:()=>true,bubbleArtIndices,letteringFigureIndex,
   tail:{bubbleTailDisabled:()=>false,bubbleTailTargetPoint:()=>({x:5,y:5}),monologueTailEllipses:()=>[{cx:12,cy:12,rx:2,ry:3}],bubbleTailComposite:()=>null,bubbleJoinGeometry:()=>({firstSeamMask:{},secondSeamMask:{},fillPath:'fill',outlinePaths:['join']})},
   context:{save(){},restore(){},clip(){},drawImage(){}},outline(){},drawImages:async()=>{},drawText(){},bubbleTextFrame:box=>box,
   BubbleShapeSvg:'BubbleShapeSvg',h:(type,props)=>({type,props}),render:(node,host)=>{if(!node){host.childNodes=[];return;}const svg=new Element('svg');svg.append(new Element('path',{class:'bubble-svg-surface'}),new Element('path',{class:'bubble-svg-outline-surface'}),new Element('path',{class:'bubble-svg-detail'}));host.append(svg);},
   Blob,XMLSerializer:class {serializeToString(svg){return JSON.stringify(svg);}},decodePaintImage:async blob=>{captured.push(JSON.parse(await blob.text()));return {src:''};},
  };
  const draw=runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  await draw({panel,panelIndex:0,overlay});assert.equal(captured.length,3);
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  for(const [index,width] of [.7,1.4,.2].entries()){
   const outlines=descendants(captured[index]).filter(node=>['bubble-svg-outline-surface','bubble-svg-detail'].includes(node.attrs.class));
   assert.equal(outlines.length,2);assert.ok(outlines.every(node=>Number(node.attrs['stroke-width'])===width*10));
  }
  const bead=descendants(captured[2]).find(node=>node.name==='ellipse');assert.equal(bead.attrs['stroke-width'],.2);
  const join=descendants(captured[1]).find(node=>node.attrs.d==='join');assert.equal(join.attrs['stroke-width'],1.4);
 }
});
