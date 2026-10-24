import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { pickBackgroundSurface } from '../src/lib/background3dSurfacePick.ts';
import { humanPoseSurfaceFromHit } from '../src/lib/humanPoseSurfacePlacement.ts';

const mesh = geometry => new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
const down = (x = 0, z = 0) => new Raycaster(new Vector3(x, 5, z), new Vector3(0, -1, 0));

test('表示中の最前面を選び、非表示でも元のmesh番号を維持する', () => {
  const floor = mesh(new BoxGeometry(8, .1, 8)), seat = mesh(new BoxGeometry(1, .1, 1));
  floor.position.y = -.05; seat.position.y = .45;
  const hit = pickBackgroundSurface([floor, seat], down());
  assert.equal(hit.surfaceMesh, 1); assert.ok(Math.abs(hit.point.y - .5) < 1e-7); assert.deepEqual(hit.normal.toArray(), [0, 1, 0]);
  seat.visible = false; assert.equal(pickBackgroundSurface([floor, seat], down()).surfaceMesh, 0);
  const group = new Group(); group.add(floor); group.visible = false;
  assert.equal(pickBackgroundSurface([floor, seat], down()), undefined);
});

test('壁を飛び越えて床を選ばず、不適格な最初のhitを呼出し側で拒否する', () => {
  const wall = mesh(new BoxGeometry(2, 3, .1)), floor = mesh(new BoxGeometry(8, .1, 8));
  wall.position.set(0, 1.5, 1); floor.position.y = -.05;
  const ray = new Raycaster(new Vector3(0, 2, 4), new Vector3(0, -1, -3).normalize());
  const hit = pickBackgroundSurface([floor, wall], ray);
  assert.equal(hit.surfaceMesh, 1); assert.throws(() => humanPoseSurfaceFromHit(hit, 'feet'), /水平な上側/);
});

test('逆winding・負scaleでも上面を拾い、下から見た裏側と傾斜を拒否する', () => {
  const plane = mesh(new PlaneGeometry(2, 2)); plane.rotation.x = Math.PI / 2; plane.scale.set(-2, 3, 4); plane.position.y = .8;
  const hit = pickBackgroundSurface([plane], down());
  assert.ok(hit.normal.y > .999999); humanPoseSurfaceFromHit(hit, 'hips');
  const below = pickBackgroundSurface([plane], new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 1, 0)));
  assert.ok(below.normal.y < -.999999); assert.throws(() => humanPoseSurfaceFromHit(below, 'feet'));
  plane.rotation.x = Math.PI / 2 + .2;
  assert.throws(() => humanPoseSurfaceFromHit(pickBackgroundSurface([plane], down()), 'feet'));
});
