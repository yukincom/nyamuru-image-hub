import {readJapaneseFontFamily} from './fontNames.ts';

export const BUBBLE_FONT_PRESETS = [
  'アンチック体',
  '明朝体',
  'ゴシック体',
  'BIZ UDP明朝',
  'BIZ UDPゴシック',
  'Noto Serif JP',
  'Noto Sans JP',
] as const;

export const FONT_MENU_SAMPLE='012abcABCあいう';
export type PcFontSupport='japanese'|'other'|'unreadable';
export interface PcFontName {family:string;displayName?:string}
export interface PcFontFamily extends PcFontName {support:PcFontSupport}
export type FontGlyphProbe=(family:string,sample:string)=>boolean;

export function mergeBubbleFontFamilies(...groups:ReadonlyArray<readonly string[]>):string[] {
  return [...new Set(groups.flat().map(font=>font.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
}

/** Local Font Access requires this call to begin inside a user gesture. */
export async function queryPcFontFamilies(target:Window=window):Promise<PcFontName[]> {
  const query=(target as Window&{queryLocalFonts?:()=>Promise<Array<{family:string;postscriptName?:string;blob?:()=>Promise<Blob>}>>}).queryLocalFonts;
  if(!query)throw new Error('このブラウザではPC内フォントの自動読み込みに対応していません');
  const faces=await query.call(target),unique=new Map<string,typeof faces[number]>();
  for(const face of faces){const family=face.family.trim();if(family&&!unique.has(family))unique.set(family,face);}
  const entries=[...unique.entries()],catalog:PcFontName[]=new Array(entries.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
    while(next<entries.length){
      const index=next++,[family,face]=entries[index];let displayName=family;
      try{if(face.blob)displayName=await readJapaneseFontFamily(await face.blob(),family,face.postscriptName)??family;}catch{/* Keep the usable family if its metadata cannot be read. */}
      catalog[index]={family,displayName};
    }
  }));
  return catalog.sort((a,b)=>a.family.localeCompare(b.family,'ja'));
}

/**
 * Test whether the requested family contributes glyphs instead of silently
 * falling through to two different generic fallback families.
 */
export function browserFontGlyphProbe(target:Document=document):FontGlyphProbe {
  const canvas=target.createElement('canvas');canvas.width=180;canvas.height=92;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return()=>false;
  const cache=new Map<string,string>();
  const fingerprint=(font:string,sample:string)=>{
    const key=`${font}\u0000${sample}`;const saved=cache.get(key);if(saved)return saved;
    context.clearRect(0,0,canvas.width,canvas.height);context.fillStyle='#000';context.textBaseline='alphabetic';context.font=`64px ${font}`;
    const width=context.measureText(sample).width;context.fillText(sample,3,70);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261;
    for(let index=3;index<pixels.length;index+=4){hash^=pixels[index];hash=Math.imul(hash,16777619);}
    const value=`${width.toFixed(3)}:${hash>>>0}`;cache.set(key,value);return value;
  };
  return (family,sample)=>{
    const quoted=quoteFontFamily(family);
    return ['serif','monospace'].some(fallback=>fingerprint(`${quoted},${fallback}`,sample)!==fingerprint(fallback,sample));
  };
}

export function classifyPcFontFamilies(families:readonly PcFontName[],probe:FontGlyphProbe=browserFontGlyphProbe()):PcFontFamily[] {
  return families.map(font=>{
    const {family}=font;
    const japanese=['あ','い','う','日本語'].every(sample=>probe(family,sample));
    const support:PcFontSupport=japanese?'japanese':probe(family,'012abcABC')?'other':'unreadable';
    return {...font,support};
  });
}

/** Merge local results with built-ins/current values without hiding a chosen font. */
export function mergeFontFamilyCatalog(local:readonly PcFontFamily[],extras:readonly string[]=[]):PcFontFamily[] {
  const families=new Map(local.map(font=>[font.family,{...font}]));
  for(const family of BUBBLE_FONT_PRESETS)families.set(family,{...families.get(family),family,support:'japanese'});
  for(const family of extras.map(value=>value.trim()).filter(Boolean))if(!families.has(family))families.set(family,{family,support:'other'});
  return [...families.values()].sort((a,b)=>(a.displayName??a.family).localeCompare(b.displayName??b.family,'ja')||a.family.localeCompare(b.family,'ja'));
}

const SEMANTIC_FAMILIES: Record<string, string> = {
  'アンチック体': '"I-OTFアンチックStd B", "I-OTFアンチックStd", "Iwata Antic Std B", "Iwata Antic Std", "FOT-アンチックStd B", "A-OTF アンチックStd B", "Yu Mincho", "Hiragino Mincho ProN", serif',
  '明朝体': '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif',
  'ゴシック体': '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
  'BIZ UDP明朝': '"BIZ UDPMincho", "BIZ UDP明朝", "Yu Mincho", serif',
  'BIZ UDPゴシック': '"BIZ UDPGothic", "BIZ UDPゴシック", "Yu Gothic", sans-serif',
  'Noto Serif JP': '"Noto Serif JP", "Yu Mincho", serif',
  'Noto Sans JP': '"Noto Sans JP", "Yu Gothic", sans-serif',
};

/** 端末にある任意の書体名も、そのままCSSプレビューへ使用する。 */
export function bubbleCssFontFamily(font: string | undefined): string {
  const name = font?.trim() || 'アンチック体';
  return SEMANTIC_FAMILIES[name] ?? `${quoteFontFamily(name)}, "Yu Mincho", serif`;
}

function quoteFontFamily(name:string):string {
  return `"${name.replaceAll('\\','\\\\').replaceAll('"','\\"')}"`;
}
