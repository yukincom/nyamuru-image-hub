import { withNewCreationBridgeSession } from './localBridgeLifecycle.ts';
import type { BackgroundStage, MangaDocument } from '../types.ts';
import { backgroundMaterialStages, verifyBackgroundStage } from './background3d.ts';
import { loadFigureCropAsset, saveFigureCropAssets } from './figureCropStore.ts';
import { loadSeriesBackgroundModel, saveSeriesBackgroundModel, hasSeriesBackgroundModel } from './localBridge.ts';

export async function loadBackgroundStage(stage:BackgroundStage,services={load:loadFigureCropAsset,restore:(seriesId:string,item:BackgroundStage)=>withNewCreationBridgeSession(()=>loadSeriesBackgroundModel(seriesId,item)),cache:saveFigureCropAssets}):Promise<Blob> {
  const cached=await services.load(stage.storageId);
  if(cached){await verifyBackgroundStage(stage,cached);return cached;}
  const original=stage.seriesId?await services.restore(stage.seriesId,stage):null;
  if(!original)throw new Error(`3D背景「${stage.name}」の原本が見つかりません。保存した作品またはシリーズを開き直してください`);
  await verifyBackgroundStage(stage,original);
  await services.cache([{id:stage.storageId,blob:original}]);
  return original;
}

/** Persist originals before publishing catalog references. Episode-only models stay local. */
export async function persistSeriesBackgroundModels(document:MangaDocument,seriesId:string,services={load:loadBackgroundStage,save:saveSeriesBackgroundModel,exists:hasSeriesBackgroundModel}):Promise<void> {
  for(const stage of backgroundMaterialStages(document,'series')){
    if(await services.exists(seriesId,stage)){stage.seriesId=seriesId;continue;}
    const blob=await services.load(stage);
    await services.save(seriesId,stage,blob);
    stage.seriesId=seriesId;
  }
}
