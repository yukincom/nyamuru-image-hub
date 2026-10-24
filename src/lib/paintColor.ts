import type { PaintColorMode } from '../types.ts';
import { toEditableMangaFormat } from './artworkEnglish.ts';

export const paintColorModes = [
  {value:'color',label:'カラー'}, {value:'grayscale',label:'グレースケール'}, {value:'monochrome',label:'モノクロ'},
] as const;
export function paintColorMode(format:string):PaintColorMode {
  const value=toEditableMangaFormat(format);
  return value==='モノクロ漫画'?'monochrome':value==='グレースケール漫画'?'grayscale':'color';
}
const luminance=(r:number,g:number,b:number)=>Math.round(r*.2126+g*.7152+b*.0722);
export function paintColorInk(color:string|null,mode:PaintColorMode|undefined):string|null {
  if(color===null||!mode||mode==='color')return color;
  const gray=luminance(parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16));
  const channel=(mode==='monochrome'?(gray<128?0:255):gray).toString(16).padStart(2,'0');
  return `#${channel.repeat(3)}`;
}
/** Keep source colors editable; transform only rendered layer pixels. */
export function applyPaintColor(data:Uint8ClampedArray,mode:PaintColorMode|undefined,native=true):void {
  // Reduced monochrome ink has already been converted before rasterization.
  // Preserve mixtures of opaque white and black as well as transparent edges.
  if(!mode||mode==='color'||mode==='monochrome'&&!native)return;
  for(let i=0;i<data.length;i+=4){
    const gray=luminance(data[i],data[i+1],data[i+2]);
    data[i]=data[i+1]=data[i+2]=mode==='monochrome'?(gray<128?0:255):gray;
    // Reduced canvases express subpixel coverage, not extra ink shades.
    if(mode==='monochrome'&&native)data[i+3]=data[i+3]<128?0:255;
  }
}
