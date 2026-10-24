import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { loadHumanPoseRuntime } from '../../src/lib/humanPoseRuntime.ts';

// 描画用と同じloaderで読み、Blenderが計算した全頂点と照合する。
const [models, review, ...requestedCases] = process.argv.slice(2);
assert.ok(models && review, 'modelsとreviewのpathが必要です');
const buffer = await readFile(path.join(models, 'human_base.glb'));
const contract = JSON.parse(await readFile(path.join(models, 'human_base.rig.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
assert.equal(digest(buffer), contract.base_glb_sha256);
const runtime = await loadHumanPoseRuntime(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), contract);
assert.equal(runtime.meshes.length, 1);
const mesh = runtime.meshes[0];
const reports = [];
for (const label of requestedCases.length ? requestedCases : ['rest', 'arms', 'seated', 'deep-knees']) {
  const rawPose = await readFile(path.join(review, label, 'pose.json'));
  const pose = JSON.parse(rawPose);
  assert.equal(pose.rig_signature, contract.rig_signature);
  runtime.applyPose(pose);
  const expected = JSON.parse(await readFile(path.join(review, label, 'expected-runtime-points.json'), 'utf8'));
  assert.equal(expected.length, mesh.geometry.attributes.position.count);
  let maximum = 0;
  const point = new Vector3(), target = new Vector3();
  for (let index = 0; index < expected.length; index += 1) {
    mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
    maximum = Math.max(maximum, point.distanceTo(target.fromArray(expected[index])));
  }
  assert.ok(maximum < 1e-5, `${label}: runtime差 ${maximum}m`);
  reports.push({ name: label, pose_sha256: digest(rawPose), vertices: expected.length, max_error_m: maximum });
}
await writeFile(path.join(review, 'three-runtime-validation.json'), JSON.stringify({
  base_glb_sha256: contract.base_glb_sha256, rig_signature: contract.rig_signature, cases: reports,
}, null, 2) + '\n');
runtime.dispose();
console.log(reports);
