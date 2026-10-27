import { Bot, ChevronDown, ChevronRight, Copy, FilePlus2, FolderOpen, FolderPlus, PenTool, Trash2, Type } from 'lucide-preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasElementSelection, ImageAsset, MangaPage, PaintColorMode, PaintLayer, Panel, ScreenText } from '../types';
import { panelBounds, panelShapePoints } from '../lib/canvasGeometry';
import { canvasPaintOwnerKey, paintAssetIds, paintScene, type PaintScene } from '../lib/paintDocument';
import { loadPaintImagesBestEffort, type PaintImages } from '../lib/paintRenderer';
import type { PaintLayerAction } from '../lib/paintSession';
import { ownerItemLocked, panelVisible, panelFrameVisible, panelFrameLocked, panelLocked } from '../lib/panelLayers';
import { PaintLayerControlsContext, usePaintWorkspace } from '../lib/paintWorkspace';
import { overlayFallbackBox } from '../lib/pageCanvas';
import { panelDisplayLabel } from '../lib/displayLabels';
import PaintLayerPalette from './PaintLayerPalette';
import LayerVisibilityButton from './LayerVisibilityButton';
import LayerLockIcon from './LayerLockIcon';
import { artworkLocked } from '../lib/paintLock';
import { PaintToolButton } from './PaintToolHelp';
import { cloneElement, type ComponentChildren, type ComponentProps, type VNode } from 'preact';

interface Props {
  page:MangaPage; activePanel:number; assets:ImageAsset[]; dpi:number; colorMode?:PaintColorMode; disabled:boolean;
  onSelect:(index:number,frame?:boolean)=>void;
  onReorderOwners:(index:number,key:string,target:string,after:boolean)=>void;
  onVisibility:(index:number,frame:boolean)=>void;
  onLock:(index:number,frame?:boolean)=>void;
  onDelete:(index:number)=>void;
  onDeleteBubble:(panel:number,bubble:number,overlay?:boolean)=>void;
  onAddFolder:(index:number,overlay?:boolean)=>void;
  onAdd:(index:number,kind:'raster'|'vector',overlay?:boolean)=>void;
  onAction:(index:number,action:PaintLayerAction,scene:PaintScene,overlay?:boolean)=>void;
  onEditText:(panel:number,bubble:number,overlay?:boolean)=>void;
  onSelectText?:(panel:number,index:number,overlay:boolean)=>void;
  onToggleText?:(panel:number,index:number,overlay:boolean)=>void;
  onDeleteText?:(panel:number,index:number,overlay:boolean)=>void;
  selectedElement?:CanvasElementSelection|null; canvasSelectionScrollRequest?:number; expanded?:boolean;
  onToggleBubble:(panel:number,bubble:number,overlay?:boolean,group?:boolean)=>void;
  guideVisible:(key:string,index:number,overlay?:boolean)=>boolean;
  toggleGuide:(key:string,index:number,overlay?:boolean)=>void;
}
function PanelThumbnail({panel,frame=false}:{panel:Panel;frame?:boolean}) {
  const b=panelBounds(panel),pad=Math.max(b.w,b.h)*.1;
  return <span class={`layer-thumbnail panel-layer-thumbnail ${frame?'is-frame':''}`}><svg viewBox={`${b.x-pad} ${b.y-pad} ${b.w+pad*2} ${b.h+pad*2}`} aria-hidden="true"><polygon points={panelShapePoints(panel).map(p=>p.join(',')).join(' ')} fill={frame?'white':'currentColor'} stroke="currentColor" stroke-width={Math.max(b.w,b.h)*.035}/></svg></span>;
}
interface SelectionControlsProps {
  addFolder?:()=>void; addRaster?:()=>void; addVector?:()=>void; remove?:()=>void;
  removeLabel?:string; disabled?:boolean;
}
function SelectionControls({addFolder,addRaster,addVector,remove,removeLabel='削除',disabled=false}:SelectionControlsProps) {
  const tool=(label:string,help:string,Icon:typeof FolderPlus,action?:()=>void)=><PaintToolButton class="palette-icon" label={label} help={help} disabled={disabled||!action} onClick={action}><Icon size={18}/></PaintToolButton>;
  return <div class="layer-controls selection-layer-controls" role="group" aria-label="レイヤー操作">
    <div class="layer-properties"><select aria-label="レイヤーの合成" disabled value="normal"><option value="normal">通常</option></select>
      <label class="layer-density">濃度<input aria-label="レイヤーの濃度" type="range" min="0" max="1" step="0.01" disabled value="1"/><span>100%</span></label></div>
    <div class="layer-icon-actions">
      {tool('フォルダー追加','選択中の描画範囲へフォルダーを追加します。',FolderPlus,addFolder)}
      {tool('ラスターレイヤー追加','選択中の描画範囲へ空のラスターレイヤーを追加します。',FilePlus2,addRaster)}
      {tool('ベクターレイヤー追加','選択中の描画範囲へベクターレイヤーを追加します。',PenTool,addVector)}
      <PaintToolButton class="palette-icon" label="トーンレイヤー作成" help="描画レイヤーを選択するとトーンレイヤーを作成できます。" disabled><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m12 1 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Zm14 0 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Z"/></svg></PaintToolButton>
      {tool('生成マスク化','描画レイヤーを選択すると生成用マスクを作成できます。',Bot)}
      {tool('複製','描画レイヤーを選択すると複製できます。',Copy)}
      {tool(removeLabel,remove?'選択中の項目を削除します。':'削除できる項目を選択してください。',Trash2,remove)}
    </div>
  </div>;
}
const emptyLayer:PaintLayer={id:'',name:'',visible:false,locked:false,opacity:1,blend:'normal',strokes:[]};
function PanelPaintLayers({panel,index,p,overlay=false,frameLayer,selectedOwner,activeLayers}:{panel:Panel;index:number;p:Props;overlay?:boolean;frameLayer?:ComponentChildren;selectedOwner?:string;activeLayers?:VNode<ComponentProps<typeof PaintLayerPalette>>}) {
  const result=useMemo(()=>{try{const scene=paintScene(panel,p.dpi,p.assets,p.colorMode,overlay?'page':'panel');if(overlay)scene.owners=scene.owners.filter(o=>o.kind!=='background');return {scene};}catch(error){return {error:error instanceof Error?error.message:'画像を読み込めません'};}},[panel,p.dpi,p.assets,p.colorMode,overlay]);
  const source=JSON.stringify([...new Set(result.scene?.owners.flatMap(owner=>paintAssetIds(owner.paint))??[])].sort().map(id=>{
    const asset=p.assets.find(item=>item.id===id);
    return [id,asset?.storageId,asset?.byteLength,asset?.sha256,asset?.mediaType,asset?.widthPx,asset?.heightPx];
  }));
  const [decoded,setDecoded]=useState<{source:string;images:PaintImages}|null>(null);
  // Effects run after child layout effects: never pair a new scene with the previous image map.
  const images=decoded?.source===source?decoded.images:null;
  useEffect(()=>{
    setDecoded(null);if(!result.scene)return;
    let cancelled=false,map:PaintImages|null=null;
    void loadPaintImagesBestEffort(result.scene.owners.map(o=>o.paint),p.assets).then(value=>{if(cancelled)value.forEach(i=>{i.src='';});else{map=value;setDecoded({source,images:value});}});
    return()=>{cancelled=true;map?.forEach(i=>{i.src='';});};
  },[source]);
  if(activeLayers){
    const borrowed=activeLayers.props.images;
    const compatible=images&&activeLayers.props.scene.owners.every(owner=>paintAssetIds(owner.paint).every(id=>images.has(id)));
    return cloneElement(activeLayers,{frameLayer,images:borrowed??(compatible?images:null)});
  }
  if(!result.scene)return <p role="alert">{result.error}</p>;
  const scene=result.scene,owner=scene.owners.find(item=>item.kind===(overlay?'page':'panel'))??scene.owners[0];
  const act=(action:PaintLayerAction)=>p.onAction(index,action,scene,overlay);
  return <PaintLayerPalette frameLayer={frameLayer} reorderGroup={overlay?undefined:(key,target,after)=>p.onReorderOwners(index,key,target,after)} embedded inactive selectedOwner={selectedOwner} canvasSelectionScrollRequest={p.canvasSelectionScrollRequest} onToggleBubble={(bubble,group)=>p.onToggleBubble(index,bubble,overlay,group)} openBackground3d={overlay?undefined:()=>act({type:'background3d',key:'background'})} title="" scene={scene} owner={owner} layer={owner.paint.layers[0]??emptyLayer} images={images} disabled={p.disabled||!panelVisible(panel)}
    selectMask={(key,id,mask)=>act({type:'select',key,id,mask})}
    select={(key,id,contents)=>act({type:'select',key,id,contents})} update={(key,id,patch)=>act({type:'update',key,id,patch})}
    lockOwner={(key,locked,group)=>act({type:'owner-lock',key,locked,group})}
    toggleGroup={key=>act({type:'toggle',key})} reorder={(key,id,target,after)=>act({type:'reorder',key,id,target,after})} moveLayer={(key,id,target)=>act({type:'move-layer',key,id,target})} moveFolder={(key,id,target)=>act({type:'move-folder',key,id,target})} updateFolder={(key,id,patch)=>act({type:'update-folder',key,id,patch})} renameFolder={(key,id,name)=>act({type:'rename-folder',key,id,name})}
    guideVisible={key=>p.guideVisible(key,index,overlay)} toggleGuide={key=>p.toggleGuide(key,index,overlay)}
    onEditText={bubble=>p.onEditText(index,bubble,overlay)} menu={(event,key)=>{event.preventDefault();act({type:'menu',key,x:event.clientX,y:event.clientY});}}
    addFolder={()=>act({type:'add-folder',key:owner.key})} add={()=>{}} addVector={()=>{}} importImage={()=>{}} duplicate={()=>{}} remove={()=>{}}/>;
}
export default function PageLayerPalette(p:Props) {
  const paint=usePaintWorkspace(),controls=useContext(PaintLayerControlsContext);
  const paletteRef=useRef<HTMLDivElement>(null);
  const selection=paint?null:p.selectedElement;
  const selectedOverlay=paint?paint.overlay&&paint.page===p.page.page:selection?.scope==='page_overlay'||selection?.scope==='page';
  const selectedOwner=canvasPaintOwnerKey(p.page,p.activePanel,selection);
  const selectedText=selection?.type==='screen_text'?{panel:selectedOverlay?0:p.activePanel,index:selection.index,overlay:selectedOverlay}:undefined;
  const overlaySource=useMemo<Panel>(()=>{
    const o=p.page.page_overlay;
    return {id:0,shape:{type:'rect',x:0,y:0,...p.page.canvas},bg:0,action:null,
      layer:p.page.layer?.directLocked?{directLocked:true}:undefined,
      images:p.page.images?.filter(image=>image.paintScope==='page'||image.bubbleOriginal),
      figures:o?.figures?.map((f,i)=>({...f,bbox:f.bbox??overlayFallbackBox(p.page.canvas,'figure',i)})),
      bubbles:(o?.bubbles??[]).map((b,i)=>({...b,bbox:b.bbox??overlayFallbackBox(p.page.canvas,'bubble',i)}))};
  },[p.page.page_overlay,p.page.images,p.page.canvas]);
  const [folded,setFolded]=useState<Record<string,boolean>>(()=>Object.fromEntries(p.page.panels.map((panel,index)=>[`${p.page.page}-${panel.id}`,index!==p.activePanel])));
  useEffect(()=>{
    if(p.expanded===false||!selection||(!selectedOwner&&!selectedText))return;
    const frame=requestAnimationFrame(()=>{
      const root=paletteRef.current,scroller=root?.closest<HTMLElement>('.dock-content');
      const row=root?.querySelector<HTMLElement>('[data-canvas-selected="true"]');
      if(!scroller||!row||!row.getClientRects().length)return;
      const viewport=scroller.getBoundingClientRect(),bounds=row.getBoundingClientRect();
      if(bounds.top<viewport.top)scroller.scrollTop+=bounds.top-viewport.top;
      else if(bounds.bottom>viewport.bottom)scroller.scrollTop+=bounds.bottom-viewport.bottom;
    });
    return()=>cancelAnimationFrame(frame);
  },[p.page.page,p.activePanel,selection?.type,selection?.index,selection?.scope,p.canvasSelectionScrollRequest,p.expanded,folded]);
  const textLayers=(items:ScreenText[]|undefined,panel:number,overlay=false)=>(items??[]).map((item,index)=>{
    const selected=selectedText?.index===index&&selectedText?.panel===panel&&selectedText?.overlay===overlay;
    const locked=!overlay&&panelLocked(p.page.panels[panel]);
    return <div class={`layer-row native-text-layer ${selected?'is-selected':''}`} role="treeitem" aria-selected={selected} data-canvas-selected={selected} aria-label={`文字 ${index+1}`} key={`text-${index}`}>
      <LayerVisibilityButton label={`${overlay?'前景の':''}文字 ${index+1}を${item.hidden===true?'表示':'隠す'}`} visible={item.hidden!==true} disabled={p.disabled||!p.onToggleText} onClick={()=>p.onToggleText?.(panel,index,overlay)}/>
      <button class="layer-select" aria-pressed={selected} aria-label={`文字 ${index+1}を選択`} data-tool-help="編集可能な文字レイヤーです。クリックするとTの文字設定で編集できます。" disabled={p.disabled||locked} onClick={()=>p.onSelectText?.(panel,index,overlay)}><span class="layer-thumbnail text-thumbnail"><Type size={20}/></span><span class="layer-caption"><small>文字 {index+1} · {item.text_style?.fontSize??12}pt</small><span>{item.text||'（入力中）'}</span></span></button>
    </div>;
  });
  const eye=(label:string,visible:boolean,action:()=>void)=><LayerVisibilityButton label={label} visible={visible} disabled={p.disabled} onClick={action}/>;
  const selected=p.page.panels[p.activePanel];
  const panelEditable=Boolean(selected&&panelVisible(selected)&&!panelLocked(selected)&&!selected.layer?.directLocked);
  const panelControls=<SelectionControls disabled={p.disabled}
    addFolder={panelEditable?()=>p.onAddFolder(p.activePanel):undefined}
    addRaster={panelEditable?()=>p.onAdd(p.activePanel,'raster'):undefined}
    addVector={panelEditable?()=>p.onAdd(p.activePanel,'vector'):undefined}
    remove={selected&&!panelLocked(selected)?()=>p.onDelete(p.activePanel):undefined}
    removeLabel={selected?`${panelDisplayLabel(selected.id)}を削除`:'削除'}/>;
  const bubbleTarget=selection?.type==='bubble'&&selectedOwner?{panel:selectedOverlay?0:p.activePanel,index:selection.index,overlay:selectedOverlay}:null;
  const bubbleTargetItem=bubbleTarget?(bubbleTarget.overlay?p.page.page_overlay?.bubbles?.[bubbleTarget.index]:p.page.panels[bubbleTarget.panel]?.bubbles[bubbleTarget.index]):undefined;
  const bubbleTargetLocked=bubbleTarget?Boolean((bubbleTargetItem&&ownerItemLocked(bubbleTargetItem))||artworkLocked(bubbleTargetItem?.paint_overlay)||(!bubbleTarget.overlay&&panelLocked(p.page.panels[bubbleTarget.panel]))):false;
  const bubbleControls=bubbleTarget?<SelectionControls disabled={p.disabled} remove={bubbleTargetLocked?undefined:()=>p.onDeleteBubble(bubbleTarget.panel,bubbleTarget.index,bubbleTarget.overlay)} removeLabel={`吹き出し ${bubbleTarget.index+1}を削除`}/>:null;
  const textTarget=selectedText;
  const textControls=textTarget?<SelectionControls disabled={p.disabled} remove={p.onDeleteText&&(textTarget.overlay||!panelLocked(p.page.panels[textTarget.panel]))?()=>p.onDeleteText?.(textTarget.panel,textTarget.index,textTarget.overlay):undefined} removeLabel={`文字 ${textTarget.index+1}を削除`}/>:null;
  const activePageOwner=paint?.overlay&&paint.page===p.page.page?paint.scene.owners.find(owner=>owner.kind==='page'):undefined;
  const hasPageDirect=Boolean(p.page.page_overlay?.figures?.length||p.page.page_overlay?.bubbles?.length||p.page.page_overlay?.screen_text?.length||p.page.images?.some(image=>image.paintScope==='page'||image.bubbleOriginal)||activePageOwner?.paint.layers.length||activePageOwner?.paint.folders?.length);
  const pageDirectAdd=!hasPageDirect&&<div class="page-direct-create-actions" role="group" aria-label="コマ外レイヤーを追加">
    <span>コマ外へ追加</span><button class="palette-icon" aria-label="コマ外へフォルダーを追加" disabled={p.disabled} onClick={()=>p.onAddFolder(p.activePanel,true)}><FolderPlus size={18}/></button><button class="palette-icon" aria-label="コマ外へラスターレイヤーを追加" disabled={p.disabled} onClick={()=>p.onAdd(p.activePanel,'raster',true)}><FilePlus2 size={18}/></button><button class="palette-icon" aria-label="コマ外へベクターレイヤーを追加" disabled={p.disabled} onClick={()=>p.onAdd(p.activePanel,'vector',true)}><PenTool size={18}/></button>
  </div>;
  return <div class="page-layer-palette" ref={paletteRef}><h3>レイヤー</h3>{paint?(controls??<SelectionControls disabled/>):textControls??bubbleControls??panelControls}{pageDirectAdd}
    <div class="page-layer-tree" role="tree" aria-label="ページのレイヤー">
      {hasPageDirect&&<div class="panel-layer-group page-direct-layer-group">
        <div class={`panel-layer-heading ${selectedOverlay?'is-selected':''}`} aria-selected={Boolean(selectedOverlay)}>
          <span class="palette-icon" aria-hidden="true"><FolderOpen size={17}/></span>
          <span class="panel-layer-select page-direct-layer-label"><span>コマ外</span></span>
          <div class="page-direct-layer-actions">
            <button class="palette-icon" aria-label="コマ外へフォルダーを追加" data-tool-help="どのコマにも属さないレイヤーを整理するフォルダーを追加します。" disabled={p.disabled||p.page.layer?.directLocked} onClick={()=>p.onAddFolder(p.activePanel,true)}><FolderPlus size={18}/></button>
            <button class="palette-icon" aria-label="コマ外へラスターレイヤーを追加" data-tool-help="どのコマにも属さず、余白やコマ間にも描けるラスターレイヤーを追加します。" disabled={p.disabled||p.page.layer?.directLocked} onClick={()=>p.onAdd(p.activePanel,'raster',true)}><FilePlus2 size={18}/></button>
            <button class="palette-icon" aria-label="コマ外へベクターレイヤーを追加" data-tool-help="どのコマにも属さず、余白やコマ間にも描けるベクターレイヤーを追加します。" disabled={p.disabled||p.page.layer?.directLocked} onClick={()=>p.onAdd(p.activePanel,'vector',true)}><PenTool size={18}/></button>
          </div>
        </div>
        <div class="panel-layer-children" role="group">
          <PanelPaintLayers panel={overlaySource} index={p.activePanel} p={p} overlay selectedOwner={selectedOverlay?selectedOwner:undefined} activeLayers={paint?.overlay&&paint.page===p.page.page?paint.layers as VNode<ComponentProps<typeof PaintLayerPalette>>:undefined}/>
          {textLayers(p.page.page_overlay?.screen_text,0,true)}
        </div>
      </div>}
      {p.page.panels.map((panel,index)=>{
        const active=paint?.page===p.page.page&&!paint.overlay&&paint.panelIndex===index;
        const folderKey=`${p.page.page}-${panel.id}`,collapsed=folded[folderKey]??true,visible=panelVisible(panel);
        const title=panelDisplayLabel(panel.id);
        const panelSelected=paint?active:!selectedOverlay&&index===p.activePanel;
        const frameSelected=selection?.type==='panel_frame'&&selection.index===index;
        const frameLayer=<div class={`layer-row panel-frame-layer ${frameSelected?'is-selected':''}`} role="treeitem" aria-selected={frameSelected}>
          {eye(`${title}の枠線を${panelFrameVisible(panel)?'隠す':'表示'}`,panelFrameVisible(panel),()=>p.onVisibility(index,true))}
          <button class="layer-select" aria-label={`${title}の枠を選択`} data-tool-help="コマ枠を紙面で選択し、辺や頂点を動かせます。枠線を隠しても絵のクリップ範囲は変わりません。" disabled={p.disabled} onClick={()=>p.onSelect(index,true)}><PanelThumbnail panel={panel} frame/><span>コマ枠</span></button>
          <button type="button" class={`palette-icon layer-row-lock ${panelFrameLocked(panel)?'is-locked':'is-unlocked'} ${panelLocked(panel)?'is-inherited':''}`} aria-label={panelLocked(panel)?`${title}の枠は親フォルダーで固定中`:panelFrameLocked(panel)?`${title}の枠だけの固定を解除`:`${title}の枠だけを固定`} aria-pressed={panelFrameLocked(panel)||panelLocked(panel)} disabled={p.disabled||panelLocked(panel)} onClick={()=>p.onLock(index,true)}><LayerLockIcon size={16} locked={panelFrameLocked(panel)||panelLocked(panel)}/></button>
        </div>;
        return <div class={`panel-layer-group ${visible?'':'is-hidden'}`} key={`${p.page.page}-${panel.id}`} role="treeitem" aria-expanded={!collapsed} aria-label={title}>
          <div class={`panel-layer-heading ${panelSelected?'is-selected':''}`} aria-selected={panelSelected}>
            {eye(`${title}を${visible?'隠す':'表示'}`,visible,()=>p.onVisibility(index,false))}
            <button class="palette-icon layer-folder-toggle" aria-label={`${title}を${collapsed?'展開':'折りたたむ'}`} aria-expanded={!collapsed} onClick={()=>setFolded({...folded,[folderKey]:!collapsed})}>{collapsed?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="panel-layer-select" aria-label={`${title}を選択`} data-tool-help="このコマを紙面で選択します。中のレイヤーとコマ枠をまとめるフォルダです。" onClick={()=>p.onSelect(index)} disabled={p.disabled}><PanelThumbnail panel={panel}/><span>{title}</span></button>
            <button type="button" class={`palette-icon layer-row-lock ${panelLocked(panel)?'is-locked':'is-unlocked'}`} aria-label={panelLocked(panel)?`${title}全体の固定を解除`:`${title}全体を固定`} aria-pressed={panelLocked(panel)} disabled={p.disabled} onClick={event=>{event.stopPropagation();p.onLock(index);}}><LayerLockIcon size={16} locked={panelLocked(panel)}/></button>
          </div>
          <div class="panel-layer-children" role="group" hidden={collapsed}>
            <PanelPaintLayers panel={panel} index={index} p={p} frameLayer={frameLayer} selectedOwner={!selectedOverlay&&index===p.activePanel?selectedOwner:undefined} activeLayers={active?paint.layers as VNode<ComponentProps<typeof PaintLayerPalette>>:undefined}/>
            {textLayers(panel.screen_text,index)}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
