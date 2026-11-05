import { paintLayerEditable } from '../../lib/paintLock';
import { pickPaintLayer, paintOwnerPoint, translatePaintLayer } from '../../lib/paintLayerPicking';
import { combineSelection, floodSelection, lassoSelection, type SelectionMode } from '../../lib/rasterSelection';
import { hitPaintRuler, paintRulerAngle, paintRulerProjection } from '../../lib/paintRuler';
import { isShapeTool, vectorInput } from '../../lib/paintToolMode';
import {
  beginVectorDrag, updateVectorDrag, vectorAnchorAt, vectorResizeHandleAt, vectorPenEndpoint,
  type VectorTool,
} from '../../lib/vectorGesture';
import type { PaintWorkspaceState, PaintLayoutTarget } from '../../lib/paintWorkspace';
import type { BBox, PaintLayer, PaintPoint, PaintStroke } from '../../types';
import { expandPaintOwnerToContent, paintLayerAboveNative, type PaintOwner, type PaintScene } from '../../lib/paintDocument';
import { readPaintPixels, readPaintMaskPixels } from '../../lib/paintRenderer';
import { PaintSmoother } from '../../lib/paintStroke';
import {
  appendPaintSamples, preparePaintMarkLayer, commitPaintStroke, commitVectorPaths, paintStrokeBounds,
  type PaintSampleEvent,
} from '../../lib/paintGesture';
import { type PaintEditorOptions, type PaintEditorState, type PaintTool, noPaintLayer, type Live } from './paintEditorState';

interface PaintGesturesBindings {
  endBackgroundMove: (keep?: boolean) => void;
  commit: (next: PaintScene) => void;
  clearVectorSelection: () => void;
  selectLayout: (target: PaintLayoutTarget) => void;
  canDraw: boolean;
  canEditLayer: boolean;
  paintActive: boolean;
}

export function createPaintGestures(options: PaintEditorOptions, state: PaintEditorState, bindings: PaintGesturesBindings) {
  const { page, onSelectLayout, smoothing } = options;
  const {
    selectionPointer, inputActive, setLassoPreview, gesture, raf, historyRef, initial, setLayerId,
    setError, rasterPreviewRef, setLive, vectorPointer, vectorState, setVectorSelected,
    setVectorPreview, setVectorStyle, setInkColor, owner, rulerPointer, setRulerState, tool, rulerMode,
    ruler, rulerState, coverage, layerVisible, layer, setOwnerKey, setMaskTarget, setSelection,
    layerMove, penHover, setPenCursor, scene, eraserSize, size, vectorStyle, eraseMode, paintTarget,
    images, selectionBoxes, selectTolerance, operation, editingMask, hasLayer, inkColor, busy,
    suspended, selectionTool, lineKind, color, brush,
  } = state;
  const {
    endBackgroundMove, commit, clearVectorSelection, selectLayout, canDraw, canEditLayer, paintActive,
  } = bindings;
  function finishGesture(keep=true){
    finishRuler(keep);
    endBackgroundMove(keep);
    finishLayerMove(keep);
    selectionPointer.current?.cleanup();selectionPointer.current=null;inputActive.current=false;setLassoPreview([]);
    finishVector(keep);
    const g=gesture.current;if(!g)return;
    // Detach first: releasing capture can synchronously produce another end event.
    gesture.current=null;inputActive.current=false;g.cleanup();cancelAnimationFrame(raf.current);raf.current=0;
    if(keep){const pending=g.live;
      try{if(historyRef.current.initial===initial){
        const before=historyRef.current.present,next=commitPaintStroke(before,pending);commit(next);
        if(next!==before){if(pending.addedLayer)setLayerId(pending.layerId);setError('');}
      }}
      catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');}}
    rasterPreviewRef.current=undefined;setLive(undefined);
    try{if(g.target.hasPointerCapture(g.pointerId))g.target.releasePointerCapture(g.pointerId);}catch{/* Window listeners already detached. */}
  }
  function showVectorDrag(){
    const g=vectorPointer.current;if(!g)return;
    vectorState.current=g.drag.state;setVectorSelected(g.drag.state.selected);
    const base=historyRef.current.present;
    try{setVectorPreview(commitVectorPaths(base,{ownerKey:g.ownerKey,layerId:g.layerId,addedLayer:g.addedLayer,addedBelow:g.addedBelow,paths:g.drag.state.paths}));}
    catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');}
  }
  function finishVector(keep=true){
    const g=vectorPointer.current;if(!g)return;vectorPointer.current=null;g.cleanup();inputActive.current=false;
    if(keep){const paths=g.drag.state.paths;
      try{if(JSON.stringify(paths)!==JSON.stringify(g.drag.before.paths))commit(commitVectorPaths(historyRef.current.present,{ownerKey:g.ownerKey,layerId:g.layerId,addedLayer:g.addedLayer,addedBelow:g.addedBelow,paths}));}
      catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');}
      const committed=historyRef.current.present.owners.find(owner=>owner.key===g.ownerKey)?.paint.layers.find(layer=>layer.id===g.layerId)?.paths??g.drag.before.paths;
      vectorState.current={...g.drag.state,paths:committed};setVectorSelected(g.drag.state.selected);
      const selected=g.drag.state.paths.find(p=>p.id===g.drag.state.selected[0]);if(selected){setVectorStyle(selected.style);if(selected.style.stroke)setInkColor(selected.style.stroke);}
    }else{vectorState.current=g.drag.before;setVectorSelected(g.drag.before.selected);}
    setVectorPreview(null);try{if(g.target.hasPointerCapture(g.pointerId))g.target.releasePointerCapture(g.pointerId);}catch{}
  }
  function paperPoint(event:Pick<PointerEvent,'clientX'|'clientY'>,target:HTMLDivElement,rect:DOMRect){
    return {x:(event.clientX-rect.left)*Number(target.dataset.paperWidth)/rect.width,y:(event.clientY-rect.top)*Number(target.dataset.paperHeight)/rect.height};
  }
  function inputPoint(event:Pick<PointerEvent,'clientX'|'clientY'>,target:HTMLDivElement,rect:DOMRect,targetOwner=owner){
    return paintOwnerPoint(targetOwner,paperPoint(event,target,rect));
  }
  function finishRuler(keep=true){
    const drag=rulerPointer.current;if(!drag)return;
    rulerPointer.current=null;drag.cleanup();inputActive.current=false;
    if(!keep)setRulerState(drag.before);
    try{if(drag.target.hasPointerCapture(drag.pointerId))drag.target.releasePointerCapture(drag.pointerId);}catch{}
  }
  function beginRuler(event:PointerEvent&{currentTarget:HTMLDivElement}):boolean {
    const placing=tool==='ruler'&&!event.metaKey;
    if(!rulerMode||!placing&&(!ruler||!event.metaKey))return false;
    event.preventDefault();event.stopPropagation();
    const target=event.currentTarget,rect=target.getBoundingClientRect();
    if(!rect.width||!rect.height)return true;
    const start=paperPoint(event,target,rect);
    const current=ruler??{mode:rulerMode,origin:start,angle:0,enabled:true};
    const hit=placing?'move':hitPaintRuler(current,{x:event.clientX-rect.left,y:event.clientY-rect.top},{x:rect.width/Number(target.dataset.paperWidth),y:rect.height/Number(target.dataset.paperHeight)});
    // Command only operates the ruler on its handles; elsewhere it selects artwork.
    if(!hit)return false;
    const before=rulerState;
    const initial=placing?{...current,origin:start}:current;
    if(placing)setRulerState({page,ruler:initial});
    const rotate=!placing&&current.mode==='parallel'&&(hit==='rotate'||event.shiftKey);
    let moved=false;
    const update=(e:PointerEvent)=>{
      if(Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)>3)moved=true;
      if(!moved)return;
      const point=paperPoint(e,target,rect);
      setRulerState({page,ruler:rotate
        ?{...current,angle:paintRulerAngle(current.origin,point,e.shiftKey,current.angle,start)}
        :{...initial,origin:{x:initial.origin.x+point.x-start.x,y:initial.origin.y+point.y-start.y}}});
    };
    const move=(e:PointerEvent)=>{if(e.pointerId!==rulerPointer.current?.pointerId)return;e.preventDefault();e.stopPropagation();if(!e.buttons){finishRuler(false);return;}update(e);};
    const end=(e:PointerEvent)=>{
      if(e.pointerId!==rulerPointer.current?.pointerId)return;e.preventDefault();e.stopPropagation();
      if(e.type==='pointerup'){
        update(e);
        if(!moved&&hit==='toggle'&&!rotate)setRulerState({page,ruler:{...current,enabled:!current.enabled}});
      }
      finishRuler(e.type==='pointerup');
    };
    const blur=()=>finishRuler(false);
    const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',blur);target.removeEventListener('lostpointercapture',end);};
    rulerPointer.current={pointerId:event.pointerId,before,target,cleanup};inputActive.current=true;
    window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',blur);target.addEventListener('lostpointercapture',end);
    try{target.setPointerCapture(event.pointerId);}catch{}
    return true;
  }
  function inputTolerance(target:HTMLDivElement,rect:DOMRect,targetOwner=owner){
    return 7*Number(target.dataset.paperWidth)/rect.width*targetOwner.paint.width/targetOwner.frame.w;
  }
  function beginLayerSelection(event:PointerEvent&{currentTarget:HTMLDivElement},onSelectionMiss?:(behindOwnerKey?:string,aboveNative?:boolean)=>boolean,selectionMode:PaintTool=tool){
    const target=event.currentTarget,rect=target.getBoundingClientRect();if(!rect.width||!rect.height||!coverage)return;
    const local=inputPoint(event,target,rect),tolerance=inputTolerance(target,rect);
    // Handles can be outside the visible stroke. Only the active editable layer owns them.
    if(layerVisible&&layer.opacity>0&&paintLayerEditable(owner,layer)&&(selectionMode==='vector-node'
      ?vectorAnchorAt(layer.paths??[],vectorState.current.selected,local,tolerance)
      :selectionMode==='vector-select'&&vectorResizeHandleAt(layer.paths??[],vectorState.current.selected,local,tolerance))){
      beginVector(event,owner,layer,selectionMode);return;
    }
    const point={x:(event.clientX-rect.left)*Number(target.dataset.paperWidth)/rect.width,y:(event.clientY-rect.top)*Number(target.dataset.paperHeight)/rect.height};
    const hit=pickPaintLayer(historyRef.current.present,point,7*Number(target.dataset.paperWidth)/rect.width,coverage);
    if(hit){
      if(onSelectionMiss?.(hit.owner.key,hit.owner.kind==='bubble'&&paintLayerAboveNative(hit.owner.paint,hit.layer))){clearVectorSelection();return;}
      if(selectionMode==='vector-node'&&hit.layer.kind!=='vector'&&onSelectLayout){selectLayout({key:hit.owner.key,direct:true});return;}
      if(hit.pathId){beginVector(event,hit.owner,hit.layer,selectionMode);return;}
      clearVectorSelection();setOwnerKey(hit.owner.key);setLayerId(hit.layer.id);setMaskTarget(null);setSelection(null);
      if(selectionMode==='vector-select')beginLayerMove(event,hit.owner,hit.layer);
    }else if(onSelectionMiss?.())clearVectorSelection();
    else if(layerVisible&&layer.opacity>0&&paintLayerEditable(owner,layer)&&layer.kind==='vector')beginVector(event,owner,layer,selectionMode);
    else clearVectorSelection();
  }
  function finishLayerMove(keep=true){
    const move=layerMove.current;if(!move)return;
    layerMove.current=null;move.cleanup();inputActive.current=false;setVectorPreview(null);
    if(keep&&move.current!==move.before)commit(move.current);
    try{if(move.target.hasPointerCapture(move.pointerId))move.target.releasePointerCapture(move.pointerId);}catch{}
  }
  function beginLayerMove(event:PointerEvent&{currentTarget:HTMLDivElement},targetOwner:PaintOwner,targetLayer:PaintLayer){
    const target=event.currentTarget,rect=target.getBoundingClientRect(),start=inputPoint(event,target,rect,targetOwner),before=historyRef.current.present;
    const update=(e:PointerEvent)=>{
      const move=layerMove.current;if(!move||move.pointerId!==e.pointerId)return;
      const point=inputPoint(e,target,rect,targetOwner),dx=point.x-start.x,dy=point.y-start.y;
      if(Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<2&&move.current===before)return;
      const moved=translatePaintLayer(targetLayer,dx,dy);
      try{move.current=moved===targetLayer?before:{...before,owners:before.owners.map(o=>{if(o.key!==targetOwner.key)return o;
        return expandPaintOwnerToContent({...o,paint:{...o.paint,layers:o.paint.layers.map(l=>l.id===targetLayer.id?moved:l)}},[moved]);})};}
      catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');return;}
      setVectorPreview(move.current);
    };
    const move=(e:PointerEvent)=>{if(layerMove.current?.pointerId!==e.pointerId)return;e.preventDefault();e.stopPropagation();if(!e.buttons){finishLayerMove(false);return;}update(e);};
    const end=(e:PointerEvent)=>{if(layerMove.current?.pointerId!==e.pointerId)return;e.preventDefault();e.stopPropagation();if(e.type==='pointerup')update(e);finishLayerMove(e.type==='pointerup');};
    const blur=()=>finishLayerMove(false);
    const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',blur);target.removeEventListener('lostpointercapture',end);};
    layerMove.current={pointerId:event.pointerId,before,current:before,cleanup,target};inputActive.current=true;
    window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',blur);target.addEventListener('lostpointercapture',end);
    try{target.setPointerCapture(event.pointerId);}catch{}
  }
  function beginVector(event:PointerEvent&{currentTarget:HTMLDivElement},targetOwner=owner,pickedLayer=layer,inputTool=tool){
    penHover.current=null;setPenCursor('pen');
    const createsPath=event.button!==5&&['vector-pen','line','rectangle','ellipse'].includes(inputTool);
    const existing=pickedLayer===noPaintLayer?undefined:pickedLayer;
    const targetLayer=createsPath?preparePaintMarkLayer(targetOwner,existing,'vector',scene.colorMode,scene.layerSequence):existing;
    if(!targetLayer||!paintLayerEditable(targetOwner,targetLayer)||targetLayer.kind!=='vector'){clearVectorSelection();return;}
    const addedLayer=targetLayer!==existing?targetLayer:undefined;
    const target=event.currentTarget,rect=target.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const ruled=event.button!==5&&!event.metaKey&&!event.ctrlKey&&ruler?.enabled&&(inputTool==='vector-pen'||inputTool==='line');
    const project=paintRulerProjection(ruled?ruler:null,paperPoint(event,target,rect));
    const point=(e:PointerEvent)=>({...paintOwnerPoint(targetOwner,project(paperPoint(e,target,rect))),shift:ruled?false:e.shiftKey,alt:e.altKey,meta:e.metaKey||e.ctrlKey});
    const tolerance=inputTolerance(target,rect,targetOwner);
    const same=targetOwner.key===owner.key&&targetLayer.id===layer.id;
    const before={...(same?vectorState.current:{selected:[]}),paths:targetLayer.paths??[]};
    if(!same){setOwnerKey(targetOwner.key);setLayerId(targetLayer.id);setMaskTarget(null);setSelection(null);}
    const inputSize=event.button===5?eraserSize:size;
    const drag=beginVectorDrag(before,(event.button===5?'eraser':ruled?'line':inputTool) as VectorTool,point(event),{...vectorStyle,width:inputSize},tolerance,eraseMode,inputSize/2);
    const move=(e:PointerEvent)=>{const g=vectorPointer.current;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();e.stopPropagation();if(e.buttons===0){finishVector(false);return;}updateVectorDrag(g.drag,g.point(e));showVectorDrag();};
    const end=(e:PointerEvent)=>{const g=vectorPointer.current;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();e.stopPropagation();if(e.type==='pointerup'&&(g.drag.kind!=='new-anchor'||Math.hypot(g.point(e).x-g.drag.start.x,g.point(e).y-g.drag.start.y)>.1))updateVectorDrag(g.drag,g.point(e));finishVector(e.type==='pointerup');};
    const blur=()=>finishVector(false);const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',blur);target.removeEventListener('lostpointercapture',end);};
    vectorPointer.current={pointerId:event.pointerId,drag,ownerKey:targetOwner.key,layerId:targetLayer.id,addedLayer,addedBelow:addedLayer?existing?.id:undefined,target,point,cleanup};inputActive.current=true;
    window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',blur);target.addEventListener('lostpointercapture',end);
    try{target.setPointerCapture(event.pointerId);}catch{}showVectorDrag();
  }
  function addPoints(event:PointerEvent){
    const g=gesture.current;if(!g)return;
    const from=g.live.stroke.points.length;
    appendPaintSamples(g.live.stroke,g.smoother,event,g.point,g.ruled?false:event.shiftKey);
    g.live.bounds=g.live.stroke.tool==='pen'?paintStrokeBounds(g.live.stroke,g.live.bounds,from):paintStrokeBounds(g.live.stroke);
  }
  function movePointer(event:PointerEvent){
    const g=gesture.current;if(!g||g.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();
    // A hover without a matching release is an interrupted gesture, not a commit.
    if(event.buttons===0){finishGesture(false);return;}
    addPoints(event);
    if(!raf.current)raf.current=requestAnimationFrame(()=>{raf.current=0;const g=gesture.current;if(g)setLive({...g.live});});
  }
  function endPointer(event:PointerEvent){
    if(gesture.current?.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();
    if(event.type==='pointerup')addPoints(event);
    finishGesture(event.type==='pointerup');
  }
  function selectionPixels(){return paintTarget==='mask'?readPaintMaskPixels(owner.paint,layer):readPaintPixels(owner.paint,layer,images!);}
  function beginSelection(event:PointerEvent&{currentTarget:HTMLDivElement}){
    const target=event.currentTarget,rect=target.getBoundingClientRect();
    const point=(e:PointerEvent)=>inputPoint(e,target,rect);
    const mode:SelectionMode=event.altKey?'subtract':event.shiftKey?'add':'replace';
    if(tool==='wand'){const p=point(event);setSelection({key:owner.key,boxes:combineSelection(selectionBoxes,floodSelection(selectionPixels(),p.x,p.y,selectTolerance),mode)});return;}
    const points=[point(event)];setLassoPreview(points);
    const move=(e:PointerEvent)=>{const g=selectionPointer.current;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();e.stopPropagation();if(e.buttons===0){cancel();return;}const p=point(e),last=points.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>.5){points.push(p);setLassoPreview([...points]);}};
    const end=(e:PointerEvent)=>{const g=selectionPointer.current;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();e.stopPropagation();selectionPointer.current=null;g.cleanup();inputActive.current=false;
      try{if(e.type==='pointerup'){points.push(point(e));setSelection({key:owner.key,boxes:combineSelection(selectionBoxes,lassoSelection(points),mode)});}}
      catch(error){setError(error instanceof Error?error.message:'選択範囲を作れませんでした');}
      finally{setLassoPreview([]);try{target.releasePointerCapture(event.pointerId);}catch{}}};
    const cancel=()=>{selectionPointer.current=null;cleanup();inputActive.current=false;setLassoPreview([]);};
    const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',cancel);target.removeEventListener('lostpointercapture',cancel);};
    selectionPointer.current={pointerId:event.pointerId,points,cleanup};inputActive.current=true;
    window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',cancel);target.addEventListener('lostpointercapture',cancel);try{target.setPointerCapture(event.pointerId);}catch{}
  }
  function paintRegion(boxes:BBox[],clear=false){
    if(!canDraw||operation.current||gesture.current||vectorPointer.current||selectionPointer.current||!boxes.length)return;
    if(clear&&(!canEditLayer||!editingMask&&layer.kind==='vector'))return;
    const active=editingMask||clear?layer:preparePaintMarkLayer(owner,hasLayer?layer:undefined,'raster',scene.colorMode,scene.layerSequence);
    if(!active)return;if(active!==layer)setLayerId(active.id);
    const next=commitPaintStroke(historyRef.current.present,{ownerKey:owner.key,layerId:active.id,...(paintTarget==='mask'?{target:'mask' as const}:{}),...(active!==layer?{addedLayer:active,addedBelow:hasLayer?layer.id:undefined}:{}),stroke:{tool:clear?'clear':'fill',color:inkColor,size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:boxes}});commit(next);
  }
  function hoverPen(event:PointerEvent&{currentTarget:HTMLDivElement}){
    if(tool!=='vector-pen'||!canDraw||event.buttons||event.pointerType==='touch'||vectorPointer.current)return;
    const rect=event.currentTarget.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const point=inputPoint(event,event.currentTarget,rect);
    const tolerance=inputTolerance(event.currentTarget,rect);
    penHover.current={...point,tolerance};
    setPenCursor(vectorPenEndpoint({...vectorState.current,paths:layer.paths??[]},{...point,alt:event.altKey,meta:event.metaKey||event.ctrlKey},tolerance)?.action??'pen');
  }
  const events:PaintWorkspaceState['events']={
    onPointerDown:(event,onSelectionMiss)=>{
      if(event.pointerType==='touch'){if(rulerPointer.current||gesture.current||vectorPointer.current||selectionPointer.current){event.preventDefault();event.stopPropagation();}return;}
      if(paintActive&&!busy&&!suspended&&!operation.current&&!inputActive.current&&event.isPrimary&&event.button===0&&beginRuler(event))return;
      const pointerSelection=event.metaKey||selectionTool;
      if(tool==='ruler'&&!pointerSelection)return;
      if((!canDraw&&!(pointerSelection&&event.button===0))||busy||suspended||operation.current||inputActive.current||!event.isPrimary||(event.button!==0&&event.button!==5)||gesture.current||vectorPointer.current||selectionPointer.current)return;
      event.preventDefault();event.stopPropagation();
      if(event.button===5&&!canEditLayer)return;
      if(event.button===0&&pointerSelection){beginLayerSelection(event,onSelectionMiss,event.metaKey?'vector-select':tool);return;}
      if(event.button!==5&&(tool==='lasso'||tool==='wand')){beginSelection(event);return;}
      if(event.button!==5&&tool==='fill'){const b=event.currentTarget.getBoundingClientRect(),p=inputPoint(event,event.currentTarget,b);paintRegion(floodSelection(selectionPixels(),p.x,p.y,selectTolerance,selectionBoxes));return;}
      if(!editingMask&&vectorInput(tool,lineKind,layer.kind,event.button===5)){beginVector(event);return;}
      const erasing=tool==='eraser'||event.button===5;
      if(erasing&&!canEditLayer)return;
      // Preview the added layer now, but commit it atomically with its first mark.
      const active=editingMask||erasing?layer:preparePaintMarkLayer(owner,hasLayer?layer:undefined,'raster',scene.colorMode,scene.layerSequence);
      if(!active)return;
      const target=event.currentTarget,rect=target.getBoundingClientRect();
      if(rect.width<=0||rect.height<=0)return;
      const ruled=!erasing&&(tool==='pen'||tool==='line')&&ruler?.enabled;
      const project=paintRulerProjection(ruled?ruler:null,paperPoint(event,target,rect));
      const point=(sample:PaintSampleEvent):PaintPoint=>({...paintOwnerPoint(owner,project(paperPoint(sample,target,rect))),pressure:sample.pointerType==='pen'?Math.max(0,Math.min(1,sample.pressure)):1,time:sample.timeStamp});
      const smoother=new PaintSmoother(isShapeTool(tool)?0:smoothing);
      const selectionForMark=selectionBoxes;
      const next:Live={ownerKey:owner.key,layerId:active.id,space:{frame:{...owner.frame},width:owner.paint.width,height:owner.paint.height},...(paintTarget==='mask'?{target:'mask' as const}:{}),...(active!==layer?{addedLayer:active,addedBelow:hasLayer?layer.id:undefined}:{}),stroke:{tool:event.button===5?'eraser':tool as PaintStroke['tool'],color,...(event.button!==5&&tool==='pen'&&brush==='rough-hatching'?{brush:{kind:brush,seed:crypto.getRandomValues(new Uint32Array(1))[0]}}:{}),...(selectionForMark?{selection:selectionForMark}:{}),...(event.button!==5&&(tool==='rectangle'||tool==='ellipse')?{fill:vectorStyle.fill}:{}),size:event.button===5?eraserSize:size,points:[smoother.push(point(event))]}};
      next.bounds=paintStrokeBounds(next.stroke);
      const blur=()=>finishGesture(false);
      const cleanup=()=>{window.removeEventListener('pointermove',movePointer,true);window.removeEventListener('pointerup',endPointer,true);window.removeEventListener('pointercancel',endPointer,true);window.removeEventListener('blur',blur);};
      gesture.current={pointerId:event.pointerId,live:next,smoother,point,ruled:Boolean(ruled),target,cleanup};inputActive.current=true;
      // Capture can fail on a quick tablet tap. Window listeners still retain its up/move.
      window.addEventListener('pointermove',movePointer,{capture:true,passive:false});window.addEventListener('pointerup',endPointer,true);window.addEventListener('pointercancel',endPointer,true);window.addEventListener('blur',blur);
      try{target.setPointerCapture(event.pointerId);}catch{/* Continue using the window listeners. */}
      setLive({...next});
    },
    onPointerMove:event=>{hoverPen(event);movePointer(event);},
    onPointerLeave:()=>{penHover.current=null;setPenCursor('pen');},
    onPointerUp:endPointer,
    onPointerCancel:endPointer,
    onLostPointerCapture:endPointer,
  };

  return { finishGesture, finishVector, events, finishRuler, paintRegion };
}
