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
  if(!box.width||!box.height)return false;
  if(!target.hasAttribute('data-content-target'))return x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom&&getComputedStyle(target).visibility!=='hidden';
  const geometry=geometryByTarget.get(target),path=target.querySelector<SVGPathElement>('.canvas-content-hit path');
  return !!geometry&&!!path&&path.isPointInFill(new DOMPoint((x-box.x)/box.width*geometry.width,(y-box.y)/box.height*geometry.height));
}

const intersects=(a:BBox,b:BBox):BBox=>{
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  return {x,y,w:Math.max(0,Math.min(a.x+a.w,b.x+b.w)-x),h:Math.max(0,Math.min(a.y+a.h,b.y+b.h)-y)};
};
const boxOf=(element:Element):BBox=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
const union=(a:BBox,b:BBox):BBox=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};};

/** Native outlines can extend beyond their reference viewport without changing it. */
function svgSurface(element:SVGSVGElement):{box:BBox;viewBox?:BBox}{
  const box=boxOf(element);
  if(!element.classList.contains('bubble-shape-svg')||getComputedStyle(element).overflow!=='visible')return {box};
  const matrix=element.getScreenCTM(),view=element.viewBox.baseVal;
  if(!matrix||!view.width||!view.height)return {box};
  const bounds=element.getBBox(),padding=2/Math.max(.001,Math.min(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d)));
  const viewBox=union({x:view.x,y:view.y,w:view.width,h:view.height},{x:bounds.x-padding,y:bounds.y-padding,w:bounds.width+padding*2,h:bounds.height+padding*2});
  const a=new DOMPoint(viewBox.x,viewBox.y).matrixTransform(matrix),b=new DOMPoint(viewBox.x+viewBox.w,viewBox.y+viewBox.h).matrixTransform(matrix);
  return {box:{x:a.x,y:a.y,w:b.x-a.x,h:b.y-a.y},viewBox};
}

/** Read the rendered surfaces, including contain/crop, erasure, masks and native SVGs.
 * This never changes source pixels or the placement/paint coordinate system. */
async function measureContent(target:HTMLElement):Promise<ContentGeometry>{
  const frame=boxOf(target);
  const surfaces=Array.from(target.querySelectorAll<HTMLCanvasElement|HTMLImageElement|SVGSVGElement|HTMLElement>('canvas.paint-preview-canvas, img, svg:not(.canvas-content-hit), .bubble-text, .paint-bubble-text, .figure-native-reference small, .paint-original small, .placed-image-missing')).filter(element=>!element.closest('.canvas-content-selection'));
  const svgFrames=new Map<SVGSVGElement,ReturnType<typeof svgSurface>>();
  let measuredFrame=frame;
  for(const element of surfaces)if(element instanceof SVGSVGElement){const surface=svgSurface(element);svgFrames.set(element,surface);measuredFrame=union(measuredFrame,surface.box);}
  const side=Math.max(measuredFrame.w,measuredFrame.h,1),scale=Math.min(1,768/side);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(measuredFrame.w*scale));canvas.height=Math.max(1,Math.ceil(measuredFrame.h*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const sx=canvas.width/Math.max(measuredFrame.w,1),sy=canvas.height/Math.max(measuredFrame.h,1);
  ctx.scale(sx,sy);ctx.translate(-measuredFrame.x,-measuredFrame.y);
  for(const element of surfaces){
    if(element.closest('.canvas-content-selection'))continue;
    let clip=measuredFrame,opacity=1,visible=true;
    for(let parent:Element|null=element;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);opacity*=Number(style.opacity);
      if(style.display==='none'||style.visibility==='hidden'){visible=false;break;}
      if(parent!==element&&(/hidden|clip|scroll|auto/.test(`${style.overflowX} ${style.overflowY}`)))clip=intersects(clip,boxOf(parent));
      if(parent===target)break;
    }
    const svgFrame=element instanceof SVGSVGElement?svgFrames.get(element):undefined;
    const box=svgFrame?.box??boxOf(element);if(!visible||!opacity||!box.w||!box.h||!clip.w||!clip.h)continue;
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
        const properties=['fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','vector-effect','opacity','display','visibility','font-family','font-size','font-weight'];
        originals.forEach((node,i)=>{const style=getComputedStyle(node);for(const name of properties)(copies[i] as SVGElement).style.setProperty(name,style.getPropertyValue(name));});
        clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(box.w));clone.setAttribute('height',String(box.h));
        if(svgFrame?.viewBox){const b=svgFrame.viewBox;clone.setAttribute('viewBox',`${b.x} ${b.y} ${b.w} ${b.h}`);}
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
  return alphaContentGeometry(ctx.getImageData(0,0,canvas.width,canvas.height),{x:(measuredFrame.x-frame.x)*sx,y:(measuredFrame.y-frame.y)*sy,width:frame.w*sx,height:frame.h*sy});
}

/** A separate SVG hit surface lets native pointer targeting pass through alpha gaps. */
export default function CanvasContentSelection({frame,selected,interactive=true,handles,source,revision}:{
  frame:BBox;selected:boolean;interactive?:boolean;handles?:(visible:BBox)=>ComponentChildren;source?:string;revision?:unknown;
}){
  const marker=useRef<HTMLSpanElement>(null),scheduleRef=useRef<()=>void>(()=>{});
  const [geometry,setGeometry]=useState<ContentGeometry|null>(null);
  useLayoutEffect(()=>{
    const root=marker.current?.parentElement;if(!root)return;
    const target=source?root.closest('.manga-paper')?.querySelector<HTMLElement>(`[data-content-source="${source}"]`):root;
    if(!target)return;
    let disposed=false,raf=0,timer=0,version=0;
    const measure=()=>{const current=version;raf=requestAnimationFrame(()=>{
      void measureContent(target).then(next=>{
        if(disposed||current!==version)return;
        geometryByTarget.set(root,next);
        setGeometry(previous=>previous?.path===next.path&&previous.width===next.width&&previous.height===next.height?previous:next);
      }).catch(()=>{if(!disposed&&current===version){geometryByTarget.delete(root);setGeometry(null);}});
    });};
    // The existing normalized hit path already scales with its host. Rebuild it
    // once after resize/mutation settles, not for every wheel/pinch frame.
    const schedule=()=>{version++;cancelAnimationFrame(raf);clearTimeout(timer);timer=window.setTimeout(measure,120);};
    scheduleRef.current=schedule;
    const observer=new MutationObserver(changes=>{if(changes.some(change=>{
      const element=change.target instanceof Element?change.target:change.target.parentElement;
      return element&&!element.closest('.canvas-content-selection')&&element!==target;
    }))schedule();});
    observer.observe(target,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','src','width','height','viewBox','d','points']});
    const resize=new ResizeObserver(schedule);resize.observe(target);
    target.addEventListener('load',schedule,true);target.addEventListener('paint-preview-rendered',schedule);
    measure();
    return()=>{disposed=true;version++;cancelAnimationFrame(raf);clearTimeout(timer);observer.disconnect();resize.disconnect();target.removeEventListener('load',schedule,true);target.removeEventListener('paint-preview-rendered',schedule);geometryByTarget.delete(root);scheduleRef.current=()=>{};};
  },[source]);
  useEffect(()=>scheduleRef.current(),[revision]);
  const bounds=geometry?.bounds,pending=geometry===null,measured=Boolean(bounds&&geometry),visible=pending?frame:measured?contentBox(frame,geometry!):null;
  return <span ref={marker} class="canvas-content-selection" aria-hidden="true">
    {interactive&&geometry?.path&&<svg class="canvas-content-hit" viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none"><path d={geometry.path}/></svg>}
    {selected&&visible&&<span class="canvas-content-outline" data-selection-fallback={pending||undefined} style={pending?{inset:'0'}:{left:`${bounds!.x/geometry!.width*100}%`,top:`${bounds!.y/geometry!.height*100}%`,width:`${bounds!.w/geometry!.width*100}%`,height:`${bounds!.h/geometry!.height*100}%`}}>{handles?.(visible)}</span>}
  </span>;
}
