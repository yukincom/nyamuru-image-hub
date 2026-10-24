import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BBox } from '../types';
import { alphaContentGeometry, contentBox, type ContentGeometry } from '../lib/canvasContentGeometry';

const geometryByTarget=new WeakMap<Element,ContentGeometry>();
export function elementContentBox(element:Element,frame:BBox):BBox {
  const target=element.closest('[data-content-target]'),geometry=target&&geometryByTarget.get(target);
  return geometry&&contentBox(frame,geometry)||frame;
}
export function elementContentHit(target:HTMLElement,x:number,y:number):boolean {
  const box=target.getBoundingClientRect();
  if(!box.width||!box.height||x<box.left||x>box.right||y<box.top||y>box.bottom)return false;
  if(!target.hasAttribute('data-content-target'))return getComputedStyle(target).visibility!=='hidden';
  const geometry=geometryByTarget.get(target),path=target.querySelector<SVGPathElement>('.canvas-content-hit path');
  return !!geometry&&!!path&&path.isPointInFill(new DOMPoint((x-box.x)/box.width*geometry.width,(y-box.y)/box.height*geometry.height));
}

const intersects=(a:BBox,b:BBox):BBox=>{
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  return {x,y,w:Math.max(0,Math.min(a.x+a.w,b.x+b.w)-x),h:Math.max(0,Math.min(a.y+a.h,b.y+b.h)-y)};
};
const boxOf=(element:Element):BBox=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};

/** Read the rendered surfaces, including contain/crop, erasure, masks and native SVGs.
 * This never changes source pixels or the placement/paint coordinate system. */
async function measureContent(target:HTMLElement):Promise<ContentGeometry>{
  const frame=boxOf(target),scale=Math.min(1,768/Math.max(frame.w,frame.h,1));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(frame.w*scale));canvas.height=Math.max(1,Math.ceil(frame.h*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  ctx.scale(canvas.width/Math.max(frame.w,1),canvas.height/Math.max(frame.h,1));ctx.translate(-frame.x,-frame.y);
  const surfaces=target.querySelectorAll<HTMLCanvasElement|HTMLImageElement|SVGSVGElement|HTMLElement>('canvas.paint-preview-canvas, img, svg:not(.canvas-content-hit), .bubble-text, .paint-bubble-text, .figure-native-reference small, .paint-original small, .placed-image-missing');
  for(const element of surfaces){
    if(element.closest('.canvas-content-selection'))continue;
    let clip=frame,opacity=1,visible=true;
    for(let parent:Element|null=element;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);opacity*=Number(style.opacity);
      if(style.display==='none'||style.visibility==='hidden'){visible=false;break;}
      if(parent!==element&&(/hidden|clip|scroll|auto/.test(`${style.overflowX} ${style.overflowY}`)))clip=intersects(clip,boxOf(parent));
      if(parent===target)break;
    }
    const box=boxOf(element);if(!visible||!opacity||!box.w||!box.h||!clip.w||!clip.h)continue;
    ctx.save();ctx.globalAlpha=opacity;ctx.beginPath();ctx.rect(clip.x,clip.y,clip.w,clip.h);ctx.clip();
    try{
      if(element instanceof HTMLCanvasElement){
        if(element.width&&element.height)ctx.drawImage(element,box.x,box.y,box.w,box.h);
      }else if(element instanceof HTMLImageElement){
        if(!element.complete||!element.naturalWidth)continue;
        let imageBox=box;
        if(getComputedStyle(element).objectFit==='contain'){
          const ratio=Math.min(box.w/element.naturalWidth,box.h/element.naturalHeight),w=element.naturalWidth*ratio,h=element.naturalHeight*ratio;
          imageBox={x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h};
        }
        ctx.drawImage(element,imageBox.x,imageBox.y,imageBox.w,imageBox.h);
      }else if(element instanceof SVGSVGElement){
        const clone=element.cloneNode(true) as SVGSVGElement;
        const originals=[element,...element.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
        const properties=['fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','opacity','display','visibility','font-family','font-size','font-weight'];
        originals.forEach((node,i)=>{const style=getComputedStyle(node);for(const name of properties)(copies[i] as SVGElement).style.setProperty(name,style.getPropertyValue(name));});
        clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(box.w));clone.setAttribute('height',String(box.h));
        // The SVG is already positioned here; its page CSS must not offset it again.
        clone.style.position='static';clone.style.width=`${box.w}px`;clone.style.height=`${box.h}px`;clone.style.opacity='1';
        const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'})),image=new Image();
        try{image.src=url;await image.decode();ctx.drawImage(image,box.x,box.y,box.w,box.h);}finally{URL.revokeObjectURL(url);}
      }else{
        ctx.fillStyle='#000';
        const background=getComputedStyle(element).backgroundColor;
        if(element.classList.contains('placed-image-missing')||!['transparent','rgba(0, 0, 0, 0)'].includes(background)){
          ctx.fillRect(box.x,box.y,box.w,box.h);
        }else{
          // Labels stretch across their frame. Only the text occupies that space.
          const range=document.createRange();range.selectNodeContents(element);
          for(const rect of range.getClientRects()){
            const text=intersects(box,{x:rect.x,y:rect.y,w:rect.width,h:rect.height});
            ctx.fillRect(text.x,text.y,text.w,text.h);
          }
        }
      }
    }finally{ctx.restore();}
  }
  return alphaContentGeometry(ctx.getImageData(0,0,canvas.width,canvas.height));
}

/** A separate SVG hit surface lets native pointer targeting pass through alpha gaps. */
export default function CanvasContentSelection({frame,selected,handles,source,revision}:{
  frame:BBox;selected:boolean;handles?:(visible:BBox)=>ComponentChildren;source?:string;revision?:unknown;
}){
  const marker=useRef<HTMLSpanElement>(null),scheduleRef=useRef<()=>void>(()=>{});
  const [geometry,setGeometry]=useState<ContentGeometry|null>(null);
  useLayoutEffect(()=>{
    const root=marker.current?.parentElement;if(!root)return;
    const target=source?root.closest('.manga-paper')?.querySelector<HTMLElement>(`[data-content-source="${source}"]`):root;
    if(!target)return;
    let disposed=false,raf=0,version=0;
    const schedule=()=>{const current=++version;cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{
      void measureContent(target).then(next=>{
        if(disposed||current!==version)return;
        geometryByTarget.set(root,next);
        setGeometry(previous=>previous?.path===next.path&&previous.width===next.width&&previous.height===next.height?previous:next);
      }).catch(()=>{if(!disposed&&current===version){geometryByTarget.delete(root);setGeometry(null);}});
    });};
    scheduleRef.current=schedule;
    const observer=new MutationObserver(changes=>{if(changes.some(change=>{
      const element=change.target instanceof Element?change.target:change.target.parentElement;
      return element&&!element.closest('.canvas-content-selection')&&element!==target;
    }))schedule();});
    observer.observe(target,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','src','width','height','viewBox','d','points']});
    const resize=new ResizeObserver(schedule);resize.observe(target);
    target.addEventListener('load',schedule,true);target.addEventListener('paint-preview-rendered',schedule);
    schedule();
    return()=>{disposed=true;version++;cancelAnimationFrame(raf);observer.disconnect();resize.disconnect();target.removeEventListener('load',schedule,true);target.removeEventListener('paint-preview-rendered',schedule);geometryByTarget.delete(root);scheduleRef.current=()=>{};};
  },[source]);
  useEffect(()=>scheduleRef.current(),[revision]);
  const bounds=geometry?.bounds,visible=geometry&&contentBox(frame,geometry);
  return <span ref={marker} class="canvas-content-selection" aria-hidden="true">
    {geometry?.path&&<svg class="canvas-content-hit" viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none"><path d={geometry.path}/></svg>}
    {selected&&bounds&&geometry&&visible&&<span class="canvas-content-outline" style={{left:`${bounds.x/geometry.width*100}%`,top:`${bounds.y/geometry.height*100}%`,width:`${bounds.w/geometry.width*100}%`,height:`${bounds.h/geometry.height*100}%`}}>{handles?.(visible)}</span>}
  </span>;
}
