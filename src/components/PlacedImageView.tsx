import { fitImageBox } from '../lib/imagePlacement';
import { useEffect, useState } from 'preact/hooks';
import type { ImageAsset, PlacedImage } from '../types';
import { loadFigureCropAsset } from '../lib/figureCropStore';
import { loadPaintImages, type PaintImages } from '../lib/paintRenderer';
import { paintAssetIds, paintNativeBand } from '../lib/paintDocument';
import PaintPreviewCanvas from './PaintPreviewCanvas';

const EMPTY_ASSETS:ImageAsset[]=[];

export default function PlacedImageView({ asset, image, assets=EMPTY_ASSETS, nativeBand }: { asset?: ImageAsset; image: PlacedImage; assets?:ImageAsset[];nativeBand?:'above'|'below' }) {
  const [storedSource, setSource] = useState<{key:string;url:string|null} | null>(null);
  const paint=nativeBand&&image.paint?paintNativeBand(image.paint,nativeBand==='above'):image.paint;
  const hasTone=paint&&(Boolean(nativeBand)||Boolean(image.bubbleOriginal)||paint.layers.some(layer=>layer.visible&&layer.tone?.enabled));
  // Document edits clone paint/asset objects. Only a source or its validation
  // metadata changing requires another decode; composition still uses live paint.
  const sources=hasTone?JSON.stringify([...new Set(paintAssetIds(paint))].sort().map(id=>{
    const item=assets.find(asset=>asset.id===id);
    return [id,item?.storageId,item?.byteLength,item?.sha256,item?.mediaType,item?.widthPx,item?.heightPx];
  })):null;
  const [toneImages,setToneImages]=useState<{key:string;images:PaintImages|null}|null>(null);
  useEffect(()=>{
    let ignored=false,owned:PaintImages|undefined;
    setToneImages(null);
    if(sources!==null&&paint)void loadPaintImages([paint],assets).then(images=>{
      if(ignored){images.forEach(image=>{image.src='';});return;}
      owned=images;setToneImages({key:sources,images});
    }).catch(()=>{if(!ignored)setToneImages({key:sources,images:null});/* Ordinary artwork can use its saved composite. */});
    return()=>{ignored=true;owned?.forEach(image=>{image.src='';});};
  },[sources]);
  useEffect(() => {
    let ignored = false, url: string | null = null;
    setSource(null);
    if (!asset) return;
    void loadFigureCropAsset(asset.storageId).then(blob => {
      if (ignored) return;
      if (!blob) { setSource({key:asset.storageId,url:null}); return; }
      url = URL.createObjectURL(blob); setSource({key:asset.storageId,url});
    }).catch(() => { if (!ignored) setSource({key:asset.storageId,url:null}); });
    return () => { ignored = true; if (url) URL.revokeObjectURL(url); };
  }, [asset?.storageId]);
  const crop = image.crop;
  const fit = fitImageBox(crop, { x: 0, y: 0, w: image.bbox.w, h: image.bbox.h });
  const contentStyle = { left: `${fit.x / image.bbox.w * 100}%`, top: `${fit.y / image.bbox.h * 100}%`, width: `${fit.w / image.bbox.w * 100}%`, height: `${fit.h / image.bbox.h * 100}%` };
  const source=storedSource?.key===asset?.storageId?storedSource?.url:null;
  const toneReady=paint&&sources!==null&&toneImages?.key===sources&&toneImages.images;
  const failed=!asset||(storedSource?.key===asset.storageId&&storedSource.url===null)||(image.bubbleOriginal&&sources!==null&&toneImages?.key===sources&&toneImages.images===null);
  return <span class="placed-image-viewport" style={{ opacity: image.opacity }}>
    {toneReady?<span class="placed-image-content" style={contentStyle}><PaintPreviewCanvas paint={paint} images={toneReady} includeGeneration={false} style={{
      width:`${paint.width/crop.w*100}%`,height:`${paint.height/crop.h*100}%`,left:`${-crop.x/crop.w*100}%`,top:`${-crop.y/crop.h*100}%`,
    }}/></span>:!(nativeBand==='above'||nativeBand&&paint)&&!(image.bubbleOriginal&&paint) && source && asset && <span class="placed-image-content" style={contentStyle}><img src={source} alt="" draggable={false} onError={() => setSource({key:asset.storageId,url:null})} style={{
      width: `${asset.widthPx / crop.w * 100}%`, height: `${asset.heightPx / crop.h * 100}%`,
      left: `${-crop.x / crop.w * 100}%`, top: `${-crop.y / crop.h * 100}%`,
    }} /></span>}
    {failed && !toneReady && <span class="placed-image-missing">原本を読み込めません。作品フォルダから開き直してください。</span>}
  </span>;
}
