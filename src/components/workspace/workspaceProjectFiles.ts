import { downloadBrowserBlob } from '../../lib/browserFiles';
import { toSeparatedMangaYaml, omnyFileName, cloneDocument } from '../../lib/manga';
import { isBrowserWorkspace, browserWorkspaces } from '../../lib/browserWorkspace';
import { createPortableProject, restorePortableProject } from '../../lib/portableProject';
import { beginFigureCropImport } from '../../lib/figureCropStore';
import { separateBubbleOriginals } from '../../lib/bubbleOriginals';
import { isLanClient } from '../../lib/clientRuntime';
import { rememberBrowserCatalog } from '../../lib/browserCatalog';
import type { MangaDocument, CanvasElementSelection, WorkspaceTab } from '../../types';
import { withNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import { selectEpisodeWorkspace, saveEpisodeProject, loadEpisodeProject } from '../../lib/localBridge';
import { savedWorkspaceRoot } from '../../lib/workspacePreferences';
import { createProjectSnapshot, restoreProjectSnapshot, type ProjectBinding } from '../../lib/projectPersistence';
import type { MutableRef, WorkspacePaintSession, MobileStoryboardPane } from './workspaceTypes';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { PaintController } from '../../lib/paintSession';
import type { SeriesCatalogPersistOptions, BoundSourceSnapshot } from '../../lib/newProjectSettings';
import type { SourceCoverageDecision } from '../../lib/sourceCoverage.ts';

interface Context {
  hasDocument: boolean;
  showNewDialog: boolean;
  projectOperation: MutableRef<boolean>;
  endTextEdit: () => void;
  documentRef: MutableRef<MangaDocument>;
  setToast: Dispatch<StateUpdater<string | null>>;
  setProjectBusy: Dispatch<StateUpdater<boolean>>;
  boundEpisodeWorkspace: ProjectBinding | null;
  paintController: MutableRef<PaintController | null>;
  persistSeriesCatalog: (source: MangaDocument, options?: SeriesCatalogPersistOptions) => Promise<MangaDocument>;
  applyPreparedSeriesIdentifiers: (prepared: MangaDocument) => MangaDocument | null;
  paintSessionRef: MutableRef<WorkspacePaintSession | null>;
  setPaintSession: Dispatch<StateUpdater<WorkspacePaintSession | null>>;
  setBoundEpisodeWorkspace: Dispatch<StateUpdater<ProjectBinding | null>>;
  replaceDocument: (next: MangaDocument) => void;
  setBoundSourceSnapshot: Dispatch<StateUpdater<BoundSourceSnapshot | null>>;
  setSourceCoverageDecisions: Dispatch<StateUpdater<SourceCoverageDecision[]>>;
  setActivePage: Dispatch<StateUpdater<number>>;
  setActivePanel: Dispatch<StateUpdater<number>>;
  setSelectedPanels: Dispatch<StateUpdater<number[]>>;
  setSelectedElement: Dispatch<StateUpdater<CanvasElementSelection | null>>;
  setTab: Dispatch<StateUpdater<WorkspaceTab>>;
  setMobileStoryboardPane: (value: MobileStoryboardPane) => void;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  saveProjectAction: MutableRef<() => Promise<unknown>>;
}

export function createProjectFileActions({
  hasDocument, showNewDialog, projectOperation, endTextEdit, documentRef, setToast, setProjectBusy,
  boundEpisodeWorkspace, paintController, persistSeriesCatalog, applyPreparedSeriesIdentifiers,
  paintSessionRef, setPaintSession, setBoundEpisodeWorkspace, replaceDocument, setBoundSourceSnapshot,
  setSourceCoverageDecisions, setActivePage, setActivePanel, setSelectedPanels, setSelectedElement,
  setTab, setMobileStoryboardPane, setDocument, saveProjectAction,
}: Context) {
  const exportOmny = () => {
    if (!hasDocument || showNewDialog || projectOperation.current) return;
    endTextEdit();
    try {
      const current = documentRef.current;
      downloadBrowserBlob(new Blob([toSeparatedMangaYaml(current)], { type: 'application/yaml;charset=utf-8' }), omnyFileName(current.manga.meta.title));
      setToast('構成データ（YAML）を書き出しました');
    } catch (error) { setToast(`構成データを書き出せませんでした: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const saveBrowserProject = async (chooseDestination = false) => {
    if (!hasDocument || showNewDialog || projectOperation.current) return;
    endTextEdit();
    const episodeId = documentRef.current.manga.meta.episode_id;
    projectOperation.current = true; setProjectBusy(true);
    try {
      let workspace = !chooseDestination && boundEpisodeWorkspace?.episodeId === episodeId && isBrowserWorkspace(boundEpisodeWorkspace) ? boundEpisodeWorkspace : null;
      if (!workspace) {
        const selected = await browserWorkspaces.chooseEpisode(boundEpisodeWorkspace?.directory, '', true);
        if (!selected) return '保存をキャンセルしました';
        workspace = { ...selected, episodeId };
      }
      const folderTarget = await browserWorkspaces.saveTarget(workspace);
      if (documentRef.current.manga.meta.episode_id !== episodeId) throw new Error('作品が切り替わったため保存を中止しました');
      await paintController.current?.flush();
      const source = documentRef.current;
      const prepared = source.manga.meta.series.trim() ? await persistSeriesCatalog(source) : source;
      const file = await createPortableProject(prepared);
      if (documentRef.current.manga.meta.episode_id !== episodeId) throw new Error('作品が切り替わったため保存を中止しました');
      const result = await browserWorkspaces.write(file, folderTarget);
      const newer = documentRef.current !== source;
      if (documentRef.current.manga.meta.episode_id === episodeId) {
        const previous = documentRef.current;
        applyPreparedSeriesIdentifiers(prepared);
        const paint = paintSessionRef.current;
        if (paint?.document === previous) { const updated = { ...paint, document: documentRef.current }; paintSessionRef.current = updated; setPaintSession(updated); }
        const binding = { ...workspace, projectRevision: result.binding.revision };
        setBoundEpisodeWorkspace(binding);
      }
      const outcome = `${workspace.folderName} に保存しました${newer ? '。保存中の追加編集は次回の保存で反映します' : ''}`;
      setToast(outcome); return outcome;
    } catch (error) { const outcome = `保存できませんでした: ${error instanceof Error ? error.message : String(error)}`; setToast(outcome); return outcome; }
    finally { projectOperation.current = false; setProjectBusy(false); }
  };

  const openBrowserProject = async () => {
    if (showNewDialog || projectOperation.current) return;
    if (hasDocument && !confirm('別の作品フォルダを開きます。現在の編集は保存済みですか？')) return;
    endTextEdit();
    projectOperation.current = true; setProjectBusy(true);
    const current = documentRef.current;
    const finishImageImport=beginFigureCropImport();
    try {
      const workspace = await browserWorkspaces.chooseEpisode(boundEpisodeWorkspace?.directory);
      if (!workspace) return;
      const selected = await browserWorkspaces.open(workspace);
      if (documentRef.current !== current) throw new Error('現在の作品が編集されたため読み込みを中止しました');
      const restored = await separateBubbleOriginals(await restorePortableProject(selected.value));
      if (documentRef.current !== current) throw new Error('現在の作品が編集されたため読み込みを中止しました');
      replaceDocument(restored);
      const binding = { ...workspace, episodeId: restored.manga.meta.episode_id, projectRevision: selected.binding.revision };
      setBoundEpisodeWorkspace(binding);
      setBoundSourceSnapshot(null); setSourceCoverageDecisions([]);
      setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setSelectedElement(null); setTab('storyboard'); setMobileStoryboardPane('editor');
      setToast(`${selected.file.name} から作品と画像を読み込みました`);
      if (isLanClient) await rememberBrowserCatalog(restored).catch(() => setToast('作品は開きましたが、このブラウザーのシリーズ一覧への登録に失敗しました'));
    } catch (error) { setToast(`読み込みできませんでした: ${error instanceof Error ? error.message : String(error)}`); }
    finally { projectOperation.current = false; setProjectBusy(false); finishImageImport(); }
  };

  const saveProject = async (chooseDestination = false) => {
    if (isLanClient) return saveBrowserProject(chooseDestination);
    if (!hasDocument || showNewDialog || projectOperation.current) return;
    endTextEdit();
    projectOperation.current = true;
    setProjectBusy(true);
    let outcome='保存をキャンセルしました';
    const bindPaintDocument=(previous:MangaDocument)=>{
      const session=paintSessionRef.current;
      if(session?.document===previous){const updated={...session,document:documentRef.current};paintSessionRef.current=updated;setPaintSession(updated);}
    };
    try {
      await paintController.current?.flush();
      let current = documentRef.current;
      if (!current.manga.meta.episode_id) {
        const previous=current;
        current = cloneDocument(current);
        current.manga.meta.episode_id = crypto.randomUUID();
        setDocument(current,false);
        bindPaintDocument(previous);
      }
      await withNewCreationBridgeSession(async () => {
        let workspace = !chooseDestination && boundEpisodeWorkspace?.episodeId === current.manga.meta.episode_id
          ? boundEpisodeWorkspace : null;
        if (!workspace) {
          const selected = await selectEpisodeWorkspace(boundEpisodeWorkspace?.directory ?? savedWorkspaceRoot(current.manga.meta.series_id || '__one_shot__'));
          if (!selected) return;
          workspace = { ...selected, episodeId: current.manga.meta.episode_id, projectRevision: boundEpisodeWorkspace?.episodeId === current.manga.meta.episode_id && boundEpisodeWorkspace.directory === selected.directory ? boundEpisodeWorkspace.projectRevision : undefined };
        }
        let prepared = cloneDocument(current);
        let catalogWarning = '';
        if (prepared.manga.meta.series.trim()) {
          try {
            prepared = await persistSeriesCatalog(prepared, { seriesSetting: structuredClone(prepared.manga.series_setting) });
          } catch (error) {
            catalogWarning = error instanceof Error ? error.message : 'シリーズ共通を同期できませんでした';
          }
        }
        const snapshot = await createProjectSnapshot(prepared);
        const revision = await saveEpisodeProject(workspace.token, snapshot, workspace.projectRevision ?? null);
        const binding = { ...workspace, episodeId: prepared.manga.meta.episode_id, projectRevision: revision };
        const newerEdits = documentRef.current !== current && documentRef.current.manga.meta.episode_id === current.manga.meta.episode_id;
        if (documentRef.current === current) {
          const previous=documentRef.current;
          applyPreparedSeriesIdentifiers(prepared);
          bindPaintDocument(previous);
          setBoundEpisodeWorkspace(binding);
        } else if (documentRef.current.manga.meta.episode_id === current.manga.meta.episode_id) {
          const previous=documentRef.current;
          applyPreparedSeriesIdentifiers(prepared);
          bindPaintDocument(previous);
          setBoundEpisodeWorkspace(binding);
        }
        outcome=`${workspace.folderName} に保存しました${newerEdits ? '。保存中の追加編集は次回の保存で反映します' : ''}${catalogWarning ? `。シリーズ共通の同期は未完了: ${catalogWarning}` : ''}`;
        setToast(outcome);
      });
    } catch (error) {
      outcome=`保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`;
      setToast(outcome);
    } finally {
      projectOperation.current = false;
      setProjectBusy(false);
    }
    return outcome;
  };
  saveProjectAction.current = () => saveProject();

  const openProject = async () => {
    if (isLanClient) return openBrowserProject();
    if (showNewDialog || projectOperation.current) return;
    if (hasDocument && !confirm('別の作品フォルダを開きます。現在の編集は保存済みですか？')) return;
    endTextEdit();
    projectOperation.current = true;
    setProjectBusy(true);
    const current = documentRef.current;
    const finishImageImport=beginFigureCropImport();
    try {
      await withNewCreationBridgeSession(async () => {
        const workspace = await selectEpisodeWorkspace(boundEpisodeWorkspace?.directory ?? savedWorkspaceRoot('__one_shot__'));
        if (!workspace) return;
        const loaded = await loadEpisodeProject(workspace.token);
        // Do not replace changes made while the picker or disk read was pending.
        if (documentRef.current !== current) throw new Error('現在の作品が編集されたため読み込みを中止しました');
        const restored = await separateBubbleOriginals(await restoreProjectSnapshot(loaded.snapshot));
        if (documentRef.current !== current) throw new Error('現在の作品が編集されたため読み込みを中止しました');
        replaceDocument(restored);
        setBoundEpisodeWorkspace({ ...workspace, episodeId: restored.manga.meta.episode_id, projectRevision: loaded.revision });
        setBoundSourceSnapshot(null);
        setSourceCoverageDecisions([]);
        setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setSelectedElement(null);
        setTab('storyboard'); setMobileStoryboardPane('editor');
        setToast(`${workspace.folderName} から作品と作画設定を読み込みました`);
      });
    } catch (error) {
      setToast(`読み込みできませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      projectOperation.current = false;
      setProjectBusy(false);
      finishImageImport();
    }
  };

  return { saveProject, exportOmny, openProject };
}
