import type { WorkspaceState } from './useWorkspaceState';
import type { MangaDocument } from '../../types';
import { emptyNewSeriesSetting, emptyNewWorkSetting, fillEmptySeriesSetting, seriesSettingFromImported, seriesSettingSummary } from '../../lib/newProjectSettings';
import { loadSeriesCatalog, getSeriesCharacterTextStatus, type SeriesReferenceTextSelection } from '../../lib/localBridge';
import { cloneDocument, parseMangaYaml, newPage } from '../../lib/manga';
import { mergeSeriesCatalog, prefillEpisodeSettingFromSeries } from '../../lib/seriesCatalog';
import { createEmptyWorkspaceDocument } from '../../lib/workspaceStartup.ts';
import { createSystemMobCharacter } from '../../lib/systemCharacters';
import { isLanClient } from '../../lib/clientRuntime';
import { parseSeriesSettingText } from '../../lib/settingTextImport.ts';

interface Context {
  clearNewReferenceText: () => void;
}

export function createSeriesSelection({
  newWorkTitle, newEpisodeNumber, newLayoutFrameLineWidthMm, newLayoutRowGapMm, newLayoutColumnGapMm,
  newSeriesMode, newSeriesId, newSeriesSelectionGeneration, seriesCatalogs, setNewEpisodeWorkspace,
  setNewWorkspaceMessage, setNewSeriesId, setNewSeriesName, setNewSeriesDirectory, setNewSeriesReference,
  setNewSeriesReferences, setNewSeriesReferenceCandidates, setNewSelectedSeriesReferencePaths,
  setNewSeriesReferenceMessage, setNewCharacterTextLink, setSeriesCatalogMessage, setNewSeriesPreparing,
  setNewWorkSetting,
}: WorkspaceState, {
  clearNewReferenceText,
}: Context) {
  const mergeSavedSeriesCatalog = async (source: MangaDocument) => {
    const seriesName = source.manga.meta.series.trim();
    if (!seriesName) return { document: source, added: 0, warning: '', seriesSetting: emptyNewSeriesSetting() };
    try {
      const loaded = await loadSeriesCatalog(seriesName, source.manga.meta.series_id);
      const next = cloneDocument(source);
      next.manga.meta.series_id ||= loaded.seriesId || crypto.randomUUID();
      if (!loaded.found || !loaded.omnyYaml) {
        return { document: next, added: 0, warning: '', seriesSetting: emptyNewSeriesSetting() };
      }
      next.manga.meta.series_id = loaded.seriesId;
      const catalog = parseMangaYaml(loaded.omnyYaml);
      const merged = mergeSeriesCatalog(next, catalog);
      const warning = merged.conflicts.length
        ? `同名のエピソード素材を優先しました: ${merged.conflicts.join('、')}`
        : '';
      return {
        document: merged.document,
        added: merged.added,
        warning,
        seriesSetting: structuredClone(catalog.manga.series_setting),
      };
    } catch (error) {
      const next = cloneDocument(source);
      next.manga.meta.series_id ||= crypto.randomUUID();
      return {
        document: next,
        added: 0,
        seriesSetting: emptyNewSeriesSetting(),
        warning: `シリーズ共通を読み込めませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`,
      };
    }
  };

  const createNewCharacterDraft = (seriesName: string, seriesId: string): MangaDocument => {
    const empty = createEmptyWorkspaceDocument();
    return {
      manga: {
        schema_name: empty.manga.schema_name,
        schema_version: empty.manga.schema_version,
        meta: {
          ...structuredClone(empty.manga.meta),
          document_type: 'story',
          title: newWorkTitle.trim(),
          series: seriesName,
          series_id: seriesId,
          episode_number: newEpisodeNumber.trim(),
          episode_id: crypto.randomUUID(),
          author: '',
          page_count: 1,
          panel_frame_width_mm: newLayoutFrameLineWidthMm,
          panel_gutter_row_mm: newLayoutRowGapMm,
          panel_gutter_column_mm: newLayoutColumnGapMm,
        },
        layout_spec: '',
        series_setting: emptyNewSeriesSetting(),
        setting: emptyNewWorkSetting(),
        characters: [createSystemMobCharacter()],
        materials: [],
        pages: [newPage(1)],
      },
    };
  };

  const workspaceRootKey = () => newSeriesMode === 'none' ? '__one_shot__' : newSeriesId || '__new_series__';

  const selectExistingSeries = async (seriesId: string) => {
    const generation = ++newSeriesSelectionGeneration.current;
    const selected = seriesCatalogs.find((item) => item.seriesId === seriesId);
    clearNewReferenceText();
    setNewEpisodeWorkspace(null);
    setNewWorkspaceMessage('');
    setNewSeriesId(seriesId);
    setNewSeriesName(selected?.seriesName ?? '');
    setNewSeriesDirectory(selected?.seriesDirectory ?? '');
    setNewSeriesReference(null);
    setNewSeriesReferences([]);
    setNewSeriesReferenceCandidates([]);
    setNewSelectedSeriesReferencePaths([]);
    setNewSeriesReferenceMessage('');
    setNewCharacterTextLink(null);
    if (!seriesId || !selected) {
      setSeriesCatalogMessage(seriesCatalogs.length ? '' : '保存済みシリーズはまだありません。');
      return;
    }
    setNewSeriesPreparing(true);
    setSeriesCatalogMessage('シリーズ資料を読み込んでいます…');
    try {
      const [loaded, textStatus] = await Promise.all([
        loadSeriesCatalog(selected.seriesName, selected.seriesId),
        isLanClient ? null : getSeriesCharacterTextStatus(selected.seriesId).catch(() => null),
      ]);
      if (generation !== newSeriesSelectionGeneration.current) return;
      const catalog = loaded.found && loaded.omnyYaml ? parseMangaYaml(loaded.omnyYaml) : null;
      const catalogSetting = catalog?.manga.series_setting ?? emptyNewSeriesSetting();
      const seriesSetting = fillEmptySeriesSetting(
        catalogSetting,
        textStatus?.linked
          ? seriesSettingFromImported(parseSeriesSettingText(textStatus.text))
          : emptyNewSeriesSetting(),
      );
      const seriesDirectory = textStatus?.seriesDirectory || selected.seriesDirectory;
      setNewSeriesDirectory(seriesDirectory);
      setNewWorkSetting((current) => prefillEpisodeSettingFromSeries(current, seriesSetting));
      if (textStatus?.linked && textStatus.seriesDirectory && textStatus.relativePath && textStatus.fileName) {
        const reference: SeriesReferenceTextSelection = {
          seriesDirectory: textStatus.seriesDirectory,
          relativePath: textStatus.relativePath,
          fileName: textStatus.fileName,
          text: textStatus.text,
          kind: 'characters',
        };
        setNewSeriesReference(reference);
        setNewSeriesReferences([reference]);
        setNewSeriesReferenceMessage(`${textStatus.fileName}を参照します。`);
      }
      setNewCharacterTextLink(textStatus?.linked || textStatus?.needsRelink || textStatus?.deletedCharacters.length ? textStatus : null);
      setSeriesCatalogMessage(seriesSettingSummary(seriesSetting) ? 'シリーズの舞台を読み込みました。' : '');
    } catch (error) {
      if (generation !== newSeriesSelectionGeneration.current) return;
      setSeriesCatalogMessage(error instanceof Error ? error.message : 'シリーズ資料を読み込めませんでした。');
    } finally {
      if (generation === newSeriesSelectionGeneration.current) setNewSeriesPreparing(false);
    }
  };

  return { workspaceRootKey, createNewCharacterDraft, mergeSavedSeriesCatalog, selectExistingSeries };
}
