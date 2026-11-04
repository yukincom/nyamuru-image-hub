import { isLanClient } from '../../lib/clientRuntime';
import {
  beginSeriesCatalogDraft, type EpisodeWorkspaceTextSelection, type SeriesCharacterTextLink,
  type SeriesCatalogDraftSession, type EpisodeWorkspace, type ReferenceTextSuggestion,
  type SeriesReferenceTextSelection,
} from '../../lib/localBridge';
import { prefillEpisodeSettingFromSeries } from '../../lib/seriesCatalog';
import { type ImportedStorySetting, parseStoryReferenceText } from '../../lib/settingTextImport.ts';
import { parseScenario } from '../../lib/scenario.ts';
import {
  seriesTitleFromReferences, type SeriesCatalogPersistOptions, type NewSeriesMode,
  type NewCreationStep, type NewSourceSnapshot,
} from '../../lib/newProjectSettings';
import { sha256Hex } from '../../lib/sourceCoverage.ts';
import type { MutableRef } from './workspaceTypes';
import type { MangaDocument } from '../../types';
import type { Dispatch, StateUpdater } from 'preact/hooks';

interface Context {
  newCharacterDocumentRef: MutableRef<MangaDocument | null>;
  persistNewCharacterCatalog: (source: MangaDocument, options?: Omit<SeriesCatalogPersistOptions, 'seriesSetting'>) => Promise<MangaDocument>;
  newCharacterTextLink: SeriesCharacterTextLink | null;
  syncCharacterText: (source: MangaDocument, archive?: { characterCatalogId: string; characterName: string; omnyYaml: string; }) => Promise<SeriesCharacterTextLink | null>;
  setNewCharacterTextLink: Dispatch<StateUpdater<SeriesCharacterTextLink | null>>;
  commitNewCharacterDraft: () => Promise<void>;
  newCharacterDraftSession: MutableRef<SeriesCatalogDraftSession | null>;
  setToast: Dispatch<StateUpdater<string | null>>;
  seriesCatalogSaving: boolean;
  setNewCharacterDocument: (next: MangaDocument | null) => void;
  newSeriesMode: NewSeriesMode;
  setNewWorkSetting: Dispatch<StateUpdater<ImportedStorySetting>>;
  setNewCreationStep: Dispatch<StateUpdater<NewCreationStep>>;
  setNewSettingMessage: Dispatch<StateUpdater<string>>;
  patchNewCharacterDocument: (recipe: (draft: MangaDocument) => boolean | void) => MangaDocument;
  setNewSourceSnapshot: Dispatch<StateUpdater<NewSourceSnapshot | null>>;
  newEpisodeWorkspace: EpisodeWorkspace | null;
  setNewReferenceFileName: Dispatch<StateUpdater<string>>;
  setNewSuggestedEpisodeReference: Dispatch<StateUpdater<ReferenceTextSuggestion | null>>;
  setNewReferenceMessage: Dispatch<StateUpdater<string>>;
  setNewSeriesName: Dispatch<StateUpdater<string>>;
  newSeriesReferences: SeriesReferenceTextSelection[];
  setNewWorkTitle: Dispatch<StateUpdater<string>>;
  setNewEpisodeNumber: Dispatch<StateUpdater<string>>;
  newSuggestedEpisodeReference: ReferenceTextSuggestion | null;
  newWorkSetting: ImportedStorySetting;
}

export function createEpisodeSettingActions({
  newCharacterDocumentRef, persistNewCharacterCatalog, newCharacterTextLink, syncCharacterText,
  setNewCharacterTextLink, commitNewCharacterDraft, newCharacterDraftSession, setToast,
  seriesCatalogSaving, setNewCharacterDocument, newSeriesMode, setNewWorkSetting, setNewCreationStep,
  setNewSettingMessage, patchNewCharacterDocument, setNewSourceSnapshot, newEpisodeWorkspace,
  setNewReferenceFileName, setNewSuggestedEpisodeReference, setNewReferenceMessage, setNewSeriesName,
  newSeriesReferences, setNewWorkTitle, setNewEpisodeNumber, newSuggestedEpisodeReference,
  newWorkSetting,
}: Context) {
  const saveNewCharacters = async () => {
    const latest = newCharacterDocumentRef.current;
    if (!latest) return;
    try {
      const prepared = await persistNewCharacterCatalog(latest);
      if (newCharacterTextLink?.linked) {
        const synced = await syncCharacterText(prepared);
        if (synced) setNewCharacterTextLink(synced);
      }
      await commitNewCharacterDraft();
      if (!isLanClient && prepared.manga.meta.series.trim() && prepared.manga.meta.series_id) {
        try {
          newCharacterDraftSession.current = await beginSeriesCatalogDraft(
            prepared.manga.meta.series,
            prepared.manga.meta.series_id,
            prepared.manga.meta.episode_id,
          );
        } catch (error) {
          setToast(`登場人物は保存しましたが、続きの仮編集を準備できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
          return;
        }
      }
      setToast('登場人物を保存しました');
    } catch (error) {
      setToast(`登場人物を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const continueFromNewCharacters = async () => {
    const latest = newCharacterDocumentRef.current;
    if (!latest || seriesCatalogSaving) return;
    try {
      const prepared = await persistNewCharacterCatalog(latest);
      setNewCharacterDocument(prepared);
      if (newCharacterTextLink?.linked) {
        const synced = await syncCharacterText(prepared);
        if (synced) setNewCharacterTextLink(synced);
      }
      if (newSeriesMode !== 'none') {
        setNewWorkSetting((current) => prefillEpisodeSettingFromSeries(current, prepared.manga.series_setting));
      }
      setNewCreationStep('setting');
    } catch (error) {
      setToast(`登場人物を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const updateNewWorkSetting = (key: keyof ImportedStorySetting, value: string) => {
    setNewWorkSetting((current) => ({ ...current, [key]: value }));
    setNewSettingMessage('');
  };

  const updateNewSeriesSetting = (key: 'genre' | 'target_audience' | 'situation', value: string) => {
    patchNewCharacterDocument((draft) => {
      draft.manga.series_setting[key] = value;
    });
    setNewSettingMessage('');
  };

  const readNewReferenceFile = async (selection?: EpisodeWorkspaceTextSelection) => {
    if (!selection) return;
    const { file } = selection;
    try {
      const text = await file.text();
      setNewSourceSnapshot({
        source: { fileName: file.name, relativePath: selection.relativePath, text },
        seriesMode: newSeriesMode,
        workspaceDirectory: newEpisodeWorkspace?.directory ?? '',
        selectedByteSize: selection.byteSize,
        selectedSha256: selection.sha256,
      });
      setNewReferenceFileName(file.name);
      setNewSuggestedEpisodeReference(null);
      const imported = parseStoryReferenceText(text);
      const scenario = parseScenario(text);
      const applied = [
        imported.seriesTitle,
        imported.subtitle,
        imported.episodeNumber,
        ...Object.values(imported.setting),
      ].filter((value) => value.trim()).length;
      if (!applied && !scenario) {
        setNewReferenceMessage(`${file.name}を資料テキストとして保持します。シナリオは「# シナリオ」の下にページ・コマごとに記載してください。`);
        return;
      }
      if (newSeriesMode === 'new' && imported.seriesTitle) {
        setNewSeriesName(seriesTitleFromReferences(newSeriesReferences) || imported.seriesTitle);
      }
      if (newSeriesMode === 'none') setNewWorkTitle(imported.subtitle || imported.seriesTitle);
      else if (imported.subtitle) setNewWorkTitle(imported.subtitle);
      if (imported.episodeNumber) setNewEpisodeNumber(imported.episodeNumber);
      setNewWorkSetting((current) => ({
        location: imported.setting.location || current.location,
        time: imported.setting.time || current.time,
        weather: imported.setting.weather || current.weather,
        situation: imported.setting.situation || current.situation,
      }));
      const fields = [
        imported.seriesTitle ? 'タイトル' : '',
        imported.subtitle ? 'サブタイトル' : '',
        imported.episodeNumber ? '話数' : '',
        Object.values(imported.setting).some((value) => value.trim()) ? '舞台設定' : '',
        scenario ? `シナリオ（${scenario.panels.length}コマ・セリフ${scenario.panels.reduce((sum, panel) => sum + panel.dialogues.length, 0)}件）` : '',
      ].filter(Boolean).join('・');
      setNewReferenceMessage(`${file.name}から${fields}を読み込みました。`);
      setNewSettingMessage('');
    } catch (error) {
      setNewReferenceMessage(`読み込めませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const applySuggestedReferenceTexts = async () => {
    if (newSuggestedEpisodeReference) {
      const mediaType = /\.(?:md|markdown)$/iu.test(newSuggestedEpisodeReference.fileName) ? 'text/markdown' : 'text/plain';
      const bytes = new TextEncoder().encode(newSuggestedEpisodeReference.text);
      await readNewReferenceFile({
        file: new File([bytes], newSuggestedEpisodeReference.fileName, { type: mediaType }),
        relativePath: newSuggestedEpisodeReference.relativePath,
        byteSize: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      });
    }
  };

  const continueFromNewSetting = async () => {
    if (!newWorkSetting.situation.trim()) {
      setNewSettingMessage('あらすじを入力してください。');
      return;
    }
    try {
      if (newSeriesMode !== 'none') {
        const latest = newCharacterDocumentRef.current;
        if (!latest) throw new Error('シリーズの舞台を確認できません');
        await persistNewCharacterCatalog(latest);
      }
      setNewSettingMessage('');
      setNewCreationStep('layout');
    } catch (error) {
      setNewSettingMessage(`シリーズの舞台を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  return { readNewReferenceFile, continueFromNewCharacters, applySuggestedReferenceTexts, saveNewCharacters, continueFromNewSetting, updateNewSeriesSetting, updateNewWorkSetting };
}
