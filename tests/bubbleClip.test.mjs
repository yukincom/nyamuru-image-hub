import assert from 'node:assert/strict';
import test from 'node:test';
import { bubbleTextFrame, bubbleTextPosition, compatibleBubbleClips } from '../src/lib/bubbleClip.ts';
import { moveBubbleToOwner } from '../src/lib/panelTemplates.ts';

const panel = { id: 1, shape: { type: 'rect', x: 25, y: 45, w: 160, h: 120 }, bg: 0, action: '', bubbles: [] };
test('panel clipping never recenters text inside only the visible fragment', () => {
  const clip = { text: '原文を保持', clip_to_panel: true };
  for (const box of [
    { x: 10, y: 60, w: 50, h: 50 }, { x: 165, y: 60, w: 40, h: 50 },
    { x: 80, y: 30, w: 40, h: 50 }, { x: 80, y: 150, w: 40, h: 50 },
  ]) {
    assert.deepEqual(bubbleTextFrame(box, panel, clip), box);
    assert.deepEqual(bubbleTextFrame(box, panel, { text: '通常' }), box);
  }
  assert.equal(clip.text, '原文を保持');
});

test('same-owner connectors share owner clipping and text position remains relative to the original frame without bounds', () => {
  assert.equal(compatibleBubbleClips({ text: '', clip_to_panel: true }, { text: '' }), true);
  assert.equal(compatibleBubbleClips({ text: '', clip_to_panel: true }, { text: '', clip_to_panel: true }), true);
  assert.equal(compatibleBubbleClips({ text: '', clip_to_panel: false }, { text: '' }), true);
  assert.deepEqual(bubbleTextPosition({}),{x:.5,y:.5});
  assert.deepEqual(bubbleTextPosition({text_position:{x:.2,y:.8}}),{x:.2,y:.8});
  assert.deepEqual(bubbleTextPosition({text_position:{x:-1,y:4}}),{x:-1,y:4});
  assert.deepEqual(bubbleTextPosition({text_position:{x:NaN,y:Infinity}}),{x:.5,y:.5});
});

test('moving a clipped bubble to page foreground clears the panel-specific setting', () => {
  const page = { page: 1, canvas: { w: 210, h: 297, unit: 'mm' }, panels: [structuredClone(panel)] };
  page.panels[0].bubbles.push({ text: '保持する', clip_to_panel: true, bbox: { x: 10, y: 60, w: 50, h: 50 } });
  moveBubbleToOwner(page, 0, 0, 'page_overlay');
  assert.equal(page.page_overlay.bubbles[0].clip_to_panel, undefined);
  assert.equal(page.page_overlay.bubbles[0].text, '保持する');
});
