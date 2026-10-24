export type MonoInk = '#000000'|'#ffffff'|null;
export const paintInks = [
  {color:'#000000',name:'黒'}, {color:'#ffffff',name:'白'},
  {color:'#ff0000',name:'赤'}, {color:'#0000ff',name:'青'},
  {color:'#00ff00',name:'緑'}, {color:'#ffff00',name:'黄'},
] as const;
export const validPaintInk = (color:unknown):boolean => color===null || typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color);
/** X cycles the active swatch; exchanging the two swatches is a separate action. */
export function nextMonoInk(color:string|null,allowNone:boolean):MonoInk {
  return color?.toLowerCase()==='#000000'?'#ffffff':color?.toLowerCase()==='#ffffff'&&allowNone?null:'#000000';
}
export function swapPaintInk(style:{fill:string|null;stroke:string|null}) {return {fill:style.stroke,stroke:style.fill};}
