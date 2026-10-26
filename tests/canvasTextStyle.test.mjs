import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {parseMangaYaml,toMangaYaml,toSeparatedMangaYaml,toStoredMangaYaml,validateManga} from '../src/lib/manga.ts';
import {changeCanvasDefaultFont,editCanvasBubbleMaterial,editCanvasText,editCanvasTextStyle} from '../src/lib/canvasText.ts';
import {BUBBLE_MATERIALS} from '../src/lib/bubblePresetData.ts';
import {canvasLengthCss,textToolCursor,textStyleCss,textStyleOf,validTextWeights,textWeightSegments,selectedTextWeight} from '../src/lib/textStyle.ts';
import {pixelZoomWidth} from '../src/lib/canvasZoom.ts';
import {paintReferenceBox} from '../src/lib/paintDocument.ts';
import {readFileSync} from 'node:fs';
function cssLengthAtWidth(css,width){
  const match=/^calc\(var\(--canvas-layout-width, [\d.]+px\) \* ([\d.e+-]+)\)$/.exec(css);
  assert.ok(match,`legacy-compatible px expression: ${css}`);return width*Number(match[1]);
}
const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};

test('OCR text styles and body change independently of original raster eyes, locks and source metadata',()=>{
  for(const visible of [false,true])for(const overlay of [false,true]){
    const d=fixture(),bubble=d.manga.pages[0].panels[0].bubbles[0];
    bubble.analogTextImport={assetId:'source',sourceRegionId:'region',needsReview:true,referenceHidden:false};
    bubble.paint_overlay={hidden:false,locked:false,paint:{guideInitialized:true,layers:[{id:'original',kind:'raster',visible,locked:true,opacity:.65,image:{assetId:'scan'},strokes:[]}]}};
    const raster=structuredClone(bubble.paint_overlay);
    if(overlay){d.manga.pages[0].page_overlay={bubbles:[bubble]};d.manga.pages[0].panels[0].bubbles=[];}
    assert.equal(editCanvasTextStyle(d,{...target,overlay},{fontSize:40}),true);
    assert.equal(bubble.text_style.fontSize,40);
    assert.equal(editCanvasText(d,{...target,overlay},'修正後の本文'),true);
    assert.equal(bubble.text,'修正後の本文');
    assert.deepEqual(bubble.paint_overlay,raster);
    assert.equal(bubble.analogTextImport.referenceHidden,false);
    assert.equal(bubble.analogTextImport.needsReview,false);
  }
});
function fixture(){const d=createEmptyWorkspaceDocument();d.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:20,w:180,h:240},bg:0,bubbles:[{
  text:'今日は\n元気だよ。',shape:'normal',speaker:'A',monologue:true,bbox:{x:70,y:25,w:48,h:60},tail:{x:.3,y:.7},tail_root:{x:.2,y:.5},text_position:{x:.25,y:.7},clip_to_panel:true,
  text_style:{font:'游明朝',fontSize:13,fontWeight:500},text_weights:[{start:4,end:6,fontWeight:800}],
}]}];return d;}
test('all 45 dropped materials, including the seven author clouds, replace only the outline; one native bubble remains',()=>{
  assert.equal(BUBBLE_MATERIALS.length,45);
  assert.equal(BUBBLE_MATERIALS[0].id,'kumo_01');
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
  assert.equal(b.emphasis,'元気');
  for(const serialize of [toMangaYaml,toSeparatedMangaYaml,toStoredMangaYaml]){
    const r=parseMangaYaml(serialize(d)).manga.pages[0].panels[0].bubbles[0];
    for(const key of ['text','text_style','text_weights','emphasis','bbox','bezier','tail','tail_root','text_position','clip_to_panel'])assert.deepEqual(r[key],b[key]);
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
  const css=textStyleCss({fontSize:12},210);assert.ok(Math.abs(cssLengthAtWidth(css.fontSize,210)-12*25.4/72)<1e-9);
});
test('legacy text without an authored size still renders at a physical point size',()=>{
  assert.equal(textStyleOf({text:'旧吹き出し'},'bubble').fontSize,15);
  assert.equal(textStyleOf({text:'旧通常文字',orientation:'vertical'},'screen_text').fontSize,12);
  const narrow=cssLengthAtWidth(textStyleCss(textStyleOf({text:'旧吹き出し'},'bubble'),148).fontSize,600);
  const wide=cssLengthAtWidth(textStyleCss(textStyleOf({text:'旧吹き出し'},'bubble'),296).fontSize,600);
  assert.ok(Math.abs(narrow/wide-2)<1e-9,'same physical point size scales inversely with paper width');
});
test('4pt and 20pt draw fivefold at every DPI, DPR and zoom without container-query units',()=>{
  for(const widthMm of [148,182,210,297])for(const dpi of [300,600])for(const dpr of [1,2])for(const zoom of [.08,.5,1,2]){
    const base=pixelZoomWidth(widthMm*dpi/25.4,dpr);
    const px=size=>cssLengthAtWidth(textStyleCss({fontSize:size},widthMm).fontSize,base)*zoom;
    assert.ok(Math.abs(px(20)/px(4)-5)<1e-10);
    assert.ok(Math.abs(px(20)-20*dpi/72/dpr*zoom)<1e-10);
    assert.ok(Math.abs(cssLengthAtWidth(canvasLengthCss(.8,widthMm),base)*zoom-.8*dpi/25.4/dpr*zoom)<1e-10);
  }
});
test('the cursor follows the same effective writing direction as selected and new text',()=>{
  assert.equal(textToolCursor({orientation:'vertical'}),'vertical-text');
  assert.equal(textToolCursor({orientation:'horizontal'}),'text');
  for(const kind of ['bubble','screen_text'])for(const orientation of ['vertical','horizontal']){
    const style=textStyleOf({text:'方向',text_style:{orientation},...(kind==='screen_text'?{orientation}:{})},kind);
    assert.equal(textToolCursor(style),orientation==='vertical'?'vertical-text':'text');
    assert.equal(textStyleCss(style,182).writingMode,orientation==='vertical'?'vertical-rl':'horizontal-tb');
  }
});
test('padded paint previews use their visible reference width for the same physical point size',()=>{
  const frame={x:0,y:0,w:60,h:90},paint={width:600,height:900,referenceFrame:{x:100,y:100,w:200,h:300}};
  const reference=paintReferenceBox(paint,frame),paperWidth=4299,paperMm=182;
  const hostWidth=reference.w/paperMm*paperWidth;
  assert.ok(Math.abs(cssLengthAtWidth(textStyleCss({fontSize:15},reference.w).fontSize,hostWidth)-cssLengthAtWidth(textStyleCss({fontSize:15},paperMm).fontSize,paperWidth))<1e-10);
  const source=readFileSync(new URL('../src/components/PaintSceneView.tsx',import.meta.url),'utf8');
  assert.match(source,/textStyleCss\(textStyleOf\(bubble,'bubble'\),reference.w\)/);
  assert.match(source,/setProperty\('--canvas-layout-width',`\$\{host.clientWidth\}px`\)/);
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

test('changing the work default font preserves every existing inherited text and applies only to future text',()=>{
  const d=fixture(),panel=d.manga.pages[0].panels[0];
  d.manga.meta.font='アンチック体';
  delete panel.bubbles[0].text_style.font;
  panel.screen_text=[{text:'既存の通常文字',orientation:'vertical',text_style:{fontSize:12}}];
  d.manga.pages[0].page_overlay={bubbles:[{text:'既存の前景吹き出し',shape:'normal'}],screen_text:[{text:'既存の前景文字',orientation:'vertical'}]};
  assert.equal(changeCanvasDefaultFont(d,'I-OTFアンチックStd B'),true);
  assert.equal(d.manga.meta.font,'I-OTFアンチックStd B');
  for(const item of [panel.bubbles[0],panel.screen_text[0],d.manga.pages[0].page_overlay.bubbles[0],d.manga.pages[0].page_overlay.screen_text[0]])assert.equal(item.text_style.font,'アンチック体');
  assert.equal(changeCanvasDefaultFont(d,'I-OTFアンチックStd B'),false);
  assert.throws(()=>changeCanvasDefaultFont(d,'   '),/基本書体/);
});
