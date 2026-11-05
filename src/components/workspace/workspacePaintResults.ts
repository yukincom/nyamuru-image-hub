import type { WorkspaceState } from './useWorkspaceState';
import type { MangaDocument, ImageAsset } from '../../types';
import type { PaintResult } from '../PaintEditor';
import { cloneDocument } from '../../lib/manga';
import { beginFigureCropImport, loadFigureCropAsset, saveFigureCropAssets, deleteFigureCropAssets } from '../../lib/figureCropStore';
import { verifyBackgroundStage } from '../../lib/background3d';
import { paintAssetIds, applyPaintAnchorIds, applyPaintOwnerLock, clearOwnerPaint, applyOwnerPaint } from '../../lib/paintDocument';
import { prepareImageAsset, createFrameArtwork, imageAssetIds, validateImagePlacements } from '../../lib/imagePlacement';

interface Context {
  setDocument: (next: MangaDocument, record?: boolean) => void;
}

export function createWorkspacePaintResults({
  pendingPaintAssets, documentRef, paintSessionRef, paintController, setPaintSession,
}: WorkspaceState, {
  setDocument,
}: Context) {
  async function persistPaintResults(current:MangaDocument,batches:Array<{pageIndex:number;panelIndex:number;overlay:boolean;title:string;result:PaintResult}>,publish:(next:MangaDocument)=>void){
    const next=cloneDocument(current), stored=next.manga.image_assets??=[];
    const writes:Array<{id:string;blob:Blob}>=[];
    let committed=false;
    const finishImageImport=beginFigureCropImport();
    try {
      const register=async(prepared:ImageAsset,blob:Blob):Promise<ImageAsset>=>{
        const existing=stored.find(a=>a.id===prepared.id);
        if(existing&&writes.some(item=>item.id===existing.storageId))return existing;
        const cached=existing?await loadFigureCropAsset(existing.storageId):null;
        if(existing&&cached)return existing;
        const asset={...prepared,storageId:`paint-${crypto.randomUUID()}`};
        if(existing)stored.splice(stored.indexOf(existing),1,asset);else stored.push(asset);
        writes.push({id:asset.storageId,blob});pendingPaintAssets.current.add(asset.storageId);return asset;
      };
      for(const batch of batches){
      const {result}=batch;
      if(result.stageImports?.length){
        const stages=next.manga.background_stages??=[];
        for(const {stage,blob} of result.stageImports){
          await verifyBackgroundStage(stage,blob);
          const existing=stages.find(item=>item.id===stage.id);
          if(existing&&await loadFigureCropAsset(existing.storageId))continue;
          const saved={...stage,storageId:`original-stage-${crypto.randomUUID()}`};
          if(existing)stages.splice(stages.indexOf(existing),1,saved);else stages.push(saved);
          writes.push({id:saved.storageId,blob});
        }
      }
      const needed=new Set(result.owners.flatMap(({owner})=>paintAssetIds(owner.paint)));
      for(const item of result.imports)if(needed.has(item.asset.id))await register(item.asset,item.blob);
      const targetPage=next.manga.pages[batch.pageIndex];
      if(!targetPage)throw new Error('描画先が見つかりません');
      applyPaintAnchorIds(targetPage,batch.panelIndex,batch.overlay,result.scene?.anchorIds);
      if(result.scene?.layerSequence!==undefined)targetPage.paint_layer_sequence=result.scene.layerSequence;
      if(result.scene?.generatedImageSequence!==undefined)next.manga.generated_image_sequence=result.scene.generatedImageSequence;
      for(const {owner,blob,remove,metadataOnly} of result.owners){
        const target=owner.kind==='page'||(owner.kind==='original'&&batch.overlay)?targetPage:batch.overlay?targetPage.page_overlay:targetPage.panels[batch.panelIndex];
        if(!target)throw new Error('描画先が見つかりません');
        applyPaintOwnerLock(target,owner);
        if(metadataOnly)continue;
        if(remove){clearOwnerPaint(target,owner);continue;}
        if(!blob)throw new Error('描画画像が見つかりません');
        const prepared=await prepareImageAsset(new File([blob],`${batch.title}-${owner.label}.png`,{type:'image/png'}));
        const asset=await register(prepared,blob);
        const image={...createFrameArtwork(asset,owner.frame),paint:owner.paint};
        applyOwnerPaint(target,owner,image);
      }
      }
      const used=imageAssetIds(next);
      next.manga.image_assets=stored.filter(asset=>!asset.storageId.startsWith('paint-')||used.has(asset.id));
      validateImagePlacements(next);
      await saveFigureCropAssets(writes);
      if(documentRef.current!==current)throw new Error('保存中に作品が変更されました。描画内容はこの画面に残っています');
      publish(next);committed=true;
    }finally{
      writes.forEach(item=>pendingPaintAssets.current.delete(item.id));
      if(!committed&&writes.length)await deleteFigureCropAssets(writes.map(item=>item.id)).catch(()=>undefined);
      finishImageImport();
    }
  }
  const applyPaint = async (result:PaintResult) => {
    const session=paintSessionRef.current;
    if(!session)throw new Error('描画先が見つかりません');
    if(documentRef.current!==session.document)throw new Error('作品が変更されています。ペイントを閉じて配置を確認してください');
    await persistPaintResults(session.document,[{...session,result}],next=>{
      setDocument(next,false);
      const live=paintController.current?.snapshot();
      const updated={...session,document:next,...(result.rebase&&result.scene&&live?{scene:result.scene,resume:{...live,scene:result.scene,saved:result.scene}}:{})};paintSessionRef.current=updated;setPaintSession(updated);
    });
  };

  return { persistPaintResults, applyPaint };
}
