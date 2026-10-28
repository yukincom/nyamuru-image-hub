import { ChevronDown, ChevronRight, Eye, Folder, FolderOpen, FolderPlus, FilePlus2, Copy, Trash2, PenTool, Type, Box, Camera, Layers, Bot } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaintFolder, PaintLayer } from '../types';
import {paintLayerTree,type PaintLayerDropTarget,type PaintOwner,type PaintScene} from '../lib/paintDocument';
import { drawPaintMask, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { PaintOriginal } from './PaintSceneView';
import { PaintToolButton } from './PaintToolHelp';
import LayerVisibilityButton from './LayerVisibilityButton';
import { bubbleVisible, canReorderBubbleLayers } from '../lib/panelLayers';
import { letteringLayerMove } from '../lib/bubbleRelations';
import LayerLockIcon from './LayerLockIcon';
import {paintLayerVisible,paintLayerInheritedLocked,paintLayerEditable,paintOwnerLocked,paintOwnerPlacementLocked} from '../lib/paintLock';
import type { ComponentChildren } from 'preact';

function Thumbnail({owner,layer,images}:{owner:PaintOwner;layer:PaintLayer;images:PaintImages|null}){
  const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof paintPreviewRenderer>|null>(null);
  // Working bleed is not part of the layer's thumbnail framing.
  const view=owner.paint.referenceFrame??{x:0,y:0,w:owner.paint.width,h:owner.paint.height};
  useEffect(()=>()=>renderer.current?.dispose(),[]);
  useLayoutEffect(()=>{if(!canvas.current||!images)return;const context=canvas.current.getContext('2d');if(layer.image&&!images.has(layer.image.assetId)){context?.clearRect(0,0,canvas.current.width,canvas.current.height);return;}renderer.current??=paintPreviewRenderer();try{renderer.current.draw(canvas.current,{...owner.paint,folders:undefined,layers:[{...layer,folderId:undefined,visible:true,opacity:1}]},images,undefined,undefined,true,view);}catch{context?.clearRect(0,0,canvas.current.width,canvas.current.height);}},[owner.paint.width,owner.paint.height,view.x,view.y,view.w,view.h,layer,images]);
  const scale=40/Math.max(view.w,view.h);
  return <canvas ref={canvas} width={Math.max(1,Math.round(view.w*scale))} height={Math.max(1,Math.round(view.h*scale))}/>;
}
function MaskThumbnail({owner,layer}:{owner:PaintOwner;layer:PaintLayer}){
  const ref=useRef<HTMLCanvasElement>(null);
  const view=owner.paint.referenceFrame??{x:0,y:0,w:owner.paint.width,h:owner.paint.height},scale=32/Math.max(view.w,view.h);
  useLayoutEffect(()=>{if(ref.current)drawPaintMask(ref.current,owner.paint,layer,undefined,view);},[owner.paint.width,owner.paint.height,view.x,view.y,view.w,view.h,layer.mask]);
  return <span class="layer-mask-thumbnail"><canvas ref={ref} width={Math.max(1,Math.round(view.w*scale))} height={Math.max(1,Math.round(view.h*scale))}/></span>;
}
interface Props {
  frameLayer?:ComponentChildren; selectedFolder?:PaintFolder;
  backgroundCapture?:{ready:boolean;capture:()=>void};
  selectedMask?:'mask'|'generationMask'|null;
  selectMask?:(key:string,id:string,kind:'mask'|'generationMask')=>void;
  addToneMask?:()=>void; addGenerationMask?:()=>void;
  selectedOwner?:string; canvasSelectionScrollRequest?:number; onToggleBubble?:(index:number,group?:boolean)=>void; openBackground3d?:()=>void;
  reorderGroup?:(key:string,target:string,after:boolean)=>void; embedded?:boolean; inactive?:boolean; onEditText?:(index:number)=>void; title:string; scene:PaintScene; owner:PaintOwner; layer:PaintLayer; images:PaintImages|null; disabled:boolean;
  select:(key:string,id?:string,contents?:boolean)=>void; update:(key:string,id:string,patch:Partial<PaintLayer>)=>void;
  lockOwner:(key:string,locked:boolean,group?:boolean)=>void;
  toggleGroup:(key:string)=>void; guideVisible:(key:string)=>boolean; toggleGuide:(key:string)=>void;
  addFolder:()=>void; add:()=>void; addVector:()=>void; importImage:()=>void; reorder:(key:string,id:string,target:string,after:boolean)=>void; moveLayer:(key:string,id:string,target:PaintLayerDropTarget)=>void; moveFolder:(key:string,id:string,target:PaintLayerDropTarget)=>void; updateFolder:(key:string,id:string,patch:Partial<Pick<PaintFolder,'visible'|'locked'>>)=>void; renameFolder:(key:string,id:string,name:string)=>void; duplicate:()=>void; remove:()=>void;
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
type ControlsProps=Pick<Props,'owner'|'layer'|'disabled'|'update'|'addFolder'|'add'|'addVector'|'duplicate'|'remove'|'selectedMask'|'addToneMask'|'addGenerationMask'|'selectedFolder'>;
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
      <PaintToolButton class="palette-icon" label="生成マスク化" help="選択中のレイヤーに生成用のマスクを作り、色で領域を指定します。" disabled={p.disabled||!hasLayer||p.layer.locked||!p.addGenerationMask} onClick={p.addGenerationMask}><Bot size={18}/></PaintToolButton>
      {icon('複製',p.duplicate,Copy,!hasLayer||p.owner.paint.layers.length>=64||p.selectedMask==='generationMask')}{icon(p.selectedFolder?'フォルダーを解除':'削除',p.remove,Trash2,p.selectedFolder?paintOwnerLocked(p.owner)||p.selectedFolder.locked===true:!hasLayer||!paintLayerEditable(p.owner,p.layer))}
    </div>
  </div>;
}
export default function PaintLayerPalette(p:Props){
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({}),[renaming,setRenaming]=useState<string|null>(null),[folderCollapsed,setFolderCollapsed]=useState<Record<string,boolean>>({}),[renamingFolder,setRenamingFolder]=useState<string|null>(null);
  const [drop,setDrop]=useState<{key:string;kind:'layer'|'folder'|'root';id?:string;placement?:'above'|'inside'|'below';edge?:'top'|'bottom'}|null>(null);
  const drag=useRef<{kind:'layer'|'folder';key:string;id:string;x:number;y:number;pointerId:number;capture:HTMLElement;moved:boolean;drop?:PaintLayerDropTarget}|null>(null);
  const paletteRef=useRef<HTMLDivElement>(null),skipGroupClick=useRef(false);
  const groupDrag=useRef<{key:string;pointer:number;x:number;y:number;target?:string;after?:boolean}|null>(null);
  const [groupDrop,setGroupDrop]=useState<{key:string;after:boolean}|null>(null);
  const label=(o:PaintOwner)=>o.kind==='background'?'背景':o.kind==='panel'?'コマ内':o.kind==='page'?'コマ外':o.label;
  const beginLayerDrag=(e:PointerEvent,o:PaintOwner,l:PaintLayer)=>{if(p.disabled||e.metaKey||e.ctrlKey||e.altKey||e.button!==0||!e.isPrimary||!(e.target as Element).closest('.layer-select')||!paintLayerEditable(o,l))return;const capture=(e.target as Element).closest<HTMLElement>('.layer-select')!;capture.classList.add('is-dragging');drag.current={kind:'layer',key:o.key,id:l.id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,capture,moved:false};try{capture.setPointerCapture(e.pointerId);}catch{}};
  const beginFolderDrag=(e:PointerEvent,o:PaintOwner,folder:PaintFolder)=>{
    if(p.disabled||paintOwnerLocked(o)||folder.locked||e.metaKey||e.ctrlKey||e.altKey||e.button!==0||!e.isPrimary||!(e.target as Element).closest('.layer-folder-select'))return;
    const capture=(e.target as Element).closest<HTMLElement>('.layer-folder-select')!;capture.classList.add('is-dragging');
    drag.current={kind:'folder',key:o.key,id:folder.id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,capture,moved:false};try{capture.setPointerCapture(e.pointerId);}catch{}
  };
  const moveLayerDrag=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;d.moved=true;e.preventDefault();
    const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-layer-drop]');
    if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||row.dataset.owner!==d.key){d.drop=undefined;delete d.capture.dataset.dragTarget;setDrop(null);return;}
    const kind=row.dataset.layerDrop,box=row.getBoundingClientRect();
    if(kind==='layer'){
      const id=row.dataset.layer;if(!id||d.kind==='layer'&&id===d.id){d.drop=undefined;delete d.capture.dataset.dragTarget;setDrop(null);return;}const after=e.clientY>box.top+box.height/2;
      d.drop={kind:'layer',id,after};d.capture.dataset.dragTarget=`layer:${after?'below':'above'}`;setDrop({key:d.key,kind:'layer',id,placement:after?'below':'above'});return;
    }
    if(kind==='folder'){
      const id=row.dataset.folder;if(!id||d.kind==='folder'&&id===d.id){d.drop=undefined;delete d.capture.dataset.dragTarget;setDrop(null);return;}const ratio=(e.clientY-box.top)/Math.max(1,box.height),placement=d.kind==='folder'?(ratio<.5?'above':'below'):ratio<.25?'above':ratio>.75?'below':'inside';
      d.drop={kind:'folder',id,placement};d.capture.dataset.dragTarget=`folder:${placement}`;setDrop({key:d.key,kind:'folder',id,placement});return;
    }
    const edge=row.dataset.edge==='bottom'?'bottom':'top';d.drop={kind:'root',edge};d.capture.dataset.dragTarget=`root:${edge}`;setDrop({key:d.key,kind:'root',edge});
  };
  const endLayerDrag=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;drag.current=null;setDrop(null);d.capture.classList.remove('is-dragging');delete d.capture.dataset.dragTarget;if(d.moved){e.preventDefault();e.stopPropagation();if(d.drop){if(d.kind==='folder')p.moveFolder(d.key,d.id,d.drop);else p.moveLayer(d.key,d.id,d.drop);}}try{d.capture.releasePointerCapture(e.pointerId);}catch{}};
  const cancelLayerDrag=()=>{if(drag.current){drag.current.capture.classList.remove('is-dragging');delete drag.current.capture.dataset.dragTarget;}drag.current=null;setDrop(null);};
  const renderLayer=(o:PaintOwner,l:PaintLayer,active:boolean)=>{
    const canvasSelected=p.selectedOwner===o.key&&o.kind==='original'&&l.id===o.paint.layers.at(-1)?.id;
    const selected=canvasSelected||active&&l.id===p.layer.id&&p.selectedMask!=='generationMask';
    return <div class="layer-entry" key={l.id}><div role="treeitem" aria-selected={selected} data-canvas-selected={canvasSelected} class={`layer-row ${selected?'is-selected':''} ${drop?.kind==='layer'&&drop.key===o.key&&drop.id===l.id?(drop.placement==='below'?'drop-below':'drop-above'):''}`}
    data-layer-drop="layer" data-layer={l.id} data-owner={o.key}
    onPointerDown={e=>beginLayerDrag(e,o,l)} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag} onPointerCancel={cancelLayerDrag} onLostPointerCapture={cancelLayerDrag} onContextMenu={e=>p.menu(e,o.key)}>
    <LayerVisibilityButton label={`${label(o)}・${l.name}を${l.visible?'隠す':'表示'}`} visible={l.visible} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{visible:!l.visible})}/>
    <button class="layer-select" data-tool-label={l.name} data-tool-help="クリックで描くレイヤーを選びます。ドラッグした位置へ移動し、フォルダーの中央へ重ねると中へ、上下へ置くと外へ移動します。ダブルクリックで名前を変えます。" disabled={p.disabled} onClick={e=>{if(!(active&&l.id===p.layer.id&&p.selectedMask==='mask')||e.metaKey||e.ctrlKey||e.altKey)p.select(o.key,l.id,e.metaKey||e.ctrlKey||e.altKey);}} onDblClick={()=>{p.select(o.key,l.id);if(paintLayerEditable(o,l))setRenaming(l.id);}}>{l.kind==='vector'?<span class="layer-kind-icon"><PenTool size={18}/></span>:<span class="layer-thumbnail">{l.guide&&!l.image?<PaintOriginal owner={o}/>:<Thumbnail owner={o} layer={l} images={p.images}/>}</span>}<span class="layer-caption"><small>{Math.round(l.opacity*100)}% {l.blend==='multiply'?'乗算':'通常'}{l.tone?.enabled?` · ${l.tone.lpi}線`:''}{l.mask?.enabled?' · マスク':''}</small><span class="layer-name-line"><span>{l.name}</span></span></span></button>
    {l.mask&&<PaintToolButton class="layer-mask-toggle" label={`${l.name}のマスク編集`} help="オンで赤い範囲を編集し、もう一度押すとトーンを表示します。" aria-pressed={Boolean(active&&l.id===p.layer.id&&p.selectedMask==='mask')} disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,'mask')}><MaskThumbnail owner={o} layer={l}/></PaintToolButton>}
    <LockButton label={l.name} locked={l.locked} inherited={paintLayerInheritedLocked(o,l)} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{locked:!l.locked})}/>
    {renaming===l.id&&<input autoFocus aria-label="レイヤー名" value={l.name} onInput={e=>p.update(o.key,l.id,{name:e.currentTarget.value})} onBlur={()=>setRenaming(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')setRenaming(null);}}/>}
  </div>{(['generationMask'] as const).map(kind=>l[kind]&&<div class={`layer-row layer-mask-row ${active&&l.id===p.layer.id&&p.selectedMask===kind?'is-selected':''}`} role="treeitem" aria-selected={active&&l.id===p.layer.id&&p.selectedMask===kind}>
    <LayerVisibilityButton label={`${l.name}の生成マスクを${l[kind]!.enabled?'無効':'有効'}にする`} visible={l[kind]!.enabled} disabled={p.disabled||!paintLayerEditable(o,l)} onClick={()=>p.update(o.key,l.id,{[kind]:{...l[kind]!,enabled:!l[kind]!.enabled}})}/>
    <button class="layer-select" disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,kind)}><Layers size={16}/><span>生成マスク<small>赤・青・緑・黄で領域を指定</small></span></button>
  </div>)}</div>;};
  const renderEntries=(o:PaintOwner,active:boolean)=>{
    const entries=paintLayerTree(o.paint).reverse();
    return <div class="layer-owner-entries" data-owner-root={o.key}>
      <div class={`layer-root-drop is-top ${drop?.kind==='root'&&drop.key===o.key&&drop.edge==='top'?'drop-inside':''}`} data-layer-drop="root" data-edge="top" data-owner={o.key} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag}/>
      {entries.map(entry=>entry.kind==='layer'?renderLayer(o,entry.layer,active):(()=>{const folded=folderCollapsed[entry.folder.id]??false,selected=active&&(p.selectedFolder?.id===entry.folder.id||p.layer.folderId===entry.folder.id),folderDrop=drop?.kind==='folder'&&drop.key===o.key&&drop.id===entry.folder.id;return <div class={`layer-user-folder ${folderDrop?`drop-${drop.placement}`:''}`} key={entry.folder.id}>
        <div class={`layer-user-folder-row ${selected?'is-selected':''}`} role="treeitem" aria-selected={selected} aria-expanded={!folded} data-layer-drop="folder" data-folder={entry.folder.id} data-owner={o.key} onPointerDown={event=>beginFolderDrag(event,o,entry.folder)} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag} onPointerCancel={cancelLayerDrag} onLostPointerCapture={cancelLayerDrag}>
          <LayerVisibilityButton label={`${entry.folder.name}を${entry.folder.visible===false?'表示':'隠す'}`} visible={entry.folder.visible!==false} disabled={p.disabled} onClick={()=>p.updateFolder(o.key,entry.folder.id,{visible:entry.folder.visible===false})}/>
          <button class="palette-icon layer-folder-toggle" aria-label={`${entry.folder.name}を${folded?'展開':'折りたたむ'}`} onClick={()=>setFolderCollapsed({...folderCollapsed,[entry.folder.id]:!folded})}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
          <button class="layer-folder-select" aria-label={`${entry.folder.name}を選択`} data-tool-help="クリックで選択し、ドラッグでフォルダーごと順番を変えます。レイヤーを中央へドロップすると中の一番上へ入ります。" disabled={p.disabled} onClick={()=>p.select(o.key,entry.folder.id)} onDblClick={()=>{if(!paintOwnerLocked(o)&&!entry.folder.locked)setRenamingFolder(entry.folder.id);}}><span class="layer-kind-icon"><FolderOpen size={17}/></span><span>{entry.folder.name}</span></button>
          <LockButton label={entry.folder.name} locked={entry.folder.locked===true} inherited={paintOwnerLocked(o)} disabled={p.disabled} onClick={()=>p.updateFolder(o.key,entry.folder.id,{locked:!entry.folder.locked})}/>
          {renamingFolder===entry.folder.id&&<input autoFocus aria-label="フォルダー名" value={entry.folder.name} onInput={event=>p.renameFolder(o.key,entry.folder.id,event.currentTarget.value)} onBlur={()=>setRenamingFolder(null)} onKeyDown={event=>{if(event.key==='Enter'||event.key==='Escape')setRenamingFolder(null);}}/>}
        </div>
        {!folded&&<div class="layer-user-folder-children" role="group">{[...entry.layers].reverse().map(layer=>renderLayer(o,layer,active))}</div>}
      </div>})())}
      <div class={`layer-root-drop is-bottom ${drop?.kind==='root'&&drop.key===o.key&&drop.edge==='bottom'?'drop-inside':''}`} data-layer-drop="root" data-edge="bottom" data-owner={o.key} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag}/>
    </div>;
  };
  const renderOriginal=(o:PaintOwner)=><div class="layer-direct-root original-raster-root" key={o.key} data-original-raster={o.original?.id}>
    {renderEntries(o,!p.inactive&&p.owner.key===o.key)}
  </div>;
  const displayOwners=[...p.scene.owners].filter(o=>!o.parentKey).filter(o=>(o.kind!=='panel'&&o.kind!=='page')||o.paint.layers.length>0||o.paint.folders?.length).reverse();
  const relations={figures:p.scene.owners.filter(o=>o.kind==='figure').sort((a,b)=>a.index-b.index).map(o=>o.figure!),bubbles:p.scene.owners.filter(o=>o.kind==='bubble').sort((a,b)=>a.index-b.index).map(o=>o.bubble!)};
  const pageForeground=p.scene.owners.some(o=>o.kind==='page');
  const canReorderGroup=(key:string,target:string,after=false)=>{
    const lettering=letteringLayerMove(relations,key,target,after);
    if(lettering){const text=p.scene.owners.find(o=>o.key===`bubble-${lettering.index}`);return !!text&&!paintOwnerPlacementLocked(text);}
    return canReorderBubbleLayers(relations,key,target)||!pageForeground&&key!==target&&[key,target].every(value=>value==='background'||/^figure-\d+$/.test(value));
  };
  return <div class="paint-layer-palette" ref={paletteRef}>{!p.embedded&&<h3>レイヤー</h3>}
    {!p.embedded&&!p.inactive&&<PaintLayerControls {...p}/>}<div class="layer-tree" role="tree" aria-label="レイヤーの重なり">
      {!p.embedded&&<div class="layer-panel-row"><strong>{p.title}</strong></div>}
      {displayOwners.map((o,ownerIndex,owners)=>{
        const bubble=o.kind==='bubble',originals=p.scene.owners.filter(child=>child.parentKey===o.key),groupLocked=o.locked===true,visible=bubble?(bubbleVisible(o.bubble!)||originals.some(child=>child.paint.layers.some(l=>paintLayerVisible(child.paint,l)))):o.paint.layers.some(l=>paintLayerVisible(o.paint,l)),folded=collapsed[o.key]??bubble;
        const paintActive=!p.inactive&&o.key===p.owner.key,canvasSelected=p.selectedOwner===o.key,active=canvasSelected||paintActive||originals.some(child=>p.selectedOwner===child.key||!p.inactive&&p.owner.key===child.key);
        const frame=o.kind!=='original'&&(ownerIndex===0||owners[ownerIndex-1].kind==='original')?p.frameLayer:null;
        if(o.kind==='original')return <>{frame}{renderOriginal(o)}</>;
        if(o.kind==='panel'||o.kind==='page')return <>{frame}<div class="layer-direct-root" key={o.key}>{renderEntries(o,paintActive)}</div></>;
        return <>{frame}<div class="layer-group" key={o.key}>
          <div data-owner-group={o.key} role="treeitem" aria-selected={active} data-canvas-selected={!bubble&&canvasSelected} class={`layer-group-row ${bubble?'bubble-layer-row':''} ${active?'is-selected':''} ${groupDrop?.key===o.key?(groupDrop.after?'drop-below':'drop-above'):''}`}
            onPointerDown={e=>{if(!p.reorderGroup||p.disabled||!displayOwners.some(target=>canReorderGroup(o.key,target.key))||paintOwnerPlacementLocked(o)||e.button!==0||!(e.target as Element).closest('.layer-group-select'))return;skipGroupClick.current=false;groupDrag.current={key:o.key,pointer:e.pointerId,x:e.clientX,y:e.clientY};try{(e.target as Element).closest<HTMLElement>('.layer-group-select')!.setPointerCapture(e.pointerId);}catch{}}}
            onPointerMove={e=>{const d=groupDrag.current;if(!d||d.pointer!==e.pointerId||Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;
              const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-owner-group]'),key=row?.dataset.ownerGroup;
              if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||!key||!canReorderGroup(d.key,key)){d.target=undefined;setGroupDrop(null);return;}
              e.preventDefault();const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;d.target=key;d.after=after;setGroupDrop({key,after});}}
            onPointerUp={e=>{const d=groupDrag.current;groupDrag.current=null;setGroupDrop(null);if(d?.target){skipGroupClick.current=true;e.preventDefault();e.stopPropagation();p.reorderGroup?.(d.key,d.target,!!d.after);}}}
            onClickCapture={e=>{if(skipGroupClick.current){skipGroupClick.current=false;e.preventDefault();e.stopPropagation();}}}
            onPointerCancel={()=>{groupDrag.current=null;setGroupDrop(null);}} onContextMenu={e=>p.menu(e,o.key)}>
            {<LayerVisibilityButton label={`${label(o)}${bubble?'全体':'の画像'}を${visible?'隠す':'表示'}`} visible={visible} disabled={p.disabled} onClick={()=>bubble?p.onToggleBubble?.(o.index,true):p.toggleGroup(o.key)}/>}
            <button class="palette-icon layer-folder-toggle" data-tool-label="グループの開閉" data-tool-help={bubble?'文字・輪郭と原本画像を同じフォルダー内で別々に選択します。開閉で目の状態は変わりません。':'描画レイヤーを折りたたむか、一覧へ展開します。'} aria-label={`${label(o)}を${folded?'展開':'折りたたむ'}`} aria-expanded={!folded} onClick={()=>setCollapsed({...collapsed,[o.key]:!folded})}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="layer-group-select" data-tool-label={bubble?'テキストを選択':o.kind==='figure'?'人物・小道具を選択':'背景を描画'} data-tool-help={o.kind==='bubble'?'編集可能な文字とベクターの輪郭を選択します。原本画像とは独立しています。Tを選び、紙面のテキストを1回クリックして文字を編集します。':o.kind==='figure'?'キャンバスの人物・小道具を選択してコマ情報を表示します。描くときは中のレイヤーを選びます。フォルダをドラッグして重なり順を変えられます。':'背景を描画対象にします。フォルダを上下へドラッグして重なり順を変えられます。'} aria-pressed={active} onClick={()=>p.select(o.key)} disabled={p.disabled}><span class="layer-kind-icon">{folded?<Folder size={17}/>:<FolderOpen size={17}/>}</span><span class="layer-caption">{label(o)}</span></button>
            {o.kind==='background'&&p.openBackground3d&&(p.backgroundCapture?<button class="background3d-open" aria-label="3D背景を撮影" title="今の構図を編集可能な線画・ベタ・トーンとして保存します。" disabled={!p.backgroundCapture.ready} onClick={p.backgroundCapture.capture}><Camera size={15}/>撮影</button>:<button class="background3d-open" aria-label="背景あたりの3Dモデルを配置・調整" title="このコマの背景で3Dモデルの構図を決め、線画・ベタ・トーンとして撮影します。" disabled={p.disabled||paintOwnerLocked(o)||(!p.inactive&&!p.images)} onClick={p.openBackground3d}><Box size={15}/>3D編集</button>)}
            <LockButton label={bubble?`${label(o)}全体`:label(o)} locked={bubble?groupLocked:o.locked===true} inherited={o.inheritedLocked===true} disabled={p.disabled} onClick={()=>p.lockOwner(o.key,bubble?!groupLocked:o.locked!==true,bubble)}/>
          </div>
          {!folded&&<div class="layer-group-children" role="group">
            {[...originals].reverse().map(renderOriginal)}
            {bubble&&<div class={`layer-row bubble-native-row ${canvasSelected?'is-selected':''}`} role="treeitem" aria-selected={canvasSelected} data-canvas-selected={canvasSelected} data-owner={o.key}>
              <LayerVisibilityButton label={`${label(o)}の文字を${bubbleVisible(o.bubble!)?'隠す':'表示'}`} visible={bubbleVisible(o.bubble!)} disabled={p.disabled} onClick={()=>p.onToggleBubble?.(o.index)}/>
              <button class="layer-select" aria-label={`${label(o)}の文字を選択`} disabled={p.disabled} onClick={()=>p.select(o.key)}><span class="layer-kind-icon"><Type size={18}/></span><span class="layer-caption">{o.bubble?.text}</span></button>
              <LockButton label={`${label(o)}の文字`} locked={o.bubble?.nativeLocked===true} inherited={o.inheritedLocked===true||o.locked===true} disabled={p.disabled} onClick={()=>p.lockOwner(o.key,o.bubble?.nativeLocked!==true)}/>
            </div>}
            {renderEntries(o,paintActive)}</div>}
        </div></>;
      })}
    </div>
  </div>;
}
