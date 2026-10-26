import RasterSelectionOverlay from './RasterSelectionOverlay';
import VectorOverlay from './VectorOverlay';
import { Box } from 'lucide-preact';
import { useEffect, useLayoutEffect, useState, useRef } from 'preact/hooks';
import type { BBox, PersistentAnalogAssetRef } from '../types';
import { paintReferenceBox, type PaintOwner } from '../lib/paintDocument';
import { usePaintWorkspace } from '../lib/paintWorkspace';
import PaintPreviewCanvas from './PaintPreviewCanvas';
import { loadFigureCropAsset } from '../lib/figureCropStore';
import FigureSizeSvg from './FigureSizeSvg';
import BubbleShapeSvg from './BubbleShapeSvg';
import {textStyleCss,textStyleOf,textWeightSegments} from '../lib/textStyle';
import PaintCursor from './PaintCursor';
import {bubbleTextPosition} from '../lib/bubbleClip.ts';
import {figureDisplayLabel} from '../lib/displayLabels.ts';

function SourceImage({id, persistent}: {id:string; persistent?:PersistentAnalogAssetRef}) {
  const [url,setUrl]=useState(''),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let disposed=false,source='';
    void loadFigureCropAsset(id,persistent).then(blob=>{if(disposed)return;if(blob){source=URL.createObjectURL(blob);setUrl(source);}else setFailed(true);}).catch(()=>{if(!disposed)setFailed(true);});
    return()=>{disposed=true;if(source)URL.revokeObjectURL(source);};
  },[id,persistent]);
  return url?<img src={url} alt="元のあたり" draggable={false}/>:<span>{failed?'元画像を読み込めません。作品フォルダから開き直してください。':'元のあたり画像を読み込み中'}</span>;
}
export function PaintOriginal({owner}: {owner:PaintOwner}) {
  const textHost=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const host=textHost.current;if(!host)return;
    const size=()=>host.style.setProperty('--canvas-layout-width',`${host.clientWidth}px`);
    size();const observer=new ResizeObserver(size);observer.observe(host);
    return()=>observer.disconnect();
  },[owner.kind]);
  if(owner.kind==='panel'||owner.kind==='page')return null;
  if(owner.figure){const figure=owner.figure;
    return <div class="paint-original paint-figure-original">{figure.analogImport
      ?<SourceImage id={figure.analogImport.assetId} persistent={figure.analogImport.persistentAsset}/>
      :figure.kind==='prop'?<Box class="paint-prop-original"/>:<FigureSizeSvg size={figure.size??'bust-up'}/>}<small>{figureDisplayLabel(figure,owner.index)}</small></div>;
  }
  if(owner.bubble){const bubble=owner.bubble;
    const position=bubbleTextPosition(bubble);
    const reference=paintReferenceBox(owner.paint,owner.frame);
    return <div ref={textHost} class="paint-original paint-bubble-original"><BubbleShapeSvg shape={bubble.shape} bezier={bubble.bezier}/>
      <span class="paint-bubble-text" style={{left:`${position.x*100}%`,top:`${position.y*100}%`,...textStyleCss(textStyleOf(bubble,'bubble'),reference.w)}}>{bubble.text_weights?.length?textWeightSegments(bubble).map((part,i)=><span key={i} style={part.fontWeight?{fontWeight:part.fontWeight}:undefined}>{part.text}</span>):bubble.text}</span></div>;
  }
  const level=owner.backgroundLevel===-1?'n1':owner.backgroundLevel??1;
  return <div class="paint-original paint-background-original" style={{backgroundColor:`var(--panel-bg-${level}-color)`,backgroundImage:`var(--panel-bg-${level}-image, none)`}}><small>{owner.description||'背景あたり'}</small></div>;
}

const relativeStyle=(box:BBox,container:BBox)=>({left:`${(box.x-container.x)/container.w*100}%`,top:`${(box.y-container.y)/container.h*100}%`,width:`${box.w/container.w*100}%`,height:`${box.h/container.h*100}%`});
/** Preview in the native page's existing stacking layer; bubbles keep their native text/tails. */
export function PaintOwnerPreview({ownerKey,container,inkOnly=false}:{ownerKey:string;container:BBox;inkOnly?:boolean}) {
  const state=usePaintWorkspace();
  if(!state)return null;
  const owner=state.scene.owners.find(o=>o.key===ownerKey);
  if(!owner||owner.bubble?.hidden===true)return null;
  const reference=paintReferenceBox(owner.paint,owner.frame);
  const live=state.live?.ownerKey===owner.key?state.live:undefined;
  const hasInk=Boolean(live)||owner.paint.layers.some(layer=>layer.visible&&(layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.fill));
  const showGuide=!owner.paint.guideInitialized&&state.guideVisible(owner.key);
  const fullGuide=showGuide&&!hasInk;
  if(state.background3d?.ownerKey===ownerKey){const shot=state.background3d.frame;
    return <div class="paint-owner" style={relativeStyle(owner.frame,container)} data-paint-owner={ownerKey}>
      <div class="background3d-window" ref={state.background3d.setHost} style={{left:`${shot.x/owner.paint.width*100}%`,top:`${shot.y/owner.paint.height*100}%`,width:`${shot.w/owner.paint.width*100}%`,height:`${shot.h/owner.paint.height*100}%`}}/>
    </div>;
  }
  return <div class="paint-owner" style={relativeStyle(owner.frame,container)} data-paint-owner={ownerKey}>
    {!inkOnly&&showGuide&&<div class={fullGuide?'paint-reference':'paint-reference is-underlay'} style={relativeStyle(reference,owner.frame)}><PaintOriginal owner={owner}/></div>}
    {state.images&&<PaintPreviewCanvas paint={owner.paint} images={state.images} live={live} maskPreviewId={state.maskPreview?.ownerKey===owner.key?state.maskPreview.layerId:undefined}/>}
  </div>;
}

export default function PaintInputSurface({canvas}:{canvas:{w:number;h:number}}) {
  const state=usePaintWorkspace();
  const surface=useRef<HTMLDivElement>(null);
  if(!state||state.background3d||(!state.selectionTool&&state.owner.bubble?.hidden===true))return null;
  const {owner,events}=state;
  const area={x:0,y:0,...canvas};
  return <div ref={surface} class="paint-input" data-pen-cursor={state.penCursor} data-selection-surface={state.selectionTool?true:undefined} data-paper-width={canvas.w} data-paper-height={canvas.h} style={{...relativeStyle(area,{x:0,y:0,...canvas}),cursor:state.cursor?'none':'default'}}
    aria-label={`${owner.label}の描画面（紙面全体）`} {...events} onContextMenu={event=>state.onContextMenu(event,owner.key)} onClick={event=>event.stopPropagation()}>
    {state.cursor&&<PaintCursor surface={surface} owner={owner} canvas={canvas} cursor={state.cursor}/>}
    <span class="paint-frame" style={relativeStyle(owner.frame,area)}>{state.vector&&<VectorOverlay state={state.vector}/>}<RasterSelectionOverlay boxes={state.selection?.boxes} points={state.lasso} width={owner.paint.width} height={owner.paint.height}/></span>
  </div>;
}
