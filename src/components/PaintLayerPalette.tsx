import { ChevronDown, ChevronRight, Eye, Folder, FolderOpen, FolderPlus, FilePlus2, Copy, Trash2, PenTool, Type, Box, Camera, Layers, Bot } from 'lucide-preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaintFolder, PaintLayer, PaintGenerationMask } from '../types';
import {paintStackTarget,paintLayerTree,type PaintLayerDestination,type PaintLayerDropTarget,type PaintOwner,type PaintScene} from '../lib/paintDocument';
import { drawPaintMask, drawGenerationMask, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { PaintOriginal } from './PaintSceneView';
import { PaintToolButton } from './PaintToolHelp';
import LayerVisibilityButton from './LayerVisibilityButton';
import { bubbleVisible, canReorderBubbleLayers } from '../lib/panelLayers';
import { letteringFigureIndex, letteringLayerMove } from '../lib/bubbleRelations';
import LayerLockIcon from './LayerLockIcon';
import {paintGenerationMaskLocked,paintLayerVisible,paintLayerInheritedLocked,paintLayerEditable,paintOwnerLocked,paintOwnerPlacementLocked} from '../lib/paintLock';
import type { ComponentChildren } from 'preact';
import {PaintLayerControlsContext} from '../lib/paintWorkspace';

function Thumbnail({owner,layer,images}:{owner:PaintOwner;layer:PaintLayer;images:PaintImages|null}){
  const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof paintPreviewRenderer>|null>(null);
  // Working bleed is not part of the layer's thumbnail framing.
  const view=owner.paint.referenceFrame??{x:0,y:0,w:owner.paint.width,h:owner.paint.height};
  useEffect(()=>()=>renderer.current?.dispose(),[]);
  useLayoutEffect(()=>{if(!canvas.current||!images)return;const context=canvas.current.getContext('2d');if(layer.image&&!images.has(layer.image.assetId)){context?.clearRect(0,0,canvas.current.width,canvas.current.height);return;}renderer.current??=paintPreviewRenderer();try{renderer.current.draw(canvas.current,{...owner.paint,folders:undefined,layers:[{...layer,folderId:undefined,visible:true,opacity:1}]},images,undefined,undefined,false,view);}catch{context?.clearRect(0,0,canvas.current.width,canvas.current.height);}},[owner.paint.width,owner.paint.height,view.x,view.y,view.w,view.h,layer,images]);
  const scale=40/Math.max(view.w,view.h);
  return <canvas ref={canvas} width={Math.max(1,Math.round(view.w*scale))} height={Math.max(1,Math.round(view.h*scale))}/>;
}
function MaskThumbnail({owner,layer}:{owner:PaintOwner;layer:PaintLayer}){
  const ref=useRef<HTMLCanvasElement>(null);
  const view=owner.paint.referenceFrame??{x:0,y:0,w:owner.paint.width,h:owner.paint.height},scale=32/Math.max(view.w,view.h);
  useLayoutEffect(()=>{if(ref.current)drawPaintMask(ref.current,owner.paint,layer,undefined,view);},[owner.paint.width,owner.paint.height,view.x,view.y,view.w,view.h,layer.mask]);
  return <span class="layer-mask-thumbnail"><canvas ref={ref} width={Math.max(1,Math.round(view.w*scale))} height={Math.max(1,Math.round(view.h*scale))}/></span>;
}
function GenerationMaskThumbnail({owner}:{owner:PaintOwner}){
  const ref=useRef<HTMLCanvasElement>(null),scale=40/Math.max(owner.paint.width,owner.paint.height);
  useLayoutEffect(()=>{if(ref.current)drawGenerationMask(ref.current,owner.paint);},[owner.paint.width,owner.paint.height,owner.paint.generationMask]);
  return <span class="layer-thumbnail generation-mask-thumbnail"><canvas ref={ref} width={Math.max(1,Math.round(owner.paint.width*scale))} height={Math.max(1,Math.round(owner.paint.height*scale))}/></span>;
}
interface Props {
  paletteScope?:string; directPanel?:number; location?:{panelIndex:number;overlay:boolean};
  nativeTextLayers?:Array<{key:string;node:ComponentChildren}>;
  frameLayer?:ComponentChildren; selectedFolder?:PaintFolder;
  backgroundCapture?:{ready:boolean;capture:()=>void};
  selectedMask?:'mask'|'generationMask'|null;
  selectMask?:(key:string,id:string,kind:'mask'|'generationMask')=>void;
  addToneMask?:()=>void; addGenerationMask?:()=>void;canAddGenerationMask?:boolean;
  updateGenerationMask?:(key:string,patch:Partial<PaintGenerationMask>)=>void;
  selectedOwner?:string; canvasSelectionScrollRequest?:number; onToggleBubble?:(index:number,group?:boolean)=>void; openBackground3d?:()=>void;
  reorderGroup?:(key:string,target:string,after:boolean)=>void; embedded?:boolean; inactive?:boolean; onEditText?:(index:number)=>void; title:string; scene:PaintScene; owner:PaintOwner; layer:PaintLayer; images:PaintImages|null; disabled:boolean;
  select:(key:string,id?:string,contents?:boolean,native?:boolean)=>void; update:(key:string,id:string,patch:Partial<PaintLayer>)=>void;
  lockOwner:(key:string,locked:boolean,group?:boolean)=>void;
  toggleGroup:(key:string)=>void; guideVisible:(key:string)=>boolean; toggleGuide:(key:string)=>void;
  addFolder:()=>void; add:()=>void; addVector:()=>void; importImage:()=>void; reorder:(key:string,id:string,target:string,after:boolean)=>void; moveLayer:(key:string,id:string,target:PaintLayerDropTarget,destination?:PaintLayerDestination)=>void; moveFolder:(key:string,id:string,target:PaintLayerDropTarget,destination?:PaintLayerDestination)=>void; updateFolder:(key:string,id:string,patch:Partial<Pick<PaintFolder,'visible'|'locked'>>)=>void; renameFolder:(key:string,id:string,name:string)=>void; duplicate:()=>void; remove:()=>void;
  menu:(event:MouseEvent,key:string)=>void;
}
function LockButton({label,locked,inherited=false,disabled=false,onClick}:{label:string;locked:boolean;inherited?:boolean;disabled?:boolean;onClick:()=>void}){
  return <button type="button" class={`palette-icon layer-row-lock ${locked?'is-locked':'is-unlocked'} ${inherited?'is-inherited':''}`} aria-label={inherited?`${label}は親フォルダーで固定中`:locked?`${label}の固定を解除`:`${label}を固定`} aria-pressed={locked||inherited} disabled={disabled||inherited} onClick={event=>{event.stopPropagation();onClick();}}><LayerLockIcon size={16} locked={locked||inherited}/></button>;
}
const help=(label:string)=>({
    'フォルダー追加':'選択中の描画範囲に空のフォルダーを追加します。Fキーでも追加できます。レイヤーはドラッグして内外へ移動できます。',
    'ラスターレイヤー追加':'選択中の描画対象に、空のラスターレイヤーを追加します。',
    '画像を読み込む':'PNG/JPEGを画像レイヤーとして追加します。元の画像と別のレイヤーは保持します。',
    'ベクターレイヤー追加':'選択中の描画対象にベクターレイヤーを追加し、ベジェペンに切り替えます。',
    '画像をPNGで書き出す':'選択中の描画グループをPNGに保存します。生成マスクは含めません。',
    '複製':'選択したレイヤーを同じグループ内に複製します。',
    'フォルダーを解除':'フォルダーだけを解除し、中のレイヤーは現在の位置に残します。元に戻すで復旧できます。',
    '削除':'選択したレイヤーを削除します。元に戻すで復旧できます。最後の1枚も削除でき、必要なら追加ボタンで作り直せます。固定中のレイヤーは削除できません。',
  }[label]??(label.includes('あたり画像表示')?'元のあたりの表示を切り替えます。描いた線と元の情報は保持します。':label.includes('固定')?'レイヤーを固定・解除します。固定したレイヤーは描画・変更・移動の対象から外れ、奥の内容を選択できます。':'描画画像の表示・非表示を切り替えます。画像データは消えません。'));
type ControlsProps=Pick<Props,'owner'|'layer'|'disabled'|'update'|'addFolder'|'add'|'addVector'|'duplicate'|'remove'|'selectedMask'|'addToneMask'|'addGenerationMask'|'canAddGenerationMask'|'selectedFolder'>;
export function PaintLayerControls(p:ControlsProps){
  const hasLayer=p.owner.paint.layers.some(layer=>layer.id===p.layer.id);
  const icon=(label:string,action:()=>void,Icon:typeof Eye,disabled=false)=><PaintToolButton class="palette-icon" label={label} help={help(label)} onClick={action} disabled={p.disabled||disabled}><Icon size={18}/></PaintToolButton>;
  return <div class="layer-controls" role="group" aria-label="レイヤー操作">
    <div class="layer-properties"><select aria-label="レイヤーの合成" data-tool-help="通常はそのまま重ね、乗算は下の絵と掛け合わせます。白い部分を透かして線を重ねたいときは乗算を選びます。" disabled={p.disabled||!hasLayer||!paintLayerEditable(p.owner,p.layer)} value={hasLayer?p.layer.blend:'normal'} onChange={e=>p.update(p.owner.key,p.layer.id,{blend:e.currentTarget.value as PaintLayer['blend']})}><option value="normal">通常</option><option value="multiply">乗算</option></select>
      <label class="layer-density">濃度<input aria-label="レイヤーの濃度" data-tool-help="選択したレイヤー全体の濃さです。下げると下の絵が透けて見えます。" type="range" min="0" max="1" step="0.01" disabled={p.disabled||!hasLayer||!paintLayerEditable(p.owner,p.layer)} value={hasLayer?p.layer.opacity:1} onInput={e=>p.update(p.owner.key,p.layer.id,{opacity:Number(e.currentTarget.value)})}/><span>{hasLayer?Math.round(p.layer.opacity*100):100}%</span></label></div>
    <div class="layer-icon-actions">
      {icon('フォルダー追加',p.addFolder,FolderPlus,(p.owner.paint.folders?.length??0)>=64)}
      {icon('ラスターレイヤー追加',p.add,FilePlus2,p.owner.paint.layers.length>=64)}
      {icon('ベクターレイヤー追加',p.addVector,PenTool,p.owner.paint.layers.length>=64)}
      <PaintToolButton class="palette-icon" label="トーンレイヤー作成" help="トーンレイヤーを追加し、赤いマスクで範囲を塗ります。選択範囲があれば引き継ぎます。" disabled={p.disabled||!hasLayer||p.owner.paint.layers.length>=64||!p.addToneMask} onClick={p.addToneMask}><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m12 1 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Zm14 0 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Z"/></svg></PaintToolButton>
      <PaintToolButton class="palette-icon" label="生成マスク化" help="選択中の生成対象フォルダーにマスクを作り、色で領域を指定します。" disabled={p.disabled||!p.canAddGenerationMask||!p.addGenerationMask} onClick={p.addGenerationMask}><Bot size={18}/></PaintToolButton>
      {icon('複製',p.duplicate,Copy,!hasLayer||p.owner.paint.layers.length>=64||p.selectedMask==='generationMask')}{icon(p.selectedFolder?'フォルダーを解除':'削除',p.remove,Trash2,p.selectedMask==='generationMask'?paintGenerationMaskLocked(p.owner):p.selectedFolder?paintOwnerLocked(p.owner)||p.selectedFolder.locked===true:!hasLayer||!paintLayerEditable(p.owner,p.layer))}
    </div>
  </div>;
}
function LayerNameEditor({name,label,commit,close}:{name:string;label:string;commit:(value:string)=>void;close:()=>void}){
  const [draft,setDraft]=useState(name),finished=useRef(false);
  const finish=(accept:boolean)=>{if(finished.current)return;finished.current=true;const value=draft.trim();if(accept&&value&&value!==name)commit(value);close();};
  return <input autoFocus aria-label={label} value={draft} onInput={event=>setDraft(event.currentTarget.value)} onBlur={()=>finish(true)} onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();finish(event.key==='Enter');}}}/>;
}
export default function PaintLayerPalette(p:Props){
  const palette=useContext(PaintLayerControlsContext),scope=p.paletteScope??'',baseDepth=p.location?.overlay?0:1;
  const [renaming,setRenaming]=useState<string|null>(null),[renamingFolder,setRenamingFolder]=useState<string|null>(null);
  const drag=useRef<{kind:'layer'|'folder';key:string;id:string;x:number;y:number;pointerId:number;capture:HTMLElement;moved:boolean;drop?:PaintLayerDropTarget;destination?:PaintLayerDestination;marker?:HTMLElement;cleanup:()=>void}|null>(null);
  const paletteRef=useRef<HTMLDivElement>(null),skipGroupClick=useRef(false),skipLayerClick=useRef(false);
  const groupDrag=useRef<{key:string;pointer:number;x:number;y:number;target?:string;after?:boolean;capture:HTMLElement;moved:boolean;cleanup:()=>void}|null>(null);
  const [groupDrop,setGroupDrop]=useState<{key:string;after:boolean}|null>(null);
  const label=(o:PaintOwner)=>o.kind==='background'?'背景':o.kind==='panel'?'コマ内':o.kind==='page'?'コマ外':o.label;
  const clearDrop=()=>{const d=drag.current;if(!d)return;if(d.marker){d.marker.classList.remove('drop-above','drop-below','drop-inside','drop-outside');d.marker.style.removeProperty('--layer-drop-indent');}d.marker=undefined;d.drop=undefined;d.destination=undefined;delete d.capture.dataset.dragTarget;};
  const cancelLayerDrag=()=>{const d=drag.current;if(!d)return;clearDrop();drag.current=null;d.cleanup();d.capture.classList.remove('is-dragging');try{d.capture.releasePointerCapture(d.pointerId);}catch{}};
  useEffect(()=>cancelLayerDrag,[]);
  const beginDrag=(e:PointerEvent,o:PaintOwner,id:string,kind:'layer'|'folder',selector:string)=>{
    const capture=(e.target as Element).closest<HTMLElement>(selector);if(!capture)return;
    skipLayerClick.current=false;capture.classList.add('is-dragging');
    const move=(event:PointerEvent)=>moveLayerDrag(event),end=(event:PointerEvent)=>endLayerDrag(event),cancel=()=>cancelLayerDrag();
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);
    drag.current={kind,key:o.key,id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,capture,moved:false,cleanup:()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);}};
    try{capture.setPointerCapture(e.pointerId);}catch{}
  };
  const beginLayerDrag=(e:PointerEvent,o:PaintOwner,l:PaintLayer)=>{if(p.disabled||e.metaKey||e.ctrlKey||e.altKey||e.button!==0||!e.isPrimary||!paintLayerEditable(o,l))return;beginDrag(e,o,l.id,'layer','.layer-select');};
  const beginFolderDrag=(e:PointerEvent,o:PaintOwner,folder:PaintFolder)=>{
    if(p.disabled||paintOwnerLocked(o)||folder.locked||o.paint.layers.some(layer=>layer.folderId===folder.id&&!paintLayerEditable(o,layer))||e.metaKey||e.ctrlKey||e.altKey||e.button!==0||!e.isPrimary)return;
    beginDrag(e,o,folder.id,'folder','.layer-folder-select');
  };
  const moveLayerDrag=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;d.moved=true;e.preventDefault();clearDrop();
    const root=paletteRef.current?.closest('.page-layer-palette')??paletteRef.current;
    const scroller=root?.closest<HTMLElement>('.dock-content'),view=scroller?.getBoundingClientRect();
    if(scroller&&view){if(e.clientY<view.top+28)scroller.scrollTop-=14;else if(e.clientY>view.bottom-28)scroller.scrollTop+=14;}
    const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-layer-drop]');
    if(!row||!root?.contains(row))return;
    const host=row.closest<HTMLElement>('[data-paint-panel]'),key=row.dataset.owner;
    const location=host?{panelIndex:Number(host.dataset.paintPanel),overlay:host.dataset.paintOverlay==='true'}:p.location;
    if(!key||p.location&&!location)return;
    const same=(!location||location.panelIndex===p.location?.panelIndex&&location.overlay===p.location?.overlay)&&key===d.key;
    const kind=row.dataset.layerDrop,box=row.getBoundingClientRect(),ratio=(e.clientY-box.top)/Math.max(1,box.height);
    let depth=Number(row.dataset.layerDepth??0);
    let target:PaintLayerDropTarget,placement:'above'|'inside'|'below',destination=location?{...location,key} as PaintLayerDestination:undefined;
    if(kind==='layer'){
      if(row.dataset.dropLocked==='true')return;
      const id=row.dataset.layer;if(!id||same&&d.kind==='layer'&&id===d.id)return;const after=ratio>.5;
      target={kind:'layer',id,after};placement=after?'below':'above';
    }else if(kind==='folder'){
      const id=row.dataset.folder;if(!id||same&&d.kind==='folder'&&id===d.id)return;
      placement=d.kind==='folder'?(ratio<.5?'above':'below'):ratio<.25?'above':ratio>.75?'below':'inside';
      if(placement==='inside'&&row.dataset.dropLocked==='true')return;
      target={kind:'folder',id,placement};if(placement==='inside')depth++;
    }else if(kind==='panel'){
      if(!destination)return;
      const outside=ratio<.35;
      if(!outside&&row.dataset.dropLocked==='true')return;
      destination=outside?{...destination,overlay:true,key:'page',stack:{beforePanel:row.dataset.panelAnchor!}}:{...destination,key:'panel'};
      target={kind:'root',edge:'top'};placement=outside?'above':'inside';depth=outside?0:1;
    }else if(kind==='owner'){
      const outside=ratio>.75;
      if(!outside&&row.dataset.dropLocked==='true')return;
      if(outside){if(!destination)return;destination={...destination,key:destination.overlay?'page':'panel',stack:{below:key}};}
      target={kind:'root',edge:'top',aboveNative:!outside&&key.startsWith('bubble-')};placement=outside?'below':'inside';if(!outside)depth++;
    }else if(kind==='native'){
      if(row.dataset.dropLocked==='true')return;
      const above=ratio<.5;
      if(above&&row.dataset.nativeBelow&&destination){destination={...destination,key:destination.overlay?'page':'panel',stack:{below:row.dataset.nativeBelow}};target={kind:'root',edge:'top'};}
      else target={kind:'root',edge:above?'bottom':'top',aboveNative:above};
      placement=above?'above':'below';
    }else{
      if(row.dataset.dropLocked==='true')return;
      target={kind:'root',edge:row.dataset.edge==='bottom'?'bottom':'top'};placement='inside';
    }
    const outside=depth===0||placement!=='inside'&&['folder','owner','panel'].includes(kind??'')||kind==='layer'&&!row.closest('.layer-user-folder-children,.layer-group-children')&&/^(panel|page)(:|$)/.test(key);
    d.drop=target;d.destination=destination;d.marker=row;row.style.setProperty('--layer-drop-indent',`${outside?0:Math.max(48,depth*16)}px`);row.classList.add(`drop-${placement}`);if(outside)row.classList.add('drop-outside');d.capture.dataset.dragTarget=`${kind}:${placement}`;
  };
  const endLayerDrag=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;const target=d.drop,destination=d.destination;cancelLayerDrag();if(d.moved){skipLayerClick.current=true;e.preventDefault();e.stopPropagation();if(target){if(destination){const nextScope=`${scope.split('/')[0]}/${destination.overlay?'page':`panel-${destination.panelIndex}`}`;palette.setFolded(nextScope,false);palette.setFolded(`${nextScope}/owner/${destination.key}`,false);if(target.kind==='folder'&&target.placement==='inside')palette.setFolded(`${nextScope}/folder/${target.id}`,false);}if(d.kind==='folder')p.moveFolder(d.key,d.id,target,destination);else p.moveLayer(d.key,d.id,target,destination);}}};
  const cancelGroupDrag=()=>{const d=groupDrag.current;if(!d)return;groupDrag.current=null;d.cleanup();d.capture.classList.remove('is-dragging');try{d.capture.releasePointerCapture(d.pointer);}catch{}setGroupDrop(null);};
  useEffect(()=>cancelGroupDrag,[]);
  const beginGroupDrag=(e:PointerEvent,o:PaintOwner,selector:string)=>{
    if(!p.reorderGroup||p.disabled||paintOwnerPlacementLocked(o)||e.button!==0||!e.isPrimary||!displayOwners.some(target=>canReorderGroup(o.key,target.key)))return;
    const capture=(e.target as Element).closest<HTMLElement>(selector);if(!capture)return;
    skipGroupClick.current=false;capture.classList.add('is-dragging');
    const move=(event:PointerEvent)=>{
      const d=groupDrag.current;if(!d||d.pointer!==event.pointerId||Math.hypot(event.clientX-d.x,event.clientY-d.y)<5)return;
      d.moved=true;event.preventDefault();
      const row=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-owner-group],[data-generation-mask]'),key=row?.dataset.ownerGroup??row?.dataset.generationMask;
      if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||!key||!canReorderGroup(d.key,key)){d.target=undefined;setGroupDrop(null);return;}
      d.target=key;d.after=event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;setGroupDrop({key,after:d.after});
    };
    const end=(event:PointerEvent)=>{const d=groupDrag.current;if(!d||d.pointer!==event.pointerId)return;cancelGroupDrag();if(d.moved){skipLayerClick.current=true;event.preventDefault();event.stopPropagation();if(d.target)p.reorderGroup?.(d.key,d.target,!!d.after);}};
    const cancel=()=>cancelGroupDrag();
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);
    groupDrag.current={key:o.key,pointer:e.pointerId,x:e.clientX,y:e.clientY,capture,moved:false,cleanup:()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);}};
    try{capture.setPointerCapture(e.pointerId);}catch{}
  };
  const renderLayer=(o:PaintOwner,l:PaintLayer,active:boolean,depth=baseDepth)=>{
    const canvasSelected=p.selectedMask!=='generationMask'&&p.selectedOwner===o.key&&o.kind==='original'&&l.id===o.paint.layers.at(-1)?.id;
    const selected=canvasSelected||active&&l.id===p.layer.id&&p.selectedMask!=='generationMask';
    return <div class="layer-entry" key={l.id}><div role="treeitem" aria-selected={selected} data-canvas-selected={canvasSelected} class={`layer-row ${selected?'is-selected':''}`}
    data-layer-depth={depth} style={{'--layer-indent':`${depth*16}px`}} data-layer-drop="layer" data-layer={l.id} data-owner={o.key} data-drop-locked={paintOwnerLocked(o)||paintLayerInheritedLocked(o,l)}
    onPointerDown={e=>beginLayerDrag(e,o,l)} onPointerCancel={cancelLayerDrag} onLostPointerCapture={cancelLayerDrag} onContextMenu={e=>p.menu(e,o.key)}>
    <LayerVisibilityButton label={`${label(o)}・${l.name}を${l.visible?'隠す':'表示'}`} visible={l.visible} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{visible:!l.visible})}/>
    <button class="layer-select" data-tool-label={l.name} data-tool-help="クリックで描くレイヤーを選びます。ドラッグした位置へ移動し、フォルダーの中央へ重ねると中へ、上下へ置くと外へ移動します。ダブルクリックで名前を変えます。" disabled={p.disabled} onClick={e=>{if(!(active&&l.id===p.layer.id&&p.selectedMask==='mask')||e.metaKey||e.ctrlKey||e.altKey)p.select(o.key,l.id,e.metaKey||e.ctrlKey||e.altKey);}} onDblClick={()=>{p.select(o.key,l.id);if(paintLayerEditable(o,l))setRenaming(l.id);}}>{l.kind==='vector'?<span class="layer-kind-icon"><PenTool size={18}/></span>:<span class="layer-thumbnail">{l.guide&&!l.image?<PaintOriginal owner={o}/>:<Thumbnail owner={o} layer={l} images={p.images}/>}</span>}<span class="layer-caption"><small>{Math.round(l.opacity*100)}% {l.blend==='multiply'?'乗算':'通常'}{l.tone?.enabled?` · ${l.tone.lpi}線`:''}{l.mask?.enabled?' · マスク':''}</small><span class="layer-name-line"><span>{l.name}</span></span></span></button>
    {l.mask&&<PaintToolButton class="layer-mask-toggle" label={`${l.name}のマスク編集`} help="オンで赤い範囲を編集し、もう一度押すとトーンを表示します。" aria-pressed={Boolean(active&&l.id===p.layer.id&&p.selectedMask==='mask')} disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,'mask')}><MaskThumbnail owner={o} layer={l}/></PaintToolButton>}
    <LockButton label={l.name} locked={l.locked} inherited={paintLayerInheritedLocked(o,l)} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{locked:!l.locked})}/>
    {renaming===l.id&&<LayerNameEditor name={l.name} label="レイヤー名" commit={name=>p.update(o.key,l.id,{name})} close={()=>setRenaming(null)}/>}
  </div></div>;};
  const renderEntries=(o:PaintOwner,active:boolean,aboveNative?:boolean,depth=baseDepth)=>{
    const entries=paintLayerTree(o.paint).filter(entry=>aboveNative===undefined||Boolean(entry.kind==='folder'?entry.folder.aboveNative:entry.layer.aboveNative)===aboveNative).reverse();
    return <div class="layer-owner-entries" data-owner-root={o.key}>
      {entries.map(entry=>entry.kind==='layer'?renderLayer(o,entry.layer,active,depth):(()=>{const foldKey=`${scope}/folder/${entry.folder.id}`,folded=palette.folded[foldKey]??false,selected=active&&(p.selectedFolder?.id===entry.folder.id||p.layer.folderId===entry.folder.id);return <div class="layer-user-folder" key={entry.folder.id}>
        <div class={`layer-user-folder-row ${selected?'is-selected':''}`} role="treeitem" aria-selected={selected} aria-expanded={!folded} data-layer-depth={depth} style={{'--layer-indent':`${depth*16}px`}} data-layer-drop="folder" data-folder={entry.folder.id} data-owner={o.key} data-drop-locked={paintOwnerLocked(o)||entry.folder.locked===true} onPointerDown={event=>beginFolderDrag(event,o,entry.folder)} onPointerCancel={cancelLayerDrag} onLostPointerCapture={cancelLayerDrag}>
          <LayerVisibilityButton label={`${entry.folder.name}を${entry.folder.visible===false?'表示':'隠す'}`} visible={entry.folder.visible!==false} disabled={p.disabled} onClick={()=>p.updateFolder(o.key,entry.folder.id,{visible:entry.folder.visible===false})}/>
          <button class="palette-icon layer-folder-toggle" aria-label={`${entry.folder.name}を${folded?'展開':'折りたたむ'}`} onClick={()=>palette.setFolded(foldKey,!folded)}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
          <button class="layer-folder-select" aria-label={`${entry.folder.name}を選択`} data-tool-help="クリックで選択し、ドラッグでフォルダーごと順番を変えます。レイヤーを中央へドロップすると中の一番上へ入ります。" disabled={p.disabled} onClick={()=>p.select(o.key,entry.folder.id)} onDblClick={()=>{if(!paintOwnerLocked(o)&&!entry.folder.locked)setRenamingFolder(entry.folder.id);}}><span class="layer-kind-icon"><FolderOpen size={17}/></span><span>{entry.folder.name}</span></button>
          <LockButton label={entry.folder.name} locked={entry.folder.locked===true} inherited={paintOwnerLocked(o)} disabled={p.disabled} onClick={()=>p.updateFolder(o.key,entry.folder.id,{locked:!entry.folder.locked})}/>
          {renamingFolder===entry.folder.id&&<LayerNameEditor name={entry.folder.name} label="フォルダー名" commit={name=>p.renameFolder(o.key,entry.folder.id,name)} close={()=>setRenamingFolder(null)}/>}
        </div>
        {!folded&&<div class="layer-user-folder-children" role="group">{[...entry.layers].reverse().map(layer=>renderLayer(o,layer,active,depth+1))}</div>}
      </div>})())}
    </div>;
  };
  const renderGenerationGroup=(o:PaintOwner,active:boolean,children:ComponentChildren)=>{
    const mask=o.paint.generationMask;if(!mask)return children;
    const foldKey=`${scope}/generation-mask/${o.key}`,folded=palette.folded[foldKey]??false,selected=active&&p.selectedMask==='generationMask',depth=baseDepth+1;
    return <div class="generation-mask-group" data-generation-mask-owner={o.key}>
      <div class={`layer-row layer-mask-row ${selected?'is-selected':''}`} role="treeitem" aria-selected={selected} aria-expanded={!folded} data-generation-mask={o.key} data-layer-depth={depth} data-layer-drop="owner" data-owner={o.key} data-drop-locked={paintGenerationMaskLocked(o)} style={{'--layer-indent':`${depth*16}px`}} onPointerDown={e=>beginGroupDrag(e,o,'.layer-select')} onPointerCancel={cancelGroupDrag} onLostPointerCapture={cancelGroupDrag}>
        <LayerVisibilityButton label={`${label(o)}の生成マスクを${mask.enabled?'無効':'有効'}にする`} visible={mask.enabled} disabled={p.disabled||paintGenerationMaskLocked(o)} onClick={()=>p.updateGenerationMask?.(o.key,{enabled:!mask.enabled})}/>
        <button class="palette-icon layer-folder-toggle" aria-label={`${label(o)}の生成マスクを${folded?'展開':'折りたたむ'}`} aria-expanded={!folded} onClick={()=>palette.setFolded(foldKey,!folded)}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
        <button class="layer-select" aria-label={`${label(o)}の生成マスクを編集`} disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,'','generationMask')}><GenerationMaskThumbnail owner={o}/><Bot size={16}/><span>生成マスク</span></button>
      </div>
      {!folded&&<div class="generation-mask-children" role="group">{children}</div>}
    </div>;
  };
  const renderOriginal=(o:PaintOwner)=><div class="layer-direct-root original-raster-root" key={o.key} data-original-raster={o.original?.id}>
    {renderEntries(o,!p.inactive&&p.owner.key===o.key,undefined,baseDepth+Number(!!o.parentKey)+Number(!!p.scene.owners.find(parent=>parent.key===o.parentKey)?.paint.generationMask))}
  </div>;
  const textDirectOwners=p.scene.owners.filter(o=>paintStackTarget(o.stack,p.scene.anchorIds)?.startsWith('screen-text-'));
  const displayOwners=[...p.scene.owners].filter(o=>!textDirectOwners.includes(o)).filter(o=>p.directPanel!==undefined?paintStackTarget(o.stack,p.scene.anchorIds)===`panel-${p.directPanel}`:!paintStackTarget(o.stack,p.scene.anchorIds)?.startsWith('panel-')).filter(o=>!o.parentKey).filter(o=>(o.kind!=='panel'&&o.kind!=='page')||o.paint.layers.length>0||o.paint.folders?.length).reverse();
  const relations={figures:p.scene.owners.filter(o=>o.kind==='figure').sort((a,b)=>a.index-b.index).map(o=>o.figure!),bubbles:p.scene.owners.filter(o=>o.kind==='bubble').sort((a,b)=>a.index-b.index).map(o=>o.bubble!)};
  const artOwner=(o:PaintOwner)=>o.kind==='figure'||o.kind==='background'||o.bubble&&letteringFigureIndex(relations,o.bubble)!==null;
  const nativeIndex=displayOwners.findIndex(o=>artOwner(o)||o.stack&&'below' in o.stack&&p.scene.owners.some(anchor=>anchor.key===paintStackTarget(o.stack,p.scene.anchorIds)&&artOwner(anchor)));
  const screenIndex=nativeIndex<0?displayOwners.length:nativeIndex;
  const renderTexts=()=>p.directPanel===undefined&&[...(p.nativeTextLayers??[])].reverse().map(item=><div class="native-text-stack" key={item.key}>{item.node}{textDirectOwners.filter(owner=>paintStackTarget(owner.stack,p.scene.anchorIds)===item.key).map(owner=>renderEntries(owner,!p.inactive&&p.owner.key===owner.key))}</div>);
  const pageForeground=p.scene.owners.some(o=>o.kind==='page');
  const canReorderGroup=(key:string,target:string,after=false)=>{
    const lettering=letteringLayerMove(relations,key,target,after);
    if(lettering){const text=p.scene.owners.find(o=>o.key===`bubble-${lettering.index}`);return !!text&&!paintOwnerPlacementLocked(text);}
    return canReorderBubbleLayers(relations,key,target)||!pageForeground&&key!==target&&[key,target].every(value=>value==='background'||/^figure-\d+$/.test(value));
  };
  return <div class="paint-layer-palette" ref={paletteRef} data-paint-panel={p.location?.panelIndex} data-paint-overlay={p.location?.overlay} onClickCapture={event=>{if(skipLayerClick.current){skipLayerClick.current=false;event.preventDefault();event.stopPropagation();}}}>{!p.embedded&&<h3>レイヤー</h3>}
    {!p.embedded&&!p.inactive&&<PaintLayerControls {...p}/>}<div class="layer-tree" role="tree" aria-label="レイヤーの重なり">
      {!p.embedded&&<div class="layer-panel-row"><strong>{p.title}</strong></div>}
      {p.frameLayer}
      {displayOwners.map((o,ownerIndex,owners)=>{
        const bubble=o.kind==='bubble',originals=p.scene.owners.filter(child=>child.parentKey===o.key),groupLocked=o.locked===true,visible=bubble?(bubbleVisible(o.bubble!)||originals.some(child=>child.paint.layers.some(l=>paintLayerVisible(child.paint,l)))):o.paint.layers.some(l=>paintLayerVisible(o.paint,l)),foldKey=`${scope}/owner/${o.key}`,folded=palette.folded[foldKey]??bubble;
        const generationIndent=Number(!!o.paint.generationMask);
        const paintActive=!p.inactive&&o.key===p.owner.key,canvasSelected=p.selectedOwner===o.key,active=canvasSelected||paintActive||originals.some(child=>p.selectedOwner===child.key||!p.inactive&&p.owner.key===child.key);
        const frame=ownerIndex===screenIndex?renderTexts():null;
        if(o.kind==='original')return <>{frame}{renderOriginal(o)}</>;
        if(o.kind==='panel'||o.kind==='page')return <>{frame}<div class="layer-direct-root" key={o.key}>{renderEntries(o,paintActive)}</div></>;
        return <>{frame}<div class="layer-group" key={o.key}>
          <div data-owner-group={o.key} data-layer-depth={baseDepth} style={{'--layer-indent':`${baseDepth*16}px`}} data-layer-drop="owner" data-owner={o.key} data-drop-locked={paintOwnerLocked(o)} role="treeitem" aria-selected={active} data-canvas-selected={!bubble&&canvasSelected} class={`layer-group-row ${bubble?'bubble-layer-row':''} ${active?'is-selected':''} ${groupDrop?.key===o.key?(groupDrop.after?'drop-below drop-outside':'drop-above drop-outside'):''}`}
            onPointerDown={e=>beginGroupDrag(e,o,'.layer-group-select')} onPointerCancel={cancelGroupDrag} onLostPointerCapture={cancelGroupDrag} onContextMenu={e=>p.menu(e,o.key)}>
            {<LayerVisibilityButton label={`${label(o)}${bubble?'全体':'の画像'}を${visible?'隠す':'表示'}`} visible={visible} disabled={p.disabled} onClick={()=>bubble?p.onToggleBubble?.(o.index,true):p.toggleGroup(o.key)}/>}
            <button class="palette-icon layer-folder-toggle" data-tool-label="グループの開閉" data-tool-help={bubble?'文字・輪郭と原本画像を同じフォルダー内で別々に選択します。開閉で目の状態は変わりません。':'描画レイヤーを折りたたむか、一覧へ展開します。'} aria-label={`${label(o)}を${folded?'展開':'折りたたむ'}`} aria-expanded={!folded} onClick={()=>palette.setFolded(foldKey,!folded)}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="layer-group-select" data-tool-label={bubble?'テキストを選択':o.kind==='figure'?'人物・小道具を選択':'背景を描画'} data-tool-help={o.kind==='bubble'?'編集可能な文字とベクターの輪郭を選択します。原本画像とは独立しています。Tを選び、紙面のテキストを1回クリックして文字を編集します。':o.kind==='figure'?'キャンバスの人物・小道具を選択してコマ情報を表示します。描くときは中のレイヤーを選びます。フォルダをドラッグして重なり順を変えられます。':'背景を描画対象にします。フォルダを上下へドラッグして重なり順を変えられます。'} aria-pressed={active} onClick={()=>p.select(o.key)} disabled={p.disabled}><span class="layer-kind-icon">{folded?<Folder size={17}/>:<FolderOpen size={17}/>}</span><span class="layer-caption">{label(o)}</span></button>
            {o.kind==='background'&&p.openBackground3d&&(p.backgroundCapture?<button class="background3d-open" aria-label="3D背景を撮影" title="今の構図を編集可能な線画・ベタ・トーンとして保存します。" disabled={!p.backgroundCapture.ready} onClick={p.backgroundCapture.capture}><Camera size={15}/>撮影</button>:<button class="background3d-open" aria-label="背景あたりの3Dモデルを配置・調整" title="このコマの背景で3Dモデルの構図を決め、線画・ベタ・トーンとして撮影します。" disabled={p.disabled||paintOwnerLocked(o)||(!p.inactive&&!p.images)} onClick={p.openBackground3d}><Box size={15}/>3D編集</button>)}
            <LockButton label={bubble?`${label(o)}全体`:label(o)} locked={bubble?groupLocked:o.locked===true} inherited={o.inheritedLocked===true} disabled={p.disabled} onClick={()=>p.lockOwner(o.key,bubble?!groupLocked:o.locked!==true,bubble)}/>
          </div>
          {!folded&&<div class="layer-group-children" role="group">{renderGenerationGroup(o,paintActive,<>
            {bubble&&renderEntries(o,paintActive,true,baseDepth+1+generationIndent)}
            {[...originals].reverse().map(renderOriginal)}
            {bubble&&<div class={`layer-row bubble-native-row ${canvasSelected?'is-selected':''}`} role="treeitem" aria-selected={canvasSelected} data-canvas-selected={canvasSelected} data-layer-depth={baseDepth+1+generationIndent} style={{'--layer-indent':`${(baseDepth+1+generationIndent)*16}px`}} data-layer-drop="native" data-native-below={originals.find(child=>child.kind==='original')?.key} data-owner={o.key} data-drop-locked={paintOwnerLocked(o)}>
              <LayerVisibilityButton label={`${label(o)}の文字を${bubbleVisible(o.bubble!)?'隠す':'表示'}`} visible={bubbleVisible(o.bubble!)} disabled={p.disabled} onClick={()=>p.onToggleBubble?.(o.index)}/>
              <button class="layer-select" aria-label={`${label(o)}の文字を選択`} disabled={p.disabled} onClick={()=>p.select(o.key,undefined,false,true)}><span class="layer-kind-icon"><Type size={18}/></span><span class="layer-caption">{o.bubble?.text}</span></button>
              <LockButton label={`${label(o)}の文字`} locked={o.bubble?.nativeLocked===true} inherited={o.inheritedLocked===true||o.locked===true} disabled={p.disabled} onClick={()=>p.lockOwner(o.key,o.bubble?.nativeLocked!==true)}/>
            </div>}
            {renderEntries(o,paintActive,bubble?false:undefined,baseDepth+1+generationIndent)}</>)}</div>}
        </div></>;
      })}
      {screenIndex===displayOwners.length&&renderTexts()}
    </div>
  </div>;
}
