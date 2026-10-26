import type { PaintColorMode } from '../types.ts';

export type ImageExportFormat = 'png' | 'psd';
export type PageExportRange = {mode:'current'|'range'|'all';current:number;from:number;to:number};
export const MAX_PAGE_EXPORT_PIXELS = 100_000_000;

export function pageExportIndices(pageCount:number,range:PageExportRange):number[]{
  if(!Number.isInteger(pageCount)||pageCount<1)throw new Error('書き出すページがありません');
  const start=range.mode==='all'?1:range.mode==='current'?range.current:range.from;
  const end=range.mode==='all'?pageCount:range.mode==='current'?range.current:range.to;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>pageCount)throw new Error(`ページ範囲は1〜${pageCount}で指定してください`);
  return Array.from({length:end-start+1},(_,index)=>start+index-1);
}

export function pageExportPixels(widthMm:number,heightMm:number,dpi:number){
  if(![widthMm,heightMm,dpi].every(Number.isFinite)||widthMm<=0||heightMm<=0||!Number.isInteger(dpi)||dpi<1)throw new Error('用紙サイズと解像度を確認してください');
  const width=Math.round(widthMm*dpi/25.4),height=Math.round(heightMm*dpi/25.4);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30_000||height>30_000)throw new Error('画像に書き出せる用紙サイズを超えています');
  if(width*height>MAX_PAGE_EXPORT_PIXELS)throw new Error('画像が大きすぎます。用紙サイズまたは解像度を下げてください（最大1億画素）');
  return {width,height};
}

const putAscii=(target:Uint8Array,offset:number,value:string)=>{for(let i=0;i<value.length;i++)target[offset+i]=value.charCodeAt(i);};
const fixed16=(value:number)=>Math.round(value*65536);

/** Photoshop PSD v1の統合画像。CLIP STUDIO/Photoshop共通の8bit RGB/Grayと解像度を保持する。 */
export function flattenedPsd(image:{width:number;height:number;data:Uint8Array|Uint8ClampedArray},dpi:number,mode:PaintColorMode='color'):Blob {
  const {width,height,data}=image,pixels=width*height;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>30_000||height>30_000||pixels>MAX_PAGE_EXPORT_PIXELS||data.length!==pixels*4)throw new Error('PSDへ書き出す画像の寸法が不正です');
  if(!Number.isInteger(dpi)||dpi<1||dpi>65_535)throw new Error('PSDへ書き出す解像度が不正です');
  const gray=mode!=='color',channels=gray?1:3,colorMode=gray?1:3;

  // 8BIM/1005 is Photoshop ResolutionInfo: 16.16 dpi + pixels/inch + inch.
  const resource=new Uint8Array(28),resourceView=new DataView(resource.buffer);
  putAscii(resource,0,'8BIM');resourceView.setUint16(4,1005);resource[6]=0;resource[7]=0;resourceView.setUint32(8,16);
  resourceView.setUint32(12,fixed16(dpi));resourceView.setUint16(16,1);resourceView.setUint16(18,1);
  resourceView.setUint32(20,fixed16(dpi));resourceView.setUint16(24,1);resourceView.setUint16(26,1);

  const header=new Uint8Array(26+4+4+resource.length+4+2),view=new DataView(header.buffer);
  putAscii(header,0,'8BPS');view.setUint16(4,1);view.setUint16(12,channels);view.setUint32(14,height);view.setUint32(18,width);view.setUint16(22,8);view.setUint16(24,colorMode);
  let offset=26;view.setUint32(offset,0);offset+=4;view.setUint32(offset,resource.length);offset+=4;header.set(resource,offset);offset+=resource.length;view.setUint32(offset,0);offset+=4;view.setUint16(offset,0);

  const planes=Array.from({length:channels},()=>new Uint8Array(pixels));
  for(let pixel=0,source=0;pixel<pixels;pixel++,source+=4){
    const alpha=data[source+3]/255,r=Math.round(data[source]*alpha+255*(1-alpha)),g=Math.round(data[source+1]*alpha+255*(1-alpha)),b=Math.round(data[source+2]*alpha+255*(1-alpha));
    if(gray){const value=Math.round(r*.2126+g*.7152+b*.0722);planes[0][pixel]=mode==='monochrome'?(value<128?0:255):value;}
    else {planes[0][pixel]=r;planes[1][pixel]=g;planes[2][pixel]=b;}
  }
  return new Blob([header,...planes],{type:'image/vnd.adobe.photoshop'});
}

export async function blobImageData(blob:Blob):Promise<ImageData>{
  const url=URL.createObjectURL(blob),image=new Image();
  try{
    image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('画像を書き出す領域を作れませんでした');
    context.drawImage(image,0,0);const result=context.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;return result;
  }finally{image.src='';URL.revokeObjectURL(url);}
}

export function safeExportName(value:string){return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu,'-').replace(/\s+/gu,' ').slice(0,100)||'manga';}

export function downloadImageBlob(blob:Blob,name:string){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

type ZipEntry={name:string;bytes:Uint8Array};
const zipEncoder=new TextEncoder();
function crc32(bytes:Uint8Array):number{
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^(value&1?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
}
/** Small local ZIP with stored entries. PNG and PSD page exports need no extra compression step. */
export function uncompressedZip(entries:ZipEntry[]):Blob{
  if(!entries.length||entries.length>65_535)throw new Error('ZIPへまとめるファイル数が不正です');
  const parts:Uint8Array<ArrayBuffer>[]=[],directory:Uint8Array<ArrayBuffer>[]=[];
  let offset=0,directorySize=0;
  for(const entry of entries){
    const name=zipEncoder.encode(entry.name),checksum=crc32(entry.bytes);
    const local=new Uint8Array(30+name.length),view=new DataView(local.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,33,true);
    view.setUint32(14,checksum,true);view.setUint32(18,entry.bytes.length,true);view.setUint32(22,entry.bytes.length,true);view.setUint16(26,name.length,true);local.set(name,30);
    const central=new Uint8Array(46+name.length),index=new DataView(central.buffer);
    index.setUint32(0,0x02014b50,true);index.setUint16(4,20,true);index.setUint16(6,20,true);index.setUint16(8,0x800,true);index.setUint16(14,33,true);
    index.setUint32(16,checksum,true);index.setUint32(20,entry.bytes.length,true);index.setUint32(24,entry.bytes.length,true);index.setUint16(28,name.length,true);index.setUint32(42,offset,true);central.set(name,46);
    parts.push(local,Uint8Array.from(entry.bytes));directory.push(central);offset+=local.length+entry.bytes.length;directorySize+=central.length;
  }
  const end=new Uint8Array(22),view=new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true);view.setUint16(8,entries.length,true);view.setUint16(10,entries.length,true);view.setUint32(12,directorySize,true);view.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
