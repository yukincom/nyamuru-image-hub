import type { HumanPoseMotionLibrary } from './humanPoseMotion.ts';
let pending: Promise<HumanPoseMotionLibrary> | undefined;
export function loadHumanPoseMotionLibrary(): Promise<HumanPoseMotionLibrary> {
  return pending ??= import('../assets/human-pose-motions/quaternius-standard.json').then(module => module.default as HumanPoseMotionLibrary);
}
