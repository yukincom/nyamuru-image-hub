import type { WorkspaceState } from './useWorkspaceState';
import type { MangaDocument } from '../../types';
import { cloneDocument } from '../../lib/manga';
import { isLanClient } from '../../lib/clientRuntime';
import { withNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import { beginFigureCropImport, saveFigureCropAssets } from '../../lib/figureCropStore';
import { prepareBackgroundStage } from '../../lib/background3d';
import type { SeriesCatalogPersistOptions } from '../../lib/newProjectSettings';
import type { SeriesCharacterTextLink } from '../../lib/localBridge';

interface Context {
  setDocument: (next: MangaDocument, record?: boolean) => void;
  endTextEdit: () => void;
  persistSeriesCatalog: (source: MangaDocument, options?: SeriesCatalogPersistOptions) => Promise<MangaDocument>;
  syncCharacterText: (source: MangaDocument, archive?: { characterCatalogId: string; characterName: string; omnyYaml: string; }) => Promise<SeriesCharacterTextLink | null>;
  patchLatestDocument: (recipe: (draft: MangaDocument) => boolean | void) => MangaDocument;
}

export function createWorkspaceCatalogActions({
  documentRef, saveProjectAction, characterTextLink, setCharacterTextLink, setToast, projectOperation,
  setProjectBusy,
}: WorkspaceState, {
  setDocument, endTextEdit, persistSeriesCatalog, syncCharacterText, patchLatestDocument,
}: Context) {
  const applyPreparedSeriesIdentifiers = (prepared: MangaDocument): MangaDocument | null => {
    const latest = documentRef.current;
    const sameEpisode = latest.manga.meta.episode_id && prepared.manga.meta.episode_id
      ? latest.manga.meta.episode_id === prepared.manga.meta.episode_id
      : latest.manga.meta.title.trim() === prepared.manga.meta.title.trim();
    if (latest.manga.meta.series.trim() !== prepared.manga.meta.series.trim() || !sameEpisode) return null;
    const next = cloneDocument(latest);
    let changed = false;
    const assign = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]) => {
      if (value !== undefined && target[key] !== value) {
        target[key] = value;
        changed = true;
      }
    };
    assign(next.manga.meta, 'series_id', prepared.manga.meta.series_id);
    assign(next.manga.meta, 'episode_id', prepared.manga.meta.episode_id);
    for(const stage of prepared.manga.background_stages??[]){const target=next.manga.background_stages?.find(item=>item.id===stage.id);if(target&&stage.seriesId)assign(target,'seriesId',stage.seriesId);}
    prepared.manga.characters.filter((entry) => entry.scope === 'series').forEach((entry) => {
      const target = next.manga.characters.find((candidate) => (
        (entry.localId && candidate.localId === entry.localId)
        || (entry.catalog_id && candidate.catalog_id === entry.catalog_id)
      ));
      if (target) assign(target, 'catalog_id', entry.catalog_id);
    });
    prepared.manga.materials.filter((entry) => entry.scope === 'series').forEach((entry) => {
      const target = next.manga.materials.find((candidate) => (
        (entry.localId && candidate.localId === entry.localId)
        || (entry.catalog_id && candidate.catalog_id === entry.catalog_id)
      ));
      if (!target) return;
      assign(target, 'catalog_id', entry.catalog_id);
      assign(target, 'character_catalog_id', entry.character_catalog_id);
      if (entry.origin && JSON.stringify(target.origin) !== JSON.stringify(entry.origin)) {
        target.origin = structuredClone(entry.origin);
        changed = true;
      }
    });
    if (changed) setDocument(next);
    return changed ? next : latest;
  };

  const saveCatalogFromEditor = async (label:string) => {
    endTextEdit();
    const source=documentRef.current;
    if (isLanClient || !source.manga.meta.series.trim()) {
      await saveProjectAction.current();
      return;
    }
    try {
      const persist=()=>persistSeriesCatalog(source, {
        seriesSetting: structuredClone(source.manga.series_setting),
      });
      const prepared=!isLanClient&&label==='舞台設定'?await withNewCreationBridgeSession(persist):await persist();
      const applied = applyPreparedSeriesIdentifiers(prepared);
      const savedDocument = applied ?? documentRef.current;
      if (label==='人物設定'&&characterTextLink?.linked) {
        const synced = await syncCharacterText(savedDocument);
        if (synced) setCharacterTextLink(synced);
      }
      setToast(`${label}を保存しました`);
    } catch (error) {
      setToast(`${label}を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const saveCharactersFromEditor=()=>saveCatalogFromEditor('人物設定');
  const saveBackgroundsFromEditor=()=>saveCatalogFromEditor('舞台設定');
  const importBackgroundModel=async(materialId:string,file:File)=>{
    if(projectOperation.current)throw new Error('保存・読み込みが終わってから登録してください');
    const episodeId=documentRef.current.manga.meta.episode_id;
    projectOperation.current=true;setProjectBusy(true);
    const finishImageImport=beginFigureCropImport();
    try{
      const item=await prepareBackgroundStage(file);
      const {loadStageShape}=await import('../../lib/background3dRenderer');
      await loadStageShape(item.stage,item.blob);
      const current=documentRef.current;
      if(current.manga.meta.episode_id!==episodeId||!current.manga.materials.some(material=>material.localId===materialId&&material.type==='background'))throw new Error('登録先の背景が変更されたため読み込みを中止しました');
      const existing=current.manga.background_stages?.find(stage=>stage.id===item.stage.id);
      await saveFigureCropAssets([{id:existing?.storageId??item.stage.storageId,blob:item.blob}]);
      patchLatestDocument(draft=>{
        if(draft.manga.meta.episode_id!==episodeId)throw new Error('登録先の作品が変わりました');
        const material=draft.manga.materials.find(entry=>entry.localId===materialId&&entry.type==='background');
        if(!material)throw new Error('登録先の背景が見つかりません');
        const stages=draft.manga.background_stages??=[];
        if(!stages.some(stage=>stage.id===item.stage.id))stages.push(item.stage);
        material.source_stage_id=item.stage.id;
      });
      setToast('背景の3Dモデルを登録しました');
    }finally{projectOperation.current=false;setProjectBusy(false);finishImageImport();}
  };

  return { applyPreparedSeriesIdentifiers, importBackgroundModel, saveBackgroundsFromEditor, saveCharactersFromEditor };
}
