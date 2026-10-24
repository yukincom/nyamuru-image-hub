import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {parseMangaYaml,toMangaYaml,toStoredMangaYaml,validateManga} from '../src/lib/manga.ts';
import {editCanvasBubbleMaterial,editCanvasText,editCanvasTextStyle} from '../src/lib/canvasText.ts';
import {BUBBLE_MATERIALS} from '../src/lib/bubblePresetData.ts';
import {textStyleCss,validTextWeights,textWeightSegments,selectedTextWeight} from '../src/lib/textStyle.ts';
const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
function fixture(){const d=createEmptyWorkspaceDocument();d.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:20,w:180,h:240},bg:0,bubbles:[{
  text:'今日は\n元気だよ。',shape:'normal',speaker:'A',monologue:true,bbox:{x:70,y:25,w:48,h:60},tail:{x:.3,y:.7},clip_to_panel:true,
  text_style:{font:'游明朝',fontSize:13,fontWeight:500},text_weights:[{start:4,end:6,fontWeight:800}],
}]}];return d;}
test('all 38 dropped materials replace only the outline; one native bubble remains',()=>{
  for(const preset of BUBBLE_MATERIALS){
    const d=fixture(),old=structuredClone(d.manga.pages[0].panels[0].bubbles[0]);
    assert.equal(editCanvasBubbleMaterial(d,target,preset.id),true);
    const bubbles=d.manga.pages[0].panels[0].bubbles;assert.equal(bubbles.length,1);
    assert.deepEqual(bubbles[0].bezier,preset.bezier);delete bubbles[0].bezier;assert.deepEqual(bubbles[0],old);
  }
});
test('native text styling and material geometry survive stored and exported OMNY round trips',()=>{
  const d=fixture();editCanvasBubbleMaterial(d,target,'nomal_03');
  editCanvasTextStyle(d,target,{fontSize:16,fontWeight:700});
  editCanvasTextStyle(d,target,{fontWeight:900},{start:4,end:6});
  const b=d.manga.pages[0].panels[0].bubbles[0];
  assert.equal(b.text_style.fontSize,16);assert.equal(b.text_style.fontWeight,700);assert.equal(b.text_weights[0].fontWeight,900);
  for(const serialize of [toMangaYaml,toStoredMangaYaml]){
    const r=parseMangaYaml(serialize(d)).manga.pages[0].panels[0].bubbles[0];
    for(const key of ['text','text_style','text_weights','bbox','bezier','tail','clip_to_panel'])assert.deepEqual(r[key],b[key]);
  }
  assert.equal(validateManga(d).filter(i=>/text_style|text_weights/.test(i.path)).length,0);
});
test('text edits rebase unchanged styles while replacement characters do not inherit unrelated weights',()=>{
  const d=fixture();editCanvasText(d,target,'今日は\nとても元気だよ。');
  const b=d.manga.pages[0].panels[0].bubbles[0];assert.deepEqual(b.text_weights,[{start:7,end:9,fontWeight:800}]);
  editCanvasText(d,target,'今日は\nとても平気だよ。');assert.deepEqual(b.text_weights,[{start:8,end:9,fontWeight:800}]);
  assert.equal(textWeightSegments(b).map(s=>s.text).join(''),b.text);
});
test('size is never chosen by material replacement or weight-only edits',()=>{
  const d=fixture(),b=d.manga.pages[0].panels[0].bubbles[0],box=structuredClone(b.bbox);
  delete b.text_style.fontSize;editCanvasTextStyle(d,target,{fontWeight:800});editCanvasBubbleMaterial(d,target,'tense_02');
  assert.equal(b.text_style.fontSize,undefined);assert.deepEqual(b.bbox,box);
  const css=textStyleCss({fontSize:12},210);assert.ok(Math.abs(parseFloat(css.fontSize)-12*25.4/72/210*100)<1e-9);
});
test('hidden/locked targets, unknown materials, invalid sizes and split surrogate ranges are rejected',()=>{
  const d=fixture(),b=d.manga.pages[0].panels[0].bubbles[0];
  assert.throws(()=>editCanvasBubbleMaterial(d,target,'missing'));assert.throws(()=>editCanvasTextStyle(d,target,{fontSize:0}));
  b.hidden=true;assert.equal(editCanvasBubbleMaterial(d,target,'nomal_01'),false);assert.equal(editCanvasTextStyle(d,target,{fontSize:20}),false);
  delete b.hidden;b.paint_overlay={locked:true};assert.equal(editCanvasText(d,target,'bad'),false);
  assert.equal(validTextWeights([{start:1,end:2,fontWeight:700}],'🐱'),false);
  assert.equal(validTextWeights([{start:0,end:2,fontWeight:700}],'🐱'),true);
});

test('editing offsets preserve emphasis when repeated characters make full-text diff ambiguous',()=>{
  const d=fixture(),b=d.manga.pages[0].panels[0].bubbles[0];b.text='同同';b.text_weights=[{start:0,end:1,fontWeight:800}];
  editCanvasText(d,target,'同同同',{start:0,end:0});assert.deepEqual(b.text_weights,[{start:1,end:2,fontWeight:800}]);
  editCanvasTextStyle(d,target,{fontSize:18,orientation:'horizontal'});assert.deepEqual(b.text_weights,[{start:1,end:2,fontWeight:800}]);
  editCanvasText(d,target,'同同',{start:0,end:1});assert.deepEqual(b.text_weights,[{start:0,end:1,fontWeight:800}]);
});

test('page-foreground and screen text preserve line breaks and partial weights in both OMNY forms',()=>{
  const d=fixture(),sample=structuredClone(d.manga.pages[0].panels[0].bubbles[0]);
  d.manga.pages[0].page_overlay={bubbles:[sample]};
  d.manga.pages[0].panels[0].screen_text=[{text:sample.text,text_style:sample.text_style,text_weights:sample.text_weights,orientation:'horizontal'}];
  for(const t of [{...target,overlay:true},{...target,kind:'screen_text'}]){
    editCanvasTextStyle(d,t,{fontSize:18});editCanvasText(d,t,'今日は\n元気だよ！');
  }
  for(const serialize of [toMangaYaml,toStoredMangaYaml]){
    const r=parseMangaYaml(serialize(d)).manga.pages[0];
    for(const b of [r.page_overlay.bubbles[0],r.panels[0].screen_text[0]]){assert.equal(b.text,'今日は\n元気だよ！');assert.equal(b.text_style.fontSize,18);assert.deepEqual(b.text_weights,[{start:4,end:6,fontWeight:800}]);}
  }
  assert.equal(selectedTextWeight(sample,{start:4,end:6}),800);
  assert.equal(selectedTextWeight(sample,{start:0,end:6}),null);
});
