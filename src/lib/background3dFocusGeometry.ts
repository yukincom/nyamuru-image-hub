type Point={x:number;y:number};
type Rect={left:number;top:number;right:number;bottom:number};

/** Clip the panel outline to the actual 3D crop and visible manuscript area. */
export function backgroundFocusPolygon(points:Point[],...rects:Rect[]):Point[]{
  let result=points;
  for(const rect of rects){
    if(rect.right<=rect.left||rect.bottom<=rect.top)return [];
    for(const [axis,value,minimum] of [['x',rect.left,true],['x',rect.right,false],['y',rect.top,true],['y',rect.bottom,false]] as const){
      const input=result;result=[];
      for(let i=0;i<input.length;i++){
        const a=input[i],b=input[(i+1)%input.length],insideA=minimum?a[axis]>=value:a[axis]<=value,insideB=minimum?b[axis]>=value:b[axis]<=value;
        if(insideA)result.push(a);
        if(insideA!==insideB){const t=(value-a[axis])/(b[axis]-a[axis]);result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
      }
    }
  }
  return result;
}

export function backgroundFocusContains(points:Point[],point:Point):boolean {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
/** Share the exact visible panel region between dimming and pointer picking. */
export function backgroundFocusRegion(host:HTMLElement){
  const workspace=host.closest('.canvas-spread')??host.closest('.canvas-viewport')??host.parentElement??host;
  const box=host.getBoundingClientRect(),outer=workspace.getBoundingClientRect();
  const left=Math.max(0,outer.left),top=Math.max(0,outer.top),right=Math.min(window.innerWidth,outer.right),bottom=Math.min(window.innerHeight,outer.bottom);
  const input=host.closest<HTMLElement>('[data-panel-outline]'),page=input?.getBoundingClientRect(),normalized=input?.dataset.panelOutline;
  const points=page&&normalized?normalized.split(' ').map(pair=>{const [x,y]=pair.split(',').map(Number);return {x:page.left+x*page.width,y:page.top+y*page.height};}):[{x:box.left,y:box.top},{x:box.right,y:box.top},{x:box.right,y:box.bottom},{x:box.left,y:box.bottom}];
  return {left,top,right,bottom,polygon:backgroundFocusPolygon(points,box,{left,top,right,bottom})};
}
