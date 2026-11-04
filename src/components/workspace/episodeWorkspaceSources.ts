import { isLanClient } from '../../lib/clientRuntime';
import {
  selectEpisodeWorkspace, prepareEpisodeWorkspace, chooseEpisodeWorkspaceSource,
  saveSourceCoverageReport, chooseEpisodeWorkspaceImages, type EpisodeWorkspace,
  type EpisodeWorkspaceTextSelection,
} from '../../lib/localBridge';
import { savedWorkspaceRoot, rememberWorkspaceRoot } from '../../lib/workspacePreferences';
import { browserWorkspaces } from '../../lib/browserWorkspace';
import type { SourceCoverageSource, SourceCoverageDecision } from '../../lib/sourceCoverage.ts';
import { withNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { MutableRef } from './workspaceTypes';
import type { MangaDocument } from '../../types';
import type { ProjectBinding } from '../../lib/projectPersistence';
import type { BoundSourceSnapshot } from '../../lib/newProjectSettings';
import type { NewLayoutTask } from '../../lib/newLayoutPreview';
import type { RefObject } from 'preact';

interface Context {
  setToast: Dispatch<StateUpdater<string | null>>;
  documentRef: MutableRef<MangaDocument>;
  setBoundEpisodeWorkspace: Dispatch<StateUpdater<ProjectBinding | null>>;
  boundEpisodeWorkspace: ProjectBinding | null;
  setBoundSourceSnapshot: Dispatch<StateUpdater<BoundSourceSnapshot | null>>;
  boundSourceSnapshot: BoundSourceSnapshot | null;
  setSourceCoverageDecisions: Dispatch<StateUpdater<SourceCoverageDecision[]>>;
  coverageWorkspace: ProjectBinding | null;
  newCreationBridgeToken: MutableRef<string | null>;
  characterEditorBridgeToken: MutableRef<string | null>;
  newEpisodeWorkspace: EpisodeWorkspace | null;
  setNewReferenceMessage: Dispatch<StateUpdater<string>>;
  setNewReferenceSelecting: Dispatch<StateUpdater<boolean>>;
  readNewReferenceFile: (selection?: EpisodeWorkspaceTextSelection) => Promise<void>;
  newReferenceFileName: string;
  newLayoutTask: NewLayoutTask;
  newLayoutImageInput: RefObject<HTMLInputElement>;
  chooseNewLayoutImages: (files?: ArrayLike<File> | Iterable<File> | null) => void;
  setNewLayoutMessage: Dispatch<StateUpdater<string | null>>;
}

export function createWorkspaceSourceActions({
  setToast, documentRef, setBoundEpisodeWorkspace, boundEpisodeWorkspace, setBoundSourceSnapshot,
  boundSourceSnapshot, setSourceCoverageDecisions, coverageWorkspace, newCreationBridgeToken,
  characterEditorBridgeToken, newEpisodeWorkspace, setNewReferenceMessage, setNewReferenceSelecting,
  readNewReferenceFile, newReferenceFileName, newLayoutTask, newLayoutImageInput,
  chooseNewLayoutImages, setNewLayoutMessage,
}: Context) {
  const choosePanelDraftWorkspace = async (): Promise<void> => {
    if (isLanClient) { setToast('作画用ラフの制作台帳はMac側フォルダを使う機能です。LANではレイヤーの画像生成を使ってください'); return; }
    const current = documentRef.current;
    const episodeId = current.manga.meta.episode_id;
    if (!episodeId) throw new Error('エピソードIDがないため制作台帳を関連付けられません');
    const workspaceKey = current.manga.meta.series_id || '__one_shot__';
    const workspace = await selectEpisodeWorkspace(savedWorkspaceRoot(workspaceKey));
    if (!workspace) return;
    await prepareEpisodeWorkspace(workspace.token);
    rememberWorkspaceRoot(workspaceKey, current.manga.meta.series_id ? workspace.seriesDirectory : workspace.directory);
    setBoundEpisodeWorkspace({ ...workspace, episodeId, projectRevision: boundEpisodeWorkspace?.directory === workspace.directory ? boundEpisodeWorkspace.projectRevision : undefined });
    setToast(`${workspace.folderName}を作画用ラフの自動保存先にしました`);
  };

  const chooseCoverageWorkspace = async (): Promise<void> => {
    if (isLanClient) { setToast('原文確認の結果は「JSONをダウンロード」でこのPCに保存できます'); return; }
    const current = documentRef.current;
    const episodeId = current.manga.meta.episode_id;
    if (!episodeId) throw new Error('エピソードIDがないため原文確認reportを関連付けられません');
    const workspaceKey = current.manga.meta.series_id || '__one_shot__';
    const workspace = await selectEpisodeWorkspace(savedWorkspaceRoot(workspaceKey));
    if (!workspace) return;
    await prepareEpisodeWorkspace(workspace.token);
    rememberWorkspaceRoot(workspaceKey, current.manga.meta.series_id ? workspace.seriesDirectory : workspace.directory);
    setBoundEpisodeWorkspace({ ...workspace, episodeId, projectRevision: boundEpisodeWorkspace?.directory === workspace.directory ? boundEpisodeWorkspace.projectRevision : undefined });
    setBoundSourceSnapshot((snapshot) => snapshot?.episodeId === episodeId
      && snapshot.source.relativePath === null
      ? { ...snapshot, workspaceDirectory: workspace.directory }
      : snapshot);
    const sourceNeedsReselect = boundSourceSnapshot?.episodeId === episodeId
      && boundSourceSnapshot.source.relativePath !== null
      && boundSourceSnapshot.workspaceDirectory !== workspace.directory;
    setToast(sourceNeedsReselect
      ? `${workspace.folderName}を保存先にしました。作品フォルダ内の原文を選び直してください`
      : `${workspace.folderName}を原文確認reportの保存先にしました`);
  };

  const chooseCoverageWorkspaceSource = async (): Promise<void> => {
    const episodeId = documentRef.current.manga.meta.episode_id;
    const workspace = boundEpisodeWorkspace?.episodeId === episodeId ? boundEpisodeWorkspace : null;
    if (!workspace) throw new Error('先にこの作品のエピソード保存先を関連付けてください');
    const selection = await (isLanClient ? browserWorkspaces.chooseText(workspace.token) : chooseEpisodeWorkspaceSource(workspace.token));
    if (!selection) return;
    setBoundSourceSnapshot({
      episodeId,
      source: { fileName: selection.file.name, relativePath: selection.relativePath, text: await selection.file.text() },
      seriesMode: documentRef.current.manga.meta.series_id ? 'existing' : 'none',
      workspaceDirectory: workspace.directory,
      selectedByteSize: selection.byteSize,
      selectedSha256: selection.sha256,
    });
    setSourceCoverageDecisions([]);
    setToast(`${selection.file.name}を原文確認へ読み込みました`);
  };

  const setCoverageSource = (source: SourceCoverageSource): void => {
    const current = documentRef.current;
    const workspace = boundEpisodeWorkspace?.episodeId === current.manga.meta.episode_id ? boundEpisodeWorkspace : null;
    setBoundSourceSnapshot({
      episodeId: current.manga.meta.episode_id,
      source,
      seriesMode: current.manga.meta.series_id ? 'existing' : 'none',
      workspaceDirectory: workspace?.directory ?? '',
      selectedByteSize: new TextEncoder().encode(source.text).byteLength,
      selectedSha256: null,
    });
    setSourceCoverageDecisions([]);
  };

  const saveCoverageReport = async (report: Parameters<typeof saveSourceCoverageReport>[2]) => {
    if (!coverageWorkspace || !boundSourceSnapshot
      || boundSourceSnapshot.episodeId !== documentRef.current.manga.meta.episode_id
      || boundSourceSnapshot.workspaceDirectory !== coverageWorkspace.directory) {
      throw new Error('この作品のエピソード保存先をもう一度関連付けてください');
    }
    const save = () => saveSourceCoverageReport(
      coverageWorkspace.token,
      documentRef.current.manga.meta.episode_id,
      report,
    );
    if (newCreationBridgeToken.current || characterEditorBridgeToken.current) return save();
    return withNewCreationBridgeSession(save);
  };

  const chooseNewCharacterImageFiles = async (): Promise<File[]> => {
    if (!newEpisodeWorkspace) throw new Error('先にエピソードの保存先を選んでください');
    return chooseEpisodeWorkspaceImages(newEpisodeWorkspace.token, 12);
  };

  const chooseNewReferenceTextFile = async () => {
    if (!newEpisodeWorkspace) {
      setNewReferenceMessage('先に保存先を選んでください。');
      return;
    }
    setNewReferenceSelecting(true);
    setNewReferenceMessage('参照テキストを開いています…');
    try {
      const selection = isLanClient ? await browserWorkspaces.chooseText(newEpisodeWorkspace.token) : await chooseEpisodeWorkspaceSource(newEpisodeWorkspace.token);
      if (selection) await readNewReferenceFile(selection);
      else setNewReferenceMessage(newReferenceFileName ? '' : '参照テキストはまだ選ばれていません。');
    } catch (error) {
      setNewReferenceMessage(`読み込めませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setNewReferenceSelecting(false);
    }
  };

  const chooseNewLayoutImageFiles = async () => {
    if (newLayoutTask !== 'idle') return;
    if (isLanClient) { newLayoutImageInput.current?.click(); return; }
    if (!newEpisodeWorkspace) return;
    try {
      const files = await chooseEpisodeWorkspaceImages(newEpisodeWorkspace.token, 10);
      chooseNewLayoutImages(files);
    } catch (error) {
      setNewLayoutMessage(error instanceof Error ? error.message : '画像を読み込めませんでした');
    }
  };

  return { choosePanelDraftWorkspace, setCoverageSource, chooseCoverageWorkspaceSource, chooseCoverageWorkspace, saveCoverageReport, chooseNewReferenceTextFile, chooseNewCharacterImageFiles, chooseNewLayoutImageFiles };
}
