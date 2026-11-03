import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import type { BBox, ImageAsset, PaintDocument } from '../types';
import type { PaintScene } from '../lib/paintDocument';
import { canFinishPaintLayer, captureMangaFinishLayer, applyMangaFinishLayers, finishLayerKey, type MangaFinishResult } from '../lib/mangaFinishLayers';
import { decodePaintImage, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { prepareImageAsset } from '../lib/imagePlacement';
import { blobDataUrl, dataUrlBlob } from '../lib/localBridge';
import { requestMangaFinish } from '../lib/localBridgeLifecycle';
import './MangaFinishDialog.css';

const roleNames = {white:'白下地', shade:'陰影', black:'ベタ', line:'線'} as const;
type Role = keyof typeof roleNames;
const roles = Object.keys(roleNames) as Role[];

export interface FinishBatch {
  source: PaintScene;
  scene: PaintScene;
  imports: Array<{asset:ImageAsset;blob:Blob}>;
  images: PaintImages;
  focus: {ownerKey:string;folderId:string;shadeId?:string};
}
interface Comparison { label:string; before:Blob; after:PaintDocument; bbox:BBox; width:number; height:number }
interface Props {
  scene:PaintScene; images:PaintImages|null; assets:ImageAsset[]; panel:number; selectedKeys:string[]; loadError:string;
  onApply:(batch:FinishBatch)=>void; onClose:()=>void;
}

function Original({blob}:{blob:Blob}) {
  const image=useRef<HTMLImageElement>(null);
  useLayoutEffect(()=>{
    const url=URL.createObjectURL(blob);image.current!.src=url;
    return ()=>URL.revokeObjectURL(url);
  },[blob]);
  return <img ref={image} alt="仕上げに渡した元画像"/>;
}

function Preview({paint,images,bbox,width,height}:{paint:PaintDocument;images:PaintImages;bbox:BBox;width:number;height:number}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const scale=Math.min(1,512/Math.max(width,height));
  useLayoutEffect(()=>{
    const renderer=paintPreviewRenderer();
    try {renderer.draw(canvas.current!,paint,images,undefined,undefined,false,bbox);}
    finally {renderer.dispose();}
  },[paint,images,bbox,width,height]);
  return <canvas ref={canvas} width={Math.max(1,Math.round(width*scale))} height={Math.max(1,Math.round(height*scale))}/>;
}

export default function MangaFinishDialog({scene,images,assets,panel,selectedKeys,loadError,onApply,onClose}:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [edge,setEdge]=useState(512);
  const [progress,setProgress]=useState(''), [error,setError]=useState('');
  const [preview,setPreview]=useState<{batch:FinishBatch;comparisons:Comparison[]}|null>(null);
  const [index,setIndex]=useState(0);
  const current=useRef(true), request=useRef<AbortController|null>(null), owned=useRef(new Set<HTMLImageElement>());
  function release(){for(const image of owned.current)image.src='';owned.current.clear();}
  useEffect(()=>{
    current.current=true;dialog.current?.showModal();
    return ()=>{current.current=false;request.current?.abort();release();};
  },[]);
  const selected=scene.owners.flatMap(owner=>owner.paint.layers.filter(layer=>
    selectedKeys.includes(finishLayerKey(owner.key,layer.id)) && canFinishPaintLayer(layer)
  ).map(layer=>({owner,layer,label:owner.label+' / '+layer.name})));
  function resetPreview(){release();setPreview(null);setIndex(0);setError('');}

  async function generate(){
    if(!images||!selected.length||request.current)return;
    const controller=new AbortController();request.current=controller;resetPreview();
    try {
      const map=new Map(images), pending=new Map<string,{asset:ImageAsset;blob:Blob}>(), results:MangaFinishResult[]=[];
      const comparisons:Comparison[]=[];
      for(const [i,{owner,layer,label}] of selected.entries()){
        setProgress('仕上げ中 '+(i+1)+' / '+selected.length);
        const {blob,bbox}=await captureMangaFinishLayer(owner,layer,images,edge);
        if(!current.current)return;
        const outputs=await requestMangaFinish(await blobDataUrl(blob),edge,controller.signal);
        if(!current.current)return;
        if(!outputs.white)throw new Error('「'+layer.name+'」には仕上げられる画素がありません');
        const parts:Partial<Record<Role,ImageAsset>>={};
        for(const role of roles){
          if(!outputs[role])continue;
          const png=dataUrlBlob(outputs[role]);
          if(png?.type!=='image/png')throw new Error('「'+roleNames[role]+'」のPNGを読み込めません');
          const prepared=await prepareImageAsset(new File([png],roleNames[role]+'.png',{type:'image/png'}));
          const asset=pending.get(prepared.id)?.asset??assets.find(item=>item.id===prepared.id)??prepared;
          if(!map.has(asset.id)){
            const decoded=await decodePaintImage(png);
            if(!current.current){decoded.src='';return;}
            owned.current.add(decoded);map.set(asset.id,decoded);
          }
          if(!pending.has(asset.id))pending.set(asset.id,{asset,blob:png});
          parts[role]=asset;
        }
        if(!parts.white)throw new Error('白下地を読み込めません');
        results.push({owner,layer,bbox,assets:{...parts,white:parts.white}});
        comparisons.push({label,bbox,width:parts.white.widthPx,height:parts.white.heightPx,
          before:blob,after:owner.paint});
      }
      const finished=applyMangaFinishLayers(scene,results);
      let focus:FinishBatch['focus']|undefined;
      results.forEach(({owner,layer},i)=>{
        const paint=finished.owners.find(item=>item.key===owner.key)!.paint;
        const folderId=paint.layers[paint.layers.findIndex(item=>item.id===layer.id)+1]?.folderId;
        if(!folderId)throw new Error('仕上げフォルダーが見つかりません');
        const children=paint.layers.filter(item=>item.folderId===folderId);
        const shadeId=children.find(item=>item.tone?.enabled)?.id;
        if(!focus||(!focus.shadeId&&shadeId))focus={ownerKey:owner.key,folderId,shadeId};
        comparisons[i].after={...paint,folders:undefined,layers:children};
      });
      if(current.current&&focus)setPreview({batch:{source:scene,scene:finished,images:map,imports:[...pending.values()],focus},comparisons});
    }catch(cause){
      release();if(current.current)setError(cause instanceof Error?cause.message:'漫画仕上げに失敗しました');
    }finally{request.current=null;if(current.current)setProgress('');}
  }
  function apply(){
    if(!preview)return;
    try{onApply(preview.batch);owned.current.clear();}
    catch(cause){setError(cause instanceof Error?cause.message:'仕上げを適用できません');}
  }
  const shown=preview?.comparisons[index];
  return <dialog class="image-export-dialog manga-finish-dialog" ref={dialog} aria-labelledby="manga-finish-title"
    onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={event=>event.stopPropagation()}>
    <header><div><h2 id="manga-finish-title">漫画仕上げ</h2><p>MangaScreen · コマ {panel}</p></div>
      <button type="button" class="icon-button" aria-label="閉じる" onClick={onClose}><X size={18}/></button></header>
    <p class="manga-finish-target">{selected.length?selected.map(item=>item.label).join('、'):'原稿で仕上げたい画像レイヤーを選んでください。'}</p>
    <label class="manga-finish-size">出力の長辺<select value={edge} disabled={Boolean(progress)} onChange={event=>{resetPreview();setEdge(Number(event.currentTarget.value));}}>
      {[512,768,1024,1536,2048].map(size=><option key={size} value={size}>{size} px</option>)}
    </select></label>
    {preview&&shown&&<section class="manga-finish-comparison">
      {preview.comparisons.length>1?<select aria-label="比較するレイヤー" value={index} onChange={e=>setIndex(Number(e.currentTarget.value))}>{preview.comparisons.map((item,i)=><option value={i}>{item.label}</option>)}</select>:<strong>{shown.label}</strong>}
      <div><figure><figcaption>元画像</figcaption><Original blob={shown.before}/></figure>
        <figure><figcaption>仕上げ</figcaption><Preview paint={shown.after} images={preview.batch.images} bbox={shown.bbox} width={shown.width} height={shown.height}/></figure></div>
      <small>{shown.width} × {shown.height} px{!shown.after.layers.some(layer=>layer.tone?.enabled)&&' · 網点にする陰影はありません'}</small>
    </section>}
    {(error||loadError)&&<p role="alert">{error||loadError}</p>}
    {progress&&<p role="status">{progress}</p>}
    <footer><button type="button" class="secondary-button" onClick={onClose}>キャンセル</button>
      {preview?<button type="button" class="primary-button" onClick={apply}>原稿に適用</button>:<button type="button" class="primary-button" disabled={!selected.length||!images||Boolean(progress)} onClick={()=>void generate()}>仕上げを試す</button>}
    </footer>
  </dialog>;
}
