import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const canvas = readFileSync(new URL('../src/components/MangaCanvas.tsx', import.meta.url), 'utf8');

function zIndexOf(selector) {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find((match) => (
    match[1].split(',').map((part) => part.trim()).includes(selector)
    && /z-index:\s*(-?\d+)/.test(match[2])
  ));
  assert.ok(rule, `${selector} のCSS規則が存在すること`);
  const zIndex = rule[2].match(/z-index:\s*(-?\d+)/);
  assert.ok(zIndex, `${selector} に z-index が指定されていること`);
  return Number(zIndex[1]);
}

test('人物を選択中でもフキダシは人物より前面に残る', () => {
  assert.ok(zIndexOf('.bubble-guide') > zIndexOf('.figure-guide.is-element-selected'));
});

test('要素種別ごとの前後関係を選択中も維持する', () => {
  assert.ok(zIndexOf('.screen-text-guide') > zIndexOf('.figure-guide.is-element-selected'));
  assert.ok(zIndexOf('.bubble-guide') > zIndexOf('.screen-text-guide.is-element-selected'));
  assert.ok(zIndexOf('.bubble-guide.is-element-selected') > zIndexOf('.bubble-guide'));
});

test('しっぽと結合部は各フキダシの直前に置き、フキダシ配列と同じ重なり順にする', () => {
  assert.match(canvas, /class="panel-bubble-clip"[\s\S]*?elementsByBubble\[bubbleIndex\][\s\S]*?<button/);
  assert.match(canvas, /class="page-overlay-bubble-stack-item"[\s\S]*?elementsByBubble\[bubbleIndex\][\s\S]*?<button/);
  assert.doesNotMatch(canvas, /panelBubbleConnectionElements|overlayBubblePresentation\.elements\b/);
  assert.match(css, /\.page-overlay-bubble-stack-item\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
});

test('ページ前景はコマ枠より上で、人物よりフキダシが前面にある', () => {
  assert.ok(zIndexOf('.page-overlay-figure-layer') > zIndexOf('.panel-frame-overlay'));
  assert.ok(zIndexOf('.page-overlay-figure-layer') > zIndexOf('.panel-frame-inner-overlay'));
  assert.ok(zIndexOf('.panel-bubble-layer') > zIndexOf('.page-overlay-figure-layer'));
  assert.ok(zIndexOf('.page-overlay-bubble-layer') > zIndexOf('.page-overlay-figure-layer'));
});

test('内枠と一致するコマ枠だけを破線ガイドより前へ重ねる', () => {
  assert.ok(zIndexOf('.panel-frame-inner-overlay') > zIndexOf('.safe-area'));
  assert.match(canvas,/showGuides&&<svg class="panel-frame-inner-overlay"/);
  assert.match(canvas,/panelFrameSegmentsOnInnerFrame\(panel,inner\)/);
});

test('ページ設定の塗り足し線・裁ち切り線・内枠線とトンボを配置ガイドに表示する', () => {
  assert.ok(zIndexOf('.safe-area') > zIndexOf('.page-print-guides'));
  assert.match(canvas,/showGuides&&printMarginMm>0&&renderPrintGuides&&<div class="page-print-sheet"/);
  assert.match(canvas,/viewBox=\{`\$\{-printMarginMm\} \$\{-printMarginMm\}/);
  assert.match(canvas,/<rect class="page-bleed-guide" x=\{-bleedMm\} y=\{-bleedMm\}/);
  assert.match(canvas,/<rect class="page-trim-guide" x="0" y="0"/);
  assert.match(canvas,/class="page-crop-marks" d=\{cropMarkPath\}/);
  assert.match(css,/\.page-print-sheet\s*\{[^}]*background:\s*transparent/);
  assert.match(canvas,/class="page-print-sheet-fill"/);
  assert.doesNotMatch(canvas,/page-bleed-band/);
  assert.match(canvas,/outputSize\?: \{width_mm:number;height_mm:number;bleed_mm\?:number;crop_marks\?:boolean\}/);
});

test('見開きは左右を一枚の原稿ガイドにし、ノド線と三本トンボだけを中央に描く', () => {
  assert.match(css,/\.canvas-spread-pair\s*\{[^}]*box-shadow:/);
  assert.match(css,/\.canvas-spread \.manga-paper\s*\{\s*box-shadow:\s*none;/);
  assert.match(canvas,/printGuideWidthMm=effectiveSpreadSide==='left'\?canvas\.w\*2:canvas\.w/);
  assert.match(canvas,/renderPrintGuides=!effectiveSpreadSide\|\|effectiveSpreadSide==='left'/);
  assert.match(canvas,/class="page-spread-seam"/);
  assert.match(canvas,/canvas\.w-b[\s\S]*canvas\.w[\s\S]*canvas\.w\+b/);
  assert.doesNotMatch(css,/spread-pane:first-child \.manga-paper \{[^}]*border-right/);
});

test('Spaceの手のひら移動は見開き外側のキャンバス面も受け取る', () => {
  assert.match(canvas,/const panSurface=spreadScroll&&!spreadPartner\?spreadScroll:scroll/);
  assert.match(canvas,/panSurface\.addEventListener\('pointerdown', onPanPointerDown/);
});

test('コマ番号は非アクティブのコマだけ左下に一度表示する', () => {
  assert.match(canvas,/panelIndex!==activePanel&&<div class="panel-number-layer"/);
  assert.doesNotMatch(canvas,/class="panel-selection-label"/);
  assert.match(css,/\.panel-number\s*\{[^}]*left:\s*5px;[^}]*bottom:\s*5px;/);
  assert.doesNotMatch(css,/\.panel-number\s*\{[^}]*top:\s*5px;/);
  assert.doesNotMatch(css,/\.panel-selection-label/);
});
