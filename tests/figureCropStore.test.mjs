import assert from 'node:assert/strict';
import test from 'node:test';
import { collectFigureCropAssetIds } from '../src/lib/figureCropStore.ts';

test('編集中の作品から人物と文字のローカル参照画像IDを重複なく収集する', () => {
  const document = {
    manga: {
      pages: [{
        page_overlay: {
          figures: [{ analogImport: { assetId: 'analog-figure:overlay' } }],
          bubbles: [{ analogTextImport: { assetId: 'analog-text:overlay' } }],
        },
        panels: [{
          figures: [
            { analogImport: { assetId: 'analog-figure:one' } },
            { analogImport: { assetId: 'analog-figure:one' } },
          ],
          bubbles: [
            { analogTextImport: { assetId: 'analog-text:one' } },
            { analogTextImport: { assetId: '  ' } },
          ],
        }],
      }],
    },
  };

  assert.deepEqual(collectFigureCropAssetIds(document).sort(), [
    'analog-figure:one',
    'analog-figure:overlay',
    'analog-text:one',
    'analog-text:overlay',
  ]);
});
