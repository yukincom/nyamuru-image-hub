import { Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { humanPoseWorldMatrices } from './humanPoseMirror.ts';
import { HUMAN_POSE_HANDLES, HUMAN_POSE_JOINTS, humanPoseFingerTip, humanPoseFootPoints, posePoint, worldRotation } from './humanPoseJoints.ts';
import { disposeThreeObject } from './threeSceneResources.ts';
import type { HumanPoseData, HumanPoseRig } from './humanPoseTypes.ts';

export function humanPoseSkeletonPoints(rig: HumanPoseRig, pose?: HumanPoseData): Map<string, Vector3> {
  const worlds = humanPoseWorldMatrices(rig, pose), rest = humanPoseWorldMatrices(rig);
  const points = new Map<string, Vector3>();
  for (const { id } of HUMAN_POSE_JOINTS) if (worlds.has(id)) points.set(id, posePoint(worlds, id));
  const headLength = Math.max(.14, posePoint(rest, 'head').distanceTo(posePoint(rest, 'neck01')) * 1.8);
  points.set('headCentre', new Vector3(0, headLength * .43, 0).applyMatrix4(worlds.get('head')!));
  points.set('headTop', new Vector3(0, headLength, 0).applyMatrix4(worlds.get('head')!));
  for (const side of ['L', 'R'] as const) {
    const foot = humanPoseFootPoints(rig, pose, side, worlds);
    ['heel', 'footArch', 'footBall', 'foot-tip'].forEach((id, i) => points.set(`${id}.${side}`, foot[i]));
    for (let f = 1; f <= 5; f++) {
      const id = `finger${f}-tip.${side}`; points.set(id, humanPoseFingerTip(rig, pose, id, worlds));
    }
    const inverse = rest.get(`foot.${side}`)!.clone().invert();
    const across = new Vector3(.027, 0, 0).transformDirection(inverse).transformDirection(worlds.get(`foot.${side}`)!).multiplyScalar(.027);
    foot.forEach((p, i) => {
      points.set(`plate${i}a.${side}`, p.clone().add(across)); points.set(`plate${i}b.${side}`, p.clone().sub(across));
    });
  }
  return points;
}

export class HumanPoseSkeleton {
  readonly scene = new Group();
  readonly handles = new Group();
  readonly nativeHeight: number;
  private head = new Mesh(new SphereGeometry(1, 16, 12), new MeshStandardMaterial({ color: '#dfe6e5', roughness: .85 }));
  private plates = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: '#aabfbb', side: DoubleSide, transparent: true, opacity: .35 }));
  private lines = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ linewidth: 2.4, vertexColors: true }));
  private markers = new Map<string, Mesh>();
  points = new Map<string, Vector3>();
  private detail = true;
  private selected = '';
  readonly rig: HumanPoseRig;
  constructor(rig: HumanPoseRig) {
    this.rig = rig;
    const rest = humanPoseSkeletonPoints(rig);
    this.nativeHeight = rest.get('headTop')!.y - Math.min(rest.get('heel.L')!.y, rest.get('heel.R')!.y);
    this.scene.add(this.lines, this.plates, this.head, this.handles);
    for (const def of HUMAN_POSE_HANDLES) {
      // 頭の球そのものを掴める。球の上に点を置くと目に見えるため重ねない。
      if (def.id === 'head') continue;
      const marker = new Mesh(new SphereGeometry(1, 8, 6), new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: .9 }));
      marker.renderOrder = 10; this.markers.set(def.id, marker); this.handles.add(marker);
    }
  }
  showDetails(show: boolean, selected = this.selected): void { this.detail = show; this.selected = selected; this.updateMarkers(); }
  private updateMarkers(): void {
    for (const def of HUMAN_POSE_HANDLES) {
      const marker = this.markers.get(def.id); if (!marker) continue;
      marker.visible = !def.detail || this.detail;
      marker.position.copy(this.points.get(def.id) ?? new Vector3());
      const main = /^(spine04|wrist|foot\.|foot-tip|lowerarm|lowerleg)/u.test(def.id);
      marker.scale.setScalar(def.detail ? (def.id.includes('-tip.') ? .008 : .005) : main ? .018 : .009);
      (marker.material as MeshBasicMaterial).color.set(def.id === this.selected ? '#ffab32' : def.id.endsWith('.L') ? '#197c72' : def.id.endsWith('.R') ? '#bf5267' : '#405d69');
    }
  }
  applyPose(pose: HumanPoseData): void {
    this.points = humanPoseSkeletonPoints(this.rig, pose);
    const positions: number[] = [], colors: number[] = [], triangles: number[] = [];
    const edge = (a: string, b: string) => {
      positions.push(...this.points.get(a)!.toArray(), ...this.points.get(b)!.toArray());
      const color = new Color(a.endsWith('.L') || b.endsWith('.L') ? '#197c72' : a.endsWith('.R') || b.endsWith('.R') ? '#bf5267' : '#405d69');
      colors.push(...color.toArray(), ...color.toArray());
    };
    edge('spine04', 'spine02'); edge('spine02', 'neck01'); edge('neck01', 'head');
    edge('upperarm01.L', 'upperarm01.R'); edge('upperleg01.L', 'upperleg01.R');
    for (const side of ['L', 'R']) {
      for (const [a, b] of [['neck01', `upperarm01.${side}`], ['spine04', `upperleg01.${side}`], [`upperarm01.${side}`, `lowerarm01.${side}`], [`lowerarm01.${side}`, `wrist.${side}`], [`upperleg01.${side}`, `lowerleg01.${side}`], [`lowerleg01.${side}`, `foot.${side}`], [`foot.${side}`, `heel.${side}`]]) edge(a, b);
      for (let f = 1; f <= 5; f++) {
        edge(`wrist.${side}`, `finger${f}-1.${side}`); edge(`finger${f}-1.${side}`, `finger${f}-2.${side}`); edge(`finger${f}-2.${side}`, `finger${f}-3.${side}`); edge(`finger${f}-3.${side}`, `finger${f}-tip.${side}`);
        if (f < 5) edge(`finger${f}-1.${side}`, `finger${f + 1}-1.${side}`);
      }
      for (let i = 0; i < 4; i++) {
        edge(`plate${i}a.${side}`, `plate${i}b.${side}`);
        if (i === 3) continue;
        edge(`plate${i}a.${side}`, `plate${i + 1}a.${side}`); edge(`plate${i}b.${side}`, `plate${i + 1}b.${side}`);
        for (const id of [`plate${i}a`, `plate${i}b`, `plate${i + 1}a`, `plate${i}b`, `plate${i + 1}b`, `plate${i + 1}a`]) triangles.push(...this.points.get(`${id}.${side}`)!.toArray());
      }
    }
    this.lines.geometry.dispose(); this.lines.geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors); this.lines.computeLineDistances();
    this.plates.geometry.dispose(); this.plates.geometry = new BufferGeometry(); this.plates.geometry.setAttribute('position', new Float32BufferAttribute(triangles, 3));
    const radius = this.points.get('headTop')!.distanceTo(this.points.get('headCentre')!);
    this.head.position.copy(this.points.get('headCentre')!); this.head.scale.setScalar(radius);
    this.head.quaternion.copy(worldRotation(humanPoseWorldMatrices(this.rig, pose).get('head')!));
    this.updateMarkers();
  }
  bounds(): Box3 { return new Box3().setFromPoints([...this.points.values()]); }
  dispose(): void { disposeThreeObject(this.scene); }
}
