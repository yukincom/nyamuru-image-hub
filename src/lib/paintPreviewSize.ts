/** Render at displayed device resolution, up to the original document pixels. */
export function paintPreviewSize(width:number,height:number,cssWidth:number,cssHeight:number,dpr:number){
  const ratio=Number.isFinite(dpr)&&dpr>0?dpr:1;
  const scale=Math.min(1,Math.max(1,cssWidth*ratio)/width,Math.max(1,cssHeight*ratio)/height);
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
