import assert from 'node:assert/strict';
import test from 'node:test';
import { setPanelMaterialLink } from '../src/lib/panelMaterialLinks.ts';

function fixture() {
  return {
    manga: {
      materials: [
        { key: '背景A', type: 'background' },
        { key: '小道具B', type: 'prop' },
      ],
      pages: [{ panels: [
        { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 80, h: 100 }, assets: ['背景A'], assetIds: undefined },
        { id: 2, shape: { type: 'rect', x: 100, y: 10, w: 80, h: 100 } },
      ] }],
    },
  };
}

test('小道具は素材参照と配置を対象コマへ重複なく追加し、別のコマへは影響しない', () => {
  const document = fixture();
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'prop' }, '小道具B', true), true);
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'prop' }, '小道具B', true), true);
  assert.deepEqual(document.manga.pages[0].panels[0].assets, ['背景A', '小道具B']);
  assert.deepEqual(document.manga.pages[0].panels[0].figures?.map(({ name, kind, anchor }) => ({ name, kind, anchor })), [
    { name: '小道具B', kind: 'prop', anchor: 'center' },
  ]);
  assert.equal(document.manga.pages[0].panels[1].assets, undefined);
  assert.equal(document.manga.pages[0].panels[1].figures, undefined);
});

test('最後の素材を外した場合は空配列ではなく assets 自体を取り除く', () => {
  const document = fixture();
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'background' }, '背景A', false), true);
  assert.equal(document.manga.pages[0].panels[0].assets, undefined);
});

test('存在しない対象や空の素材キーは変更しない', () => {
  const document = fixture();
  assert.equal(setPanelMaterialLink(document, { pageIndex: 9, panelIndex: 0, materialType: 'background' }, '背景A', true), false);
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'background' }, '', true), false);
  assert.deepEqual(document.manga.pages[0].panels[0].assets, ['背景A']);
});

test('登録済み素材は名称だけでなくローカルIDでもコマへ紐付く', () => {
  const document = fixture();
  document.manga.materials = [{ key: '小道具B', type: 'prop', localId: 'material-prop-b' }];
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'prop' }, '小道具B', true), true);
  assert.deepEqual(document.manga.pages[0].panels[0].assets, ['背景A', '小道具B']);
  assert.deepEqual(document.manga.pages[0].panels[0].assetIds, ['', 'material-prop-b']);
  assert.equal(document.manga.pages[0].panels[0].figures?.[0].refId, 'material-prop-b');
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'prop' }, '小道具B', false), true);
  assert.deepEqual(document.manga.pages[0].panels[0].assets, ['背景A']);
  assert.deepEqual(document.manga.pages[0].panels[0].assetIds, ['']);
  assert.equal(document.manga.pages[0].panels[0].figures, undefined);
});

test('旧データの名称参照をID付き配置へ補完しても小道具を重複させない', () => {
  const document = fixture();
  document.manga.materials = [{ key: '小道具B', type: 'prop', localId: 'material-prop-b' }];
  const panel = document.manga.pages[0].panels[0];
  panel.assets.push('小道具B');
  panel.figures = [{ name: '小道具B', kind: 'prop', anchor: 'center' }];
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 0, materialType: 'prop' }, '小道具B', true), true);
  assert.deepEqual(panel.assets, ['背景A', '小道具B']);
  assert.deepEqual(panel.assetIds, ['', 'material-prop-b']);
  assert.equal(panel.figures.length, 1);
});

test('背景と小道具は指定された種類のカタログだけから追加する', () => {
  const document = fixture();
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 1, materialType: 'background' }, '背景A', true), true);
  assert.deepEqual(document.manga.pages[0].panels[1].assets, ['背景A']);
  assert.equal(document.manga.pages[0].panels[1].figures, undefined);
  assert.equal(setPanelMaterialLink(document, { pageIndex: 0, panelIndex: 1, materialType: 'prop' }, '背景A', true), false);
  assert.deepEqual(document.manga.pages[0].panels[1].assets, ['背景A']);
});
