import { fitImageBox } from '../lib/imagePlacement';
import { useEffect, useState } from 'preact/hooks';
import type { ImageAsset, PlacedImage } from '../types';
import { loadFigureCropAsset } from '../lib/figureCropStore';
import { loadPaintImages, type PaintImages } from '../lib/paintRenderer';
import PaintPreviewCanvas from './PaintPreviewCanvas';

const EMPTY_ASSETS:ImageAsset[]=[];

export default function PlacedImageView({ asset, image, assets=EMPTY_ASSETS }: { asset?: ImageAsset; image: PlacedImage; assets?:ImageAsset[] }) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const paint=image.paint;
  const hasTone=paint&&(Boolean(image.bubbleOriginal)||paint.layers.some(layer=>layer.visible&&layer.tone?.enabled));
  const [toneImages,setToneImages]=useState<{paint:typeof paint;images:PaintImages}|null>(null);
  useEffect(()=>{
    let ignored=false,owned:PaintImages|undefined;
    setToneImages(null);
    if(hasTone&&paint)void loadPaintImages([paint],assets).then(images=>{
      if(ignored){images.forEach(image=>{image.src='';});return;}
      owned=images;setToneImages({paint,images});
    }).catch(()=>{if(!ignored&&image.bubbleOriginal)setFailed(true);/* Ordinary artwork can use its saved composite. */});
    return()=>{ignored=true;owned?.forEach(image=>{image.src='';});};
  },[paint,hasTone,assets]);
  useEffect(() => {
    let ignored = false, url: string | null = null;
    setSource(null); setFailed(false);
    if (!asset) { setFailed(true); return; }
    void loadFigureCropAsset(asset.storageId).then(blob => {
      if (ignored) return;
      if (!blob) { setFailed(true); return; }
      url = URL.createObjectURL(blob); setSource(url);
    }).catch(() => { if (!ignored) setFailed(true); });
    return () => { ignored = true; if (url) URL.revokeObjectURL(url); };
  }, [asset?.storageId]);
  const crop = image.crop;
  const fit = fitImageBox(crop, { x: 0, y: 0, w: image.bbox.w, h: image.bbox.h });
  const contentStyle = { left: `${fit.x / image.bbox.w * 100}%`, top: `${fit.y / image.bbox.h * 100}%`, width: `${fit.w / image.bbox.w * 100}%`, height: `${fit.h / image.bbox.h * 100}%` };
  const toneReady=paint&&toneImages?.paint===paint;
  return <span class="placed-image-viewport" style={{ opacity: image.opacity }}>
    {toneReady?<span class="placed-image-content" style={contentStyle}><PaintPreviewCanvas paint={paint} images={toneImages.images} includeGeneration={false} style={{
      width:`${paint.width/crop.w*100}%`,height:`${paint.height/crop.h*100}%`,left:`${-crop.x/crop.w*100}%`,top:`${-crop.y/crop.h*100}%`,
    }}/></span>:!(image.bubbleOriginal&&paint) && source && asset && <span class="placed-image-content" style={contentStyle}><img src={source} alt="" draggable={false} onError={() => setFailed(true)} style={{
      width: `${asset.widthPx / crop.w * 100}%`, height: `${asset.heightPx / crop.h * 100}%`,
      left: `${-crop.x / crop.w * 100}%`, top: `${-crop.y / crop.h * 100}%`,
    }} /></span>}
    {failed && !toneReady && <span class="placed-image-missing">原本を読み込めません。作品フォルダから開き直してください。</span>}
  </span>;
}
