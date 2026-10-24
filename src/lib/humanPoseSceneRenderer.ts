import { AmbientLight, ArrowHelper, Box3, BoxGeometry, BufferGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, GridHelper, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, RingGeometry, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { applyBackgroundCameraShift, focusBackgroundCamera } from './background3dCamera.ts';
import { changeHumanPoseMotion, sampleHumanPoseMotion, type HumanPoseMotionLibrary } from './humanPoseMotion.ts';
import { loadHumanPoseMotionLibrary } from './humanPoseMotionLibrary.ts';
import { HumanPoseSkeleton } from './humanPoseSkeleton.ts';
import { editedHumanPose, humanPoseEdits, humanPoseJointAngles, setHumanPoseJointAngles, HUMAN_POSE_HANDLES } from './humanPoseJoints.ts';
import { moveHumanPoseHandle, humanPoseLimbFlex, setHumanPoseLimbFlex } from './humanPoseIk.ts';
import { humanPoseWorldMatrices } from './humanPoseMirror.ts';
import { humanPoseCameraFacing, humanPoseSceneFrame, sameHumanPoseSource, validateHumanPoseScene } from './humanPoseScene.ts';
import { disposeThreeObject } from './threeSceneResources.ts';
import type { HumanPoseCameraSubject, HumanPoseRig, HumanPoseData, HumanPoseSceneAssets, HumanPoseSceneSettings, HumanPoseSurfaceAnchor, PoseVector } from './humanPoseTypes.ts';
import type { BackgroundStage } from '../types.ts';
import { CUBE_STAGE_ID } from './background3d.ts';
import { loadBackgroundStage } from './backgroundStageStore.ts';
import { loadStageShape, stageClipPlanes, type StageShape } from './background3dRenderer.ts';
import { applyBackgroundVisibility, prepareBackgroundCutaway, visibleCutawayMeshes, type BackgroundCutawayModel } from './background3dCutaway.ts';
import { pickBackgroundSurface } from './background3dSurfacePick.ts';
import { alignHumanPoseSurface, humanPoseBodyFacing, humanPosePlacementScale, humanPoseSurfaceAligned, humanPoseSurfaceFromHit, wrapHumanPoseDegrees } from './humanPoseSurfacePlacement.ts';

export interface HumanPoseBackground { sourceId: string; shape: StageShape }
export async function loadHumanPoseBackground(sourceId: string, stages: BackgroundStage[]): Promise<HumanPoseBackground> {
  if (sourceId === CUBE_STAGE_ID) return { sourceId, shape: await loadStageShape() };
  const stage = stages.find(item => item.id === sourceId);
  if (!stage) throw new Error('保存した3D舞台が見つかりません。舞台を含む作品を開き直してください');
  return { sourceId, shape: await loadStageShape(stage, await loadBackgroundStage(stage)) };
}

/** 1件だけ開き、closeでGPU資源も解放する。体勢は登録姿勢から導出する。 */
export class HumanPoseSceneRenderer {
  readonly canvas!: HTMLCanvasElement;
  private renderer!: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera();
  private placement = new Group();
  private runtime: HumanPoseSkeleton;
  private rig: HumanPoseRig;
  private detail = true;
  private handleDrag?: { id: string; scene: HumanPoseSceneSettings; plane: Plane; offset: Vector3; x: number; y: number; mode: 'move' | 'rotate'; start: Vector3; normal: Vector3 };
  private basePose: HumanPoseData;
  private motions: HumanPoseMotionLibrary;
  private supports: Mesh[] = [];
  private grid = new GridHelper(10, 20, '#a8b8bb', '#d1d8d9');
  private surfaceMarker = new Group();
  private surfaceArrow = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(), .3, '#e18b16', .07, .045);
  private settings: HumanPoseSceneSettings;
  private backgroundGroup = new Group();
  private background?: HumanPoseBackground;
  private cutaway?: BackgroundCutawayModel;
  private observer?: ResizeObserver;
  private disposed = false;

  static async create(host: HTMLElement, assets: HumanPoseSceneAssets, saved?: HumanPoseSceneSettings, aspect = 1, background?: HumanPoseBackground): Promise<HumanPoseSceneRenderer> {
    if (saved) {
      validateHumanPoseScene(saved);
      if (!sameHumanPoseSource(saved.source, assets.source)) throw new Error('保存した撮影設定と素材の版が異なります');
    }
    const motions = await loadHumanPoseMotionLibrary();
    if (saved?.motion) sampleHumanPoseMotion(motions, assets.rig, assets.pose, saved.motion);
    const runtime = new HumanPoseSkeleton(assets.rig);
    try { runtime.applyPose(assets.pose); }
    catch (error) { runtime.dispose(); throw error; }
    return new HumanPoseSceneRenderer(host, assets, runtime, saved, aspect, motions, background);
  }

  private constructor(host: HTMLElement, assets: HumanPoseSceneAssets, runtime: HumanPoseSkeleton, saved: HumanPoseSceneSettings | undefined, aspect: number, motions: HumanPoseMotionLibrary, background?: HumanPoseBackground) {
    this.motions = motions; this.runtime = runtime; this.rig = assets.rig; this.basePose = structuredClone(assets.pose);
    this.settings = structuredClone(saved ?? {
      version: 1, source: assets.source, stature_m: 1.57, placement: { position: [0, 0, 0], yaw_degrees: 0 },
      camera: { position: [3, 2, 5], target: [0, 1, 0], fov: 40 }, projection: 'perspective', up: [0, 1, 0], frame: humanPoseSceneFrame(aspect),
    });
    this.placement.add(runtime.scene);
    this.scene.add(this.placement, this.grid, this.backgroundGroup, this.surfaceMarker);
    try {
      const ring = new Mesh(new RingGeometry(.07, .09, 32), new MeshBasicMaterial({ color: '#e18b16', side: DoubleSide, depthTest: false }));
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 11;
      this.surfaceMarker.add(ring, this.surfaceArrow);
      const grey = new MeshStandardMaterial({ color: '#b3b3b3', roughness: .9 });
      // 登録された支持物だけを描画し、床や椅子を推測して追加しない。
      for (const support of assets.pose.supports) {
        if (!support.position?.every(Number.isFinite) || support.position.length !== 3) throw new Error('支持物の位置が不正です');
        let geometry;
        if (support.kind === 'box' && support.size.length === 3 && support.size.every(v => Number.isFinite(v) && v > 0 && v <= 100)) geometry = new BoxGeometry(...support.size);
        else if (support.kind === 'cylinder' && Number.isFinite(support.radius) && support.radius > 0 && support.radius <= 100
          && Number.isFinite(support.height) && support.height > 0 && support.height <= 100) geometry = new CylinderGeometry(support.radius, support.radius, support.height, 24);
        else throw new Error('支持物の形状が不正です');
        const mesh = new Mesh(geometry, grey); mesh.position.fromArray(support.position); this.placement.add(mesh); this.supports.push(mesh);
      }
      this.scene.add(new AmbientLight('#ffffff', 2));
      const light = new DirectionalLight('#ffffff', 3); light.position.set(3, 5, 4); this.scene.add(light);
      this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
      this.canvas = this.renderer.domElement;
      this.canvas.setAttribute('aria-label', '人体ポーズの3D表示');
      this.renderer.setClearColor('#ffffff', 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.append(this.canvas);
      const resize = () => { if (!this.disposed) { this.renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight)); this.render(); } };
      this.observer = new ResizeObserver(resize); this.observer.observe(host);
      this.updatePlacement();
      if (!saved) this.settings.camera = focusBackgroundCamera(this.settings.camera, this.bounds(), this.settings.frame.width / this.settings.frame.height);
      this.replaceBackground(background, this.settings); resize();
    } catch (error) { this.dispose(); throw error; }
  }

  get motionClips() { return this.motions.clips; }
  private baseline(settings: HumanPoseSceneSettings): HumanPoseData {
    return settings.motion ? sampleHumanPoseMotion(this.motions, this.rig, this.basePose, settings.motion) : this.basePose;
  }
  changeMotion(clipId: string, phase: number, settings = this.settings): HumanPoseSceneSettings {
    return changeHumanPoseMotion(this.motions, this.rig, this.basePose, settings, clipId, phase);
  }
  snapshot(): HumanPoseSceneSettings { return structuredClone(this.settings); }
  centre(): PoseVector { return this.runtime.bounds().applyMatrix4(this.placement.matrixWorld).getCenter(new Vector3()).toArray(); }
  cameraSubject(): HumanPoseCameraSubject {
    const pose = editedHumanPose(this.rig, this.baseline(this.settings), this.settings);
    return { centre: this.centre(), world_facing_degrees: humanPoseCameraFacing(this.rig, pose, this.settings.placement.yaw_degrees) };
  }
  private bounds(): Box3 {
    const bounds = this.runtime.bounds().applyMatrix4(this.placement.matrixWorld);
    for (const mesh of this.supports) if (mesh.visible) bounds.union(new Box3().setFromObject(mesh, true));
    return bounds;
  }
  private updatePlacement(): void {
    this.placement.position.fromArray(this.settings.placement.position);
    this.placement.rotation.set(0, this.settings.placement.yaw_degrees * Math.PI / 180, 0);
    this.placement.scale.setScalar(humanPosePlacementScale(this.settings, this.runtime.nativeHeight));
    for (const support of this.supports) support.visible = !this.settings.motion && this.settings.show_supports !== false;
    this.grid.visible = !this.background;
    const surface = this.settings.background?.surface;
    this.surfaceMarker.visible = Boolean(surface);
    if (surface) {
      this.surfaceMarker.position.fromArray(surface.point);
      this.surfaceMarker.position.y += .002 * this.placement.scale.x;
      this.surfaceMarker.scale.copy(this.placement.scale);
      this.surfaceArrow.visible = surface.facing_degrees !== undefined;
      if (surface.facing_degrees !== undefined) this.surfaceArrow.setDirection(new Vector3(Math.sin(surface.facing_degrees * Math.PI / 180), 0, Math.cos(surface.facing_degrees * Math.PI / 180)));
    }
    this.scene.updateMatrixWorld(true);
  }
  /** 読み込み成功後だけ舞台を交換し、旧geometry/materialを解放する。 */
  replaceBackground(background: HumanPoseBackground | undefined, settings: HumanPoseSceneSettings): void {
    validateHumanPoseScene(settings);
    if (background?.sourceId !== settings.background?.sourceId) throw new Error('背景モデルと保存する舞台が一致しません');
    const group = new Group();
    try {
      if (background) {
        const material = new MeshStandardMaterial({ color: '#ccd5d4', roughness: 1, side: DoubleSide });
        for (const mesh of background.shape.meshes) {
          const geometry = new BufferGeometry();
          geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3)); geometry.setIndex(mesh.indices); geometry.computeVertexNormals();
          group.add(new Mesh(geometry, material));
        }
      }
    } catch (error) { disposeThreeObject(group); throw error; }
    disposeThreeObject(this.backgroundGroup); this.backgroundGroup.removeFromParent();
    this.backgroundGroup = group; this.background = background;
    this.cutaway = background && prepareBackgroundCutaway(background.shape.meshes, background.shape.groups, background.shape);
    this.scene.add(group); this.apply(settings);
  }
  apply(settings: HumanPoseSceneSettings): void {
    validateHumanPoseScene(settings);
    if (!sameHumanPoseSource(settings.source, this.settings.source)) throw new Error('保存した撮影設定と素材の版が異なります');
    if (settings.background?.sourceId !== this.background?.sourceId) throw new Error('背景モデルの読み込みが必要です');
    const pose = editedHumanPose(this.rig, this.baseline(settings), settings);
    this.runtime.applyPose(pose);
    for (const [index, mesh] of this.supports.entries()) if (pose.supports[index]) mesh.position.fromArray(pose.supports[index].position);
    this.settings = structuredClone(settings); this.updatePlacement(); this.render();
  }
  selectJoint(id: string, details = this.detail): void {
    this.detail = details; this.runtime.showDetails(details, id); this.render();
  }
  jointAngles(id: string, settings = this.settings): PoseVector {
    const pose = editedHumanPose(this.rig, this.baseline(settings), settings);
    return /^(lowerarm|lowerleg)/u.test(id) ? [humanPoseLimbFlex(this.rig, pose, id), 0, 0] : humanPoseJointAngles(this.rig, pose, id);
  }
  rotateJoint(id: string, angles: PoseVector, settings = this.settings): HumanPoseSceneSettings {
    const pose = editedHumanPose(this.rig, this.baseline(settings), settings);
    if (/^(lowerarm|lowerleg)/u.test(id)) setHumanPoseLimbFlex(this.rig, pose, id, angles[0]);
    else setHumanPoseJointAngles(this.rig, pose, id, angles, humanPoseJointAngles(this.rig, pose, id));
    return { ...structuredClone(settings), joint_edits: humanPoseEdits(this.rig, this.baseline(settings), pose, settings.body_mirror === 'mirrored', settings.joint_edits) };
  }
  focusJoint(id: string): HumanPoseSceneSettings {
    const point = this.runtime.points.get(id === 'head' ? 'headCentre' : id); if (!point) return this.snapshot();
    const world = this.placement.localToWorld(point.clone());
    const offset = new Vector3(...this.settings.camera.position).sub(new Vector3(...this.settings.camera.target)).normalize().multiplyScalar(.55 * (this.settings.placement.scale ?? 1));
    return { ...this.snapshot(), camera: { ...this.settings.camera, target: world.toArray(), position: world.clone().add(offset).toArray(), shift: [0, 0] } };
  }
  private pointerRay(x: number, y: number): Raycaster {
    const rect = this.canvas.getBoundingClientRect(), ray = new Raycaster();
    ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera); return ray;
  }
  private bodyFacing(): number | undefined { return humanPoseBodyFacing(this.rig, editedHumanPose(this.rig, this.baseline(this.settings), this.settings)); }
  surfaceAligned(): boolean { return Boolean(this.settings.background?.surface) && humanPoseSurfaceAligned(this.settings, this.runtime.points, this.runtime.nativeHeight, this.bodyFacing()); }
  alignSurface(surface = this.settings.background?.surface): HumanPoseSceneSettings {
    if (!surface || !this.backgroundGroup.children[surface.surfaceMesh]?.visible) throw new Error('選んだ床・座面がありません。面を表示して選び直してください');
    return alignHumanPoseSurface(this.settings, this.runtime.points, this.runtime.nativeHeight, this.bodyFacing(), surface);
  }
  placeOnSurface(x: number, y: number, anchor: HumanPoseSurfaceAnchor): HumanPoseSceneSettings {
    if (!this.background) throw new Error('先に3D舞台を選んでください');
    const hit = pickBackgroundSurface(this.backgroundGroup.children, this.pointerRay(x, y));
    if (!hit) throw new Error('背景の面が見つかりません。床や座面が見える位置で選んでください');
    const surface = humanPoseSurfaceFromHit(hit, anchor), facing = this.bodyFacing();
    if (anchor === 'hips' && facing !== undefined) surface.facing_degrees = wrapHumanPoseDegrees(facing + this.settings.placement.yaw_degrees);
    return this.alignSurface(surface);
  }
  pointSurfaceForward(x: number, y: number): HumanPoseSceneSettings {
    const surface = this.settings.background?.surface;
    if (!surface) throw new Error('先に床・座面を選んでください');
    const origin = new Vector3(...surface.point), plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), origin);
    const point = this.pointerRay(x, y).ray.intersectPlane(plane, new Vector3());
    if (!point || point.distanceTo(origin) < .01 * this.placement.scale.x) throw new Error('選んだ位置から少し離れた、身体を向ける側をクリックしてください');
    const facing_degrees = Math.atan2(point.x - origin.x, point.z - origin.z) * 180 / Math.PI;
    return this.alignSurface({ ...surface, facing_degrees });
  }
  beginHandleDrag(x: number, y: number, mode: 'move' | 'rotate'): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const hits = HUMAN_POSE_HANDLES.filter(joint => !joint.detail || this.detail).map(({ id }) => {
      const local = this.runtime.points.get(id === 'head' ? 'headCentre' : id)!;
      const world = this.placement.localToWorld(local.clone()), screen = world.clone().project(this.camera);
      const distance = Math.hypot(rect.left + (screen.x + 1) * rect.width / 2 - x, rect.top + (1 - screen.y) * rect.height / 2 - y);
      return { id, world, distance: screen.z < -1 || screen.z > 1 ? Infinity : distance };
    }).filter(hit => hit.distance <= 14).sort((a, b) => a.distance - b.distance);
    const hit = hits[0]; if (!hit) return null;
    this.selectJoint(hit.id);
    const normal = this.camera.getWorldDirection(new Vector3()), plane = new Plane().setFromNormalAndCoplanarPoint(normal, hit.world);
    const cursor = this.pointerRay(x, y).ray.intersectPlane(plane, new Vector3()); if (!cursor) return null;
    this.handleDrag = { id: hit.id, scene: this.snapshot(), plane, offset: hit.world.clone().sub(cursor), x, y, mode, start: hit.world, normal };
    return hit.id;
  }
  dragHandle(x: number, y: number, depth = false): HumanPoseSceneSettings | null {
    const drag = this.handleDrag; if (!drag) return null;
    const pose = editedHumanPose(this.rig, this.baseline(drag.scene), drag.scene);
    if (!drag.id.includes('-tip.') && (drag.mode === 'rotate' || /^(finger|footArch|footBall|upperarm|upperleg|neck|spine02)/u.test(drag.id))) {
      const angles = this.jointAngles(drag.id, drag.scene);
      angles[0] += (y - drag.y) * .5; angles[2] += (x - drag.x) * .5;
      return this.rotateJoint(drag.id, angles, drag.scene);
    }
    let point: Vector3 | null;
    if (depth) point = drag.start.clone().addScaledVector(drag.normal, (y - drag.y) * this.camera.position.distanceTo(drag.start) / this.canvas.getBoundingClientRect().height);
    else point = this.pointerRay(x, y).ray.intersectPlane(drag.plane, new Vector3())?.add(drag.offset) ?? null;
    if (!point) return null;
    point = this.placement.worldToLocal(point);
    // 頭の球の中心と首の付け根の差を維持して解く。
    if (drag.id === 'head') {
      const worldStart = this.placement.worldToLocal(drag.start.clone());
      point.sub(worldStart.clone().sub(new Vector3().setFromMatrixPosition(humanPoseWorldMatrices(this.rig, pose).get('head')!)));
    }
    const moved = moveHumanPoseHandle(this.rig, pose, drag.id, point);
    return { ...structuredClone(drag.scene), joint_edits: humanPoseEdits(this.rig, this.baseline(drag.scene), moved, drag.scene.body_mirror === 'mirrored', drag.scene.joint_edits) };
  }
  endHandleDrag(cancel = false): HumanPoseSceneSettings | null {
    const start = this.handleDrag?.scene; this.handleDrag = undefined;
    return cancel && start ? structuredClone(start) : null;
  }
  focus(): HumanPoseSceneSettings {
    return { ...this.snapshot(), camera: focusBackgroundCamera(this.settings.camera, this.bounds(), this.settings.frame.width / this.settings.frame.height) };
  }
  focusBackground(): HumanPoseSceneSettings {
    if (!this.background) return this.focus();
    return { ...this.snapshot(), camera: focusBackgroundCamera(this.settings.camera, this.background.shape.bounds.clone().union(this.bounds()), this.settings.frame.width / this.settings.frame.height) };
  }
  placeAtBackgroundCentre(): HumanPoseSceneSettings {
    if (!this.background) return this.snapshot();
    const centre = this.background.shape.bounds.getCenter(new Vector3());
    return { ...this.snapshot(), placement: { ...this.settings.placement, position: [centre.x, this.settings.placement.position[1], centre.z] } };
  }
  private render(): void {
    if (this.disposed) return;
    this.camera.position.fromArray(this.settings.camera.position);
    this.camera.up.fromArray(this.settings.up); this.camera.lookAt(new Vector3(...this.settings.camera.target));
    this.camera.fov = this.settings.camera.fov;
    this.camera.aspect = this.settings.frame.width / this.settings.frame.height;
    const bounds = this.background ? this.background.shape.bounds.clone().union(this.bounds()) : this.bounds();
    const clips = stageClipPlanes({ meshes: [], bounds }, this.camera);
    this.camera.near = clips.near; this.camera.far = clips.far;
    if (this.cutaway) {
      const visible = applyBackgroundVisibility(this.cutaway,
        visibleCutawayMeshes(this.cutaway, this.settings.camera, this.settings.background?.cutaway), this.settings.background?.objectVisibility);
      const indices = visible && new Set(visible);
      this.backgroundGroup.children.forEach((mesh, index) => { mesh.visible = !indices || indices.has(index); });
    }
    applyBackgroundCameraShift(this.camera, this.settings.camera); this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  capture(includeBackground = false): string {
    if (this.disposed) throw new Error('3D表示は閉じられています');
    const { width, height } = this.settings.frame;
    const target = new WebGLRenderTarget(width, height, { samples: 4 });
    target.texture.colorSpace = SRGBColorSpace;
    const handlesVisible = this.runtime.handles.visible;
    const previous = this.renderer.getRenderTarget(), gridVisible = this.grid.visible, backgroundVisible = this.backgroundGroup.visible, surfaceVisible = this.surfaceMarker.visible;
    try {
      this.runtime.handles.visible = false; this.surfaceMarker.visible = false; this.grid.visible = false; this.backgroundGroup.visible = false; this.renderer.setRenderTarget(target); this.render();
      const pixels = new Uint8Array(width * height * 4); this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      let visible = false;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
      if (!visible) throw new Error('撮影範囲に素体がありません。「全体を収める」でカメラを調整してください');
      if (includeBackground) {
        // readRenderTargetPixelsは読取用framebufferを残す。2回目の描画前にMSAAの書込先を戻す。
        this.backgroundGroup.visible = true; this.renderer.setRenderTarget(target); this.render();
        this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      }
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('撮影PNGを作成できません');
      const data = context.createImageData(width, height);
      for (let y = 0; y < height; y++) data.data.set(pixels.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4);
      // MSAAの輪郭は透明な背景との平均値。ImageDataが要求する非乗算alphaへ戻す。
      for (let i = 0; i < data.data.length; i += 4) {
        const alpha = data.data[i + 3];
        if (alpha > 0 && alpha < 255) for (let c = 0; c < 3; c++) data.data[i + c] = Math.round(data.data[i + c] * 255 / alpha);
      }
      context.putImageData(data, 0, 0); return canvas.toDataURL('image/png');
    } finally { this.runtime.handles.visible = handlesVisible; this.surfaceMarker.visible = surfaceVisible; this.renderer.setRenderTarget(previous); this.grid.visible = gridVisible; this.backgroundGroup.visible = backgroundVisible; target.dispose(); this.render(); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.observer?.disconnect(); disposeThreeObject(this.scene);
    this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.canvas?.remove();
  }
}
