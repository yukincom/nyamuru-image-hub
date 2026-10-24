import { ChevronDown, ChevronRight, Eye, Folder, FolderOpen, FilePlus2, ImagePlus, Copy, Trash2, PenTool, Box, Camera, Download, Layers, Bot } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaintLayer } from '../types';
import type { PaintOwner, PaintScene } from '../lib/paintDocument';
import { drawPaintMask, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { PaintOriginal } from './PaintSceneView';
import { PaintToolButton } from './PaintToolHelp';
import LayerVisibilityButton from './LayerVisibilityButton';
import { bubbleVisible } from '../lib/panelLayers';
import LayerLockIcon from './LayerLockIcon';
import {paintLayerEditable,paintOwnerLocked,paintOwnerPlacementLocked} from '../lib/paintLock';

function Thumbnail({owner,layer,images}:{owner:PaintOwner;layer:PaintLayer;images:PaintImages|null}){
  const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof paintPreviewRenderer>|null>(null);
  useEffect(()=>()=>renderer.current?.dispose(),[]);
  useLayoutEffect(()=>{if(!canvas.current||!images)return;renderer.current??=paintPreviewRenderer();renderer.current.draw(canvas.current,{...owner.paint,layers:[{...layer,visible:true,opacity:1}]},images);},[owner.paint.width,owner.paint.height,layer,images]);
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
  backgroundObjects?:{ownerKey:string;items:Array<{mesh:number;name:string;mode:string}>;disabled:boolean;show:(mesh:number)=>void};
  backgroundCapture?:{ready:boolean;capture:()=>void};
  selectedMask?:'mask'|'generationMask'|null;
  selectMask?:(key:string,id:string,kind:'mask'|'generationMask')=>void;
  addToneMask?:()=>void; addGenerationMask?:()=>void; exportImage?:()=>void; disabledReason?:string;
  selectedBubble?:number; onToggleBubble?:(index:number)=>void; openBackground3d?:()=>void;
  reorderGroup?:(key:string,target:string,after:boolean)=>void; embedded?:boolean; inactive?:boolean; onEditText?:(index:number)=>void; title:string; scene:PaintScene; owner:PaintOwner; layer:PaintLayer; images:PaintImages|null; disabled:boolean;
  select:(key:string,id?:string,contents?:boolean)=>void; update:(key:string,id:string,patch:Partial<PaintLayer>)=>void;
  toggleGroup:(key:string)=>void; guideVisible:(key:string)=>boolean; toggleGuide:(key:string)=>void;
  add:()=>void; addVector:()=>void; importImage:()=>void; reorder:(key:string,id:string,target:string,after:boolean)=>void; duplicate:()=>void; remove:()=>void;
  menu:(event:MouseEvent,key:string)=>void;
}
const help=(label:string)=>({
    'ラスターレイヤー追加':'選択中の人物・背景・吹き出しに、空のラスターレイヤーを追加します。',
    '画像を読み込む':'PNG/JPEGを画像レイヤーとして追加します。元の画像と別のレイヤーは保持します。',
    'ベクターレイヤー追加':'選択中の対象にベクターレイヤーを追加し、ベジェペンに切り替えます。',
    '画像をPNGで書き出す':'選択中の人物・背景・吹き出しグループの描画レイヤーをPNGに保存します。生成マスクは含めません。',
    '複製':'選択したレイヤーを同じグループ内に複製します。',
    '削除':'選択したレイヤーを削除します。元に戻すで復旧できます。最後の1枚を消すと空レイヤーになります。固定中のレイヤーは削除できません。',
  }[label]??(label.includes('あたり画像表示')?'元のあたりの表示を切り替えます。描いた線と元の情報は保持します。':label.includes('固定')?'レイヤーを固定・解除します。固定したレイヤーは描画・変更・移動の対象から外れ、奥の内容を選択できます。':'描画画像の表示・非表示を切り替えます。画像データは消えません。'));
type ControlsProps=Pick<Props,'owner'|'layer'|'disabled'|'update'|'add'|'addVector'|'importImage'|'duplicate'|'remove'|'selectedMask'|'addToneMask'|'addGenerationMask'|'exportImage'|'disabledReason'>;
export function PaintLayerControls(p:ControlsProps){
  const icon=(label:string,action:()=>void,Icon:typeof Eye,disabled=false)=><PaintToolButton class="palette-icon" label={label} help={help(label)} onClick={action} disabled={p.disabled||disabled}><Icon size={18}/></PaintToolButton>;
  return <div class="layer-controls" role="group" aria-label="レイヤー操作">
    <div class="layer-properties"><select aria-label="レイヤーの合成" data-tool-help="通常はそのまま重ね、乗算は下の絵と掛け合わせます。白い部分を透かして線を重ねたいときは乗算を選びます。" disabled={p.disabled||!paintLayerEditable(p.owner,p.layer)} value={p.layer.blend} onChange={e=>p.update(p.owner.key,p.layer.id,{blend:e.currentTarget.value as PaintLayer['blend']})}><option value="normal">通常</option><option value="multiply">乗算</option></select>
      <label class="layer-density">濃度<input aria-label="レイヤーの濃度" data-tool-help="選択したレイヤー全体の濃さです。下げると下の絵が透けて見えます。" type="range" min="0" max="1" step="0.01" disabled={p.disabled||!paintLayerEditable(p.owner,p.layer)} value={p.layer.opacity} onInput={e=>p.update(p.owner.key,p.layer.id,{opacity:Number(e.currentTarget.value)})}/><span>{Math.round(p.layer.opacity*100)}%</span></label></div>
    <div class="layer-icon-actions">
      {icon('ラスターレイヤー追加',p.add,FilePlus2,p.owner.paint.layers.length>=64)}
      {icon('ベクターレイヤー追加',p.addVector,PenTool,p.owner.paint.layers.length>=64)}
      <PaintToolButton class="palette-icon" label="トーンレイヤー作成" help="トーンレイヤーを追加し、赤いマスクで範囲を塗ります。選択範囲があれば引き継ぎます。" disabled={p.disabled||p.owner.paint.layers.length>=64||!p.addToneMask} onClick={p.addToneMask}><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m12 1 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Zm14 0 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Z"/></svg></PaintToolButton>
      <PaintToolButton class="palette-icon" label="生成マスク化" help="選択中のレイヤーに生成用のマスクを作り、色で領域を指定します。" disabled={p.disabled||p.layer.locked||!p.addGenerationMask} onClick={p.addGenerationMask}><Bot size={18}/></PaintToolButton>
      <PaintToolButton class="palette-icon layer-lock-control" label={p.layer.locked?'レイヤーの固定を解除':'レイヤーを固定'} help={help('固定')} aria-pressed={p.layer.locked} disabled={p.disabled||paintOwnerLocked(p.owner)} onClick={()=>p.update(p.owner.key,p.layer.id,{locked:!p.layer.locked})}><LayerLockIcon/></PaintToolButton>
      {icon('複製',p.duplicate,Copy,p.owner.paint.layers.length>=64||p.selectedMask==='generationMask')}{icon('削除',p.remove,Trash2,p.layer.locked)}
    </div>
    {p.disabledReason&&<p class="layer-operation-note">{p.disabledReason}</p>}
    <div class="layer-image-actions" role="group" aria-label="画像の入出力"><span>画像</span>{icon('画像を読み込む',p.importImage,ImagePlus)}{icon('画像をPNGで書き出す',p.exportImage??(()=>{}),Download,!p.exportImage)}</div></div>;
}
export default function PaintLayerPalette(p:Props){
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({}),[renaming,setRenaming]=useState<string|null>(null);
  const [drop,setDrop]=useState<{id:string;after:boolean}|null>(null);
  const drag=useRef<{key:string;id:string;x:number;y:number;pointerId:number;capture:HTMLElement;moved:boolean;drop?:{id:string;after:boolean}}|null>(null);
  const paletteRef=useRef<HTMLDivElement>(null),skipGroupClick=useRef(false);
  const groupDrag=useRef<{key:string;pointer:number;x:number;y:number;target?:string;after?:boolean}|null>(null);
  const [groupDrop,setGroupDrop]=useState<{key:string;after:boolean}|null>(null);
  const label=(o:PaintOwner)=>o.kind==='background'?'背景':o.kind==='bubble'?o.label:o.figure?.name||`人物 ${o.index+1}`;
  return <div class="paint-layer-palette" ref={paletteRef}>{!p.embedded&&<h3>レイヤー</h3>}
    {!p.embedded&&!p.inactive&&<PaintLayerControls {...p}/>}<div class="layer-tree" role="tree" aria-label="レイヤーの重なり">
      {!p.embedded&&<div class="layer-panel-row"><strong>{p.title}</strong></div>}
      {[...p.scene.owners].reverse().map(o=>{
        const bubble=o.kind==='bubble',visible=bubble?bubbleVisible(o.bubble!):o.paint.layers.some(l=>l.visible),folded=collapsed[o.key]??bubble,active=(!p.inactive&&o.key===p.owner.key)||(bubble&&p.selectedBubble===o.index);
        return <div class="layer-group" key={o.key}>
          <div data-owner-group={o.key} role={bubble?'treeitem':undefined} aria-selected={bubble?active:undefined} class={`layer-group-row ${bubble?'bubble-layer-row':''} ${active?'is-selected':''} ${groupDrop?.key===o.key?(groupDrop.after?'drop-below':'drop-above'):''}`}
            onPointerDown={e=>{if(!p.reorderGroup||p.disabled||o.kind==='bubble'||paintOwnerPlacementLocked(o)||e.button!==0||!(e.target as Element).closest('.layer-group-select'))return;skipGroupClick.current=false;groupDrag.current={key:o.key,pointer:e.pointerId,x:e.clientX,y:e.clientY};(e.target as Element).closest<HTMLElement>('.layer-group-select')!.setPointerCapture(e.pointerId);}}
            onPointerMove={e=>{const d=groupDrag.current;if(!d||d.pointer!==e.pointerId||Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;
              const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-owner-group]'),key=row?.dataset.ownerGroup;
              if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||!key||key.startsWith('bubble-')||key===d.key){d.target=undefined;setGroupDrop(null);return;}
              e.preventDefault();const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;d.target=key;d.after=after;setGroupDrop({key,after});}}
            onPointerUp={e=>{const d=groupDrag.current;groupDrag.current=null;setGroupDrop(null);if(d?.target){skipGroupClick.current=true;e.preventDefault();e.stopPropagation();p.reorderGroup?.(d.key,d.target,!!d.after);}}}
            onClickCapture={e=>{if(skipGroupClick.current){skipGroupClick.current=false;e.preventDefault();e.stopPropagation();}}}
            onPointerCancel={()=>{groupDrag.current=null;setGroupDrop(null);}} onContextMenu={e=>p.menu(e,o.key)}>
            {<LayerVisibilityButton label={`${label(o)}${bubble?'全体':'の画像'}を${visible?'隠す':'表示'}`} visible={visible} disabled={p.disabled} onClick={()=>bubble?p.onToggleBubble?.(o.index):p.toggleGroup(o.key)}/>}
            <button class="palette-icon" data-tool-label="グループの開閉" data-tool-help={bubble?'吹き出しに描き足したレイヤーの詳細を開きます。文字と形は一体のままです。':'描画レイヤーを折りたたむか、一覧へ展開します。'} aria-label={`${label(o)}を${folded?'展開':'折りたたむ'}`} aria-expanded={!folded} onClick={()=>setCollapsed({...collapsed,[o.key]:!folded})}>{folded?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="layer-group-select" data-tool-label={o.kind==='bubble'?'吹き出しを選択':'描画対象を選択'} data-tool-help={o.kind==='bubble'?'文字と形をひとつの吹き出しとして選択します。ダブルクリックで文字を編集できます。':'この人物・背景を描画対象にします。フォルダを上下へドラッグして重なり順を変えられます。'} aria-pressed={active} onClick={()=>p.select(o.key)} onDblClick={()=>{if(bubble)p.onEditText?.(o.index);}} disabled={p.disabled}>{bubble?<span class="layer-thumbnail bubble-layer-thumbnail"><PaintOriginal owner={o}/></span>:folded?<Folder size={17}/>:<FolderOpen size={17}/>}<span class="layer-caption">{bubble?<><small>{label(o)} · 文字と形</small>{o.bubble?.text||"吹き出し"}</>:label(o)}</span></button>
            {o.kind==='background'&&p.openBackground3d&&(p.backgroundCapture?<button class="background3d-open" aria-label="3D背景を撮影" title="今の構図を編集可能な線画・ベタ・トーンとして保存します。" disabled={!p.backgroundCapture.ready} onClick={p.backgroundCapture.capture}><Camera size={15}/>撮影</button>:<button class="background3d-open" aria-label="背景あたりの3Dモデルを配置・調整" title="このコマの背景で3Dモデルの構図を決め、線画・ベタ・トーンとして撮影します。" disabled={p.disabled||(!p.inactive&&!p.images)} onClick={p.openBackground3d}><Box size={15}/>3D編集</button>)}
          </div>
          {!folded&&p.backgroundObjects?.ownerKey===o.key&&p.backgroundObjects.items.length>0&&<div role="group" aria-label="非表示の3Dオブジェクト" class="background3d-hidden-objects">
            {p.backgroundObjects.items.map(object=><div role="treeitem" class="layer-row background3d-hidden-object" key={object.mesh} data-background-object={object.mesh}>
              <PaintToolButton class="palette-icon layer-visibility" label={`${object.name}を再表示`} help="この物を再表示し、カメラの向きが変わっても表示します。自動に戻すには、物を選択して右クリックします。" disabled={p.backgroundObjects!.disabled} onClick={()=>p.backgroundObjects!.show(object.mesh)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><path d="m9 9 6 6m0-6-6 6"/></svg></PaintToolButton>
              <span class="layer-caption"><small>3D · 非表示</small>{object.name}</span>
            </div>)}
          </div>}
          {!folded&&<div role="group">{[...o.paint.layers].reverse().map(l=><div class="layer-entry" key={l.id}><div role="treeitem" aria-selected={active&&l.id===p.layer.id&&p.selectedMask!=='generationMask'} class={`layer-row ${active&&l.id===p.layer.id&&p.selectedMask!=='generationMask'?'is-selected':''} ${drop?.id===l.id?(drop.after?'drop-below':'drop-above'):''}`} key={l.id}
            data-layer={l.id} data-owner={o.key}
            onPointerDown={e=>{if(p.disabled||e.metaKey||e.ctrlKey||e.altKey||e.button!==0||!e.isPrimary||!(e.target as Element).closest('.layer-select')||!paintLayerEditable(o,l))return;const capture=(e.target as Element).closest<HTMLElement>('.layer-select')!;drag.current={key:o.key,id:l.id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,capture,moved:false};try{capture.setPointerCapture(e.pointerId);}catch{}}}
            onPointerMove={e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;d.moved=true;e.preventDefault();
              const row=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('.layer-row[data-layer]');
              if(!row||row.closest('.paint-layer-palette')!==paletteRef.current||row.dataset.owner!==d.key||row.dataset.layer===d.id){d.drop=undefined;setDrop(null);return;}const box=row.getBoundingClientRect();d.drop={id:row.dataset.layer!,after:e.clientY>box.top+box.height/2};setDrop(d.drop);}}
            onPointerUp={e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;drag.current=null;setDrop(null);if(d.moved){e.preventDefault();e.stopPropagation();if(d.drop)p.reorder(d.key,d.id,d.drop.id,d.drop.after);}try{d.capture.releasePointerCapture(e.pointerId);}catch{}}}
            onPointerCancel={()=>{drag.current=null;setDrop(null);}} onLostPointerCapture={()=>{drag.current=null;setDrop(null);}} onContextMenu={e=>p.menu(e,o.key)}>
            {<LayerVisibilityButton label={`${label(o)}・${l.name}を${l.visible?'隠す':'表示'}`} visible={l.visible} disabled={p.disabled} onClick={()=>p.update(o.key,l.id,{visible:!l.visible})}/>}
            <button class="layer-select" data-tool-label={l.name} data-tool-help="クリックで描くレイヤーを選びます。同じグループ内で上下へドラッグして重なり順を変え、ダブルクリックで名前を変えます。⌘/Ctrl＋クリックで中身を選択します。" disabled={p.disabled} onClick={e=>{if(!(active&&l.id===p.layer.id&&p.selectedMask==='mask')||e.metaKey||e.ctrlKey||e.altKey)p.select(o.key,l.id,e.metaKey||e.ctrlKey||e.altKey);}} onDblClick={()=>{p.select(o.key,l.id);if(paintLayerEditable(o,l))setRenaming(l.id);}}><span class="layer-thumbnail">{l.guide&&!l.image?<PaintOriginal owner={o}/>:<Thumbnail owner={o} layer={l} images={p.images}/>}</span><span class="layer-caption"><small>{Math.round(l.opacity*100)}% {l.blend==='multiply'?'乗算':'通常'}{l.tone?.enabled?` · ${l.tone.lpi}線`:''}{l.mask?.enabled?' · マスク':''}</small>{l.kind==='vector'&&<PenTool size={12}/>} {l.name}</span></button>
            {l.mask&&<PaintToolButton class="layer-mask-toggle" label={`${l.name}のマスク編集`} help="オンで赤い範囲を編集し、もう一度押すとトーンを表示します。" aria-pressed={Boolean(active&&l.id===p.layer.id&&p.selectedMask==='mask')} disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,'mask')}><MaskThumbnail owner={o} layer={l}/></PaintToolButton>}
            {l.locked&&<span class="layer-lock-indicator" role="img" aria-label={`${l.name}は固定中`} style={{display:'inline-flex',alignItems:'center',padding:'4px',pointerEvents:'none'}}><LayerLockIcon size={16}/></span>}
            {renaming===l.id&&<input autoFocus aria-label="レイヤー名" value={l.name} onInput={e=>p.update(o.key,l.id,{name:e.currentTarget.value})} onBlur={()=>setRenaming(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')setRenaming(null);}}/>}
          </div>
          {(['generationMask'] as const).map(kind=>l[kind]&&<div class={`layer-row layer-mask-row ${active&&l.id===p.layer.id&&p.selectedMask===kind?'is-selected':''}`} role="treeitem" aria-selected={active&&l.id===p.layer.id&&p.selectedMask===kind}>
            <LayerVisibilityButton label={`${l.name}の生成マスクを${l[kind]!.enabled?'無効':'有効'}にする`} visible={l[kind]!.enabled} disabled={p.disabled||!paintLayerEditable(o,l)} onClick={()=>p.update(o.key,l.id,{[kind]:{...l[kind]!,enabled:!l[kind]!.enabled}})}/>
            <button class="layer-select" disabled={p.disabled} onClick={()=>p.selectMask?.(o.key,l.id,kind)}><Layers size={16}/><span>生成マスク<small>赤・青・緑・黄で領域を指定</small></span></button>
          </div>)}
          </div>)}</div>}
        </div>;
      })}
    </div>
  </div>;
}
