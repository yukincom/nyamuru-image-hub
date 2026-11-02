// 原稿中の座標と画素で人物・顔切り抜きの分離を確認。画像内容の読解や推論は扱わない。
import assert from 'node:assert/strict';
import test from 'node:test';
import { cropPixelBounds, detectedFigureCrops } from '../src/lib/analogFigureCrops.ts';

test('正規化した人物領域を欠けない整数画素の切り抜き範囲へ変換する', () => {
  assert.deepEqual(
    cropPixelBounds({ x: 0.125, y: 0.2, w: 0.25, h: 0.3 }, 1000, 800),
    { x: 125, y: 160, w: 250, h: 240 },
  );
  assert.deepEqual(
    cropPixelBounds({ x: -0.1, y: 0.9, w: 0.25, h: 0.3 }, 101, 99),
    { x: 0, y: 89, w: 16, h: 10 },
  );
});

// 顔が体枠からはみ出しても全体を切り、画素範囲が同じなら再送しない。8×8の画素番号で原寸の範囲を確認。代用canvasのためPNG符号化・実機は対象外。
test('原稿から顔を原寸で切り、人物外の顔画素も保持する', async t => {
  const initial = new Map(['createImageBitmap','document'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(() => { for (const [key,descriptor] of initial) {
    if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
  } });
  const pixels = Uint8Array.from({length:64}, (_,i) => i);
  globalThis.createImageBitmap = async () => ({width:8,height:8,pixels,close(){}});
  let canvases = 0;
  globalThis.document = {createElement() {
    canvases++;
    const canvas = {width:0,height:0,pixels:undefined, getContext:() => ({
      drawImage(source, ...args) {
        if (args.length === 2) { canvas.pixels = source.pixels; return; }
        const [x,y,w,h,dx,dy,dw,dh] = args;
        assert.deepEqual([dx,dy,dw,dh],[0,0,w,h]);  // 原寸の読み取り。
        canvas.pixels = Uint8Array.from({length:w*h}, (_,index) =>
          source.pixels[(y + Math.floor(index / w)) * source.width + x + index % w]);
      }}), toBlob(callback) { callback(new Blob([canvas.pixels])); }};
    return canvas;
  }};
  const body = {x:0.25,y:0.25,w:0.5,h:0.5}, face = {x:0.125,y:0.125,w:0.375,h:0.375};
  const regions = [{id:'body',source:'body',bbox:body,faceBBox:face},{id:'single',source:'face',bbox:face},
    {id:'same-pixels',source:'body',bbox:body,faceBBox:{x:0.26,y:0.26,w:0.48,h:0.48}},
    {id:'larger-face',source:'body',bbox:body,faceBBox:{x:0.125,y:0.125,w:0.75,h:0.75}},
    {id:'unknown',source:'body',bbox:body}];
  for await (const crop of detectedFigureCrops(new File([], 'paper.png'),0,regions)) {
    const before = canvases;
    const input = await crop.face();
    if (crop.regionId === 'body') {
      assert.deepEqual(input.bbox,[0,0,0.5,0.5]);  // 元人物との重なりだけを座標記録。
      assert.deepEqual([...new Uint8Array(await input.image.arrayBuffer())],[9,10,11,17,18,19,25,26,27]);
      assert.deepEqual([...new Uint8Array(await (await crop.original()).arrayBuffer())],[18,19,20,21,26,27,28,29,34,35,36,37,42,43,44,45]);
    } else if (crop.regionId === 'larger-face') {
      // 人物を覆う顔も、bodyとは違う画像なら必ず2枚目を作る。
      assert.deepEqual(input.bbox,[0,0,1,1]);
      assert.equal(input.image.size,36);
      assert.equal(canvases,before+1);
    } else {
      assert.deepEqual(input,crop.regionId !== 'unknown' ? {bbox:[0,0,1,1]} : undefined);
      assert.equal(canvases,before);
    }
  }
});
