import type { VectorTool } from './vectorGesture.ts';

interface ShortcutInput {key:string;shiftKey?:boolean;altKey?:boolean;metaKey?:boolean;ctrlKey?:boolean;isComposing?:boolean}
/** Leave text editing, IME and application/browser chords alone. */
export function paintToolShortcut(event:ShortcutInput,editing=false):VectorTool|undefined {
  if(editing||event.isComposing||event.altKey||event.metaKey||event.ctrlKey)return;
  const key=event.key.toLowerCase();
  if(key==='c'&&event.shiftKey)return 'vector-anchor';
  if(key==='+'||(key==='='&&event.shiftKey))return 'vector-add';
  if(event.shiftKey)return;
  return ({v:'vector-select',a:'vector-node',p:'vector-pen','-':'vector-delete',m:'rectangle',l:'ellipse'} as Record<string,VectorTool>)[key];
}

/** X toggles monochrome ink, leaving cut and text input untouched. */
export function paintInkShortcut(event:ShortcutInput,editing=false):boolean {
  return !editing&&!event.isComposing&&!event.altKey&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.key.toLowerCase()==='x';
}

/** Use logical characters: JIS and US keyboards put brackets on different codes. */
export function paintSizeShortcut(event:ShortcutInput,editing=false):1|-1|undefined {
  if(editing||event.isComposing||event.altKey||event.metaKey||event.ctrlKey||event.shiftKey)return;
  if(event.key==='[')return -1;
  if(event.key===']')return 1;
}
const brushSizes=[.5,1,1.5,2,2.5,3,4,5,6,7,8,9,10,12,15,17,20,25,30,35,40,45,50,60,70,80,90,100,120,150,170,200,250,300,350,400,450,500,600,700,800,900,1000];
export function stepPaintSize(size:number,direction:1|-1,vector=false):number {
  const min=vector?.1:.5,max=vector?1000:500;
  const next=direction===1?brushSizes.find(value=>value>size):brushSizes.findLast(value=>value<size);
  return Math.max(min,Math.min(max,next??(direction===1?max:min)));
}
