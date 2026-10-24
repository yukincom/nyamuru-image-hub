import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { artworkPixelSize, artworkSizeText } from '../src/lib/artworkClipboard.ts';

test('size copy uses the artwork frame and the saved printing DPI with whole pixels', () => {
  assert.deepEqual(artworkPixelSize({w:25.4,h:50.8},600), {width:600,height:1200,dpi:600});
  assert.deepEqual(artworkPixelSize({w:55,h:82.5},350), {width:758,height:1137,dpi:350});
  assert.equal(artworkSizeText({w:55,h:82.5},350),'758 × 1137 px\n55 × 82.5 mm\n350 dpi');
  for (const [w,h,dpi] of [[0,50,600],[20,-1,600],[20,50,0],[Infinity,10,600],[10,NaN,600]]) {
    assert.throws(()=>artworkPixelSize({w,h},dpi));
  }
});

test('clipboard write starts in the user gesture and includes a transparent PNG plus readable dimensions', async () => {
  const events = [], png = new Blob(['PNG'],{type:'image/png'});
  let finishEncoding;
  const canvas = {width:0,height:0,getContext:()=>({}),toBlob(callback,type){
    assert.equal(type,'image/png');
    events.push(['encode',this.width,this.height]); finishEncoding=()=>callback(png);
  }};
  const exports = {};
  let payload;
  const context = {
    exports, Blob, Number, Error,
    document: {createElement: tag=>{assert.equal(tag,'canvas');return canvas;}},
    ClipboardItem: class {constructor(data){this.data=data;}},
    navigator: {clipboard: {write: async items=>{events.push(['write']);payload=items[0].data;await payload['image/png'];}}},
  };
  const source = readFileSync(new URL('../src/lib/artworkClipboard.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  const copy = exports.copyArtworkSize({w:25.4,h:50.8},600);
  assert.deepEqual(events,[['encode',600,1200],['write']], 'write cannot wait for asynchronous PNG encoding');
  assert.equal(await payload['text/plain'].text(),'600 × 1200 px\n25.4 × 50.8 mm\n600 dpi');
  finishEncoding(); await copy;
  assert.equal(await payload['image/png'],png);
  assert.equal(canvas.width,1); assert.equal(canvas.height,1);
  context.navigator.clipboard.write = async ()=>{throw new Error('permission denied');};
  const denied = exports.copyArtworkSize({w:25.4,h:50.8},600);
  finishEncoding();
  await assert.rejects(denied,/permission denied/);
});
