import {
  type SeriesReferenceTextSelection, chooseSeriesDirectory, type SeriesReferenceTextCandidate,
  type EpisodeWorkspaceTextSelection, chooseSeriesReferenceText, selectEpisodeWorkspace,
  suggestEpisodeWorkspaceText, type SeriesCharacterTextLink, type EpisodeWorkspace,
  type ReferenceTextSuggestion,
} from '../../lib/localBridge';
import { parseCharacterText } from '../../lib/characterTextCatalog.ts';
import {
  detectedSeriesReferenceKind, seriesTitleFromReferences, type NewSeriesMode, type NewSourceSnapshot,
} from '../../lib/newProjectSettings';
import { parseStoryReferenceText } from '../../lib/settingTextImport.ts';
import { isLanClient } from '../../lib/clientRuntime';
import { rememberWorkspaceRoot, savedWorkspaceRoot } from '../../lib/workspacePreferences';
import { browserWorkspaces } from '../../lib/browserWorkspace';
import { seriesReferenceConfirmationState, replaceSeriesReferenceCandidate } from '../../lib/seriesReferenceCandidates.ts';
import { chooseBrowserFiles, blobRevision } from '../../lib/browserFiles';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { MutableRef } from './workspaceTypes';

interface Context {
  setNewSeriesReferenceMessage: Dispatch<StateUpdater<string>>;
  newSeriesMode: NewSeriesMode;
  setNewSeriesName: Dispatch<StateUpdater<string>>;
  newSourceSnapshot: NewSourceSnapshot | null;
  newSeriesName: string;
  setNewSeriesDirectory: Dispatch<StateUpdater<string>>;
  setNewSeriesReference: Dispatch<StateUpdater<SeriesReferenceTextSelection | null>>;
  setNewSeriesReferences: Dispatch<StateUpdater<SeriesReferenceTextSelection[]>>;
  setNewSeriesReferenceCandidates: Dispatch<StateUpdater<(SeriesReferenceTextCandidate & { seriesDirectory: string; })[]>>;
  setNewSelectedSeriesReferencePaths: Dispatch<StateUpdater<string[]>>;
  workspaceRootKey: () => string;
  newSelectedSeriesReferencePaths: string[];
  newSeriesReferenceCandidates: (SeriesReferenceTextCandidate & { seriesDirectory: string; })[];
  newSeriesReferenceSelecting: boolean;
  newSeriesDirectorySelecting: boolean;
  newSeriesPreparing: boolean;
  newWorkspaceSelecting: boolean;
  newSeriesReferences: SeriesReferenceTextSelection[];
  newSeriesReference: SeriesReferenceTextSelection | null;
  setNewCharacterTextLink: Dispatch<StateUpdater<SeriesCharacterTextLink | null>>;
  newSeriesId: string;
  setNewSeriesDirectorySelecting: Dispatch<StateUpdater<boolean>>;
  setNewSeriesDirectoryMessage: Dispatch<StateUpdater<string>>;
  newSeriesDirectory: string;
  newEpisodeWorkspace: EpisodeWorkspace | null;
  setNewEpisodeWorkspace: Dispatch<StateUpdater<EpisodeWorkspace | null>>;
  clearNewReferenceText: () => void;
  newSeriesSelectionGeneration: MutableRef<number>;
  setNewSeriesReferenceSelecting: Dispatch<StateUpdater<boolean>>;
  setNewWorkspaceSelecting: Dispatch<StateUpdater<boolean>>;
  setNewWorkspaceMessage: Dispatch<StateUpdater<string>>;
  newReferenceFileName: string;
  setNewSuggestedEpisodeReference: Dispatch<StateUpdater<ReferenceTextSuggestion | null>>;
  setNewReferenceMessage: Dispatch<StateUpdater<string>>;
}

export function createSeriesReferenceActions({
  setNewSeriesReferenceMessage, newSeriesMode, setNewSeriesName, newSourceSnapshot, newSeriesName,
  setNewSeriesDirectory, setNewSeriesReference, setNewSeriesReferences,
  setNewSeriesReferenceCandidates, setNewSelectedSeriesReferencePaths, workspaceRootKey,
  newSelectedSeriesReferencePaths, newSeriesReferenceCandidates, newSeriesReferenceSelecting,
  newSeriesDirectorySelecting, newSeriesPreparing, newWorkspaceSelecting, newSeriesReferences,
  newSeriesReference, setNewCharacterTextLink, newSeriesId, setNewSeriesDirectorySelecting,
  setNewSeriesDirectoryMessage, newSeriesDirectory, newEpisodeWorkspace, setNewEpisodeWorkspace,
  clearNewReferenceText, newSeriesSelectionGeneration, setNewSeriesReferenceSelecting,
  setNewWorkspaceSelecting, setNewWorkspaceMessage, newReferenceFileName,
  setNewSuggestedEpisodeReference, setNewReferenceMessage,
}: Context) {
  const applyNewSeriesReferenceSelections = (selections: readonly SeriesReferenceTextSelection[], messagePrefix = '') => {
    if (!selections.length) {
      setNewSeriesReferenceMessage('反映するシリーズ資料へチェックを入れてください。');
      return;
    }
    let characterCount = 0;
    try {
      characterCount = selections.reduce((count, selection) => count + parseCharacterText(selection.text).length, 0);
    } catch (error) {
      setNewSeriesReferenceMessage(error instanceof Error ? error.message : '人物設定を読み取れませんでした。');
      return;
    }
    const normalized = selections.map((selection) => ({ ...selection, kind: detectedSeriesReferenceKind(selection) }));
    const characterReference = normalized.find((selection) => selection.kind === 'characters') ?? null;
    const seriesSettingCount = normalized.filter((selection) => selection.kind === 'series-setting').length;
    const seriesTitle = seriesTitleFromReferences(normalized);
    if (newSeriesMode === 'new') {
      setNewSeriesName(seriesTitle || (newSourceSnapshot ? parseStoryReferenceText(newSourceSnapshot.source.text).seriesTitle : '') || (isLanClient ? newSeriesName : ''));
    }
    const seriesDirectory = normalized[0].seriesDirectory;
    setNewSeriesDirectory(seriesDirectory);
    setNewSeriesReference(characterReference);
    setNewSeriesReferences(normalized);
    setNewSeriesReferenceCandidates([]);
    setNewSelectedSeriesReferencePaths([]);
    rememberWorkspaceRoot(workspaceRootKey(), seriesDirectory);
    const details = [
      newSeriesMode === 'new' && seriesTitle ? 'シリーズ名' : '',
      characterCount ? `登場人物${characterCount}人` : '',
      seriesSettingCount ? `シリーズ設定${seriesSettingCount}件` : '',
    ].filter(Boolean).join('・');
    setNewSeriesReferenceMessage(details
      ? `${messagePrefix}${details}を反映しました。`
      : `${messagePrefix}${normalized.length}件の資料を反映しました。`);
  };

  const applySelectedNewSeriesReferences = () => {
    const selectedPaths = new Set(newSelectedSeriesReferencePaths);
    applyNewSeriesReferenceSelections(newSeriesReferenceCandidates
      .filter((candidate) => selectedPaths.has(candidate.relativePath))
      .map((candidate) => ({
        seriesDirectory: candidate.seriesDirectory,
        relativePath: candidate.relativePath,
        fileName: candidate.fileName,
        text: candidate.text,
        kind: candidate.kind,
      })));
  };

  const removeSelectedNewSeriesReferences = () => {
    if (newSeriesReferenceSelecting || newSeriesDirectorySelecting || newSeriesPreparing || newWorkspaceSelecting) return;
    const rows = newSeriesReferenceCandidates.length ? newSeriesReferenceCandidates : newSeriesReferences;
    const selected = new Set(rows.filter(reference => newSelectedSeriesReferencePaths.includes(reference.relativePath))
      .map(reference => reference.relativePath));
    if (!selected.size) return;
    const remainingPaths = new Set(rows.filter(reference => !selected.has(reference.relativePath)).map(reference => reference.relativePath));
    const remaining = newSeriesReferences.filter(reference => remainingPaths.has(reference.relativePath));
    setNewSeriesReferenceCandidates(newSeriesReferenceCandidates.filter(reference => !selected.has(reference.relativePath)));
    setNewSeriesReferences(remaining);
    if (newSeriesReference && !remainingPaths.has(newSeriesReference.relativePath)) {
      setNewSeriesReference(remaining.find(reference => detectedSeriesReferenceKind(reference) === 'characters') ?? null);
      setNewCharacterTextLink(null);
    }
    setNewSelectedSeriesReferencePaths([]);
    setNewSeriesReferenceMessage(`${selected.size}件の資料を一覧から外しました。`);
  };

  const chooseNewSeriesDirectory = async () => {
    if (newSeriesDirectorySelecting || newSeriesMode === 'none' || (newSeriesMode === 'existing' && !newSeriesId)) return;
    setNewSeriesDirectorySelecting(true);
    setNewSeriesDirectoryMessage('シリーズフォルダを開いています…');
    try {
      const selection = await (isLanClient ? browserWorkspaces.chooseSeries(newSeriesDirectory || savedWorkspaceRoot(workspaceRootKey())) : chooseSeriesDirectory(newSeriesDirectory || savedWorkspaceRoot(workspaceRootKey())));
      if (!selection) {
        setNewSeriesDirectoryMessage(newSeriesDirectory ? '' : 'シリーズフォルダはまだ選ばれていません。');
        return;
      }
      if (newEpisodeWorkspace && newEpisodeWorkspace.seriesDirectory !== selection.seriesDirectory) {
        setNewEpisodeWorkspace(null);
        clearNewReferenceText();
      }
      setNewSeriesDirectory(selection.seriesDirectory);
      setNewSeriesReference(null);
      setNewSeriesReferences([]);
      const candidates = selection.candidates.length ? selection.candidates.map((candidate) => ({
        ...candidate,
        seriesDirectory: selection.seriesDirectory,
      })) : selection.suggestion ? [{
        seriesDirectory: selection.seriesDirectory,
        relativePath: selection.suggestion.relativePath,
        fileName: selection.suggestion.fileName,
        text: selection.suggestion.text,
        kind: detectedSeriesReferenceKind({
          seriesDirectory: selection.seriesDirectory,
          relativePath: selection.suggestion.relativePath,
          fileName: selection.suggestion.fileName,
          text: selection.suggestion.text,
        }),
        confidence: selection.suggestion.confidence,
        recommended: true,
      } satisfies SeriesReferenceTextCandidate & { seriesDirectory: string }] : [];
      const confirmation = seriesReferenceConfirmationState(candidates);
      setNewSeriesReferenceCandidates(candidates);
      setNewSelectedSeriesReferencePaths(confirmation.selectedPaths);
      rememberWorkspaceRoot(workspaceRootKey(), selection.seriesDirectory);
      setNewSeriesDirectoryMessage('');
      if (confirmation.requiresConfirmation) {
        setNewSeriesReferenceMessage('');
      } else if (selection.ambiguous) {
        setNewSeriesReferenceMessage('資料を絞れませんでした。「資料を選択」から指定できます。');
      } else {
        setNewSeriesReferenceMessage('');
      }
    } catch (error) {
      setNewSeriesDirectoryMessage(error instanceof Error ? error.message : 'シリーズフォルダを選べませんでした。');
    } finally {
      setNewSeriesDirectorySelecting(false);
    }
  };

  const chooseLocalText = async (): Promise<EpisodeWorkspaceTextSelection | null> => {
    const [file] = await chooseBrowserFiles('.md,.markdown,.txt,.text,text/plain,text/markdown');
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) throw new Error('文章ファイルは5MiBまで選べます');
    const bytes = await file.arrayBuffer();
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { file, relativePath: null, byteSize: file.size, sha256: await blobRevision(file) };
  };

  const chooseNewSeriesReferenceTextFile = async (replacedPath?: string) => {
    if (newSeriesReferenceSelecting || newSeriesMode === 'none' || !newSeriesId || (!isLanClient && !newSeriesDirectory)) return;
    const generation = newSeriesSelectionGeneration.current;
    setNewSeriesReferenceSelecting(true);
    setNewSeriesReferenceMessage('シリーズ資料を開いています…');
    try {
      const local = isLanClient ? await (newSeriesDirectory ? browserWorkspaces.chooseText(newSeriesDirectory, true) : chooseLocalText()) : null;
      const selection = isLanClient ? (local ? { seriesDirectory: newSeriesDirectory, relativePath: local.relativePath || local.file.name, fileName: local.file.name, text: await local.file.text() } : null)
        : await chooseSeriesReferenceText(newSeriesId, newSeriesDirectory || savedWorkspaceRoot(workspaceRootKey()));
      if (generation !== newSeriesSelectionGeneration.current) return;
      if (!selection) {
        setNewSeriesReferenceMessage('');
        return;
      }
      if (selection.seriesDirectory !== newSeriesDirectory) throw new Error('同じシリーズフォルダ内の資料を選んでください。');
      const candidates = newSeriesReferenceCandidates.length ? newSeriesReferenceCandidates : newSeriesReferences.map((reference) => ({
        ...reference, kind: detectedSeriesReferenceKind(reference), confidence: 'high' as const, recommended: true,
      }));
      const next = replaceSeriesReferenceCandidate(candidates,
        newSeriesReferenceCandidates.length ? newSelectedSeriesReferencePaths : candidates.map((candidate) => candidate.relativePath),
        { ...selection, kind: detectedSeriesReferenceKind(selection), confidence: 'high' as const, recommended: true }, replacedPath);
      setNewSeriesReferenceCandidates(next.candidates);
      setNewSelectedSeriesReferencePaths(next.selectedPaths);
      setNewSeriesReferenceMessage('');
    } catch (error) {
      if (generation === newSeriesSelectionGeneration.current) setNewSeriesReferenceMessage(`読み込めませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      if (generation === newSeriesSelectionGeneration.current) setNewSeriesReferenceSelecting(false);
    }
  };

  const chooseNewEpisodeWorkspace = async () => {
    if (newWorkspaceSelecting || !newSeriesMode) return;
    setNewWorkspaceSelecting(true);
    setNewWorkspaceMessage('保存先を開いています…');
    try {
      const workspace = await (isLanClient ? browserWorkspaces.chooseEpisode(newSeriesDirectory || savedWorkspaceRoot(workspaceRootKey()), newSeriesMode === 'none' ? '' : newSeriesDirectory, true) : selectEpisodeWorkspace(newSeriesDirectory || savedWorkspaceRoot(workspaceRootKey())));
      if (!workspace) {
        setNewWorkspaceMessage(newEpisodeWorkspace ? '' : '保存先はまだ選ばれていません。');
        return;
      }
      if (newSeriesMode !== 'none' && newSeriesDirectory && workspace.seriesDirectory !== newSeriesDirectory) {
        setNewWorkspaceMessage('シリーズフォルダ内のエピソード保存先を選んでください。');
        return;
      }
      const workspaceChanged = Boolean(newEpisodeWorkspace?.directory && newEpisodeWorkspace.directory !== workspace.directory);
      if (workspaceChanged) clearNewReferenceText();
      setNewEpisodeWorkspace(workspace);
      if (newSeriesMode !== 'none' && !isLanClient) setNewSeriesDirectory(workspace.seriesDirectory);
      rememberWorkspaceRoot(workspaceRootKey(), newSeriesMode === 'none' ? workspace.directory : workspace.seriesDirectory);
      setNewWorkspaceMessage('');
      if (!newReferenceFileName || workspaceChanged) {
        const discovery = await (isLanClient ? browserWorkspaces.suggest(workspace.token) : suggestEpisodeWorkspaceText(workspace.token));
        setNewSuggestedEpisodeReference(discovery.suggestion);
        if (discovery.suggestion) {
          setNewReferenceMessage('');
        } else if (discovery.ambiguous) {
          setNewReferenceMessage('資料を絞れませんでした。「資料を選択」から指定できます。');
        } else {
          setNewReferenceMessage('');
        }
      }
    } catch (error) {
      setNewWorkspaceMessage(error instanceof Error ? error.message : '保存先を選べませんでした。');
    } finally {
      setNewWorkspaceSelecting(false);
    }
  };

  return { chooseLocalText, chooseNewSeriesDirectory, chooseNewSeriesReferenceTextFile, removeSelectedNewSeriesReferences, applySelectedNewSeriesReferences, chooseNewEpisodeWorkspace };
}
