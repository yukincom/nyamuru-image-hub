import type { BBox, ImageAsset, PaintLayer } from '../types.ts';
import { imageCrop } from './imagePlacement.ts';
import { newPaintLayer, paintLayerTree, withPaintLayerTree, type PaintLayerTreeEntry, type PaintOwner, type PaintScene } from './paintDocument.ts';
import { renderPaintLayerCrop, type PaintImages } from './paintRenderer.ts';
import { paintStrokeContentBounds } from './paintStroke.ts';
import { defaultPaintTone } from './paintTone.ts';

export const finishLayerKey=(ownerKey:string,layerId:string)=>ownerKey+'\u0000'+layerId;

export function canFinishPaintLayer(layer:PaintLayer):boolean {
  return layer.kind!=='vector'&&!layer.generationMask&&Boolean(layer.image||layer.strokes.length||layer.tone?.fill);
}

/** Crop in owner pixels so a resized PNG still occupies precisely its paper position. */
function captureBounds(owner:PaintOwner,layer:PaintLayer):BBox {
  const {width,height}=owner.paint;
  let left=width,top=height,right=0,bottom=0;
  const include=(box:BBox)=>{
    left=Math.min(left,box.x);top=Math.min(top,box.y);
    right=Math.max(right,box.x+box.w);bottom=Math.max(bottom,box.y+box.h);
  };
  if(layer.image)include(layer.image.bbox);
  if(layer.tone?.fill)include({x:0,y:0,w:width,h:height});
  for(const stroke of layer.strokes){
    const box=paintStrokeContentBounds(stroke);
    if(box)include(box);
  }
  const clip=layer.clip??{x:0,y:0,w:width,h:height};
  const x=Math.max(0,Math.floor(Math.max(left,clip.x))),y=Math.max(0,Math.floor(Math.max(top,clip.y)));
  const w=Math.min(width,Math.ceil(Math.min(right,clip.x+clip.w)))-x;
  const h=Math.min(height,Math.ceil(Math.min(bottom,clip.y+clip.h)))-y;
  if(w<=0||h<=0)throw new Error('選択したレイヤーに仕上げる画像がありません');
  return {x,y,w,h};
}

export async function captureMangaFinishLayer(owner:PaintOwner,layer:PaintLayer,images:PaintImages,longEdge:number):Promise<{blob:Blob;bbox:BBox}> {
  if(!canFinishPaintLayer(layer))throw new Error('画像または描画レイヤーを選んでください');
  const bbox=captureBounds(owner,layer);
  return {bbox,blob:await renderPaintLayerCrop(owner.paint,layer,images,bbox,longEdge)};
}

export interface MangaFinishResult {
  owner:PaintOwner;
  layer:PaintLayer;
  bbox:BBox;
  assets:{white:ImageAsset;shade?:ImageAsset;black?:ImageAsset;line?:ImageAsset};
}

const roles=[['white','白下地'],['shade','陰影'],['black','ベタ'],['line','線']] as const;
function finishFolder({owner,layer,bbox,assets}:MangaFinishResult):Extract<PaintLayerTreeEntry,{kind:'folder'}> {
  const children:PaintLayerTreeEntry[]=[];
  for(const [role,name] of roles){
    const asset=assets[role];
    if(!asset)continue;
    const child={...newPaintLayer(name),blend:layer.blend,image:{assetId:asset.id,crop:imageCrop(asset),bbox:{...bbox}}};
    if(role==='shade'){
      const origin={x:-owner.frame.x*owner.paint.width/owner.frame.w,y:-owner.frame.y*owner.paint.height/owner.frame.h};
      child.tone={...defaultPaintTone(),origin};
    }
    children.push({kind:'layer',layer:child});
  }
  return {kind:'folder',folder:{id:crypto.randomUUID(),name:'仕上げ✨',position:0,aboveNative:layer.aboveNative,visible:layer.visible},children};
}

/** The editor records the returned scene once. Neither the captured inputs nor their assets are destroyed. */
export function applyMangaFinishLayers(scene:PaintScene,results:readonly MangaFinishResult[]):PaintScene {
  if(!results.length)return scene;
  const grouped=new Map<PaintOwner,Map<PaintLayer,MangaFinishResult>>();
  for(const result of results){
    if(!scene.owners.includes(result.owner)||!result.owner.paint.layers.includes(result.layer))
      throw new Error('仕上げ中に対象が変更されました。選び直してください');
    const group=grouped.get(result.owner)??new Map<PaintLayer,MangaFinishResult>();
    if(group.has(result.layer))throw new Error('同じ画像が複数選択されています');
    group.set(result.layer,result);
    grouped.set(result.owner,group);
  }
  const owners=scene.owners.map(owner=>{
    const group=grouped.get(owner);
    if(!group)return owner;
    const paint=owner.paint;
    const tree=paintLayerTree(paint);
    let added=0;
    function insert(entries:PaintLayerTreeEntry[]){
      for(let i=entries.length-1;i>=0;i--){
        const entry=entries[i];
        if(entry.kind==='folder'){insert(entry.children);continue;}
        const result=group!.get(entry.layer);
        if(!result)continue;
        const folder=finishFolder(result);
        added+=folder.children.length;
        entries.splice(i,1,{kind:'layer',layer:{...entry.layer,visible:false}},folder);
      }
    }
    insert(tree);
    if(paint.layers.length+added>64||(paint.folders?.length??0)+group.size>64)
      throw new Error('仕上げ結果を追加するとレイヤーまたはフォルダーの上限（64）を超えます');
    return {...owner,paint:withPaintLayerTree(paint,tree)};
  });
  return {...scene,owners};
}
