import { Box3, BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, NoBlending, PerspectiveCamera, Raycaster, Scene, Texture, TextureLoader, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Material, Object3D } from 'three';
import { disposeThreeObject as disposeObject, embeddedSceneManager, loadEmbeddedGlb } from './threeSceneResources.ts';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BackgroundCapture, BackgroundStage, PaintLayer, VectorPath } from '../types.ts';
import { type BackgroundEdge, type GeometryMesh } from './background3dGeometry.ts';
import { BackgroundLineComputer, type BackgroundLineView } from './background3dLines.ts';
import { applyBackgroundVisibility, prepareBackgroundCutaway, visibleCutawayMeshes, type BackgroundCutawayModel } from './background3dCutaway.ts';
import { backgroundFocusTargets, keepBackgroundFocusVisible, type BackgroundFocusTarget } from './background3dFocusTarget.ts';
import { backgroundFocusContains, backgroundFocusRegion } from './background3dFocusGeometry.ts';
import { applyBackgroundCameraShift, pivotBackgroundCamera, shiftBackgroundCamera } from './background3dCamera.ts';
import { backgroundSelectionOutline } from './background3dSelection.ts';
import { BackgroundLighting } from './background3dLighting.ts';
import { backgroundSurfaceSize, type BackgroundSurfaceInput } from './background3dSurface.ts';
import { BackgroundSurfaceComputer, type BackgroundSurfaceResult } from './background3dSurfaceComputer.ts';
import { applyPaintTone } from './paintTone.ts';
import { newPaintLayer } from './paintDocument.ts';
import { defaultVectorStyle } from './vectorGeometry.ts';
import { imageCrop, prepareImageAsset } from './imagePlacement.ts';
import { pickBackgroundSurface } from './background3dSurfacePick.ts';

export interface StageShape { meshes:GeometryMesh[]; bounds:Box3; groups?:number[][]; meshNames?:string[]; groupNames?:string[];windowMeshes?:number[] }
/** Preserve the original file separately; LT uses a static, opaque geometry snapshot. */
export async function loadStageShape(stage?:BackgroundStage,blob?:Blob):Promise<StageShape> {
  let root:Object3D;
  if(!stage){root=new Mesh(new BoxGeometry(2,2,2));}
  else {
    if(!blob)throw new Error('舞台の原本を読み込めませんでした');
    if(stage.format==='glb'){
      root=(await loadEmbeddedGlb(await blob.arrayBuffer())).scene;
    }else{
      const manager=embeddedSceneManager();
      const textureLoader=new TextureLoader(manager);
      textureLoader.load=(url,onLoad)=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url);const texture=new Texture<HTMLImageElement>();queueMicrotask(()=>onLoad?.(texture));return texture;};
      manager.addHandler(/.*/,textureLoader);
      root=new FBXLoader(manager).parse(await blob.arrayBuffer(),'');
    }
  }
  try{
    root.updateMatrixWorld(true);
    const meshes:GeometryMesh[]=[],meshNames:string[]=[],windowMeshes:number[]=[],bounds=new Box3(),groups=new Map<Object3D,number[]>();
    root.traverseVisible(object=>{
      const mesh=object as Mesh & {isInstancedMesh?:boolean;count?:number;getMatrixAt?:(i:number,m:Matrix4)=>void;skeleton?:{update:()=>void}};
      if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
      mesh.skeleton?.update();
      const geometry=mesh.geometry,index=geometry.getIndex(),count=index?.count??geometry.getAttribute('position').count;
      const start=Math.max(0,geometry.drawRange.start),end=Math.min(count,start+geometry.drawRange.count);
      for(let instance=0;instance<(mesh.isInstancedMesh?mesh.count??0:1);instance++){
        const transform=mesh.matrixWorld.clone();if(mesh.isInstancedMesh){const local=new Matrix4();mesh.getMatrixAt!(instance,local);transform.multiply(local);}
        const positions:number[]=[],indices:number[]=[],lookup=new Map<number,number>();
        for(let i=start;i+2<end;i+=3)for(let k=0;k<3;k++){
          const source=index?index.getX(i+k):i+k;let target=lookup.get(source);
          if(target===undefined){const point=mesh.getVertexPosition(source,new Vector3()).applyMatrix4(transform);if(!point.toArray().every(Number.isFinite))throw new Error('3Dモデルに不正な座標があります');target=positions.length/3;positions.push(point.x,point.y,point.z);lookup.set(source,target);bounds.expandByPoint(point);}
          indices.push(target);
        }
        if(indices.length){
          const id=meshes.length;meshes.push({positions,indices});meshNames.push(mesh.name);
          const names:string[]=[];for(let ancestor:Object3D|null=mesh;ancestor;ancestor=ancestor.parent)names.push(ancestor.name);
          const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
          const glass=materials.length>0&&materials.every(material=>{const optical=material as Material&{transmission?:number};return (optical.transmission??0)>.2||optical.opacity<.5;});
          if(glass&&names.some(name=>/(?:^|[_\s])window(?:[_\s]|$)|窓/i.test(name)))windowMeshes.push(id);
          // Keep authored furniture assemblies, including Mesh parents with
          // outline children and GLTF multi-material primitive groups.
          for(let parent:Object3D|null=mesh;parent&&parent!==root;parent=parent.parent){const children=groups.get(parent)??[];children.push(id);groups.set(parent,children);}
        }
      }
    });
    if(!meshes.length||bounds.isEmpty())throw new Error('表示できる面がありません。メッシュを含むモデルを選んでください');
    const assemblies=[...groups.entries()].filter(([,indices])=>indices.length>1);
    return {meshes,bounds,meshNames,windowMeshes,groups:assemblies.map(([,indices])=>indices),groupNames:assemblies.map(([object])=>object.name)};
  }finally{disposeObject(root);}
}

export function fitStageCamera(shape:StageShape):BackgroundCapture['camera'] {
  const centre=shape.bounds.getCenter(new Vector3()),radius=Math.max(.001,shape.bounds.getSize(new Vector3()).length()/2);
  return {position:centre.clone().add(new Vector3(4,3,5).normalize().multiplyScalar(radius*3.6)).toArray(),target:centre.toArray(),fov:40};
}
/** Tight clip planes retain depth precision even when the camera is far from the stage. */
export function stageClipPlanes(shape:StageShape,camera:PerspectiveCamera):{near:number;far:number} {
  const centre=shape.bounds.getCenter(new Vector3()),radius=Math.max(.001,shape.bounds.getSize(new Vector3()).length()/2);
  const depth=centre.sub(camera.position).dot(camera.getWorldDirection(new Vector3()));
  const near=Math.max(radius/10000,depth-radius*1.01);
  return {near,far:Math.max(near+radius*.01,depth+radius*1.01)};
}
export function backgroundPaths(edges:BackgroundEdge[],capture:BackgroundCapture,_dpi:number):VectorPath[] {
  return edges.map(edge=>({id:crypto.randomUUID(),closed:false,nodes:[edge.a,edge.b].map(point=>({x:capture.frame.x+point.x,y:capture.frame.y+point.y})),style:{...defaultVectorStyle(),width:edge.width}}));
}

/** Renderer and controls exist only while the user is adjusting the 3D window. */
export class Background3dRenderer {
  readonly canvas:HTMLCanvasElement;
  readonly controls:OrbitControls;
  private renderer:WebGLRenderer;
  private scene=new Scene();
  private camera=new PerspectiveCamera();
  private group=new Group();
  private material:MeshBasicMaterial;
  private lighting:BackgroundLighting|null=null;
  private lightingWindowMesh:number|undefined;
  private surfaceComputer:BackgroundSurfaceComputer|null=null;
  private surfaceRaw:{key:string;input:BackgroundSurfaceInput}|null=null;
  private surfaceCache:({key:string}&BackgroundSurfaceResult)|null=null;
  private surfaceRequestedKey='';private surfaceTimer=0;private surfaceError='';
  private resize:ResizeObserver;
  private target:WebGLRenderTarget|null=null;
  private shape:StageShape|null=null;
  private lineComputer:BackgroundLineComputer|null=null;
  private cutawayModel:BackgroundCutawayModel|null=null;
  private visibleMeshes:number[]|undefined;
  private focusByMesh=new Map<number,BackgroundFocusTarget>();
  private picking=false;
  private pickWithin:number|undefined;
  private pickSurface:HTMLElement;
  private enabled=true;
  private hovered:number|undefined;
  private hoverPoint:{x:number;y:number}|undefined;
  private outline=document.createElement('canvas');
  private outlineKey='';
  private selectedMaterial=new MeshBasicMaterial({color:0xffffff,side:DoubleSide,blending:NoBlending,toneMapped:false});
  private occluderMaterial=new MeshBasicMaterial({color:0x000000,side:DoubleSide,blending:NoBlending,toneMapped:false});
  private scope=document.createElement('button');
  private scopeDrag:number|undefined;
  private pointChanged:(point:[number,number,number])=>void;
  private hoverPointer=(event:PointerEvent)=>{
    if(!this.picking||!this.enabled||this.scopeDrag!==undefined||event.buttons)return;
    this.hoverPoint={x:event.clientX,y:event.clientY};this.requestRender();
  };
  private leavePointer=()=>{this.hoverPoint=undefined;if(this.hovered!==undefined){this.hovered=undefined;this.requestRender();}};
  private startScope=(event:PointerEvent)=>{
    if(!this.enabled||event.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();
    this.scopeDrag=event.pointerId;this.scope.classList.add('is-dragging');this.controls.enabled=false;
    this.scope.setPointerCapture(event.pointerId);
  };
  private moveScope=(event:PointerEvent)=>{
    if(event.pointerId!==this.scopeDrag)return;
    event.preventDefault();event.stopImmediatePropagation();this.moveFocusPoint(event.clientX,event.clientY);
  };
  private finishScope=(event?:PointerEvent)=>{
    if(this.scopeDrag===undefined||event&&event.pointerId!==this.scopeDrag)return;
    event?.stopImmediatePropagation();
    if(this.scope.hasPointerCapture(this.scopeDrag))this.scope.releasePointerCapture(this.scopeDrag);
    this.scopeDrag=undefined;this.scope.classList.remove('is-dragging');this.controls.enabled=this.enabled;
  };
  private scopeKey=(event:KeyboardEvent)=>{
    const direction:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const delta=direction[event.key];if(!delta||!this.enabled)return;
    event.preventDefault();event.stopPropagation();const box=this.scope.getBoundingClientRect(),step=event.shiftKey?12:3;
    this.moveFocusPoint(box.x+box.width/2+delta[0]*step,box.y+box.height/2+delta[1]*step);
  };
  private moveFocusPoint(x:number,y:number){
    const hit=this.pickFocus(x,y,this.config.focusMesh);if(!hit||this.config.focusMesh===undefined)return;
    this.config={...this.config,focusPoint:hit.point};this.pointChanged(hit.point);this.requestRender();
  }
  private reposition=()=>this.requestRender();
  private blur=()=>{this.resetSpace();this.finishScope();this.finishFrame();};
  private picked:(hit:(BackgroundFocusTarget&{point:[number,number,number];surfaceMesh:number})|undefined)=>void;
  private pickPointer=(event:PointerEvent)=>{
    if(!this.picking||!this.controls.enabled||event.button!==0)return;
    const box=this.host.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)return;
    event.preventDefault();event.stopImmediatePropagation();
    this.canvas.focus({preventScroll:true});
    this.picked(this.pickFocus(event.clientX,event.clientY));
  };
  onObjectMenu?: (mesh:number,x:number,y:number)=>void;
  private objectMenu=(event:MouseEvent)=>{
    const focus=this.focusTarget(this.config.focusMesh);
    if(!this.enabled||!focus||!this.onObjectMenu||!backgroundFocusContains(backgroundFocusRegion(this.host).polygon,{x:event.clientX,y:event.clientY}))return;
    event.preventDefault();event.stopImmediatePropagation();
    this.onObjectMenu(focus.mesh,event.clientX,event.clientY);
  };
  private lineKey=''; private lineTimer=0; private lineError='';
  private config:BackgroundCapture;
  private raf=0; private disposed=false; private changing=false;
  private onChange:()=>void;
  private stop=(event:Event)=>event.stopPropagation();
  private spaceDown=(event:KeyboardEvent)=>{
    if(event.code!=='Space'||!this.controls.enabled||event.target instanceof Element&&event.target.closest('input,textarea,select,button,a,summary,[contenteditable="true"],[role="button"]'))return;
    event.preventDefault();this.canvas.classList.add('is-space-pan');
  };
  private spaceUp=(event:KeyboardEvent)=>{if(event.code==='Space')this.resetSpace();};
  private resetSpace=()=>{this.canvas.classList.remove('is-space-pan');};
  private framePointers=new Map<number,{x:number;y:number}>();
  private startPointer=(event:PointerEvent)=>{
    if(!this.enabled||this.picking||this.scopeDrag!==undefined)return;
    if(event.button===2&&this.config.focusMesh!==undefined&&this.onObjectMenu){event.preventDefault();event.stopImmediatePropagation();return;}
    this.canvas.focus({preventScroll:true});
    this.framePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    this.canvas.setPointerCapture(event.pointerId);
    // Touch events also reach OrbitControls for two-finger distance changes.
    if(event.pointerType!=='touch'){event.preventDefault();event.stopImmediatePropagation();}
  };
  private moveFrame=(event:PointerEvent)=>{
    const previous=this.framePointers.get(event.pointerId);if(!previous||!this.enabled)return;
    const box=this.canvas.getBoundingClientRect(),count=this.framePointers.size;
    const dx=(event.clientX-previous.x)/Math.max(1,box.width)/count,dy=(event.clientY-previous.y)/Math.max(1,box.height)/count;
    this.framePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(dx||dy){
      // Translate the projected picture directly, independent of depth and of
      // OrbitControls' world-space change threshold at very close distances.
      const camera=shiftBackgroundCamera(this.config.camera,dx,dy);this.config={...this.config,camera};
      applyBackgroundCameraShift(this.camera,camera);this.cameraChanged(camera);this.requestRender();
    }
    if(event.pointerType!=='touch'){event.preventDefault();event.stopImmediatePropagation();}
  };
  private finishFrame=(event?:PointerEvent)=>{
    const ids=event?[event.pointerId]:[...this.framePointers.keys()];
    for(const id of ids){this.framePointers.delete(id);if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);}
  };
  private scratch:HTMLCanvasElement;
  private host:HTMLDivElement; private dpi:number;
  private cameraChanged:(camera:BackgroundCapture['camera'])=>void; private report:(message:string)=>void;
  constructor(host:HTMLDivElement,config:BackgroundCapture,dpi:number,cameraChanged:(camera:BackgroundCapture['camera'])=>void,report:(message:string)=>void,picked:(hit:(BackgroundFocusTarget&{point:[number,number,number];surfaceMesh:number})|undefined)=>void=()=>{},pointChanged:(point:[number,number,number])=>void=()=>{}){
    this.host=host;this.dpi=dpi;this.cameraChanged=cameraChanged;this.report=report;
    this.picked=picked;this.pointChanged=pointChanged;this.pickSurface=host.closest<HTMLElement>('.manga-paper')??host;
    this.config=structuredClone(config);
    this.canvas=document.createElement('canvas');this.canvas.className='background3d-canvas';this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','3D背景の構図（ドラッグで絵を移動、右上の矢印で回転、ホイールで距離）');this.host.append(this.canvas);
    this.scratch=document.createElement('canvas');
    try{this.renderer=new WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:false});}
    catch(error){this.canvas.remove();throw new Error(`3D表示を開始できません。WebGLが利用できるか確認してください。${error instanceof Error?error.message:''}`);}
    this.renderer.setClearColor(0x000000,0);this.renderer.setPixelRatio(1);
    this.material=new MeshBasicMaterial({side:DoubleSide,blending:NoBlending});
    this.scope.type='button';this.scope.className='background3d-scope';this.scope.hidden=true;
    this.scope.setAttribute('aria-label','注目点をドラッグして移動');this.scope.title='見えている表面をドラッグして回転の中心を移動（矢印キーでも移動）';
    this.scope.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M24 16a8 8 0 1 1-16 0 8 8 0 0 1 16 0M3 16h26M16 3v26" fill="none" stroke="white" stroke-width="4"/><path d="M24 16a8 8 0 1 1-16 0 8 8 0 0 1 16 0M3 16h26M16 3v26" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    document.body.append(this.scope);
    this.scene.add(this.group);this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=false;this.controls.enableRotate=false;this.controls.enablePan=false;this.controls.touches.ONE=null;
    this.onChange=()=>{
      if(this.changing||this.disposed)return;
      const before=this.config.camera,raw={...before,position:this.camera.position.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov};
      const camera=this.config.focusPoint?pivotBackgroundCamera(before,raw,this.config.focusPoint):raw;
      this.config={...this.config,camera};
      this.changing=true;this.camera.position.fromArray(camera.position);this.controls.target.fromArray(camera.target);this.controls.update();applyBackgroundCameraShift(this.camera,camera);this.changing=false;
      this.cameraChanged(camera);this.requestRender();
    };
    this.controls.addEventListener('change',this.onChange);
    for(const type of ['pointerdown','wheel','dblclick','contextmenu'])this.canvas.addEventListener(type,this.stop);
    this.canvas.addEventListener('pointerdown',this.startPointer,true);this.canvas.addEventListener('lostpointercapture',this.finishFrame);
    window.addEventListener('pointermove',this.moveFrame,true);window.addEventListener('pointerup',this.finishFrame,true);window.addEventListener('pointercancel',this.finishFrame,true);
    this.pickSurface.addEventListener('pointerdown',this.pickPointer,true);
    this.pickSurface.addEventListener('contextmenu',this.objectMenu,true);this.scope.addEventListener('contextmenu',this.objectMenu);
    this.pickSurface.addEventListener('pointermove',this.hoverPointer,true);this.pickSurface.addEventListener('pointerleave',this.leavePointer);
    this.scope.addEventListener('pointerdown',this.startScope);this.scope.addEventListener('lostpointercapture',this.finishScope);this.scope.addEventListener('keydown',this.scopeKey);
    window.addEventListener('pointermove',this.moveScope,true);window.addEventListener('pointerup',this.finishScope,true);window.addEventListener('pointercancel',this.finishScope,true);window.addEventListener('scroll',this.reposition,true);window.addEventListener('resize',this.reposition);
    window.addEventListener('keydown',this.spaceDown,true);window.addEventListener('keyup',this.spaceUp,true);window.addEventListener('blur',this.blur);
    this.resize=new ResizeObserver(()=>this.requestRender());this.resize.observe(host);this.configure(config);
  }
  setShape(shape:StageShape){
    this.clearSurface();this.surfaceRaw=null;this.surfaceComputer?.dispose();
    this.surfaceComputer=new BackgroundSurfaceComputer(async()=>{const {default:SurfaceWorker}=await import('./background3dSurface.worker.ts?worker&inline');return new SurfaceWorker();});
    this.lighting?.dispose();this.lighting=null;
    window.clearTimeout(this.lineTimer);this.lineComputer?.dispose();this.lineKey='';this.lineError='';
    // Inline workers also work in the self-contained file:// build. Keep this
    // browser-only import lazy so geometry helpers remain usable by Node tests.
    this.lineComputer=new BackgroundLineComputer(shape.meshes,async()=>{const {default:LineWorker}=await import('./background3d.worker.ts?worker&inline');return new LineWorker();});
    for(const child of [...this.group.children]){this.group.remove(child);(child as Mesh).geometry.dispose();}
    this.shape=shape;this.hovered=undefined;this.hoverPoint=undefined;this.outlineKey='';
    this.cutawayModel=prepareBackgroundCutaway(shape.meshes,shape.groups,shape);
    this.focusByMesh.clear();for(const target of backgroundFocusTargets(shape.meshes,this.cutawayModel.units,shape))for(const index of target.indices)this.focusByMesh.set(index,target);
    for(const mesh of shape.meshes){const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(mesh.positions,3));geometry.setIndex(mesh.indices);const flat=geometry.toNonIndexed();geometry.dispose();flat.computeVertexNormals();flat.computeBoundingBox();this.group.add(new Mesh(flat,this.material));}
    this.lightingWindowMesh=this.config.light.windowMesh;
    this.lighting=new BackgroundLighting(this.renderer,shape,()=>this.requestRender(),this.lightingWindowMesh);
    const radius=Math.max(.001,shape.bounds.getSize(new Vector3()).length()/2);
    this.controls.minDistance=radius/100;this.controls.maxDistance=radius*1000;this.configure(this.config);
  }
  objectTargets(){return [...new Set(this.focusByMesh.values())];}
  objectVisibilityState(){
    if(!this.shape)return [];
    this.lineView();const visible=this.visibleMeshes?new Set(this.visibleMeshes):null;
    return this.objectTargets().map(target=>({mesh:target.mesh,name:target.name,visible:!visible||target.indices.some(i=>visible.has(i)),mode:this.config.objectVisibility?.find(rule=>target.indices.includes(rule.mesh))?.mode??'auto' as const}));
  }
  configure(config:BackgroundCapture){
    this.config=structuredClone(config);this.changing=true;
    if(this.shape){const radius=Math.max(.001,this.shape.bounds.getSize(new Vector3()).length()/2),focus=this.focusTarget(config.focusMesh);this.controls.minDistance=Math.max(1e-7,Math.min(radius,focus?focus.bounds.getSize(new Vector3()).length()/2:radius)/100);}
    this.camera.position.fromArray(config.camera.position);this.camera.fov=config.camera.fov;this.camera.aspect=config.frame.w/config.frame.h;
    this.controls.target.fromArray(config.camera.target);this.controls.update();this.changing=false;applyBackgroundCameraShift(this.camera,config.camera);this.camera.updateMatrixWorld(true);
    if(this.shape&&this.lightingWindowMesh!==config.light.windowMesh){this.lighting?.dispose();this.lightingWindowMesh=config.light.windowMesh;this.lighting=new BackgroundLighting(this.renderer,this.shape,()=>this.requestRender(),this.lightingWindowMesh);}
    this.lighting?.configure(config);
    this.requestRender();
  }
  focusTarget(mesh:number|undefined){return mesh===undefined?undefined:this.focusByMesh.get(mesh);}
  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled){this.finishScope();this.finishFrame();this.leavePointer();}this.controls.enabled=enabled&&this.scopeDrag===undefined;this.scope.disabled=!enabled;}
  setPicking(picking:boolean,within?:number){this.picking=picking;this.pickWithin=within;this.pickSurface.classList.toggle('is-background3d-picking',picking);if(!picking)this.leavePointer();this.requestRender();}
  pickFocus(clientX:number,clientY:number,within=this.pickWithin):(BackgroundFocusTarget&{point:[number,number,number];surfaceMesh:number})|undefined {
    if(!this.shape||this.disposed||!backgroundFocusContains(backgroundFocusRegion(this.host).polygon,{x:clientX,y:clientY}))return;
    const box=this.canvas.getBoundingClientRect();if(!box.width||!box.height||clientX<box.left||clientX>box.right||clientY<box.top||clientY>box.bottom)return;
    this.lineView();this.group.updateMatrixWorld(true);
    const ray=new Raycaster();ray.setFromCamera(new Vector2((clientX-box.left)/box.width*2-1,1-(clientY-box.top)/box.height*2),this.camera);
    const hit=pickBackgroundSurface(this.group.children,ray);
    if(!hit)return;
    const target=this.focusByMesh.get(hit.surfaceMesh);
    if(!target||within!==undefined&&target.mesh!==this.focusTarget(within)?.mesh)return;
    return {...target,point:hit.point.toArray(),surfaceMesh:hit.surfaceMesh};
  }
  private selectionPreview(ctx:CanvasRenderingContext2D,width:number,height:number,viewKey:string){
    if(this.hoverPoint){this.hovered=this.pickFocus(this.hoverPoint.x,this.hoverPoint.y)?.mesh;this.hoverPoint=undefined;}
    const focus=this.focusTarget(this.hovered??this.config.focusMesh);
    if(focus){
      const key=`${viewKey}|${focus.mesh}|${width}|${height}`;
      if(this.outlineKey!==key){
        const selected=new Set(focus.indices),materials=this.group.children.map(object=>(object as Mesh).material);
        const target=new WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false}),bytes=new Uint8Array(width*height*4),previous=this.renderer.getRenderTarget();
        try{
          this.group.children.forEach((object,i)=>{(object as Mesh).material=selected.has(i)?this.selectedMaterial:this.occluderMaterial;});
          this.renderer.setRenderTarget(target);this.renderer.clear();this.renderer.render(this.scene,this.camera);this.renderer.readRenderTargetPixels(target,0,0,width,height,bytes);
        }finally{this.group.children.forEach((object,i)=>{(object as Mesh).material=materials[i];});this.renderer.setRenderTarget(previous);target.dispose();}
        const mask=new Uint8Array(bytes.length);for(let y=0;y<height;y++)mask.set(bytes.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);
        this.outline.width=width;this.outline.height=height;
        this.outline.getContext('2d')!.putImageData(new ImageData(backgroundSelectionOutline(mask,width,height,Math.max(1,2*width/Math.max(1,this.host.getBoundingClientRect().width))),width,height),0,0);
        this.outlineKey=key;
      }
      ctx.drawImage(this.outline,0,0);
    }
    const selected=this.focusTarget(this.config.focusMesh),box=this.canvas.getBoundingClientRect();
    const point=new Vector3(...(this.config.focusPoint??this.config.camera.target)).project(this.camera);
    const x=box.left+(point.x+1)*box.width/2,y=box.top+(1-point.y)*box.height/2;
    const visible=Boolean(selected&&(!focus||focus.mesh===selected.mesh)&&point.z>=-1&&point.z<=1&&backgroundFocusContains(backgroundFocusRegion(this.host).polygon,{x,y}));
    this.scope.hidden=!visible;
    if(visible){this.scope.style.left=`${x}px`;this.scope.style.top=`${y}px`;}
  }
  private requestRender(){if(this.disposed||this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;try{this.preview();}catch(error){this.report(error instanceof Error?error.message:String(error));}});}
  private needsSurface(){return this.config.detail<1||this.config.lineGap>0;}
  private surfaceKeys(viewKey:string){
    const rawKey=`${viewKey}|${JSON.stringify([this.config.camera,this.config.cutaway,this.config.objectVisibility,this.config.focusMesh,this.config.light])}|${this.lighting!.revision}`;
    return {rawKey,key:`${rawKey}|${this.config.detail}|${this.config.lineGap}`};
  }
  private clearSurface(stopWorker=true){
    window.clearTimeout(this.surfaceTimer);if(stopWorker)this.surfaceComputer?.cancel();this.surfaceRequestedKey='';this.surfaceError='';this.surfaceCache=null;this.lighting?.setSurface(null);
  }
  private async requestSurface(edges:BackgroundEdge[],viewKey:string){
    if(!this.needsSurface()){this.clearSurface();return edges;}
    const light=this.lighting!,computer=this.surfaceComputer!,{rawKey,key}=this.surfaceKeys(viewKey);
    if(this.surfaceCache?.key===key)return this.surfaceCache.edges;
    light.setSurface(null);this.surfaceCache=null;
    this.surfaceRequestedKey=key;
    let input=this.surfaceRaw?.key===rawKey?this.surfaceRaw.input:undefined;
    if(!input){const size=backgroundSurfaceSize(this.config.frame.w,this.config.frame.h),projection=this.camera.projectionMatrix.elements;input={...size,pixels:light.surface(this.camera,size.width,size.height),frameWidth:this.config.frame.w,frameHeight:this.config.frame.h,fov:this.camera.fov,principalPoint:[(1-projection[8])*size.width/2,(1+projection[9])*size.height/2]};this.surfaceRaw={key:rawKey,input};}
    const result=await computer.request(key,{rawKey,input,edges,amount:1-this.config.detail,lineGap:this.config.lineGap,creaseAngle:this.config.creaseAngle});
    if(this.disposed||computer!==this.surfaceComputer||light!==this.lighting||key!==this.surfaceKeys(this.lineKey).key)throw new DOMException('3Dの省略設定が変更されました','AbortError');
    light.setSurface(result.surface);this.surfaceCache={key,...result};this.surfaceError='';return result.edges;
  }
  private masks(width:number,height:number){
    if(this.shape){Object.assign(this.camera,stageClipPlanes(this.shape,this.camera));this.camera.updateProjectionMatrix();}
    if(width>this.renderer.capabilities.maxTextureSize||height>this.renderer.capabilities.maxTextureSize)throw new Error('この描画サイズはGPUの上限を超えています。コマの解像度を下げてください');
    if(!this.target||this.target.width!==width||this.target.height!==height){this.target?.dispose();this.target=new WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false,samples:4});}
    const read=(mode:number)=>{
      const bytes=new Uint8Array(width*height*4);
      this.renderer.setRenderTarget(this.target);this.renderer.clear();this.lighting!.render(this.camera,mode);this.renderer.readRenderTargetPixels(this.target!,0,0,width,height,bytes);this.renderer.setRenderTarget(null);
      const image=new ImageData(width,height);for(let y=0;y<height;y++)image.data.set(bytes.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);return image;
    };
    return {black:read(1),tone:read(2)};
  }
  private lineView():BackgroundLineView {
    if(!this.shape)throw new Error('舞台の読み込みを待ってください');
    const cutaway=this.cutawayModel?visibleCutawayMeshes(this.cutawayModel,this.config.camera,this.config.cutaway):undefined;
    const focused=keepBackgroundFocusVisible(cutaway,this.focusTarget(this.config.focusMesh));
    this.visibleMeshes=this.cutawayModel?applyBackgroundVisibility(this.cutawayModel,focused,this.config.objectVisibility):focused;
    const visible=this.visibleMeshes?new Set(this.visibleMeshes):null;
    this.group.children.forEach((mesh,i)=>{mesh.visible=!visible||visible.has(i);});
    this.lighting?.setVisible(this.visibleMeshes);
    Object.assign(this.camera,stageClipPlanes(this.shape,this.camera));this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    return {viewProjection:new Matrix4().multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse).toArray(),cameraPosition:this.camera.position.toArray(),options:{width:this.config.frame.w,height:this.config.frame.h,creaseAngle:this.config.creaseAngle,detail:1,outlineWidth:this.config.outlineWidth,detailWidth:this.config.detailWidth},...(this.visibleMeshes?{visibleMeshes:this.visibleMeshes}:{})};
  }
  private solidPreview(ctx:CanvasRenderingContext2D,width:number,height:number){
    this.renderer.setRenderTarget(null);this.renderer.setSize(width,height,false);
    this.renderer.clear();this.lighting!.render(this.camera,0);
    // Draw directly from the GPU canvas; orbiting needs no CPU pixel readback.
    ctx.drawImage(this.renderer.domElement,0,0);
  }
  private preview(){
    if(!this.shape||!this.lineComputer)return;
    const box=this.host.getBoundingClientRect(),scale=Math.min(1,1024/Math.max(this.config.frame.w,this.config.frame.h),Math.max(1,box.width*(window.devicePixelRatio||1))/this.config.frame.w);
    const width=Math.max(1,Math.round(this.config.frame.w*scale)),height=Math.max(1,Math.round(this.config.frame.h*scale));
    this.canvas.width=width;this.canvas.height=height;
    const ctx=this.canvas.getContext('2d')!,view=this.lineView(),key=this.lineComputer.key(view),lines=this.lineComputer.result(view);
    const changed=key!==this.lineKey;
    if(changed){window.clearTimeout(this.lineTimer);this.lineComputer.cancel();this.lineKey=key;this.lineError='';this.clearSurface();this.surfaceRaw=null;}
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
    if(!lines){
      this.solidPreview(ctx,width,height);
      if(changed){
        this.lineTimer=window.setTimeout(()=>{
          const computer=this.lineComputer;if(!computer||this.disposed)return;
          void computer.request(view).then(()=>{if(!this.disposed&&this.lineKey===key)this.requestRender();}).catch(error=>{
            if(!this.disposed&&this.lineKey===key&&error?.name!=='AbortError'){this.lineError=error instanceof Error?error.message:String(error);this.report(this.lineError);}
          });
        },150);
      }
      const triangles=(this.visibleMeshes?.map(i=>this.shape!.meshes[i])??this.shape.meshes).reduce((count,mesh)=>count+mesh.indices.length/3,0);
      this.report(this.lineError||`${triangles.toLocaleString()}面${this.cutawayStatus()} · 形状を表示中、線画を計算しています…${this.lightStatus()}`);
      this.selectionPreview(ctx,width,height,key);
      return;
    }
    let edges=lines.segments,surfacePending=false;
    if(this.needsSurface()){
      const surfaceKey=this.surfaceKeys(key).key;
      if(this.surfaceCache?.key===surfaceKey)edges=this.surfaceCache.edges;
      else{
        surfacePending=true;
        if(this.surfaceRequestedKey!==surfaceKey){
          this.clearSurface(false);this.surfaceRequestedKey=surfaceKey;
          this.surfaceTimer=window.setTimeout(()=>{
            void this.requestSurface(lines.segments,key).then(()=>this.requestRender()).catch(error=>{
              if(!this.disposed&&this.surfaceRequestedKey===surfaceKey&&error?.name!=='AbortError'){this.surfaceError=error instanceof Error?error.message:String(error);this.report(this.surfaceError);}
            });
          },120);
        }
      }
    }else if(this.surfaceRequestedKey||this.surfaceCache)this.clearSurface();
    const {black,tone}=this.masks(width,height);this.scratch.width=width;this.scratch.height=height;
    if(this.config.toneEnabled){applyPaintTone(tone,{enabled:true,mode:'fixed',density:this.config.toneDensity,lpi:this.config.toneLpi,origin:{x:0,y:0}},this.dpi,this.config.frame.w,this.config.frame.h,true,this.config.frame);this.scratch.getContext('2d')!.putImageData(tone,0,0);ctx.drawImage(this.scratch,0,0);}
    this.scratch.getContext('2d')!.putImageData(black,0,0);ctx.drawImage(this.scratch,0,0);
    ctx.save();ctx.scale(width/this.config.frame.w,height/this.config.frame.h);ctx.translate(-this.config.frame.x,-this.config.frame.y);ctx.strokeStyle='#000';ctx.lineCap='round';
    for(const path of backgroundPaths(edges,this.config,this.dpi)){ctx.lineWidth=path.style.width;ctx.beginPath();ctx.moveTo(path.nodes[0].x,path.nodes[0].y);ctx.lineTo(path.nodes[1].x,path.nodes[1].y);ctx.stroke();}ctx.restore();
    this.report(this.surfaceError||`${lines.stats.triangles.toLocaleString()}面 · 可視線 ${edges.length.toLocaleString()}本${surfacePending?' · 細部と光の線を計算中…':''}${this.cutawayStatus()}${this.lightStatus()}`);
    this.selectionPreview(ctx,width,height,key);
  }
  private cutawayStatus(){const hidden=this.visibleMeshes?this.shape!.meshes.length-this.visibleMeshes.length:0;return hidden?` · 手前側 ${hidden}部品を非表示`:'';}
  private lightStatus(){const status=this.lighting?.status;return status?` · ${status}`:'';}
  async capture(){
    if(!this.shape||!this.lineComputer||this.disposed)throw new Error('舞台の読み込みを待ってください');
    const config=structuredClone(this.config),width=Math.max(1,Math.round(config.frame.w)),height=Math.max(1,Math.round(config.frame.h));
    window.clearTimeout(this.lineTimer);window.clearTimeout(this.surfaceTimer);
    const view=this.lineView(),computer=this.lineComputer;
    this.lineKey=computer.key(view);this.lineError='';
    const [{segments}]=await Promise.all([computer.request(view),this.lighting?.ready()]);
    if(this.disposed||computer!==this.lineComputer||JSON.stringify(config)!==JSON.stringify(this.config))throw new Error('撮影中に3Dの構図が変わりました。もう一度撮影してください');
    const edges=await this.requestSurface(segments,computer.key(view));
    if(this.disposed||computer!==this.lineComputer||JSON.stringify(config)!==JSON.stringify(this.config))throw new Error('撮影中に3Dの構図が変わりました。もう一度撮影してください');
    this.requestRender();
    const {black,tone}=this.masks(width,height);
    const layers:PaintLayer[]=[],imports:Array<{asset:Awaited<ReturnType<typeof prepareImageAsset>>;blob:Blob}>=[];
    const maskLayer=async(name:string,pixels:ImageData,isTone:boolean)=>{
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.putImageData(pixels,0,0);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('3D背景の画像を作成できませんでした')),'image/png'));
      const asset=await prepareImageAsset(new File([blob],`${name}.png`,{type:'image/png'}));imports.push({asset,blob});
      layers.push({...newPaintLayer(name),image:{assetId:asset.id,crop:imageCrop(asset),bbox:{...config.frame}},...(isTone?{visible:config.toneEnabled,tone:{enabled:true,mode:'fixed' as const,lpi:config.toneLpi,density:config.toneDensity,origin:{x:0,y:0}}}:{}),mask:{enabled:true,reveal:true,strokes:[]}});
      canvas.width=canvas.height=1;
    };
    await maskLayer('3D トーン',tone,true);await maskLayer('3D ベタ',black,false);
    layers.push({...newPaintLayer('3D 線画','vector'),paths:backgroundPaths(edges,config,this.dpi)});
    // Paint documents store layers bottom-to-top; the palette shows tone, black, line.
    return {config,layers:layers.reverse(),imports};
  }
  dispose(){
    if(this.disposed)return;this.finishScope();this.finishFrame();this.disposed=true;cancelAnimationFrame(this.raf);this.raf=0;this.resize.disconnect();this.controls.removeEventListener('change',this.onChange);this.controls.dispose();
    window.clearTimeout(this.lineTimer);window.clearTimeout(this.surfaceTimer);this.lineComputer?.dispose();this.lineComputer=null;this.surfaceComputer?.dispose();this.surfaceComputer=null;this.lighting?.dispose();this.lighting=null;this.surfaceCache=null;this.surfaceRaw=null;this.cutawayModel=null;this.visibleMeshes=undefined;
    this.setPicking(false);this.pickSurface.removeEventListener('pointerdown',this.pickPointer,true);this.focusByMesh.clear();
    this.pickSurface.removeEventListener('contextmenu',this.objectMenu,true);this.scope.removeEventListener('contextmenu',this.objectMenu);this.onObjectMenu=undefined;
    this.pickSurface.removeEventListener('pointermove',this.hoverPointer,true);this.pickSurface.removeEventListener('pointerleave',this.leavePointer);
    this.scope.removeEventListener('pointerdown',this.startScope);this.scope.removeEventListener('lostpointercapture',this.finishScope);this.scope.removeEventListener('keydown',this.scopeKey);this.scope.remove();
    window.removeEventListener('pointermove',this.moveScope,true);window.removeEventListener('pointerup',this.finishScope,true);window.removeEventListener('pointercancel',this.finishScope,true);window.removeEventListener('scroll',this.reposition,true);window.removeEventListener('resize',this.reposition);
    this.selectedMaterial.dispose();this.occluderMaterial.dispose();this.outline.width=this.outline.height=1;
    for(const type of ['pointerdown','wheel','dblclick','contextmenu'])this.canvas.removeEventListener(type,this.stop);
    this.canvas.removeEventListener('pointerdown',this.startPointer,true);this.canvas.removeEventListener('lostpointercapture',this.finishFrame);
    window.removeEventListener('pointermove',this.moveFrame,true);window.removeEventListener('pointerup',this.finishFrame,true);window.removeEventListener('pointercancel',this.finishFrame,true);window.removeEventListener('keydown',this.spaceDown,true);window.removeEventListener('keyup',this.spaceUp,true);window.removeEventListener('blur',this.blur);this.resetSpace();
    for(const child of this.group.children)(child as Mesh).geometry.dispose();this.group.clear();this.shape=null;this.material.dispose();this.target?.dispose();this.target=null;this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();this.scratch.width=this.scratch.height=1;
  }
}
