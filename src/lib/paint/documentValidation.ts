import type { PaintDocument, ImageAsset, BBox, PaintStroke } from '../../types.ts';
import { validateBackgroundCapture } from '../background3d.ts';
import { validPaintInk } from '../paintInk.ts';

export function paintAssetIds(paint?: PaintDocument): string[] {
  return paint?.layers.flatMap(layer => layer.image ? [layer.image.assetId] : []) ?? [];
}

export function validatePaintDocument(value: PaintDocument, assets: readonly ImageAsset[],allowEmptyScene=false): void {
  const fail = () => { throw new Error('ペイントのレイヤーまたは参照画像が不正です'); };
  const box = (b?: BBox) => b && [b.x,b.y,b.w,b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  if (!value || value.version !== 1 || ![value.width,value.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384)
      || value.width * value.height > 100_000_000 || !Number.isFinite(value.dpi) || value.dpi <= 0
      || !Array.isArray(value.layers) || (!allowEmptyScene&&!value.guideInitialized&&!value.layers.length&&!value.folders?.length) || value.layers.length > 64
      || (value.folders!==undefined&&(!Array.isArray(value.folders)||value.folders.length>64))
      || (value.referenceFrame !== undefined && !box(value.referenceFrame))) fail();
  if(value.guideInitialized!==undefined&&typeof value.guideInitialized!=='boolean')fail();
  if(value.background3d!==undefined)validateBackgroundCapture(value.background3d);
  const folderIds=new Set<string>();
  for(const folder of value.folders??[]){
    if(!folder||typeof folder.id!=='string'||!folder.id||folderIds.has(folder.id)||typeof folder.name!=='string'||!folder.name||!Number.isSafeInteger(folder.position)||folder.position<0||folder.position>value.layers.length)fail();
    if(folder.visible!==undefined&&typeof folder.visible!=='boolean'||folder.locked!==undefined&&typeof folder.locked!=='boolean'||folder.aboveNative!==undefined&&typeof folder.aboveNative!=='boolean')fail();
    folderIds.add(folder.id);
  }
  const parents=new Map(value.folders?.map(folder=>[folder.id,folder.parentFolderId]));
  for(const folder of value.folders??[]){
    const seen=new Set([folder.id]);
    let parent=folder.parentFolderId;
    while(parent!==undefined){
      if(!folderIds.has(parent)||seen.has(parent))fail();
      seen.add(parent);
      parent=parents.get(parent);
    }
  }
  const ids = new Set<string>(); let points = 0;
  const validateStrokes=(strokes:PaintStroke[])=>{
    for(const stroke of strokes){
      if (!stroke || !['pen','eraser','line','rectangle','ellipse','fill','clear'].includes(stroke.tool) || (stroke.color!==null&&(typeof stroke.color!=='string'||!/^#[0-9a-f]{6}$/i.test(stroke.color)))
        || !Number.isFinite(stroke.size) || stroke.size <= 0 || !Array.isArray(stroke.points) || !stroke.points.length) fail();
      if(stroke.fill!==undefined&&!validPaintInk(stroke.fill))fail();
      if(stroke.brush!==undefined&&(!stroke.brush||stroke.tool!=='pen'||stroke.brush.kind!=='rough-hatching'||!Number.isInteger(stroke.brush.seed)||stroke.brush.seed<0||stroke.brush.seed>0xffffffff))fail();
      if(stroke.selection!==undefined&&(!Array.isArray(stroke.selection)||stroke.selection.some(b=>!box(b))))fail();
      if((stroke.tool==='fill'||stroke.tool==='clear')&&!stroke.selection)fail();
      points += stroke.points.length+(stroke.selection?.length??0);
      if (points > 2_000_000) fail();
      for (const p of stroke.points) if (!p || ![p.x,p.y,p.pressure,p.time].every(Number.isFinite) || p.pressure < 0 || p.pressure > 1) fail();
    }
  };
  for (const layer of value.layers) {
    if (!layer || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id) || typeof layer.name !== 'string'
      || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
      || !['normal','multiply'].includes(layer.blend) || !Array.isArray(layer.strokes) || (layer.clip && !box(layer.clip))) fail();
    if(layer.guide!==undefined&&typeof layer.guide!=='boolean')fail();
    if(layer.generationMask!==undefined&&(typeof layer.generationMask!=='boolean'||layer.generationMask&&(layer.kind==='vector'||layer.image||layer.mask||layer.tone)))fail();
    if(layer.aboveNative!==undefined&&typeof layer.aboveNative!=='boolean')fail();
    if(layer.kind!==undefined&&!['raster','vector'].includes(layer.kind))fail();
    if(layer.antialias!==undefined&&![0,1,2,3].includes(layer.antialias))fail();
    if(layer.colorMode!==undefined&&!['color','grayscale','monochrome'].includes(layer.colorMode))fail();
    if(layer.folderId!==undefined&&(typeof layer.folderId!=='string'||!folderIds.has(layer.folderId)))fail();
    if(layer.paths!==undefined&&(!Array.isArray(layer.paths)||layer.kind!=='vector'))fail();
    const pathIds=new Set<string>();
    for(const path of layer.paths??[]){
      const style=path?.style,point=(p:unknown)=>!!p&&typeof p==='object'&&Number.isFinite((p as {x:number}).x)&&Number.isFinite((p as {y:number}).y);
      if(!path||typeof path.id!=='string'||!path.id||pathIds.has(path.id)||typeof path.closed!=='boolean'||!Array.isArray(path.nodes)||!path.nodes.length||!style)fail();
      pathIds.add(path.id);points+=path.nodes.length;if(points>2_000_000)fail();
      if(!validPaintInk(style.stroke)||!validPaintInk(style.fill)||!Number.isFinite(style.width)||style.width<=0||style.width>10000
        ||!['butt','round','square'].includes(style.cap)||!['miter','round','bevel'].includes(style.join)||!Number.isFinite(style.miterLimit)||style.miterLimit<1||style.miterLimit>1000
        ||!Array.isArray(style.dash)||style.dash.length>6||style.dash.some(n=>!Number.isFinite(n)||n<=0)||!Number.isFinite(style.dashOffset)
        ||!['center','inside','outside'].includes(style.alignment)||![style.arrowStart,style.arrowEnd].every(a=>['none','triangle','open','circle'].includes(a))||!['uniform','taper','spindle'].includes(style.profile))fail();
      for(const node of path.nodes)if(!point(node)||(node.handleIn!==undefined&&!point(node.handleIn))||(node.handleOut!==undefined&&!point(node.handleOut)))fail();
    }
    ids.add(layer.id);
    if (layer.image) {
      const asset = assets.find(asset => asset.id === layer.image!.assetId), crop = layer.image.crop;
      if (!asset || !box(layer.image.bbox) || !box(crop) || crop.x < 0 || crop.y < 0 || crop.x + crop.w > asset.widthPx || crop.y + crop.h > asset.heightPx) fail();
    }
    if(layer.mask && (typeof layer.mask.enabled!=='boolean'||typeof layer.mask.reveal!=='boolean'||!Array.isArray(layer.mask.strokes)))fail();
    if(layer.tone){const tone=layer.tone;
      if(typeof tone.enabled!=='boolean'||!Number.isFinite(tone.lpi)||tone.lpi<=0||tone.lpi>1000||!['image','fixed'].includes(tone.mode)||!Number.isFinite(tone.density)||tone.density<0||tone.density>100
        ||(tone.fill!==undefined&&(typeof tone.fill!=='boolean'||tone.fill&&tone.mode!=='fixed'))
        ||(tone.angle!==undefined&&(!Number.isFinite(tone.angle)||tone.angle<0||tone.angle>360))
        ||(tone.origin!==undefined&&(!tone.origin||!Number.isFinite(tone.origin.x)||!Number.isFinite(tone.origin.y))))fail();
    }
    validateStrokes([...layer.strokes,...(layer.mask?.strokes??[])]);
  }
}
