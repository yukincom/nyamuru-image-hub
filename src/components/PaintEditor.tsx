import {canGeneratePaintOwner} from '../lib/qwenGeneration';
import { useContext, useEffect, useRef, useState, useLayoutEffect, useMemo } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { appendBackgroundCapture } from '../lib/background3d';
import {paintFolderChain,paintLayerVisible,paintLayerEditable,paintLayerPatchAllowed,paintOwnerLocked,paintOwnerPlacementLocked} from '../lib/paintLock';
import {paintLayerCoverage,pickPaintLayer,paintOwnerPoint,translatePaintLayer} from '../lib/paintLayerPicking';
import { moveBackgroundLayoutOwner } from '../lib/background3dLayout';
import type { BackgroundStage } from '../types';
import type { Background3dResult, Background3dController } from './Background3dEditor';
import { Pencil, Eraser, Minus, Square, Circle, MousePointer2, MousePointer, PenTool, Move, ArrowLeftRight, Sparkles } from 'lucide-preact';
import PaintLayerPalette, { PaintLayerControls } from './PaintLayerPalette';
import MangaFinishDialog, { type FinishBatch } from './MangaFinishDialog';
import { canFinishPaintLayer, finishLayerKey } from '../lib/mangaFinishLayers';
import PaintLayerEffects, { type PaintEffectsTab } from './PaintLayerEffects';
import { prepareGuideLayer } from '../lib/paintGuide';
import { newToneLayer } from '../lib/paintTone';
import { paintColorInk } from '../lib/paintColor';
import VectorControls, { type VectorDetailTab } from './VectorControls';
import PaintPenTools from './PaintPenTools';
import PaintSelectionTools from './PaintSelectionTools';
import { nextMonoInk, swapPaintInk, paintInks } from '../lib/paintInk';
import { alphaSelection, combineSelection, floodSelection, lassoSelection, type SelectionMode } from '../lib/rasterSelection';
import PaintShapeTools from './PaintShapeTools';
import { isShapeTool, nextPaintLineKind, paintToolForLayer, vectorInput, paintSelectionMode, type PaintLineKind } from '../lib/paintToolMode';
import { paintToolShortcut, paintInkShortcut, paintSizeShortcut, stepPaintSize, PAINT_SIZE_PRESETS } from '../lib/paintToolShortcuts';
import { loadVectorEraseMode, saveVectorEraseMode, type PaintCursorMode } from '../lib/paintPreferences';
import { PaintToolButton } from './PaintToolHelp';
import { defaultVectorStyle, alignVectors, distributeVectors, type VectorReference, type VectorEraseMode } from '../lib/vectorGeometry';
import { beginVectorDrag, updateVectorDrag, vectorAnchorAt, vectorResizeHandleAt, selectedVectorNodes, deleteSelectedVectorNodes, vectorPenEndpoint, type VectorDrag, type VectorState, type VectorTool } from '../lib/vectorGesture';
import { copyArtworkSize } from '../lib/artworkClipboard';
import type {QwenAdoption} from '../lib/qwenGeneration';
import type { ComponentChildren, ComponentProps, RefObject } from 'preact';
import { paintCheckpoint, type PaintController, type PaintImagePlacement, type PaintLayerAction, type PaintSessionSnapshot, type SharedPaintHistory } from '../lib/paintSession';
import { BubblePathToolContext, PaintGeometryContext, PaintInputActivityContext, PaintToolsContext, PaintDetailsContext, PaintLayerControlsContext, PaintWorkspaceContext, paintPaletteScope, usePaintWorkspace, type BubblePathToolMode, type PaintWorkspaceState, type PaintLayoutTarget } from '../lib/paintWorkspace';
import type { BBox, ImageAsset, PaintLayer, PaintPoint, PaintStroke, VectorPath, VectorStyle } from '../types';
import { movePaintEntry, paintGenerationOwner, addPaintLayer, addPaintFolder, ensureDirectPaintOwner, paintAddPosition, expandPaintOwnerToBounds, expandPaintOwnerToContent, insertGeneratedPaintImage, generatedPaintName, hasAdoptedPaintImages, movePaintFolder, newPaintLayer, paintLayerAboveNative, removePaintFolder, removePaintLayer, validatePaintDocument, type PaintAddPosition, type PaintOwner, type PaintScene, paintOwnerShouldClear, paintAssetIds } from '../lib/paintDocument';
import { decodePaintImage, loadPaintImages, renderPaintPng, readPaintPixels, readPaintMaskPixels, type PaintImages } from '../lib/paintRenderer';
import { prepareImageAsset, fitImageBox, imageCrop } from '../lib/imagePlacement';
import { PaintSmoother } from '../lib/paintStroke';
import { appendPaintSamples, canStartPaintMark, preparePaintMarkLayer, commitPaintStroke, commitVectorPaths, paintStrokeBounds, previewPaintStroke, type PaintStrokePreview, type PendingPaintStroke, type PaintSampleEvent } from '../lib/paintGesture';


export interface PaintResult { scene?:PaintScene; rebase?:boolean; owners:Array<{owner:PaintOwner;blob:Blob;remove?:true;metadataOnly?:true}>; imports:Array<{asset:ImageAsset;blob:Blob}>; stageImports?:Array<{stage:BackgroundStage;blob:Blob}> }
interface Props { onAddOutside?:(action:Extract<PaintLayerAction,{type:"add"|"add-folder"}>)=>void; selectedBubbleStroke?:{width:number;disabled:boolean;onChange:(width:number)=>void}; resume?:PaintSessionSnapshot; resumeImages?:PaintImages; sharedHistory?:SharedPaintHistory; historySteps?:number; stages?:BackgroundStage[]; zoomTool?:boolean; bubblePathTool?:BubblePathToolMode; onSelectBubblePath?:(mode:Exclude<BubblePathToolMode,false>)=>void; toolPaletteEnabled?:boolean; textTool?:boolean; textTools?:ComponentChildren; onStartPaint?:()=>boolean; onSelectLayout?:(target?:PaintLayoutTarget)=>void; onSelectOwner?:(key:string,native?:boolean)=>void; onSelectFigure?:(index:number)=>void; onToggleBubble?:(index:number,group?:boolean)=>void; controller?:RefObject<PaintController|null>; guideVisible?:(key:string)=>boolean; onToggleGuide?:(key:string)=>void; smoothing?:number; cursorMode?:PaintCursorMode; suspended?:boolean; onGenerate?:(owner:PaintOwner,images:PaintImages,pendingAssets:ImageAsset[])=>Promise<void>; initial?:PaintScene; initialOwner?:string; onReady?:()=>void; onEditText?:(index:number)=>void; embeddedLayers?:boolean; onReorderOwners?:(key:string,target:string,after:boolean)=>void; assets:ImageAsset[]; title:string; page:number; panelIndex:number; overlay:boolean; children:ComponentChildren; onApply:(result:PaintResult)=>Promise<void>; onClose:()=>void }
type Live=PendingPaintStroke;
type PaintTool=Exclude<PaintStroke['tool'],'clear'>|VectorTool|'lasso'|'wand';
const tools=[['vector-select','選択',MousePointer],['vector-node','ダイレクト選択',MousePointer2],['vector-pen','ベジェペン',PenTool],['pen','ペン',Pencil],['eraser','消しゴム',Eraser],['line','直線',Minus],['rectangle','四角',Square],['ellipse','楕円',Circle]] as const;
const vectorEraseChoices:ReadonlyArray<readonly [VectorEraseMode,string,string]>=[
  ['touch','触れた部分','消しゴムが触れた範囲だけを切り取る'],
  ['intersection','交点まで','触れた線を前後の交点まで消す'],
  ['whole','線全体','触れたパスを一本まるごと消す'],
];

const emptyScene:PaintScene={frame:{x:0,y:0,w:1,h:1},owners:[{key:'idle',kind:'background',index:0,label:'',frame:{x:0,y:0,w:1,h:1},paint:{version:1,width:1,height:1,dpi:100,layers:[newPaintLayer()]}}]};
const noPaintLayer:PaintLayer={id:'',name:'',visible:false,locked:false,opacity:1,blend:'normal',strokes:[],kind:'raster',colorMode:'color',antialias:3};
const paintImageSignature=(scene:PaintScene)=>[...new Set(scene.owners.flatMap(owner=>paintAssetIds(owner.paint)))].sort().join('\u0000');
export function PaintTools(){return <>{useContext(PaintToolsContext)}</>;}
export function PaintDetails(){return <>{useContext(PaintDetailsContext)}</>;}
export function PaintLayers(){return <>{usePaintWorkspace()?.layers}</>;}
export function PaintStatus(){return <>{usePaintWorkspace()?.status}</>;}

function UprightPaintBucketIcon({size=23}:{size?:number}){return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8V6a6 6 0 0 1 12 0v2"/><path d="M5 8h14l-1.4 12H6.4L5 8Z"/><path d="M6.1 13h11.8"/><path d="M6.8 14h10.4l-.6 5H7.4l-.6-5Z" fill="currentColor" opacity=".24" stroke="none"/></svg>}

export default function PaintEditor({onAddOutside,selectedBubbleStroke:bubbleStroke,resume,resumeImages,sharedHistory,historySteps=50,stages=[],zoomTool=false,bubblePathTool=false,onSelectBubblePath,toolPaletteEnabled=true,textTool=false,textTools,onStartPaint,onSelectLayout,onSelectOwner,onSelectFigure,onToggleBubble,controller,guideVisible=()=>true,onToggleGuide=()=>{},smoothing=0,cursorMode='circle',suspended:externalSuspended=false,onGenerate,initial:requested,initialOwner,onReady,onEditText,embeddedLayers=false,onReorderOwners,assets,title,onApply,onClose,page,panelIndex,overlay,children}:Props) {
  const [backgroundCaptureReady,setBackgroundCaptureReady]=useState(false);
  const [backgroundOwner,setBackgroundOwner]=useState<string|null>(null);
  const [backgroundSelection,setBackgroundSelection]=useState<string|null>(null);
  const backgroundMove=useRef<{key:string;before:PaintScene;current:PaintScene}|null>(null);
  const backgroundController=useRef<Background3dController|null>(null);
  const [backgroundHost,setBackgroundHost]=useState<HTMLDivElement|null>(null);
  const [BackgroundEditor,setBackgroundEditor]=useState<typeof import('./Background3dEditor').default|null>(null);
  const [backgroundLoadError,setBackgroundLoadError]=useState(''),[backgroundLoadAttempt,retryBackgroundLoad]=useState(0);
  useEffect(()=>{
    if(!backgroundOwner||BackgroundEditor)return;
    let cancelled=false;setBackgroundLoadError('');
    void import('./Background3dEditor').then(module=>{if(!cancelled)setBackgroundEditor(()=>module.default);}).catch(error=>{if(!cancelled)setBackgroundLoadError(error instanceof Error?error.message:'3D機能を読み込めませんでした');});
    return()=>{cancelled=true;};
  },[backgroundOwner,BackgroundEditor,backgroundLoadAttempt]);
  const [stageImports,setStageImportsState]=useState<NonNullable<PaintResult['stageImports']>>(resume?.stageImports??[]);
  const stageImportsRef=useRef(stageImports);
  function setStageImports(value:typeof stageImports|((items:typeof stageImports)=>typeof stageImports)){const next=typeof value==='function'?value(stageImportsRef.current):value;stageImportsRef.current=next;setStageImportsState(next);}
  const toolSuspended=externalSuspended||backgroundOwner!==null;
  const suspended=toolSuspended||textTool||zoomTool;
  const initial=requested??emptyScene;
  const [history,setHistoryState]=useState({initial,past:[] as PaintScene[],present:initial,future:[] as PaintScene[]});
  const historyRef=useRef(history);
  function setHistory(update:(value:typeof history)=>typeof history){
    const next=update(historyRef.current);historyRef.current=next;setHistoryState(next);
  }
  const checkpoint=useMemo(()=>paintCheckpoint(initial,resume?.saved),[initial]);
  const baseScene=history.initial===initial?history.present:initial;
  const [vectorPreview,setVectorPreview]=useState<PaintScene|null>(null);
  const [live,setLive]=useState<Live|undefined>();
  const rasterPreviewRef=useRef<PaintStrokePreview>();
  const rasterPreview=useMemo(()=>{
    if(!live){rasterPreviewRef.current=undefined;return;}
    try{return rasterPreviewRef.current=previewPaintStroke(baseScene,live,rasterPreviewRef.current);}catch{return;}
  },[baseScene,live]);
  const scene=vectorPreview??rasterPreview?.scene??baseScene;
  const [ownerKey,setOwnerKey]=useState(initialOwner??initial.owners[0].key);
  const [paletteFolded,setPaletteFolded]=useState<Record<string,boolean>>({});
  const paletteScope=paintPaletteScope(page,panelIndex,overlay);
  const owner=scene.owners.find(o=>o.key===ownerKey)??scene.owners[0];
  const [layerId,setLayerId]=useState(owner.paint.layers.findLast(layer=>!layer.locked)?.id??owner.paint.layers[0]?.id??'');
  const [finishOpen,setFinishOpen]=useState(false);
  const [finishSelection,setFinishSelection]=useState<{anchor:string;scope:string;keys:string[]}|null>(null);
  const anchor=finishLayerKey(owner.key,layerId);
  const finishKeys=finishSelection?.anchor===anchor&&finishSelection.scope===paletteScope?finishSelection.keys:[anchor];
  useEffect(()=>{
    if(requested)return ()=>setFinishOpen(false);
  },[requested]);
  const selectedFolder=owner.paint.folders?.find(folder=>folder.id===layerId);
  const layer=selectedFolder||!layerId?noPaintLayer:owner.paint.layers.find(l=>l.id===layerId)??owner.paint.layers[owner.paint.layers.length-1]??noPaintLayer;
  const hasLayer=layer!==noPaintLayer;
  const [decodedImages,setDecodedImages]=useState<PaintImages|null>(null);
  const ownedImages=useRef(new Set<HTMLImageElement>());
  function setImages(map:PaintImages|null){map?.forEach(image=>ownedImages.current.add(image));setDecodedImages(map);}
  function releaseImages(keep?:ReadonlyMap<string,HTMLImageElement>){
    const retained=new Set(keep?.values());
    for(const image of ownedImages.current)if(!retained.has(image)){image.src='';ownedImages.current.delete(image);}
    keep?.forEach(image=>ownedImages.current.add(image));
  }
  const images=history.initial===initial?decodedImages:null;
  const [imports,setImportsState]=useState<PaintResult['imports']>(resume?.imports??[]);
  const importsRef=useRef(imports);
  function setImports(value:typeof imports|((items:typeof imports)=>typeof imports)){const next=typeof value==='function'?value(importsRef.current):value;importsRef.current=next;setImportsState(next);}
  const [tool,setTool]=useState<PaintTool>('pen');
  const interactionRevision=useRef(0);
  const [maskTarget,setMaskTarget]=useState<{key:string;id:string;kind:'mask'}|null>(null);
  const selectedMask=layer.generationMask?'generationMask':maskTarget?.key===owner.key&&maskTarget.id===layer.id&&layer.mask?'mask':null;
  const paintTarget=(selectedMask==='generationMask'&&tool.startsWith('vector-')?null:selectedMask)??(layer.tone?.fill&&layer.mask&&!tool.startsWith('vector-')?'mask':null);
  const editingMask=paintTarget!==null;
  const maskPreview=selectedMask==='mask';
  const [penMenu,setPenMenu]=useState(false);
  const [eraserMenu,setEraserMenu]=useState<{x:number;y:number}|null>(null);
  const [inkColor,setInkColor]=useState('#000000');
  const [colorTarget,setColorTarget]=useState<'stroke'|'fill'>('stroke');
  const [lineKind,setLineKind]=useState<PaintLineKind>('raster');
  const [rasterSize,setRasterSize]=useState(8),[eraserSize,setEraserSize]=useState(8);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const imageTarget=useRef<{key:string;replace:boolean}|null>(null);
  const [menu,setMenu]=useState<{x:number;y:number;key:string}|null>(null);
  const gesture=useRef<{pointerId:number;live:Live;smoother:PaintSmoother;point:(event:PaintSampleEvent)=>PaintPoint;target:HTMLDivElement;cleanup:()=>void}|null>(null);
  const [vectorStyle,setVectorStyle]=useState(defaultVectorStyle);
  const [vectorTab,setVectorTab]=useState<VectorDetailTab>('line');
  const [effectsTab,setEffectsTab]=useState<PaintEffectsTab>('tone');
  const lastToolbarLayer=useRef(layer);if(requested)lastToolbarLayer.current=layer;
  const toolbarLayer=requested?layer:lastToolbarLayer.current;
  const vectorMode=!editingMask&&(tool==='eraser'?toolbarLayer.kind==='vector':tool.startsWith('vector-')||lineKind==='vector');
  const brushInk=['pen','eraser','fill','lasso','wand'].includes(tool);
  const inkTarget=brushInk?'brush':colorTarget;
  const inkMode=paintTarget==='generationMask'?'color':toolbarLayer.colorMode;
  const displayInk=(ink:string|null)=>paintColorInk(ink,inkMode);
  const paletteInks=inkMode==='monochrome'?paintInks.slice(0,2):inkMode==='grayscale'?[...paintInks.slice(0,2),{color:'#404040',name:'濃い灰'},{color:'#808080',name:'灰'},{color:'#bfbfbf',name:'薄い灰'}]:paintInks;
  const selectedInk=displayInk(inkTarget==='fill'?vectorStyle.fill:brushInk?inkColor:vectorStyle.stroke);
  const color=brushInk?inkColor:vectorStyle.stroke;
  const [selection,setSelection]=useState<{key:string;boxes:BBox[]}|null>(null);
  const selectionBoxes=selection?.key===owner.key?selection.boxes:null;
  const [lassoPreview,setLassoPreview]=useState<Array<{x:number;y:number}>>([]);
  const selectionPointer=useRef<{pointerId:number;points:Array<{x:number;y:number}>;cleanup:()=>void}|null>(null);
  const [selectTolerance,setSelectTolerance]=useState(24);
  const pendingContents=useRef<{key:string;id:string}|null>(null);
  const loadedInitial=useRef<PaintScene|null>(null);
  const failedImageSignature=useRef('');
  useEffect(()=>{if(images&&pendingContents.current){const p=pendingContents.current;pendingContents.current=null;selectOwner(p.key,p.id,true);}},[images]);
  const selectedBubbleStroke=!requested&&!textTool&&!zoomTool?bubbleStroke:undefined;
  const size=selectedBubbleStroke?.width??(tool==='eraser'?eraserSize:vectorMode?vectorStyle.width:rasterSize);
  function setCurrentSize(width:number){
    if(selectedBubbleStroke){if(!selectedBubbleStroke.disabled)selectedBubbleStroke.onChange(width);return;}
    if(tool==='eraser')setEraserSize(width);else if(vectorMode)changeVectorStyle({width});else setRasterSize(width);
  }
  const [vectorSelected,setVectorSelected]=useState<string[]>([]);
  const vectorState=useRef<VectorState>({paths:[],selected:[]});
  const [penCursor,setPenCursor]=useState<PaintWorkspaceState['penCursor']>('pen');
  const penHover=useRef<{x:number;y:number;tolerance:number}|null>(null);
  const vectorPointer=useRef<{pointerId:number;drag:VectorDrag;ownerKey:string;layerId:string;addedLayer?:PaintLayer;addedBelow?:string;target:HTMLDivElement;point:(e:PointerEvent)=>{x:number;y:number;shift:boolean;alt:boolean;meta:boolean};cleanup:()=>void}|null>(null);
  const [vectorReference,setVectorReference]=useState<VectorReference>('selection'),[vectorGap,setVectorGap]=useState(20);
  const [eraseMode,setEraseModeState]=useState<VectorEraseMode>(()=>loadVectorEraseMode(typeof localStorage==='undefined'?undefined:localStorage));
  const setEraseMode=(mode:VectorEraseMode)=>{setEraseModeState(mode);try{if(typeof localStorage!=='undefined')saveVectorEraseMode(localStorage,mode);}catch{/* Keep the in-memory choice when storage is unavailable. */}};
  const inputActive=useRef(false);
  const operation=useRef(false);
  const raf=useRef(0),alive=useRef(true),imagesRef=useRef<PaintImages|null>(null);
  const dirty=checkpoint.hasChanges(scene);
  const locked=paintOwnerLocked(owner),layerLocked=!paintLayerEditable(owner,layer),layerVisible=paintLayerVisible(owner.paint,layer);
  const selectionTool=tool==='vector-select'||tool==='vector-node';
  const coverage=useMemo(()=>images?paintLayerCoverage(images):null,[images]);
  const layerMove=useRef<{pointerId:number;before:PaintScene;current:PaintScene;cleanup:()=>void;target:HTMLDivElement}|null>(null);
  useEffect(()=>{if(layerLocked||locked||!layerVisible||layer.opacity<=0){clearVectorSelection();setSelection(null);}},[layerLocked,locked,layerVisible,layer.opacity]);
  useEffect(()=>{
    if(!eraserMenu)return;
    const outside=(event:PointerEvent)=>{if(!(event.target instanceof Element&&event.target.closest('.vector-eraser-menu')))setEraserMenu(null);};
    document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
  },[eraserMenu]);
  const canEditLayer=Boolean(hasLayer&&layerVisible&&!layerLocked&&(paintTarget!=='mask'||layer.mask?.enabled));
  const createsMark=['pen','fill','line','rectangle','ellipse','vector-pen'].includes(tool);
  const paintActive=Boolean(requested)&&!textTool&&!zoomTool;
  const canDraw=Boolean(paintActive&&!selectedFolder&&images&&!busy&&!suspended&&!locked&&(canEditLayer||!editingMask&&createsMark&&canStartPaintMark(owner,hasLayer?layer:undefined,vectorMode?'vector':'raster')));
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
  useLayoutEffect(()=>{
    releaseImages(resumeImages);
    setHistory(()=>({initial,past:[],present:initial,future:[]}));
    const selected=initial.owners.find(o=>o.key===(resume?.ownerKey??initialOwner))??initial.owners[0];
    setOwnerKey(selected.key);setLayerId(resume?.layerId??selected.paint.layers.findLast(l=>!l.locked)?.id??selected.paint.layers[0]?.id??'');
    selectionPointer.current?.cleanup();selectionPointer.current=null;pendingContents.current=null;setSelection(null);setLassoPreview([]);loadedInitial.current=null;failedImageSignature.current='';imageTarget.current=null;setMenu(null);setPenMenu(false);setEraserMenu(null);setVectorPreview(null);setVectorSelected([]);vectorState.current={paths:[],selected:[]};vectorPointer.current?.cleanup();vectorPointer.current=null;layerMove.current?.cleanup();layerMove.current=null;
    setBackgroundOwner(null);setBackgroundSelection(null);backgroundMove.current=null;backgroundController.current=null;setStageImports(resume?.stageImports??[]);setMaskTarget(resume?.maskTarget??null);setImports(resume?.imports??[]);const readyImages=resumeImages&&initial.owners.every(owner=>paintAssetIds(owner.paint).every(id=>resumeImages.has(id))&&owner.paint.layers.every(layer=>!layer.guide||!!layer.image))?resumeImages:null;imagesRef.current=readyImages;setImages(readyImages);setLive(undefined);setError('');setBusy(false);
    gesture.current?.cleanup();gesture.current=null;inputActive.current=false;operation.current=false;
  },[initial]);
  const readyInitial=useRef<PaintScene|null>(null);
  useEffect(()=>{if(requested&&(images||error)&&loadedInitial.current===initial&&readyInitial.current!==initial){readyInitial.current=initial;onReady?.();}},[initial,images,error]);
  useEffect(()=>{
    if(!requested)return;
    let cancelled=false;alive.current=true;let map:PaintImages=new Map();
    void (async()=>{
      const pending=new Map(resume?.imports.map(item=>[item.asset.id,item.blob])),preparedImports:PaintResult['imports']=[];
      try{
        const owners:PaintOwner[]=[];
        const preparedGuides:Array<{before:PaintOwner;prepared:PaintOwner}>=[];
        for(const owner of initial.owners){
          const layers:PaintLayer[]=[];
          let repairedImage=false;
          for(const layer of owner.paint.layers){
            if(cancelled)return;
            let repair=layer.guide&&!layer.image;
            if(layer.guide&&layer.image&&!resumeImages?.has(layer.image.assetId)){
              try{
                const probe=await loadPaintImages([{...owner.paint,layers:[layer]}],assets,pending);
                probe.forEach(image=>{image.src='';});
              }catch{repair=true;repairedImage=true;}
            }
            if(repair){
              const prepared=await prepareGuideLayer(owner,{...layer,image:undefined});
              layers.push({...prepared.layer,locked:layer.locked});
              preparedImports.push({asset:prepared.asset,blob:prepared.blob});pending.set(prepared.asset.id,prepared.blob);
            }else layers.push(layer);
          }
          const prepared=layers.some((l,i)=>l!==owner.paint.layers[i])?{...owner,paint:{...owner.paint,layers}}:owner;
          owners.push(prepared);
          if(prepared!==owner&&!repairedImage)preparedGuides.push({before:owner,prepared});
        }
        if(cancelled)return;
        const allAssets=[...assets,...preparedImports.map(item=>item.asset)];
        map=await loadPaintImages(owners.map(owner=>owner.paint),allAssets,pending,resumeImages);
        if(cancelled)return;
        for(const {before,prepared} of preparedGuides)checkpoint.prepareGuide(before,prepared);
        if(preparedImports.length){setImports(items=>[...items,...preparedImports]);setHistory(h=>({...h,present:{...initial,owners}}));}
        releaseImages(map);
        loadedInitial.current=initial;failedImageSignature.current='';imagesRef.current=map;setImages(map);
      }catch(error){map.forEach((image,id)=>{if(image!==resumeImages?.get(id))image.src='';});throw error;}
      finally{if(cancelled)map.forEach((image,id)=>{if(image!==resumeImages?.get(id))image.src='';});}
    })().catch(e=>{if(!cancelled){loadedInitial.current=initial;failedImageSignature.current=paintImageSignature(initial);setError(e instanceof Error?e.message:'原本を読み込めません');}});
    return()=>{cancelled=true;alive.current=false;selectionPointer.current?.cleanup();selectionPointer.current=null;gesture.current?.cleanup();gesture.current=null;vectorPointer.current?.cleanup();vectorPointer.current=null;layerMove.current?.cleanup();layerMove.current=null;inputActive.current=false;cancelAnimationFrame(raf.current);};
  },[initial]);
  useEffect(()=>()=>releaseImages(),[]);
  const recoveryImageSignature=paintImageSignature(scene);
  useEffect(()=>{
    if(!requested||images||loadedInitial.current!==initial||failedImageSignature.current===recoveryImageSignature)return;
    let cancelled=false;
    failedImageSignature.current=recoveryImageSignature;
    const pending=new Map(imports.map(item=>[item.asset.id,item.blob]));
    const allAssets=[...assets,...imports.map(item=>item.asset).filter(asset=>!assets.some(saved=>saved.id===asset.id))];
    void loadPaintImages(scene.owners.map(owner=>owner.paint),allAssets,pending).then(value=>{
      if(cancelled)value.forEach(image=>{image.src='';});
      else{imagesRef.current=value;setImages(value);setError('');failedImageSignature.current='';}
    }).catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:'原本を読み込めません');});
    // Published images belong to the session; setImages must not dispose its own result.
    return()=>{cancelled=true;};
  },[initial,recoveryImageSignature,images,assets,imports]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
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
  function finishGesture(keep=true){
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
  function inputPoint(event:Pick<PointerEvent,'clientX'|'clientY'>,target:HTMLDivElement,rect:DOMRect,targetOwner=owner){
    return paintOwnerPoint(targetOwner,{x:(event.clientX-rect.left)*Number(target.dataset.paperWidth)/rect.width,y:(event.clientY-rect.top)*Number(target.dataset.paperHeight)/rect.height});
  }
  function inputTolerance(target:HTMLDivElement,rect:DOMRect,targetOwner=owner){
    return 7*Number(target.dataset.paperWidth)/rect.width*targetOwner.paint.width/targetOwner.frame.w;
  }
  function beginLayerSelection(event:PointerEvent&{currentTarget:HTMLDivElement},onSelectionMiss?:(behindOwnerKey?:string,aboveNative?:boolean)=>boolean){
    const target=event.currentTarget,rect=target.getBoundingClientRect();if(!rect.width||!rect.height||!coverage)return;
    const local=inputPoint(event,target,rect),tolerance=inputTolerance(target,rect);
    // Handles can be outside the visible stroke. Only the active editable layer owns them.
    if(layerVisible&&layer.opacity>0&&paintLayerEditable(owner,layer)&&(tool==='vector-node'
      ?vectorAnchorAt(layer.paths??[],vectorState.current.selected,local,tolerance)
      :tool==='vector-select'&&vectorResizeHandleAt(layer.paths??[],vectorState.current.selected,local,tolerance))){
      beginVector(event);return;
    }
    const point={x:(event.clientX-rect.left)*Number(target.dataset.paperWidth)/rect.width,y:(event.clientY-rect.top)*Number(target.dataset.paperHeight)/rect.height};
    const hit=pickPaintLayer(historyRef.current.present,point,7*Number(target.dataset.paperWidth)/rect.width,coverage);
    if(hit){
      if(onSelectionMiss?.(hit.owner.key,hit.owner.kind==='bubble'&&paintLayerAboveNative(hit.owner.paint,hit.layer))){clearVectorSelection();return;}
      if(tool==='vector-node'&&hit.layer.kind!=='vector'&&onSelectLayout){onSelectLayout({key:hit.owner.key,direct:tool==='vector-node'});return;}
      if(hit.pathId){beginVector(event,hit.owner,hit.layer);return;}
      clearVectorSelection();setOwnerKey(hit.owner.key);setLayerId(hit.layer.id);setMaskTarget(null);setSelection(null);
      if(tool==='vector-select')beginLayerMove(event,hit.owner,hit.layer);
    }else if(onSelectionMiss?.())clearVectorSelection();
    else if(layerVisible&&layer.opacity>0&&paintLayerEditable(owner,layer)&&layer.kind==='vector')beginVector(event);
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
  function beginVector(event:PointerEvent&{currentTarget:HTMLDivElement},targetOwner=owner,pickedLayer=layer){
    penHover.current=null;setPenCursor('pen');
    const createsPath=event.button!==5&&['vector-pen','line','rectangle','ellipse'].includes(tool);
    const existing=pickedLayer===noPaintLayer?undefined:pickedLayer;
    const targetLayer=createsPath?preparePaintMarkLayer(targetOwner,existing,'vector',scene.colorMode,scene.layerSequence):existing;
    if(!targetLayer||!paintLayerEditable(targetOwner,targetLayer)||targetLayer.kind!=='vector'){clearVectorSelection();return;}
    const addedLayer=targetLayer!==existing?targetLayer:undefined;
    const target=event.currentTarget,rect=target.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const point=(e:PointerEvent)=>({...inputPoint(e,target,rect,targetOwner),shift:e.shiftKey,alt:e.altKey,meta:e.metaKey||e.ctrlKey});
    const tolerance=inputTolerance(target,rect,targetOwner);
    const same=targetOwner.key===owner.key&&targetLayer.id===layer.id;
    const before={...(same?vectorState.current:{selected:[]}),paths:targetLayer.paths??[]};
    if(!same){setOwnerKey(targetOwner.key);setLayerId(targetLayer.id);setMaskTarget(null);setSelection(null);}
    const inputSize=event.button===5?eraserSize:size;
    const drag=beginVectorDrag(before,(event.button===5?'eraser':tool) as VectorTool,point(event),{...vectorStyle,width:inputSize},tolerance,eraseMode,inputSize/2);
    const move=(e:PointerEvent)=>{const g=vectorPointer.current;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();e.stopPropagation();if(e.buttons===0){finishVector(false);return;}updateVectorDrag(g.drag,g.point(e));showVectorDrag();};
    const end=(e:PointerEvent)=>{const g=vectorPointer.current;if(!g||e.pointerId!==g.pointerId)return;e.preventDefault();e.stopPropagation();if(e.type==='pointerup'&&(g.drag.kind!=='new-anchor'||Math.hypot(g.point(e).x-g.drag.start.x,g.point(e).y-g.drag.start.y)>.1))updateVectorDrag(g.drag,g.point(e));finishVector(e.type==='pointerup');};
    const blur=()=>finishVector(false);const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',blur);target.removeEventListener('lostpointercapture',end);};
    vectorPointer.current={pointerId:event.pointerId,drag,ownerKey:targetOwner.key,layerId:targetLayer.id,addedLayer,addedBelow:addedLayer?existing?.id:undefined,target,point,cleanup};inputActive.current=true;
    window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',blur);target.addEventListener('lostpointercapture',end);
    try{target.setPointerCapture(event.pointerId);}catch{}showVectorDrag();
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
  function addPoints(event:PointerEvent){
    const g=gesture.current;if(!g)return;
    const from=g.live.stroke.points.length;
    appendPaintSamples(g.live.stroke,g.smoother,event,g.point);
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
    if(!id&&onSelectOwner&&(target.kind==='figure'||target.kind==='bubble'||target.kind==='original')){onSelectOwner(key,native);return;}
    setFinishSelection(null);
    clearVectorSelection();setMaskTarget(null);setOwnerKey(key);const selectedLayer=id?target.paint.layers.find(l=>l.id===id):undefined;setLayerId(id??'');
    if(selectedLayer?.tone?.enabled&&!rasterMask)setEffectsTab('tone');
    if(selectedLayer&&!contents)matchLayerPen(rasterMask?'raster':selectedLayer.kind);
    if(selectedLayer?.generationMask&&!['#ff0000','#0000ff','#00ff00','#ffff00'].includes(inkColor))setInkColor('#ff0000');
    if(target.kind==='background')onSelectLayout?.();
    if(key!==owner.key)setSelection(null);
    if(contents&&selectedLayer&&paintLayerVisible(target.paint,selectedLayer)&&paintLayerEditable(target,selectedLayer)){
      if(selectedLayer.kind==='vector'){const paths=selectedLayer.paths??[];vectorState.current={paths,selected:paths.map(p=>p.id)};setVectorSelected(paths.map(p=>p.id));setTool('vector-select');}
      else if(images&&loadedInitial.current===initial){setSelection({key,boxes:alphaSelection(readPaintPixels(target.paint,selectedLayer,images))});setTool('lasso');}
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
      if(event.pointerType==='touch'){if(gesture.current||vectorPointer.current||selectionPointer.current){event.preventDefault();event.stopPropagation();}return;}
      if((!canDraw&&!(selectionTool&&event.button===0))||busy||suspended||operation.current||inputActive.current||!event.isPrimary||(event.button!==0&&event.button!==5)||gesture.current||vectorPointer.current||selectionPointer.current)return;
      event.preventDefault();event.stopPropagation();
      if(event.button===5&&!canEditLayer)return;
      if(event.button===0&&selectionTool){beginLayerSelection(event,onSelectionMiss);return;}
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
      const point=(sample:PaintSampleEvent):PaintPoint=>({...inputPoint(sample,target,rect),pressure:sample.pointerType==='pen'?Math.max(0,Math.min(1,sample.pressure)):1,time:sample.timeStamp});
      const smoother=new PaintSmoother(isShapeTool(tool)?0:smoothing);
      const selectionForMark=selectionBoxes;
      const next:Live={ownerKey:owner.key,layerId:active.id,space:{frame:{...owner.frame},width:owner.paint.width,height:owner.paint.height},...(paintTarget==='mask'?{target:'mask' as const}:{}),...(active!==layer?{addedLayer:active,addedBelow:hasLayer?layer.id:undefined}:{}),stroke:{tool:event.button===5?'eraser':tool as PaintStroke['tool'],color,...(selectionForMark?{selection:selectionForMark}:{}),...(event.button!==5&&(tool==='rectangle'||tool==='ellipse')?{fill:vectorStyle.fill}:{}),size:event.button===5?eraserSize:size,points:[smoother.push(point(event))]}};
      next.bounds=paintStrokeBounds(next.stroke);
      const blur=()=>finishGesture(false);
      const cleanup=()=>{window.removeEventListener('pointermove',movePointer,true);window.removeEventListener('pointerup',endPointer,true);window.removeEventListener('pointercancel',endPointer,true);window.removeEventListener('blur',blur);};
      gesture.current={pointerId:event.pointerId,live:next,smoother,point,target,cleanup};inputActive.current=true;
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
  function selectTool(next:PaintTool){
    if(busy||toolSuspended||operation.current)return;
    interactionRevision.current++;
    if(paintSelectionMode(next,Boolean(requested)&&!textTool&&!zoomTool,hasLayer?layer.kind:undefined,hasLayer&&!layer.guide&&owner.kind!=='original')==='layout'&&(next==='vector-node'?onSelectBubblePath:onSelectLayout)){
      finishGesture();
      if(requested&&onSelectLayout)onSelectLayout({key:owner.key,direct:next==='vector-node'});
      else if(next==='vector-node'&&onSelectBubblePath)onSelectBubblePath('node');
      else onSelectLayout?.();
      return;
    }
    if((!requested||textTool||zoomTool)&&!onStartPaint?.())return;
    finishGesture();if(next.startsWith('vector-'))setMaskTarget(null);setTool(next);setLineKind(previous=>nextPaintLineKind(previous,next));setPenMenu(false);setEraserMenu(null);
    // An explicit tool change ends drawing. Option temporarily converts points
    // within the pen gesture, without selecting a different tool.
    if(tool!==next)vectorState.current={...vectorState.current,activePath:undefined};
  }
  useEffect(()=>{
    if(!toolPaletteEnabled||toolSuspended)return;
    const keydown=(event:KeyboardEvent)=>{
      if(event.isComposing||event.defaultPrevented)return;
      // 前面のdialogで候補を操作している間は、背後の描画を開始しない。
      if(event.target instanceof Element&&event.target.closest('dialog[open]'))return;
      if(event.target instanceof HTMLElement&&(event.target.closest('input,textarea,select')||event.target.isContentEditable))return;
      const key=event.key.toLowerCase();
      const nextTool=paintToolShortcut(event);
      if(nextTool){if(!gesture.current&&!vectorPointer.current&&!busy&&!operation.current){event.preventDefault();event.stopPropagation();selectTool(nextTool);}return;}
      if(textTool||zoomTool){
        if(requested&&(event.metaKey||event.ctrlKey)&&(key==='z'||key==='y')){event.preventDefault();event.stopPropagation();key==='y'||event.shiftKey?redo():undo();}
        return;
      }
      const sizeDirection=paintSizeShortcut(event);
      if(sizeDirection){
        event.preventDefault();event.stopPropagation();
        if(!busy&&!operation.current&&!inputActive.current){
          if(selectedBubbleStroke)setCurrentSize(stepPaintSize(size,sizeDirection,true));
          else if(tool==='eraser')setEraserSize(value=>stepPaintSize(value,sizeDirection));
          else if(vectorMode)changeVectorStyle({width:stepPaintSize(vectorStyle.width,sizeDirection,true)});
          else setRasterSize(value=>stepPaintSize(value,sizeDirection));
        }
        return;
      }
      if(requested&&(event.metaKey||event.ctrlKey)&&key==='d'){event.preventDefault();event.stopPropagation();setSelection(null);clearVectorSelection();return;}
      if(requested&&selectionBoxes&&(key==='delete'||key==='backspace')&&!tool.startsWith('vector-')){event.preventDefault();event.stopPropagation();paintRegion(selectionBoxes,true);return;}
      if(paintInkShortcut(event)){event.preventDefault();event.stopPropagation();toggleInk();return;}
      if(requested&&key==='f'&&!event.shiftKey&&!event.altKey&&!event.metaKey&&!event.ctrlKey){event.preventDefault();event.stopPropagation();layerAction({type:'add-folder',key:owner.key});return;}
      // Let the description consume Escape before leaving the paint workspace.
      if(key==='escape'&&document.getElementById('paint-tool-description'))return;
      if(key==='escape'&&eraserMenu){event.preventDefault();event.stopPropagation();setEraserMenu(null);return;}
      if(key==='escape'&&penMenu){event.preventDefault();event.stopPropagation();setPenMenu(false);return;}
      if(key==='escape'&&menu){event.preventDefault();event.stopPropagation();setMenu(null);return;}
      if(key==='escape'&&requested&&inputActive.current){event.preventDefault();event.stopPropagation();finishGesture(false);return;}
      if(key==='escape'&&requested&&selectionBoxes){event.preventDefault();event.stopPropagation();setSelection(null);return;}
      if(key==='escape'&&requested){event.preventDefault();event.stopPropagation();if(vectorState.current.activePath)clearVectorSelection();else void requestClose().catch(()=>{});return;}
      if(!requested)return;
      if(key==='enter'&&vectorState.current.activePath){event.preventDefault();vectorState.current={...vectorState.current,activePath:undefined};return;}
      if((key==='delete'||key==='backspace')&&vectorSelected.length){event.preventDefault();deleteVectorSelection();return;}
      if((event.metaKey||event.ctrlKey)&&key==='a'&&!editingMask&&!layerLocked&&!locked&&layer.kind==='vector'){event.preventDefault();const selected=event.shiftKey?[]:(layer.paths??[]).map(p=>p.id);vectorState.current={paths:layer.paths??[],selected};setVectorSelected(selected);return;}
      if((event.metaKey||event.ctrlKey)&&key==='z'){event.preventDefault();event.stopPropagation();event.shiftKey?redo():undo();}
      if((event.metaKey||event.ctrlKey)&&key==='y'){event.preventDefault();event.stopPropagation();redo();}
    };
    window.addEventListener('keydown',keydown,true);return()=>window.removeEventListener('keydown',keydown,true);
  });
  const toolShortcuts:Partial<Record<PaintTool,string>>={'vector-select':'V','vector-node':'A'};
  const detailControls=<div class="paint-details"><VectorControls tab={vectorTab} setTab={setVectorTab} style={vectorStyle} change={changeVectorStyle} disabled={busy||suspended||layerLocked||locked} selectedCount={vectorSelected.length} reference={vectorReference} setReference={setVectorReference} gap={vectorGap} setGap={setVectorGap}
      align={mode=>changePaths(paths=>alignVectors(paths,vectorSelected,mode,vectorReference,{x:0,y:0,w:owner.paint.width,h:owner.paint.height},vectorSelected[0]))}
      distribute={(axis,mode,fixed)=>changePaths(paths=>distributeVectors(paths,vectorSelected,axis,mode,vectorReference,{x:0,y:0,w:owner.paint.width,h:owner.paint.height},vectorSelected[0],fixed?vectorGap:undefined))}
      eraseMode={eraseMode} setEraseMode={setEraseMode} erasing={tool==='eraser'}/></div>;
  function toggleFinishLayer(key:string,id:string){
    const target=scene.owners.find(item=>item.key===key)?.paint.layers.find(item=>item.id===id);
    if(!target||!canFinishPaintLayer(target)||busy||suspended)return;
    const picked=finishLayerKey(key,id);
    const previous=finishSelection?.anchor===anchor&&finishSelection.scope===paletteScope?finishKeys:hasLayer&&canFinishPaintLayer(layer)?[anchor]:[];
    setFinishSelection({anchor,scope:paletteScope,keys:previous.includes(picked)?previous.filter(item=>item!==picked):[...previous,picked]});
  }
  function openFinish(){
    if(overlay||busy||toolSuspended||operation.current)return;
    if((!requested||textTool||zoomTool)&&!onStartPaint?.())return;
    finishGesture();setMenu(null);setFinishOpen(true);
  }
  function acceptFinish(batch:FinishBatch){
    if(!alive.current||historyRef.current.present!==batch.source||operation.current||inputActive.current)throw new Error('選択したコマが変わりました。仕上げを開き直してください');
    imagesRef.current=batch.images;setImages(batch.images);
    setImports(items=>[...items,...batch.imports.filter(add=>!items.some(item=>item.asset.id===add.asset.id))]);
    const {ownerKey,folderId,shadeId}=batch.focus;
    const target=batch.scene.owners.find(item=>item.key===ownerKey)!;
    commit(batch.scene);
    setFinishSelection(null);setOwnerKey(ownerKey);setLayerId(shadeId??folderId);
    if(shadeId)setEffectsTab('tone');
    setMaskTarget(null);setSelection(null);setFinishOpen(false);
    setPaletteFolded(current=>{
      const next={...current,[paletteScope]:false,[`${paletteScope}/owner/${ownerKey}`]:false};
      if(target.parentKey)next[`${paletteScope}/owner/${target.parentKey}`]=false;
      for(const folder of paintFolderChain(target.paint,folderId))next[`${paletteScope}/folder/${folder.id}`]=false;
      return next;
    });
  }
  const toolControls=<div class="paint-tools">
    <div class="paint-tool-icons">
      {tools.slice(0,2).map(([value,label,Icon])=>{
        const layoutSelect=value==='vector-select';
        return <PaintToolButton class={`paint-tool-icon tool-${value}`} label={label} shortcut={toolShortcuts[value]} disabled={busy||toolSuspended} aria-pressed={paintActive?tool===value:layoutSelect?!textTool&&!zoomTool&&!bubblePathTool:bubblePathTool==='node'} onClick={()=>selectTool(value)}><Icon size={23}/></PaintToolButton>;
      })}
      <PaintPenTools tool={paintActive?tool:''} select={selectTool} disabled={busy||toolSuspended} open={penMenu} setOpen={setPenMenu}/>
      <PaintToolButton class="paint-tool-icon" label="ペン" shortcut="[ / ]：太さ" disabled={busy||toolSuspended} aria-pressed={paintActive&&tool==='pen'} onClick={()=>selectTool('pen')}><Pencil size={23}/></PaintToolButton>
      <PaintShapeTools tool={paintActive?tool:''} select={selectTool} disabled={busy||toolSuspended}/>{textTools}
      <PaintToolButton class="paint-tool-icon" label="消しゴム"  disabled={busy||toolSuspended} aria-pressed={paintActive&&tool==='eraser'} aria-haspopup="menu" aria-expanded={Boolean(eraserMenu)} onClick={()=>selectTool('eraser')} onContextMenu={event=>{event.preventDefault();event.stopPropagation();if(busy||toolSuspended)return;const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX||rect.left,y=event.clientY||rect.bottom;setEraserMenu({x:Math.max(8,Math.min(x,window.innerWidth-210)),y:Math.max(8,Math.min(y,window.innerHeight-150))});}}><Eraser size={23}/></PaintToolButton><PaintSelectionTools tool={paintActive?tool:''} select={selectTool} disabled={busy||toolSuspended}/>
      <PaintToolButton class="paint-tool-icon" label="漫画仕上げ" disabled={!toolPaletteEnabled||overlay||busy||toolSuspended} aria-haspopup="dialog" onClick={openFinish}><Sparkles size={23}/></PaintToolButton>
      {requested&&<PaintToolButton class="paint-tool-icon" label="配置へ戻る"  disabled={busy||toolSuspended} onClick={()=>void requestClose().catch(()=>{})}><Move size={23}/></PaintToolButton>}
      <PaintToolButton class="paint-tool-icon" label="バケツ"  disabled={busy||toolSuspended} aria-pressed={paintActive&&tool==='fill'} onClick={()=>selectTool('fill')}><UprightPaintBucketIcon/></PaintToolButton>
    </div>
    <div class={`paint-ink-controls ${brushInk?'is-brush-ink':''}`}>
      <div class="paint-ink-targets" role="group" aria-label={brushInk?'ブラシの描画色':'塗りと線'}>
        <PaintToolButton class="paint-ink-target paint-ink-fill" label={brushInk?'描画色':'塗りの色'} shortcut={brushInk?"X：白黒切替":undefined} aria-pressed={brushInk||colorTarget==='fill'} onClick={()=>{if(!brushInk)setColorTarget('fill');}}><span style={{background:displayInk(brushInk?inkColor:vectorStyle.fill)??'var(--paper)'}}>{!brushInk&&vectorStyle.fill===null&&<span class="ink-none-mark"/>}</span></PaintToolButton>
        <PaintToolButton class="paint-ink-target paint-ink-stroke" label="線（枠）の色"  disabled={brushInk} aria-pressed={!brushInk&&colorTarget==='stroke'} onClick={()=>setColorTarget('stroke')}><span style={{borderColor:brushInk?'#b8bcb8':displayInk(vectorStyle.stroke)??'transparent'}}>{!brushInk&&vectorStyle.stroke===null&&<span class="ink-none-mark"/>}</span></PaintToolButton>
        <PaintToolButton class="paint-ink-swap" label="塗りと線の色を交換"  disabled={brushInk||busy||suspended} onClick={swapInk}><ArrowLeftRight size={14}/></PaintToolButton>
      </div>
      <div class="paint-colors" role="group" aria-label={brushInk?'描画色':colorTarget==='fill'?'塗りの色':'線（枠）の色'}>{paletteInks.map(({color:value,name})=><PaintToolButton disabled={busy||suspended} class="paint-color" label={`${brushInk?'描画色':colorTarget==='fill'?'塗り':'線（枠）'}：${name}`} shortcut={brushInk?"X：白黒切替":"X：黒・白・透明"} aria-pressed={selectedInk===value} style={{'--paint-color':value}} onClick={()=>chooseInk(value)}><span class="ink-swatch"/></PaintToolButton>)}
      {!brushInk&&<PaintToolButton disabled={busy||suspended} class="paint-color" label="透明"  aria-pressed={selectedInk===null} onClick={()=>chooseInk(null)}><span class="ink-swatch ink-no-fill"><span class="ink-none-mark"/></span></PaintToolButton>}</div>
    </div>
    {(tool==='wand'||tool==='fill')&&<label>許容差<input aria-label="色の許容差" type="number" min="0" max="255" value={selectTolerance} onChange={e=>setSelectTolerance(Math.max(0,Math.min(255,e.currentTarget.valueAsNumber||0)))}/></label>}
    <div class="paint-size" data-line-kind={selectedBubbleStroke||vectorMode?'vector':'raster'} data-tool-label="太さ" data-tool-shortcut="[ / ]：太さ"><span>太さ</span><output>{selectedBubbleStroke?Math.round(size*1000)/1000:size} px</output><div class="paint-size-palette" role="radiogroup" aria-label={selectedBubbleStroke?'吹き出しの太さ':tool==='eraser'?'消しゴムの太さ':vectorMode?'ベクターの太さ':'ペンの太さ'}>{PAINT_SIZE_PRESETS.map(value=>{const diameter=Math.min(18,Math.max(2,2+Math.log10(value*10+1)*6));return <button key={value} type="button" role="radio" disabled={busy||suspended||selectedBubbleStroke?.disabled} data-paint-size={value} aria-label={`太さ ${value} px`} aria-checked={selectedBubbleStroke?Math.abs(size-value)<1e-6:size===value} aria-pressed={selectedBubbleStroke?Math.abs(size-value)<1e-6:size===value} onClick={()=>setCurrentSize(value)}><span class="paint-size-dot" style={{width:`${diameter}px`,height:`${diameter}px`}}/><small>{value}</small></button>;})}</div></div>
    <div class="paint-aa"><span>{inkMode==='monochrome'?'アンチエイリアス：なし固定':'アンチエイリアス'}</span><div class="vector-choice-icons" role="group" aria-label="アンチエイリアス">{(['なし','弱','中','強'] as const).map((label,value)=><PaintToolButton label={`アンチエイリアス：${label}`}  disabled={!requested||busy||suspended||locked||layerLocked||inkMode==='monochrome'} aria-pressed={(inkMode==='monochrome'?0:toolbarLayer.antialias??3)===value} onClick={()=>updateOwnerLayer(owner.key,layer.id,{antialias:value as 0|1|2|3})}><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="currentColor"/>{value>0&&<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="3" opacity={value/5}/>}</svg></PaintToolButton>)}</div></div>
  </div>;
  const eraseModeMenu=eraserMenu&&typeof document!=='undefined'?createPortal(<div class="paint-dock vector-eraser-menu" role="menu" aria-label="ベクター消しゴムの消し方" style={{left:eraserMenu.x,top:eraserMenu.y}} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const choices=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')),at=choices.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?choices.length-1:event.key==='ArrowDown'?(at+1)%choices.length:(at+choices.length-1)%choices.length;choices[next]?.focus();}}>{vectorEraseChoices.map(([mode,label,description])=><button type="button" role="menuitemradio" aria-checked={eraseMode===mode} data-erase-mode={mode} autoFocus={eraseMode===mode} onClick={()=>{setEraseMode(mode);selectTool('eraser');setEraserMenu(null);}}><span aria-hidden="true">{eraseMode===mode?'●':'○'}</span><span><strong>{label}</strong><small>{description}</small></span></button>)}</div>,document.body):null;
  function layerAction(action:PaintLayerAction){
    if(action.type==='background3d'){openBackground3d(action.key);return;}
    if(action.type==='guide'){toggleGuide(action.key);return;}
    if(action.type==='menu'){setMenu({key:action.key,x:action.x,y:action.y});return;}
    if(action.type==='select'){if(action.mask&&(action.id!==undefined||action.mask==='generationMask'))selectMask(action.key,action.id??'',action.mask);else selectOwner(action.key,action.id,action.contents,action.native);return;}
    if(action.type==='update'){updateOwnerLayer(action.key,action.id,action.patch);return;}
    if(action.type==='generation-mask'){const target=createGenerationMask(action.key);if(action.select&&target)selectMask(target.owner.key,target.layer.id,'generationMask');return;}
    const moving=action.type==='move-layer'||action.type==='move-folder';
    if(busy||(moving?toolSuspended:suspended)||operation.current||inputActive.current)return;
    let current=historyRef.current.present,target=current.owners.find(o=>o.key===action.key);
    if(!target)return;
    if(moving&&action.destination){
      const destination=action.destination;
      let destinationKey=destination.key;
      if(destination.stack){const direct=ensureDirectPaintOwner(current,destination.stack);if(!direct)return;current=direct.scene;destinationKey=direct.key;target=current.owners.find(o=>o.key===action.key)!;}
      const other=current.owners.find(item=>item.key===destinationKey);if(!other)return;
      if(other!==target){
        const moved=movePaintEntry(target,other,action.type==='move-folder'?'folder':'layer',action.id,action.target);if(!moved)return;
        commit({...current,owners:current.owners.map(item=>item===target?moved.source:item===other?moved.destination:item)});
        if(ownerKey===target.key&&(layerId===action.id||action.type==='move-folder'&&paintFolderChain(target.paint,selectedFolder?.id??layer.folderId).some(folder=>folder.id===action.id))){
          setOwnerKey(other.key);if(maskTarget)setMaskTarget({...maskTarget,key:other.key});
        }
        return;
      }
    }
    if(action.type==='add'||action.type==='add-folder'){
      if(!overlay&&(paletteFolded[paletteScope]===true||target.inheritedLocked)){onAddOutside?.(action);return;}
      const folded=(id:string)=>paletteFolded[`${paletteScope}/folder/${id}`]??false;
      const ownerFolded=(paletteFolded[`${paletteScope}/owner/${target.key}`]??target.kind==='bubble')||Boolean(target.parentKey&&(paletteFolded[`${paletteScope}/owner/${target.parentKey}`]??true));
      const external=target.kind!=='panel'&&target.kind!=='page'&&(ownerFolded||paintOwnerLocked(target));
      const position:PaintAddPosition=action.position??(external?{stack:{below:target.parentKey&&(ownerFolded||target.inheritedLocked)?target.parentKey:target.key}}:paintAddPosition(target,target.key===owner.key?layerId:undefined,folded));
      if(position.stack){const direct=ensureDirectPaintOwner(current,position.stack);if(!direct)return;current=direct.scene;target=current.owners.find(item=>item.key===direct.key)!;}
      if(paintOwnerLocked(target))return;
      if(action.type==='add'){
        const added=addPaintLayer(current,target.key,action.kind,{...position,stack:undefined});if(!added)return;
        commit(added.scene);setOwnerKey(added.key);setLayerId(added.layer.id);clearVectorSelection();setMaskTarget(null);
        matchLayerPen(action.kind);
      }else{
        if((target.paint.folders?.length??0)>=64)return;
        const next=addPaintFolder(target.paint);
        if(position.aboveNative)next.folder.aboveNative=true;
        const drop=position.target;
        const paint=drop?movePaintFolder(next.paint,next.folder.id,drop):next.paint;
        commit({...current,owners:current.owners.map(item=>item===target?{...item,paint}:item)});
        setOwnerKey(target.key);setLayerId(next.folder.id);clearVectorSelection();setMaskTarget(null);setSelection(null);
      }
      return;
    }
    if(action.type==='owner-lock'){
      if(target.inheritedLocked)return;
      if(target.kind==='bubble'&&!action.group){
        if(target.locked||target.bubble?.nativeLocked===action.locked)return;
        commit({...current,owners:current.owners.map(o=>o===target?{...o,bubble:{...o.bubble!,nativeLocked:action.locked||undefined}}:o)});return;
      }
      if(target.locked===action.locked)return;
      commit({...current,owners:current.owners.map(o=>{
        if(o===target)return {...o,locked:action.locked,...(!action.locked?{...(o.bubble?{bubble:{...o.bubble,nativeLocked:undefined}}:{}),paint:{...o.paint,folders:o.paint.folders?.map(folder=>({...folder,locked:false})),layers:o.paint.layers.map(layer=>({...layer,locked:false}))}}:{})};
        if(action.group&&o.parentKey===target.key)return {...o,inheritedLocked:action.locked,...(!action.locked?{locked:false,paint:{...o.paint,folders:o.paint.folders?.map(folder=>({...folder,locked:false})),layers:o.paint.layers.map(layer=>({...layer,locked:false}))}}:{})};
        return o;
      })});return;
    }
    if(action.type==='update-folder'){
      const folder=target.paint.folders?.find(folder=>folder.id===action.id);if(!folder)return;
      if(action.patch.locked!==undefined&&(paintOwnerLocked(target)||paintFolderChain(target.paint,folder.parentFolderId).some(parent=>parent.locked)))return;
      const folders=target.paint.folders!.map(item=>item===folder?{...item,...action.patch}:item);
      commit({...current,owners:current.owners.map(o=>o===target?{...o,paint:{...o.paint,folders}}:o)});return;
    }
    if(action.type!=='toggle'&&paintOwnerLocked(target))return;
    if((action.type==='rename-folder'||action.type==='remove-folder'||action.type==='move-folder')&&paintFolderChain(target.paint,action.id).some(folder=>folder.locked))return;
    if(action.type==='rename-folder'){
      const name=action.name.trim();if(!name||target.paint.folders?.find(folder=>folder.id===action.id)?.name===name)return;
      const folders=target.paint.folders?.map(folder=>folder.id===action.id?{...folder,name}:folder);if(!folders?.some(folder=>folder.id===action.id))return;
      commit({...current,owners:current.owners.map(o=>o.key===action.key?{...o,paint:{...o.paint,folders}}:o)});return;
    }
    if(action.type==='remove-folder'){
      const paint=removePaintFolder(target.paint,action.id);if(paint===target.paint)return;
      commit({...current,owners:current.owners.map(o=>o.key===action.key?{...o,paint}:o)});return;
    }
    if(action.type==='move-folder'||action.type==='move-layer'){
      const moved=movePaintEntry(target,target,action.type==='move-folder'?'folder':'layer',action.id,action.target);
      if(moved)commit({...current,owners:current.owners.map(o=>o===target?moved.destination:o)});
      return;
    }
    let layers=target.paint.layers;
    if(action.type==='toggle'){
      const visible=!layers.some(l=>l.visible);layers=layers.map(l=>({...l,visible}));
    }else{
      layers=[...layers];const from=layers.findIndex(l=>l.id===action.id);if(from<0||action.id===action.target)return;
      if(!paintLayerEditable(target,layers[from]))return;
      const moved=layers.splice(from,1)[0],to=layers.findIndex(l=>l.id===action.target);if(to<0)return;
      layers.splice(to+(action.after?0:1),0,moved);
    }
    commit({...current,owners:current.owners.map(o=>o.key===action.key?{...o,paint:{...o.paint,layers}}:o)});
  }
  function openBackground3d(key=owner.key){
    if(!requested||busy||suspended||operation.current||!images)return;
    const target=historyRef.current.present.owners.find(o=>o.key===key);if(!target||target.kind!=='background'||overlay||paintOwnerLocked(target))return;
    finishGesture();clearVectorSelection();setMaskTarget(null);setSelection(null);setOwnerKey(key);setMenu(null);setBackgroundSelection(null);setBackgroundOwner(key);
  }
  function beginBackgroundMove(key:string){
    if(!backgroundOwner||busy||externalSuspended||operation.current||!images)return false;
    endBackgroundMove();const before=historyRef.current.present;
    if(moveBackgroundLayoutOwner(before,key,1,0)===before)return false;
    setBackgroundSelection(key);backgroundMove.current={key,before,current:before};inputActive.current=true;return true;
  }
  function moveBackgroundOwner(dx:number,dy:number){
    const move=backgroundMove.current;if(!move)return;
    move.current=moveBackgroundLayoutOwner(move.before,move.key,dx,dy);setVectorPreview(move.current);
  }
  function endBackgroundMove(keep=true){
    const move=backgroundMove.current;if(!move)return;
    backgroundMove.current=null;inputActive.current=false;setVectorPreview(null);
    if(keep&&move.current!==move.before)commit(move.current);
  }
  function closeBackground3d(){endBackgroundMove();setBackgroundOwner(null);backgroundController.current=null;}
  async function captureBackground3d(result:Background3dResult){
    if(!backgroundOwner||!images||operation.current)return;
    endBackgroundMove();operation.current=true;setBusy(true);
    try{
    const snapshot=historyRef.current.present,target=snapshot.owners.find(o=>o.key===backgroundOwner);
    if(!target)throw new Error('背景の描画先が見つかりません');
    if(paintOwnerLocked(target))throw new Error('背景フォルダが固定されています');
    const layers=result.layers.map(layer=>layer.kind==='vector'?{...layer,colorMode:snapshot.colorMode??'color'}:layer);
    const paint=appendBackgroundCapture(target.paint,result.config,layers);
    validatePaintDocument(paint,[...assets,...imports.map(i=>i.asset),...result.imports.map(i=>i.asset)]);
    const decoded=await Promise.all(result.imports.map(async item=>({id:item.asset.id,image:await decodePaintImage(item.blob)})));
    const map=new Map(images);for(const item of decoded)map.set(item.id,item.image);imagesRef.current=map;setImages(map);
    setImports(items=>[...items.filter(item=>!result.imports.some(next=>next.asset.id===item.asset.id)),...result.imports]);
    setStageImports(items=>[...items.filter(item=>!result.stageImports.some(next=>next.stage.id===item.stage.id)),...result.stageImports]);
    commit({...snapshot,owners:snapshot.owners.map(o=>o.key===backgroundOwner?{...o,paint}:o)});
    setLayerId(result.layers.find(layer=>layer.kind==='vector')!.id);setLineKind('vector');setTool('vector-select');setBackgroundOwner(null);
    }finally{operation.current=false;if(alive.current)setBusy(false);}
    await flush(true);
  }
  const backgroundTarget=scene.owners.find(o=>o.key===backgroundOwner);
  const backgroundFrame=backgroundTarget?.paint.background3d?.frame??backgroundTarget?.paint.referenceFrame??(backgroundTarget?{x:0,y:0,w:backgroundTarget.paint.width,h:backgroundTarget.paint.height}:undefined);
  function selectMask(key:string,id:string,kind:'mask'|'generationMask'){
    if(busy||suspended||operation.current||inputActive.current)return;
    if(kind==='generationMask'){
      const target=historyRef.current.present.owners.find(owner=>owner.key===key),selected=target?.paint.layers.find(layer=>layer.generationMask&&(!id||layer.id===id));if(!target||!selected)return;
      finishGesture();clearVectorSelection();setOwnerKey(target.key);setLayerId(selected.id);setMaskTarget(null);setSelection(null);
      setPaletteFolded(current=>({...current,[`${paletteScope}/owner/${target.key}`]:false}));
      if(!['#ff0000','#0000ff','#00ff00','#ffff00'].includes(inkColor))setInkColor('#ff0000');
      matchLayerPen('raster');
    }else{
      if(selectedMask==='mask'&&owner.key===key&&layer.id===id){finishGesture();setMaskTarget(null);setSelection(null);matchLayerPen(layer.kind);return;}
      selectOwner(key,id,false,false,true);setMaskTarget({key,id,kind});
      const target=scene.owners.find(o=>o.key===key)?.paint.layers.find(l=>l.id===id);
      if(target?.mask&&!target.mask.enabled&&!target.locked)updateOwnerLayer(key,id,{mask:{...target.mask,enabled:true}});
    }
  }
  function addToneMask(){
    if(!images||locked||busy||suspended||operation.current||owner.paint.layers.length>=64)return;
    finishGesture();const added=newToneLayer(selectionBoxes,scene.colorMode);
    try{const next=expandPaintOwnerToBounds({...owner,paint:{...owner.paint,layers:[...owner.paint.layers,added]}},added.mask?.strokes[0]?paintStrokeBounds(added.mask.strokes[0]):undefined);
      commit({...scene,owners:scene.owners.map(o=>o.key===owner.key?next:o)});}
    catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');return;}
    setError('');clearVectorSelection();setLayerId(added.id);
    setMaskTarget({key:owner.key,id:added.id,kind:'mask'});setSelection(null);matchLayerPen('raster');
  }
  function addGenerationMask(){
    if(!images||busy||suspended)return;
    const target=createGenerationMask(owner.key);
    if(target)selectMask(target.owner.key,target.layer.id,'generationMask');
  }
  function toggleGuide(key:string){
    if(busy||suspended||operation.current||!images)return;
    const target=scene.owners.find(o=>o.key===key);if(!target)return;
    if(!target.paint.guideInitialized){onToggleGuide(key);return;}
    const guides=target.paint.layers.filter(l=>l.guide);if(!guides.length)return;
    const visible=!guides.some(l=>l.visible);
    commit({...scene,owners:scene.owners.map(o=>o===target?{...o,paint:{...o.paint,layers:o.paint.layers.map(l=>l.guide?{...l,visible}:l)}}:o)});
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
  const value:PaintWorkspaceState|null=requested?{displayOnly:!paintActive,editingMask:paintTarget??undefined,...(backgroundTarget&&backgroundFrame?{background3d:{ownerKey:backgroundTarget.key,frame:backgroundFrame,setHost:setBackgroundHost,selectedKey:backgroundSelection,select:key=>{setBackgroundSelection(key);const selected=scene.owners.find(o=>o.key===key);if(selected?.kind==='figure')onSelectFigure?.(selected.index);},beginMove:beginBackgroundMove,move:moveBackgroundOwner,endMove:endBackgroundMove}}:{}),page,panelIndex,overlay,scene,owner,images,live:vectorPreview?undefined:rasterPreview?.live,maskPreview:maskPreview?{ownerKey:owner.key,layerId:layer.id}:undefined,guideVisible,onContextMenu:openMenu,selectionTool,directSelection:tool==='vector-node',selectLayout:onSelectLayout,selection:selectionBoxes?{boxes:selectionBoxes,width:owner.paint.width,height:owner.paint.height}:undefined,lasso:lassoPreview,vector:{paths:layer.paths??[],selected:vectorSelected,selectedNodes:tool==='vector-node'?selectedVectorNodes({...vectorState.current,paths:layer.paths??[]}):vectorState.current.selectedNode?[vectorState.current.selectedNode]:undefined,width:owner.paint.width,height:owner.paint.height,handles:['vector-pen','vector-node','vector-add','vector-delete','vector-anchor'].includes(tool),selectionBox:tool==='vector-select'},penCursor:tool==='vector-pen'&&canDraw?penCursor:undefined,cursor:canDraw&&!selectionTool&&!zoomTool&&!textTool?{mode:!vectorMode&&!['lasso','wand','fill'].includes(tool)?cursorMode:'crosshair',size,eraserSize}:undefined,events,tools:toolControls,layers:layerControls,status,undo,redo,canUndo:!busy&&!suspended&&(sharedHistory?.canUndo??!!history.past.length),canRedo:!busy&&!suspended&&(sharedHistory?.canRedo??!!history.future.length)}:null;
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
