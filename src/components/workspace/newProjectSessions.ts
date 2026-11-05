import type { WorkspaceState } from './useWorkspaceState';
import { cancelScannerSession, discardPendingScannerSession, commitScannerSession, finishScannerSession, discardSeriesCatalogDraft, commitSeriesCatalogDraft, listSeriesCatalogs, getPendingScannerSession } from '../../lib/localBridge';
import { isLanClient } from '../../lib/clientRuntime';
import {
  stopNewCreationBridgeSession, stopNewCreationBridgeSessionOnPageExit, startNewCreationBridgeSession,
} from '../../lib/localBridgeLifecycle.ts';
import { emptyNewWorkSetting } from '../../lib/newProjectSettings';
import { type PrintSetup, loadPrintPreferences, defaultPrintSetup } from '../../lib/printSettings';
import type { NewLayoutTask } from '../../lib/newLayoutPreview';
import type { MangaDocument } from '../../types';

interface Context {
  updateNewLayoutTask: (task: NewLayoutTask) => void;
  setNewCharacterDocument: (next: MangaDocument | null) => void;
  endTextEdit: () => void;
  clearNewSeriesReference: () => void;
}

export function createNewProjectSessions({
  newLayoutItemsRef, setNewLayoutItems, setNewLayoutActiveIndex, setNewLayoutMessage,
  setScannerReceivedCount, newLayoutImageInput, scannerSessionRef, setScannerSession,
  setPendingScannerSession, newCreationBridgeToken, newCharacterDraftSession, seriesCatalogSaveQueue,
  newLayoutTaskRef, newLayoutOperationGeneration, scannerStopRequested, setToast, setShowNewDialog,
  setNewWorkTitle, setNewWorkSetting, setNewSettingMessage, setNewSeriesName, setNewSeriesId,
  setNewEpisodeWorkspace, setNewWorkspaceSelecting, setNewWorkspaceMessage, setNewReferenceSelecting,
  setNewSourceSnapshot, setNewReferenceFileName, setNewReferenceMessage, setNewCharacterTextLink,
  setCharacterTextBusy, setNewSeriesMode, setNewCreationStep, setNewPrintSetup, setEditingNewPrintSetup,
  setNewPrintConfirmed, setNewSeriesPreparing, setSeriesCatalogMessage, setNewEpisodeNumber,
  setSeriesCatalogs,
}: WorkspaceState, {
  updateNewLayoutTask, setNewCharacterDocument, endTextEdit, clearNewSeriesReference,
}: Context) {
  const discardNewLayoutItems = () => {
    newLayoutItemsRef.current = [];
    setNewLayoutItems([]);
    setNewLayoutActiveIndex(0);
    setNewLayoutMessage(null);
    setScannerReceivedCount(0);
    if (newLayoutImageInput.current) newLayoutImageInput.current.value = '';
  };

  const cancelActiveScannerSession = async () => {
    const session = scannerSessionRef.current;
    scannerSessionRef.current = null;
    setScannerSession(null);
    setPendingScannerSession(null);
    if (session) await cancelScannerSession(session.id);
  };

  const detachActiveScannerSession = () => {
    scannerSessionRef.current = null;
    setScannerSession(null);
  };

  const discardPendingScannerRecovery = async () => {
    await discardPendingScannerSession();
    setPendingScannerSession(null);
  };

  const discardScannerSources = async () => {
    if (isLanClient) return;
    if (scannerSessionRef.current) await cancelActiveScannerSession();
    else await discardPendingScannerRecovery();
  };

  const commitActiveScannerSession = async () => {
    const session = scannerSessionRef.current;
    if (!session) return;
    await commitScannerSession(session.id);
    scannerSessionRef.current = null;
    setScannerSession(null);
    setPendingScannerSession(null);
  };

  const finishScannerWatching = async () => {
    const session = scannerSessionRef.current;
    if (session) await finishScannerSession(session.id);
  };

  const endNewCreationBridgeSession = async () => {
    const token = newCreationBridgeToken.current;
    if (!token) return;
    newCreationBridgeToken.current = null;
    try {
      await stopNewCreationBridgeSession(token);
    } catch (error) {
      stopNewCreationBridgeSessionOnPageExit(token);
      throw error;
    }
  };

  const discardNewCharacterDraft = async () => {
    const session = newCharacterDraftSession.current;
    if (!session) return;
    await seriesCatalogSaveQueue.current;
    await discardSeriesCatalogDraft(session.token);
    if (newCharacterDraftSession.current?.token === session.token) newCharacterDraftSession.current = null;
  };

  const commitNewCharacterDraft = async () => {
    const session = newCharacterDraftSession.current;
    if (!session) return;
    await seriesCatalogSaveQueue.current;
    await commitSeriesCatalogDraft(session.token);
    if (newCharacterDraftSession.current?.token === session.token) newCharacterDraftSession.current = null;
  };

  const closeNewDialog = async () => {
    if (newLayoutTaskRef.current === 'creating') return;
    const generation = ++newLayoutOperationGeneration.current;
    scannerStopRequested.current = true;
    updateNewLayoutTask('scanner');
    setNewLayoutMessage('取り込みを中止し、スキャン元を破棄しています…');
    try {
      await discardScannerSources();
    } catch (error) {
      if (generation !== newLayoutOperationGeneration.current) return;
      scannerStopRequested.current = false;
      updateNewLayoutTask('idle');
      setNewLayoutMessage(error instanceof Error ? error.message : 'スキャン元を破棄できませんでした');
      return;
    }
    if (generation !== newLayoutOperationGeneration.current) return;
    if (newCharacterDraftSession.current) {
      setNewLayoutMessage('保存していない人物データを破棄しています…');
      try {
        await discardNewCharacterDraft();
      } catch (error) {
        scannerStopRequested.current = false;
        updateNewLayoutTask('idle');
        setNewLayoutMessage(error instanceof Error ? error.message : '保存していない人物データを破棄できませんでした');
        return;
      }
    }
    setNewLayoutMessage('ローカル連携を終了しています…');
    try {
      await endNewCreationBridgeSession();
    } catch (error) {
      setToast(`ローカル連携を終了できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
    discardNewLayoutItems();
    updateNewLayoutTask('idle');
    setNewCharacterDocument(null);
    newCharacterDraftSession.current = null;
    setShowNewDialog(false);
  };

  const openNewDialog = () => {
    endTextEdit();
    const generation = ++newLayoutOperationGeneration.current;
    scannerStopRequested.current = false;
    updateNewLayoutTask('idle');
    setNewWorkTitle('');
    setNewWorkSetting(emptyNewWorkSetting());
    setNewSettingMessage('');
    setNewSeriesName('');
    setNewSeriesId('');
    clearNewSeriesReference();
    setNewEpisodeWorkspace(null);
    setNewWorkspaceSelecting(false);
    setNewWorkspaceMessage('');
    setNewReferenceSelecting(false);
    setNewSourceSnapshot(null);
    setNewReferenceFileName('');
    setNewReferenceMessage('');
    setNewCharacterTextLink(null);
    setCharacterTextBusy(false);
    setNewSeriesMode('');
    setNewCreationStep('series');
    let rememberedPrint: PrintSetup | null = null;
    try { rememberedPrint = loadPrintPreferences(localStorage); } catch { /* storage unavailable */ }
    setNewPrintSetup(rememberedPrint ?? defaultPrintSetup());
    setEditingNewPrintSetup(!rememberedPrint);
    setNewPrintConfirmed(Boolean(rememberedPrint));
    setNewCharacterDocument(null);
    newCharacterDraftSession.current = null;
    setNewSeriesPreparing(false);
    setSeriesCatalogMessage(isLanClient ? '' : 'ローカル連携を起動しています…');
    setNewEpisodeNumber('');
    setShowNewDialog(true);
    void (async () => {
      if (isLanClient) {
        const items = await listSeriesCatalogs().catch(() => []);
        if (generation !== newLayoutOperationGeneration.current) return;
        setSeriesCatalogs(items); setPendingScannerSession(null); setSeriesCatalogMessage('');
        return;
      }
      let supervisorError: unknown = null;
      try {
        const session = await startNewCreationBridgeSession();
        if (generation !== newLayoutOperationGeneration.current) {
          await stopNewCreationBridgeSession(session.token).catch(() => undefined);
          return;
        }
        newCreationBridgeToken.current = session.token;
      } catch (error) {
        if (generation !== newLayoutOperationGeneration.current) return;
        supervisorError = error;
      }
      try {
        const [items, pending] = await Promise.all([
          listSeriesCatalogs(),
          getPendingScannerSession().catch(() => null),
        ]);
        if (generation !== newLayoutOperationGeneration.current) return;
        setSeriesCatalogs(items);
        setPendingScannerSession(pending);
        setSeriesCatalogMessage(items.length ? '' : '保存済みシリーズはまだありません。');
      } catch {
        if (generation !== newLayoutOperationGeneration.current) return;
        setSeriesCatalogs([]);
        setSeriesCatalogMessage(supervisorError
          ? `ローカル連携を自動起動できませんでした。${supervisorError instanceof Error ? supervisorError.message : ''}`.trim()
          : '保存済みシリーズを読み込めませんでした。シリーズ名は手入力できます。');
      }
    })();
  };

  return { closeNewDialog, discardNewCharacterDraft, commitNewCharacterDraft, discardScannerSources, discardNewLayoutItems, finishScannerWatching, detachActiveScannerSession, discardPendingScannerRecovery, commitActiveScannerSession, endNewCreationBridgeSession, openNewDialog };
}
