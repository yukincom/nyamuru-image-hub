import { Bot, ChevronDown, ChevronRight, Copy, FilePlus2, FolderPlus, PenTool, Trash2, Type } from 'lucide-preact';
import { useContext, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasElementSelection, ImageAsset, MangaPage, PaintColorMode, PaintLayer, Panel, ScreenText } from '../types';
import { panelBounds, panelShapePoints } from '../lib/canvasGeometry';
import { paintGenerationOwner, paintAnchorIds, paintStackMatches, paintStackTarget, canvasPaintOwnerKey, paintAssetIds, paintScene, type PaintAddPosition, type PaintScene } from '../lib/paintDocument';
import { loadPaintImagesBestEffort, type PaintImages } from '../lib/paintRenderer';
import type { PaintLayerAction } from '../lib/paintSession';
import { ownerItemLocked, panelVisible, panelFrameVisible, panelFrameLocked, panelLocked } from '../lib/panelLayers';
import { PaintLayerControlsContext, paintPaletteScope, usePaintWorkspace } from '../lib/paintWorkspace';
import { overlayFallbackBox } from '../lib/pageCanvas';
import { panelDisplayLabel, textDisplayLabel } from '../lib/displayLabels';
import PaintLayerPalette from './PaintLayerPalette';
import LayerVisibilityButton from './LayerVisibilityButton';
import LayerLockIcon from './LayerLockIcon';
import { artworkLocked } from '../lib/paintLock';
import { PaintToolButton } from './PaintToolHelp';
import { createContext, Fragment, cloneElement, type ComponentChildren, type ComponentProps, type VNode } from 'preact';

interface Props {
  page:MangaPage; activePanel:number; assets:ImageAsset[]; dpi:number; colorMode?:PaintColorMode; disabled:boolean;
  onSelect:(index:number,frame?:boolean)=>void;
  onReorderOwners:(index:number,key:string,target:string,after:boolean,overlay?:boolean)=>void;
  onVisibility:(index:number,frame:boolean)=>void;
  onLock:(index:number,frame?:boolean)=>void;
  onDelete:(index:number)=>void;
  onDeleteBubble:(panel:number,bubble:number,overlay?:boolean)=>void;
  onAddFolder:(index:number,overlay?:boolean,position?:PaintAddPosition)=>void;
  onAdd:(index:number,kind:'raster'|'vector',overlay?:boolean,position?:PaintAddPosition)=>void;
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
  addFolder?:()=>void; addRaster?:()=>void; addVector?:()=>void; addGenerationMask?:()=>void; remove?:()=>void;
  removeLabel?:string; disabled?:boolean;
}
function SelectionControls({addFolder,addRaster,addVector,addGenerationMask,remove,removeLabel='削除',disabled=false}:SelectionControlsProps) {
  const tool=(label:string,help:string,Icon:typeof FolderPlus,action?:()=>void)=><PaintToolButton class="palette-icon" label={label} help={help} disabled={disabled||!action} onClick={action}><Icon size={18}/></PaintToolButton>;
  return <div class="layer-controls selection-layer-controls" role="group" aria-label="レイヤー操作">
    <div class="layer-properties"><select aria-label="レイヤーの合成" disabled value="normal"><option value="normal">通常</option></select>
      <label class="layer-density">濃度<input aria-label="レイヤーの濃度" type="range" min="0" max="1" step="0.01" disabled value="1"/><span>100%</span></label></div>
    <div class="layer-icon-actions">
      {tool('フォルダー追加','選択中の描画範囲へフォルダーを追加します。',FolderPlus,addFolder)}
      {tool('ラスターレイヤー追加','選択中の描画範囲へ空のラスターレイヤーを追加します。',FilePlus2,addRaster)}
      {tool('ベクターレイヤー追加','選択中の描画範囲へベクターレイヤーを追加します。',PenTool,addVector)}
      <PaintToolButton class="palette-icon" label="トーンレイヤー作成" help="描画レイヤーを選択するとトーンレイヤーを作成できます。" disabled><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m12 1 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Zm14 0 4 4-4 4-4-4Zm-7 7 4 4-4 4-4-4Z"/></svg></PaintToolButton>
      {tool('生成マスク化','生成対象フォルダーにマスクを作成します。',Bot,addGenerationMask)}
      {tool('複製','描画レイヤーを選択すると複製できます。',Copy)}
      {tool(removeLabel,remove?'選択中の項目を削除します。':'削除できる項目を選択してください。',Trash2,remove)}
    </div>
  </div>;
}
const PaletteScenes=createContext<Map<string,PaintScene>>(new Map());
const emptyLayer:PaintLayer={id:'',name:'',visible:false,locked:false,opacity:1,blend:'normal',strokes:[]};
function PanelPaintLayers({panel,index,p,overlay=false,frameLayer,selectedOwner,activeLayers,directPanel,nativeTextLayers}:{panel:Panel;index:number;p:Props;overlay?:boolean;frameLayer?:ComponentChildren;selectedOwner?:string;activeLayers?:VNode<ComponentProps<typeof PaintLayerPalette>>;directPanel?:number;nativeTextLayers?:ComponentProps<typeof PaintLayerPalette>['nativeTextLayers']}) {
  const paletteScope=paintPaletteScope(p.page.page,index,overlay),scenes=useContext(PaletteScenes);
  const result=useMemo(()=>{try{const scene=paintScene(panel,p.dpi,p.assets,p.colorMode,overlay?'page':'panel',overlay?p.page.panels:undefined);if(overlay)scene.owners=scene.owners.filter(o=>o.kind!=='background');return {scene};}catch(error){return {error:error instanceof Error?error.message:'画像を読み込めません'};}},[panel,p.dpi,p.assets,p.colorMode,overlay,p.page.panels]);
  const sourceEntries=[...new Set(result.scene?.owners.flatMap(owner=>paintAssetIds(owner.paint))??[])].sort().map(id=>{
    const asset=p.assets.find(item=>item.id===id);
    return [id,asset?.storageId,asset?.byteLength,asset?.sha256,asset?.mediaType,asset?.widthPx,asset?.heightPx] as const;
  });
  const source=JSON.stringify(sourceEntries),signatures=new Map(sourceEntries.map(entry=>[entry[0],JSON.stringify(entry)]));
  type Decoded={source:string;images:PaintImages;signatures:Map<string,string>};
  const [decoded,setDecoded]=useState<Decoded|null>(null),decodedRef=useRef<Decoded|null>(null);
  // A changed layer list keeps compatible thumbnails; only new or changed assets are decoded.
  const reusable=new Map([...(decoded?.images??[])].filter(([id])=>signatures.has(id)&&decoded?.signatures.get(id)===signatures.get(id)));
  const images=decoded?.source===source?decoded.images:reusable.size?reusable:null;
  useEffect(()=>{
    if(!result.scene)return;
    const retained=new Set(reusable.values());decodedRef.current?.images.forEach(image=>{if(!retained.has(image))image.src='';});
    let cancelled=false;
    void loadPaintImagesBestEffort(result.scene.owners.map(o=>o.paint),p.assets,new Map(),reusable).then(value=>{
      if(cancelled){value.forEach((image,id)=>{if(image!==reusable.get(id))image.src='';});return;}
      const retained=new Set(value.values());decodedRef.current?.images.forEach(image=>{if(!retained.has(image))image.src='';});
      const next={source,images:value,signatures};decodedRef.current=next;setDecoded(next);
    });
    return()=>{cancelled=true;};
  },[source]);
  useEffect(()=>()=>{decodedRef.current?.images.forEach(image=>{image.src='';});},[]);
  useLayoutEffect(()=>{const scene=activeLayers?.props.scene??result.scene;if(!scene)return;scenes.set(paletteScope,scene);return()=>{if(scenes.get(paletteScope)===scene)scenes.delete(paletteScope);};},[scenes,paletteScope,activeLayers?.props.scene,result.scene]);
  const destinationScene=(destination:import('../lib/paintDocument').PaintLayerDestination|undefined)=>destination?{...destination,scene:scenes.get(paintPaletteScope(p.page.page,destination.panelIndex,destination.overlay))}:undefined;
  const moves=(scene:PaintScene):Pick<ComponentProps<typeof PaintLayerPalette>,'location'|'moveLayer'|'moveFolder'>=>({
    location:{panelIndex:index,overlay},
    moveLayer:(key,id,target,destination)=>p.onAction(index,{type:'move-layer',key,id,target,destination:destinationScene(destination)},scene,overlay),
    moveFolder:(key,id,target,destination)=>p.onAction(index,{type:'move-folder',key,id,target,destination:destinationScene(destination)},scene,overlay),
  });
  if(activeLayers){
    const borrowed=activeLayers.props.images;
    const compatible=images&&activeLayers.props.scene.owners.every(owner=>paintAssetIds(owner.paint).every(id=>images.has(id)));
    return cloneElement(activeLayers,{...moves(activeLayers.props.scene),frameLayer,paletteScope,directPanel,nativeTextLayers,images:borrowed??(compatible?images:null)});
  }
  if(!result.scene)return <p role="alert">{result.error}</p>;
  const scene=result.scene,owner=scene.owners.find(item=>item.kind===(overlay?'page':'panel'))??scene.owners[0];
  const act=(action:PaintLayerAction)=>p.onAction(index,action,scene,overlay);
  return <PaintLayerPalette {...moves(scene)} frameLayer={frameLayer} paletteScope={paletteScope} directPanel={directPanel} nativeTextLayers={nativeTextLayers} reorderGroup={(key,target,after)=>p.onReorderOwners(index,key,target,after,overlay)} embedded inactive selectedOwner={selectedOwner} canvasSelectionScrollRequest={p.canvasSelectionScrollRequest} onToggleBubble={(bubble,group)=>p.onToggleBubble(index,bubble,overlay,group)} openBackground3d={overlay?undefined:()=>act({type:'background3d',key:'background'})} title="" scene={scene} owner={owner} layer={owner.paint.layers[0]??emptyLayer} images={images} disabled={p.disabled||!panelVisible(panel)}
    selectMask={(key,id,mask)=>act({type:'select',key,id,mask})}
    select={(key,id,contents,native)=>act({type:'select',key,id,contents,native})} update={(key,id,patch)=>act({type:'update',key,id,patch})}
    lockOwner={(key,locked,group)=>act({type:'owner-lock',key,locked,group})}
    toggleGroup={key=>act({type:'toggle',key})} reorder={(key,id,target,after)=>act({type:'reorder',key,id,target,after})} updateFolder={(key,id,patch)=>act({type:'update-folder',key,id,patch})} renameFolder={(key,id,name)=>act({type:'rename-folder',key,id,name})}
    guideVisible={key=>p.guideVisible(key,index,overlay)} toggleGuide={key=>p.toggleGuide(key,index,overlay)}
    onEditText={bubble=>p.onEditText(index,bubble,overlay)} menu={(event,key)=>{event.preventDefault();act({type:'menu',key,x:event.clientX,y:event.clientY});}}
    addFolder={()=>act({type:'add-folder',key:owner.key})} add={()=>{}} addVector={()=>{}} importImage={()=>{}} duplicate={()=>{}} remove={()=>{}}/>;
}
export default function PageLayerPalette(p:Props) {
  const paint=usePaintWorkspace(),palette=useContext(PaintLayerControlsContext);
  const paletteRef=useRef<HTMLDivElement>(null),scenes=useRef(new Map<string,PaintScene>());
  const selection=paint?null:p.selectedElement;
  const selectedOverlay=paint?paint.overlay&&paint.page===p.page.page:selection?.scope==='page_overlay'||selection?.scope==='page';
  const selectedOwner=canvasPaintOwnerKey(p.page,p.activePanel,selection);
  const selectedText=selection?.type==='screen_text'?{panel:selectedOverlay?0:p.activePanel,index:selection.index,overlay:selectedOverlay}:undefined;
  const overlaySource=useMemo<Panel>(()=>{
    const o=p.page.page_overlay;
    return {id:0,shape:{type:'rect',x:0,y:0,...p.page.canvas},bg:0,action:null,
      layer:p.page.layer,screen_text:o?.screen_text,
      images:p.page.images?.filter(image=>image.paintScope==='page'||image.bubbleOriginal),
      figures:o?.figures?.map((f,i)=>({...f,bbox:f.bbox??overlayFallbackBox(p.page.canvas,'figure',i)})),
      bubbles:(o?.bubbles??[]).map((b,i)=>({...b,bbox:b.bbox??overlayFallbackBox(p.page.canvas,'bubble',i)}))};
  },[p.page.page_overlay,p.page.layer,p.page.images,p.page.canvas]);
  const initialPanel=useMemo(()=>p.activePanel,[p.page.page]);
  useEffect(()=>{
    p.page.panels.forEach((_,index)=>{const key=paintPaletteScope(p.page.page,index);if(palette.folded[key]===undefined)palette.setFolded(key,index!==initialPanel);});
  },[p.page.page,p.page.panels.length,initialPanel]);
  const panelFolded=(index:number)=>palette.folded[paintPaletteScope(p.page.page,index)]??index!==initialPanel;
  useEffect(()=>{
    if(p.expanded===false||!selection||(!selectedOwner&&!selectedText))return;
    const frame=requestAnimationFrame(()=>{
      const root=paletteRef.current,scroller=root?.querySelector<HTMLElement>('.page-layer-tree');
      const row=root?.querySelector<HTMLElement>('[data-canvas-selected="true"]');
      if(!scroller||!row||!row.getClientRects().length)return;
      const viewport=scroller.getBoundingClientRect(),bounds=row.getBoundingClientRect();
      if(bounds.top<viewport.top)scroller.scrollTop+=bounds.top-viewport.top;
      else if(bounds.bottom>viewport.bottom)scroller.scrollTop+=bounds.bottom-viewport.bottom;
    });
    return()=>cancelAnimationFrame(frame);
  },[p.page.page,p.activePanel,selection?.type,selection?.index,selection?.scope,p.canvasSelectionScrollRequest,p.expanded,palette.folded]);
  const textLayers=(items:ScreenText[]|undefined,panel:number,overlay=false)=>(items??[]).map((item,index)=>{
    const selected=selectedText?.index===index&&selectedText?.panel===panel&&selectedText?.overlay===overlay;
    const locked=!overlay&&panelLocked(p.page.panels[panel]);
    const label=textDisplayLabel(index+((overlay?p.page.page_overlay:p.page.panels[panel])?.bubbles?.length??0));
    return <div class={`layer-row native-text-layer ${selected?'is-selected':''}`} role="treeitem" aria-selected={selected} data-canvas-selected={selected} data-layer-depth={overlay?0:1} style={{'--layer-indent':overlay?'0px':'16px'}} aria-label={label} key={`text-${index}`}>
      <LayerVisibilityButton label={`${overlay?'前景の':''}${label}を${item.hidden===true?'表示':'隠す'}`} visible={item.hidden!==true} disabled={p.disabled||!p.onToggleText} onClick={()=>p.onToggleText?.(panel,index,overlay)}/>
      <button class="layer-select" aria-pressed={selected} aria-label={`${label}を選択`} data-tool-help="編集可能な文字レイヤーです。クリックするとTの文字設定で編集できます。" disabled={p.disabled||locked} onClick={()=>p.onSelectText?.(panel,index,overlay)}><span class="layer-kind-icon"><Type size={18}/></span><span class="layer-caption"><small>{label} · {item.text_style?.fontSize??12}pt</small><span>{item.text||'（入力中）'}</span></span></button>
    </div>;
  });
  const eye=(label:string,visible:boolean,action:()=>void)=><LayerVisibilityButton label={label} visible={visible} disabled={p.disabled} onClick={action}/>;
  const selected=p.page.panels[p.activePanel];
  const closedPanel=!selectedOverlay&&Boolean(selected&&(panelFolded(p.activePanel)||panelLocked(selected)||!panelVisible(selected)||selection?.type==='panel_frame'&&panelFrameLocked(selected)));
  const addOutside=!selection||selectedOverlay||closedPanel;
  const outsidePosition:PaintAddPosition|undefined=addOutside&&!selectedOverlay&&selected?{stack:{beforePanel:`panel-${selected.id}`}}:undefined;
  const panelEditable=addOutside?!p.page.layer?.directLocked:Boolean(selected&&panelVisible(selected)&&!panelLocked(selected)&&!selected.layer?.directLocked);
  const panelControls=<SelectionControls disabled={p.disabled}
    addFolder={panelEditable?()=>p.onAddFolder(p.activePanel,addOutside,outsidePosition):undefined}
    addRaster={panelEditable?()=>p.onAdd(p.activePanel,'raster',addOutside,outsidePosition):undefined}
    addVector={panelEditable?()=>p.onAdd(p.activePanel,'vector',addOutside,outsidePosition):undefined}
    remove={selected&&!panelLocked(selected)?()=>p.onDelete(p.activePanel):undefined}
    removeLabel={selected?`${panelDisplayLabel(selected.id)}を削除`:'削除'}/>;
  const bubbleTarget=selection?.type==='bubble'&&selectedOwner?{panel:selectedOverlay?0:p.activePanel,index:selection.index,overlay:selectedOverlay}:null;
  const bubbleTargetItem=bubbleTarget?(bubbleTarget.overlay?p.page.page_overlay?.bubbles?.[bubbleTarget.index]:p.page.panels[bubbleTarget.panel]?.bubbles[bubbleTarget.index]):undefined;
  const bubbleTargetLocked=bubbleTarget?Boolean((bubbleTargetItem&&ownerItemLocked(bubbleTargetItem))||artworkLocked(bubbleTargetItem?.paint_overlay)||(!bubbleTarget.overlay&&panelLocked(p.page.panels[bubbleTarget.panel]))):false;
  const addSelected=(kind:'raster'|'vector'|'folder')=>{
    if(closedPanel){if(kind==='folder')p.onAddFolder(p.activePanel,true,outsidePosition);else p.onAdd(p.activePanel,kind,true,outsidePosition);return;}
    const overlay=Boolean(selectedOverlay),scene=paintScene(overlay?overlaySource:selected,p.dpi,p.assets,p.colorMode,overlay?'page':'panel',overlay?p.page.panels:undefined);
    if(overlay)scene.owners=scene.owners.filter(item=>item.kind!=='background');
    const owner=scene.owners.find(item=>item.key===selectedOwner),scope=paintPaletteScope(p.page.page,p.activePanel,overlay);
    const native=selection?.part==='native';
    const outside=owner&&(owner.locked||owner.inheritedLocked||(palette.folded[`${scope}/owner/${owner.key}`]??owner.kind==='bubble')||owner.parentKey&&(palette.folded[`${scope}/owner/${owner.parentKey}`]??true));
    const position:PaintAddPosition=selectedText?{stack:{below:`screen-text-${selectedText.index}`}}:outside?{stack:{below:owner!.parentKey&&(owner!.inheritedLocked||(palette.folded[`${scope}/owner/${owner!.parentKey}`]??true))?owner!.parentKey:owner!.key}}:{aboveNative:owner?.kind==='bubble'&&!native};
    const key=owner?.key??(overlay?'page':'panel');
    p.onAction(p.activePanel,kind==='folder'?{type:'add-folder',key,position}:{type:'add',key,kind,position},scene,overlay);
  };
  const addControls={addFolder:()=>addSelected('folder'),addRaster:()=>addSelected('raster'),addVector:()=>addSelected('vector')};
  const addSelectedGenerationMask=selectedOwner&&!closedPanel?()=>{
    const overlay=Boolean(selectedOverlay),scene=paintScene(overlay?overlaySource:selected,p.dpi,p.assets,p.colorMode,overlay?'page':'panel',overlay?p.page.panels:undefined);
    const owner=paintGenerationOwner(scene,selectedOwner);if(!owner)return;
    p.onAction(p.activePanel,{type:'generation-mask',key:owner.key,select:true},scene,overlay);
  }:undefined;
  const ownerControls=selectedOwner?<SelectionControls {...addControls} addGenerationMask={addSelectedGenerationMask} disabled={p.disabled} remove={bubbleTarget&&!bubbleTargetLocked?()=>p.onDeleteBubble(bubbleTarget.panel,bubbleTarget.index,bubbleTarget.overlay):undefined} removeLabel={bubbleTarget?`${textDisplayLabel(bubbleTarget.index)}を削除`:'削除'}/>:null;
  const textTarget=selectedText;
  const textControls=textTarget?<SelectionControls {...addControls} disabled={p.disabled} remove={p.onDeleteText&&(textTarget.overlay||!panelLocked(p.page.panels[textTarget.panel]))?()=>p.onDeleteText?.(textTarget.panel,textTarget.index,textTarget.overlay):undefined} removeLabel={`${textDisplayLabel(textTarget.index+((textTarget.overlay?p.page.page_overlay:p.page.panels[textTarget.panel])?.bubbles?.length??0))}を削除`}/>:null;
  const pageAnchors=paint?.overlay?paint.scene.anchorIds:paintAnchorIds(overlaySource,p.page.panels);
  const renderPageLayers=(directPanel?:number)=>{
    const matches=(stack:import('../types').PaintStackPosition|undefined)=>directPanel===undefined
      ?!paintStackTarget(stack,pageAnchors)?.startsWith('panel-')
      :paintStackMatches(stack,{beforePanel:`panel-${directPanel}`},pageAnchors);
    const native=directPanel===undefined&&Boolean(overlaySource.figures?.length||overlaySource.bubbles.length||overlaySource.screen_text?.length||p.page.images?.some(image=>image.bubbleOriginal));
    const saved=p.page.images?.some(image=>image.paintScope==='page'&&matches(image.paintStack));
    const live=paint?.overlay&&paint.page===p.page.page&&paint.scene.owners.some(owner=>owner.kind==='page'&&matches(owner.stack)&&(owner.paint.layers.length||owner.paint.folders?.length));
    if(!native&&!saved&&!live)return null;
    return <div class="page-panel-outside-layers" data-before-panel={directPanel}>
      <PanelPaintLayers panel={overlaySource} index={p.activePanel} p={p} overlay directPanel={directPanel} nativeTextLayers={textLayers(p.page.page_overlay?.screen_text,0,true).map((node,index)=>({key:`screen-text-${index}`,node}))} selectedOwner={selectedOverlay?selectedOwner:undefined} activeLayers={paint?.overlay&&paint.page===p.page.page?paint.layers as VNode<ComponentProps<typeof PaintLayerPalette>>:undefined}/>
    </div>;
  };
  return <PaletteScenes.Provider value={scenes.current}><div class="page-layer-palette" ref={paletteRef}><h3>レイヤー</h3>{paint&&!closedPanel?palette.controls:textControls??ownerControls??panelControls}
    <div class="page-layer-tree" role="tree" aria-label="ページのレイヤー">
      <div class="page-layer-root-drop" data-layer-depth="0" data-layer-drop="root" data-owner="page" data-edge="top" data-paint-panel={p.activePanel} data-paint-overlay="true" data-drop-locked={p.page.layer?.directLocked===true}/>
      {renderPageLayers()}
      {p.page.panels.map((panel,index)=>{
        const active=paint?.page===p.page.page&&!paint.overlay&&paint.panelIndex===index;
        const folderKey=paintPaletteScope(p.page.page,index),collapsed=panelFolded(index),visible=panelVisible(panel);
        const title=panelDisplayLabel(panel.id);
        const panelSelected=paint?active:!selectedOverlay&&index===p.activePanel;
        const frameSelected=selection?.type==='panel_frame'&&selection.index===index;
        const frameLayer=<div class={`layer-row panel-frame-layer ${frameSelected?'is-selected':''}`} data-layer-depth="1" style={{'--layer-indent':'16px'}} data-layer-drop="root" data-owner="panel" data-edge="top" data-paint-panel={index} data-paint-overlay="false" data-drop-locked={panelLocked(panel)||panel.layer?.directLocked===true||!visible} role="treeitem" aria-selected={frameSelected}>
          {eye(`${title}の枠線を${panelFrameVisible(panel)?'隠す':'表示'}`,panelFrameVisible(panel),()=>p.onVisibility(index,true))}
          <button class="layer-select" aria-label={`${title}の枠を選択`} data-tool-help="コマ枠を紙面で選択し、辺や頂点を動かせます。枠線を隠しても絵のクリップ範囲は変わりません。" disabled={p.disabled} onClick={()=>p.onSelect(index,true)}><PanelThumbnail panel={panel} frame/><span>コマ枠</span></button>
          <button type="button" class={`palette-icon layer-row-lock ${panelFrameLocked(panel)?'is-locked':'is-unlocked'} ${panelLocked(panel)?'is-inherited':''}`} aria-label={panelLocked(panel)?`${title}の枠は親フォルダーで固定中`:panelFrameLocked(panel)?`${title}の枠だけの固定を解除`:`${title}の枠だけを固定`} aria-pressed={panelFrameLocked(panel)||panelLocked(panel)} disabled={p.disabled||panelLocked(panel)} onClick={()=>p.onLock(index,true)}><LayerLockIcon size={16} locked={panelFrameLocked(panel)||panelLocked(panel)}/></button>
        </div>;
        return <Fragment key={`${p.page.page}-${panel.id}`}>
          {renderPageLayers(panel.id)}
          <div class={`panel-layer-group ${visible?'':'is-hidden'}`} role="treeitem" aria-expanded={!collapsed} aria-label={title}>
          <div class={`panel-layer-heading ${panelSelected?'is-selected':''}`} data-layer-depth="0" data-layer-drop="panel" data-owner="panel" data-panel-anchor={`panel-${panel.id}`} data-paint-panel={index} data-paint-overlay="false" data-drop-locked={panelLocked(panel)||panel.layer?.directLocked===true||!visible} aria-selected={panelSelected}>
            {eye(`${title}を${visible?'隠す':'表示'}`,visible,()=>p.onVisibility(index,false))}
            <button class="palette-icon layer-folder-toggle" aria-label={`${title}を${collapsed?'展開':'折りたたむ'}`} aria-expanded={!collapsed} onClick={()=>palette.setFolded(folderKey,!collapsed)}>{collapsed?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="panel-layer-select" aria-label={`${title}を選択`} data-tool-help="このコマを紙面で選択します。中のレイヤーとコマ枠をまとめるフォルダです。" onClick={()=>p.onSelect(index)} disabled={p.disabled}><PanelThumbnail panel={panel}/><span>{title}</span></button>
            <button type="button" class={`palette-icon layer-row-lock ${panelLocked(panel)?'is-locked':'is-unlocked'}`} aria-label={panelLocked(panel)?`${title}全体の固定を解除`:`${title}全体を固定`} aria-pressed={panelLocked(panel)} disabled={p.disabled} onClick={event=>{event.stopPropagation();p.onLock(index);}}><LayerLockIcon size={16} locked={panelLocked(panel)}/></button>
          </div>
          <div class="panel-layer-children" role="group" hidden={collapsed}>
            <PanelPaintLayers panel={panel} index={index} p={p} nativeTextLayers={textLayers(panel.screen_text,index).map((node,i)=>({key:`screen-text-${i}`,node}))} frameLayer={frameLayer} selectedOwner={!selectedOverlay&&index===p.activePanel?selectedOwner:undefined} activeLayers={active?paint.layers as VNode<ComponentProps<typeof PaintLayerPalette>>:undefined}/>
          </div>
        </div></Fragment>;
      })}
    </div>
  </div></PaletteScenes.Provider>;
}
