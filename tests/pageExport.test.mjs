import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { flattenedPsd, pageExportIndices, pageExportPixels, safeExportName, uncompressedZip } from '../src/lib/pageExport.ts';

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

test('export names are portable and the header dialog owns page range and image format',()=>{
  assert.equal(safeExportName(' A/B:C*D?  E '),'A-B-C-D- E');
  const app=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8');
  const palette=readFileSync(new URL('../src/components/PaintLayerPalette.tsx',import.meta.url),'utf8');
  const header=readFileSync(new URL('../src/components/Header.tsx',import.meta.url),'utf8');
  assert.match(app,/captureQwenCompositionCanvas\([^;]+includeGenerated:true/);
  assert.match(app,/pageExportIndices\(current\.manga\.pages\.length,\{\.\.\.choice,current:activePageRef\.current\+1\}\)/);
  assert.match(app,/複数ページは1つのZIPにまとめます/);
  assert.match(app,/開始ページ/);assert.match(app,/終了ページ/);assert.match(app,/全ページ/);
  assert.match(app,/\(\['png','psd'\] as const\)/);
  assert.match(header,/>画像書出<\/button>/);
  assert.doesNotMatch(editor,/exportWholePage|onExportPage|exportImage/);
  assert.doesNotMatch(palette,/画像書き出し形式|layer-image-actions/);
});
