import type { PanelTemplate } from '../../lib/panelTemplates';
import { roundMm, clamp } from '../../lib/canvasGeometry';
import {
  type NewLayoutItem, type DetectedPageLayout, type RightAngle, displayedLayoutRotation,
  type NewLayoutTask,
} from '../../lib/newLayoutPreview';
import {
  recognizePanelLayout, openMacScanner, cancelScannerSession, collectScannerImages,
  getPendingScannerSession, resumePendingScannerSession, finishScannerSession, type ScannerSession,
  type PendingScannerSession,
} from '../../lib/localBridge';
import type { MutableRef } from './workspaceTypes';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { RefObject } from 'preact';

interface Context {
  newLayoutTask: NewLayoutTask;
  newLayoutOperationGeneration: MutableRef<number>;
  updateNewLayoutTask: (task: NewLayoutTask) => void;
  discardScannerSources: () => Promise<void>;
  discardNewLayoutItems: () => void;
  newLayoutItemsRef: MutableRef<NewLayoutItem[]>;
  setNewLayoutItems: Dispatch<StateUpdater<NewLayoutItem[]>>;
  setNewLayoutActiveIndex: Dispatch<StateUpdater<number>>;
  setNewLayoutMessage: Dispatch<StateUpdater<string | null>>;
  newLayoutImageInput: RefObject<HTMLInputElement>;
  setNewLayoutRowGapMm: Dispatch<StateUpdater<number>>;
  setNewLayoutColumnGapMm: Dispatch<StateUpdater<number>>;
  setNewLayoutFrameLineWidthMm: Dispatch<StateUpdater<number>>;
  newLayoutTaskRef: MutableRef<NewLayoutTask>;
  newLayoutRowGapMm: number;
  newLayoutColumnGapMm: number;
  createNewDocument: (layout?: PanelTemplate | DetectedPageLayout[], confirmScannedLayouts?: boolean, analysisGeneration?: number) => Promise<void>;
  newLayoutActiveIndex: number;
  scannerStopRequested: MutableRef<boolean>;
  scannerSessionRef: MutableRef<ScannerSession | null>;
  setScannerSession: Dispatch<StateUpdater<ScannerSession | null>>;
  setScannerReceivedCount: Dispatch<StateUpdater<number>>;
  finishScannerWatching: () => Promise<void>;
  detachActiveScannerSession: () => void;
  setPendingScannerSession: Dispatch<StateUpdater<PendingScannerSession | null>>;
  discardPendingScannerRecovery: () => Promise<void>;
}

export function createNewLayoutImportActions({
  newLayoutTask, newLayoutOperationGeneration, updateNewLayoutTask, discardScannerSources,
  discardNewLayoutItems, newLayoutItemsRef, setNewLayoutItems, setNewLayoutActiveIndex,
  setNewLayoutMessage, newLayoutImageInput, setNewLayoutRowGapMm, setNewLayoutColumnGapMm,
  setNewLayoutFrameLineWidthMm, newLayoutTaskRef, newLayoutRowGapMm, newLayoutColumnGapMm,
  createNewDocument, newLayoutActiveIndex, scannerStopRequested, scannerSessionRef, setScannerSession,
  setScannerReceivedCount, finishScannerWatching, detachActiveScannerSession,
  setPendingScannerSession, discardPendingScannerRecovery,
}: Context) {
  const chooseNewLayoutImages = (files?: ArrayLike<File> | Iterable<File> | null) => {
    if (newLayoutTask !== 'idle') return;
    const selected = Array.from(files ?? [])
      .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
      .slice(0, 10);
    if (!selected.length) return;
    newLayoutOperationGeneration.current += 1;
    updateNewLayoutTask('idle');
    // スキャンから手動ファイルへ切り替える操作は明示的な破棄として扱う。
    void discardScannerSources().catch(() => undefined);
    discardNewLayoutItems();
    const items = selected.map((file) => ({
      id: crypto.randomUUID(), file, source: 'manual' as const,
      analysis: null, analyzing: false, rotationOverride: 0 as const,
    }));
    newLayoutItemsRef.current = items;
    setNewLayoutItems(items);
    setNewLayoutActiveIndex(0);
    setNewLayoutMessage(`${items.length}枚を読み込みました。`);
    if (newLayoutImageInput.current) newLayoutImageInput.current.value = '';
  };

  const updateNewLayoutGutter = (axis: 'row' | 'column', value: number) => {
    if (newLayoutTask !== 'idle' || !Number.isFinite(value)) return;
    const nextValue = roundMm(clamp(value, 0, 20));
    if (axis === 'row') setNewLayoutRowGapMm(nextValue);
    else setNewLayoutColumnGapMm(nextValue);
    const hasAnalysis = newLayoutItemsRef.current.some((item) => item.analysis || item.error);
    if (!hasAnalysis) return;
    newLayoutOperationGeneration.current += 1;
    updateNewLayoutTask('idle');
    const working = newLayoutItemsRef.current.map((item) => ({ ...item, analysis: null, analyzing: false, error: undefined }));
    newLayoutItemsRef.current = working;
    setNewLayoutItems(working);
    setNewLayoutMessage('コマ間隔を変更しました。「解析開始」で解析結果へ反映してください。');
  };

  const updateNewLayoutFrameLineWidth = (value: number) => {
    if (newLayoutTask !== 'idle' || !Number.isFinite(value)) return;
    setNewLayoutFrameLineWidthMm(roundMm(clamp(value, 0.1, 5)));
  };

  const analyzeNewLayouts = async () => {
    if (!newLayoutItemsRef.current.length || newLayoutTaskRef.current !== 'idle') return;
    const generation = ++newLayoutOperationGeneration.current;
    updateNewLayoutTask('analyzing');
    let working: NewLayoutItem[] = newLayoutItemsRef.current.map((item) => ({ ...item, analysis: null, analyzing: false, error: undefined }));
    setNewLayoutItems(working);
    for (let index = 0; index < working.length; index += 1) {
      setNewLayoutActiveIndex(index);
      working = working.map((item, itemIndex) => ({ ...item, analyzing: itemIndex === index }));
      newLayoutItemsRef.current = working;
      setNewLayoutItems(working);
      setNewLayoutMessage(`${index + 1} / ${working.length}枚目：RT-DETRでコマ・文字・顔・身体を検出し、Baberu OCRで文字候補を読んでいます…`);
      try {
        const result = await recognizePanelLayout(
          working[index].file,
          working[index].rotationOverride,
          { rowGapMm: newLayoutRowGapMm, columnGapMm: newLayoutColumnGapMm },
        );
        if (generation !== newLayoutOperationGeneration.current) return;
        working = working.map((item, itemIndex) => itemIndex === index
          ? { ...item, analysis: result, analyzing: false, error: undefined }
          : item);
      } catch (error) {
        if (generation !== newLayoutOperationGeneration.current) return;
        const message = error instanceof Error ? error.message : 'コマの検出に失敗しました';
        working = working.map((item, itemIndex) => itemIndex === index
          ? { ...item, analysis: null, analyzing: false, error: message }
          : item);
      }
      newLayoutItemsRef.current = working;
      setNewLayoutItems(working);
    }
    if (generation !== newLayoutOperationGeneration.current) return;
    const matched = working.filter((item) => item.analysis?.detectedPanels.length).length;
    const recognized = working.reduce((total, item) => total + (item.analysis?.ocrLines.length ?? 0), 0);
    setNewLayoutMessage(`${working.length}枚の解析が終わりました。${matched}枚でコマ領域、${recognized}件の文字候補を取得しました。`);
    const layouts = working.flatMap((item): DetectedPageLayout[] => item.analysis?.detectedPanels.length
      ? [{ sourceItemId: item.id, analysis: item.analysis }]
      : []);
    if (layouts.length !== working.length) {
      updateNewLayoutTask('idle');
      return;
    }
    await createNewDocument(layouts, working.some((item) => item.source === 'scanner'), generation);
  };

  const setActiveLayoutRotation = (rotation: RightAngle) => {
    if (newLayoutTask !== 'idle') return;
    newLayoutOperationGeneration.current += 1;
    updateNewLayoutTask('idle');
    const index = newLayoutActiveIndex;
    const working = newLayoutItemsRef.current.map((item, itemIndex) => itemIndex === index
      ? { ...item, rotationOverride: rotation, analysis: null, analyzing: false, error: undefined }
      : item);
    newLayoutItemsRef.current = working;
    setNewLayoutItems(working);
    setNewLayoutMessage(`${index + 1}枚目を時計回り${rotation}°の向きにしました。このまま解析できます。`);
  };

  const rotateActiveLayoutImage = (delta: 90 | 180 | 270) => {
    const item = newLayoutItemsRef.current[newLayoutActiveIndex];
    if (!item) return;
    setActiveLayoutRotation(((displayedLayoutRotation(item) + delta) % 360) as RightAngle);
  };

  const launchScanner = async () => {
    if (newLayoutTask !== 'idle') return;
    const generation = ++newLayoutOperationGeneration.current;
    await discardScannerSources().catch(() => undefined);
    if (generation !== newLayoutOperationGeneration.current) return;
    discardNewLayoutItems();
    scannerStopRequested.current = false;
    updateNewLayoutTask('scanner');
    setNewLayoutMessage('macOSのスキャナーアプリを起動しています…');
    try {
      const session = await openMacScanner();
      if (generation !== newLayoutOperationGeneration.current) {
        await cancelScannerSession(session.id).catch(() => undefined);
        return;
      }
      scannerSessionRef.current = session;
      setScannerSession(session);
      setNewLayoutMessage(`スキャン画像を自動待機中です（最大${session.maxFiles}枚・5分）。続けてスキャンし、終わったら「取り込みを終了」を押してください。`);
      while (generation === newLayoutOperationGeneration.current && scannerSessionRef.current?.id === session.id) {
        if (scannerStopRequested.current) break;
        const batch = await collectScannerImages(session.id);
        if (generation !== newLayoutOperationGeneration.current) return;
        if (scannerSessionRef.current?.id !== session.id) break;
        if (batch.files.length) {
          const additions = batch.files.map(({ id, file }) => ({
            id, file, source: 'scanner' as const,
            analysis: null, analyzing: false, rotationOverride: 0 as const,
          }));
          const existing = newLayoutItemsRef.current;
          const known = new Set(existing.map((item) => item.id));
          const next = [...existing, ...additions.filter((item) => !known.has(item.id))].slice(0, session.maxFiles);
          newLayoutItemsRef.current = next;
          setNewLayoutItems(next);
          setNewLayoutActiveIndex(Math.max(0, next.length - 1));
          setScannerReceivedCount(next.length);
          setNewLayoutMessage(`${next.length}枚を取り込みました。スキャン元は検出コマからページ作成を確定するまで保持します。`);
        }
        if (batch.complete || scannerStopRequested.current) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      if (scannerSessionRef.current?.id !== session.id) return;
      if (scannerSessionRef.current?.id === session.id) await finishScannerWatching();
      const count = newLayoutItemsRef.current.length;
      setNewLayoutMessage(count
        ? `${count}枚の取り込みを完了しました。スキャン元とNyamuru Image Hubの一時画像は、ページ作成の確定または画面を閉じた時に破棄します。`
        : '5分以内に新しいスキャン画像が見つかりませんでした。');
    } catch (error) {
      if (generation !== newLayoutOperationGeneration.current) return;
      setNewLayoutMessage(error instanceof Error ? error.message : 'スキャナーアプリを起動できませんでした');
      // 予期しない切断では元画像を消さず、次回の復旧候補として残す。
      detachActiveScannerSession();
      void getPendingScannerSession().then(setPendingScannerSession).catch(() => undefined);
    } finally {
      if (generation !== newLayoutOperationGeneration.current) return;
      scannerStopRequested.current = false;
      updateNewLayoutTask('idle');
    }
  };

  const resumeScanner = async () => {
    if (newLayoutTask !== 'idle') return;
    const generation = ++newLayoutOperationGeneration.current;
    updateNewLayoutTask('scanner');
    setNewLayoutMessage('前回のスキャン画像へつなぎ直しています…');
    try {
      discardNewLayoutItems();
      const resumed = await resumePendingScannerSession();
      if (generation !== newLayoutOperationGeneration.current) {
        await cancelScannerSession(resumed.session.id).catch(() => undefined);
        return;
      }
      scannerSessionRef.current = resumed.session;
      setScannerSession(resumed.session);
      setPendingScannerSession(null);
      const items = resumed.files.map(({ id, file }) => ({
        id, file, source: 'scanner' as const,
        analysis: null, analyzing: false, rotationOverride: 0 as const,
      }));
      newLayoutItemsRef.current = items;
      setNewLayoutItems(items);
      setNewLayoutActiveIndex(0);
      setScannerReceivedCount(items.length);
      setNewLayoutMessage(`${items.length}枚へつなぎ直しました。`);
    } catch (error) {
      if (generation !== newLayoutOperationGeneration.current) return;
      setNewLayoutMessage(error instanceof Error ? error.message : '前回のスキャン画像へつなぎ直せませんでした');
    } finally {
      if (generation !== newLayoutOperationGeneration.current) return;
      updateNewLayoutTask('idle');
    }
  };

  const discardRecoveredScans = async () => {
    if (newLayoutTask !== 'idle') return;
    const generation = ++newLayoutOperationGeneration.current;
    updateNewLayoutTask('scanner');
    try {
      await discardPendingScannerRecovery();
      if (generation !== newLayoutOperationGeneration.current) return;
      setNewLayoutMessage('前回残ったスキャン画像を破棄しました。');
    } catch (error) {
      if (generation !== newLayoutOperationGeneration.current) return;
      setNewLayoutMessage(error instanceof Error ? error.message : '残っているスキャン画像を破棄できませんでした');
    } finally {
      if (generation !== newLayoutOperationGeneration.current) return;
      updateNewLayoutTask('idle');
    }
  };

  const requestScannerFinish = async () => {
    if (scannerStopRequested.current) return;
    scannerStopRequested.current = true;
    setNewLayoutMessage('現在の取り込みを確認して終了しています…');
    const session = scannerSessionRef.current;
    if (!session) return;
    try {
      await finishScannerSession(session.id);
    } catch (error) {
      scannerStopRequested.current = false;
      setNewLayoutMessage(error instanceof Error ? error.message : 'スキャン待機を終了できませんでした');
    }
  };

  return { chooseNewLayoutImages, requestScannerFinish, launchScanner, updateNewLayoutGutter, updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans, rotateActiveLayoutImage, analyzeNewLayouts };
}
