import type { WorkspaceState } from './useWorkspaceState';
import { isLanClient } from '../../lib/clientRuntime';
import { type SeriesCatalogDraftSession, beginSeriesCatalogDraft, getSeriesCharacterTextStatus, discardSeriesCatalogDraft } from '../../lib/localBridge';
import { mergeCharacterTextCatalog, parseCharacterText } from '../../lib/characterTextCatalog.ts';
import { fillEmptySeriesSetting, seriesSettingFromImported } from '../../lib/newProjectSettings';
import { parseSeriesSettingText } from '../../lib/settingTextImport.ts';
import { prefillEpisodeSettingFromSeries } from '../../lib/seriesCatalog';
import type { MangaDocument, MangaSeriesSetting } from '../../types';
import { cloneDocument } from '../../lib/manga';
import { synchronizeCatalogReferences } from '../../lib/catalogModel';

interface Context {
  createNewCharacterDraft: (seriesName: string, seriesId: string) => MangaDocument;
  setNewCharacterDocument: (next: MangaDocument | null) => void;
  mergeSavedSeriesCatalog: (source: MangaDocument) => Promise<{ document: MangaDocument; added: number; warning: string; seriesSetting: MangaSeriesSetting; }>;
  discardNewCharacterDraft: () => Promise<void>;
}

export function createSeriesPreparation({
  newSeriesPreparing, newEpisodeWorkspace, setNewWorkspaceMessage, newSeriesMode, setNewSeriesName,
  setNewSeriesId, setNewCharacterTextLink, setNewCreationStep, newSeriesName, setSeriesCatalogMessage,
  newSeriesId, seriesCatalogs, setNewSeriesPreparing, newSeriesReferences, newSeriesReference,
  setNewWorkSetting, newCharacterDraftSession, newCharacterDocumentRef, seriesCatalogSaving, setToast,
}: WorkspaceState, {
  createNewCharacterDraft, setNewCharacterDocument, mergeSavedSeriesCatalog, discardNewCharacterDraft,
}: Context) {
  const continueFromSeriesSelection = async () => {
    if (newSeriesPreparing) return;
    if (!newEpisodeWorkspace) {
      setNewWorkspaceMessage('このエピソードの保存先を選んでください。');
      return;
    }
    if (newSeriesMode === 'none') {
      const draft = createNewCharacterDraft('', '');
      setNewSeriesName('');
      setNewSeriesId('');
      setNewCharacterDocument(draft);
      setNewCharacterTextLink(null);
      setNewCreationStep('characters');
      return;
    }
    if (newSeriesMode === 'new' && !newSeriesName.trim()) {
      setSeriesCatalogMessage(isLanClient ? 'シリーズ名を入力してください。' : 'シリーズ名を含む資料（例：シリーズ名：作品名）を反映してください。');
      return;
    }
    if (newSeriesMode === 'existing' && !newSeriesId) {
      setSeriesCatalogMessage('追加先のシリーズを選んでください。');
      return;
    }
    const selected = newSeriesMode === 'existing'
      ? seriesCatalogs.find((item) => item.seriesId === newSeriesId)
      : undefined;
    const seriesName = selected?.seriesName ?? newSeriesName.trim();
    const seriesId = selected?.seriesId ?? (newSeriesId || crypto.randomUUID());
    setNewSeriesPreparing(true);
    setSeriesCatalogMessage('登場人物を準備しています…');
    let draftSession: SeriesCatalogDraftSession | null = null;
    try {
      const draft = createNewCharacterDraft(seriesName, seriesId);
      const merged = await mergeSavedSeriesCatalog(draft);
      let preparedDocument = merged.document;
      const references = newSeriesReferences.length
        ? newSeriesReferences
        : newSeriesReference ? [newSeriesReference] : [];
      for (const reference of references) {
        preparedDocument = mergeCharacterTextCatalog(
          preparedDocument,
          parseCharacterText(reference.text),
        ).document;
        preparedDocument.manga.series_setting = fillEmptySeriesSetting(
          preparedDocument.manga.series_setting,
          seriesSettingFromImported(parseSeriesSettingText(reference.text)),
        );
      }
      setNewWorkSetting((current) => prefillEpisodeSettingFromSeries(current, preparedDocument.manga.series_setting));
      const resolvedSeriesId = preparedDocument.manga.meta.series_id || seriesId;
      if (!isLanClient) draftSession = await beginSeriesCatalogDraft(seriesName, resolvedSeriesId, draft.manga.meta.episode_id);
      newCharacterDraftSession.current = draftSession;
      setNewSeriesName(seriesName);
      setNewSeriesId(resolvedSeriesId);
      setNewCharacterDocument(preparedDocument);
      if (isLanClient) { setNewCharacterTextLink(null); }
      else if (newSeriesMode === 'existing') {
        const status = await getSeriesCharacterTextStatus(preparedDocument.manga.meta.series_id || seriesId).catch(() => null);
        setNewCharacterTextLink(status?.linked || status?.needsRelink || status?.deletedCharacters.length ? status : null);
      } else if (newSeriesReference) {
        setNewCharacterTextLink({
          linked: true,
          needsRelink: false,
          seriesId: resolvedSeriesId,
          seriesDirectory: newSeriesReference.seriesDirectory,
          relativePath: newSeriesReference.relativePath,
          fileName: newSeriesReference.fileName,
          text: newSeriesReference.text,
          deletedCharacters: [],
        });
      } else {
        setNewCharacterTextLink(null);
      }
      setSeriesCatalogMessage(merged.warning || '');
      setNewCreationStep('characters');
    } catch (error) {
      if (draftSession) {
        await discardSeriesCatalogDraft(draftSession.token).catch(() => undefined);
        if (newCharacterDraftSession.current?.token === draftSession.token) newCharacterDraftSession.current = null;
      }
      setSeriesCatalogMessage(error instanceof Error ? error.message : '登場人物を準備できませんでした。');
    } finally {
      setNewSeriesPreparing(false);
    }
  };

  const patchNewCharacterDocument = (recipe: (draft: MangaDocument) => boolean | void): MangaDocument => {
    const latest = newCharacterDocumentRef.current;
    if (!latest) throw new Error('新規作成中の人物台帳がありません');
    const next = cloneDocument(latest);
    if (recipe(next) === false) return latest;
    synchronizeCatalogReferences(next);
    setNewCharacterDocument(next);
    return next;
  };

  const returnToSeriesSelection = async () => {
    if (seriesCatalogSaving) return;
    setSeriesCatalogMessage('保存していない人物データを破棄しています…');
    try {
      await discardNewCharacterDraft();
      setNewCharacterDocument(null);
      setNewCharacterTextLink(null);
      setSeriesCatalogMessage('');
      setNewCreationStep('series');
    } catch (error) {
      setToast(`保存していない人物データを破棄できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  return { patchNewCharacterDocument, returnToSeriesSelection, continueFromSeriesSelection };
}
