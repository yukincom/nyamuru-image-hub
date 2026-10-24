import assert from 'node:assert/strict';
import test from 'node:test';
import { bubbleTextFrame, compatibleBubbleClips } from '../src/lib/bubbleClip.ts';
import { moveBubbleToOwner } from '../src/lib/panelTemplates.ts';

const panel = { id: 1, shape: { type: 'rect', x: 25, y: 45, w: 160, h: 120 }, bg: 0, action: '', bubbles: [] };
test('clipped rectangular bubbles keep text in their visible area at all four edges', () => {
  const clip = { text: '原文を保持', clip_to_panel: true };
  for (const [box, expected] of [
    [{ x: 10, y: 60, w: 50, h: 50 }, { x: 25, y: 60, w: 35, h: 50 }],
    [{ x: 165, y: 60, w: 40, h: 50 }, { x: 165, y: 60, w: 20, h: 50 }],
    [{ x: 80, y: 30, w: 40, h: 50 }, { x: 80, y: 45, w: 40, h: 35 }],
    [{ x: 80, y: 150, w: 40, h: 50 }, { x: 80, y: 150, w: 40, h: 15 }],
  ]) {
    assert.deepEqual(bubbleTextFrame(box, panel, clip), expected);
    assert.deepEqual(bubbleTextFrame(box, panel, { text: '通常' }), box);
  }
  assert.equal(bubbleTextFrame({ x: 0, y: 0, w: 10, h: 10 }, panel, clip).w, 0);
  assert.equal(clip.text, '原文を保持');
});

test('mixed clipping never leaves a masked seam without a shared connector', () => {
  assert.equal(compatibleBubbleClips({ text: '', clip_to_panel: true }, { text: '' }), false);
  assert.equal(compatibleBubbleClips({ text: '', clip_to_panel: true }, { text: '', clip_to_panel: true }), true);
  assert.equal(compatibleBubbleClips({ text: '', clip_to_panel: false }, { text: '' }), true);
});

test('moving a clipped bubble to page foreground clears the panel-specific setting', () => {
  const page = { page: 1, canvas: { w: 210, h: 297, unit: 'mm' }, panels: [structuredClone(panel)] };
  page.panels[0].bubbles.push({ text: '保持する', clip_to_panel: true, bbox: { x: 10, y: 60, w: 50, h: 50 } });
  moveBubbleToOwner(page, 0, 0, 'page_overlay');
  assert.equal(page.page_overlay.bubbles[0].clip_to_panel, undefined);
  assert.equal(page.page_overlay.bubbles[0].text, '保持する');
});
