import { canGeneratePaintOwner } from '../lib/qwenGeneration';
import { useContext, useEffect, useMemo } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import {
  paintLayerVisible, paintLayerEditable, paintLayerPatchAllowed, paintOwnerLocked,
  paintOwnerPlacementLocked,
} from '../lib/paintLock';
import PaintLayerPalette, { PaintLayerControls } from './PaintLayerPalette';
import MangaFinishDialog from './MangaFinishDialog';
import PaintLayerEffects from './PaintLayerEffects';
import { nextMonoInk, swapPaintInk } from '../lib/paintInk';
import { alphaSelection } from '../lib/rasterSelection';
import { nextPaintLineKind, paintToolForLayer } from '../lib/paintToolMode';
import { selectedVectorNodes, deleteSelectedVectorNodes, vectorPenEndpoint } from '../lib/vectorGesture';
import { copyArtworkSize } from '../lib/artworkClipboard';
import type { QwenAdoption } from '../lib/qwenGeneration';
import type { ComponentProps } from 'preact';
import type { PaintImagePlacement, PaintSessionSnapshot } from '../lib/paintSession';
import {
  BubblePathToolContext, PaintGeometryContext, PaintInputActivityContext, PaintToolsContext,
  PaintDetailsContext, PaintLayerControlsContext, PaintWorkspaceContext, usePaintWorkspace,
  type PaintWorkspaceState, type PaintLayoutTarget,
} from '../lib/paintWorkspace';
import type { ImageAsset, PaintLayer, VectorPath, VectorStyle } from '../types';
import {
  paintGenerationOwner, insertGeneratedPaintImage, generatedPaintName, hasAdoptedPaintImages,
  newPaintLayer, removePaintLayer, validatePaintDocument, type PaintScene, paintOwnerShouldClear,
  paintAssetIds,
} from '../lib/paintDocument';
import { decodePaintImage, renderPaintPng, readPaintPixels } from '../lib/paintRenderer';
import { prepareImageAsset, fitImageBox, imageCrop } from '../lib/imagePlacement';
import { canStartPaintMark, commitVectorPaths } from '../lib/paintGesture';
import { paintEditorOptions, usePaintEditorState, type PaintEditorProps, type PaintResult } from './paint/paintEditorState';
export type { PaintResult } from './paint/paintEditorState';
import { createPaintGestures } from './paint/paintGestures';
import { usePaintAssets } from './paint/paintAssets';
import { createPaintBackgroundActions } from './paint/paintBackground';
import { createPaintLayerActions } from './paint/paintLayerActions';
import { usePaintToolActions } from './paint/paintToolActions';

export function PaintTools(){return <>{useContext(PaintToolsContext)}</>;}
export function PaintDetails(){return <>{useContext(PaintDetailsContext)}</>;}
export function PaintLayers(){return <>{usePaintWorkspace()?.layers}</>;}
export function PaintStatus(){return <>{usePaintWorkspace()?.status}</>;}

export default function PaintEditor(props: PaintEditorProps) {
  const options = paintEditorOptions(props);
  const {
    requested, textTool, zoomTool, toolPaletteEnabled, onStartPaint, onSelectLayout, sharedHistory,
    historySteps, onClose, assets, onApply, controller, externalSuspended, onGenerate, onSelectOwner,
    overlay, onToggleBubble, onReorderOwners, embeddedLayers, onEditText, title, guideVisible,
    onSelectFigure, page, panelIndex, cursorMode, bubblePathTool, children, stages,
  } = options;
  const state = usePaintEditorState(options, selectOwner);
  const {
    selectedBubbleStroke, tool, setEraserSize, vectorMode, brush, setHatchingSize, setRasterSize,
    layerLocked, locked, layerVisible, layer, setSelection, eraserMenu, setEraserMenu, hasLayer,
    paintTarget, setCommandHeld, busy, suspended, temporaryLayoutSelection, commandHeld,
    setTemporaryLayoutSelection, selectedFolder, images, editingMask, owner, penHover, setPenCursor,
    ownerKey, layerId, vectorState, historyRef, checkpoint, importsRef, stageImportsRef, maskTarget,
    selection, setHistory, initial, setImports, setStageImports, imagesRef, releaseImages, setImages,
    operation, inputActive, scene, toolSuspended, setBackgroundOwner, backgroundOwner, gesture,
    layerMove, setError, setVectorStyle, brushInk, vectorSelected, inkTarget, setInkColor, selectedInk,
    vectorPointer, vectorStyle, setVectorSelected, backgroundController, setBusy, alive,
    interactionRevision, imageTarget, input, imports, setOwnerKey, setLayerId, setTool, setLineKind,
    pendingContents, setFinishSelection, setMaskTarget, setEffectsTab, inkColor, loadedInitial, setMenu,
    backgroundMove, setVectorPreview, effectsTab, selectedMask, finishSelection, anchor, paletteScope,
    finishKeys, backgroundCaptureReady, error, ruler, setBackgroundHost, backgroundSelection,
    setBackgroundSelection, vectorPreview, rasterPreview, maskPreview, selectionTool, selectionBoxes,
    lassoPreview, penCursor, size, eraserSize, history, menu, paletteFolded, setPaletteFolded,
    finishOpen, setFinishOpen, BackgroundEditor, setBackgroundCaptureReady, stageImports,
    backgroundHost, backgroundLoadError, retryBackgroundLoad,
  } = state;
  function setCurrentSize(width:number){
    if(selectedBubbleStroke){if(!selectedBubbleStroke.disabled)selectedBubbleStroke.onChange(width);return;}
    if(tool==='eraser')setEraserSize(width);else if(vectorMode)changeVectorStyle({width});else if(tool==='pen'&&brush==='rough-hatching')setHatchingSize(width);else setRasterSize(width);
  }
  useEffect(()=>{if(layerLocked||locked||!layerVisible||layer.opacity<=0){clearVectorSelection();setSelection(null);}},[layerLocked,locked,layerVisible,layer.opacity]);
  useEffect(()=>{
    if(!eraserMenu)return;
    const outside=(event:PointerEvent)=>{if(!(event.target instanceof Element&&event.target.closest('.vector-eraser-menu')))setEraserMenu(null);};
    document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
  },[eraserMenu]);
  const canEditLayer=Boolean(hasLayer&&layerVisible&&!layerLocked&&(paintTarget!=='mask'||layer.mask?.enabled));
  const createsMark=['pen','fill','line','rectangle','ellipse','vector-pen'].includes(tool);
  const paintActive=Boolean(requested)&&!textTool&&!zoomTool;
  useEffect(()=>{
    const release=()=>setCommandHeld(false);
    const modifiers=(event:KeyboardEvent)=>{
      if(!event.metaKey){release();return;}
      if(event.type!=='keydown'||event.key!=='Meta'||!paintActive||!toolPaletteEnabled||busy||suspended||event.isComposing)return;
      if(event.target instanceof HTMLElement&&(event.target.closest('input,textarea,select,dialog[open]')||event.target.isContentEditable))return;
      setCommandHeld(true);
    };
    const visibility=()=>{if(document.hidden)release();};
    window.addEventListener('keydown',modifiers,true);window.addEventListener('keyup',modifiers,true);
    window.addEventListener('blur',release);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('keydown',modifiers,true);window.removeEventListener('keyup',modifiers,true);window.removeEventListener('blur',release);document.removeEventListener('visibilitychange',visibility);};
  });
  useEffect(()=>{
    // Native/panel selection closes the paint scene asynchronously. Resume only after
    // that transition and Command release, using the latest selected canvas target.
    if(!temporaryLayoutSelection||commandHeld||requested||suspended)return;
    setTemporaryLayoutSelection(false);
    if(toolPaletteEnabled&&!textTool&&!zoomTool)onStartPaint?.();
  },[temporaryLayoutSelection,commandHeld,requested,suspended,toolPaletteEnabled,textTool,zoomTool]);
  function selectLayout(target:PaintLayoutTarget){
    if(commandHeld)setTemporaryLayoutSelection(true);
    onSelectLayout?.(target);
  }
  const rulerActive=paintActive&&tool==='ruler'&&!busy&&!suspended;
  const canDraw=Boolean(paintActive&&tool!=='ruler'&&!selectedFolder&&images&&!busy&&!suspended&&!locked&&(canEditLayer||!editingMask&&createsMark&&canStartPaintMark(owner,hasLayer?layer:undefined,vectorMode?'vector':'raster')));
  useEffect(()=>{penHover.current=null;setPenCursor('pen');},[tool,ownerKey,layerId,canDraw]);
  useEffect(()=>{
    const root=document.documentElement;
    if(!requested||tool!=='pen'){if(root.dataset.paintTool==='pen')delete root.dataset.paintTool;return;}
    root.dataset.paintTool='pen';
    return()=>{if(root.dataset.paintTool==='pen')delete root.dataset.paintTool;};
  },[requested,tool]);
  useEffect(()=>{
    if(tool!=='vector-pen')return;
    const modifiers=(event:KeyboardEvent)=>{const point=penHover.current;if(!point)return;setPenCursor(vectorPenEndpoint({...vectorState.current,paths:layer.paths??[]},{...point,alt:event.altKey,meta:event.metaKey||event.ctrlKey},point.tolerance)?.action??'pen');};
    window.addEventListener('keydown',modifiers);window.addEventListener('keyup',modifiers);
    return()=>{window.removeEventListener('keydown',modifiers);window.removeEventListener('keyup',modifiers);};
  },[tool,layer.paths]);

  const { finishGesture, finishVector, events, finishRuler, paintRegion } = createPaintGestures(options, state, {
    endBackgroundMove, commit, clearVectorSelection, selectLayout, canDraw, canEditLayer, paintActive,
  });
  usePaintAssets(options, state, finishRuler);
  const {
    openBackground3d, backgroundTarget, backgroundFrame, beginBackgroundMove, moveBackgroundOwner,
    captureBackground3d, closeBackground3d,
  } = createPaintBackgroundActions(options, state, { finishGesture, clearVectorSelection, endBackgroundMove, commit, flush });
  const {
    layerAction, toggleFinishLayer, selectMask, addToneMask, addGenerationMask, toggleGuide,
    acceptFinish, openFinish,
  } = createPaintLayerActions(options, state, {
    finishGesture, commit, selectOwner, updateOwnerLayer, createGenerationMask, clearVectorSelection,
    matchLayerPen, openBackground3d,
  });
  const { selectTool, toolControls, detailControls, eraseModeMenu } = usePaintToolActions(options, state, {
    finishGesture, paintRegion, redo, undo, setCurrentSize, changeVectorStyle, clearVectorSelection,
    toggleInk, requestClose, deleteVectorSelection, changePaths, paintActive, swapInk, chooseInk,
    updateOwnerLayer, layerAction, openFinish,
  });

  function snapshot(scene=historyRef.current.present):PaintSessionSnapshot {
    const ids=new Set(scene.owners.flatMap(o=>paintAssetIds(o.paint))),stages=new Set(scene.owners.map(o=>o.paint.background3d?.sourceId));
    return {scene,saved:checkpoint.saved,imports:importsRef.current.filter(item=>ids.has(item.asset.id)),stageImports:stageImportsRef.current.filter(item=>stages.has(item.stage.id)),ownerKey,layerId,...(maskTarget?{maskTarget}:{})};
  }
  function commit(next:PaintScene){
    const h=historyRef.current;if(h.present===next)return;
    const previous=h.present.owners.find(item=>item.key===ownerKey),current=next.owners.find(item=>item.key===ownerKey);
    if(previous&&current&&selection?.key===ownerKey){
      const dx=(previous.frame.x-current.frame.x)*previous.paint.width/previous.frame.w,dy=(previous.frame.y-current.frame.y)*previous.paint.height/previous.frame.h;
      if(dx||dy)setSelection({...selection,boxes:selection.boxes.map(box=>({...box,x:box.x+dx,y:box.y+dy}))});
    }
    sharedHistory?.checkpoint(snapshot(h.present));
    setHistory(()=>({initial,past:sharedHistory?[]:[...h.past,h.present].slice(-historySteps),present:next,future:[]}));
    if(sharedHistory){const state=snapshot(next);setImports(state.imports);setStageImports(state.stageImports);
      const ids=new Set(next.owners.flatMap(o=>paintAssetIds(o.paint))),map=new Map(imagesRef.current??[]);
      for(const id of map.keys())if(!ids.has(id))map.delete(id);
      if(map.size!==imagesRef.current?.size){releaseImages(map);imagesRef.current=map;setImages(map);}
    }
  }
  function changeLayers(layers:PaintLayer[]){if(locked||busy||suspended||operation.current||inputActive.current)return;commit({...scene,owners:scene.owners.map(o=>o.key===owner.key?{...o,paint:{...o.paint,layers}}:o)});}
  function undo(){if(busy||toolSuspended||operation.current||inputActive.current)return;clearVectorSelection();setSelection(null);if(sharedHistory){sharedHistory.undo();return;}setHistory(h=>h.past.length?{initial,past:h.past.slice(0,-1),present:h.past[h.past.length-1],future:[h.present,...h.future]}:h);}
  function redo(){if(busy||toolSuspended||operation.current||inputActive.current)return;clearVectorSelection();setSelection(null);if(sharedHistory){sharedHistory.redo();return;}setHistory(h=>h.future.length?{initial,past:[...h.past,h.present].slice(-historySteps),present:h.future[0],future:h.future.slice(1)}:h);}
  async function requestClose(){
    if(operation.current)throw new Error('画像を処理しています');
    await flush();setBackgroundOwner(null);onClose();
  }
  async function pause(){
    if(operation.current)throw new Error('画像を処理しています');
    // 3D still needs its existing camera snapshot/materialization boundary.
    if(backgroundOwner){await requestClose();return;}
    finishGesture();
  }
  function changePaths(update:(paths:VectorPath[])=>VectorPath[]){
    if(layer.kind!=='vector'||layerLocked||locked||busy||suspended||operation.current||gesture.current||layerMove.current)return;
    finishVector();const current=historyRef.current.present;
    const currentLayer=current.owners.find(o=>o.key===owner.key)?.paint.layers.find(l=>l.id===layer.id);if(!currentLayer)return;
    try{commit(commitVectorPaths(current,{ownerKey:owner.key,layerId:layer.id,paths:update(currentLayer.paths??[])}));}
    catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');}
  }
  function changeVectorStyle(patch:Partial<VectorStyle>){
    const keys=Object.keys(patch) as (keyof VectorStyle)[];
    const differs=(style:VectorStyle)=>keys.some(key=>key==='dash'&&style.dash&&patch.dash
      ?style.dash.length!==patch.dash.length||style.dash.some((value,i)=>value!==patch.dash![i]):style[key]!==patch[key]);
    setVectorStyle(s=>differs(s)?{...s,...patch}:s);
    if(!vectorMode||brushInk)return;
    changePaths(paths=>paths.map(p=>vectorSelected.includes(p.id)&&differs(p.style)?{...p,style:{...p.style,...patch}}:p));
  }
  function chooseInk(value:string|null){
    if(busy||suspended||operation.current||inputActive.current)return;
    if(inkTarget==='fill')changeVectorStyle({fill:value});
    else {if(value)setInkColor(value);changeVectorStyle({stroke:value});}
  }
  function toggleInk(){chooseInk(nextMonoInk(selectedInk,!brushInk));}
  function swapInk(){if(brushInk||busy||suspended||operation.current||gesture.current||vectorPointer.current)return;const next=swapPaintInk(vectorStyle);changeVectorStyle(next);if(next.stroke)setInkColor(next.stroke);}
  function deleteVectorSelection(){
    const nodes=tool==='vector-node'?selectedVectorNodes({...vectorState.current,paths:layer.paths??[]}):tool==='vector-anchor'&&vectorState.current.selectedNode?[vectorState.current.selectedNode]:[];
    changePaths(paths=>nodes.length?deleteSelectedVectorNodes(paths,nodes):paths.filter(p=>!vectorSelected.includes(p.id)));clearVectorSelection();
  }
  function clearVectorSelection(){vectorState.current={paths:[],selected:[]};setVectorSelected([]);}
  async function flush(capture=false){
    if(operation.current)throw new Error('画像の処理が終わってから保存してください');
    if(backgroundOwner&&!capture)backgroundController.current?.snapshot();
    finishGesture();
    const snapshot=historyRef.current.present;
    if(!checkpoint.hasChanges(snapshot))return;
    const currentImages=imagesRef.current;
    if(!currentImages){setError('原本の読み込みが終わってから保存してください');throw new Error('原本を読み込み中です');}
    operation.current=true;setBusy(true);setError('');
    try{
      await checkpoint.flush(snapshot,async changed=>{
        const result:PaintResult={scene:snapshot,rebase:capture,owners:[],imports:importsRef.current,stageImports:stageImportsRef.current};
        for(const owner of changed){
          const saved=checkpoint.saved.owners.find(item=>item.key===owner.key);
          if(saved&&owner.paint===saved.paint&&owner.frame===saved.frame){result.owners.push({owner,blob:new Blob(),metadataOnly:true});continue;}
          if(paintOwnerShouldClear(owner)){result.owners.push({owner,blob:new Blob(),remove:true});continue;}
          validatePaintDocument(owner.paint,[...assets,...importsRef.current.map(i=>i.asset)]);result.owners.push({owner,blob:await renderPaintPng(owner.paint,currentImages)});
        }
        await onApply(result);
      });
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'保存できませんでした');throw e;}
    finally{operation.current=false;if(alive.current)setBusy(false);}
  }
  if(controller)controller.current=requested?{snapshot,images:()=>imagesRef.current??new Map(),pause,selectTool,interactionRevision:()=>interactionRevision.current,canRestore:()=>!operation.current&&!busy&&!externalSuspended&&!inputActive.current&&!backgroundOwner,layerAction,flush,close:requestClose,generate,chooseImage:key=>chooseImage(true,key),insertImage:(file,key,placement,adoption)=>importImage(file,{key,replace:false,placement},true,adoption)}:null;
  async function generate(key=owner.key){
    if(!onGenerate||operation.current||!images)return;
    finishGesture();
    const current=historyRef.current.present.owners.find(o=>o.key===key);
    if(!current){setError('生成対象のフォルダが見つかりません');return;}
    operation.current=true;setBusy(true);setError('');
    try{await onGenerate(current,images,importsRef.current.map(item=>item.asset));}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'生成の準備ができませんでした');}
    finally{operation.current=false;if(alive.current)setBusy(false);}
  }
  function chooseImage(replace=false,key=owner.key){
    const target=historyRef.current.present.owners.find(o=>o.key===key);
    if(operation.current||suspended||!target||paintOwnerLocked(target)||replace&&target.paint.layers.some(l=>!paintLayerEditable(target,l)))return;
    finishGesture();
    imageTarget.current={key,replace};
    input.current?.click();
  }
  async function importImage(file?:File|File[],explicitTarget?:{key:string;replace:boolean;placement?:PaintImagePlacement},fromDialog=false,adoption?:QwenAdoption){
    if(input.current)input.current.value='';
    const files=file?(Array.isArray(file)?file:[file]):[];
    const target=explicitTarget??imageTarget.current;imageTarget.current=null;
    const snapshot=historyRef.current.present;
    const targetOwner=snapshot.owners.find(o=>o.key===target?.key);
    if(!files.length||!target||!targetOwner||operation.current||inputActive.current||backgroundOwner||!fromDialog&&(suspended||paintOwnerLocked(targetOwner)||target.replace&&targetOwner.paint.layers.some(l=>!paintLayerEditable(targetOwner,l)))){
      if(fromDialog)throw new Error('差し込み先で別の操作が進行中です。状態を確認してください');
      return;
    }
    if(adoption&&hasAdoptedPaintImages(targetOwner,adoption.jobId,adoption.indices))return;
    if(!target.replace&&targetOwner.paint.layers.length+files.length>64){const message='1つのグループには64レイヤーまで追加できます';setError(message);if(fromDialog)throw new Error(message);return;}
    operation.current=true;setBusy(true);setError('');
    const decoded:HTMLImageElement[]=[];let committed=false;
    try{
      const map=new Map(imagesRef.current??[]),pending:Array<{asset:ImageAsset;blob:Blob}>=[];
      const placement='placement' in target?target.placement as PaintImagePlacement|undefined:undefined;
      let updated=targetOwner,lastId='',sequence=snapshot.generatedImageSequence??0;
      for(const [index,file] of files.entries()){
        const prepared=await prepareImageAsset(file),asset=[...assets,...imports.map(i=>i.asset),...pending.map(i=>i.asset)].find(a=>a.id===prepared.id)??prepared;
        if(!map.has(asset.id)){const image=await decodePaintImage(file);decoded.push(image);map.set(asset.id,image);}
        if(!pending.some(item=>item.asset.id===asset.id))pending.push({asset,blob:file.slice(0,file.size,asset.mediaType)});
        const paint=updated.paint;
        const generated=fromDialog?insertGeneratedPaintImage(updated,asset,generatedPaintName(sequence++),placement?.frame,
          {folderId:placement?.folderId,...(adoption?{generation:{jobId:adoption.jobId,candidateIndex:adoption.indices[index]}}:{})}):undefined;
        const added=generated?.layer??{...newPaintLayer(file.name),image:{assetId:asset.id,crop:imageCrop(asset),bbox:fitImageBox({w:asset.widthPx,h:asset.heightPx},{x:0,y:0,w:paint.width,h:paint.height})}};
        updated=generated?.owner??{...updated,paint:{...paint,layers:target.replace?[added]:[...paint.layers,added]}};lastId=added.id;
      }
      if(historyRef.current.present!==snapshot)throw new Error('差し込み先が変更されました。生成対象を選び直してください');
      if(images){imagesRef.current=map;setImages(map);}
      setImports(items=>[...items.filter(i=>!pending.some(item=>item.asset.id===i.asset.id)),...pending]);
      commit({...snapshot,...(fromDialog?{generatedImageSequence:sequence}:{}),owners:snapshot.owners.map(o=>o.key===target.key?updated:o)});
      committed=true;if(!images)decoded.forEach(image=>{image.src='';});setOwnerKey(target.key);setLayerId(lastId);
    }catch(e){if(!committed)decoded.forEach(image=>{image.src='';});setError(e instanceof Error?e.message:'取り込めませんでした');if(fromDialog)throw e;}finally{operation.current=false;setBusy(false);}
  }
  function matchLayerPen(kind:PaintLayer['kind']){
    const next=paintToolForLayer(tool,kind);
    if(next!==tool){setTool(next);setLineKind(previous=>nextPaintLineKind(previous,next));}
  }
  function selectOwner(key:string,id?:string,contents=false,native=false,rasterMask=false){
    if(operation.current||suspended||inputActive.current)return;
    pendingContents.current=null;
    const target=scene.owners.find(o=>o.key===key);if(!target)return;
    if(tool!=='ruler'&&!id&&onSelectOwner&&(target.kind==='figure'||target.kind==='bubble'||target.kind==='original')){if(commandHeld)setTemporaryLayoutSelection(true);onSelectOwner(key,native);return;}
    setFinishSelection(null);
    clearVectorSelection();setMaskTarget(null);setOwnerKey(key);const selectedLayer=id?target.paint.layers.find(l=>l.id===id):undefined;setLayerId(id??'');
    if(selectedLayer?.tone?.enabled&&!rasterMask)setEffectsTab('tone');
    if(selectedLayer&&!contents)matchLayerPen(rasterMask?'raster':selectedLayer.kind);
    if(selectedLayer?.generationMask&&!['#ff0000','#0000ff','#00ff00','#ffff00'].includes(inkColor))setInkColor('#ff0000');
    if(target.kind==='background'&&tool!=='ruler')onSelectLayout?.();
    if(key!==owner.key)setSelection(null);
    if(contents&&selectedLayer&&paintLayerVisible(target.paint,selectedLayer)&&paintLayerEditable(target,selectedLayer)){
      if(selectedLayer.kind==='vector'){const paths=selectedLayer.paths??[];vectorState.current={paths,selected:paths.map(p=>p.id)};setVectorSelected(paths.map(p=>p.id));if(!commandHeld)setTool('vector-select');}
      else if(images&&loadedInitial.current===initial){setSelection({key,boxes:alphaSelection(readPaintPixels(target.paint,selectedLayer,images))});if(!commandHeld)setTool('lasso');}
      else pendingContents.current={key,id:selectedLayer.id};
    }
  }
  function updateOwnerLayer(key:string,id:string,patch:Partial<PaintLayer>){
    if(operation.current||busy||suspended||inputActive.current)return;
    const target=scene.owners.find(o=>o.key===key),targetLayer=target?.paint.layers.find(l=>l.id===id);
    if(!target||!targetLayer||!paintLayerPatchAllowed(target,targetLayer,patch))return;
    if(patch.name!==undefined){const name=patch.name.trim();if(!name)return;patch={...patch,name};}
    if(Object.entries(patch).every(([key,value])=>targetLayer[key as keyof PaintLayer]===value))return;
    if(patch.locked&&key===owner.key&&id===layer.id){clearVectorSelection();setSelection(null);}
    commit({...scene,owners:scene.owners.map(o=>o.key===key?{...o,paint:{...o.paint,layers:o.paint.layers.map(l=>l.id===id?{...l,...patch}:l)}}:o)});
  }
  function createGenerationMask(key:string){
    if(operation.current||busy||suspended||inputActive.current)return;
    const current=historyRef.current.present,target=paintGenerationOwner(current,key);if(!target||paintOwnerLocked(target))return;
    const old=target.paint.layers.find(layer=>layer.generationMask);
    if(old)return {owner:target,layer:old};
    if(target.paint.layers.length>=64)return;
    const added:PaintLayer={...newPaintLayer('生成マスク'),generationMask:true,colorMode:'color',...(target.kind==='bubble'?{aboveNative:true}:{})};
    const updated={...target,paint:{...target.paint,layers:[...target.paint.layers,added]}};
    commit({...current,owners:current.owners.map(owner=>owner===target?updated:owner)});
    return {owner:updated,layer:added};
  }
  function openMenu(event:MouseEvent,key:string){event.preventDefault();event.stopPropagation();finishGesture();setMenu({x:event.clientX,y:event.clientY,key});}
  function endBackgroundMove(keep=true){
    const move=backgroundMove.current;if(!move)return;
    backgroundMove.current=null;inputActive.current=false;setVectorPreview(null);
    if(keep&&move.current!==move.before)commit(move.current);
  }
  const effects=<PaintLayerEffects tab={effectsTab} setTab={setEffectsTab} layer={requested&&hasLayer?layer:undefined} generationMask={selectedMask==='generationMask'} disabled={!requested||!hasLayer||locked||layerLocked||busy||suspended||!images} update={patch=>updateOwnerLayer(owner.key,layer.id,patch)}/>;
  const layerProps:ComponentProps<typeof PaintLayerPalette>={
    finishSelection:!overlay&&finishSelection?.anchor===anchor&&finishSelection.scope===paletteScope?finishKeys:undefined,toggleFinishLayer:overlay?undefined:toggleFinishLayer,
    selectedMask,selectMask,addToneMask,addGenerationMask,canAddGenerationMask:!!paintGenerationOwner(scene,owner.key)&&!paintOwnerLocked(paintGenerationOwner(scene,owner.key)!),selectedFolder,paletteScope,
    backgroundCapture:backgroundOwner?{ready:backgroundCaptureReady&&!busy&&!externalSuspended,capture:()=>void backgroundController.current?.capture()}:undefined,
    onToggleBubble,openBackground3d:!overlay?()=>openBackground3d('background'):undefined,
    reorderGroup:(key,target,after)=>{const moved=scene.owners.find(o=>o.key===key);if(moved&&!paintOwnerPlacementLocked(moved))onReorderOwners?.(key,target,after);},embedded:embeddedLayers,onEditText,title,scene,owner,layer,images,disabled:busy||suspended,
    select:selectOwner,update:updateOwnerLayer,lockOwner:(key,locked,group)=>layerAction({type:'owner-lock',key,locked,group}),guideVisible,toggleGuide,menu:openMenu,
    toggleGroup:key=>layerAction({type:'toggle',key}),addFolder:()=>layerAction({type:'add-folder',key:owner.key}),add:()=>layerAction({type:'add',key:owner.key,kind:'raster'}),
    addVector:()=>layerAction({type:'add',key:owner.key,kind:'vector'}),
    importImage:()=>chooseImage(),reorder:(key,id,target,after)=>layerAction({type:'reorder',key,id,target,after}),moveLayer:(key,id,target,destination)=>layerAction({type:'move-layer',key,id,target,destination}),moveFolder:(key,id,target,destination)=>layerAction({type:'move-folder',key,id,target,destination}),updateFolder:(key,id,patch)=>layerAction({type:'update-folder',key,id,patch}),renameFolder:(key,id,name)=>layerAction({type:'rename-folder',key,id,name}),
    duplicate:()=>{if(!hasLayer)return;const added={...layer,id:crypto.randomUUID(),name:`${layer.name} 複製`};changeLayers([...owner.paint.layers,added]);setLayerId(added.id);setMaskTarget(selectedMask==='mask'?{key:owner.key,id:added.id,kind:'mask'}:null);},
    remove:()=>{if(selectedFolder){layerAction({type:'remove-folder',key:owner.key,id:selectedFolder.id});setLayerId('');return;}if(!hasLayer||!paintLayerEditable(owner,layer))return;{if(locked||busy||suspended||operation.current||inputActive.current)return;const paint=removePaintLayer(owner.paint,layer.id);commit({...scene,owners:scene.owners.map(o=>o===owner?{...o,paint}:o)});setLayerId(paint.layers.findLast(l=>!l.locked)?.id??paint.layers.at(-1)?.id??'');}setMaskTarget(null);clearVectorSelection();setSelection(null);},
  };
  const layerControls=<PaintLayerPalette {...layerProps}/>;
  const layerHeader=<PaintLayerControls {...layerProps} disabled={!requested||busy||suspended}/>;
  const status=<div class="paint-status">{error&&<p class="paint-error" role="alert">{error}</p>}</div>;
  const value:PaintWorkspaceState|null=requested?{displayOnly:!paintActive,ruler:paintActive&&!suspended?ruler??undefined:undefined,editingMask:paintTarget??undefined,...(backgroundTarget&&backgroundFrame?{background3d:{ownerKey:backgroundTarget.key,frame:backgroundFrame,setHost:setBackgroundHost,selectedKey:backgroundSelection,select:key=>{setBackgroundSelection(key);const selected=scene.owners.find(o=>o.key===key);if(selected?.kind==='figure')onSelectFigure?.(selected.index);},beginMove:beginBackgroundMove,move:moveBackgroundOwner,endMove:endBackgroundMove}}:{}),page,panelIndex,overlay,scene,owner,images,live:vectorPreview?undefined:rasterPreview?.live,maskPreview:maskPreview?{ownerKey:owner.key,layerId:layer.id}:undefined,guideVisible,onContextMenu:openMenu,selectionTool,directSelection:tool==='vector-node',selectLayout:onSelectLayout?selectLayout:undefined,selection:selectionBoxes?{boxes:selectionBoxes,width:owner.paint.width,height:owner.paint.height}:undefined,lasso:lassoPreview,vector:{paths:layer.paths??[],selected:vectorSelected,selectedNodes:tool==='vector-node'?selectedVectorNodes({...vectorState.current,paths:layer.paths??[]}):vectorState.current.selectedNode?[vectorState.current.selectedNode]:undefined,width:owner.paint.width,height:owner.paint.height,handles:['vector-pen','vector-node','vector-add','vector-delete','vector-anchor'].includes(tool),selectionBox:tool==='vector-select'},penCursor:tool==='vector-pen'&&canDraw?penCursor:undefined,cursor:rulerActive?{mode:'crosshair',size,eraserSize}:canDraw&&!selectionTool&&!zoomTool&&!textTool?{mode:!vectorMode&&!['lasso','wand','fill'].includes(tool)?cursorMode:'crosshair',size,eraserSize}:undefined,events,tools:toolControls,layers:layerControls,status,undo,redo,canUndo:!busy&&!suspended&&(sharedHistory?.canUndo??!!history.past.length),canRedo:!busy&&!suspended&&(sharedHistory?.canRedo??!!history.future.length)}:null;
  const menuOwner=scene.owners.find(o=>o.key===menu?.key);
  const contextMenu=menu&&menuOwner&&createPortal(<><button class="canvas-generation-menu-dismiss" aria-label="操作メニューを閉じる" onClick={()=>setMenu(null)}/><div class="canvas-generation-menu" role="menu" aria-label="あたり・画像の操作" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-280)),top:Math.max(8,Math.min(menu.y,window.innerHeight-240))}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(null);}}}>
    <strong>{menuOwner.label}</strong>
    {menuOwner.kind==='background'&&!overlay&&<button role="menuitem" disabled={paintOwnerLocked(menuOwner)} onClick={()=>openBackground3d(menuOwner.key)}>3D背景を配置・調整</button>}
    <button role="menuitem" onClick={()=>{void copyArtworkSize(menuOwner.frame,menuOwner.paint.dpi).catch(e=>setError(String(e)));setMenu(null);}}>サイズコピー</button>
    {menuOwner.kind==='background'&&<button role="menuitemcheckbox" aria-checked={menuOwner.paint.guideInitialized?menuOwner.paint.layers.some(l=>l.guide&&l.visible):guideVisible(menu.key)} onClick={()=>{toggleGuide(menu.key);setMenu(null);}}>あたり画像表示</button>}
    <button role="menuitem" disabled={paintOwnerLocked(menuOwner)||menuOwner.paint.layers.some(l=>!paintLayerEditable(menuOwner,l))} onClick={()=>{chooseImage(true,menu.key);setMenu(null);}}>画像を読み込む</button>
    {canGeneratePaintOwner(menuOwner)&&<button role="menuitem" onClick={()=>{void generate(menu.key);setMenu(null);}}>{menuOwner.kind==='bubble'?'描き文字を生成':'生成'}</button>}
  </div></>,window.document.body);
  const geometryKey=scene.owners.map(o=>JSON.stringify([o.frame,o.paint.width,o.paint.height,o.paint.referenceFrame])).join('|');
  const geometry=useMemo(()=>requested?scene:null,[requested,geometryKey]);
  return <PaintLayerControlsContext.Provider value={{controls:layerHeader,folded:paletteFolded,setFolded:(key,value)=>setPaletteFolded(current=>({...current,[key]:value}))}}><PaintDetailsContext.Provider value={<>{detailControls}{effects}</>}><PaintToolsContext.Provider value={toolControls}><BubblePathToolContext.Provider value={bubblePathTool}><PaintInputActivityContext.Provider value={inputActive}><PaintWorkspaceContext.Provider value={value}><PaintGeometryContext.Provider value={geometry}>{children}{finishOpen&&requested&&!overlay&&<MangaFinishDialog loadError={images?'':error} scene={historyRef.current.present} images={images} assets={[...assets,...imports.map(item=>item.asset)]} selectedKeys={finishKeys} panel={panelIndex+1} onApply={acceptFinish} onClose={()=>setFinishOpen(false)}/>} {contextMenu}{eraseModeMenu}{backgroundTarget&&(BackgroundEditor?<BackgroundEditor onCaptureReady={setBackgroundCaptureReady} controller={backgroundController} disabled={busy||externalSuspended} pendingStages={stageImports} host={backgroundHost} paint={backgroundTarget.paint} stages={[...stages,...stageImports.map(i=>i.stage).filter(s=>!stages.some(saved=>saved.id===s.id))]} onCapture={captureBackground3d} onCancel={closeBackground3d}/>:<section class="background3d-controls" role="dialog" aria-label="3D背景の読み込み"><header><strong>3D背景</strong><button onClick={()=>setBackgroundOwner(null)}>保存せずに閉じる</button></header>{backgroundLoadError?<><p role="alert">3D機能を読み込めませんでした。{backgroundLoadError}</p><button onClick={()=>retryBackgroundLoad(value=>value+1)}>再試行</button></>:null}</section>)}<input hidden ref={input} type="file" accept="image/png,image/jpeg" onChange={e=>void importImage(e.currentTarget.files?.[0])}/></PaintGeometryContext.Provider></PaintWorkspaceContext.Provider></PaintInputActivityContext.Provider></BubblePathToolContext.Provider></PaintToolsContext.Provider></PaintDetailsContext.Provider></PaintLayerControlsContext.Provider>;
}
