import type { BBox, Bubble, ImageAsset, ImageContent, Manga, PaintDocument, PaintLayer, Panel, ScreenText, TextInlineStyle, TextStyleRange, VectorPath } from '../types.ts';
import { getPrintSetup } from './printSettings.ts';
import { pageExportPixels } from './pageExport.ts';
import { fallbackBox, panelShapePoints } from './canvasGeometry.ts';
import { overlayFallbackBox, overlayTextFallbackBox } from './pageCanvas.ts';
import { paintAnchorIds, paintLayerTree, paintNativeBand, paintReferenceBox, paintScene, directPaintImages, type PaintOwner, type PaintLayerTreeEntry } from './paintDocument.ts';
import { panelArtKeys, bubbleArtIndices, panelFrameSegments } from './panelLayers.ts';
import { letteringFigureIndex, resolveBubbleSpeakerFigureIndex } from './bubbleRelations.ts';
import { bubbleTextPosition, compatibleBubbleClips } from './bubbleClip.ts';
import { bubbleStrokeWidthMm, bubbleUsesMonologueTail, letteringGuideVisible } from './bubblePresentation.ts';
import { textStyleOf, textStyleSegments } from './textStyle.ts';
import { bubbleCssFontFamily, browserFontGlyphProbe, matchingFontWeight, type FontGlyphProbe } from './bubbleFonts.ts';
import { readFontFaceMetadata, type FontFaceMetadata } from './fontNames.ts';
import { paintColorInk, paintColorMode } from './paintColor.ts';
import { readPaintPixels, readPaintMaskPixels, loadPaintImages, decodePaintImage } from './paintRenderer.ts';
import { loadFigureCropAsset } from './figureCropStore.ts';

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

const base=(id:string,name:string):ClipExportLayerBase=>({id,name,visible:true,locked:false,opacity:1,blend:'normal'});
const folder=(id:string,name:string,children:ClipExportLayer[],extra:Partial<ClipExportFolder>={}):ClipExportFolder=>({...base(id,name),kind:'folder',children,passThrough:true,...extra});
const jsonSource=(kind:'nyamuru-paint'|'nyamuru-text',name:string,value:unknown):ClipExportSource=>({kind,name:`${name}.json`,data:JSON.stringify(value),mediaType:'application/json'});
const color=(hex:string):[number,number,number]=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
const boxPoints=(box:BBox):Array<[number,number]>=>[[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]];
const bounds=(points:readonly (readonly number[])[]):BBox=>{
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

function canvas(width:number,height:number):HTMLCanvasElement {
  width=Math.max(1,Math.ceil(width));height=Math.max(1,Math.ceil(height));
  if(width>30000||height>30000||width*height>100_000_000)throw new Error('CLIPへ書き出すレイヤーが大きすぎます');
  const out=document.createElement('canvas');out.width=width;out.height=height;return out;
}
function context(target:HTMLCanvasElement):CanvasRenderingContext2D {
  const result=target.getContext('2d',{willReadFrequently:true});if(!result)throw new Error('CLIP書き出し用の描画領域を作れません');return result;
}
function release(target:HTMLCanvasElement){target.width=target.height=1;}
function dataUrl(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('元画像を読み出せません'));reader.readAsDataURL(blob);});}
async function loadUrl(url:string):Promise<HTMLImageElement>{const image=new Image();image.src=url;await image.decode();return image;}

/** Export is a detached read: no mutator, history checkpoint, or asset-store writer is called. */
export async function buildClipExportPage(manga:Manga,pageIndex:number):Promise<ClipExportPage> {
  const page=structuredClone(manga.pages[pageIndex]);
  if(!page||![page.canvas.w,page.canvas.h].every(value=>Number.isFinite(value)&&value>0))throw new Error('書き出すページが見つかりません');
  const setup=getPrintSetup(manga),size=pageExportPixels(setup.width_mm,setup.height_mm,setup.dpi),assets=manga.image_assets??[];
  const output:ClipExportPage={profile:'nyamuru-clip-v1',...size,dpi:setup.dpi,title:manga.meta.title||'manga',page:page.page,layers:[],warnings:[]};
  const sx=size.width/page.canvas.w,sy=size.height/page.canvas.h;
  const point=([x,y]:readonly number[]):[number,number]=>[x*sx,y*sy];
  const toPixelBox=(box:BBox):BBox=>({x:box.x*sx,y:box.y*sy,w:box.w*sx,h:box.h*sy});
  const warn=(message:string)=>{if(!output.warnings.includes(message))output.warnings.push(message);};
  const previewImages=new Map<string,ClipExportRaster>(),maskCache=new Map<string,ClipExportMask>(),originals=new Set<string>();
  if(document.fonts)await document.fonts.ready;
  const fontProbe=browserFontGlyphProbe(),localFonts=await clipExportLocalFonts(),resolvedFonts=new Map<string,Promise<Awaited<ReturnType<typeof clipExportFont>>>>();

  const polygonMask=(points:Array<[number,number]>):ClipExportMask=>{
    const key=JSON.stringify(points),cached=maskCache.get(key);if(cached)return cached;
    const b=bounds(points),x=Math.floor(b.x),y=Math.floor(b.y),surface=canvas(Math.ceil(b.x+b.w)-x,Math.ceil(b.y+b.h)-y);
    try{const ctx=context(surface);ctx.fillStyle='#ffffff';ctx.beginPath();points.forEach((p,index)=>index?ctx.lineTo(p[0]-x,p[1]-y):ctx.moveTo(p[0]-x,p[1]-y));ctx.closePath();ctx.fill();
      const mask={png:surface.toDataURL('image/png'),x,y};maskCache.set(key,mask);return mask;
    }finally{release(surface);}
  };
  const sourceImage=async(asset:ImageAsset|undefined):Promise<ClipExportSource[]>=>{
    if(!asset)throw new Error('書き出す元画像の登録がありません');
    if(originals.has(asset.id))return [];
    const blob=await loadFigureCropAsset(asset.storageId);
    if(!blob||blob.size!==asset.byteLength)throw new Error(`元画像「${asset.originalName}」を読み出せません`);
    originals.add(asset.id);return [{kind:'original-image',name:`${asset.id}-${asset.originalName}`,mediaType:asset.mediaType,data:await dataUrl(blob)}];
  };
  const rasterFromPixels=(pixels:ImageData,frame:BBox,id:string,name:string,trim=true):ClipExportRaster=>{
    let minX=0,minY=0,maxX=pixels.width,maxY=pixels.height;
    if(trim){minX=pixels.width;minY=pixels.height;maxX=maxY=0;
      for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++)if(pixels.data[(y*pixels.width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+1);maxY=Math.max(maxY,y+1);}
      if(maxX===0){minX=minY=0;maxX=maxY=1;}
    }
    const native=canvas(maxX-minX,maxY-minY),px=toPixelBox(frame),left=px.x+minX/pixels.width*px.w,top=px.y+minY/pixels.height*px.h;
    const x=Math.floor(left),y=Math.floor(top),width=(maxX-minX)/pixels.width*px.w,height=(maxY-minY)/pixels.height*px.h;
    const scaled=canvas(Math.ceil(left+width)-x,Math.ceil(top+height)-y);
    try{context(native).putImageData(pixels,-minX,-minY);const ctx=context(scaled);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(native,left-x,top-y,width,height);
      return {...base(id,name),kind:'raster',png:scaled.toDataURL('image/png'),x,y};
    }finally{release(native);release(scaled);}
  };
  const paintMask=(paint:PaintDocument,layer:PaintLayer,frame:BBox):ClipExportMask|undefined=>{
    if(!layer.mask?.enabled&&!layer.clip)return;
    const coverage=layer.mask?.enabled?readPaintMaskPixels(paint,layer):new ImageData(paint.width,paint.height);
    if(!layer.mask?.enabled)for(let index=0;index<coverage.data.length;index+=4)coverage.data.set([255,255,255,255],index);
    for(let y=0;y<paint.height;y++)for(let x=0;x<paint.width;x++){
      const at=(y*paint.width+x)*4;coverage.data[at]=coverage.data[at+1]=coverage.data[at+2]=255;
      if(layer.clip&&(x<layer.clip.x||x>=layer.clip.x+layer.clip.w||y<layer.clip.y||y>=layer.clip.y+layer.clip.h))coverage.data[at+3]=0;
    }
    const result=rasterFromPixels(coverage,frame,'mask','mask',false);return {png:result.png,x:result.x,y:result.y};
  };
  const emitPaint=async(paint:PaintDocument,frame:BBox,prefix:string,owner?:PaintOwner):Promise<ClipExportLayer[]>=>{
    const detached=structuredClone(paint),pending=new Map<string,Blob>(),localAssets=[...assets];
    for(let index=0;index<detached.layers.length;index++){
      const layer=detached.layers[index];
      if(layer.guide&&!layer.image&&owner){
        const prepared=await (await import('./paintGuide.ts')).prepareGuideLayer({...owner,paint:detached},layer);
        detached.layers[index]=prepared.layer;localAssets.push(prepared.asset);pending.set(prepared.asset.id,prepared.blob);
      }
    }
    const images=await loadPaintImages([detached],localAssets,pending);
    const emit=async(entries:PaintLayerTreeEntry[]):Promise<ClipExportLayer[]>=>{
      const result:ClipExportLayer[]=[];
      for(const entry of entries){
        if(entry.kind==='folder'){
          result.push(folder(`${prefix}/folder-${entry.folder.id}`,entry.folder.name,await emit(entry.children),{visible:entry.folder.visible!==false,locked:entry.folder.locked===true}));continue;
        }
        const layer=entry.layer,id=`${prefix}/${layer.id}`,attributes={...base(id,layer.name),visible:layer.generationMask?false:layer.visible,locked:layer.locked,opacity:layer.opacity,blend:layer.blend};
        const sources=[jsonSource('nyamuru-paint',layer.name,{width:paint.width,height:paint.height,dpi:paint.dpi,frame,layer})];
        if(layer.image){const asset=localAssets.find(item=>item.id===layer.image!.assetId);if(asset){
          const generated=pending.get(asset.id);
          if(generated)sources.push({kind:'original-image',name:`${asset.id}-${asset.originalName}`,mediaType:asset.mediaType,data:await dataUrl(generated)});
          else sources.push(...await sourceImage(asset));
        }}
        if(layer.generationMask)warn('生成範囲の作業レイヤーは、原稿へ重ならないよう非表示で保持しました。');
        const paths=layer.paths??[],lines=clipExportVectorLines(paths,detached,frame,page.canvas,size,layer.colorMode);
        const simple=layer.kind==='vector'&&lines.length===paths.length&&!layer.image&&!layer.strokes.length&&!layer.tone?.enabled&&!layer.tone?.fill
          &&paths.every(path=>!path.style.fill&&path.style.profile==='uniform'&&path.style.alignment==='center'&&!path.style.dash.length&&path.style.cap==='round'&&path.style.join==='round'&&path.style.arrowStart==='none'&&path.style.arrowEnd==='none');
        const mask=paintMask(detached,layer,frame);
        if(simple){result.push({...attributes,kind:'vector',lines,...(mask?{mask}:{}),sources});continue;}
        const raster=rasterFromPixels(readPaintPixels(detached,{...layer,mask:undefined,clip:undefined},images),frame,`${id}/pixels`,layer.name);
        if(lines.length){
          const visible={...raster,name:`表示用 ${layer.name}`},editable:ClipExportVector={...base(`${id}/editable`,`編集用 ${layer.name}の線`),kind:'vector',visible:false,lines};
          result.push(folder(id,layer.name,[visible,editable],{...attributes,...(mask?{mask}:{}),sources,passThrough:false}));
          warn('塗り・特殊な線・画像を含むベクターレイヤーは表示用画像と非表示の編集用線に分け、元の描画情報も同梱しました。');
        }else result.push({...raster,...attributes,kind:'raster',...(mask?{mask}:{}),sources});
      }
      return result;
    };
    try{const layers=await emit(paintLayerTree(detached));if(layers[0])layers[0].sources=[...(layers[0].sources??[]),jsonSource('nyamuru-paint',`${prefix}-document`,{frame,paint})];return layers;}finally{images.forEach(image=>{image.src='';});}
  };
  const emitPlacement=async(image:ImageContent,box:BBox,id:string,name:string,band?:boolean,owner?:PaintOwner):Promise<ClipExportLayer>=>{
    const sourcePaint=image.paint&&(band===undefined?image.paint:paintNativeBand(image.paint,band));
    const asset=assets.find(asset=>asset.id===image.assetId);
    const dimensions=sourcePaint??{width:asset?.widthPx??image.crop.w,height:asset?.heightPx??image.crop.h};
    const placement=clipExportPlacementFrame(image,box,dimensions);
    let children:ClipExportLayer[];
    if(sourcePaint)children=await emitPaint(sourcePaint,placement.frame,id,owner);
    else{
      if(!asset)throw new Error('配置画像の元データが見つかりません');
      const blob=await loadFigureCropAsset(asset.storageId);if(!blob||blob.size!==asset.byteLength)throw new Error(`元画像「${asset.originalName}」を読み出せません`);
      const decoded=await decodePaintImage(blob),crop=image.crop,surface=canvas(Math.max(1,Math.round(placement.crop.w*sx)),Math.max(1,Math.round(placement.crop.h*sy)));
      try{context(surface).drawImage(decoded,crop.x,crop.y,crop.w,crop.h,0,0,surface.width,surface.height);
        children=[rasterFromPixels(context(surface).getImageData(0,0,surface.width,surface.height),placement.crop,`${id}/pixels`,name)];
      }finally{decoded.src='';release(surface);}
    }
    const sources=[jsonSource('nyamuru-paint',name,{frame:box,image})];
    if(!sourcePaint)sources.push(...await sourceImage(asset));
    return folder(id,name,children,{visible:!image.hidden,locked:image.locked,opacity:image.opacity,mask:polygonMask(boxPoints(placement.crop).map(point)),sources,passThrough:false});
  };

  const emitText=async(item:Bubble|ScreenText,kind:'bubble'|'screen_text',box:BBox,id:string,name:string):Promise<ClipExportLayer>=>{
    const style=clipExportTextStyle(item,kind,manga.meta.font),fontSize=style.fontSizePt*setup.dpi/72;
    // Match BubbleText: explicit line breaks, fixed size, no fitting/wrapping.
    const host=document.createElement('div');Object.assign(host.style,{position:'fixed',left:'-100000px',top:'0',pointerEvents:'none',visibility:'hidden'});
    const content=document.createElement('span');Object.assign(content.style,{display:'inline-block',width:'max-content',height:'max-content',whiteSpace:'pre',fontFamily:bubbleCssFontFamily(style.fontFamily),fontSize:`${fontSize}px`,fontWeight:String(style.fontWeight),fontStyle:style.italic?'italic':'normal',lineHeight:String(style.lineSpacing/100),writingMode:style.vertical?'vertical-rl':'horizontal-tb',textOrientation:'upright',textAlign:style.textAlign});
    for(const part of textStyleSegments(item)){const span=document.createElement('span');span.textContent=part.text;span.style.fontWeight=String(part.fontWeight??style.fontWeight);span.style.fontStyle=(part.italic??style.italic)?'italic':'normal';span.style.textDecorationLine=[(part.underline??style.underline)?'underline':'',(part.strikethrough??style.strikethrough)?'line-through':''].filter(Boolean).join(' ');content.append(span);}
    host.append(content);document.body.append(host);
    let width:number,height:number,preview:ClipExportRaster;
    try{
      const rect=content.getBoundingClientRect();width=Math.max(fontSize,rect.width);height=Math.max(fontSize,rect.height);
      const b=toPixelBox(box),position=kind==='bubble'?bubbleTextPosition(item as Bubble):undefined;
      const x=position?b.x+b.w*position.x-width/2:style.vertical?b.x+b.w-width:b.x,y=position?b.y+b.h*position.y-height/2:b.y;
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',String(Math.ceil(width+4)));svg.setAttribute('height',String(Math.ceil(height+4)));
      const foreign=document.createElementNS(svg.namespaceURI,'foreignObject');foreign.setAttribute('x','2');foreign.setAttribute('y','2');foreign.setAttribute('width',String(Math.ceil(width)));foreign.setAttribute('height',String(Math.ceil(height)));
      const copy=content.cloneNode(true) as HTMLElement;copy.setAttribute('xmlns','http://www.w3.org/1999/xhtml');copy.style.color='#111111';foreign.append(copy);svg.append(foreign);
      const svgText=new XMLSerializer().serializeToString(svg),url=`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
      const image=await loadUrl(url),surface=canvas(width+4,height+4);
      try{context(surface).drawImage(image,0,0);preview={...base(`${id}/display`,`表示用 ${name}`),kind:'raster',png:surface.toDataURL('image/png'),x:Math.floor(x-2),y:Math.floor(y-2)};}
      finally{image.src='';release(surface);}
      const {fontFamily,...metadata}=style;
      const native:ClipExportText={...base(id,name),kind:'text',text:item.text,frame:[Math.floor(x),Math.floor(y),Math.ceil(x+width),Math.ceil(y+height)],...metadata,color:[17,17,17],font:{name:fontFamily,postscript:fontFamily},visible:item.hidden!==true&&(kind!=='bubble'||letteringGuideVisible(item as Bubble)),locked:kind==='bubble'&&(item as Bubble).nativeLocked===true,
        sources:[jsonSource('nyamuru-text',name,{kind,box,item})]};
      const fontKey=JSON.stringify([fontFamily,style.fontWeight,style.italic,item.text]);
      let resolved=resolvedFonts.get(fontKey);if(!resolved){resolved=clipExportFont(fontFamily,item.text,style.fontWeight,style.italic,fontProbe,localFonts);resolvedFonts.set(fontKey,resolved);}
      const resolvedFont=await resolved;native.font=resolvedFont.font;if(resolvedFont.warning)warn(resolvedFont.warning);
      previewImages.set(id,preview);
      if(item.text_runs?.length||style.underline||style.strikethrough){
        warn('部分書式・下線・取り消し線を含む文字は表示用画像と非表示の編集用文字に分け、書式つき元テキストを同梱しました。');
        return folder(id,name,[preview,{...native,id:`${id}/editable`,name:`編集用 ${name}`,visible:false}],{visible:native.visible,locked:native.locked,sources:native.sources,passThrough:false});
      }
      return native;
    }finally{host.remove();}
  };

  const tail=await import('./bubbleTail.ts');
  const [{h,render},{default:BubbleShapeSvg}]=await Promise.all([import('preact'),import('../components/BubbleShapeSvg')]);
  type Scope={panel:Panel;prefix:string;overlay:boolean;owners:PaintOwner[];mask?:ClipExportMask;anchors:Record<string,string>};
  const makeScope=(panel:Panel,prefix:string,overlay=false):Scope=>({panel,prefix,overlay,
    owners:paintScene(panel,setup.dpi,assets,paintColorMode(setup.format),overlay?'page':'panel',overlay?page.panels:undefined).owners,
    ...(overlay?{}:{mask:polygonMask(panelShapePoints(panel).map(point))}),anchors:paintAnchorIds(panel,overlay?page.panels:undefined)});
  const scopes=page.panels.map((panel,index)=>makeScope(panel,`panel-${index}`));
  const overlayPanel:Panel={id:0,shape:{type:'rect',x:0,y:0,w:page.canvas.w,h:page.canvas.h},bg:0,action:null,layer:page.layer,
    figures:page.page_overlay?.figures?.map((figure,index)=>({...figure,bbox:figure.bbox??overlayFallbackBox(page.canvas,'figure',index)})),
    bubbles:(page.page_overlay?.bubbles??[]).map((bubble,index)=>({...bubble,bbox:bubble.bbox??overlayFallbackBox(page.canvas,'bubble',index)})),
    screen_text:page.page_overlay?.screen_text?.map((item,index)=>({...item,bbox:item.bbox??overlayTextFallbackBox(page.canvas,index)})),
    images:page.images?.filter(image=>image.paintScope==='page'||image.bubbleOriginal)};
  const overlay=makeScope(overlayPanel,'page',true);
  const scopeFolder=(scope:Scope,phase:string,children:ClipExportLayer[]):ClipExportFolder=>folder(`${scope.prefix}/${phase}`,scope.overlay?phase:`コマ ${scope.panel.id} · ${phase}`,children,{visible:scope.panel.layer?.hidden!==true,locked:scope.panel.layer?.locked===true,...(scope.mask?{mask:scope.mask}:{})});
  const emitDirect=async(scope:Scope,stack?:import('../types.ts').PaintStackPosition):Promise<ClipExportLayer[]>=>{
    const list:ClipExportLayer[]=[];
    for(const image of directPaintImages(scope.panel.images,scope.overlay?'page':'panel',stack,scope.anchors))list.push(await emitPlacement(image,image.bbox,`${scope.prefix}/direct-${image.id}`,scope.overlay?'コマ外描画':'コマ内描画'));
    return list;
  };
  const itemBox=(scope:Scope,kind:'bubble'|'figure',index:number):BBox=>{
    const item=kind==='bubble'?scope.panel.bubbles[index]:scope.panel.figures![index],image='text' in item?item.paint_overlay:item.artwork;
    return paintReferenceBox(image?.paint,item.bbox??fallbackBox(scope.panel,kind,index),image?.crop);
  };
  const emitBubbleShape=async(scope:Scope,index:number):Promise<ClipExportLayer|undefined>=>{
    const bubble=scope.panel.bubbles[index],box=itemBox(scope,'bubble',index),stroke=bubbleStrokeWidthMm(bubble,manga.meta.bubble_line_width_mm),id=`${scope.prefix}/bubble-${index}/shape`;
    if(bubble.shape==='typeset')return;
    let composite:import('./bubbleTail.ts').BubbleTailComposite|null=null;
    const seamMasks:import('./bubbleTail.ts').BubbleSeamMask[]=[],connections:string[]=[],boxes=[box];
    const speaker=resolveBubbleSpeakerFigureIndex(scope.panel,bubble);
    if(!tail.bubbleTailDisabled(bubble)&&speaker!==null){
      const target=tail.bubbleTailTargetPoint(itemBox(scope,'figure',speaker),bubble.tail);boxes.push({x:target.x,y:target.y,w:1,h:1});
      if(bubbleUsesMonologueTail(bubble))for(const ellipse of tail.monologueTailEllipses(box,target,bubble.bezier,bubble.tail_root))connections.push(`<ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="white" stroke="#111111" stroke-width="${stroke}"/>`);
      else composite=tail.bubbleTailComposite(box,target,bubble.shape??'normal',bubble.bezier,bubble.tail_root);
    }
    for(let other=0;other<scope.panel.bubbles.length;other++){
      const first=scope.panel.bubbles[other],target=Number(first.join_to)-1;
      if(!Number.isInteger(target)||target<0||target>=other||first.hidden||scope.panel.bubbles[target].hidden||!compatibleBubbleClips(first,scope.panel.bubbles[target]))continue;
      const join=tail.bubbleJoinGeometry(itemBox(scope,'bubble',other),first.shape??'normal',itemBox(scope,'bubble',target),scope.panel.bubbles[target].shape??'normal',first.bezier,scope.panel.bubbles[target].bezier);
      if(!join)continue;
      if(index===other){seamMasks.push(join.firstSeamMask);boxes.push(itemBox(scope,'bubble',target));if(join.fillPath)connections.push(`<path d="${join.fillPath}" fill="white"/>`);connections.push(...join.outlinePaths.map(d=>`<path d="${d}" fill="none" stroke="#111111" stroke-width="${stroke}"/>`));}
      if(index===target)seamMasks.push(join.secondSeamMask);
    }
    const host=document.createElement('div');
    try{
      render(h(BubbleShapeSvg,{shape:bubble.shape,bezier:bubble.bezier,composite:composite??undefined,seamMasks,maskId:`clip-${scope.prefix}-${index}`}),host);
      const body=host.querySelector('svg');if(!body)return;
      body.setAttribute('x',String(box.x));body.setAttribute('y',String(box.y));body.setAttribute('width',String(box.w));body.setAttribute('height',String(box.h));body.setAttribute('overflow','visible');
      body.querySelectorAll('.bubble-svg-surface').forEach(element=>{element.setAttribute('fill','white');element.setAttribute('stroke','none');});
      body.querySelectorAll('.bubble-svg-outline-surface,.bubble-svg-detail').forEach(element=>{element.setAttribute('fill','none');element.setAttribute('stroke','#111111');element.setAttribute('stroke-width',String(stroke*sx));element.setAttribute('vector-effect','non-scaling-stroke');});
      if(composite){const b=composite.bounds;boxes.push({x:box.x+b.x/100*box.w,y:box.y+b.y/100*box.h,w:b.w/100*box.w,h:b.h/100*box.h});}
      const union=bounds(boxes.flatMap(boxPoints)),frame={x:union.x-stroke,y:union.y-stroke,w:union.w+stroke*2,h:union.h+stroke*2};
      const width=Math.max(1,Math.ceil(frame.w*sx)),height=Math.max(1,Math.ceil(frame.h*sy));
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}">${connections.join('')}${new XMLSerializer().serializeToString(body)}</svg>`;
      const image=await decodePaintImage(new Blob([svg],{type:'image/svg+xml'})),surface=canvas(width,height);
      try{context(surface).drawImage(image,0,0);const raster=rasterFromPixels(context(surface).getImageData(0,0,width,height),frame,id,'フキダシの形');
        raster.visible=!bubble.hidden;raster.locked=bubble.nativeLocked===true;raster.sources=[{kind:'svg',name:`${scope.prefix}-bubble-${index}.svg`,data:svg,mediaType:'image/svg+xml'}];
        warn('フキダシの塗り・しっぽ・結合は表示用画像として保持し、編集原本のSVGを同梱しました。');return raster;
      }finally{image.src='';release(surface);}
    }finally{render(null,host);}
  };
  const emitBubbles=async(scope:Scope,related:number|null=null,depth:'front'|'behind'='front'):Promise<ClipExportLayer[]>=>{
    const result:ClipExportLayer[]=[];
    for(const index of bubbleArtIndices(scope.panel)){
      const bubble=scope.panel.bubbles[index];if(letteringFigureIndex(scope.panel,bubble)!==related||related!==null&&(bubble.lettering_depth??'front')!==depth)continue;
      result.push(...await emitDirect(scope,{below:`bubble-${index}`}));
      const id=`${scope.prefix}/bubble-${index}`,children:ClipExportLayer[]=[],box=itemBox(scope,'bubble',index),shape=await emitBubbleShape(scope,index);
      if(shape)children.push(shape);
      const owner=scope.owners.find(owner=>owner.key===`bubble-${index}`)!;
      if(bubble.paint_overlay)children.push(await emitPlacement(bubble.paint_overlay,bubble.bbox??fallbackBox(scope.panel,'bubble',index),`${id}/below`,'文字の下の描画',false,owner));
      else if(owner.paint.layers.length)children.push(...await emitPaint(owner.paint,owner.frame,`${id}/source`,owner));
      children.push(await emitText(bubble,'bubble',box,`${id}/text`,`本文 ${index+1}`));
      const original=scope.panel.images?.find(image=>image.id===bubble.analogTextImport?.originalImageId);
      if(original){children.push(...await emitDirect(scope,{below:`original-${original.id}`}));children.push(await emitPlacement(original,original.bbox,`${id}/original`,original.bubbleOriginal?.name??'文字原本'));}
      if(bubble.paint_overlay)children.push(await emitPlacement(bubble.paint_overlay,bubble.bbox??fallbackBox(scope.panel,'bubble',index),`${id}/above`,'文字の上の描画',true,owner));
      result.push(folder(id,`テキスト ${index+1}`,children,{locked:bubble.locked===true,sources:[jsonSource('nyamuru-text',id,bubble)]}));
    }
    return result;
  };
  const emitFigure=async(scope:Scope,index:number):Promise<ClipExportLayer[]>=>{
    const figure=scope.panel.figures![index],id=`${scope.prefix}/figure-${index}`,owner=scope.owners.find(owner=>owner.key===`figure-${index}`)!,children:ClipExportLayer[]=[];
    if(figure.artwork)children.push(await emitPlacement(figure.artwork,figure.bbox??fallbackBox(scope.panel,'figure',index),`${id}/art`,figure.name||`人物 ${index+1}`,undefined,owner));
    else children.push(...await emitPaint(owner.paint,owner.frame,id,owner));
    return [...await emitBubbles(scope,index,'behind'),...await emitDirect(scope,{below:`figure-${index}`}),folder(id,figure.name||`人物 ${index+1}`,children,{locked:figure.locked===true,sources:[jsonSource('nyamuru-paint',id,figure)]}),...await emitBubbles(scope,index,'front')];
  };
  const emitScreenText=async(scope:Scope):Promise<ClipExportLayer[]>=>{
    const result:ClipExportLayer[]=[];
    for(const [index,item] of (scope.panel.screen_text??[]).entries()){
      result.push(...await emitDirect(scope,{below:`screen-text-${index}`}));
      result.push(await emitText(item,'screen_text',item.bbox??fallbackBox(scope.panel,'screen_text',index),`${scope.prefix}/screen-${index}`,`写植 ${index+1}`));
    }
    return result;
  };
  // Preserve the editor's global phases. A single folder per panel would move its
  // frame below a later overlapping panel's artwork and change the picture.
  for(const scope of scopes){
    const children:ClipExportLayer[]=[];
    for(const key of panelArtKeys(scope.panel)){
      if(key==='background'){
        children.push(...await emitDirect(scope,{below:key}));const images=scope.panel.background_images??[];
        const background:ClipExportLayer[]=[];
        for(const image of images)background.push(await emitPlacement(image,image.bbox,`${scope.prefix}/background/${image.id}`,'背景画像',undefined,scope.owners.find(owner=>owner.kind==='background')));
        if(!images.length){const owner=scope.owners.find(owner=>owner.kind==='background')!;background.push(...await emitPaint(owner.paint,owner.frame,`${scope.prefix}/background`,owner));}
        children.push(folder(`${scope.prefix}/background`,'背景あたり',background,{locked:scope.panel.layer?.backgroundLocked===true}));
      }else children.push(...await emitFigure(scope,Number(key.slice(7))));
    }
    for(const image of scope.panel.images??[])if(!image.paintScope&&!image.bubbleOriginal&&!image.generationScope)children.push(await emitPlacement(image,image.bbox,`${scope.prefix}/image-${image.id}`,'配置画像'));
    children.push(...await emitScreenText(scope));output.layers.push(scopeFolder(scope,'作画',children));
  }
  for(const image of page.images??[])if(!image.paintScope&&!image.bubbleOriginal&&!image.generationScope)output.layers.push(await emitPlacement(image,image.bbox,`page/image-${image.id}`,'ページ配置画像'));
  for(const scope of scopes)output.layers.push(scopeFolder(scope,'フキダシ',await emitBubbles(scope)));
  for(const scope of scopes)output.layers.push(scopeFolder(scope,'描画',await emitDirect(scope)));
  for(const scope of scopes){
    const lines:ClipExportLine[]=panelFrameSegments(scope.panel).map(segment=>({points:[[segment.x1*sx,segment.y1*sy,1],[segment.x2*sx,segment.y2*sy,1]],closed:false,widthPx:(manga.meta.panel_frame_width_mm||.5)*sx,color:[17,17,17]}));
    output.layers.push(folder(`${scope.prefix}/frame` ,`コマ ${scope.panel.id} · 枠`,[{...base(`${scope.prefix}/frame/lines`,'枠線'),kind:'vector',lines,visible:scope.panel.layer?.frameHidden!==true,locked:scope.panel.layer?.frameLocked===true}],{visible:scope.panel.layer?.hidden!==true,locked:scope.panel.layer?.locked===true}));
  }
  for(const panel of page.panels)output.layers.push(...await emitDirect(overlay,{beforePanel:`panel-${panel.id}`}));
  for(const key of panelArtKeys(overlay.panel))if(key.startsWith('figure-'))output.layers.push(...await emitFigure(overlay,Number(key.slice(7))));
  output.layers.push(...await emitScreenText(overlay),...await emitBubbles(overlay),...await emitDirect(overlay));
  for(const scope of scopes){const children:ClipExportLayer[]=[];for(const image of scope.panel.images??[])if(image.generationScope&&!image.paintScope&&!image.bubbleOriginal)children.push(await emitPlacement(image,image.bbox,`${scope.prefix}/generated-${image.id}`,'コマ生成画像'));if(children.length)output.layers.push(scopeFolder(scope,'生成画像',children));}
  for(const image of page.images??[])if(image.generationScope&&!image.paintScope&&!image.bubbleOriginal)output.layers.push(await emitPlacement(image,image.bbox,`page/generated-${image.id}`,'ページ生成画像'));
  for(const scope of [...scopes,overlay]){
    const children:ClipExportLayer[]=[];
    for(const image of scope.panel.images??[])if(image.bubbleOriginal&&!scope.panel.bubbles.some(bubble=>bubble.analogTextImport?.originalImageId===image.id)){
      children.push(...await emitDirect(scope,{below:`original-${image.id}`}));children.push(await emitPlacement(image,image.bbox,`${scope.prefix}/original-${image.id}`,image.bubbleOriginal.name));
    }
    if(children.length)output.layers.push(scopeFolder(scope,'原本',children));
  }
  output.preview=await previewClipExport(output,previewImages);
  return output;
}

/** Bounded thumbnail only. Full-resolution payload images remain independent. */
async function previewClipExport(page:ClipExportPage,textImages:Map<string,ClipExportRaster>):Promise<string>{
  const scale=Math.min(1,768/Math.max(page.width,page.height)),width=Math.max(1,Math.round(page.width*scale)),height=Math.max(1,Math.round(page.height*scale));
  const surface=canvas(width,height),ctx=context(surface);ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
  const draw=async(target:CanvasRenderingContext2D,layers:ClipExportLayer[])=>{
    for(const layer of layers){
      if(!layer.visible||layer.opacity<=0)continue;
      if(layer.kind==='folder'&&layer.passThrough&&!layer.mask&&layer.opacity===1&&layer.blend==='normal'){await draw(target,layer.children);continue;}
      const local=canvas(width,height),out=context(local);
      try{
        if(layer.kind==='folder')await draw(out,layer.children);
        else if(layer.kind==='raster'||layer.kind==='text'){
          const source=layer.kind==='raster'?layer:textImages.get(layer.id);if(source){const image=await loadUrl(source.png);try{out.drawImage(image,source.x*scale,source.y*scale,image.naturalWidth*scale,image.naturalHeight*scale);}finally{image.src='';}}
        }else for(const line of layer.lines){out.strokeStyle=`rgb(${line.color.join(',')})`;out.fillStyle=out.strokeStyle;out.lineWidth=line.widthPx*scale;out.lineCap='round';out.lineJoin='round';out.beginPath();line.points.forEach((p,i)=>i?out.lineTo(p[0]*scale,p[1]*scale):out.moveTo(p[0]*scale,p[1]*scale));if(line.closed)out.closePath();if(line.points.length===1){const p=line.points[0];out.arc(p[0]*scale,p[1]*scale,line.widthPx*scale/2,0,2*Math.PI);out.fill();}else out.stroke();}
        if(layer.mask){const image=await loadUrl(layer.mask.png);try{out.globalCompositeOperation='destination-in';const mask=canvas(width,height);try{context(mask).drawImage(image,layer.mask.x*scale,layer.mask.y*scale,image.naturalWidth*scale,image.naturalHeight*scale);out.drawImage(mask,0,0);}finally{release(mask);}}finally{image.src='';}}
        target.globalAlpha=layer.opacity;target.globalCompositeOperation=layer.blend==='multiply'?'multiply':'source-over';target.drawImage(local,0,0);target.globalAlpha=1;target.globalCompositeOperation='source-over';
      }finally{release(local);}
    }
  };
  try{await draw(ctx,page.layers);return surface.toDataURL('image/png');}finally{release(surface);}
}
