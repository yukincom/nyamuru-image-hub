import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { ImageAsset, MangaPage, PaintColorMode, Panel } from '../types';
import { panelBounds, panelShapePoints } from '../lib/canvasGeometry';
import { paintScene, type PaintScene } from '../lib/paintDocument';
import { loadPaintImages, type PaintImages } from '../lib/paintRenderer';
import type { PaintLayerAction } from '../lib/paintSession';
import { panelVisible, panelFrameVisible } from '../lib/panelLayers';
import { PaintLayerControlsContext, usePaintWorkspace } from '../lib/paintWorkspace';
import { overlayFallbackBox } from '../lib/pageCanvas';
import { panelDisplayLabel } from '../lib/displayLabels';
import PaintLayerPalette from './PaintLayerPalette';
import LayerVisibilityButton from './LayerVisibilityButton';

interface Props {
  page:MangaPage; activePanel:number; assets:ImageAsset[]; dpi:number; colorMode?:PaintColorMode; disabled:boolean;
  onSelect:(index:number)=>void;
  onReorderOwners:(index:number,key:string,target:string,after:boolean)=>void;
  onVisibility:(index:number,frame:boolean)=>void;
  onAction:(index:number,action:PaintLayerAction,scene:PaintScene,overlay?:boolean)=>void;
  onEditText:(panel:number,bubble:number,overlay?:boolean)=>void;
  selectedBubble?:number; selectedOverlayBubble?:number; onToggleBubble:(panel:number,bubble:number,overlay?:boolean)=>void;
  guideVisible:(key:string,index:number,overlay?:boolean)=>boolean;
  toggleGuide:(key:string,index:number,overlay?:boolean)=>void;
}
function PanelThumbnail({panel,frame=false}:{panel:Panel;frame?:boolean}) {
  const b=panelBounds(panel),pad=Math.max(b.w,b.h)*.1;
  return <span class={`layer-thumbnail panel-layer-thumbnail ${frame?'is-frame':''}`}><svg viewBox={`${b.x-pad} ${b.y-pad} ${b.w+pad*2} ${b.h+pad*2}`} aria-hidden="true"><polygon points={panelShapePoints(panel).map(p=>p.join(',')).join(' ')} fill={frame?'white':'currentColor'} stroke="currentColor" stroke-width={Math.max(b.w,b.h)*.035}/></svg></span>;
}
function InactiveLayers({panel,index,p,overlay=false}:{panel:Panel;index:number;p:Props;overlay?:boolean}) {
  const result=useMemo(()=>{try{const scene=paintScene(panel,p.dpi,p.assets,p.colorMode);if(overlay)scene.owners=scene.owners.filter(o=>o.kind!=='background');return {scene};}catch(error){return {error:error instanceof Error?error.message:'画像を読み込めません'};}},[panel,p.dpi,p.assets,p.colorMode,overlay]);
  const [decoded,setDecoded]=useState<{source:typeof result;images:PaintImages}|null>(null),[error,setError]=useState('');
  // Effects run after child layout effects: never pair a new scene with the previous image map.
  const images=decoded?.source===result?decoded.images:null;
  useEffect(()=>{
    setDecoded(null);setError('');if(!result.scene)return;
    let cancelled=false,map:PaintImages|null=null;
    void loadPaintImages(result.scene.owners.map(o=>o.paint),p.assets).then(value=>{if(cancelled)value.forEach(i=>{i.src='';});else{map=value;setDecoded({source:result,images:value});}}).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;map?.forEach(i=>{i.src='';});};
  },[result,p.assets]);
  if(!result.scene)return <p role="alert">{result.error}</p>;
  const scene=result.scene,owner=scene.owners[0];
  const act=(action:PaintLayerAction)=>p.onAction(index,action,scene,overlay);
  return <>{error&&<p role="alert">{error}</p>}<PaintLayerPalette reorderGroup={overlay?undefined:(key,target,after)=>p.onReorderOwners(index,key,target,after)} embedded inactive selectedBubble={overlay?p.selectedOverlayBubble:index===p.activePanel?p.selectedBubble:undefined} onToggleBubble={bubble=>p.onToggleBubble(index,bubble,overlay)} openBackground3d={overlay?undefined:()=>act({type:'background3d',key:'background'})} title="" scene={scene} owner={owner} layer={owner.paint.layers[0]} images={images} disabled={p.disabled||!panelVisible(panel)}
    selectMask={(key,id,mask)=>act({type:'select',key,id,mask})}
    select={(key,id,contents)=>act({type:'select',key,id,contents})} update={(key,id,patch)=>act({type:'update',key,id,patch})}
    toggleGroup={key=>act({type:'toggle',key})} reorder={(key,id,target,after)=>act({type:'reorder',key,id,target,after})}
    guideVisible={key=>p.guideVisible(key,index,overlay)} toggleGuide={key=>p.toggleGuide(key,index,overlay)}
    onEditText={bubble=>p.onEditText(index,bubble,overlay)} menu={(event,key)=>{event.preventDefault();act({type:'menu',key,x:event.clientX,y:event.clientY});}}
    add={()=>{}} addVector={()=>{}} importImage={()=>{}} duplicate={()=>{}} remove={()=>{}}/></>;
}
export default function PageLayerPalette(p:Props) {
  const paint=usePaintWorkspace(),controls=useContext(PaintLayerControlsContext);
  const overlaySource=useMemo<Panel|null>(()=>{
    const o=p.page.page_overlay;if(!o?.figures?.length&&!o?.bubbles?.length)return null;
    return {id:0,shape:{type:'rect',x:0,y:0,...p.page.canvas},bg:0,action:null,
      figures:o?.figures?.map((f,i)=>({...f,bbox:f.bbox??overlayFallbackBox(p.page.canvas,'figure',i)})),
      bubbles:(o?.bubbles??[]).map((b,i)=>({...b,bbox:b.bbox??overlayFallbackBox(p.page.canvas,'bubble',i)}))};
  },[p.page.page_overlay,p.page.canvas]);
  const [folded,setFolded]=useState<Record<number,boolean>>({});
  useEffect(()=>{setFolded({});},[p.page.page]);
  const eye=(label:string,visible:boolean,action:()=>void)=><LayerVisibilityButton label={label} visible={visible} disabled={p.disabled} onClick={action}/>;
  return <div class="page-layer-palette"><h3>レイヤー</h3>{controls}
    <div class="page-layer-tree" role="tree" aria-label="ページのレイヤー">
      {p.page.panels.map((panel,index)=>{
        const active=paint?.page===p.page.page&&!paint.overlay&&paint.panelIndex===index;
        const collapsed=folded[index]??(index!==p.activePanel),visible=panelVisible(panel);
        const title=panelDisplayLabel(panel.id);
        return <div class={`panel-layer-group ${visible?'':'is-hidden'}`} key={`${p.page.page}-${panel.id}`} role="treeitem" aria-expanded={!collapsed} aria-label={title}>
          <div class={`panel-layer-heading ${index===p.activePanel?'is-selected':''}`}>
            {eye(`${title}を${visible?'隠す':'表示'}`,visible,()=>p.onVisibility(index,false))}
            <button class="palette-icon" aria-label={`${title}を${collapsed?'展開':'折りたたむ'}`} aria-expanded={!collapsed} onClick={()=>setFolded({...folded,[index]:!collapsed})}>{collapsed?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
            <button class="panel-layer-select" aria-label={`${title}を選択`} data-tool-help="このコマを紙面で選択します。中のレイヤーとコマ枠をまとめるフォルダです。" onClick={()=>{setFolded({...folded,[index]:false});p.onSelect(index);}} disabled={p.disabled}><PanelThumbnail panel={panel}/><span>{title}</span></button>
          </div>
          {!collapsed&&<div class="panel-layer-children" role="group">
            <div class="layer-row panel-frame-layer">
              {eye(`${title}の枠線を${panelFrameVisible(panel)?'隠す':'表示'}`,panelFrameVisible(panel),()=>p.onVisibility(index,true))}
              <button class="layer-select" aria-label={`${title}の枠を選択`} data-tool-help="コマ枠を紙面で選択し、辺や頂点を動かせます。枠線を隠しても絵のクリップ範囲は変わりません。" disabled={p.disabled} onClick={()=>p.onSelect(index)}><PanelThumbnail panel={panel} frame/><span>コマ枠</span></button>
            </div>
            {active?paint.layers:<InactiveLayers panel={panel} index={index} p={p}/>}
          </div>}
        </div>;
      })}
      {overlaySource&&<div class="panel-layer-group"><div class="layer-panel-row"><FolderOpen size={17}/>ページ前景</div>{paint?.overlay&&paint.page===p.page.page?paint.layers:<InactiveLayers panel={overlaySource} index={0} p={p} overlay/>}</div>}
    </div>
  </div>;
}
