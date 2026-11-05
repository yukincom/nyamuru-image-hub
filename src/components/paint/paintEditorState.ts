import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { paintLayerVisible, paintLayerEditable, paintOwnerLocked } from '../../lib/paintLock';
import { paintLayerCoverage } from '../../lib/paintLayerPicking';
import type { BackgroundStage } from '../../types';
import type { Background3dController } from '../Background3dEditor';
import { finishLayerKey } from '../../lib/mangaFinishLayers';
import type { PaintEffectsTab } from '../PaintLayerEffects';
import { paintColorInk } from '../../lib/paintColor';
import type { VectorDetailTab } from '../VectorControls';
import { paintInks } from '../../lib/paintInk';
import type { PaintRuler, PaintRulerMode } from '../../lib/paintRuler';
import type { PaintLineKind } from '../../lib/paintToolMode';
import { loadVectorEraseMode, saveVectorEraseMode, type PaintCursorMode } from '../../lib/paintPreferences';
import { defaultVectorStyle, type VectorReference, type VectorEraseMode } from '../../lib/vectorGeometry';
import type { VectorDrag, VectorState, VectorTool } from '../../lib/vectorGesture';
import type { ComponentChildren, RefObject } from 'preact';
import {
  paintCheckpoint, type PaintController, type PaintLayerAction, type PaintSessionSnapshot,
  type SharedPaintHistory,
} from '../../lib/paintSession';
import {
  paintPaletteScope, type BubblePathToolMode, type PaintWorkspaceState, type PaintLayoutTarget,
} from '../../lib/paintWorkspace';
import type { BBox, ImageAsset, PaintBrush, PaintLayer, PaintPoint, PaintStroke } from '../../types';
import { newPaintLayer, type PaintOwner, type PaintScene } from '../../lib/paintDocument';
import type { PaintImages } from '../../lib/paintRenderer';
import { PaintSmoother } from '../../lib/paintStroke';
import {
  previewPaintStroke, type PaintStrokePreview, type PendingPaintStroke, type PaintSampleEvent,
} from '../../lib/paintGesture';

export interface PaintResult {
  scene?:PaintScene;
  rebase?:boolean;
  owners:Array<{owner:PaintOwner;blob:Blob;remove?:true;metadataOnly?:true}>;
  imports:Array<{asset:ImageAsset;blob:Blob}>;
  stageImports?:Array<{stage:BackgroundStage;blob:Blob}>;
}
export interface PaintEditorProps {
  onAddOutside?:(action:Extract<PaintLayerAction,{type:"add"|"add-folder"}>)=>void;
  selectedBubbleStroke?:{width:number;disabled:boolean;onChange:(width:number)=>void};
  resume?:PaintSessionSnapshot;
  resumeImages?:PaintImages;
  sharedHistory?:SharedPaintHistory;
  historySteps?:number;
  stages?:BackgroundStage[];
  zoomTool?:boolean;
  bubblePathTool?:BubblePathToolMode;
  onSelectBubblePath?:(mode:Exclude<BubblePathToolMode,false>)=>void;
  toolPaletteEnabled?:boolean;
  textTool?:boolean;
  textTools?:ComponentChildren;
  panelTools?:ComponentChildren;
  onStartPaint?:()=>boolean;
  onSelectLayout?:(target?:PaintLayoutTarget)=>void;
  onSelectOwner?:(key:string,native?:boolean)=>void;
  onSelectFigure?:(index:number)=>void;
  onToggleBubble?:(index:number,group?:boolean)=>void;
  controller?:RefObject<PaintController|null>;
  guideVisible?:(key:string)=>boolean;
  onToggleGuide?:(key:string)=>void;
  smoothing?:number;
  cursorMode?:PaintCursorMode;
  suspended?:boolean;
  onGenerate?:(owner:PaintOwner,images:PaintImages,pendingAssets:ImageAsset[])=>Promise<void>;
  initial?:PaintScene;
  initialOwner?:string;
  onReady?:()=>void;
  onEditText?:(index:number)=>void;
  embeddedLayers?:boolean;
  onReorderOwners?:(key:string,target:string,after:boolean)=>void;
  assets:ImageAsset[];
  title:string;
  page:number;
  panelIndex:number;
  overlay:boolean;
  children:ComponentChildren;
  onApply:(result:PaintResult)=>Promise<void>;
  onClose:()=>void;
}
export type Live=PendingPaintStroke;
export type PaintTool=Exclude<PaintStroke['tool'],'clear'>|VectorTool|'lasso'|'wand'|'ruler';
type RulerState={mode:PaintRulerMode}|{page:number;ruler:PaintRuler};
const emptyScene:PaintScene={frame:{x:0,y:0,w:1,h:1},owners:[{key:'idle',kind:'background',index:0,label:'',frame:{x:0,y:0,w:1,h:1},paint:{version:1,width:1,height:1,dpi:100,layers:[newPaintLayer()]}}]};
export const noPaintLayer:PaintLayer={id:'',name:'',visible:false,locked:false,opacity:1,blend:'normal',strokes:[],kind:'raster',colorMode:'color',antialias:3};

export function paintEditorOptions({
  selectedBubbleStroke: bubbleStroke, suspended: externalSuspended = false, initial: requested,
  historySteps = 50, stages = [], zoomTool = false, bubblePathTool = false, toolPaletteEnabled = true,
  textTool = false, guideVisible = () => true, onToggleGuide = () => {}, smoothing = 0,
  cursorMode = 'circle', embeddedLayers = false, ...options
}: PaintEditorProps) {
  return {
    ...options, bubbleStroke, externalSuspended, requested, historySteps, stages, zoomTool,
    bubblePathTool, toolPaletteEnabled, textTool, guideVisible, onToggleGuide, smoothing,
    cursorMode, embeddedLayers,
  };
}
export type PaintEditorOptions = ReturnType<typeof paintEditorOptions>;

export function usePaintEditorState(options: PaintEditorOptions, selectOwner: (key: string, id?: string, contents?: boolean, native?: boolean, rasterMask?: boolean) => void) {
  const {
    resume, externalSuspended, textTool, zoomTool, requested, initialOwner, page, panelIndex, overlay,
    bubbleStroke,
  } = options;
  const [backgroundCaptureReady,setBackgroundCaptureReady]=useState(false);
  const [backgroundOwner,setBackgroundOwner]=useState<string|null>(null);
  const [backgroundSelection,setBackgroundSelection]=useState<string|null>(null);
  const backgroundMove=useRef<{key:string;before:PaintScene;current:PaintScene}|null>(null);
  const backgroundController=useRef<Background3dController|null>(null);
  const [backgroundHost,setBackgroundHost]=useState<HTMLDivElement|null>(null);
  const [BackgroundEditor,setBackgroundEditor]=useState<typeof import('../Background3dEditor').default|null>(null);
  const [backgroundLoadError,setBackgroundLoadError]=useState(''),[backgroundLoadAttempt,retryBackgroundLoad]=useState(0);
  useEffect(()=>{
    if(!backgroundOwner||BackgroundEditor)return;
    let cancelled=false;setBackgroundLoadError('');
    void import('../Background3dEditor').then(module=>{if(!cancelled)setBackgroundEditor(()=>module.default);}).catch(error=>{if(!cancelled)setBackgroundLoadError(error instanceof Error?error.message:'3D機能を読み込めませんでした');});
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
  const [chosenTool,setTool]=useState<PaintTool>('pen');
  const [commandHeld,setCommandHeld]=useState(false);
  const [temporaryLayoutSelection,setTemporaryLayoutSelection]=useState(false);
  // Keep the chosen tool intact: holding Command changes input/display, not the document.
  const tool:PaintTool=commandHeld?'vector-select':chosenTool;
  const [rulerState,setRulerState]=useState<RulerState|null>(null);
  const ruler=rulerState&&'page' in rulerState&&rulerState.page===page?rulerState.ruler:null;
  const rulerMode=rulerState&&'mode' in rulerState?rulerState.mode:ruler?.mode??null;
  const rulerPointer=useRef<{pointerId:number;before:RulerState|null;target:HTMLDivElement;cleanup:()=>void}|null>(null);
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
  const [brush,setBrush]=useState<PaintBrush>('round'),[hatchingSize,setHatchingSize]=useState(100);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const imageTarget=useRef<{key:string;replace:boolean}|null>(null);
  const [menu,setMenu]=useState<{x:number;y:number;key:string}|null>(null);
  const gesture=useRef<{pointerId:number;live:Live;smoother:PaintSmoother;point:(event:PaintSampleEvent)=>PaintPoint;ruled:boolean;target:HTMLDivElement;cleanup:()=>void}|null>(null);
  const [vectorStyle,setVectorStyle]=useState(defaultVectorStyle);
  const [vectorTab,setVectorTab]=useState<VectorDetailTab>('line');
  const [effectsTab,setEffectsTab]=useState<PaintEffectsTab>('tone');
  const lastToolbarLayer=useRef(layer);
if(requested)lastToolbarLayer.current=layer;
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
  const size=selectedBubbleStroke?.width??(tool==='eraser'?eraserSize:vectorMode?vectorStyle.width:tool==='pen'&&brush==='rough-hatching'?hatchingSize:rasterSize);
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

  return {
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
    backgroundHost, backgroundLoadError, retryBackgroundLoad, selectionPointer, setLassoPreview, raf,
    rasterPreviewRef, setLive, rulerPointer, setRulerState, rulerMode, rulerState, coverage, eraseMode,
    selectTolerance, lineKind, color, failedImageSignature, setPenMenu, dirty, toolbarLayer, penMenu,
    vectorTab, setVectorTab, vectorReference, setVectorReference, vectorGap, setVectorGap, setEraseMode,
    setBrush, colorTarget, setColorTarget, displayInk, paletteInks, setSelectTolerance, inkMode,
  } as const;
}

export type PaintEditorState = ReturnType<typeof usePaintEditorState>;
