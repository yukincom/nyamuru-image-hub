import type { Bubble, ImageAsset, MangaDocument, PlacedImage } from '../types.ts';
import { fallbackBox } from './canvasGeometry.ts';
import { overlayFallbackBox } from './pageCanvas.ts';
import { loadFigureCropAsset } from './figureCropStore.ts';
import { createFrameArtwork, imageCrop, prepareImageAsset, validateImagePlacements } from './imagePlacement.ts';
import { newPaintLayer, paintReferenceBox } from './paintDocument.ts';

/** Run before the editor is mounted, both for newly imported pages and restored works. */
export function needsBubbleOriginalSeparation(document:MangaDocument):boolean {
  return document.manga.pages.some(page=>[...page.panels,page.page_overlay].some(owner=>
    owner?.bubbles?.some(bubble=>bubble.analogTextImport&&!bubble.analogTextImport.rasterLayerSeparated)));
}

/** Reuse normal image placements and their editable paint documents; no live link to a bubble. */
export async function separateBubbleOriginals(document:MangaDocument, dependencies:{
  load?:typeof loadFigureCropAsset; prepare?:typeof prepareImageAsset;
}={}):Promise<MangaDocument> {
  if(!needsBubbleOriginalSeparation(document))return document;
  const next=structuredClone(document),assets=next.manga.image_assets??=[];
  const load=dependencies.load??loadFigureCropAsset,prepare=dependencies.prepare??prepareImageAsset;
  const prepared=new Map<string,ImageAsset>();
  async function separate(bubble:Bubble,index:number,images:PlacedImage[],frame:NonNullable<Bubble['bbox']>) {
    const source=bubble.analogTextImport;
    if(!source||source.rasterLayerSeparated)return;
    // A previously deleted original stays deleted. The marker is saved even when no image exists.
    if(source.rasterLayerInitialized&&!bubble.paint_overlay){source.rasterLayerSeparated=true;return;}
    const name=`原本 · 吹き出し ${index+1}`;
    let image:PlacedImage;
    if(bubble.paint_overlay){
      // Keep all existing pixels, strokes, eyes, locks and user layers exactly as saved.
      image={...bubble.paint_overlay,id:crypto.randomUUID(),bbox:{...frame}};
      bubble.bbox=paintReferenceBox(bubble.paint_overlay.paint,frame,bubble.paint_overlay.crop);
      if(!image.paint){
        const asset=assets.find(item=>item.id===image.assetId);
        if(!asset)throw new Error(`${name}の画像情報が見つかりません。作品フォルダから開き直してください。`);
        const crop=imageCrop(asset);
        image.paint={version:1,width:asset.widthPx,height:asset.heightPx,dpi:image.crop.w/Math.max(.001,frame.w)*25.4,guideInitialized:true,
          layers:[{...newPaintLayer(name,'raster'),image:{assetId:asset.id,crop:{...crop},bbox:{...crop}}}]};
      }
      if(image.paint)image.paint.layers=image.paint.layers.map(layer=>layer.image&&layer.guide?{...layer,guide:undefined}:layer);
      delete bubble.paint_overlay;
    }else{
      let asset=prepared.get(source.assetId);
      if(!asset){
        const blob=await load(source.assetId,source.persistentAsset);
        if(!blob)throw new Error(`${name}の画像が見つかりません。原画像のある環境で作品を開いてください。`);
        const candidate=await prepare(new File([blob],`${name}.png`,{type:blob.type||'image/png'}));
        asset=assets.find(item=>item.id===candidate.id);
        if(!asset){asset={...candidate,storageId:source.assetId};assets.push(asset);}
        else if(asset.storageId!==source.assetId&&!await load(asset.storageId))asset.storageId=source.assetId;
        prepared.set(source.assetId,asset);
      }
      const crop=imageCrop(asset);
      image={...createFrameArtwork(asset,frame),hidden:false,paint:{version:1,width:asset.widthPx,height:asset.heightPx,
        dpi:asset.widthPx/Math.max(.001,frame.w)*25.4,guideInitialized:true,
        layers:[{...newPaintLayer(name,'raster'),image:{assetId:asset.id,crop:{...crop},bbox:{...crop}},visible:!source.referenceHidden}]}};
    }
    if(image.locked&&image.paint){
      image.paint.layers=image.paint.layers.map(layer=>({...layer,locked:true}));
      image.locked=false;
    }
    if(image.hidden&&image.paint){
      image.paint.layers=image.paint.layers.map(layer=>({...layer,visible:false}));
      image.hidden=false;
    }
    image.bubbleOriginal={sourceRegionId:source.sourceRegionId,name};
    images.push(image);
    source.rasterLayerInitialized=true;
    source.rasterLayerSeparated=true;
  }
  for(const page of next.manga.pages){
    for(const panel of page.panels)for(const [index,bubble] of panel.bubbles.entries()){
      if(bubble.analogTextImport&&!bubble.analogTextImport.rasterLayerSeparated)
        await separate(bubble,index,panel.images??=[],bubble.bbox??fallbackBox(panel,'bubble',index));
    }
    for(const [index,bubble] of (page.page_overlay?.bubbles??[]).entries()){
      if(bubble.analogTextImport&&!bubble.analogTextImport.rasterLayerSeparated)
        await separate(bubble,index,page.images??=[],bubble.bbox??overlayFallbackBox(page.canvas,'bubble',index));
    }
  }
  validateImagePlacements(next);
  return next;
}
