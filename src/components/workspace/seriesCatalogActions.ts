import type { WorkspaceState } from './useWorkspaceState';
import type { MangaDocument } from '../../types';
import { type SeriesCatalogPersistOptions, withoutSeriesCharacter } from '../../lib/newProjectSettings';
import {
  prepareDocumentForSeriesSave, removeMaterialsFromSeriesCatalog, removeCharactersFromSeriesCatalog,
  upsertEpisodeIntoSeriesCatalog, mergeSeriesCatalog,
} from '../../lib/seriesCatalog';
import { isLanClient } from '../../lib/clientRuntime';
import { loadSeriesCatalog, saveSeriesCatalog, type SeriesCharacterTextLink, syncSeriesCharacterText, linkSeriesCharacterText, restoreSeriesCharacterText, type EpisodeWorkspaceTextSelection } from '../../lib/localBridge';
import { parseMangaYaml, toSeriesCatalogMangaYaml } from '../../lib/manga';
import { persistSeriesBackgroundModels } from '../../lib/backgroundStageStore';
import { startNewCreationBridgeSession, stopNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import {
  toCharacterTextMarkdown, seriesCharacterCatalogIds, mergeCharacterTextCatalog, parseCharacterText,
  characterArchiveDocument,
} from '../../lib/characterTextCatalog.ts';

interface Context {
  setNewCharacterDocument: (next: MangaDocument | null) => void;
  chooseLocalText: () => Promise<EpisodeWorkspaceTextSelection | null>;
}

export function createSeriesCatalogActions({
  showNewDialog, seriesCatalogPendingCount, setSeriesCatalogSaving, seriesCatalogSaveQueue, documentRef,
  newSeriesDirectory, newEpisodeWorkspace, newSeriesReference, newCreationBridgeToken,
  characterEditorBridgeToken, setToast, setCharacterTextBusy,
}: WorkspaceState, {
  setNewCharacterDocument, chooseLocalText,
}: Context) {
  const persistSeriesCatalogNow = async (
    source: MangaDocument,
    options: SeriesCatalogPersistOptions = {},
  ): Promise<MangaDocument> => {
    let prepared = prepareDocumentForSeriesSave(source);
    if (isLanClient && showNewDialog) return prepared;
    const seriesName = prepared.manga.meta.series.trim();
    if (!seriesName) return prepared;
    const loaded = await loadSeriesCatalog(seriesName, prepared.manga.meta.series_id);
    if (loaded.seriesId) prepared.manga.meta.series_id = loaded.seriesId;
    let catalogSource = prepared;
    if (loaded.found && loaded.omnyYaml) {
      const withoutMaterials = removeMaterialsFromSeriesCatalog(
        parseMangaYaml(loaded.omnyYaml),
        options.deleteMaterialCatalogIds ?? [],
      );
      const existing = removeCharactersFromSeriesCatalog(
        withoutMaterials,
        options.deleteCharacterCatalogIds ?? [],
      );
      const upserted = upsertEpisodeIntoSeriesCatalog(existing, prepared);
      if (upserted.conflicts.length) {
        throw new Error(`同名で別IDのシリーズ項目があります: ${upserted.conflicts.join('、')}`);
      }
      catalogSource = upserted.document;
    }
    if (options.seriesSetting) catalogSource.manga.series_setting = structuredClone(options.seriesSetting);
    if (!isLanClient) await persistSeriesBackgroundModels(catalogSource,prepared.manga.meta.series_id);
    for(const stage of prepared.manga.background_stages??[]){const saved=catalogSource.manga.background_stages?.find(item=>item.id===stage.id);if(saved?.seriesId)stage.seriesId=saved.seriesId;}
    const saved = await saveSeriesCatalog(
      seriesName,
      prepared.manga.meta.series_id,
      toSeriesCatalogMangaYaml(catalogSource, { seriesSetting: options.seriesSetting }),
      loaded.revision,
      {
        seriesDirectory: options.seriesDirectory,
        seriesTextRelativePath: options.seriesReference?.relativePath,
      },
    );
    prepared.manga.meta.series_id = saved.seriesId;
    return prepared;
  };

  const persistSeriesCatalog = async (
    source: MangaDocument,
    options: SeriesCatalogPersistOptions = {},
  ): Promise<MangaDocument> => {
    seriesCatalogPendingCount.current += 1;
    setSeriesCatalogSaving(true);
    const task = seriesCatalogSaveQueue.current.then(() => {
      const latest = documentRef.current;
      const sameEpisode = latest.manga.meta.episode_id && source.manga.meta.episode_id
        ? latest.manga.meta.episode_id === source.manga.meta.episode_id
        : latest.manga.meta.title.trim() === source.manga.meta.title.trim();
      const sameOpenEpisode = latest.manga.meta.series.trim() === source.manga.meta.series.trim()
        && sameEpisode;
      const selected = sameOpenEpisode ? latest : source;
      const catalogIdsToDelete = options.deleteMaterialCatalogIds ?? [];
      const characterIdsToDelete = options.deleteCharacterCatalogIds ?? [];
      const withoutMaterials = catalogIdsToDelete.length
        ? removeMaterialsFromSeriesCatalog(selected, catalogIdsToDelete)
        : selected;
      const preparedSource = characterIdsToDelete.length
        ? removeCharactersFromSeriesCatalog(withoutMaterials, characterIdsToDelete)
        : withoutMaterials;
      return persistSeriesCatalogNow(preparedSource, options);
    });
    seriesCatalogSaveQueue.current = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } finally {
      seriesCatalogPendingCount.current = Math.max(0, seriesCatalogPendingCount.current - 1);
      setSeriesCatalogSaving(seriesCatalogPendingCount.current > 0);
    }
  };

  const persistNewCharacterCatalog = async (
    source: MangaDocument,
    options: Omit<SeriesCatalogPersistOptions, 'seriesSetting'> = {},
  ): Promise<MangaDocument> => {
    const prepared = await persistSeriesCatalog(source, {
      ...options,
      seriesSetting: structuredClone(source.manga.series_setting),
      seriesDirectory: newSeriesDirectory || newEpisodeWorkspace?.seriesDirectory,
      seriesReference: newSeriesReference,
    });
    setNewCharacterDocument(prepared);
    return prepared;
  };

  const withCharacterTextBridge = async <T,>(task: () => Promise<T>): Promise<T> => {
    if (isLanClient) return task();
    if (newCreationBridgeToken.current || characterEditorBridgeToken.current) return task();
    const session = await startNewCreationBridgeSession();
    try {
      return await task();
    } finally {
      await stopNewCreationBridgeSession(session.token).catch(() => undefined);
    }
  };

  const syncCharacterText = async (
    source: MangaDocument,
    archive?: { characterCatalogId: string; characterName: string; omnyYaml: string },
  ): Promise<SeriesCharacterTextLink | null> => {
    const seriesId = source.manga.meta.series_id;
    if (isLanClient || !source.manga.meta.series.trim() || !seriesId) return null;
    return withCharacterTextBridge(() => syncSeriesCharacterText(
      seriesId,
      toCharacterTextMarkdown(source),
      seriesCharacterCatalogIds(source),
      archive,
    ));
  };

  const linkCharacterText = async (
    source: MangaDocument,
    defaultDirectory: string,
    apply: (next: MangaDocument) => void,
    applyLink: (next: SeriesCharacterTextLink | null) => void,
  ) => {
    if (!source.manga.meta.series.trim()) {
      setToast('シリーズ共通人物だけが人物テキストと連携できます');
      return;
    }
    if (isLanClient) {
      try {
        const selected = await chooseLocalText();
        if (!selected) return;
        const merged = mergeCharacterTextCatalog(source, parseCharacterText(await selected.file.text()));
        apply(await (showNewDialog ? persistNewCharacterCatalog : persistSeriesCatalogNow)(merged.document));
        applyLink(null); setToast(`${selected.file.name}から人物を読み込みました。作品を保存すると反映されます`);
      } catch (error) { setToast(`人物を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`); }
      return;
    }
    setCharacterTextBusy(true);
    try {
      await withCharacterTextBridge(async () => {
        const persistForCurrentFlow = showNewDialog
          ? persistNewCharacterCatalog
          : persistSeriesCatalogNow;
        const prepared = await persistForCurrentFlow(source);
        const seriesId = prepared.manga.meta.series_id;
        if (!seriesId) throw new Error('シリーズの保存先を準備できませんでした');
        const linked = await linkSeriesCharacterText(prepared.manga.meta.series, seriesId, defaultDirectory);
        if (!linked) return;
        const imported = parseCharacterText(linked.text);
        const merged = mergeCharacterTextCatalog(prepared, imported);
        const saved = await persistForCurrentFlow(merged.document);
        const synced = showNewDialog ? linked : await syncSeriesCharacterText(
          saved.manga.meta.series_id,
          toCharacterTextMarkdown(saved),
          seriesCharacterCatalogIds(saved),
        );
        apply(saved);
        applyLink(synced);
        setToast(imported.length
          ? `${linked.fileName}から人物${imported.length}名を読み込み、シリーズ人物台帳と連携しました`
          : `${linked.fileName}をシリーズ人物台帳として連携しました`);
      });
    } catch (error) {
      setToast(`人物テキストを連携できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setCharacterTextBusy(false);
    }
  };

  const deleteSeriesCharacter = async (
    source: MangaDocument,
    characterLocalId: string,
    apply: (next: MangaDocument) => void,
    applyLink: (next: SeriesCharacterTextLink | null) => void,
  ) => {
    const character = source.manga.characters.find((entry) => entry.localId === characterLocalId);
    if (!character?.catalog_id || !source.manga.meta.series_id) return;
    setCharacterTextBusy(true);
    try {
      await withCharacterTextBridge(async () => {
        const archiveDocument = characterArchiveDocument(source, character.catalog_id!);
        const next = withoutSeriesCharacter(source, characterLocalId);
        if (showNewDialog || isLanClient) {
          const saved = await (showNewDialog ? persistNewCharacterCatalog : persistSeriesCatalogNow)(next, { deleteCharacterCatalogIds: [character.catalog_id!] });
          apply(saved);
          setToast(`「${character.name}」を削除しました。保存しなければ元に戻ります`);
          return;
        }
        const synced = await syncSeriesCharacterText(
          source.manga.meta.series_id,
          toCharacterTextMarkdown(next),
          seriesCharacterCatalogIds(next),
          {
            characterCatalogId: character.catalog_id!,
            characterName: character.name,
            omnyYaml: toSeriesCatalogMangaYaml(archiveDocument),
          },
        );
        const saved = await persistSeriesCatalogNow(next, { deleteCharacterCatalogIds: [character.catalog_id!] });
        apply(saved);
        applyLink(synced);
        setToast(`「${character.name}」を削除しました。30日以内なら復元できます`);
      });
    } catch (error) {
      setToast(`人物を削除できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setCharacterTextBusy(false);
    }
  };

  const restoreDeletedCharacter = async (
    source: MangaDocument,
    deletionId: string,
    apply: (next: MangaDocument) => void,
    applyLink: (next: SeriesCharacterTextLink | null) => void,
  ) => {
    const seriesId = source.manga.meta.series_id;
    if (!seriesId) return;
    setCharacterTextBusy(true);
    try {
      await withCharacterTextBridge(async () => {
        const restored = await restoreSeriesCharacterText(seriesId, deletionId);
        if (!restored.found) throw new Error('復元期限を過ぎたか、復元データが見つかりません');
        const archived = parseMangaYaml(restored.omnyYaml);
        const merged = mergeSeriesCatalog(source, archived).document;
        const saved = await persistSeriesCatalogNow(merged);
        const synced = await syncSeriesCharacterText(
          saved.manga.meta.series_id,
          toCharacterTextMarkdown(saved),
          seriesCharacterCatalogIds(saved),
        );
        apply(saved);
        applyLink(synced);
        setToast(`「${restored.characterName}」を復元しました`);
      });
    } catch (error) {
      setToast(`人物を復元できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setCharacterTextBusy(false);
    }
  };

  return { syncCharacterText, persistNewCharacterCatalog, persistSeriesCatalog, linkCharacterText, deleteSeriesCharacter, restoreDeletedCharacter };
}
