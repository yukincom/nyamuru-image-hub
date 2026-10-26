import assert from 'node:assert/strict';
import test from 'node:test';
import { BUBBLE_BEZIER_PRESETS, MAX_BUBBLE_NODES, addBubbleBezierNode, bubbleBezierBoundaryDistance, bubbleBezierData, bubbleBezierPath, createBubbleBezier, isBubbleBezier, moveBubbleBezierNode } from '../src/lib/bubbleBezier.ts';
import { moveVectorNode, paperPath } from '../src/lib/vectorGeometry.ts';
import { bubbleJoinGeometry, bubbleTailGeometry, monologueTailEllipses } from '../src/lib/bubbleTail.ts';
import { parseMangaYaml, toStoredMangaYaml, toMangaYaml, validateManga } from '../src/lib/manga.ts';
import { panelTestDocument } from './fixtures/emptyTestDocument.ts';

test('presets produce finite closed cubic contours with area, inside their box', () => {
  for (const [preset] of BUBBLE_BEZIER_PRESETS) {
    const outline = createBubbleBezier(preset);
    assert.ok(isBubbleBezier(outline), preset);
    assert.match(bubbleBezierData(outline), /^M .* C .* Z$/);
    const path = paperPath(bubbleBezierPath(outline));
    try {
      assert.ok(Math.abs(path.area) > 4000, preset);
      assert.ok(!path.getIntersections(path).length, preset);
      assert.ok(path.bounds.left >= -.001 && path.bounds.top >= -.001, preset);
      assert.ok(path.bounds.right <= 100.001 && path.bounds.bottom <= 100.001, preset);
    } finally { path.remove(); }
  }
});

test('anchor insertion preserves exact geometry, edits reuse relative vector handles', () => {
  const original = createBubbleBezier('ellipse'), expanded = addBubbleBezierNode(original, 0);
  assert.equal(expanded.nodes.length, original.nodes.length+1);
  const a = paperPath(bubbleBezierPath(original)), b = paperPath(bubbleBezierPath(expanded));
  try {
    for (let offset = 0; offset < a.length; offset += 3) assert.ok(a.getPointAt(offset).getDistance(b.getPointAt(offset)) < .001);
  } finally { a.remove(); b.remove(); }
  const moved = moveVectorNode(bubbleBezierPath(original), 0, { x: 20, y: 50 });
  assert.deepEqual(moved.nodes[0].handleOut, original.nodes[0].handleOut);
  assert.notDeepEqual(moved.nodes, original.nodes);
  const handled = moveVectorNode(moved, 0, { x: 30, y: 70 }, 'handleOut', true);
  assert.deepEqual(handled.nodes[0].handleOut, { x: 10, y: 20 });
  assert.deepEqual(handled.nodes[0].handleIn, moved.nodes[0].handleIn);
});

test('anchors and handles remain outside the reference frame through save/read without fitting back',()=>{
  let outline=createBubbleBezier('ellipse');
  outline=moveBubbleBezierNode(outline,0,{x:-80,y:160});
  outline=moveBubbleBezierNode(outline,0,{x:-200,y:350},'handleOut',true);
  assert.equal(outline.nodes[0].x,-80);assert.equal(outline.nodes[0].y,160);
  assert.deepEqual(outline.nodes[0].handleOut,{x:-120,y:190});assert.equal(isBubbleBezier(outline),true);
  const doc=panelTestDocument();
  const bubble={text:'元の本文',shape:'normal',bbox:{x:30,y:40,w:20,h:30},bezier:outline,tail:false};doc.manga.pages[0].panels[0].bubbles=[bubble];
  assert.deepEqual(parseMangaYaml(toStoredMangaYaml(doc)).manga.pages[0].panels[0].bubbles[0],bubble);
  assert.ok(!validateManga(doc).some(issue=>issue.path.endsWith('.bezier')));
});

test('tail roots, joins and thought beads use edited boundaries after non-square resize', () => {
  const box = { x: 10, y: 20, w: 200, h: 80 }, target = { x: 280, y: 60 };
  const outline = createBubbleBezier('rounded');
  outline.nodes = outline.nodes.map(n => ({ ...n, x: n.x * .8, ...(n.handleIn ? {handleIn: {...n.handleIn, x: n.handleIn.x*.8}} : {}), ...(n.handleOut ? {handleOut: {...n.handleOut, x: n.handleOut.x*.8}} : {}) }));
  assert.ok(Math.abs(bubbleBezierBoundaryDistance(box, target, outline)-80)<.001);
  const custom = bubbleTailGeometry(box, target, 'normal', outline);
  const standard = bubbleTailGeometry(box, target, 'normal');
  assert.ok(custom && standard);
  assert.notEqual(custom.fillPath, standard.fillPath);
  assert.ok(custom.seamMask.points.every(([x]) => x < .85));
  assert.ok(monologueTailEllipses(box, target, outline)[0].cx < monologueTailEllipses(box, target)[0].cx);
  const second = { x: 240, y: 20, w: 40, h: 80 };
  assert.notDeepEqual(bubbleJoinGeometry(box, 'normal', second, 'normal', outline), bubbleJoinGeometry(box, 'normal', second, 'normal'));
  assert.equal(bubbleTailGeometry(box, {x: 140, y:60}, 'normal', outline), null);
});

test('OMNY save/export/read roundtrip keeps both panel and page outlines and original dialogue', () => {
  const doc = panelTestDocument();
  const bubble = {text: '待って…\nそのままで！', shape:'normal', bezier:createBubbleBezier('ellipse'), tail:false, emphasis:'そのままで'};
  doc.manga.pages[0].panels[0].bubbles = [structuredClone(bubble)];
  doc.manga.pages[0].page_overlay = {bubbles:[structuredClone(bubble)]};
  for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
    const restored = parseMangaYaml(serialize(doc));
    for (const actual of [restored.manga.pages[0].panels[0].bubbles[0], restored.manga.pages[0].page_overlay.bubbles[0]]) {
      assert.deepEqual(actual.bezier, bubble.bezier); assert.equal(actual.text, bubble.text); assert.equal(actual.tail, false); assert.equal(actual.emphasis, bubble.emphasis);
    }
  }
  assert.ok(!validateManga(doc).some(issue => issue.path.endsWith('.bezier')));
  doc.manga.pages[0].page_overlay.bubbles[0].bezier.nodes[0].x = NaN;
  doc.manga.pages[0].panels[0].bubbles[0].bezier.nodes = [];
  assert.equal(validateManga(doc).filter(issue => issue.path.endsWith('.bezier')).length, 2);
});

test('untrusted malformed outlines cannot reach SVG or geometry', () => {
  assert.equal(MAX_BUBBLE_NODES,128);
  assert.equal(isBubbleBezier({nodes:Array(MAX_BUBBLE_NODES).fill({x:10,y:10})}),true);
  for (const value of [null, {}, {nodes:null}, {nodes:[]}, {nodes:[null,null,null]}, {nodes:Array(MAX_BUBBLE_NODES+1).fill({x:10,y:10})}, {nodes:Array(3).fill({x:10,y:Infinity})}, {nodes:Array(3).fill({x:10,y:10,handleIn:{x:NaN,y:0}})}]) {
    assert.equal(isBubbleBezier(value), false);
    assert.equal(bubbleBezierData(value), undefined);
    assert.equal(bubbleBezierBoundaryDistance({x:0,y:0,w:100,h:100},{x:200,y:50},value), undefined);
  }
});

test('a shifted outline connects at its own boundary instead of the box ellipse', () => {
  const outline = {nodes:[{x:5,y:20},{x:40,y:20},{x:40,y:80},{x:5,y:80}]};
  const geometry = bubbleTailGeometry({x:0,y:0,w:100,h:100}, {x:150,y:50}, 'normal', outline);
  assert.ok(geometry);
  assert.match(geometry.fillPath, /^M 36\.4 /);
  assert.ok(geometry.seamMask.points.every(([x])=>x<.45));
});

test('anchors and handles extend outside the reference box without clipping or moving other points', () => {
  const outline = createBubbleBezier('ellipse');
  outline.nodes[0].handleOut = {x:-100,y:-27};
  outline.nodes[1].handleIn = {x:-100,y:0};
  assert.equal(isBubbleBezier(outline), true);
  const expanded = addBubbleBezierNode(outline, 0);
  assert.ok(isBubbleBezier(expanded));
  assert.equal(expanded.nodes.length, 5);
  const curve = paperPath(bubbleBezierPath(expanded));
  try { assert.ok(curve.bounds.left<0); }
  finally { curve.remove(); }
});

test('linked handles keep their complete tangent beyond the reference box', () => {
  const ellipse = createBubbleBezier('ellipse'), top = ellipse.nodes.findIndex(n=>n.y===0);
  const linked = moveBubbleBezierNode(ellipse, top, {x:80,y:20}, 'handleOut');
  assert.deepEqual(linked.nodes[top].handleOut, {x:30,y:20});
  assert.deepEqual(linked.nodes[top].handleIn, {x:-30,y:-20});
  const separate = moveBubbleBezierNode(ellipse, top, {x:80,y:20}, 'handleOut', true);
  assert.deepEqual(separate.nodes[top].handleOut, {x:30,y:20});
  assert.deepEqual(separate.nodes[top].handleIn, ellipse.nodes[top].handleIn);
  const moved=moveBubbleBezierNode(ellipse,top,{x:-150,y:260});
  assert.deepEqual(moved.nodes[top],{...ellipse.nodes[top],x:-150,y:260});
  assert.deepEqual(moved.nodes.filter((_,i)=>i!==top),ellipse.nodes.filter((_,i)=>i!==top));
  const {handleIn:a,handleOut:b} = linked.nodes[top];
  assert.ok(Math.abs(a.x*b.y-a.y*b.x)<1e-8);
});
