import type { DrawingTool } from './paintToolMode.ts';

type PaintShortcutTool = Exclude<DrawingTool, 'clear'>;

interface ShortcutInput {key:string;shiftKey?:boolean;altKey?:boolean;metaKey?:boolean;ctrlKey?:boolean;isComposing?:boolean}
/** Leave text editing, IME and application/browser chords alone. */
export function paintToolShortcut(event:ShortcutInput,editing=false):PaintShortcutTool|undefined {
  if(editing||event.isComposing||event.altKey||event.metaKey||event.ctrlKey)return;
  const key=event.key.toLowerCase();
  if(key==='c'&&event.shiftKey)return 'vector-anchor';
  if(key==='+'||(key==='='&&event.shiftKey))return 'vector-add';
  if(event.shiftKey)return;
  return ({b:'pen',e:'eraser',w:'wand',m:'lasso',g:'fill',v:'vector-select',a:'vector-node',p:'vector-pen','-':'vector-delete',l:'ellipse'} as Record<string,PaintShortcutTool>)[key];
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
export const PAINT_SIZE_PRESETS=[.07,.1,.15,.2,.25,.3,.4,.5,.6,.7,.8,1,1.2,1.5,1.7,2,2.5,3,4,5,6,7,8,10,12,15,17,20,25,30,40,50,60,70,80,100] as const;
export function stepPaintSize(size:number,direction:1|-1,_vector=false):number {
  const next=direction===1?PAINT_SIZE_PRESETS.find(value=>value>size):PAINT_SIZE_PRESETS.findLast(value=>value<size);
  return next??(direction===1?PAINT_SIZE_PRESETS.at(-1)!:PAINT_SIZE_PRESETS[0]);
}
