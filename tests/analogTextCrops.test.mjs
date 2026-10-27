import assert from 'node:assert/strict';
import test from 'node:test';

import { levelCorrectionRange, prepareDetectedTextCrops } from '../src/lib/analogTextCrops.ts';

test('原字参照のレベル補正は暗い線と白い紙を決定的な両端に取る', () => {
  const values = new Uint8Array([...Array(10).fill(0), ...Array(90).fill(255)]);
  assert.deepEqual(levelCorrectionRange(values), { blackPoint: 0, whitePoint: 255 });
  assert.deepEqual(levelCorrectionRange(values), levelCorrectionRange(values));
});

test('コントラストの低い鉛筆領域でも最低80階調の補正幅を確保する', () => {
  const range = levelCorrectionRange(new Uint8Array(Array(100).fill(220)));
  assert.equal(range.whitePoint - range.blackPoint, 80);
});

test('新規OCR cropは原本を保持して初期非表示を既存metadataへ設定する', async (t) => {
  const before = new Map(['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let disposed = 0;
  globalThis.createImageBitmap = async () => ({width:40,height:40,close(){disposed++;}});
  globalThis.document = {createElement:() => ({width:0,height:0,getContext:() => ({drawImage(){},getImageData:() => ({data:new Uint8ClampedArray(64).fill(255)}),putImageData(){}}),toBlob:done => done(new Blob(['crop'],{type:'image/png'}))})};
  const lines = [{id:'line',text:'本文',bbox:{x:.1,y:.2,w:.5,h:.3},confidence:.9,needsReview:false,source:'baberu',vertical:false}];
  const prepared = await prepareDetectedTextCrops(new File(['source'],'source.png',{type:'image/png'}),0,'new-page',lines);
  assert.equal(prepared.length,1);
  assert.equal(prepared[0].metadata.referenceHidden,true);
  assert.equal(prepared[0].metadata.rasterLayerSeparated,undefined);
  assert.equal(prepared[0].metadata.levelAdjusted,true);
  assert.deepEqual(prepared[0].metadata.sourceBBox,lines[0].bbox);
  assert.equal(prepared[0].metadata.assetId,prepared[0].asset.id);
  assert.equal(await prepared[0].asset.blob.text(),'crop');
  assert.equal(disposed,1);
});
