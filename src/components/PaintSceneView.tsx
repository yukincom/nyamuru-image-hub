import RasterSelectionOverlay from './RasterSelectionOverlay';
import VectorOverlay from './VectorOverlay';
import { Box } from 'lucide-preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import type { BBox, PersistentAnalogAssetRef } from '../types';
import { paintInputBox, paintReferenceBox, type PaintOwner } from '../lib/paintDocument';
import { usePaintWorkspace } from '../lib/paintWorkspace';
import PaintPreviewCanvas from './PaintPreviewCanvas';
import { loadFigureCropAsset } from '../lib/figureCropStore';
import FigureSizeSvg from './FigureSizeSvg';
import BubbleShapeSvg from './BubbleShapeSvg';
import {textStyleCss,textStyleOf,textWeightSegments} from '../lib/textStyle';
import PaintCursor from './PaintCursor';

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
  if(owner.figure){const figure=owner.figure;
    return <div class="paint-original paint-figure-original">{figure.analogImport
      ?<SourceImage id={figure.analogImport.assetId} persistent={figure.analogImport.persistentAsset}/>
      :figure.kind==='prop'?<Box class="paint-prop-original"/>:<FigureSizeSvg size={figure.size??'bust-up'}/>}<small>{figure.name}</small></div>;
  }
  if(owner.bubble){const bubble=owner.bubble;
    return <div class="paint-original paint-bubble-original" style={{containerType:'inline-size'}}><BubbleShapeSvg shape={bubble.shape} bezier={bubble.bezier}/>
      {bubble.analogTextImport&&!bubble.analogTextImport.referenceHidden
        ?<SourceImage id={bubble.analogTextImport.assetId} persistent={bubble.analogTextImport.persistentAsset}/>
        :<span class="paint-bubble-text" style={bubble.text_style?textStyleCss(textStyleOf(bubble,'bubble'),owner.frame.w):undefined}>{bubble.text_weights?.length?textWeightSegments(bubble).map((part,i)=><span key={i} style={part.fontWeight?{fontWeight:part.fontWeight}:undefined}>{part.text}</span>):bubble.text}</span>}</div>;
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
  const hasInk=owner.paint.layers.some(layer=>layer.visible&&(layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.fill))||state.live?.ownerKey===owner.key;
  const showGuide=!owner.paint.guideInitialized&&state.guideVisible(owner.key);
  const fullGuide=showGuide&&!hasInk;
  if(state.background3d?.ownerKey===ownerKey){const shot=state.background3d.frame;
    return <div class="paint-owner" style={relativeStyle(owner.frame,container)} data-paint-owner={ownerKey}>
      <div class="background3d-window" ref={state.background3d.setHost} style={{left:`${shot.x/owner.paint.width*100}%`,top:`${shot.y/owner.paint.height*100}%`,width:`${shot.w/owner.paint.width*100}%`,height:`${shot.h/owner.paint.height*100}%`}}/>
    </div>;
  }
  return <div class="paint-owner" style={relativeStyle(owner.frame,container)} data-paint-owner={ownerKey}>
    {!inkOnly&&showGuide&&<div class={fullGuide?'paint-reference':'paint-reference is-underlay'} style={relativeStyle(reference,owner.frame)}><PaintOriginal owner={owner}/></div>}
    {state.images&&<PaintPreviewCanvas paint={owner.paint} images={state.images} live={state.live?.ownerKey===owner.key?state.live:undefined} maskPreviewId={state.maskPreview?.ownerKey===owner.key?state.maskPreview.layerId:undefined}/>}
  </div>;
}

export default function PaintInputSurface({canvas}:{canvas:{w:number;h:number}}) {
  const state=usePaintWorkspace();
  const surface=useRef<HTMLDivElement>(null);
  if(!state||state.background3d||(!state.selectionTool&&state.owner.bubble?.hidden===true))return null;
  const {owner,overscan,events}=state;
  const area=state.selectionTool?{x:0,y:0,...canvas}:paintInputBox(owner,overscan);
  return <div ref={surface} class="paint-input" data-pen-cursor={state.penCursor} data-selection-surface={state.selectionTool?true:undefined} data-paper-width={canvas.w} data-paper-height={canvas.h} style={{...relativeStyle(area,{x:0,y:0,...canvas}),cursor:state.cursor?'none':'default'}}
    aria-label={`${owner.label}の描画面（はみ出し枠を含む）`} {...events} onContextMenu={event=>state.onContextMenu(event,owner.key)} onClick={event=>event.stopPropagation()}>
    {state.cursor&&<PaintCursor surface={surface} owner={owner} overscan={overscan} cursor={state.cursor}/>}
    <span class="paint-frame" style={relativeStyle(owner.frame,area)}>{state.vector&&<VectorOverlay state={state.vector}/>}<RasterSelectionOverlay boxes={state.selection?.boxes} points={state.lasso} width={owner.paint.width} height={owner.paint.height}/></span>
  </div>;
}
