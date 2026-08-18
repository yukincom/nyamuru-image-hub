import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BookOpen, BookOpenCheck, Boxes, Braces, Cat, ChevronLeft, ChevronRight, CircleHelp, Combine, Eye, EyeOff, FilePlus2, Files, Images, LayoutPanelTop, ScanLine, Settings2, SlidersHorizontal, Sparkles, UsersRound, Workflow, X } from 'lucide-preact';
import sampleYaml from '../content/sample.omny.yaml?raw';
import { version as appVersion, versionCode as appVersionCode } from '../../package.json';
import { sampleMangaPages } from '../lib/sampleMangaImages';
import AskAiBlock, { REPO_URL } from './AskAiBlock';
import Header, { type OmnyDownloadKind } from './Header';
import PageSidebar from './PageSidebar';
import MangaCanvas from './MangaCanvas';
import PanelInspector from './PanelInspector';
import SchemaGuide from './SchemaGuide';
import AgentWorkflowGuide from './AgentWorkflowGuide';
import GenerationPromptGuide from './GenerationPromptGuide';
import HowToGuide from './HowToGuide';
import NyamurutanGuide from './NyamurutanGuide';
import { CharactersEditor, MaterialsEditor, MetaEditor, RawYamlEditor, SettingEditor, ValidationPanel } from './DocumentEditors';
import { cloneDocument, newPage, newPanel, omnyFileName, parseMangaYaml, safeFileName, STORAGE_KEY, toMangaYaml, toSeparatedMangaYaml, validateManga } from '../lib/manga';
import { movePanelEdge as movePanelEdgeGeometry, movePanelVertexWithSnap, resizePanelToBounds, translatePanel, type PanelEdgeReference } from '../lib/canvasGeometry';
import { applyPanelTemplate, findPanelTemplate, mergeSelectedPanels, PANEL_TEMPLATES, type PanelTemplate } from '../lib/panelTemplates';
import { attachDetectedFiguresToPage, attachRecognizedTextToPage, cancelScannerSession, collectScannerImages, commitScannerSession, DETECTED_FIGURE_NAME, discardPendingScannerSession, finishScannerSession, getPendingScannerSession, openMacScanner, recognizePanelLayout, resumePendingScannerSession, type DetectedFigureRegion, type LayoutRecognitionResult, type PendingScannerSession, type ScannerSession } from '../lib/localBridge';
import type { Anchor, BBox, CanvasElementSelection, DocsLanguage, MangaDocument, PanelShape, WorkspaceTab } from '../types';

const TABS: {
  id: WorkspaceTab;
  label: string;
  icon: typeof LayoutPanelTop;
  separatorBefore?: boolean;
}[] = [
  { id: 'storyboard', label: 'ネーム', icon: LayoutPanelTop },
  { id: 'meta', label: '作品情報', icon: BookOpen },
  { id: 'setting', label: '舞台設定', icon: Settings2 },
  { id: 'characters', label: '登場人物', icon: UsersRound },
  { id: 'materials', label: '素材', icon: Images },
  { id: 'yaml', label: 'OMNY編集', icon: Braces },
  { id: 'howto', label: '使い方', icon: CircleHelp, separatorBefore: true },
  { id: 'prompt', label: '生成プロンプト', icon: Sparkles },
  { id: 'workflow', label: '生成ワークフロー', icon: Workflow },
  { id: 'schema', label: 'NDM仕様', icon: BookOpenCheck },
  { id: 'nyamurutan', label: 'にゃむるたん', icon: Cat },
];

type MobileStoryboardPane = 'pages' | 'editor' | 'panel';
type NewLayoutTask = 'idle' | 'scanner' | 'analyzing';
type NewLayoutSource = 'manual' | 'scanner';
type RightAngle = 0 | 90 | 180 | 270;

interface NewLayoutItem {
  id: string;
  file: File;
  previewUrl: string;
  source: NewLayoutSource;
  analysis: LayoutRecognitionResult | null;
  analyzing: boolean;
  rotationOverride: RightAngle;
  error?: string;
}

interface DetectedPageLayout {
  shapes: PanelShape[];
  analysis: LayoutRecognitionResult;
}

const NEW_LAYOUT_SPREAD_ORDER = [1, 0, 3, 2, 5, 4, 7, 6, 9, 8] as const;

function displayedLayoutRotation(item: NewLayoutItem): RightAngle {
  return item.rotationOverride;
}

function nextLayoutIndexFromArrow(current: number, key: string, length: number): number {
  if (key === 'ArrowLeft' && current % 2 === 0 && current + 1 < length) return current + 1;
  if (key === 'ArrowRight' && current % 2 === 1) return current - 1;
  if (key === 'ArrowUp' && current >= 2) return current - 2;
  if (key === 'ArrowDown' && current + 2 < length) return current + 2;
  return current;
}

const HOWTO_INTRO_KEY = 'manga-name-studio.howto-intro.v1';
const DOCS_LANG_KEY = 'manga-name-studio.docs-lang.v1';
const AUTO_ANCHOR_KEY = 'manga-name-studio.auto-anchor.v1';
const INNER_FRAME_SNAP_KEY = 'manga-name-studio.inner-frame-snap.v1';
const PANEL_SNAP_KEY = 'manga-name-studio.panel-snap.v1';

function initialDocsLang(): DocsLanguage {
  try {
    if (localStorage.getItem(DOCS_LANG_KEY) === 'en') return 'en';
  } catch { /* private mode */ }
  return 'ja';
}

function initialAutoAnchor(): boolean {
  try {
    return localStorage.getItem(AUTO_ANCHOR_KEY) === '1';
  } catch { /* private mode */ }
  return false;
}

function initialInnerFrameSnap(): boolean {
  try {
    return localStorage.getItem(INNER_FRAME_SNAP_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

function initialPanelSnap(): boolean {
  try {
    return localStorage.getItem(PANEL_SNAP_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

// 見開きは右綴じ（1ページ目が右）。ビューアはこの配列順にめくる
const SAMPLE_MANGA_PAGES = [sampleMangaPages.page1, sampleMangaPages.page2];

function TemplateThumb({ shapes, figures = [] }: { shapes: readonly PanelShape[]; figures?: readonly DetectedFigureRegion[] }) {
  return <svg viewBox="0 0 210 297" aria-hidden="true">
    {shapes.map((shape, index) => shape.type === 'rect'
      ? <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} />
      : <polygon key={index} points={shape.points.map((point) => point.join(',')).join(' ')} />)}
    {figures.map((figure, index) => <rect class="detected-figure-thumb" key={`figure-${index}`} x={figure.bbox.x * 210} y={figure.bbox.y * 297} width={figure.bbox.w * 210} height={figure.bbox.h * 297} rx="2" />)}
  </svg>;
}

function initialTab(): WorkspaceTab {
  try {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && TABS.some((item) => item.id === requested)) return requested as WorkspaceTab;
  } catch { /* no URL access */ }
  return 'storyboard';
}

function initialDocument(): MangaDocument {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseMangaYaml(saved);
  } catch { /* private mode or first visit */ }
  return parseMangaYaml(sampleYaml);
}

export default function App() {
  const [document, setDocumentState] = useState<MangaDocument>(initialDocument);
  const [activePage, setActivePage] = useState(0);
  const [activePanel, setActivePanel] = useState(0);
  const [selectedPanels, setSelectedPanels] = useState<number[]>([0]);
  const [selectedElement, setSelectedElement] = useState<CanvasElementSelection | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [docsLang, setDocsLangState] = useState<DocsLanguage>(initialDocsLang);
  const [mobileStoryboardPane, setMobileStoryboardPane] = useState<MobileStoryboardPane>('editor');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [autoAnchor, setAutoAnchor] = useState(initialAutoAnchor);
  const [innerFrameSnap, setInnerFrameSnap] = useState(initialInnerFrameSnap);
  const [panelSnap, setPanelSnap] = useState(initialPanelSnap);
  const [spreadView, setSpreadView] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showHowtoIntro, setShowHowtoIntro] = useState(false);
  const [mangaViewerPage, setMangaViewerPage] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('B');
  const [newLayoutItems, setNewLayoutItems] = useState<NewLayoutItem[]>([]);
  const [newLayoutActiveIndex, setNewLayoutActiveIndex] = useState(0);
  const [newLayoutMessage, setNewLayoutMessage] = useState<string | null>(null);
  const [newLayoutTask, setNewLayoutTask] = useState<NewLayoutTask>('idle');
  const [scannerSession, setScannerSession] = useState<ScannerSession | null>(null);
  const [pendingScannerSession, setPendingScannerSession] = useState<PendingScannerSession | null>(null);
  const [scannerReceivedCount, setScannerReceivedCount] = useState(0);
  const [rawSource, setRawSource] = useState(() => toMangaYaml(document));
  const [rawError, setRawError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [past, setPast] = useState<MangaDocument[]>([]);
  const [future, setFuture] = useState<MangaDocument[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const newLayoutImageInput = useRef<HTMLInputElement>(null);
  const newLayoutItemsRef = useRef<NewLayoutItem[]>([]);
  const scannerSessionRef = useRef<ScannerSession | null>(null);
  const scannerStopRequested = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastHistoryPush = useRef(0);

  const issues = useMemo(() => validateManga(document), [document]);
  const page = document.manga.pages[activePage];
  const panel = page?.panels[activePanel];
  // 見開きの相方ページ。右綴じなので若いページが右に並ぶ
  const spreadPartnerIndex = spreadView && document.manga.pages.length > 1
    ? (activePage + 1 < document.manga.pages.length ? activePage + 1 : activePage - 1)
    : null;

  const setDocument = (next: MangaDocument) => {
    next.manga.meta.page_count = next.manga.pages.length;
    const now = Date.now();
    if (now - lastHistoryPush.current > 800) {
      setPast((stack) => [...stack.slice(-49), document]);
      lastHistoryPush.current = now;
    }
    setFuture([]);
    setDocumentState(next);
  };

  const restoreDocument = (target: MangaDocument) => {
    setDocumentState(target);
    const pageIndex = Math.min(activePage, target.manga.pages.length - 1);
    setActivePage(pageIndex);
    const panelIndex = Math.min(activePanel, Math.max(0, (target.manga.pages[pageIndex]?.panels.length ?? 1) - 1));
    setActivePanel(panelIndex);
    setSelectedPanels([panelIndex]);
    setSelectedElement(null);
    lastHistoryPush.current = 0;
    if (tab === 'yaml') { setRawSource(toMangaYaml(target)); setRawError(null); }
  };

  const undo = () => {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((stack) => [...stack, document]);
    restoreDocument(previous);
    setToast('作業を元に戻しました');
  };

  const redo = () => {
    if (!future.length) return;
    const next = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setPast((stack) => [...stack, document]);
    restoreDocument(next);
    setToast('作業をやり直しました');
  };

  const discardNewLayoutItems = () => {
    newLayoutItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
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

  const closeNewDialog = () => {
    void discardScannerSources().catch(() => undefined);
    discardNewLayoutItems();
    setNewLayoutTask('idle');
    setShowNewDialog(false);
  };

  const selectCanvasPanel = (index: number, additive = false) => {
    if (!additive) {
      setActivePanel(index);
      setSelectedPanels([index]);
      if (index === activePanel) setSelectedElement(null);
      return;
    }
    const next = selectedPanels.includes(index)
      ? selectedPanels.length > 1 ? selectedPanels.filter((item) => item !== index) : selectedPanels
      : [...selectedPanels, index].sort((left, right) => left - right);
    setSelectedPanels(next);
    setActivePanel(next.includes(index) ? index : next.includes(activePanel) ? activePanel : next[next.length - 1]);
    setSelectedElement(null);
  };

  const mergeSelectedPanelGroup = () => {
    if (selectedPanels.length < 2) {
      setToast('Shift+クリックで合体するコマを2つ以上選択してください');
      return;
    }
    const next = cloneDocument(document);
    const mergedIndex = mergeSelectedPanels(next.manga.pages[activePage], selectedPanels);
    if (mergedIndex === null) return;
    setDocument(next);
    setActivePanel(mergedIndex);
    setSelectedPanels([mergedIndex]);
    setSelectedElement(null);
    setToast(`${selectedPanels.length}コマを吹き出しごと合体しました`);
  };

  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, toMangaYaml(document));
        setSavedAt(new Date());
      } catch { setToast('ブラウザへの保存に失敗しました'); }
    }, 350);
    return () => window.clearTimeout(saveTimer.current);
  }, [document]);

  useEffect(() => {
    try {
      const firstVisit = !localStorage.getItem(HOWTO_INTRO_KEY);
      if (firstVisit) {
        localStorage.setItem(HOWTO_INTRO_KEY, '1');
        if (initialTab() !== 'howto') setShowHowtoIntro(true);
      }
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (tab === 'yaml') { setRawSource(toMangaYaml(document)); setRawError(null); }
  }, [tab]);

  useEffect(() => { setSelectedElement(null); }, [activePage, activePanel]);

  useEffect(() => { newLayoutItemsRef.current = newLayoutItems; }, [newLayoutItems]);

  useEffect(() => {
    if (!showNewDialog || scannerSessionRef.current || pendingScannerSession) return;
    let ignored = false;
    void getPendingScannerSession()
      .then((pending) => { if (!ignored) setPendingScannerSession(pending); })
      .catch(() => undefined);
    return () => { ignored = true; };
  }, [showNewDialog, pendingScannerSession]);

  useEffect(() => () => {
    newLayoutItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    // 強制終了・再読み込みではbridge側の復旧記録と元スキャンを残す。
    // 明示的に閉じた場合だけcloseNewDialogから削除を依頼する。
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault();
        try { localStorage.setItem(STORAGE_KEY, toMangaYaml(document)); setSavedAt(new Date()); setToast('ブラウザに保存しました'); } catch { setToast('保存に失敗しました'); }
        return;
      }
      if (key === 'escape' && mangaViewerPage !== null) { setMangaViewerPage(null); return; }
      if (key === 'escape' && showNewDialog) { closeNewDialog(); return; }
      if (key === 'escape' && showHowtoIntro) { setShowHowtoIntro(false); return; }
      const target = event.target as HTMLElement | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'm' && tab === 'storyboard' && !showNewDialog && !showHowtoIntro && mangaViewerPage === null) {
        event.preventDefault();
        mergeSelectedPanelGroup();
        return;
      }
      if (showNewDialog && newLayoutTask === 'idle' && newLayoutItems.length > 1 && event.key.startsWith('Arrow')) {
        const nextIndex = nextLayoutIndexFromArrow(newLayoutActiveIndex, event.key, newLayoutItems.length);
        if (nextIndex !== newLayoutActiveIndex) setNewLayoutActiveIndex(nextIndex);
        event.preventDefault();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.metaKey || event.ctrlKey) && key === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [document, past, future, showNewDialog, showHowtoIntro, mangaViewerPage, pendingScannerSession, newLayoutItems.length, newLayoutActiveIndex, newLayoutTask, selectedPanels, tab]);

  const changeTab = (next: WorkspaceTab) => { setTab(next); if (next !== 'storyboard' && window.innerWidth < 800) setSidebarCollapsed(true); };
  const changeDocsLang = (next: DocsLanguage) => {
    setDocsLangState(next);
    try { localStorage.setItem(DOCS_LANG_KEY, next); } catch { /* private mode */ }
  };
  const mutate = (recipe: (draft: MangaDocument) => void) => { const next = cloneDocument(document); recipe(next); setDocument(next); };

  // 分離版はルール（style_notes/layout_spec）を含まない純粋なネームデータ。
  // 全部入り版は分離版と同一のネームデータへ現在のルール欄を合成した一枚もの
  const download = (kind: OmnyDownloadKind) => {
    const separated = kind === 'separated';
    const source = separated ? toSeparatedMangaYaml(document) : toMangaYaml(document);
    const blob = new Blob([source], { type: 'application/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = separated ? omnyFileName(document.manga.meta.title) : safeFileName(document.manga.meta.title);
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(separated ? '画像生成指示分離版（純粋なネームデータ）を書き出しました' : '全部入り版（ルール込み）を書き出しました');
  };

  const copyYaml = async () => {
    const source = toMangaYaml(document);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard API unavailable');
      await navigator.clipboard.writeText(source);
      setToast('OMNY形式の全文をコピーしました');
    } catch {
      setToast('OMNY形式のコピーに失敗しました');
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseMangaYaml(await file.text());
      setDocument(parsed); setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setTab('storyboard'); setMobileStoryboardPane('editor'); setToast(`${file.name} を読み込みました`);
    } catch (error) { setToast(`読み込み失敗: ${error instanceof Error ? error.message : '不明なエラー'}`); }
    if (fileInput.current) fileInput.current.value = '';
  };

  const chooseNewLayoutImages = (files?: FileList | null) => {
    const selected = Array.from(files ?? []).slice(0, 10);
    if (!selected.length) return;
    // スキャンから手動ファイルへ切り替える操作は明示的な破棄として扱う。
    void discardScannerSources().catch(() => undefined);
    discardNewLayoutItems();
    const items = selected.map((file) => ({
      id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), source: 'manual' as const,
      analysis: null, analyzing: false, rotationOverride: 0 as const,
    }));
    newLayoutItemsRef.current = items;
    setNewLayoutItems(items);
    setNewLayoutActiveIndex(0);
    setNewLayoutMessage(`${items.length}枚を読み込みました。`);
    if (newLayoutImageInput.current) newLayoutImageInput.current.value = '';
  };

  const analyzeNewLayouts = async () => {
    if (!newLayoutItemsRef.current.length || newLayoutTask !== 'idle') return;
    setNewLayoutTask('analyzing');
    let working: NewLayoutItem[] = newLayoutItemsRef.current.map((item) => ({ ...item, analysis: null, analyzing: false, error: undefined }));
    setNewLayoutItems(working);
    for (let index = 0; index < working.length; index += 1) {
      setNewLayoutActiveIndex(index);
      working = working.map((item, itemIndex) => ({ ...item, analyzing: itemIndex === index }));
      newLayoutItemsRef.current = working;
      setNewLayoutItems(working);
      setNewLayoutMessage(`${index + 1} / ${working.length}枚目：RT-DETRでコマ・文字・顔・身体を検出し、NDLOCR-Liteで文字を読んでいます…`);
      try {
        const result = await recognizePanelLayout(
          working[index].file,
          working[index].rotationOverride,
        );
        working = working.map((item, itemIndex) => itemIndex === index
          ? { ...item, analysis: result, analyzing: false, error: undefined }
          : item);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'コマの検出に失敗しました';
        working = working.map((item, itemIndex) => itemIndex === index
          ? { ...item, analysis: null, analyzing: false, error: message }
          : item);
      }
      newLayoutItemsRef.current = working;
      setNewLayoutItems(working);
    }
    const matched = working.filter((item) => item.analysis?.detectedPanels.length).length;
    const recognized = working.reduce((total, item) => total + (item.analysis?.ocrLines.length ?? 0), 0);
    setNewLayoutMessage(`${working.length}枚の解析が終わりました。${matched}枚でコマ領域、${recognized}件の文字候補を取得しました。検出したコマはそのまま編集開始位置に使えます。`);
    setNewLayoutTask('idle');
  };

  const setActiveLayoutRotation = (rotation: RightAngle) => {
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
    await discardScannerSources().catch(() => undefined);
    discardNewLayoutItems();
    scannerStopRequested.current = false;
    setNewLayoutTask('scanner');
    setNewLayoutMessage('macOSのスキャナーアプリを起動しています…');
    try {
      const session = await openMacScanner();
      scannerSessionRef.current = session;
      setScannerSession(session);
      setNewLayoutMessage(`スキャン画像を自動待機中です（最大${session.maxFiles}枚・5分）。続けてスキャンし、終わったら「取り込みを終了」を押してください。`);
      while (scannerSessionRef.current?.id === session.id) {
        if (scannerStopRequested.current) break;
        const batch = await collectScannerImages(session.id);
        if (scannerSessionRef.current?.id !== session.id) break;
        if (batch.files.length) {
          const additions = batch.files.map(({ id, file }) => ({
            id, file, previewUrl: URL.createObjectURL(file), source: 'scanner' as const,
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
      if (scannerSessionRef.current?.id === session.id) await finishScannerWatching();
      const count = newLayoutItemsRef.current.length;
      setNewLayoutMessage(count
        ? `${count}枚の取り込みを完了しました。スキャン元とNyamuruの一時画像は、ページ作成の確定または画面を閉じた時に破棄します。`
        : '5分以内に新しいスキャン画像が見つかりませんでした。');
    } catch (error) {
      setNewLayoutMessage(error instanceof Error ? error.message : 'スキャナーアプリを起動できませんでした');
      // 予期しない切断では元画像を消さず、次回の復旧候補として残す。
      detachActiveScannerSession();
      void getPendingScannerSession().then(setPendingScannerSession).catch(() => undefined);
    } finally {
      scannerStopRequested.current = false;
      setNewLayoutTask('idle');
    }
  };

  const resumeScanner = async () => {
    if (newLayoutTask !== 'idle') return;
    setNewLayoutTask('scanner');
    setNewLayoutMessage('前回のスキャン画像へつなぎ直しています…');
    try {
      discardNewLayoutItems();
      const resumed = await resumePendingScannerSession();
      scannerSessionRef.current = resumed.session;
      setScannerSession(resumed.session);
      setPendingScannerSession(null);
      const items = resumed.files.map(({ id, file }) => ({
        id, file, previewUrl: URL.createObjectURL(file), source: 'scanner' as const,
        analysis: null, analyzing: false, rotationOverride: 0 as const,
      }));
      newLayoutItemsRef.current = items;
      setNewLayoutItems(items);
      setNewLayoutActiveIndex(0);
      setScannerReceivedCount(items.length);
      setNewLayoutMessage(`${items.length}枚へつなぎ直しました。`);
    } catch (error) {
      setNewLayoutMessage(error instanceof Error ? error.message : '前回のスキャン画像へつなぎ直せませんでした');
    } finally {
      setNewLayoutTask('idle');
    }
  };

  const discardRecoveredScans = async () => {
    if (newLayoutTask !== 'idle') return;
    setNewLayoutTask('scanner');
    try {
      await discardPendingScannerRecovery();
      setNewLayoutMessage('前回残ったスキャン画像を破棄しました。');
    } catch (error) {
      setNewLayoutMessage(error instanceof Error ? error.message : '残っているスキャン画像を破棄できませんでした');
    } finally {
      setNewLayoutTask('idle');
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

  const createNewDocument = async (
    layout?: PanelTemplate | DetectedPageLayout[],
    confirmScannedLayouts = false,
  ) => {
    const analyzedItems = [...newLayoutItemsRef.current];
    try {
      if (confirmScannedLayouts) await commitActiveScannerSession();
      else await discardScannerSources();
    } catch (error) {
      setNewLayoutMessage(error instanceof Error ? error.message : 'スキャン処理を完了できませんでした');
      return;
    }
    const sample = parseMangaYaml(sampleYaml);
    const detectedLayouts = Array.isArray(layout) ? layout : [];
    const template = layout && !Array.isArray(layout) ? layout : undefined;
    let importedFigureCount = 0;
    let importedTextCount = 0;
    let reviewTextCount = 0;
    const pages = detectedLayouts.length ? detectedLayouts.map((detectedLayout, index) => {
      const page = newPage(index + 1);
      page.panels = detectedLayout.shapes.map((shape, panelIndex) => ({
        id: panelIndex + 1,
        shape: structuredClone(shape),
        bg: 1,
        bubbles: [],
        action: null,
      }));
      if (detectedLayout.analysis.detectedFigures.length) {
        importedFigureCount += attachDetectedFiguresToPage(page, detectedLayout.analysis.detectedFigures).added;
      }
      if (detectedLayout.analysis.ocrLines.length) {
        const attached = attachRecognizedTextToPage(page, detectedLayout.analysis.ocrLines);
        importedTextCount += attached.added;
        reviewTextCount += attached.needsReview;
      }
      return page;
    }) : [newPage(1)];
    if (!detectedLayouts.length) {
      if (template) {
        pages[0].panels = [];
        applyPanelTemplate(pages[0], template);
        const analysis = analyzedItems[0]?.analysis;
        if (analysis?.detectedFigures.length) {
          importedFigureCount += attachDetectedFiguresToPage(pages[0], analysis.detectedFigures).added;
        }
        if (analysis?.ocrLines.length) {
          const attached = attachRecognizedTextToPage(pages[0], analysis.ocrLines);
          importedTextCount += attached.added;
          reviewTextCount += attached.needsReview;
        }
      } else {
        pages[0].panels[0].bubbles = [];
      }
    }
    const fresh: MangaDocument = {
      manga: {
        schema_name: sample.manga.schema_name,
        schema_version: sample.manga.schema_version,
        meta: {
          title: '', author: '', format: '', page_count: pages.length,
          reading_direction: sample.manga.meta.reading_direction,
          text_orientation: sample.manga.meta.text_orientation,
          font: sample.manga.meta.font,
          style_notes: sample.manga.meta.style_notes,
        },
        layout_spec: sample.manga.layout_spec,
        setting: { location: '', time: '', weather: '', background: [], props: [], situation: '' },
        characters: importedFigureCount
          ? [{ name: DETECTED_FIGURE_NAME, role: '画像解析で検出した仮配置。各コマで実際の登場人物へ置き換えてください。' }]
          : [],
        materials: [],
        pages,
      },
    };
    lastHistoryPush.current = 0;
    setDocument(fresh);
    setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setSelectedElement(null); setTab('storyboard'); setMobileStoryboardPane('editor'); setShowNewDialog(false);
    discardNewLayoutItems();
    const creationMessage = detectedLayouts.length
      ? `検出したコマ領域から${detectedLayouts.length}ページを新規作成しました`
      : template ? `パターン${template.id}で新規作成しました` : 'まっさらな漫画を作成しました';
    const importedDetails = [
      importedFigureCount ? `人物あたり${importedFigureCount}件` : '',
      importedTextCount ? `文字候補${importedTextCount}件` : '',
    ].filter(Boolean).join('、');
    setToast(importedDetails
      ? `${creationMessage}。${importedDetails}を配置しました${reviewTextCount ? `（文字要確認${reviewTextCount}件）` : ''}`
      : creationMessage);
  };

  const resetSample = () => {
    if (!confirm('編集中の内容をサンプル漫画に戻しますか？\nブラウザに保存された内容も上書きされます。')) return;
    setDocument(parseMangaYaml(sampleYaml)); setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setTab('storyboard'); setMobileStoryboardPane('editor'); setToast('サンプル漫画に戻しました');
  };

  const addPage = () => mutate((draft) => { const index = draft.manga.pages.length; draft.manga.pages.push(newPage(index + 1)); setActivePage(index); setActivePanel(0); setSelectedPanels([0]); setTab('storyboard'); setMobileStoryboardPane('editor'); });
  const duplicatePage = () => {
    if (!page) return;
    mutate((draft) => { const copy = structuredClone(draft.manga.pages[activePage]); draft.manga.pages.splice(activePage + 1, 0, copy); draft.manga.pages.forEach((item, index) => { item.page = index + 1; }); setActivePage(activePage + 1); setSelectedPanels([activePanel]); });
  };
  const deletePage = () => {
    if (document.manga.pages.length <= 1 || !confirm(`ページ ${activePage + 1} を削除しますか？`)) return;
    mutate((draft) => { draft.manga.pages.splice(activePage, 1); draft.manga.pages.forEach((item, index) => { item.page = index + 1; }); setActivePage(Math.max(0, activePage - 1)); setActivePanel(0); setSelectedPanels([0]); });
  };
  const reorderPage = (from: number, to: number) => {
    if (from === to) return;
    mutate((draft) => {
      const pages = draft.manga.pages;
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      pages.forEach((item, index) => { item.page = index + 1; });
    });
    // 表示中のページが移動後どこへ行ったかを追従する
    const next = activePage === from ? to
      : activePage > from && activePage <= to ? activePage - 1
      : activePage < from && activePage >= to ? activePage + 1
      : activePage;
    setActivePage(next);
    setActivePanel(0);
    setSelectedPanels([0]);
    setToast(`ページ ${from + 1} を ${to + 1} 番目へ移動しました`);
  };
  const addPanel = () => {
    if (!page || page.panels.length >= 6) { setToast('1ページに追加できるのは6コマまでです'); return; }
    mutate((draft) => { const panels = draft.manga.pages[activePage].panels; panels.push(newPanel(panels.length + 1, Math.min(210, panels.length * 45))); setActivePanel(panels.length - 1); setSelectedPanels([panels.length - 1]); });
  };
  const duplicatePanel = () => {
    if (!panel || !page || page.panels.length >= 6) { setToast('1ページに追加できるのは6コマまでです'); return; }
    mutate((draft) => { const panels = draft.manga.pages[activePage].panels; panels.splice(activePanel + 1, 0, structuredClone(panels[activePanel])); panels.forEach((item, index) => { item.id = index + 1; }); setActivePanel(activePanel + 1); setSelectedPanels([activePanel + 1]); });
  };
  const deletePanel = () => {
    if (!panel || !confirm(`コマ ${panel.id} を削除しますか？`)) return;
    mutate((draft) => { const panels = draft.manga.pages[activePage].panels; panels.splice(activePanel, 1); panels.forEach((item, index) => { item.id = index + 1; }); const nextIndex = Math.max(0, activePanel - 1); setActivePanel(nextIndex); setSelectedPanels([nextIndex]); });
  };
  const changeElementBBox = (selection: CanvasElementSelection, bbox: BBox) => {
    mutate((draft) => {
      const targetPanel = draft.manga.pages[activePage]?.panels[activePanel];
      if (!targetPanel) return;
      if (selection.type === 'figure') {
        const figure = targetPanel.figures?.[selection.index];
        if (figure) figure.bbox = bbox;
      } else if (selection.type === 'screen_text') {
        const screenText = targetPanel.screen_text?.[selection.index];
        if (screenText) screenText.bbox = bbox;
      } else {
        const bubble = targetPanel.bubbles[selection.index];
        if (bubble) bubble.bbox = bbox;
      }
    });
  };
  const toggleAutoAnchor = () => {
    const next = !autoAnchor;
    setAutoAnchor(next);
    try { localStorage.setItem(AUTO_ANCHOR_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const toggleInnerFrameSnap = () => {
    const next = !innerFrameSnap;
    setInnerFrameSnap(next);
    try { localStorage.setItem(INNER_FRAME_SNAP_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const togglePanelSnap = () => {
    const next = !panelSnap;
    setPanelSnap(next);
    try { localStorage.setItem(PANEL_SNAP_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  // ドラッグ確定時の自動アンカー。このハンドラはドラッグ開始時のdocumentを閉じ込めたまま
  // 呼ばれるため、anchorだけ書くとドラッグ中のbbox更新を巻き戻してしまう。確定bboxも同時に書く
  const changeElementAnchor = (selection: CanvasElementSelection, anchor: Anchor, bbox: BBox) => {
    if (selection.type === 'screen_text') return; // 画面内文字は anchor を持たない
    const targetPanel = document.manga.pages[activePage]?.panels[activePanel];
    const item = selection.type === 'figure' ? targetPanel?.figures?.[selection.index] : targetPanel?.bubbles[selection.index];
    if (!item || item.anchor === anchor) return;
    mutate((draft) => {
      const draftPanel = draft.manga.pages[activePage]?.panels[activePanel];
      const draftItem = selection.type === 'figure' ? draftPanel?.figures?.[selection.index] : draftPanel?.bubbles[selection.index];
      if (!draftItem) return;
      draftItem.anchor = anchor;
      draftItem.bbox = bbox;
    });
  };
  const movePanel = (panelIndex: number, deltaX: number, deltaY: number) => {
    mutate((draft) => {
      const targetPanel = draft.manga.pages[activePage]?.panels[panelIndex];
      if (!targetPanel) return;
      translatePanel(targetPanel, deltaX, deltaY);
    });
  };
  const resizePanel = (panelIndex: number, bounds: BBox) => {
    mutate((draft) => {
      const targetPanel = draft.manga.pages[activePage]?.panels[panelIndex];
      if (targetPanel) resizePanelToBounds(targetPanel, bounds);
    });
  };
  const movePanelVertex = (panelIndex: number, vertexIndex: number, x: number, y: number, linkPanels = false) => {
    mutate((draft) => {
      const panels = draft.manga.pages[activePage]?.panels;
      if (panels) movePanelVertexWithSnap(panels, panelIndex, vertexIndex, x, y, linkPanels);
    });
  };
  const movePanelEdge = (panelIndex: number, edgeIndex: number, deltaX: number, deltaY: number, linkPanels = false, excludedEdge?: PanelEdgeReference) => {
    mutate((draft) => {
      const panels = draft.manga.pages[activePage]?.panels;
      if (panels) movePanelEdgeGeometry(panels, panelIndex, edgeIndex, deltaX, deltaY, linkPanels, excludedEdge);
    });
  };
  const applyTemplate = () => {
    if (!page) return;
    const template = findPanelTemplate(selectedTemplate);
    if (!template) return;
    if (page.panels.length > template.shapes.length && !confirm(
      `パターン${template.id}は${template.shapes.length}コマです。現在の${page.panels.length}コマを読み順で統合し、人物・フキダシをすべて再配置します。続けますか？`,
    )) return;
    mutate((draft) => applyPanelTemplate(draft.manga.pages[activePage], template));
    const nextPanelIndex = Math.min(activePanel, template.shapes.length - 1);
    setActivePanel(nextPanelIndex);
    setSelectedPanels([nextPanelIndex]);
    setSelectedElement(null);
    setToast(`パターン${template.id}「${template.name}」を適用しました`);
  };

  const applyRaw = () => {
    try { const parsed = parseMangaYaml(rawSource); setDocument(parsed); setRawSource(toMangaYaml(parsed)); setRawError(null); setToast('OMNY形式を反映しました'); }
    catch (error) { setRawError(error instanceof Error ? error.message : '不明なエラー'); }
  };
  const formatRaw = () => {
    try { setRawSource(toMangaYaml(parseMangaYaml(rawSource))); setRawError(null); }
    catch (error) { setRawError(error instanceof Error ? error.message : '不明なエラー'); }
  };

  const activeLayoutItem = newLayoutItems[newLayoutActiveIndex] ?? null;
  const activeLayoutAnalysis = activeLayoutItem?.analysis ?? null;
  const hasScannedLayoutItems = newLayoutItems.some((item) => item.source === 'scanner');
  const detectedPageLayouts = newLayoutItems.flatMap((item): DetectedPageLayout[] => item.analysis?.detectedPanels.length
    ? [{ shapes: item.analysis.detectedPanels, analysis: item.analysis }]
    : []);
  const canCreateAnalyzedPages = newLayoutItems.length > 0 && detectedPageLayouts.length === newLayoutItems.length;

  return <div class="app-shell">
    <Header title={document.manga.meta.title} version={document.manga.schema_version} issues={issues} savedAt={savedAt} canUndo={past.length > 0} canRedo={future.length > 0} onUndo={undo} onRedo={redo} onNew={() => setShowNewDialog(true)} onImport={() => fileInput.current?.click()} onCopy={copyYaml} onDownload={download} onReset={resetSample} onValidate={() => setShowValidation(true)} />
    <input ref={fileInput} type="file" accept=".yaml,.yml,text/yaml,application/yaml" hidden onChange={(event) => importFile(event.currentTarget.files?.[0])} />

    <nav class="workspace-tabs" aria-label="編集カテゴリ">
      {TABS.map((item) => <button class={`${tab === item.id ? 'is-active' : ''}${item.separatorBefore ? ' has-separator-before' : ''}`} title={item.label} onClick={() => changeTab(item.id)} key={item.id}><item.icon size={17} /><span>{item.label}</span></button>)}
    </nav>

    <main class={`workspace-shell ${tab === 'storyboard' ? 'is-storyboard' : ''} mobile-pane-${mobileStoryboardPane}`}>
      <PageSidebar document={document} activePage={activePage} tab={tab} issues={issues} collapsed={sidebarCollapsed} onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} onSelectPage={(index) => { setActivePage(index); setActivePanel(0); setSelectedPanels([0]); setTab('storyboard'); setMobileStoryboardPane('editor'); }} onAddPage={addPage} onDuplicatePage={duplicatePage} onDeletePage={deletePage} onReorderPage={reorderPage} />

      <section class={`workspace-main ${tab === 'storyboard' ? 'has-mobile-storyboard-tabs' : ''}`}>
        {tab === 'storyboard' && <nav class="mobile-storyboard-tabs" aria-label="ネーム作業エリア" role="tablist">
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'pages'} aria-controls="mobile-pages-pane" class={mobileStoryboardPane === 'pages' ? 'is-active' : ''} onClick={() => { setSidebarCollapsed(false); setMobileStoryboardPane('pages'); }}><Files size={17} /><span>ページ</span></button>
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'editor'} aria-controls="mobile-editor-pane" class={mobileStoryboardPane === 'editor' ? 'is-active' : ''} onClick={() => setMobileStoryboardPane('editor')}><LayoutPanelTop size={17} /><span>ネーム編集</span></button>
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'panel'} aria-controls="mobile-panel-pane" class={mobileStoryboardPane === 'panel' ? 'is-active' : ''} onClick={() => setMobileStoryboardPane('panel')}><SlidersHorizontal size={17} /><span>コマ設定</span></button>
        </nav>}
        {tab === 'storyboard' && page && <div class="storyboard-workspace">
          <div id="mobile-editor-pane" class="canvas-stage">
            <div class="canvas-toolbar">
              <div class="page-switcher"><button onClick={() => { setActivePage(Math.max(0, activePage - 1)); setActivePanel(0); setSelectedPanels([0]); }} disabled={activePage === 0}><ChevronLeft size={17} /></button><span>PAGE <strong>{String(activePage + 1).padStart(2, '0')}</strong> / {String(document.manga.pages.length).padStart(2, '0')}</span><button onClick={() => { setActivePage(Math.min(document.manga.pages.length - 1, activePage + 1)); setActivePanel(0); setSelectedPanels([0]); }} disabled={activePage === document.manga.pages.length - 1}><ChevronRight size={17} /></button></div>
              <div class="canvas-toolbar-actions">
                <div class="layout-template-control" title={findPanelTemplate(selectedTemplate)?.usage}>
                  <label for="panel-template">コマ割り</label>
                  <select id="panel-template" value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.currentTarget.value)}>
                    {PANEL_TEMPLATES.map((template) => <option value={template.id} key={template.id}>パターン{template.id} · {template.name}（{template.shapes.length}コマ）</option>)}
                  </select>
                  <button onClick={applyTemplate}>適用</button>
                </div>
                <button class="guide-toggle merge-panels-button" onClick={mergeSelectedPanelGroup} disabled={selectedPanels.length < 2} title="Shift+クリックで複数選択し、⌘/Ctrl+Shift+Mで合体"><Combine size={16} />コマ合体{selectedPanels.length > 1 ? ` (${selectedPanels.length})` : ''}</button>
                <button class={`guide-toggle ${spreadView ? 'is-active' : ''}`} onClick={() => setSpreadView(!spreadView)} disabled={document.manga.pages.length < 2} title="2ページを見開きで並べて表示"><BookOpen size={16} />見開き</button>
                <button class={`guide-toggle ${showGuides ? 'is-active' : ''}`} onClick={() => setShowGuides(!showGuides)}>{showGuides ? <Eye size={16} /> : <EyeOff size={16} />}ガイド</button>
              </div>
            </div>
            {(() => {
              const activeCanvas = <MangaCanvas title={document.manga.meta.title} author={document.manga.meta.author} page={page} pageCount={document.manga.pages.length} activePanel={activePanel} selectedPanels={selectedPanels} selectedElement={selectedElement} showGuides={showGuides} autoAnchor={autoAnchor} onToggleAutoAnchor={toggleAutoAnchor} innerFrameSnap={innerFrameSnap} onToggleInnerFrameSnap={toggleInnerFrameSnap} panelSnap={panelSnap} onTogglePanelSnap={togglePanelSnap} onSelectPanel={selectCanvasPanel} onSelectElement={setSelectedElement} onChangeElementBBox={changeElementBBox} onChangeElementAnchor={changeElementAnchor} onMovePanel={movePanel} onResizePanel={resizePanel} onMoveVertex={movePanelVertex} onMovePanelEdge={movePanelEdge} />;
              if (spreadPartnerIndex === null) return activeCanvas;
              const switchToPartner = (panelIndex = 0) => { setActivePage(spreadPartnerIndex); setActivePanel(panelIndex); setSelectedPanels([panelIndex]); };
              const partnerCanvas = <MangaCanvas title={document.manga.meta.title} author={document.manga.meta.author} page={document.manga.pages[spreadPartnerIndex]} pageCount={document.manga.pages.length} activePanel={-1} selectedPanels={[]} selectedElement={null} showGuides={showGuides} autoAnchor={autoAnchor} onToggleAutoAnchor={() => {}} innerFrameSnap={innerFrameSnap} onToggleInnerFrameSnap={() => {}} panelSnap={panelSnap} onTogglePanelSnap={() => {}} onSelectPanel={switchToPartner} onSelectElement={() => switchToPartner()} onChangeElementBBox={() => {}} onChangeElementAnchor={() => {}} onMovePanel={() => {}} onResizePanel={() => {}} onMoveVertex={() => {}} onMovePanelEdge={() => {}} />;
              // 右綴じ: 若いページが右（flexの後ろ）に来る
              const leftIndex = Math.max(activePage, spreadPartnerIndex);
              return <div class="canvas-spread">
                <div class={`spread-pane ${leftIndex !== activePage ? 'is-spread-partner' : ''}`} title={leftIndex !== activePage ? `ページ ${spreadPartnerIndex + 1} をクリックで編集` : undefined}>{leftIndex === activePage ? activeCanvas : partnerCanvas}</div>
                <div class={`spread-pane ${leftIndex === activePage ? 'is-spread-partner' : ''}`} title={leftIndex === activePage ? `ページ ${spreadPartnerIndex + 1} をクリックで編集` : undefined}>{leftIndex === activePage ? partnerCanvas : activeCanvas}</div>
              </div>;
            })()}
            <div class="canvas-legend"><span><i class="legend-figure" />人物 bbox</span><span><i class="legend-bubble" />フキダシ bbox</span><span>赤いコマ線をドラッグで移動</span><span>Shift+クリックで複数コマ選択</span><span>要素はドラッグ · 四隅でリサイズ</span></div>
          </div>
          <aside id="mobile-panel-pane" class="inspector-pane"><PanelInspector manga={document.manga} panel={panel} panelIndex={activePanel} selectedElement={selectedElement} onSelectElement={setSelectedElement} onChange={(nextPanel) => mutate((draft) => { draft.manga.pages[activePage].panels[activePanel] = nextPanel; })} onAdd={addPanel} onDuplicate={duplicatePanel} onDelete={deletePanel} /></aside>
        </div>}
        {tab === 'meta' && <MetaEditor document={document} onChange={setDocument} onNotify={setToast} />}
        {tab === 'setting' && <SettingEditor document={document} onChange={setDocument} />}
        {tab === 'characters' && <CharactersEditor document={document} onChange={setDocument} />}
        {tab === 'materials' && <MaterialsEditor document={document} onChange={setDocument} />}
        {tab === 'schema' && <SchemaGuide lang={docsLang} onChangeLang={changeDocsLang} onNotify={setToast} />}
        {tab === 'nyamurutan' && <NyamurutanGuide lang={docsLang} onChangeLang={changeDocsLang} onNotify={setToast} />}
        {tab === 'howto' && <HowToGuide onNavigate={changeTab} onNotify={setToast} />}
        {tab === 'prompt' && <GenerationPromptGuide lang={docsLang} onChangeLang={changeDocsLang} onNotify={setToast} />}
        {tab === 'workflow' && <AgentWorkflowGuide lang={docsLang} onChangeLang={changeDocsLang} onNotify={setToast} onOpenMeta={() => changeTab('meta')} />}
        {tab === 'yaml' && <RawYamlEditor source={rawSource} error={rawError} onSourceChange={setRawSource} onApply={applyRaw} onFormat={formatRaw} />}
      </section>
    </main>

    <footer class="app-footer"><span><Boxes size={13} />オフライン対応 · 変更はこの端末に自動保存</span><span class="footer-links"><a class="license-link" href={import.meta.env.PUBLIC_STANDALONE ? `${REPO_URL}/blob/main/LICENSE` : '/licenses/'} target={import.meta.env.PUBLIC_STANDALONE ? '_blank' : undefined}>© 2026 sa-san10 · MIT License</a><a class="license-link" href={import.meta.env.PUBLIC_STANDALONE ? `${REPO_URL}/blob/main/src/content/changelog.md` : '/changelog/'} target={import.meta.env.PUBLIC_STANDALONE ? '_blank' : undefined} title={`バージョン履歴 · バージョンコード ${appVersionCode}`}>v{appVersion}</a></span><button onClick={() => setShowValidation(true)}>{issues.length ? `${issues.length} 件のNDM確認` : 'NDM検査OK'}</button></footer>
    {showValidation && <><button class="drawer-backdrop" onClick={() => setShowValidation(false)} aria-label="検査結果を閉じる" /><ValidationPanel issues={issues} onClose={() => setShowValidation(false)} /></>}
    {showNewDialog && <>
      <button class="drawer-backdrop" onClick={closeNewDialog} aria-label="新規作成を閉じる" />
      <section class="new-dialog" role="dialog" aria-modal="true" aria-label="新規作成">
        <div class="drawer-head new-dialog-head"><h2>新規作成</h2><button onClick={closeNewDialog} aria-label="閉じる"><X size={16} /></button></div>
        <div class="new-dialog-body">
          <p class="new-dialog-note">作画・演出ルール、レイアウト仕様、NDMスキーマ名・バージョンはサンプルから引き継ぎ、それ以外がまっさらな1ページの漫画を作ります。いまの編集内容は「元に戻す」で復帰できます。</p>
          <button class="new-blank-button" onClick={() => createNewDocument()}><FilePlus2 size={16} />まっさらで開始（コマ割りはあとで選べます）</button>
          <section class="new-layout-import" aria-labelledby="new-layout-import-title">
            <div class="new-layout-import-head">
              <div><h3 id="new-layout-import-title">紙のネームからコマを読み取る</h3></div>
              <div class="new-layout-import-actions">
                <button type="button" onClick={() => newLayoutImageInput.current?.click()} disabled={newLayoutTask !== 'idle'}><Images size={15} />画像を読み込む</button>
                {newLayoutTask === 'scanner'
                  ? <button type="button" onClick={requestScannerFinish}><ScanLine size={15} />取り込みを終了{scannerReceivedCount ? `（${scannerReceivedCount}枚）` : ''}</button>
                  : <button type="button" onClick={launchScanner} disabled={newLayoutTask !== 'idle' || Boolean(pendingScannerSession)}><ScanLine size={15} />スキャナーを起動</button>}
              </div>
            </div>
            {pendingScannerSession && <div class="new-layout-recovery" role="status">
              <div><strong>前回のスキャン画像が{pendingScannerSession.count}枚残っています</strong><span>{new Date(pendingScannerSession.startedAt).toLocaleString('ja-JP')} · {pendingScannerSession.directory}</span><p>強制終了などで処理が中断された可能性があります。前回の画像へつなぎ直しますか？</p></div>
              <div><button type="button" class="primary-button" onClick={resumeScanner} disabled={newLayoutTask !== 'idle'}>つなぎ直す</button><button type="button" onClick={discardRecoveredScans} disabled={newLayoutTask !== 'idle'}>破棄する</button></div>
            </div>}
            <input ref={newLayoutImageInput} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/tiff" multiple hidden onChange={(event) => chooseNewLayoutImages(event.currentTarget.files)} />
            {activeLayoutItem && <div class="new-layout-workbench">
              <section class="new-layout-thumb-pane" aria-labelledby="new-layout-source-title">
                <h4 id="new-layout-source-title">原画</h4>
                <div class="new-layout-spread-grid">
                  {NEW_LAYOUT_SPREAD_ORDER.map((itemIndex) => {
                    const item = newLayoutItems[itemIndex];
                    if (!item) return <span class="new-layout-thumb-card is-empty" aria-hidden="true" key={`source-empty-${itemIndex}`} />;
                    return <button type="button" class={`new-layout-thumb-card ${newLayoutActiveIndex === itemIndex ? 'is-active' : ''}`} aria-label={`原画 ${itemIndex + 1}ページ目を選択`} onClick={() => setNewLayoutActiveIndex(itemIndex)} key={`source-${item.id}`}>
                      <span class="new-layout-thumb-media"><img src={item.previewUrl} alt="" style={{ transform: `rotate(${displayedLayoutRotation(item)}deg) scale(${displayedLayoutRotation(item) % 180 ? .78 : 1})` }} /></span>
                      <em>{String(itemIndex + 1).padStart(2, '0')}</em>
                    </button>;
                  })}
                </div>
              </section>
              <section class="new-layout-thumb-pane is-analysis" aria-labelledby="new-layout-analysis-title">
                <h4 id="new-layout-analysis-title">解析結果</h4>
                <div class="new-layout-spread-grid">
                  {NEW_LAYOUT_SPREAD_ORDER.map((itemIndex) => {
                    const item = newLayoutItems[itemIndex];
                    if (!item) return <span class="new-layout-thumb-card is-empty" aria-hidden="true" key={`analysis-empty-${itemIndex}`} />;
                    const hasPanels = Boolean(item.analysis?.detectedPanels.length);
                    return <button type="button" class={`new-layout-thumb-card ${newLayoutActiveIndex === itemIndex ? 'is-active' : ''} ${hasPanels ? 'is-ready' : ''} ${item.analyzing ? 'is-analyzing' : ''} ${item.error ? 'is-error' : ''}`} aria-label={`解析結果 ${itemIndex + 1}ページ目を選択`} onClick={() => setNewLayoutActiveIndex(itemIndex)} key={`analysis-${item.id}`}>
                      <span class="new-layout-thumb-media">{hasPanels && item.analysis ? <TemplateThumb shapes={item.analysis.detectedPanels} figures={item.analysis.detectedFigures} /> : <span class="new-layout-analysis-placeholder">{item.analyzing ? '解析中' : item.error ? '!' : ''}</span>}</span>
                      <em>{String(itemIndex + 1).padStart(2, '0')}</em>
                    </button>;
                  })}
                </div>
              </section>
              <section class="new-layout-focus-pane" aria-labelledby="new-layout-focus-title">
                <h4 id="new-layout-focus-title">フォーカス中</h4>
                <div class="new-layout-focus-body">
                  <div class="new-layout-focus-image"><img src={activeLayoutItem.previewUrl} alt="読み込んだネーム画像のプレビュー" style={{ transform: `rotate(${displayedLayoutRotation(activeLayoutItem)}deg) scale(${displayedLayoutRotation(activeLayoutItem) % 180 ? .78 : 1})` }} /></div>
                  <div class="new-layout-focus-controls">
                    <span class="new-layout-page-number">PAGE {String(newLayoutActiveIndex + 1).padStart(2, '0')} / {String(newLayoutItems.length).padStart(2, '0')}</span>
                    <strong title={activeLayoutItem.file.name}>{activeLayoutItem.file.name}</strong>
                    <div class="new-layout-rotation-controls" aria-label="画像の向きを手動指定"><button type="button" onClick={() => rotateActiveLayoutImage(270)} disabled={newLayoutTask !== 'idle'}>左90°</button><button type="button" onClick={() => rotateActiveLayoutImage(180)} disabled={newLayoutTask !== 'idle'}>180°</button><button type="button" onClick={() => rotateActiveLayoutImage(90)} disabled={newLayoutTask !== 'idle'}>右90°</button></div>
                    <button type="button" class="primary-button" onClick={analyzeNewLayouts} disabled={newLayoutTask !== 'idle'} title="現在表示している向きで解析します"><Sparkles size={15} />{newLayoutTask === 'analyzing' ? '解析中…' : '解析開始'}</button>
                    <button type="button" class="primary-button new-layout-complete-button" onClick={() => createNewDocument(detectedPageLayouts, hasScannedLayoutItems)} disabled={newLayoutTask !== 'idle' || !canCreateAnalyzedPages} title={canCreateAnalyzedPages ? '検出したコマから編集を開始します' : 'すべての画像の解析完了後に使用できます'}><FilePlus2 size={15} />編集開始</button>
                  </div>
                </div>
              </section>
            </div>}
            {newLayoutMessage && <p class={`new-layout-message ${activeLayoutAnalysis?.detectedPanels.length ? 'is-match' : ''}`}>{newLayoutMessage}</p>}
            {scannerSession && <p class="new-layout-session">開始 {new Date(scannerSession.startedAt).toLocaleTimeString('ja-JP')} · 保存先 {scannerSession.directory}</p>}
            {activeLayoutItem?.error && <p class="new-layout-message">{activeLayoutItem.error}</p>}
            {activeLayoutAnalysis && !activeLayoutAnalysis.detectedPanels.length && <p class="new-layout-message">{activeLayoutAnalysis.reason}</p>}
            {activeLayoutAnalysis && <details class="new-layout-analysis-details">
              <summary>解析詳細 · コマ{activeLayoutAnalysis.detectedPanelCount} / 文字{activeLayoutAnalysis.ocrLines.length}</summary>
              <div class="new-layout-analysis-detail">
                <span>コマ: {activeLayoutAnalysis.structureEngine || '検出なし'} · {activeLayoutAnalysis.detectedPanelCount}領域</span>
                <span>誤検出除外: {activeLayoutAnalysis.excludedNonPanelCount}領域 · 補助検出 文字{activeLayoutAnalysis.detectedTextRegionCount} / 顔{activeLayoutAnalysis.detectedFaceRegionCount} / 身体{activeLayoutAnalysis.detectedBodyRegionCount}</span>
                <span>人物あたり: {activeLayoutAnalysis.detectedFigures.length}件</span>
                <span>文字: {activeLayoutAnalysis.ocrEngine || '検出なし'} · {activeLayoutAnalysis.ocrLines.length}件</span>
                {activeLayoutAnalysis.ocrLines.length > 0 && <ul>{activeLayoutAnalysis.ocrLines.map((line) => <li key={line.id}><strong>{line.text}</strong><small>{line.source}{line.needsReview ? ' · 要確認' : ''}</small></li>)}</ul>}
              </div>
            </details>}
          </section>
          <h3 class="new-dialog-subtitle">コマ割りを選んで開始</h3>
          <div class="new-template-grid">
            {PANEL_TEMPLATES.map((template) => <button id={`new-template-${template.id}`} class="new-template-card" key={template.id} onClick={() => createNewDocument(template, hasScannedLayoutItems)}>
              <TemplateThumb shapes={template.shapes} />
              <strong>パターン{template.id} · {template.name}</strong>
              <small>{template.shapes.length}コマ · {template.usage}</small>
            </button>)}
          </div>
        </div>
      </section>
    </>}
    {showHowtoIntro && <>
      <button class="drawer-backdrop" onClick={() => setShowHowtoIntro(false)} aria-label="案内を閉じる" />
      <section class="howto-intro-dialog" role="dialog" aria-modal="true" aria-label="使い方の案内">
        <div class="howto-intro-icon" aria-hidden="true"><CircleHelp size={26} /></div>
        <h2>使い方を見てみる？</h2>
        <p>LLMと画像生成AIをつないで漫画を作る、3ステップのワークフローを紹介します。</p>
        <div class="howto-intro-spread">
          <button type="button" onClick={() => setMangaViewerPage(1)} aria-label="サンプル漫画の2ページ目を全画面で読む"><img src={sampleMangaPages.page2} alt="" /></button>
          <button type="button" onClick={() => setMangaViewerPage(0)} aria-label="サンプル漫画の1ページ目を全画面で読む"><img src={sampleMangaPages.page1} alt="" /></button>
        </div>
        <small class="howto-intro-zoom-hint">漫画をタップすると全画面で読めます</small>
        <div class="howto-intro-actions">
          <button type="button" class="secondary-button" onClick={() => setShowHowtoIntro(false)}>あとで</button>
          <button type="button" class="primary-button" onClick={() => { setShowHowtoIntro(false); changeTab('howto'); }}>はい</button>
        </div>
        <div class="howto-intro-ask-ai">
          <span>または、あなたの創作パートナーのAIに聞いてみる</span>
          <AskAiBlock />
        </div>
      </section>
    </>}
    {mangaViewerPage !== null && <div
      class="manga-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="サンプル漫画の全画面表示"
      onClick={(event) => { if (event.target === event.currentTarget) setMangaViewerPage(null); }}
    >
      <button
        type="button"
        class="manga-viewer-page"
        onClick={() => setMangaViewerPage(mangaViewerPage + 1 < SAMPLE_MANGA_PAGES.length ? mangaViewerPage + 1 : null)}
        title={mangaViewerPage + 1 < SAMPLE_MANGA_PAGES.length ? 'タップで次のページ' : 'タップで閉じる'}
      >
        <img src={SAMPLE_MANGA_PAGES[mangaViewerPage]} alt={`サンプル漫画 ${mangaViewerPage + 1}ページ目`} />
      </button>
      <span class="manga-viewer-count">{mangaViewerPage + 1} / {SAMPLE_MANGA_PAGES.length}<em>タップで{mangaViewerPage + 1 < SAMPLE_MANGA_PAGES.length ? '次のページ' : '閉じる'}</em></span>
      <button type="button" class="manga-viewer-close" onClick={() => setMangaViewerPage(null)} aria-label="全画面表示を閉じる"><X size={17} /></button>
    </div>}
    {toast && <div class="toast"><span>{toast}</span><button onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
