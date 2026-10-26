import assert from 'node:assert/strict';
import test from 'node:test';
import {applyPaintColor,paintColorInk,paintColorMode} from '../src/lib/paintColor.ts';
import {newPaintLayer,paintScene,paintForFrame,validatePaintDocument} from '../src/lib/paintDocument.ts';
import {newToneLayer} from '../src/lib/paintTone.ts';
import {preparePaintMarkLayer} from '../src/lib/paintGesture.ts';

test('print expressions choose the corresponding new-layer default in Japanese and stored English',()=>{
  for(const [format,mode] of [['モノクロ漫画','monochrome'],['black-and-white manga','monochrome'],['グレースケール漫画','grayscale'],['grayscale manga','grayscale'],['カラー漫画','color'],['custom','color']])assert.equal(paintColorMode(format),mode);
  const panel={id:1,shape:{type:'rect',x:0,y:0,w:25.4,h:25.4},bg:1,action:null,figures:[{name:'person',bbox:{x:2,y:2,w:5,h:5}}],bubbles:[{text:'hello',bbox:{x:10,y:10,w:4,h:4}}]};
  for(const mode of ['color','grayscale','monochrome']){
    const scene=paintScene(panel,100,[],mode);assert.equal(scene.colorMode,mode);
    assert.ok(scene.owners.every(o=>o.paint.layers.every(l=>l.colorMode===(l.guide?'color':mode))));
    assert.ok(scene.owners.every(o=>preparePaintMarkLayer(o,o.paint.layers.at(-1),'raster',mode).colorMode===mode));
    assert.equal(newPaintLayer('vector','vector',mode).colorMode,mode);
    assert.equal(newToneLayer(null,mode).colorMode,mode);
  }
});
test('legacy layers and imported pixels retain their colors when a different new-layer default is selected',()=>{
  const box={x:0,y:0,w:25.4,h:25.4},asset={id:'image',widthPx:100,heightPx:100};
  const image={id:'placed',assetId:asset.id,crop:{x:0,y:0,w:100,h:100},bbox:box,opacity:1};
  const imported=paintForFrame(box,100,[image],[asset],'monochrome');
  assert.equal(imported.layers[0].colorMode,'color');assert.equal(imported.layers[1].colorMode,'monochrome');
  const legacy=structuredClone(imported);legacy.layers.forEach(l=>delete l.colorMode);
  const before=structuredClone(legacy),reopened=paintForFrame(box,100,[{...image,paint:legacy}],[asset],'monochrome');
  assert.deepEqual(reopened,before);assert.deepEqual(legacy,before);
  assert.throws(()=>validatePaintDocument({...legacy,layers:[{...newPaintLayer(),colorMode:'sepia'}]},[]),/ペイント/);
});
test('grayscale retains alpha; monochrome thresholds native ink while reduced views retain edge coverage',()=>{
  const source=new Uint8ClampedArray([255,0,0,127,0,255,0,128,128,128,128,255,0,0,255,0]);
  const unchanged=source.slice();applyPaintColor(unchanged,undefined);assert.deepEqual(unchanged,source);
  const gray=source.slice();applyPaintColor(gray,'grayscale');assert.deepEqual(Array.from(gray),[54,54,54,127,182,182,182,128,128,128,128,255,18,18,18,0]);
  const mono=source.slice();applyPaintColor(mono,'monochrome');assert.deepEqual(Array.from(mono),[0,0,0,0,255,255,255,255,255,255,255,255,0,0,0,0]);
  const reduced=source.slice();applyPaintColor(reduced,'monochrome',false);assert.deepEqual([reduced[3],reduced[7]],[127,128]);
  const opaqueMean=new Uint8ClampedArray([127,127,127,255]);applyPaintColor(opaqueMean,'monochrome',false);assert.deepEqual(Array.from(opaqueMean),[127,127,127,255]);
  assert.equal(paintColorInk('#ff0000','grayscale'),'#363636');assert.equal(paintColorInk('#ff0000','monochrome'),'#000000');assert.equal(paintColorInk('#00ff00','monochrome'),'#ffffff');assert.equal(paintColorInk(null,'monochrome'),null);
});
