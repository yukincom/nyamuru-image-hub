import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeLayoutRecognition } from '../src/lib/localBridge.ts';

// Opt-in local image regression: originals/models are never copied to the repo.
// See docs/PANEL_AXIS_RECOVERY.md. The worker only reads existing local assets.
const { NYAMURU_TEST_SCAN_IMAGE: scan, NYAMURU_TEST_ONE_IMAGES: one,
  NYAMURU_TEST_VISION_ROOT: vision } = process.env;
const skip = !(scan && one && vision);
const worker = String.raw`
import sys,json
from pathlib import Path
sys.path.insert(0,'scripts')
import nyamuru_local_bridge as b
from rtdetr_onnx import detect_page
image,root=map(Path,sys.argv[1:])
detection=detect_page(image,model_path=root/'models/rtdetrv4-x-manga109s_v2/model.onnx',conf_threshold=.2)
boxes,excluded=b.exclude_non_panel_regions(b.detector_boxes(detection,'frames'),detection)
boxes,headers=b.exclude_paired_title_header_boxes(boxes)
boxes=b.sort_panel_boxes_reading_order(b.deduplicate_panel_boxes(boxes))
shapes=b.detect_panel_shapes(image.read_bytes(),boxes)
assert len(boxes)==len(shapes)
print(json.dumps(dict(layout_protocol_version=3,panels=[dict(id=f'p{i+1}',detector_box=box,shape=shape) for i,(box,shape) in enumerate(zip(boxes,shapes))])))
`;
function recognize(path) {
  const payload = JSON.parse(execFileSync(join(vision, '.venv/bin/python'), ['-B', '-c', worker, path, vision],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 }));
  return normalizeLayoutRecognition(payload, { rowGapMm: 5, columnGapMm: 3 }).detectedPanels;
}
function bounds(shape) {
  if (shape.type === 'rect') return [shape.x, shape.y, shape.w, shape.h];
  const xs = shape.points.map(p => p[0]), ys = shape.points.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

test('local scan01: image detection through canvas geometry retains staggered dividers', { skip }, () => {
  const panels = recognize(scan).map(bounds);
  assert.equal(panels.length, 5);
  assert.ok(panels[2][0] - panels[0][0] > 8, JSON.stringify(panels));
  for (const [right, left] of [[panels[0], panels[1]], [panels[2], panels[3]]]) {
    assert.ok(Math.abs(right[0] - left[0] - left[2] - 3) < .2);
    assert.ok(Math.abs(left[0] - 10) < .2);
    assert.ok(Math.abs(right[0] + right[2] - 200) < .2);
  }
});

// Measured pre-fix canvas bounds, in mm, from the same local detector pipeline.
// Preserve existing layout, including known title/line-tracing imperfections;
// these are non-regression references, not ground-truth typesetting targets.
const references = {
  'one03.jpg': [[106.3,53.7,73.7,47.5],[29.9,53.7,73.4,39.2],[106.3,106.2,73.7,46.2],[29.9,97.9,73.4,54.5],
    [106.3,157.4,73.7,44.7],[29.9,157.4,73.4,44.7],[106.3,207.1,73.7,51.5],[29.9,207.1,73.4,51.5]],
  // Two titles are retained by the existing header filter on this page.
  'one04.jpg': [[106.5,10.1,93.5,18.5],[10,10,93.6,21.5],[106.3,33.6,93.7,63.2],[10,36.5,93.5,60.2],
    [113.8,101.7,86.1,56.8],[10.1,101.7,100.7,54.7],[106.3,160.9,93.7,68.3],[10,161.3,93.6,62.6],
    [111.5,224.7,88.5,62.2],[10.1,228.8,98.4,58.2]],
};
for (const [name, expected] of Object.entries(references)) {
  test(`local ${name}: both four-panel strips retain count, order and frame bounds`, { skip }, () => {
    const panels = recognize(join(one, name)).map(bounds);
    assert.equal(panels.length, expected.length);
    panels.forEach((box, i) => box.forEach((value, axis) =>
      assert.ok(Math.abs(value - expected[i][axis]) < 1, `${name} panel ${i + 1}, axis ${axis}: ${value} vs ${expected[i][axis]}`)));
  });
}
