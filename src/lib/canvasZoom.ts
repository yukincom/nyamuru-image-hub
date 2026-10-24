/** 100% means one output pixel per display device pixel, including Retina. */
export const pixelZoomWidth = (outputWidth:number,dpr:number) => outputWidth/(Number.isFinite(dpr)&&dpr>0?dpr:1);
export const canvasZoomPercent = (width:number,base:number) => Math.round(width/base*10000)/100;
export const clampCanvasZoom = (percent:number) => Math.max(1,Math.min(400,Math.round(percent*100)/100));

/** Tablet zoom keystrokes change the canvas, preserving unmodified vector tool keys. */
export function canvasZoomShortcut(event:{key:string;metaKey?:boolean;ctrlKey?:boolean;altKey?:boolean;isComposing?:boolean},editing=false):number|undefined {
  if(editing||event.isComposing||event.altKey||!(event.metaKey||event.ctrlKey))return;
  if(event.key==='+'||event.key==='=')return 1.25;
  if(event.key==='-')return 1/1.25;
}
