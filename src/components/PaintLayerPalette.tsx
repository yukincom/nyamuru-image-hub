import { ChevronDown, ChevronRight, Eye, Folder, FolderOpen, FolderPlus, FilePlus2, Copy, Trash2, PenTool, Box, Camera, Image as ImageIcon, Layers, Bot, Info } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaintLayer } from '../types';
import {paintLayerTree,type PaintLayerDropTarget,type PaintOwner,type PaintScene} from '../lib/paintDocument';
import { drawPaintMask, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { PaintOriginal } from './PaintSceneView';
import { PaintToolButton } from './PaintToolHelp';
import LayerVisibilityButton from './LayerVisibilityButton';
import { bubbleVisible } from '../lib/panelLayers';
import LayerLockIcon from './LayerLockIcon';
import {paintLayerEditable,paintOwnerLocked,paintOwnerPlacementLocked} from '../lib/paintLock';
import type { ComponentChildren } from 'preact';

function Thumbnail({owner,layer,images}:{owner:PaintOwner;layer:PaintLayer;images:PaintImages|null}){
  const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof paintPreviewRenderer>|null>(null);
  useEffect(()=>()=>renderer.current?.dispose(),[]);
  useLayoutEffect(()=>{if(!canvas.current||!images)return;const context=canvas.current.getContext('2d');if(layer.image&&!images.has(layer.image.assetId)){context?.clearRect(0,0,canvas.current.width,canvas.current.height);return;}renderer.current??=paintPreviewRenderer();try{renderer.current.draw(canvas.current,{...owner.paint,layers:[{...layer,visible:true,opacity:1}]},images);}catch{context?.clearRect(0,0,canvas.current.width,canvas.current.height);}},[owner.paint.width,owner.paint.height,layer,images]);
  const scale=40/Math.max(owner.paint.width,owner.paint.height);
  return <span class="layer-thumbnail"><canvas ref={canvas} width={Math.max(1,Math.round(owner.paint.width*scale))} height={Math.max(1,Math.round(owner.paint.height*scale))}/></span>;
}
function MaskThumbnail({owner,layer}:{owner:PaintOwner;layer:PaintLayer}){
  const ref=useRef<HTMLCanvasElement>(null);
  const scale=32/Math.max(owner.paint.width,owner.paint.height);
  useLayoutEffect(()=>{if(ref.current)drawPaintMask(ref.current,owner.paint,layer);},[owner.paint.width,owner.paint.height,layer.mask]);
  return <span class="layer-mask-thumbnail"><canvas ref={ref} width={Math.max(1,Math.round(owner.paint.width*scale))} height={Math.max(1,Math.round(owner.paint.height*scale))}/></span>;
}
interface Props {
  frameLayer?:ComponentChildren;
  backgroundObjects?:{ownerKey:string;items:Array<{mesh:number;name:string;mode:string}>;disabled:boolean;show:(mesh:number)=>void};
  backgroundCapture?:{ready:boolean;capture:()=>void};
  selectedMask?:'mask'|'generationMask'|null;
  selectMask?:(key:string,id:string,kind:'mask'|'generationMask')=>void;
  addToneMask?:()=>void; addGenerationMask?:()=>void; disabledReason?:string;
  selectedOwner?:string; canvasSelectionScrollRequest?:number; onToggleBubble?:(index:number)=>void; openBackground3d?:()=>void;
  reorderGroup?:(key:string,target:string,after:boolean)=>void; embedded?:boolean; inactive?:boolean; onEditText?:(index:number)=>void; title:string; scene:PaintScene; owner:PaintOwner; layer:PaintLayer; images:PaintImages|null; disabled:boolean;
  select:(key:string,id?:string,contents?:boolean)=>void; update:(key:string,id:string,patch:Partial<PaintLayer>)=>void;
  lockOwner:(key:string,locked:boolean)=>void;
  toggleGroup:(key:string)=>void; guideVisible:(key:string)=>boolean; toggleGuide:(key:string)=>void;
  addFolder:()=>void; add:()=>void; addVector:()=>void; importImage:()=>void; reorder:(key:string,id:string,target:string,after:boolean)=>void; moveLayer:(key:string,id:string,target:PaintLayerDropTarget)=>void; renameFolder:(key:string,id:string,name:string)=>void; removeFolder:(key:string,id:string)=>void; duplicate:()=>void; remove:()=>void;
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
    '削除':'選択したレイヤーを削除します。元に戻すで復旧できます。最後の1枚も削除でき、必要なら追加ボタンで作り直せます。固定中のレイヤーは削除できません。',
  }[label]??(label.includes('あたり画像表示')?'元のあたりの表示を切り替えます。描いた線と元の情報は保持します。':label.includes('固定')?'レイヤーを固定・解除します。固定したレイヤーは描画・変更・移動の対象から外れ、奥の内容を選択できます。':'描画画像の表示・非表示を切り替えます。画像データは消えません。'));
type ControlsProps=Pick<Props,'owner'|'layer'|'disabled'|'update'|'addFolder'|'add'|'addVector'|'duplicate'|'remove'|'selectedMask'|'addToneMask'|'addGenerationMask'|'disabledReason'>;
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
      {icon('複製',p.duplicate,Copy,!hasLayer||p.owner.paint.layers.length>=64||p.selectedMask==='generationMask')}{icon('削除',p.remove,Trash2,!hasLayer||p.layer.locked)}
    </div>
    {!hasLayer&&<p class="layer-operation-note">レイヤーはありません。必要なときだけラスターレイヤーかベクターレイヤーを追加してください。</p>}
    {hasLayer&&p.disabledReason&&<p class="layer-operation-note">{p.disabledReason}</p>}
  </div>;
}
export default function PaintLayerPalette(p:Props){
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({}),[renaming,setRenaming]=useState<string|null>(null),[folderCollapsed,setFolderCollapsed]=useState<Record<string,boolean>>({}),[renamingFolder,setRenamingFolder]=useState<string|null>(null);
  const [drop,setDrop]=useState<{key:string;kind:'layer'|'folder'|'root';id?:string;placement?:'above'|'inside'|'below';edge?:'top'|'bottom'}|null>(null);
  const drag=useRef<{key:string;id:string;x:number;y:number;pointerId:number;capture:HTMLElement;moved:boolean;drop?:PaintLayerDropTarget}|null>(null);
  const paletteRef=useRef<HTMLDivElement>(null),skipGroupClick=useRef(false);
  const groupDrag=useRef<{key:string;pointer:number;x:number;y:number;target?:string;after?:boolean}|null>(null);
  const [groupDrop,setGroupDrop]=useState<{key:string;after:boolean}|null>(null);
  useEffect(()=>{
    if(p.selectedOwner)setCollapsed(value=>({...value,[p.selectedOwner!]:false}));
  },[p.selectedOwner,p.canvasSelectionScrollRequest]);
  const label=(o:PaintOwner)=>o.kind==='background'?'背景':o.kind==='panel'?'コマ内':o.kind==='page'?'コマ外':o.label;
  const beginLayerDrag=(e:PointerEvent,o:PaintOwner,l:PaintLayer)=>{if(p.disabled||e.metaKey||e.ctrlKey||e.altKey||e.button!==0||!e.isPrimary||!(e.target as Element).closest('.layer-select')||!paintLayerEditable(o,l))return;const capture=(e.target as Element).closest<HTMLElement>('.layer-select')!;capture.classList.add('is-dragging');drag.current={key:o.key,id:l.id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,capture,moved:false};try{capture.setPointerCapture(e.pointerId);}catch{}};
  const moveLayerDrag=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;d.moved=true;e.preventDefault();
    const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-layer-drop]');
    if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||row.dataset.owner!==d.key){d.drop=undefined;delete d.capture.dataset.dragTarget;setDrop(null);return;}
    const kind=row.dataset.layerDrop,box=row.getBoundingClientRect();
    if(kind==='layer'){
      const id=row.dataset.layer;if(!id||id===d.id){d.drop=undefined;delete d.capture.dataset.dragTarget;setDrop(null);return;}const after=e.clientY>box.top+box.height/2;
      d.drop={kind:'layer',id,after};d.capture.dataset.dragTarget=`layer:${after?'below':'above'}`;setDrop({key:d.key,kind:'layer',id,placement:after?'below':'above'});return;
    }
    if(kind==='folder'){
      const id=row.dataset.folder;if(!id){d.drop=undefined;delete d.capture.dataset.dragTarget;setDrop(null);return;}const ratio=(e.clientY-box.top)/Math.max(1,box.height),placement=ratio<.25?'above':ratio>.75?'below':'inside';
      d.drop={kind:'folder',id,placement};d.capture.dataset.dragTarget=`folder:${placement}`;setDrop({key:d.key,kind:'folder',id,placement});return;
    }
    const edge=row.dataset.edge==='bottom'?'bottom':'top';d.drop={kind:'root',edge};d.capture.dataset.dragTarget=`root:${edge}`;setDrop({key:d.key,kind:'root',edge});
  };
  const endLayerDrag=(e:PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;drag.current=null;setDrop(null);d.capture.classList.remove('is-dragging');delete d.capture.dataset.dragTarget;if(d.moved){e.preventDefault();e.stopPropagation();if(d.drop)p.moveLayer(d.key,d.id,d.drop);}try{d.capture.releasePointerCapture(e.pointerId);}catch{}};
  const cancelLayerDrag=()=>{if(drag.current){drag.current.capture.classList.remove('is-dragging');delete drag.current.capture.dataset.dragTarget;}drag.current=null;setDrop(null);};
  const renderLayer=(o:PaintOwner,l:PaintLayer,active:boolean)=><div class="layer-entry" key={l.id}><div role="treeitem" aria-selected={active&&l.id===p.layer.id&&p.selectedMask!=='generationMask'} class={`layer-row ${active&&l.id===p.layer.id&&p.selectedMask!=='generationMask'?'is-selected':''} ${drop?.kind==='layer'&&drop.key===o.key&&drop.id===l.id?(drop.placement==='below'?'drop-below':'drop-above'):''}`}
    data-layer-drop="layer" data-layer={l.id} data-owner={o.key}
    onPointerDown={e=>beginLayerDrag(e,o,l)} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag} onPointerCancel={cancelLayerDrag} onLostPointerCapture={cancelLayerDrag} onContextMenu={e=>p.menu(e,o.key)}>
    <LayerVisibilityButton label={`${label(o)}・${l.name}を${l.visible?'隠す':'表示'}`} visible={l.visible} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{visible:!l.visible})}/>
    <button class="layer-select" data-tool-label={l.name} data-tool-help="クリックで描くレイヤーを選びます。ドラッグした位置へ移動し、フォルダーの中央へ重ねると中へ、上下へ置くと外へ移動します。ダブルクリックで名前を変えます。" disabled={p.disabled} onClick={e=>{if(!(active&&l.id===p.layer.id&&p.selectedMask==='mask')||e.metaKey||e.ctrlKey||e.altKey)p.select(o.key,l.id,e.metaKey||e.ctrlKey||e.altKey);}} onDblClick={()=>{p.select(o.key,l.id);if(paintLayerEditable(o,l))setRenaming(l.id);}}><span class="layer-thumbnail">{l.guide&&!l.image?<PaintOriginal owner={o}/>:<Thumbnail owner={o} layer={l} images={p.images}/>}</span><span class="layer-caption"><small>{Math.round(l.opacity*100)}% {l.blend==='multiply'?'乗算':'通常'}{l.tone?.enabled?` · ${l.tone.lpi}線`:''}{l.mask?.enabled?' · マスク':''}</small><span class="layer-name-line">{l.kind==='vector'&&<PenTool size={12}/>}<span>{l.name}</span></span></span></button>
    {l.mask&&<PaintToolButton class="layer-mask-toggle" label={`${l.name}のマスク編集`} help="オンで赤い範囲を編集し、もう一度押すとトーンを表示します。" aria-pressed={Boolean(active&&l.id===p.layer.id&&p.selectedMask==='mask')} disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,'mask')}><MaskThumbnail owner={o} layer={l}/></PaintToolButton>}
    <LockButton label={l.name} locked={l.locked} inherited={paintOwnerLocked(o)} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{locked:!l.locked})}/>
    {renaming===l.id&&<input autoFocus aria-label="レイヤー名" value={l.name} onInput={e=>p.update(o.key,l.id,{name:e.currentTarget.value})} onBlur={()=>setRenaming(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')setRenaming(null);}}/>}
  </div>{(['generationMask'] as const).map(kind=>l[kind]&&<div class={`layer-row layer-mask-row ${active&&l.id===p.layer.id&&p.selectedMask===kind?'is-selected':''}`} role="treeitem" aria-selected={active&&l.id===p.layer.id&&p.selectedMask===kind}>
    <LayerVisibilityButton label={`${l.name}の生成マスクを${l[kind]!.enabled?'無効':'有効'}にする`} visible={l[kind]!.enabled} disabled={p.disabled||!paintLayerEditable(o,l)} onClick={()=>p.update(o.key,l.id,{[kind]:{...l[kind]!,enabled:!l[kind]!.enabled}})}/>
    <button class="layer-select" disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,kind)}><Layers size={16}/><span>生成マスク<small>赤・青・緑・黄で領域を指定</small></span></button>
  </div>)}</div>;
  const renderEntries=(o:PaintOwner,active:boolean)=>{
    const entries=paintLayerTree(o.paint).reverse();
    return <div class="layer-owner-entries" data-owner-root={o.key}>
      <div class={`layer-root-drop is-top ${drop?.kind==='root'&&drop.key===o.key&&drop.edge==='top'?'drop-inside':''}`} data-layer-drop="root" data-edge="top" data-owner={o.key} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag}/>
      {entries.map(entry=>entry.kind==='layer'?renderLayer(o,entry.layer,active):(()=>{const folded=folderCollapsed[entry.folder.id]??false,folderDrop=drop?.kind==='folder'&&drop.key===o.key&&drop.id===entry.folder.id;return <div class={`layer-user-folder ${folderDrop?`drop-${drop.placement}`:''}`} key={entry.folder.id}>
        <div class="layer-user-folder-row" role="treeitem" aria-expanded={!folded} data-layer-drop="folder" data-folder={entry.folder.id} data-owner={o.key} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag}>
          <button class="palette-icon" aria-label={`${entry.folder.name}を${folded?'展開':'折りたたむ'}`} onClick={()=>setFolderCollapsed({...folderCollapsed,[entry.folder.id]:!folded})}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
          <button class="layer-folder-select" aria-label={`${entry.folder.name}を選択`} data-tool-help="レイヤーを中央へドロップすると中へ入ります。上端・下端へドロップするとフォルダー外のその位置へ移動します。" onDblClick={()=>setRenamingFolder(entry.folder.id)}><FolderOpen size={17}/><span>{entry.folder.name}</span></button>
          <button class="palette-icon" aria-label={`${entry.folder.name}を解除`} data-tool-help="フォルダーだけを解除し、中のレイヤーは現在の位置に残します。" onClick={()=>p.removeFolder(o.key,entry.folder.id)}><Trash2 size={15}/></button>
          {renamingFolder===entry.folder.id&&<input autoFocus aria-label="フォルダー名" value={entry.folder.name} onInput={event=>p.renameFolder(o.key,entry.folder.id,event.currentTarget.value)} onBlur={()=>setRenamingFolder(null)} onKeyDown={event=>{if(event.key==='Enter'||event.key==='Escape')setRenamingFolder(null);}}/>}
        </div>
        {!folded&&<div class="layer-user-folder-children" role="group">{[...entry.layers].reverse().map(layer=>renderLayer(o,layer,active))}</div>}
      </div>})())}
      <div class={`layer-root-drop is-bottom ${drop?.kind==='root'&&drop.key===o.key&&drop.edge==='bottom'?'drop-inside':''}`} data-layer-drop="root" data-edge="bottom" data-owner={o.key} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag}/>
    </div>;
  };
  const renderOwnerInfo=(o:PaintOwner)=><div class="layer-row layer-owner-info-row" role="treeitem">
    <span class="palette-icon" aria-hidden="true"><Info size={16}/></span>
    <button class="layer-select" data-tool-label="コマ情報" data-tool-help="このフォルダーに紐づく人物・小道具・吹き出しの設定を表示します。" disabled={p.disabled} onClick={()=>p.select(o.key)}><span class="layer-caption"><small>{label(o)}フォルダー</small><span class="layer-name-line"><span>コマ情報</span></span></span></button>
  </div>;
  return <div class="paint-layer-palette" ref={paletteRef}>{!p.embedded&&<h3>レイヤー</h3>}
    {!p.embedded&&!p.inactive&&<PaintLayerControls {...p}/>}<div class="layer-tree" role="tree" aria-label="レイヤーの重なり">
      {!p.embedded&&<div class="layer-panel-row"><strong>{p.title}</strong></div>}
      {[...p.scene.owners].filter(o=>(o.kind!=='panel'&&o.kind!=='page')||o.paint.layers.length>0||o.paint.folders?.length).reverse().map((o,ownerIndex,owners)=>{
        const bubble=o.kind==='bubble',visible=bubble?bubbleVisible(o.bubble!):o.paint.layers.some(l=>l.visible),folded=collapsed[o.key]??bubble;
        const paintActive=!p.inactive&&o.key===p.owner.key,canvasSelected=p.selectedOwner===o.key,active=paintActive||canvasSelected;
        const frame=o.kind!=='original'&&(ownerIndex===0||owners[ownerIndex-1].kind==='original')?p.frameLayer:null;
        if(o.kind==='panel'||o.kind==='page'||o.kind==='original')return <>{frame}<div class={`layer-direct-root ${o.kind==='original'?'original-raster-root':''}`} key={o.key} data-original-raster={o.kind==='original'?o.original?.id:undefined}>
          {o.kind==='original'&&<div class={`layer-group-row original-owner-row ${active?'is-selected':''}`} role="treeitem" aria-selected={active} data-canvas-selected={canvasSelected} data-owner-group={o.key}>
            <button class="layer-group-select" aria-pressed={active} aria-label={`${label(o)}を選択`} disabled={p.disabled} onClick={()=>p.select(o.key)}><ImageIcon size={17}/><span class="layer-caption">{label(o)}</span></button>
          </div>}
          {renderEntries(o,paintActive)}</div></>;
        return <>{frame}<div class="layer-group" key={o.key}>
          <div data-owner-group={o.key} role="treeitem" aria-selected={active} data-canvas-selected={canvasSelected} class={`layer-group-row ${bubble?'bubble-layer-row':''} ${active?'is-selected':''} ${groupDrop?.key===o.key?(groupDrop.after?'drop-below':'drop-above'):''}`}
            onPointerDown={e=>{if(!p.reorderGroup||p.disabled||o.kind==='bubble'||o.kind==='panel'||o.kind==='page'||paintOwnerPlacementLocked(o)||e.button!==0||!(e.target as Element).closest('.layer-group-select'))return;skipGroupClick.current=false;groupDrag.current={key:o.key,pointer:e.pointerId,x:e.clientX,y:e.clientY};(e.target as Element).closest<HTMLElement>('.layer-group-select')!.setPointerCapture(e.pointerId);}}
            onPointerMove={e=>{const d=groupDrag.current;if(!d||d.pointer!==e.pointerId||Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;
              const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-owner-group]'),key=row?.dataset.ownerGroup;
              if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||!key||key.startsWith('bubble-')||key===d.key){d.target=undefined;setGroupDrop(null);return;}
              e.preventDefault();const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;d.target=key;d.after=after;setGroupDrop({key,after});}}
            onPointerUp={e=>{const d=groupDrag.current;groupDrag.current=null;setGroupDrop(null);if(d?.target){skipGroupClick.current=true;e.preventDefault();e.stopPropagation();p.reorderGroup?.(d.key,d.target,!!d.after);}}}
            onClickCapture={e=>{if(skipGroupClick.current){skipGroupClick.current=false;e.preventDefault();e.stopPropagation();}}}
            onPointerCancel={()=>{groupDrag.current=null;setGroupDrop(null);}} onContextMenu={e=>p.menu(e,o.key)}>
            {<LayerVisibilityButton label={`${label(o)}${bubble?'全体':'の画像'}を${visible?'隠す':'表示'}`} visible={visible} disabled={p.disabled} onClick={()=>bubble?p.onToggleBubble?.(o.index):p.toggleGroup(o.key)}/>}
            <button class="palette-icon" data-tool-label="グループの開閉" data-tool-help={bubble?'吹き出しに描き足したレイヤーの詳細を開きます。文字と形は一体のままです。':'描画レイヤーを折りたたむか、一覧へ展開します。'} aria-label={`${label(o)}を${folded?'展開':'折りたたむ'}`} aria-expanded={!folded} onClick={()=>setCollapsed({...collapsed,[o.key]:!folded})}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="layer-group-select" data-tool-label={o.kind==='bubble'?'吹き出しを選択':'描画対象を選択'} data-tool-help={o.kind==='bubble'?'編集可能な文字とベクターの輪郭を選択します。原本画像とは独立しています。Tを選び、紙面の吹き出しを1回クリックして文字を編集します。':'この人物・背景を描画対象にします。フォルダを上下へドラッグして重なり順を変えられます。'} aria-pressed={active} onClick={()=>p.select(o.key)} disabled={p.disabled}>{bubble?<span class="layer-thumbnail bubble-layer-thumbnail"><PaintOriginal owner={o}/></span>:folded?<Folder size={17}/>:<FolderOpen size={17}/>}<span class="layer-caption">{bubble?<><small>{label(o)} · ベクター</small><span class="layer-name-line"><PenTool size={12}/>{o.bubble?.text||"吹き出し"}</span></>:label(o)}</span></button>
            {o.kind==='background'&&p.openBackground3d&&(p.backgroundCapture?<button class="background3d-open" aria-label="3D背景を撮影" title="今の構図を編集可能な線画・ベタ・トーンとして保存します。" disabled={!p.backgroundCapture.ready} onClick={p.backgroundCapture.capture}><Camera size={15}/>撮影</button>:<button class="background3d-open" aria-label="背景あたりの3Dモデルを配置・調整" title="このコマの背景で3Dモデルの構図を決め、線画・ベタ・トーンとして撮影します。" disabled={p.disabled||paintOwnerLocked(o)||(!p.inactive&&!p.images)} onClick={p.openBackground3d}><Box size={15}/>3D編集</button>)}
            <LockButton label={label(o)} locked={o.locked===true} inherited={o.inheritedLocked===true} disabled={p.disabled} onClick={()=>p.lockOwner(o.key,o.locked!==true)}/>
          </div>
          {!folded&&p.backgroundObjects?.ownerKey===o.key&&p.backgroundObjects.items.length>0&&<div role="group" aria-label="非表示の3Dオブジェクト" class="background3d-hidden-objects">
            {p.backgroundObjects.items.map(object=><div role="treeitem" class="layer-row background3d-hidden-object" key={object.mesh} data-background-object={object.mesh}>
              <PaintToolButton class="palette-icon layer-visibility" label={`${object.name}を再表示`} help="この物を再表示し、カメラの向きが変わっても表示します。自動に戻すには、物を選択して右クリックします。" disabled={p.backgroundObjects!.disabled} onClick={()=>p.backgroundObjects!.show(object.mesh)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><path d="m9 9 6 6m0-6-6 6"/></svg></PaintToolButton>
              <span class="layer-caption"><small>3D · 非表示</small>{object.name}</span>
            </div>)}
          </div>}
          {!folded&&<div role="group">{renderEntries(o,paintActive)}{(o.kind==='figure'||o.kind==='bubble')&&renderOwnerInfo(o)}</div>}
        </div></>;
      })}
    </div>
  </div>;
}
