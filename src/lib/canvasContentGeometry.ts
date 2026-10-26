import type { BBox } from '../types.ts';

export interface ContentGeometry { width:number; height:number; bounds:BBox|null; path:string }

/** Merge equal alpha runs vertically. White paint is as selectable as black paint. */
export function alphaContentGeometry(pixels:{width:number;height:number;data:ArrayLike<number>},reference?:{x:number;y:number;width:number;height:number}):ContentGeometry {
  const {width,height,data}=pixels,rects:BBox[]=[];
  let active=new Map<string,BBox>(),left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y++){
    const next=new Map<string,BBox>();
    for(let x=0;x<width;){
      if(!data[(y*width+x)*4+3]){x++;continue;}
      const start=x;while(x<width&&data[(y*width+x)*4+3]>0)x++;
      const w=x-start,key=`${start}:${w}`,previous=active.get(key);
      const rect=previous??{x:start,y,w,h:0};rect.h++;
      if(!previous)rects.push(rect);next.set(key,rect);
      left=Math.min(left,start);top=Math.min(top,y);right=Math.max(right,x);bottom=y+1;
    }
    active=next;
  }
  const dx=reference?.x??0,dy=reference?.y??0;
  return {width:reference?.width??width,height:reference?.height??height,bounds:right>left?{x:left+dx,y:top+dy,w:right-left,h:bottom-top}:null,
    path:rects.map(b=>`M${b.x+dx} ${b.y+dy}h${b.w}v${b.h}h${-b.w}z`).join('')};
}

export function contentBox(frame:BBox,geometry:ContentGeometry):BBox|null {
  const b=geometry.bounds;
  return b?{x:frame.x+b.x/geometry.width*frame.w,y:frame.y+b.y/geometry.height*frame.h,w:b.w/geometry.width*frame.w,h:b.h/geometry.height*frame.h}:null;
}

/** Apply a visible-bounds edit to the complete paint frame without cropping its bleed. */
export function frameFromContentEdit(frame:BBox,before:BBox,after:BBox):BBox {
  const sx=after.w/before.w,sy=after.h/before.h;
  return {x:after.x+(frame.x-before.x)*sx,y:after.y+(frame.y-before.y)*sy,w:frame.w*sx,h:frame.h*sy};
}
