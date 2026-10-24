import { MathUtils, Quaternion, Vector3 } from 'three';
import { humanPoseMatrix, humanPoseWorldMatrices } from './humanPoseMirror.ts';
import { humanPoseFingerTip, humanPoseFootPoints, humanPoseJointAngles, posePoint, setHumanPoseJointAngles, worldRotation } from './humanPoseJoints.ts';
import type { HumanPoseData, HumanPoseRig, PoseQuaternion, PoseVector } from './humanPoseTypes.ts';

const radians = MathUtils.degToRad;
function setWorldRotation(rig: HumanPoseRig, pose: HumanPoseData, id: string, q: Quaternion): void {
  const worlds = humanPoseWorldMatrices(rig, pose), parent = rig.bones.find(b => b.name === id)!.parent;
  const parentQ = worldRotation(parent ? worlds.get(parent)! : humanPoseMatrix(pose.root));
  pose.bones[id].rotation = parentQ.invert().multiply(q).normalize().toArray() as PoseQuaternion;
}
function aim(rig: HumanPoseRig, pose: HumanPoseData, id: string, end: string, target: Vector3): void {
  const worlds = humanPoseWorldMatrices(rig, pose), origin = posePoint(worlds, id);
  const from = posePoint(worlds, end).sub(origin), to = target.clone().sub(origin);
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  const turn = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  setWorldRotation(rig, pose, id, turn.multiply(worldRotation(worlds.get(id)!)));
}
export function humanPoseLimb(id: string): [string, string, string] | null {
  const side = id.slice(-1);
  if (/^(wrist|lowerarm01)\.[LR]$/u.test(id)) return [`upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`];
  if (/^(foot|lowerleg01)\.[LR]$/u.test(id)) return [`upperleg01.${side}`, `lowerleg01.${side}`, `foot.${side}`];
  return null;
}

export function humanPoseLimbFlex(rig: HumanPoseRig, pose: HumanPoseData, id: string): number {
  const chain = humanPoseLimb(id); if (!chain) throw new Error('肘または膝を選んでください');
  const world = humanPoseWorldMatrices(rig, pose), [a, b, c] = chain.map(name => posePoint(world, name));
  return MathUtils.radToDeg(b.clone().sub(a).angleTo(c.clone().sub(b)));
}

/** 肘・膝の直接回転も同じ曲げ平面で制限する。横倒しで逆関節を作らない。 */
export function setHumanPoseLimbFlex(rig: HumanPoseRig, pose: HumanPoseData, id: string, degrees: number): void {
  const chain = humanPoseLimb(id); if (!chain || chain[1] !== id || !Number.isFinite(degrees)) throw new Error('肘または膝の角度が不正です');
  const world = humanPoseWorldMatrices(rig, pose), [a, b, c] = chain.map(name => posePoint(world, name));
  const upper = b.clone().sub(a).normalize(), lower = c.clone().sub(b), length = lower.length();
  const normal = upper.clone().cross(lower).normalize();
  if (normal.lengthSq() < 1e-8) {
    normal.copy(upper).cross(new Vector3(0, 0, id.startsWith('lowerarm') ? -1 : 1)).normalize();
    if (normal.lengthSq() < 1e-8) normal.copy(upper).cross(new Vector3(1, 0, 0)).normalize();
  }
  const targetFlex = radians(MathUtils.clamp(degrees, 2, id.startsWith('lowerarm') ? 150 : 155));
  const endQ = worldRotation(world.get(chain[2])!), initial = humanPoseJointAngles(rig, pose, chain[2]);
  const target = b.clone().add(upper.applyAxisAngle(normal, targetFlex).multiplyScalar(length));
  aim(rig, pose, id, chain[2], target);
  setWorldRotation(rig, pose, chain[2], endQ);
  setHumanPoseJointAngles(rig, pose, chain[2], humanPoseJointAngles(rig, pose, chain[2]), initial);
}

/** 2本の長さを保持し、肘・膝の最大屈曲と伸び切りを制限する。poleは曲げる方向。 */
export function solveHumanPoseLimb(rig: HumanPoseRig, pose: HumanPoseData, chain: [string, string, string], target: Vector3, pole?: Vector3): void {
  const [upper, lower, end] = chain, worlds = humanPoseWorldMatrices(rig, pose);
  const a = posePoint(worlds, upper), b = posePoint(worlds, lower), c = posePoint(worlds, end);
  const lengthA = a.distanceTo(b), lengthB = b.distanceTo(c);
  if (lengthA < 1e-6 || lengthB < 1e-6) throw new Error('手足の長さが不正です');
  const initialUpper = new Quaternion(...pose.bones[upper].rotation);
  const endQ = worldRotation(worlds.get(end)!);
  const initialEndAngles = humanPoseJointAngles(rig, pose, end);
  const direction = target.clone().sub(a);
  if (direction.lengthSq() < 1e-12) direction.copy(c).sub(a);
  if (direction.lengthSq() < 1e-12) direction.set(0, -1, 0);
  const maxFlex = radians(upper.startsWith('upperarm') ? 150 : 155);
  const minReach = Math.sqrt(lengthA ** 2 + lengthB ** 2 + 2 * lengthA * lengthB * Math.cos(maxFlex));
  const maxReach = Math.sqrt(lengthA ** 2 + lengthB ** 2 + 2 * lengthA * lengthB * Math.cos(radians(2)));
  const distance = MathUtils.clamp(direction.length(), minReach, maxReach);
  direction.normalize();
  const bend = (pole ?? b).clone().sub(a);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend.set(0, 0, upper.startsWith('upperarm') ? -1 : 1);
    bend.addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0).addScaledVector(direction, -direction.x);
  }
  bend.normalize();
  const along = (lengthA ** 2 - lengthB ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, lengthA ** 2 - along ** 2));
  const desiredEnd = a.clone().addScaledVector(direction, distance);
  const desiredMiddle = a.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  aim(rig, pose, upper, lower, desiredMiddle);
  // 肩/股関節はrestからの球面上の回転に上限を設ける。
  const rest = new Quaternion(...rig.bones.find(bone => bone.name === upper)!.rest.rotation);
  const rotation = new Quaternion(...pose.bones[upper].rotation), angle = rest.angleTo(rotation);
  const limit = Math.max(radians(upper.startsWith('upperarm') ? 175 : 145), rest.angleTo(initialUpper));
  if (angle > limit) pose.bones[upper].rotation = rest.slerp(rotation, limit / angle).normalize().toArray() as PoseQuaternion;
  aim(rig, pose, lower, end, desiredEnd);
  const actualFlex = humanPoseLimbFlex(rig, pose, lower);
  if (actualFlex < 2 || actualFlex > MathUtils.radToDeg(maxFlex)) setHumanPoseLimbFlex(rig, pose, lower, actualFlex);
  setWorldRotation(rig, pose, end, endQ);
  setHumanPoseJointAngles(rig, pose, end, humanPoseJointAngles(rig, pose, end), initialEndAngles);
}

/** 手足は到達点、肘膝は曲げ方向、腰は足を保った移動、頭は背骨と首の追従。 */
export function moveHumanPoseHandle(rig: HumanPoseRig, source: HumanPoseData, id: string, target: Vector3): HumanPoseData {
  if (!target.toArray().every(Number.isFinite)) throw new Error('移動先が不正です');
  const pose = structuredClone(source), chain = humanPoseLimb(id);
  if (/^finger[1-5]-tip\.[LR]$/u.test(id)) {
    solveFingerTip(rig, pose, id, target); return pose;
  }
  if (/^foot-tip\.[LR]$/u.test(id)) {
    const side = id.slice(-1) as 'L' | 'R';
    if (humanPoseFootPoints(rig, pose, side)[3].distanceTo(target) < 1e-7) return pose;
    // 先端から板の曲げを合わせ、残りの移動は脚へ伝える。
    fitAngles(rig, pose, [`footBall.${side}`, `footArch.${side}`, `foot.${side}`], target, () => humanPoseFootPoints(rig, pose, side)[3]);
    const worlds = humanPoseWorldMatrices(rig, pose), ankle = posePoint(worlds, `foot.${side}`);
    const offset = humanPoseFootPoints(rig, pose, side, worlds)[3].sub(ankle);
    solveHumanPoseLimb(rig, pose, humanPoseLimb(`foot.${side}`)!, target.clone().sub(offset)); return pose;
  }
  if (target.distanceTo(posePoint(humanPoseWorldMatrices(rig, source), id)) < 1e-7) return pose;
  if (chain) {
    const worlds = humanPoseWorldMatrices(rig, pose);
    solveHumanPoseLimb(rig, pose, chain, id === chain[1] ? posePoint(worlds, chain[2]) : target, id === chain[1] ? target : undefined);
  } else if (id === 'spine04') {
    const worlds = humanPoseWorldMatrices(rig, source), start = posePoint(worlds, id), delta = target.clone().sub(start);
    const feet = ['L', 'R'].map(side => ({ chain: humanPoseLimb(`foot.${side}`)!, anchor: posePoint(worlds, `foot.${side}`) }));
    const reach = feet.map(({ chain: [a, b, c] }) => ({ hip: posePoint(worlds, a), a: posePoint(worlds, a).distanceTo(posePoint(worlds, b)), b: posePoint(worlds, b).distanceTo(posePoint(worlds, c)) }));
    const feasible = (fraction: number) => reach.every((v, i) => {
      const distance = v.hip.clone().addScaledVector(delta, fraction).distanceTo(feet[i].anchor);
      return distance <= v.a + v.b - 1e-5 && distance >= Math.sqrt(v.a * v.a + v.b * v.b + 2 * v.a * v.b * Math.cos(radians(155)));
    });
    let fraction = 1;
    if (!feasible(1)) { let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (feasible(mid)) lo = mid; else hi = mid; } fraction = lo; }
    const trial = (f: number) => {
      const candidate = structuredClone(source);
      candidate.root.translation = new Vector3(...source.root.translation).addScaledVector(delta, f).toArray() as PoseVector;
      for (const { chain, anchor } of feet) solveHumanPoseLimb(rig, candidate, chain, anchor);
      return candidate;
    };
    const anchored = (candidate: HumanPoseData) => {
      const world = humanPoseWorldMatrices(rig, candidate);
      return feet.every(({ chain, anchor }) => posePoint(world, chain[2]).distanceTo(anchor) < 1e-4);
    };
    let candidate = trial(fraction);
    if (!anchored(candidate)) {
      let lo = 0, hi = fraction; candidate = structuredClone(source);
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2, attempt = trial(mid); if (anchored(attempt)) { lo = mid; candidate = attempt; } else hi = mid; }
    }
    return candidate;
  } else if (id === 'head') {
    // CCD。骨の長さを変えず、首と胸・腰へ小さく分配する。
    for (let iteration = 0; iteration < 8; iteration++) for (const bone of ['neck01', 'spine02', 'spine04']) {
      aim(rig, pose, bone, 'head', target);
      setHumanPoseJointAngles(rig, pose, bone, humanPoseJointAngles(rig, pose, bone));
    }
  }
  return pose;
}

/** 制限した角度で座標降下し、先端を近づける。各segmentの長さは変えない。 */
function fitAngles(rig: HumanPoseRig, pose: HumanPoseData, chain: string[], target: Vector3, endpoint: () => Vector3): void {
  const baseline = chain.map(id => humanPoseJointAngles(rig, pose, id));
  for (const step of [20, 12, 6, 3, 1]) for (let iteration = 0; iteration < 3; iteration++) {
    for (const [index, id] of chain.entries()) {
      const axes = id.startsWith('foot') ? [0] : [0, 2];
      for (const axis of axes) {
        const initial = humanPoseJointAngles(rig, pose, id); let best = initial, distance = endpoint().distanceToSquared(target);
        for (const sign of [-1, 1]) {
          const next = [...initial] as PoseVector; next[axis] += step * sign;
          setHumanPoseJointAngles(rig, pose, id, next, baseline[index]);
          const candidate = endpoint().distanceToSquared(target);
          if (candidate < distance) { best = humanPoseJointAngles(rig, pose, id); distance = candidate; }
        }
        setHumanPoseJointAngles(rig, pose, id, best, baseline[index]);
      }
    }
    if (endpoint().distanceToSquared(target) < 1e-8) return;
  }
}
function solveFingerTip(rig: HumanPoseRig, pose: HumanPoseData, id: string, target: Vector3): void {
  if (humanPoseFingerTip(rig, pose, id).distanceTo(target) < 1e-7) return;
  const chain = [3, 2, 1].map(n => id.replace('-tip.', `-${n}.`)), initial = chain.map(bone => humanPoseJointAngles(rig, pose, bone));
  let best = initial, distance = humanPoseFingerTip(rig, pose, id).distanceToSquared(target);
  // 伸びた指は1関節だけの探索で局所解になりやすいため、連動した曲げも候補にする。
  for (const curl of [-80, -40, -20, 20, 40, 60, 80]) {
    chain.forEach((bone, i) => setHumanPoseJointAngles(rig, pose, bone, [initial[i][0] + curl, initial[i][1], initial[i][2]], initial[i]));
    const error = humanPoseFingerTip(rig, pose, id).distanceToSquared(target);
    if (error < distance) { distance = error; best = chain.map(bone => humanPoseJointAngles(rig, pose, bone)); }
  }
  chain.forEach((bone, i) => setHumanPoseJointAngles(rig, pose, bone, best[i], initial[i]));
  fitAngles(rig, pose, chain, target, () => humanPoseFingerTip(rig, pose, id));
}
