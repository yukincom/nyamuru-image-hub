import type { TextInlineStyle, TextStyleRange, BBox, PaintDocument, VectorPath, PaintLayer, ImageContent, Bubble, ScreenText } from '../../types.ts';
import { paintColorInk } from '../paintColor.ts';
import { textStyleOf } from '../textStyle.ts';
import { type FontGlyphProbe, bubbleCssFontFamily, matchingFontWeight } from '../bubbleFonts.ts';
import { type FontFaceMetadata, readFontFaceMetadata } from '../fontNames.ts';

/** Text/JSON/SVG data is UTF-8; original-image data is an image data URL. */
export interface ClipExportSource { kind:'nyamuru-paint'|'nyamuru-text'|'svg'|'original-image'; name:string; data:string; mediaType:string }

/** White RGB, alpha = coverage. Pixels outside this rectangle are hidden. */
export interface ClipExportMask { png:string; x:number; y:number }

export interface ClipExportLayerBase {
  id:string; name:string; visible:boolean; locked:boolean; opacity:number; blend:'normal'|'multiply';
  mask?:ClipExportMask; sources?:ClipExportSource[];
}

export interface ClipExportFolder extends ClipExportLayerBase { kind:'folder'; children:ClipExportLayer[]; passThrough?:boolean }

export interface ClipExportRaster extends ClipExportLayerBase { kind:'raster'; png:string; x:number; y:number }

export interface ClipExportText extends ClipExportLayerBase, TextInlineStyle {
  kind:'text'; text:string; frame:[number,number,number,number]; fontSizePt:number; vertical:boolean;
  color:[number,number,number]; font?:{name:string;postscript:string;syntheticBold?:boolean;syntheticItalic?:boolean}; lineSpacing?:number;
  styleRuns?:TextStyleRange[]; textAlign?:'left'|'center'|'right';
}

export interface ClipExportLine { points:Array<[number,number,number]>; closed:boolean; widthPx:number; color:[number,number,number] }

export interface ClipExportVector extends ClipExportLayerBase { kind:'vector'; lines:ClipExportLine[] }

export type ClipExportLayer = ClipExportFolder|ClipExportRaster|ClipExportText|ClipExportVector;

export interface ClipExportPage {
  profile:'nyamuru-clip-v1'; width:number; height:number; dpi:number; title:string; page:number;
  layers:ClipExportLayer[]; preview?:string; warnings:string[];
}

export const base=(id:string,name:string):ClipExportLayerBase=>({id,name,visible:true,locked:false,opacity:1,blend:'normal'});

export const folder=(id:string,name:string,children:ClipExportLayer[],extra:Partial<ClipExportFolder>={}):ClipExportFolder=>({...base(id,name),kind:'folder',children,passThrough:true,...extra});

export const jsonSource=(kind:'nyamuru-paint'|'nyamuru-text',name:string,value:unknown):ClipExportSource=>({kind,name:`${name}.json`,data:JSON.stringify(value),mediaType:'application/json'});

const color=(hex:string):[number,number,number]=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];

export const boxPoints=(box:BBox):Array<[number,number]>=>[[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]];

export const bounds=(points:readonly (readonly number[])[]):BBox=>{
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
};

/** Preserve local paint pixels independently of their current display DPI. */
export function clipExportPoint(point:{x:number;y:number},paint:Pick<PaintDocument,'width'|'height'>,frame:BBox,page:{w:number;h:number},output:{width:number;height:number}):[number,number] {
  return [(frame.x+point.x*frame.w/paint.width)*output.width/page.w,(frame.y+point.y*frame.h/paint.height)*output.height/page.h];
}

/** Adaptive cubic subdivision in output pixels; handles remain in the saved JSON source. */
export function clipExportVectorLines(paths:readonly VectorPath[],paint:Pick<PaintDocument,'width'|'height'>,frame:BBox,page:{w:number;h:number},output:{width:number;height:number},mode?:PaintLayer['colorMode']):ClipExportLine[] {
  const result:ClipExportLine[]=[];
  const map=(p:{x:number;y:number})=>clipExportPoint(p,paint,frame,page,output);
  const middle=(a:number[],b:number[])=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const distance=(p:number[],a:number[],b:number[])=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],lengthSquared=dx*dx+dy*dy;
    const t=lengthSquared?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/lengthSquared)):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  };
  for(const path of paths){
    if(!path.style.stroke||!path.nodes.length)continue;
    const points:Array<[number,number,number]>=[],first=map(path.nodes[0]);points.push([...first,1]);
    const flatten=(a:number[],b:number[],c:number[],d:number[],depth=0)=>{
      if(points.length>=65535)throw new Error('CLIPへ書き出す曲線が複雑すぎます');
      if(depth>=16||Math.max(distance(b,a,d),distance(c,a,d))<=.2){points.push([d[0],d[1],1]);return;}
      const ab=middle(a,b),bc=middle(b,c),cd=middle(c,d),abc=middle(ab,bc),bcd=middle(bc,cd),mid=middle(abc,bcd);
      flatten(a,ab,abc,mid,depth+1);flatten(mid,bcd,cd,d,depth+1);
    };
    const count=path.closed?path.nodes.length:path.nodes.length-1;
    for(let index=0;index<count;index++){
      const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];
      flatten(map(a),map({x:a.x+(a.handleOut?.x??0),y:a.y+(a.handleOut?.y??0)}),map({x:b.x+(b.handleIn?.x??0),y:b.y+(b.handleIn?.y??0)}),map(b));
    }
    if(points.length===1)points.push([...points[0]]);
    const sx=frame.w/paint.width*output.width/page.w,sy=frame.h/paint.height*output.height/page.h;
    result.push({points,closed:path.closed,widthPx:path.style.width*Math.sqrt(Math.abs(sx*sy)),color:color(paintColorInk(path.style.stroke,mode)!)});
  }
  return result;
}

/** A placement may show a cropped/contained portion of an unchanged paint document. */
export function clipExportPlacementFrame(image:Pick<ImageContent,'crop'>,box:BBox,size:{width:number;height:number}):{frame:BBox;crop:BBox} {
  const c=image.crop,scale=Math.min(box.w/c.w,box.h/c.h);
  const crop={x:box.x+(box.w-c.w*scale)/2,y:box.y+(box.h-c.h*scale)/2,w:c.w*scale,h:c.h*scale};
  return {frame:{x:crop.x-c.x*scale,y:crop.y-c.y*scale,w:size.width*scale,h:size.height*scale},crop};
}

/** Stable text metadata; actual glyph bounds are measured by the browser below. */
export function clipExportTextStyle(item:Bubble|ScreenText,kind:'bubble'|'screen_text',defaultFont:string) {
  const style=textStyleOf(item,kind);
  return {fontFamily:style.font??defaultFont,fontSizePt:style.fontSize!,vertical:style.orientation==='vertical',
    lineSpacing:(style.lineHeight??(kind==='bubble'?1.05:1.15))*100,fontWeight:style.fontWeight??(kind==='bubble'?600:700),
    italic:style.italic??false,underline:style.underline??false,strikethrough:style.strikethrough??false,
    textAlign:style.textAlign??'left',...(item.text_runs?.length?{styleRuns:structuredClone(item.text_runs)}:{})};
}

export interface ClipExportLocalFont { family:string; fullName?:string; postscriptName?:string; style?:string; blob?:()=>Promise<Blob> }

/** Export never opens a new font permission prompt. */
export async function clipExportLocalFonts(target:Window=window,permissions:Pick<Permissions,'query'>|undefined=navigator.permissions):Promise<ClipExportLocalFont[]> {
  const query=(target as Window&{queryLocalFonts?:()=>Promise<ClipExportLocalFont[]>}).queryLocalFonts;
  if(!query||!permissions)return [];
  try{if((await permissions.query({name:'local-fonts' as PermissionName})).state!=='granted')return [];return await query.call(target);}catch{return [];}
}

/** Use glyph evidence for CSS aliases; an absent family also passes fonts.check(). */
export async function clipExportFont(font:string,text:string,weight:number,italic:boolean,probe:FontGlyphProbe,faces:readonly ClipExportLocalFont[]=[]):Promise<{font:NonNullable<ClipExportText['font']>;warning?:string}> {
  const candidates=[...bubbleCssFontFamily(font).matchAll(/"([^"\\]+)"/g)].map(match=>match[1]);
  const sample=text.replace(/\s/g,'').slice(0,32)||'あ',family=candidates.find(candidate=>probe(candidate,sample))??font;
  const related=faces.filter(face=>face.family===family||face.fullName===family),read=await Promise.all(related.map(async face=>{
    let metadata:FontFaceMetadata={};try{if(face.blob)metadata=await readFontFaceMetadata(await face.blob(),face.family,face.postscriptName);}catch{/* Keep the family when a face cannot be read. */}
    const style=face.style??'',fallbackWeight=/black|heavy/i.test(style)?900:/extra.?bold|ultra.?bold/i.test(style)?800:/semi.?bold|demi/i.test(style)?600:/bold/i.test(style)?700:/extra.?light|ultra.?light/i.test(style)?200:/light/i.test(style)?300:/thin/i.test(style)?100:400;
    return {face,weight:metadata.weight??fallbackWeight,italic:metadata.italic??/italic|oblique/i.test(style),width:metadata.width??5};
  }));
  const styled=read.filter(item=>item.italic===italic),styles=styled.length?styled:read;
  const normal=styles.filter(item=>item.width===5),choices=normal.length?normal:styles;
  const matchedWeight=matchingFontWeight(weight,choices.map(item=>({value:item.weight,label:item.face.style??''}))),selected=choices.find(item=>item.weight===matchedWeight);
  const native={name:selected?.face.fullName||family,postscript:selected?.face.postscriptName||family,
    syntheticBold:weight>=600&&!(selected&&selected.weight>=600),syntheticItalic:italic&&!selected?.italic};
  return {font:native,...(!selected?.face.postscriptName?{warning:`書体「${family}」はファミリー名で保持しました。CLIP STUDIO側の導入書体により置き換わる場合があります。`}:{})};
}
