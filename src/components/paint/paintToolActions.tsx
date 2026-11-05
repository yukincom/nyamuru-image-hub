import { useEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import {
  Pencil, Eraser, Minus, Square, Circle, MousePointer2, MousePointer, PenTool, ArrowLeftRight, Sparkles,
} from 'lucide-preact';
import VectorControls from '../VectorControls';
import PaintPenTools from '../PaintPenTools';
import PaintBrushTools from '../PaintBrushTools';
import PaintSelectionTools from '../PaintSelectionTools';
import PaintShapeTools from '../PaintShapeTools';
import PaintRulerTools from '../PaintRulerTools';
import type { PaintRulerMode } from '../../lib/paintRuler';
import { nextPaintLineKind, paintToolForLayer, paintSelectionMode } from '../../lib/paintToolMode';
import {
  paintToolShortcut, paintInkShortcut, paintSizeShortcut, stepPaintSize, PAINT_SIZE_PRESETS,
} from '../../lib/paintToolShortcuts';
import { PaintToolButton } from '../PaintToolHelp';
import { alignVectors, distributeVectors, type VectorEraseMode } from '../../lib/vectorGeometry';
import type { PaintLayerAction } from '../../lib/paintSession';
import type { BBox, PaintLayer, VectorPath, VectorStyle } from '../../types';
import type { PaintEditorOptions, PaintEditorState, PaintTool } from './paintEditorState';

const tools=[['vector-select','選択',MousePointer],['vector-node','ダイレクト選択',MousePointer2],['vector-pen','ベジェペン',PenTool],['pen','ペン',Pencil],['eraser','消しゴム',Eraser],['line','直線',Minus],['rectangle','四角',Square],['ellipse','楕円',Circle]] as const;
const vectorEraseChoices:ReadonlyArray<readonly [VectorEraseMode,string,string]>=[
  ['touch','触れた部分','消しゴムが触れた範囲だけを切り取る'],
  ['intersection','交点まで','触れた線を前後の交点まで消す'],
  ['whole','線全体','触れたパスを一本まるごと消す'],
];
function UprightPaintBucketIcon({size=23}:{size?:number}){return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8V6a6 6 0 0 1 12 0v2"/><path d="M5 8h14l-1.4 12H6.4L5 8Z"/><path d="M6.1 13h11.8"/><path d="M6.8 14h10.4l-.6 5H7.4l-.6-5Z" fill="currentColor" opacity=".24" stroke="none"/></svg>}

interface PaintToolActionsBindings {
  finishGesture: (keep?: boolean) => void;
  paintRegion: (boxes: BBox[], clear?: boolean) => void;
  redo: () => void;
  undo: () => void;
  setCurrentSize: (width: number) => void;
  changeVectorStyle: (patch: Partial<VectorStyle>) => void;
  clearVectorSelection: () => void;
  toggleInk: () => void;
  requestClose: () => Promise<void>;
  deleteVectorSelection: () => void;
  changePaths: (update: (paths: VectorPath[]) => VectorPath[]) => void;
  paintActive: boolean;
  swapInk: () => void;
  chooseInk: (value: string | null) => void;
  updateOwnerLayer: (key: string, id: string, patch: Partial<PaintLayer>) => void;
  layerAction: (action: PaintLayerAction) => void;
  openFinish: () => void;
}

export function usePaintToolActions(options: PaintEditorOptions, state: PaintEditorState, bindings: PaintToolActionsBindings) {
  const {
    requested, textTool, zoomTool, onSelectBubblePath, onSelectLayout, onStartPaint, toolPaletteEnabled,
    bubblePathTool, textTools, panelTools, overlay,
  } = options;
  const {
    busy, toolSuspended, operation, setTemporaryLayoutSelection, interactionRevision, hasLayer, layer,
    owner, setMaskTarget, setTool, setLineKind, setPenMenu, setEraserMenu, tool, vectorState,
    inputActive, setRulerState, editingMask, toolbarLayer, gesture, vectorPointer, selectedBubbleStroke,
    size, setEraserSize, vectorMode, vectorStyle, setRasterSize, setSelection, selectionBoxes,
    eraserMenu, penMenu, menu, setMenu, vectorSelected, layerLocked, locked, setVectorSelected,
    vectorTab, setVectorTab, suspended, vectorReference, setVectorReference, vectorGap, setVectorGap,
    eraseMode, setEraseMode, brush, setBrush, rulerMode, brushInk, colorTarget, setColorTarget,
    displayInk, inkColor, paletteInks, selectedInk, selectTolerance, setSelectTolerance, inkMode,
  } = state;
  const {
    finishGesture, paintRegion, redo, undo, setCurrentSize, changeVectorStyle, clearVectorSelection,
    toggleInk, requestClose, deleteVectorSelection, changePaths, paintActive, swapInk, chooseInk,
    updateOwnerLayer, layerAction, openFinish,
  } = bindings;
  function selectTool(next:PaintTool){
    if(busy||toolSuspended||operation.current)return;
    setTemporaryLayoutSelection(false);
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
  function selectRuler(mode:PaintRulerMode|null){
    if(busy||toolSuspended||operation.current||inputActive.current)return;
    setTemporaryLayoutSelection(false);
    interactionRevision.current++;
    if(mode&&(!requested||textTool||zoomTool)&&!onStartPaint?.())return;
    finishGesture();
    setRulerState(mode?{mode}:null);
    // Placement is a tool, but changes only the drawing aid, never the artwork.
    if(mode)setTool('ruler');
    else if(tool==='ruler'){
      const kind=editingMask?'raster':toolbarLayer.kind??'raster';
      const next=paintToolForLayer('pen',kind);
      setTool(next);setLineKind(kind);
    }
    vectorState.current={...vectorState.current,activePath:undefined};setPenMenu(false);setEraserMenu(null);
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
  const toolControls=<div class="paint-tools">
    <div class="paint-tool-icons">
      {tools.slice(0,2).map(([value,label,Icon])=>{
        const layoutSelect=value==='vector-select';
        return <PaintToolButton class={`paint-tool-icon tool-${value}`} label={label} shortcut={toolShortcuts[value]} disabled={busy||toolSuspended} aria-pressed={paintActive?tool===value:layoutSelect?!textTool&&!zoomTool&&!bubblePathTool:bubblePathTool==='node'} onClick={()=>selectTool(value)}><Icon size={23}/></PaintToolButton>;
      })}
      <PaintPenTools tool={paintActive?tool:''} select={selectTool} disabled={busy||toolSuspended} open={penMenu} setOpen={setPenMenu}/>
      <PaintBrushTools brush={brush} active={paintActive&&tool==='pen'} select={value=>{if(busy||toolSuspended||operation.current)return;selectTool('pen');setBrush(value);}} disabled={busy||toolSuspended}/>
      <PaintShapeTools tool={paintActive?tool:''} select={selectTool} disabled={busy||toolSuspended}/>{textTools}
      {panelTools}
      <PaintRulerTools mode={rulerMode} active={paintActive&&tool==='ruler'} select={selectRuler} disabled={busy||toolSuspended||inputActive.current}/>
      <PaintToolButton class="paint-tool-icon" label="消しゴム"  disabled={busy||toolSuspended} aria-pressed={paintActive&&tool==='eraser'} aria-haspopup="menu" aria-expanded={Boolean(eraserMenu)} onClick={()=>selectTool('eraser')} onContextMenu={event=>{event.preventDefault();event.stopPropagation();if(busy||toolSuspended)return;const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX||rect.left,y=event.clientY||rect.bottom;setEraserMenu({x:Math.max(8,Math.min(x,window.innerWidth-210)),y:Math.max(8,Math.min(y,window.innerHeight-150))});}}><Eraser size={23}/></PaintToolButton><PaintSelectionTools tool={paintActive?tool:''} select={selectTool} disabled={busy||toolSuspended}/>
      <PaintToolButton class="paint-tool-icon" label="漫画仕上げ" disabled={!toolPaletteEnabled||overlay||busy||toolSuspended} aria-haspopup="dialog" onClick={openFinish}><Sparkles size={23}/></PaintToolButton>
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

  return { selectTool, toolControls, detailControls, eraseModeMenu };
}
