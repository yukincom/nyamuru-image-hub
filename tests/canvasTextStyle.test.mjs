import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {parseMangaYaml,toMangaYaml,toSeparatedMangaYaml,toStoredMangaYaml,validateManga} from '../src/lib/manga.ts';
import {canvasTextAt,changeCanvasDefaultFont,editCanvasBubbleMaterial,editCanvasText,editCanvasTextStyle} from '../src/lib/canvasText.ts';
import {BUBBLE_MATERIALS} from '../src/lib/bubblePresetData.ts';
import {canvasLengthCss,textToolCursor,textStyleCss,textStyleOf,validTextStyle,validTextWeight,validTextRuns,textStyleSegments,selectedTextWeight} from '../src/lib/textStyle.ts';
import {pixelZoomWidth} from '../src/lib/canvasZoom.ts';
import {paintReferenceBox} from '../src/lib/paintDocument.ts';
import {readFileSync} from 'node:fs';
function cssLengthAtWidth(css,width){
  const match=/^calc\(var\(--canvas-layout-width, [\d.]+px\) \* ([\d.e+-]+)\)$/.exec(css);
  assert.ok(match,`legacy-compatible px expression: ${css}`);return width*Number(match[1]);
}
const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};

test('実フォントのウェイト値を丸めず編集・保存・再読込する',()=>{
  for(const weight of [1,250,950,1000]){
    assert.equal(validTextWeight(weight),true);
    const document=editCanvasTextStyle(fixture(),target,{fontWeight:weight});
    assert.equal(canvasTextAt(document,target).text_style.fontWeight,weight);
    const restored=parseMangaYaml(toStoredMangaYaml(document));
    assert.equal(canvasTextAt(restored,target).text_style.fontWeight,weight);
    assert.equal(validTextRuns([{start:0,end:1,fontWeight:weight}],'字'),true);
  }
  for(const weight of [0,1001,250.5,NaN])assert.equal(validTextWeight(weight),false);
});

test('書体の選択時だけ基本太さと部分太さを実在候補へ合わせ、元文書を保つ',()=>{
  const original=fixture(),before=canvasTextAt(original,target);before.text_style.fontWeight=900;
  const box={...before.bbox},ranges=before.text_runs.map(range=>({...range}));
  const single=editCanvasTextStyle(original,target,{font:'Single'},undefined,[{value:400,label:'B'}]),item=canvasTextAt(single,target);
  assert.equal(item.text_style.fontWeight,400);assert.ok(item.text_runs.every(range=>range.fontWeight===400));
  assert.deepEqual(item.text_runs.map(({start,end})=>({start,end})),ranges.map(({start,end})=>({start,end})));
  assert.deepEqual(item.bbox,box);assert.equal(before.text_style.fontWeight,900);assert.deepEqual(before.text_runs,ranges);
  assert.equal(editCanvasTextStyle(single,target,{font:'Single'},undefined,[{value:400,label:'B'}]),single);
  const multiple=editCanvasTextStyle(original,target,{font:'Multiple'},undefined,[{value:300,label:'W3'},{value:600,label:'W6'}]);
  assert.equal(canvasTextAt(multiple,target).text_style.fontWeight,600);assert.ok(canvasTextAt(multiple,target).text_runs.every(range=>range.fontWeight===600));
  const unknown=editCanvasTextStyle(original,target,{font:'Unknown'},undefined,[]);
  assert.equal(canvasTextAt(unknown,target).text_style.fontWeight,900);assert.deepEqual(canvasTextAt(unknown,target).text_runs,ranges);
});

test('書体変更だけではシナリオ由来の強調情報を削除しない',()=>{
  for(const keepRanges of [false,true]){
    const document=fixture(),bubble=canvasTextAt(document,target);bubble.emphasis='元気';bubble.text_style.fontWeight=400;
    if(keepRanges)bubble.text_runs=[{start:4,end:6,fontWeight:400}];else delete bubble.text_runs;
    const next=editCanvasTextStyle(document,target,{font:'Single'},undefined,[{value:400,label:'B'}]);
    assert.equal(canvasTextAt(next,target).emphasis,'元気');
  }
});

test('same text styles keep the original work without cloning or fitting',()=>{
  const d=fixture(),b=canvasTextAt(d,target),style=b.text_style,weights=b.text_runs;
  Object.defineProperty(d.manga,'unrelated',{enumerable:true,get(){throw Error('no whole-work clone on a no-op');}});
  for(const patch of [{},{fontSize:13},{font:'游明朝'},{fontSize:13,font:'游明朝'}])assert.equal(editCanvasTextStyle(d,target,patch),d);
  assert.equal(editCanvasTextStyle(d,target,{fontWeight:800},{start:4,end:6}),d);
  assert.equal(b.text_style,style);assert.equal(b.text_runs,weights);
});
test('explicit defaults, partial weight removal and orientation synchronization remain real edits',()=>{
  const original=fixture();delete canvasTextAt(original,target).text_style.fontSize;
  const explicit=editCanvasTextStyle(original,target,{fontSize:15});assert.notEqual(explicit,original);assert.equal(canvasTextAt(original,target).text_style.fontSize,undefined);
  const inherited=editCanvasTextStyle(explicit,target,{fontSize:null});assert.notEqual(inherited,explicit);assert.equal(canvasTextAt(inherited,target).text_style.fontSize,undefined);
  assert.equal(editCanvasTextStyle(inherited,target,{fontSize:null}),inherited);
  const cleared=editCanvasTextStyle(original,target,{fontWeight:500});assert.notEqual(cleared,original);assert.equal(canvasTextAt(cleared,target).text_runs,undefined);assert.ok(canvasTextAt(original,target).text_runs);
  assert.equal(editCanvasTextStyle(cleared,target,{fontWeight:500}),cleared);
  original.manga.pages[0].panels[0].screen_text=[{text:'方向',orientation:'vertical',text_style:{orientation:'horizontal'}}];
  const screen={...target,kind:'screen_text'},synced=editCanvasTextStyle(original,screen,{orientation:'horizontal'});
  assert.notEqual(synced,original);assert.equal(canvasTextAt(synced,screen).orientation,'horizontal');assert.equal(editCanvasTextStyle(synced,screen,{orientation:'horizontal'}),synced);
});

test('OCR text styles and body change independently of original raster eyes, locks and source metadata',()=>{
  for(const visible of [false,true])for(const overlay of [false,true]){
    let d=fixture(),bubble=d.manga.pages[0].panels[0].bubbles[0];
    bubble.analogTextImport={assetId:'source',sourceRegionId:'region',needsReview:true,referenceHidden:false};
    bubble.paint_overlay={hidden:false,locked:false,paint:{guideInitialized:true,layers:[{id:'original',kind:'raster',visible,locked:true,opacity:.65,image:{assetId:'scan'},strokes:[]}]}};
    const raster=structuredClone(bubble.paint_overlay);
    if(overlay){d.manga.pages[0].page_overlay={bubbles:[bubble]};d.manga.pages[0].panels[0].bubbles=[];}
    const next=editCanvasTextStyle(d,{...target,overlay},{fontSize:40});assert.notEqual(next,d);d=next;bubble=canvasTextAt(d,{...target,overlay});
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
  text_style:{font:'游明朝',fontSize:13,fontWeight:500},text_runs:[{start:4,end:6,fontWeight:800}],
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
  let d=fixture();editCanvasBubbleMaterial(d,target,'nomal_03');
  d=editCanvasTextStyle(d,target,{fontSize:16,fontWeight:700});
  d=editCanvasTextStyle(d,target,{fontWeight:900},{start:4,end:6});
  const b=d.manga.pages[0].panels[0].bubbles[0];
  assert.equal(b.text_style.fontSize,16);assert.equal(b.text_style.fontWeight,700);assert.equal(b.text_runs[0].fontWeight,900);
  assert.equal(b.emphasis,'元気');
  for(const serialize of [toMangaYaml,toSeparatedMangaYaml,toStoredMangaYaml]){
    const r=parseMangaYaml(serialize(d)).manga.pages[0].panels[0].bubbles[0];
    for(const key of ['text','text_style','text_runs','emphasis','bbox','bezier','tail','tail_root','text_position','clip_to_panel'])assert.deepEqual(r[key],b[key]);
  }
  assert.equal(validateManga(d).filter(i=>/text_style|text_runs/.test(i.path)).length,0);
});
test('text edits rebase unchanged styles while replacement characters do not inherit unrelated weights',()=>{
  const d=fixture();editCanvasText(d,target,'今日は\nとても元気だよ。');
  const b=d.manga.pages[0].panels[0].bubbles[0];assert.deepEqual(b.text_runs,[{start:7,end:9,fontWeight:800}]);
  editCanvasText(d,target,'今日は\nとても平気だよ。');assert.deepEqual(b.text_runs,[{start:8,end:9,fontWeight:800}]);
  assert.equal(textStyleSegments(b).map(s=>s.text).join(''),b.text);
});
test('size is never chosen by material replacement or weight-only edits',()=>{
  let d=fixture(),b=canvasTextAt(d,target);const box=structuredClone(b.bbox);
  delete b.text_style.fontSize;d=editCanvasTextStyle(d,target,{fontWeight:800});editCanvasBubbleMaterial(d,target,'tense_02');b=canvasTextAt(d,target);
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
  b.hidden=true;assert.equal(editCanvasBubbleMaterial(d,target,'nomal_01'),false);assert.equal(editCanvasTextStyle(d,target,{fontSize:20}),d);
  delete b.hidden;b.paint_overlay={locked:true};assert.equal(editCanvasText(d,target,'bad'),false);
  assert.equal(validTextRuns([{start:1,end:2,fontWeight:700}],'🐱'),false);
  assert.equal(validTextRuns([{start:0,end:2,fontWeight:700}],'🐱'),true);
});

test('editing offsets preserve emphasis when repeated characters make full-text diff ambiguous',()=>{
  let d=fixture(),b=canvasTextAt(d,target);b.text='同同';b.text_runs=[{start:0,end:1,fontWeight:800}];
  editCanvasText(d,target,'同同同',{start:0,end:0});assert.deepEqual(b.text_runs,[{start:1,end:2,fontWeight:800}]);
  d=editCanvasTextStyle(d,target,{fontSize:18,orientation:'horizontal'});b=canvasTextAt(d,target);assert.deepEqual(b.text_runs,[{start:1,end:2,fontWeight:800}]);
  editCanvasText(d,target,'同同',{start:0,end:1});assert.deepEqual(b.text_runs,[{start:0,end:1,fontWeight:800}]);
});

test('page-foreground and screen text preserve line breaks and partial weights in both OMNY forms',()=>{
  let d=fixture();const sample=structuredClone(d.manga.pages[0].panels[0].bubbles[0]);
  d.manga.pages[0].page_overlay={bubbles:[sample]};
  d.manga.pages[0].panels[0].screen_text=[{text:sample.text,text_style:sample.text_style,text_runs:sample.text_runs,orientation:'horizontal'}];
  for(const t of [{...target,overlay:true},{...target,kind:'screen_text'}]){
    d=editCanvasTextStyle(d,t,{fontSize:18});editCanvasText(d,t,'今日は\n元気だよ！');
  }
  for(const serialize of [toMangaYaml,toStoredMangaYaml]){
    const r=parseMangaYaml(serialize(d)).manga.pages[0];
    for(const b of [r.page_overlay.bubbles[0],r.panels[0].screen_text[0]]){assert.equal(b.text,'今日は\n元気だよ！');assert.equal(b.text_style.fontSize,18);assert.deepEqual(b.text_runs,[{start:4,end:6,fontWeight:800}]);}
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

test('重なるスタイルは同じ範囲へ統合し、一部解除でも他の太さと装飾を保つ',()=>{
  const original=fixture(),item=canvasTextAt(original,target);item.text='AB𠮷CDEF';item.text_style={fontWeight:400,underline:true};delete item.text_runs;
  let doc=editCanvasTextStyle(original,target,{italic:true},{start:1,end:6});
  doc=editCanvasTextStyle(doc,target,{fontWeight:800,strikethrough:true},{start:2,end:5});
  doc=editCanvasTextStyle(doc,target,{underline:false,italic:false},{start:4,end:6});
  const updated=canvasTextAt(doc,target);
  assert.deepEqual(updated.text_runs,[
    {start:1,end:2,italic:true},
    {start:2,end:4,italic:true,fontWeight:800,strikethrough:true},
    {start:4,end:5,italic:false,fontWeight:800,strikethrough:true,underline:false},
    {start:5,end:6,italic:false,underline:false},
  ]);
  assert.equal(editCanvasTextStyle(doc,target,{underline:false,italic:false},{start:4,end:6}),doc);
  assert.equal(validTextRuns(updated.text_runs,updated.text),true);
  const segments=textStyleSegments(updated);
  assert.equal(segments.map(part=>part.text).join(''),updated.text);
  assert.equal(segments.find(part=>part.text==='C').underline,false);
  assert.equal(segments[0].underline,true);assert.equal(segments.at(-1).underline,true);
  assert.equal(item.text_runs,undefined);assert.deepEqual(item.text_style,{fontWeight:400,underline:true});
  assert.throws(()=>editCanvasTextStyle(doc,target,{italic:true},{start:2,end:3}),/範囲/);
});

test('全体の太さを変えても部分の斜体・下線・取り消し線は消えない',()=>{
  let doc=editCanvasTextStyle(fixture(),target,{fontWeight:900,italic:true,underline:true,strikethrough:true},{start:0,end:3});
  doc=editCanvasTextStyle(doc,target,{fontWeight:400});
  const item=canvasTextAt(doc,target);
  assert.equal(item.text_style.fontWeight,400);
  assert.deepEqual(item.text_runs,[{start:0,end:3,italic:true,underline:true,strikethrough:true}]);
  const normalized=editCanvasTextStyle(doc,target,{font:'Single'},undefined,[{value:400,label:'Regular'}]);
  assert.deepEqual(canvasTextAt(normalized,target).text_runs,item.text_runs);
});

test('入力待ちスタイルは挿入・置換した文字だけに適用し、削除でも前後を保持する',()=>{
  const doc=fixture(),item=canvasTextAt(doc,target);item.text='AB𠮷CD';item.text_style={fontWeight:400,italic:true};
  item.text_runs=[{start:1,end:4,fontWeight:800,underline:true}];
  const insertion={fontWeight:700,italic:false,underline:false,strikethrough:true};
  editCanvasText(doc,target,'AB新𠮷CD',{start:2,end:2},'manual',insertion);
  assert.deepEqual(item.text_runs,[{start:1,end:2,fontWeight:800,underline:true},{start:2,end:3,...insertion},{start:3,end:5,fontWeight:800,underline:true}]);
  editCanvasText(doc,target,'AB新語CD',{start:3,end:5},'manual',insertion);
  assert.deepEqual(item.text_runs,[{start:1,end:2,fontWeight:800,underline:true},{start:2,end:4,...insertion}]);
  editCanvasText(doc,target,'ABCD',{start:2,end:4},'manual',insertion);
  assert.deepEqual(item.text_runs,[{start:1,end:2,fontWeight:800,underline:true}]);
});

test('通常文字・吹き出し・前景のスタイルと明示解除が保存往復する',()=>{
  for(const kind of ['bubble','screen_text'])for(const overlay of [false,true]){
    const doc=fixture(),page=doc.manga.pages[0],t={...target,kind,overlay};
    if(overlay)page.page_overlay={};
    const owner=overlay?page.page_overlay:page.panels[0],key=kind==='bubble'?'bubbles':'screen_text';
    owner[key]=[{text:'ABC𠮷D',text_style:{fontSize:20,fontWeight:400,italic:true,underline:true},text_runs:[{start:1,end:3,italic:false,underline:false,strikethrough:true},{start:3,end:5,fontWeight:900}]}];
    const item=canvasTextAt(doc,t);
    for(const writer of [toStoredMangaYaml,toSeparatedMangaYaml,toMangaYaml]){
      const restored=parseMangaYaml(writer(doc)),saved=canvasTextAt(restored,t);
      assert.deepEqual(saved.text_style,item.text_style);assert.deepEqual(saved.text_runs,item.text_runs);
      assert.equal(validateManga(restored).filter(issue=>/text_style|text_runs/.test(issue.path)).length,0);
    }
  }
  for(const invalid of [[{start:0,end:1,underline:'yes'}],[{start:0,end:1}],[{start:0,end:1,bold:true}]])assert.equal(validTextRuns(invalid,'ABC'),false);
});

test('行揃えは部分選択中も文字群全体だけに適用し、位置・部分書式・保存を保つ',()=>{
  for(const kind of ['bubble','screen_text'])for(const overlay of [false,true]){
    const original=fixture(),page=original.manga.pages[0],t={...target,kind,overlay};
    if(overlay)page.page_overlay={};
    const owner=overlay?page.page_overlay:page.panels[0],key=kind==='bubble'?'bubbles':'screen_text';
    owner[key]=[{text:'長い文字列\n短い',bbox:{x:30,y:40,w:50,h:60},text_position:{x:.3,y:.7},text_style:{fontSize:18,underline:true},text_runs:[{start:0,end:2,italic:true}]},{text:'他の文字群'}];
    const before=structuredClone(owner[key][0]);let doc=original;
    for(const textAlign of ['center','right','left']){
      doc=editCanvasTextStyle(doc,t,{textAlign},{start:1,end:2});const item=canvasTextAt(doc,t);
      assert.equal(item.text_style.textAlign,textAlign);assert.equal(item.text,before.text);
      assert.deepEqual(item.text_runs,before.text_runs);assert.deepEqual(item.bbox,before.bbox);assert.deepEqual(item.text_position,before.text_position);
      assert.equal(item.text_style.underline,true);assert.equal(editCanvasTextStyle(doc,t,{textAlign},{start:1,end:2}),doc);
      for(const writer of [toStoredMangaYaml,toSeparatedMangaYaml,toMangaYaml]){
        const restored=parseMangaYaml(writer(doc));assert.equal(canvasTextAt(restored,t).text_style.textAlign,textAlign);
        assert.deepEqual(canvasTextAt(restored,t).text_runs,before.text_runs);
      }
      const nextOwner=overlay?doc.manga.pages[0].page_overlay:doc.manga.pages[0].panels[0];assert.deepEqual(nextOwner[key][1],{text:'他の文字群'});
    }
    assert.deepEqual(canvasTextAt(original,t),before);
  }
});

test('行揃えの既定は先頭で、縦横共通の行内方向へ揃え、範囲属性には入れない',()=>{
  for(const orientation of ['horizontal','vertical'])for(const [textAlign,css] of [[undefined,'start'],['left','start'],['center','center'],['right','end']]){
    assert.equal(textStyleCss({orientation,textAlign},182).textAlign,css);
    assert.equal(validTextStyle(textAlign?{textAlign}:{}),true);
  }
  for(const textAlign of ['justify','start',1,null])assert.equal(validTextStyle({textAlign}),false);
  assert.equal(validTextRuns([{start:0,end:1,textAlign:'center'}],'字'),false);
  assert.throws(()=>editCanvasTextStyle(fixture(),target,{textAlign:'justify'}),/文字設定/);
});
