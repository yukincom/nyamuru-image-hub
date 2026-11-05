// 見込み: ページ画像・保存先選択・書込みを既存の出力経路で扱える。
// 範囲: 画像/ZIPのbyte検査と保存APIの模擬検査。実UIと実ファイル書込みはpageExport.browser.tsx。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canChooseImageExportDirectory, chooseImageExportDirectory, saveImageExport, flattenedPsd, pageExportIndices, pageExportPixels, safeExportName, uncompressedZip } from '../src/lib/pageExport.ts';

const u16=(bytes,offset)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(offset);
const u32=(bytes,offset)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset);

test('paper millimetres and dpi produce exact rounded export pixels with a bounded canvas',()=>{
  assert.deepEqual(pageExportPixels(210,297,600),{width:4961,height:7016});
  assert.deepEqual(pageExportPixels(182,257,350),{width:2508,height:3541});
  assert.throws(()=>pageExportPixels(210,297,0),/用紙サイズと解像度/);
  assert.throws(()=>pageExportPixels(1000,1000,600),/大きすぎます/);
});

test('flattened RGB PSD stores Photoshop v1 dimensions, dpi and white-composited channel planes',async()=>{
  const source={width:2,height:1,data:new Uint8ClampedArray([10,20,30,255,100,50,0,128])};
  const blob=flattenedPsd(source,600,'color'),bytes=new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type,'image/vnd.adobe.photoshop');
  assert.equal(new TextDecoder().decode(bytes.subarray(0,4)),'8BPS');
  assert.equal(u16(bytes,4),1);assert.equal(u16(bytes,12),3);
  assert.equal(u32(bytes,14),1);assert.equal(u32(bytes,18),2);assert.equal(u16(bytes,22),8);assert.equal(u16(bytes,24),3);
  assert.equal(u32(bytes,30),28);assert.equal(new TextDecoder().decode(bytes.subarray(34,38)),'8BIM');assert.equal(u16(bytes,38),1005);
  assert.equal(u32(bytes,46)/65536,600);assert.equal(u32(bytes,54)/65536,600);
  assert.equal(u16(bytes,66),0);
  assert.deepEqual([...bytes.subarray(68)],[10,177,20,152,30,127]);
});

test('flattened grayscale and monochrome PSDs use one 8-bit gray plane',async()=>{
  for(const [mode,expected] of [['grayscale',57],['monochrome',0]]){
    const bytes=new Uint8Array(await flattenedPsd({width:1,height:1,data:new Uint8ClampedArray([100,50,0,255])},72,mode).arrayBuffer());
    assert.equal(u16(bytes,12),1);assert.equal(u16(bytes,24),1);assert.equal(bytes[68],expected);
  }
  assert.throws(()=>flattenedPsd({width:2,height:2,data:new Uint8ClampedArray(3)},72),/寸法が不正/);
});

test('page ranges resolve current, explicit and all pages with strict bounds',()=>{
  assert.deepEqual(pageExportIndices(6,{mode:'current',current:3,from:1,to:1}),[2]);
  assert.deepEqual(pageExportIndices(6,{mode:'range',current:1,from:2,to:4}),[1,2,3]);
  assert.deepEqual(pageExportIndices(3,{mode:'all',current:2,from:2,to:2}),[0,1,2]);
  assert.throws(()=>pageExportIndices(4,{mode:'range',current:1,from:4,to:2}),/1〜4/);
  assert.throws(()=>pageExportIndices(4,{mode:'range',current:1,from:0,to:2}),/1〜4/);
  assert.throws(()=>pageExportIndices(0,{mode:'all',current:1,from:1,to:1}),/ページがありません/);
});

test('multi-page archives are valid stored ZIPs',async()=>{
  const bytes=new Uint8Array(await uncompressedZip([{name:'page-002.png',bytes:new Uint8Array([1,2])},{name:'page-003.psd',bytes:new Uint8Array([3])}]).arrayBuffer());
  assert.equal(u32(bytes,0),0x504b0304);assert.equal(u32(bytes,bytes.length-22),0x504b0506);
  assert.equal(new DataView(bytes.buffer).getUint16(bytes.length-14,true),2);
});

// 見込み: 保存UIはヘッダーの一箇所に集約。合格: 形式selectとページ範囲があり、ペン画面に別の書出入口がない。範囲: ソース構造のみ。
test('export names are portable and the header dialog owns page range and image format',()=>{
  assert.equal(safeExportName(' A/B:C*D?  E '),'A-B-C-D- E');
  const app=readFileSync(new URL('../src/components/workspace/WorkspaceView.tsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8');
  const palette=readFileSync(new URL('../src/components/PaintLayerPalette.tsx',import.meta.url),'utf8');
  const header=readFileSync(new URL('../src/components/Header.tsx',import.meta.url),'utf8');
  const actions=readFileSync(new URL('../src/components/workspace/workspaceImageExport.ts',import.meta.url),'utf8');
  assert.match(actions,/captureQwenCompositionCanvas\([^;]+includeGenerated:true/);
  assert.match(actions,/pageExportIndices\(current\.manga\.pages\.length,\{\.\.\.choice,current:activePageRef\.current\+1\}\)/);
  assert.match(app,/複数ページはZIPにまとめます/);
  assert.match(app,/開始ページ/);assert.match(app,/終了ページ/);assert.match(app,/全ページ/);
  assert.match(app,/<select aria-label="書き出し形式"/);
  assert.match(header,/>画像書出<\/button>/);
  assert.doesNotMatch(editor,/exportWholePage|onExportPage|exportImage/);
  assert.doesNotMatch(palette,/画像書き出し形式|layer-image-actions/);
});

// 見込み: フォルダー選択の取消しは失敗扱いにせず、利用不可と権限拒否は区別する。
// 合格: 読書き指定と前回フォルダーを渡し、取消しだけnull。範囲: pickerを模擬、OSの選択画面は対象外。
test('export folder picker keeps cancellation distinct from denied access',async()=>{
  const previous=globalThis.window,folder={name:'画像の保存先'};
  try{
    globalThis.window={showDirectoryPicker:async function(options){
      assert.equal(this,window);assert.equal(options.mode,'readwrite');assert.equal(options.startIn,folder);return folder;
    }};
    assert.equal(canChooseImageExportDirectory(),true);
    assert.equal(await chooseImageExportDirectory(folder),folder);
    window.showDirectoryPicker=async()=>{throw new DOMException('cancelled','AbortError');};
    assert.equal(await chooseImageExportDirectory(folder),null);
    window.showDirectoryPicker=async()=>{throw new DOMException('denied','NotAllowedError');};
    await assert.rejects(chooseImageExportDirectory(),{name:'NotAllowedError'});
    delete window.showDirectoryPicker;
    assert.equal(canChooseImageExportDirectory(),false);
    await assert.rejects(chooseImageExportDirectory(),/Chrome/);
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

// 見込み: 再書出は過去の出力を残し、writerのclose完了を待つ。
// 合格: 既存名を避け、同じBlobを書いてcloseの後に完了。範囲: フォルダー/writer模擬。
test('export saves to the chosen folder without replacing an earlier file',async()=>{
  const blob=new Blob(['image bytes']),calls=[];
  let finishClose;
  const closing=new Promise(resolve=>{finishClose=resolve;});
  const directory={async getFileHandle(name,options){
    calls.push([name,options?.create??false]);
    if(name==='page.png')return {};
    if(!options?.create)throw new DOMException('missing','NotFoundError');
    return {async createWritable(){return {async write(value){assert.equal(value,blob);calls.push('write');},async close(){calls.push('close');await closing;},async abort(){assert.fail('unexpected abort');}};}};
  }};
  let finished=false;
  const saving=saveImageExport(blob,'page.png',directory).then(name=>{finished=true;return name;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);
  assert.deepEqual(calls,[['page.png',false],['page (1).png',false],['page (1).png',true],'write','close']);
  finishClose();assert.equal(await saving,'page (1).png');
});

// 見込み: 書込み/close失敗を成功へ変換しない。合格: abortして元のエラーを返し、探索時の権限拒否では作成しない。範囲: writer模擬。
test('export aborts failed writes and propagates access errors',async()=>{
  for(const phase of ['write','close']){
    let aborted=0;
    const failure=Error(phase+' failed');
    const directory={async getFileHandle(name,options){
      if(!options?.create)throw new DOMException('missing','NotFoundError');
      return {async createWritable(){return {async write(){if(phase==='write')throw failure;},async close(){if(phase==='close')throw failure;},async abort(){aborted++;}};}};
    }};
    await assert.rejects(saveImageExport(new Blob(['x']),'page.psd',directory),error=>error===failure);
    assert.equal(aborted,1);
  }
  let attempts=0;
  await assert.rejects(saveImageExport(new Blob(),'page.zip',{async getFileHandle(){attempts++;throw new DOMException('denied','NotAllowedError');}}),{name:'NotAllowedError'});
  assert.equal(attempts,1);
});
