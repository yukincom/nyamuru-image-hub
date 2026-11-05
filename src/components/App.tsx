import VoiceCommands from './VoiceCommands';
import { isLanClient } from '../lib/clientRuntime';
import { type BrowserDirectoryHandle } from '../lib/browserWorkspace';
import { browserCatalogImageIds } from '../lib/browserCatalog';
import type {Bubble,TextStyle} from '../types';
import { loadAgentPreferences, saveAgentPreferences, type AgentPreferences } from '../lib/agentPreferences';
import { createAgentRevision } from '../lib/agentTools';
import PaintTextTools, {type TextPaletteTab} from './PaintTextTools';
import BubbleMaterialPicker from './BubbleMaterialPicker';
import PaintToolHelp from './PaintToolHelp';
import { canvasTextAt, canvasTextEditable, canvasBubbleLineWidthEditable, type CanvasTextTarget } from '../lib/canvasText';
import { bubbleStrokeWidthMm, isHandwrittenText } from '../lib/bubblePresentation';
import { type PcFontFamily } from '../lib/bubbleFonts';
import PageLayerPalette from './PageLayerPalette';
import { ownerItemLocked, panelGeometryLocked, panelLocked } from '../lib/panelLayers';
import PanelControls from './PanelControls';
import { namedBackgroundStages } from '../lib/background3d';
import PaintEditor, { PaintTools, PaintDetails, PaintStatus } from './PaintEditor';
import { paintAssetIds } from '../lib/paintDocument';
import { paintColorMode } from '../lib/paintColor';
import PlacedImageList from './PlacedImageList';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { BookOpen, Box, ChevronLeft, ChevronRight, ClipboardCheck, Download, FilePlus2, Files, FolderOpen, LayoutPanelTop, Settings2, SlidersHorizontal, UsersRound, X } from 'lucide-preact';
import Header from './Header';
import { getPrintSetup, defaultPrintSetup, type PrintSetup } from '../lib/printSettings';
import { type ProjectBinding } from '../lib/projectPersistence';
import PageSidebar from './PageSidebar';
import MangaCanvas from './MangaCanvas';
import PanelInspector from './PanelInspector';
import QwenGenerationDialog from './QwenGenerationDialog';
import { type QwenLayerCandidate, type QwenGenerationConversation } from '../lib/qwenGeneration';
import { canChooseImageExportDirectory, type ImageExportFormat } from '../lib/pageExport';
import PageOverlayInspector from './PageOverlayInspector';
import EnvironmentSettings from './EnvironmentSettings';
import { loadEditGuide, saveEditGuide, loadPaintBleed, savePaintBleed, loadPaintSmoothing, savePaintSmoothing, loadPaintCursor, savePaintCursor, type PaintCursorMode } from '../lib/paintPreferences';
import { workspaceHistory } from '../lib/workspaceHistory';
import { loadHistorySteps, saveHistorySteps } from '../lib/historyPreferences';
import type { PaintController, PaintLayerAction, PaintSessionSnapshot } from '../lib/paintSession';
import type { BubblePathToolMode } from '../lib/paintWorkspace';
import SourceCoverageReview from './SourceCoverageReview';
import ScenarioReview from './ScenarioReview';
import { confirmScenarioCorrespondence, detachResolvedScenarioLinks, rejectScenarioCorrespondence, restoreProvisionalScenarioText, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import type { CharacterReadProgressState } from './CharacterReadProgress';
import { CharactersEditor, MetaEditor, PropsEditor, SettingEditor } from './DocumentEditors';
import { cloneDocument, toSeparatedMangaYaml } from '../lib/manga';
import { DEFAULT_PANEL_GUTTERS } from '../lib/canvasGeometry';
import { mergeSelectedPanels, reconcileSplitOverlapFlags, splitPanel, type PanelSplitDirection } from '../lib/panelTemplates';
import { discardSeriesCatalogDraftOnPageExit, getPendingScannerSession, getSeriesCharacterTextStatus, type EpisodeWorkspace, type PendingScannerSession, type ReferenceTextSuggestion, type ScannerSession, type SeriesCatalogDraftSession, type SeriesCatalogSummary, type SeriesCharacterTextLink, type SeriesReferenceTextCandidate, type SeriesReferenceTextSelection } from '../lib/localBridge';
import { removeMaterialsFromSeriesCatalog } from '../lib/seriesCatalog';
import { onFigureCropAssetsChanged, pruneFigureCropAssets, collectFigureCropAssetIds } from '../lib/figureCropStore';
import { spreadPartnerIndex as findSpreadPartnerIndex } from '../lib/pageSpread';
import { setPanelMaterialLink, type PanelMaterialLinkTarget } from '../lib/panelMaterialLinks';
import { isPropPlacement, synchronizeCatalogReferences } from '../lib/catalogModel';
import { type ImportedStorySetting } from '../lib/settingTextImport.ts';
import { type SourceCoverageDecision } from '../lib/sourceCoverage.ts';
import { startNewCreationBridgeSession, stopNewCreationBridgeSession, stopNewCreationBridgeSessionOnPageExit } from '../lib/localBridgeLifecycle.ts';
import { createInitialWorkspace, type WorkspaceStartupState } from '../lib/workspaceStartup.ts';
import type { CanvasElementSelection, MangaDocument, WorkspaceTab } from '../types';

import { type NewCreationStep, type NewSeriesMode, type NewSourceSnapshot, type BoundSourceSnapshot, emptyNewWorkSetting } from '../lib/newProjectSettings';
import { type NewLayoutTask, type NewLayoutItem, nextLayoutIndexFromArrow } from '../lib/newLayoutPreview';
import { storedPcFontCatalog, initialInnerFrameSnap, initialPanelSync, initialPanelGapSnap, initialShowGuides, initialSpreadView, initialPersistAnalogAssets } from '../lib/workspacePreferences';

import NewSeriesStep from './new-project/NewSeriesStep';
import NewSettingStep from './new-project/NewSettingStep';
import NewLayoutStep from './new-project/NewLayoutStep';
import NewProjectNavigation from './new-project/NewProjectNavigation';

import { createNewProjectAction } from './workspace/newProjectCreation';
import { createProjectFileActions } from './workspace/workspaceProjectFiles';
import { createImageExportActions } from './workspace/workspaceImageExport';
import type { MobileStoryboardPane, WorkspacePaintSession, WorkspaceSnapshot, WorkspaceGeneration, WorkspaceImageTarget } from './workspace/workspaceTypes';

import { createNewProjectSessions } from './workspace/newProjectSessions';
import { createSeriesSelection } from './workspace/newSeriesSelection';
import { createSeriesReferenceActions } from './workspace/newSeriesReferences';
import { createWorkspaceSourceActions } from './workspace/episodeWorkspaceSources';
import { createSeriesPreparation } from './workspace/newSeriesPreparation';
import { createSeriesCatalogActions } from './workspace/seriesCatalogActions';
import { createEpisodeSettingActions } from './workspace/newEpisodeSettings';
import { createWorkspaceCatalogActions } from './workspace/workspaceCatalog';
import { createNewLayoutImportActions } from './workspace/newLayoutImportActions';

import { createPageEditActions } from './workspace/pageEditActions';
import { createWorkspacePaintSession } from './workspace/workspacePaintSession';
import { useWorkspaceTextActions } from './workspace/workspaceTextActions';
import { createLayerPaletteActions } from './workspace/layerPaletteActions';
import { createWorkspaceGeneration } from './workspace/workspaceGeneration';
import { createWorkspacePaintResults } from './workspace/workspacePaintResults';
import { createImagePlacementActions } from './workspace/workspaceImagePlacement';
import { createWorkspaceCanvasActions } from './workspace/workspaceCanvasActions';
import { createWorkspaceVoiceActions } from './workspace/workspaceVoiceActions';

const TABS: {
  id: WorkspaceTab;
  label: string;
  icon: typeof LayoutPanelTop;
}[] = [
  { id: 'storyboard', label: 'ネーム', icon: LayoutPanelTop },
  { id: 'meta', label: '作品情報', icon: BookOpen },
  { id: 'setting', label: '舞台設定', icon: Settings2 },
  { id: 'characters', label: '登場人物', icon: UsersRound },
  { id: 'props', label: '小道具', icon: Box },
  { id: 'coverage', label: 'シナリオ', icon: ClipboardCheck },
];

type BoundEpisodeWorkspace = ProjectBinding;

function initialTab(): WorkspaceTab {
  try {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested === 'materials') return 'props';
    if (requested && TABS.some((item) => item.id === requested)) return requested as WorkspaceTab;
  } catch { /* no URL access */ }
  return 'storyboard';
}

function initialWorkspace(): WorkspaceStartupState {
  const startup = createInitialWorkspace();
  reconcileSplitOverlapFlags(startup.document);
  return startup;
}

export default function App() {
  const [startupWorkspace] = useState<WorkspaceStartupState>(initialWorkspace);
  return <EditorApp startupWorkspace={startupWorkspace}/>;
}

function EditorApp({startupWorkspace}:{startupWorkspace:WorkspaceStartupState}) {
  const [document, setDocumentState] = useState<MangaDocument>(startupWorkspace.document);
  const [hasDocument, setHasDocument] = useState(startupWorkspace.hasDocument);
  const documentRef = useRef(document);
  documentRef.current = document;
  const [activePage, setActivePage] = useState(0);
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const [activePanel, setActivePanel] = useState(0);
  const activePanelRef = useRef(activePanel);
  activePanelRef.current = activePanel;
  const qwenPreparing=useRef(false);
  const [generationConversation,setGenerationConversation]=useState<QwenGenerationConversation|null>(null);
  const [generationConversationHost,setGenerationConversationHost]=useState<HTMLElement|null>(null);
  const [qwenGeneration,setQwenGeneration]=useState<WorkspaceGeneration | null>(null);
  const [agentWorkTarget,setAgentWorkTarget]=useState<{pageIndex:number;panelIndex:number;selection:CanvasElementSelection}|null>(null);
  const qwenGenerationRef=useRef(qwenGeneration);qwenGenerationRef.current=qwenGeneration;
  const [selectedPanels, setSelectedPanels] = useState<number[]>([0]);
  const [selectedElement, setSelectedElement] = useState<CanvasElementSelection | null>(null);
  const placedImageInput = useRef<HTMLInputElement>(null);
  const imageImportTarget = useRef<WorkspaceImageTarget | null>(null);
  const [imageImportBusy, setImageImportBusy] = useState(false);
  const [imageExportDialog,setImageExportDialog]=useState<{mode:'current'|'range'|'all';from:number;to:number;format:ImageExportFormat}|null>(null);
  const [imageExportBusy,setImageExportBusy]=useState(false);
  const [imageExportDirectory,setImageExportDirectory]=useState<BrowserDirectoryHandle|null>(null);
  const [imageExportProgress,setImageExportProgress]=useState<{value:number;max:number;label:string}|null>(null);
  const [imageExportError,setImageExportError]=useState('');
  const [paintSession,setPaintSession]=useState<WorkspacePaintSession|null>(null);
  const paintController=useRef<PaintController|null>(null);
  const paintSessionRef=useRef(paintSession);
  paintSessionRef.current=paintSession;
  const autoPaintResume=useRef<{pageIndex:number;panelIndex:number;overlay:boolean;ownerKey:string}|null>(null);
  const autoPaintTransition=useRef(false);
  const [paintBleedPx,setPaintBleedPx]=useState(()=>{try{return loadPaintBleed(localStorage);}catch{return loadPaintBleed();}});
  const [editGuide,setEditGuide]=useState(()=>{try{return loadEditGuide(localStorage);}catch{return true;}});
  const [paintSmoothing,setPaintSmoothing]=useState(()=>{try{return loadPaintSmoothing(localStorage);}catch{return 0;}});
  const [paintCursorMode,setPaintCursorMode]=useState<PaintCursorMode>(()=>{try{return loadPaintCursor(localStorage);}catch{return 'circle';}});
  const imageGesture = useRef<{active:boolean;pushed:boolean;source?:'text-size'}>({ active: false, pushed: false });
  const [canvasSelectionScrollRequest, setCanvasSelectionScrollRequest] = useState(0);
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const environmentPanel = useRef<HTMLElement>(null);
  const [environmentAgentHost,setEnvironmentAgentHost]=useState<HTMLElement|null>(null);
  const openingEnvironment=useRef(false);
  const closeEnvironmentSettings = () => {
    // Commit fields that save on blur before removing the panel (including Escape).
    const focused = window.document.activeElement;
    if (focused instanceof HTMLElement && environmentPanel.current?.contains(focused)) focused.blur();
    setEnvironmentOpen(false);
    window.document.querySelector<HTMLButtonElement>('[data-environment-settings]')?.focus();
  };
  const toggleEnvironmentSettings = async () => {
    if (environmentOpen) { closeEnvironmentSettings(); return; }
    if(openingEnvironment.current||projectOperation.current||qwenGeneration)return;
    await showEnvironmentSettings();
  };
  const showEnvironmentSettings = async () => {
    openingEnvironment.current=true;
    try {
      if(paintSessionRef.current)await paintController.current?.pause();
      endTextEdit();setEnvironmentOpen(true);
    } catch(error) { setToast(error instanceof Error?error.message:'描画を確定できませんでした'); }
    finally { openingEnvironment.current=false; }
  };
  useEffect(() => {
    if (environmentOpen) environmentPanel.current?.focus();
  }, [environmentOpen]);
  const environmentKeyDown = (event: KeyboardEvent) => {
    if (!environmentOpen || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeEnvironmentSettings(); return;
    }
    if (event.key !== 'Tab') return;
    const toggle = window.document.querySelector<HTMLButtonElement>('[data-environment-settings]');
    const items = [toggle, ...Array.from(environmentPanel.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]') ?? [])]
      .filter((item): item is HTMLElement => Boolean(item && item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length));
    const first = items[0], last = items.at(-1), active = window.document.activeElement;
    if (!items.some(item => item === active)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
  };
  const [materialLinkTarget, setMaterialLinkTarget] = useState<PanelMaterialLinkTarget | null>(null);
  const [mobileStoryboardPane, setMobileStoryboardPane] = useState<MobileStoryboardPane>('editor');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed,setInspectorCollapsed]=useState(false);
  const [paintToolsCollapsed,setPaintToolsCollapsed]=useState(true);
  const [textTool,setTextTool]=useState(false);
  const [textToolStyle,setTextToolStyle]=useState<TextStyle>({fontSize:12,orientation:'vertical'});
  const [textPaletteRequest,setTextPaletteRequest]=useState<{id:number;tab:TextPaletteTab}>({id:0,tab:'text'});
  const [bubblePathTool,setBubblePathTool]=useState<BubblePathToolMode>(false);
  const [localFontFamilies,setLocalFontFamilies]=useState<PcFontFamily[]>(storedPcFontCatalog);
  const localFontCatalog=useRef(localFontFamilies);
  const localFontQuery=useRef<Promise<void>|null>(null),localFontSynced=useRef(false);
  const createdText=useRef<CanvasTextTarget|null>(null);
  const [bubbleMaterialsOpen,setBubbleMaterialsOpen]=useState(false);
  const [zoomTool,setZoomTool]=useState(false);
  const [voiceOpen,setVoiceOpen]=useState(false);
  const [agentProfile,setAgentProfile]=useState(()=>loadAgentPreferences(typeof window==='undefined'?undefined:window.localStorage));
  const agentRevision=useRef(createAgentRevision());
  const changeAgentProfile=(value:AgentPreferences)=>setAgentProfile(saveAgentPreferences(window.localStorage,value));
  const [editingText,setEditingText]=useState<CanvasTextTarget|null>(null);
  const [layerSwitchBusy,setLayerSwitchBusy]=useState(false);
  const layerSwitch=useRef(false);
  const pendingLayerAction=useRef<PaintLayerAction|null>(null);
  const [paintLayersCollapsed,setPaintLayersCollapsed]=useState(false);
  const [showGuides, setShowGuides] = useState(initialShowGuides);
  const [innerFrameSnap, setInnerFrameSnap] = useState(initialInnerFrameSnap);
  const [panelGapSnap, setPanelGapSnap] = useState(initialPanelGapSnap);
  const [panelSync, setPanelSync] = useState(initialPanelSync);
  const [spreadView, setSpreadView] = useState(initialSpreadView);
  const [canvasZoomPercent, setCanvasZoomPercent] = useState<number|null>(null);
  const [persistAnalogAssets, setPersistAnalogAssets] = useState(initialPersistAnalogAssets);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newCreationStep, setNewCreationStep] = useState<NewCreationStep>('series');
  const [newPrintSetup, setNewPrintSetup] = useState<PrintSetup>(defaultPrintSetup);
  const [editingNewPrintSetup, setEditingNewPrintSetup] = useState(true);
  const [newPrintConfirmed, setNewPrintConfirmed] = useState(false);
  const [newSeriesMode, setNewSeriesMode] = useState<NewSeriesMode>('');
  const [newCharacterDocument, setNewCharacterDocumentState] = useState<MangaDocument | null>(null);
  const newCharacterDocumentRef = useRef<MangaDocument | null>(null);
  const [newSeriesPreparing, setNewSeriesPreparing] = useState(false);
  const [panelSplitDirection, setPanelSplitDirection] = useState<PanelSplitDirection>('vertical');
  const [newLayoutItems, setNewLayoutItems] = useState<NewLayoutItem[]>([]);
  const [newLayoutActiveIndex, setNewLayoutActiveIndex] = useState(0);
  const [newLayoutMessage, setNewLayoutMessage] = useState<string | null>(null);
  const [newCharacterReadProgress, setNewCharacterReadProgress] = useState<CharacterReadProgressState | null>(null);
  const [newLayoutTask, setNewLayoutTask] = useState<NewLayoutTask>('idle');
  // Reactの再描画前に別操作が入っても、確定処理と破棄処理を競合させない。
  const newLayoutTaskRef = useRef<NewLayoutTask>('idle');
  const [newLayoutRowGapMm, setNewLayoutRowGapMm] = useState(DEFAULT_PANEL_GUTTERS.rowGapMm);
  const [newLayoutColumnGapMm, setNewLayoutColumnGapMm] = useState(DEFAULT_PANEL_GUTTERS.columnGapMm);
  const [newLayoutFrameLineWidthMm, setNewLayoutFrameLineWidthMm] = useState(1);
  const [newWorkTitle, setNewWorkTitle] = useState('');
  const [newWorkSetting, setNewWorkSetting] = useState<ImportedStorySetting>(emptyNewWorkSetting);
  const [newSettingMessage, setNewSettingMessage] = useState('');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [newSeriesId, setNewSeriesId] = useState('');
  const [newSeriesDirectory, setNewSeriesDirectory] = useState('');
  const [newSeriesDirectorySelecting, setNewSeriesDirectorySelecting] = useState(false);
  const [newSeriesDirectoryMessage, setNewSeriesDirectoryMessage] = useState('');
  const [newSeriesReference, setNewSeriesReference] = useState<SeriesReferenceTextSelection | null>(null);
  const [newSeriesReferences, setNewSeriesReferences] = useState<SeriesReferenceTextSelection[]>([]);
  const [newSeriesReferenceCandidates, setNewSeriesReferenceCandidates] = useState<(SeriesReferenceTextCandidate & { seriesDirectory: string })[]>([]);
  const [newSelectedSeriesReferencePaths, setNewSelectedSeriesReferencePaths] = useState<string[]>([]);
  const [newSeriesReferenceSelecting, setNewSeriesReferenceSelecting] = useState(false);
  const [newSeriesReferenceMessage, setNewSeriesReferenceMessage] = useState('');
  const [newEpisodeWorkspace, setNewEpisodeWorkspace] = useState<EpisodeWorkspace | null>(null);
  const [boundEpisodeWorkspace, setBoundEpisodeWorkspace] = useState<BoundEpisodeWorkspace | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const projectOperation = useRef(false);
  const saveProjectAction = useRef<() => Promise<unknown>>(async () => {});
  const [newSourceSnapshot, setNewSourceSnapshot] = useState<NewSourceSnapshot | null>(null);
  const [boundSourceSnapshot, setBoundSourceSnapshot] = useState<BoundSourceSnapshot | null>(null);
  const [sourceCoverageDecisions, setSourceCoverageDecisions] = useState<SourceCoverageDecision[]>([]);
  const [newWorkspaceSelecting, setNewWorkspaceSelecting] = useState(false);
  const [newWorkspaceMessage, setNewWorkspaceMessage] = useState('');
  const [newReferenceSelecting, setNewReferenceSelecting] = useState(false);
  const [newReferenceFileName, setNewReferenceFileName] = useState('');
  const [newSuggestedEpisodeReference, setNewSuggestedEpisodeReference] = useState<ReferenceTextSuggestion | null>(null);
  const [newReferenceMessage, setNewReferenceMessage] = useState('');
  const [characterTextLink, setCharacterTextLink] = useState<SeriesCharacterTextLink | null>(null);
  const [newCharacterTextLink, setNewCharacterTextLink] = useState<SeriesCharacterTextLink | null>(null);
  const [characterTextBusy, setCharacterTextBusy] = useState(false);
  const [seriesCatalogs, setSeriesCatalogs] = useState<SeriesCatalogSummary[]>([]);
  const [seriesCatalogMessage, setSeriesCatalogMessage] = useState('');
  const [seriesCatalogSaving, setSeriesCatalogSaving] = useState(false);
  const [newEpisodeNumber, setNewEpisodeNumber] = useState('');
  const [scannerSession, setScannerSession] = useState<ScannerSession | null>(null);
  const [pendingScannerSession, setPendingScannerSession] = useState<PendingScannerSession | null>(null);
  const [scannerReceivedCount, setScannerReceivedCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [historySteps,setHistorySteps]=useState(()=>{try{return loadHistorySteps(localStorage);}catch{return loadHistorySteps();}});
  const timeline=useRef(workspaceHistory<WorkspaceSnapshot>(historySteps));
  const [,refreshHistory]=useState(0);
  const {past,future}=timeline.current;
  const changedHistory=()=>refreshHistory(value=>value+1);
  const pendingPaintAssets=useRef(new Set<string>());
  const workspaceSnapshot=(state?:PaintSessionSnapshot):WorkspaceSnapshot=>{
    const session=paintSessionRef.current,snapshot=state??paintController.current?.snapshot()??session?.resume;
    const textSelection:CanvasTextTarget|undefined=selectedElement?.type==='bubble'||selectedElement?.type==='screen_text'
      ?{pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:selectedElement.type,overlay:selectedElement.scope==='page_overlay'}:undefined;
    return {document:documentRef.current,textSelection,...(session&&snapshot?{paint:{pageIndex:session.pageIndex,panelIndex:session.panelIndex,overlay:session.overlay,title:session.title,state:snapshot}}:{})};
  };
  const recordPaint=(before:PaintSessionSnapshot)=>{timeline.current.record(workspaceSnapshot(before));lastHistoryPush.current=0;changedHistory();};
  const changeHistorySteps=(value:number)=>{try{const steps=saveHistorySteps(localStorage,value);setHistorySteps(steps);timeline.current.resize(steps);changedHistory();}catch(error){setToast(String(error));}};
  const newLayoutImageInput = useRef<HTMLInputElement>(null);
  const newLayoutItemsRef = useRef<NewLayoutItem[]>([]);
  const newCreationBridgeToken = useRef<string | null>(null);
  const newCharacterDraftSession = useRef<SeriesCatalogDraftSession | null>(null);
  const characterEditorBridgeToken = useRef<string | null>(null);
  const characterTextSyncTimer = useRef<number | undefined>(undefined);
  /** 新規作成ダイアログを跨いだ古い非同期応答を無効化する世代番号。 */
  const newLayoutOperationGeneration = useRef(0);
  /** 既存シリーズを素早く切り替えた際、古い読み込み結果を反映しない。 */
  const newSeriesSelectionGeneration = useRef(0);
  const scannerSessionRef = useRef<ScannerSession | null>(null);
  const scannerStopRequested = useRef(false);
  const lastHistoryPush = useRef(0);
  const seriesCatalogSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const seriesCatalogPendingCount = useRef(0);
  const pendingCanvasElementSelection = useRef<CanvasElementSelection | null>(null);

  useEffect(() => {
    if (!materialLinkTarget) return;
    const expectedTab = materialLinkTarget.materialType === 'background' ? 'setting' : 'props';
    if (tab !== expectedTab) setMaterialLinkTarget(null);
  }, [tab, materialLinkTarget?.materialType]);

  const updateNewLayoutTask = (task: NewLayoutTask) => {
    if (task === 'idle') setNewCharacterReadProgress(null);
    newLayoutTaskRef.current = task;
    setNewLayoutTask(task);
  };

  const clearNewReferenceText = () => {
    setNewSourceSnapshot(null);
    setNewReferenceFileName('');
    setNewReferenceMessage('');
    setNewReferenceSelecting(false);
    setNewSuggestedEpisodeReference(null);
    setNewWorkTitle('');
    setNewEpisodeNumber('');
    setNewWorkSetting(emptyNewWorkSetting());
    setNewSettingMessage('');
  };

  const clearNewSeriesReference = () => {
    newSeriesSelectionGeneration.current += 1;
    setNewSeriesDirectory('');
    setNewSeriesReference(null);
    setNewSeriesReferences([]);
    setNewSeriesReferenceCandidates([]);
    setNewSelectedSeriesReferencePaths([]);
    setNewSeriesDirectorySelecting(false);
    setNewSeriesDirectoryMessage('');
    setNewSeriesReferenceSelecting(false);
    setNewSeriesReferenceMessage('');
  };

  const setNewCharacterDocument = (next: MangaDocument | null) => {
    newCharacterDocumentRef.current = next;
    setNewCharacterDocumentState(next);
  };

  const getOmnySnapshot = useCallback(() => toSeparatedMangaYaml(documentRef.current), []);
  const coverageWorkspace = boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id
    && boundSourceSnapshot?.episodeId === document.manga.meta.episode_id
    && boundSourceSnapshot.workspaceDirectory === boundEpisodeWorkspace.directory
    ? boundEpisodeWorkspace
    : null;
  const page = document.manga.pages[activePage];
  const panel = page?.panels[activePanel];
  const materialLinkPanel = materialLinkTarget
    ? document.manga.pages[materialLinkTarget.pageIndex]?.panels[materialLinkTarget.panelIndex]
    : undefined;
  const panelFrameLineWidthMm = document.manga.meta.panel_frame_width_mm;
  const bubbleLineWidthMm = document.manga.meta.bubble_line_width_mm;
  const selectedBubbleTarget:CanvasTextTarget|undefined=!paintSession&&!textTool&&!zoomTool&&selectedElement?.type==='bubble'
    ?{pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:'bubble'}:undefined;
  const selectedBubble=selectedBubbleTarget?canvasTextAt(document,selectedBubbleTarget) as Bubble|undefined:undefined;
  const selectedBubbleStroke=selectedBubble&&selectedBubbleTarget?{
    width:bubbleStrokeWidthMm(selectedBubble,bubbleLineWidthMm)*getPrintSetup(document.manga).dpi/25.4,
    disabled:layerSwitchBusy||!canvasBubbleLineWidthEditable(document,selectedBubbleTarget),onChange:(width:number)=>changeSelectedBubbleLineWidth(width),
  }:undefined;
  const panelGutters = {
    rowGapMm: document.manga.meta.panel_gutter_row_mm,
    columnGapMm: document.manga.meta.panel_gutter_column_mm,
  };
  // 見開きは選択状態で組み替えず、右綴じの固定ペア（1+2、3+4…）を保つ。
  const spreadPartnerIndex = findSpreadPartnerIndex(activePage, document.manga.pages.length, spreadView);

  useEffect(() => {
    if (boundEpisodeWorkspace && boundEpisodeWorkspace.episodeId !== document.manga.meta.episode_id) {
      setBoundEpisodeWorkspace(null);
    }
  }, [document.manga.meta.episode_id, boundEpisodeWorkspace]);

  useEffect(() => {
    if (boundSourceSnapshot && boundSourceSnapshot.episodeId !== document.manga.meta.episode_id) {
      setBoundSourceSnapshot(null);
      setSourceCoverageDecisions([]);
    }
  }, [document.manga.meta.episode_id, boundSourceSnapshot]);

  const setDocument = (next: MangaDocument, record=true) => {
    next.manga.meta.page_count = next.manga.pages.length;
    synchronizeCatalogReferences(next);
    reconcileSplitOverlapFlags(next);
    const now = Date.now();
    if (record && (imageGesture.current.active ? !imageGesture.current.pushed : now - lastHistoryPush.current > 800)) {
      timeline.current.record(workspaceSnapshot());changedHistory();
      lastHistoryPush.current = now;
      if (imageGesture.current.active) imageGesture.current.pushed = true;
    }
    if(record&&timeline.current.future.length){timeline.current.record(workspaceSnapshot());changedHistory();}
    documentRef.current = next;
    setDocumentState(next);
    setHasDocument(true);
  };

  const replaceDocument = (next: MangaDocument) => {
    // The old indices must never clean up or edit objects in the incoming document.
    createdText.current=null;pendingCanvasElementSelection.current=null;setEditingText(null);imageGestureBoundary('end');
    next.manga.meta.page_count = next.manga.pages.length;
    synchronizeCatalogReferences(next);
    reconcileSplitOverlapFlags(next);
    timeline.current.clear();changedHistory();
    paintController.current=null;paintSessionRef.current=null;setPaintSession(null);
    lastHistoryPush.current = 0;
    documentRef.current = next;
    setDocumentState(next);
    setHasDocument(true);
  };

  const restoreDocument = (target: MangaDocument) => {
    endTextEdit();
    synchronizeCatalogReferences(target);
    reconcileSplitOverlapFlags(target);
    documentRef.current = target;
    setDocumentState(target);
    const pageIndex = Math.min(activePage, target.manga.pages.length - 1);
    setActivePage(pageIndex);
    const panelIndex = Math.min(activePanel, Math.max(0, (target.manga.pages[pageIndex]?.panels.length ?? 1) - 1));
    setActivePanel(panelIndex);
    setSelectedPanels([panelIndex]);
    setSelectedElement(null);
    lastHistoryPush.current = 0;
  };

  const patchLatestDocument = (recipe: (draft: MangaDocument) => boolean | void): MangaDocument => {
    const next = cloneDocument(documentRef.current);
    if (recipe(next) === false) return documentRef.current;
    setDocument(next);
    return next;
  };

  const finalizeDeletedSeriesMaterial = (catalogId: string, seriesId: string) => {
    const belongsToOperation = (source: MangaDocument) => source.manga.meta.series_id === seriesId;
    const withoutDeletedMaterial = (source: MangaDocument) => (
      belongsToOperation(source) ? removeMaterialsFromSeriesCatalog(source, [catalogId]) : source
    );
    const latest = documentRef.current;
    if (belongsToOperation(latest)) {
      const next = withoutDeletedMaterial(latest);
      documentRef.current = next;
      setDocumentState(next);
    }
    timeline.current.map(snapshot=>({...snapshot,document:withoutDeletedMaterial(snapshot.document)}));changedHistory();
  };

  const restoreWorkspace = (snapshot:WorkspaceSnapshot) => {
    restoreDocument(snapshot.document);
    const paint=snapshot.paint;
    paintController.current=null;pendingLayerAction.current=null;
    if(paint){
      const session:WorkspacePaintSession={document:snapshot.document,pageIndex:paint.pageIndex,panelIndex:paint.panelIndex,overlay:paint.overlay,title:paint.title,scene:{...paint.state.scene},resume:paint.state};
      paintSessionRef.current=session;setPaintSession(session);
      setActivePage(paint.pageIndex);setActivePanel(paint.panelIndex);setSelectedPanels([paint.panelIndex]);setTab('storyboard');setTextTool(false);setZoomTool(false);
    }else{
      paintSessionRef.current=null;setPaintSession(null);
      const text=snapshot.textSelection;
      if(text&&canvasTextAt(snapshot.document,text)){
        selectCanvasElement({type:text.kind,index:text.index,...(text.overlay?{scope:'page_overlay' as const}:{})},text.panelIndex,text.pageIndex,false);
        setSelectedPanels([text.panelIndex]);
      }
    }
    changedHistory();
  };
  const historyAvailable=()=>!projectOperation.current&&!layerSwitch.current&&!imageImportBusy&&!qwenGeneration&&(!paintSessionRef.current||paintController.current?.canRestore()!==false);
  const undo = () => {
    if(!historyAvailable())return;
    const target=timeline.current.undo(workspaceSnapshot());if(!target)return;
    restoreWorkspace(target);setToast('作業を元に戻しました');
  };
  const redo = () => {
    if(!historyAvailable())return;
    const target=timeline.current.redo(workspaceSnapshot());if(!target)return;
    restoreWorkspace(target);setToast('作業をやり直しました');
  };

  const { closeNewDialog, discardNewCharacterDraft, commitNewCharacterDraft, discardScannerSources, discardNewLayoutItems, finishScannerWatching, detachActiveScannerSession, discardPendingScannerRecovery, commitActiveScannerSession, endNewCreationBridgeSession, openNewDialog } = createNewProjectSessions({
    newLayoutItemsRef, setNewLayoutItems, setNewLayoutActiveIndex, setNewLayoutMessage,
    setScannerReceivedCount, newLayoutImageInput, scannerSessionRef, setScannerSession,
    setPendingScannerSession, newCreationBridgeToken, newCharacterDraftSession,
    seriesCatalogSaveQueue, newLayoutTaskRef, newLayoutOperationGeneration, scannerStopRequested,
    updateNewLayoutTask, setToast, setNewCharacterDocument, setShowNewDialog, endTextEdit: () => endTextEdit(),
    setNewWorkTitle, setNewWorkSetting, setNewSettingMessage, setNewSeriesName, setNewSeriesId,
    clearNewSeriesReference, setNewEpisodeWorkspace, setNewWorkspaceSelecting, setNewWorkspaceMessage,
    setNewReferenceSelecting, setNewSourceSnapshot, setNewReferenceFileName, setNewReferenceMessage,
    setNewCharacterTextLink, setCharacterTextBusy, setNewSeriesMode, setNewCreationStep,
    setNewPrintSetup, setEditingNewPrintSetup, setNewPrintConfirmed, setNewSeriesPreparing,
    setSeriesCatalogMessage, setNewEpisodeNumber, setSeriesCatalogs,
  });

  const selectCanvasPanel = (index: number, additive = false) => {
    endTextEdit();
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

  const selectCanvasElement = (selection: CanvasElementSelection | null, panelIndex?: number, pageIndex = activePage, revealDetails = true) => {
    if(paintSessionRef.current&&pageIndex!==paintSessionRef.current.pageIndex){
      void layerTransition(async()=>{
        await paintController.current?.close();
        if(!paintSessionRef.current)selectCanvasElement(selection,panelIndex,pageIndex,revealDetails);
      });
      return;
    }
    if (selection) {
      setCanvasSelectionScrollRequest((current) => current + 1);
      const selectedBubble=selection.type==='bubble'?(selection.scope==='page_overlay'?documentRef.current.manga.pages[pageIndex]?.page_overlay:documentRef.current.manga.pages[pageIndex]?.panels[panelIndex??activePanel])?.bubbles?.[selection.index]:undefined;
      if ((selection.type === 'figure'||selectedBubble?.shape==='handwritten') && revealDetails) {
        setInspectorCollapsed(false);
        if (!paintSessionRef.current && window.matchMedia('(max-width: 800px)').matches) setMobileStoryboardPane('panel');
      }
    }
    if (pageIndex !== activePage || (panelIndex !== undefined && panelIndex !== activePanel)) {
      pendingCanvasElementSelection.current = selection;
      setActivePage(pageIndex);
      setActivePanel(panelIndex ?? 0);
      setSelectedPanels([panelIndex ?? 0]);
    }
    setSelectedElement(selection);
  };

  const mergeSelectedPanelGroup = () => {
    if (selectedPanels.length < 2) {
      setToast('Shift+クリックで合体するコマを2つ以上選択してください');
      return;
    }
    if(selectedPanels.some(index=>page?.panels[index]&&panelGeometryLocked(page.panels[index]))){
      setToast('固定中のコマは合体できません');
      return;
    }
    endTextEdit();
    const next = cloneDocument(documentRef.current);
    const mergedIndex = mergeSelectedPanels(next.manga.pages[activePage], selectedPanels);
    if (mergedIndex === null) return;
    setDocument(next);
    setActivePanel(mergedIndex);
    setSelectedPanels([mergedIndex]);
    setSelectedElement(null);
    setToast(`${selectedPanels.length}コマを吹き出しごと合体しました`);
  };

  const splitActivePanel = () => {
    if (!page || !panel) return;
    if(panelGeometryLocked(panel)){setToast('固定中のコマは分割できません');return;}
    endTextEdit();
    const next = cloneDocument(documentRef.current);
    const splitIndices = splitPanel(next.manga.pages[activePage], activePanel, panelSplitDirection, panelGutters);
    if (!splitIndices) {
      setToast('このコマは現在の間隔幅では小さすぎるため分割できません');
      return;
    }
    setDocument(next);
    setActivePanel(splitIndices[0]);
    setSelectedPanels(splitIndices);
    setSelectedElement(null);
    setToast(panelSplitDirection === 'vertical' ? 'コマをタテに分割しました' : 'コマをヨコに分割しました');
  };

  const prunePaintAssets = () => {
    void pruneFigureCropAssets([],() => {
      const snapshots:WorkspaceSnapshot[]=[workspaceSnapshot(),...timeline.current.past,...timeline.current.future];
      if(newCharacterDocumentRef.current)snapshots.push({document:newCharacterDocumentRef.current});
      return [...pendingPaintAssets.current,...browserCatalogImageIds(),...snapshots.flatMap(snapshot=>[
        ...collectFigureCropAssetIds(snapshot.document,snapshot.paint?.state.scene.owners.flatMap(owner=>paintAssetIds(owner.paint))),
        ...(snapshot.paint?.state.imports.map(item=>item.asset.storageId)??[]),
        ...(snapshot.paint?.state.stageImports.map(item=>item.stage.storageId)??[]),
      ])];
    }).catch(() => undefined);
  };

  useEffect(() => onFigureCropAssetsChanged(prunePaintAssets), []);
  useEffect(() => {
    prunePaintAssets();
  }, [document, past, future, newCharacterDocument, paintSession, seriesCatalogSaving]);


  useEffect(() => {
    const pending = pendingCanvasElementSelection.current;
    pendingCanvasElementSelection.current = null;
    setSelectedElement(pending);
  }, [activePage, activePanel]);

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
    newLayoutOperationGeneration.current += 1;
    window.clearTimeout(characterTextSyncTimer.current);
    const draftSession = newCharacterDraftSession.current;
    newCharacterDraftSession.current = null;
    if (draftSession) discardSeriesCatalogDraftOnPageExit(draftSession.token);
    const token = newCreationBridgeToken.current;
    newCreationBridgeToken.current = null;
    if (token) stopNewCreationBridgeSessionOnPageExit(token);
    const characterToken = characterEditorBridgeToken.current;
    characterEditorBridgeToken.current = null;
    if (characterToken) stopNewCreationBridgeSessionOnPageExit(characterToken);
    // 強制終了・再読み込みではbridge側の復旧記録と元スキャンを残す。
    // 起動管理用の利用権だけを返し、元画像は明示的に閉じた場合だけ削除する。
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if(event.isComposing)return;
      if (qwenGeneration || environmentOpen || imageExportDialog) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault();
        void saveProjectAction.current();
        return;
      }
      if(hasDocument&&tab==='storyboard'&&!showNewDialog&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&(key==='t'||key==='z')&&!(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))){event.preventDefault();if(key==='z')chooseZoomTool();else chooseTextTool();return;}
      if (paintSession) return;
      if (key === 'escape' && showNewDialog) { closeNewDialog(); return; }
      const target = event.target as HTMLElement | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
      if(tab==='storyboard'&&!showNewDialog&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&(key==='delete'||key==='backspace')){
        if(selectedElement?.type==='bubble'){
          event.preventDefault();
          deleteBubbleAt(activePanel,selectedElement.index,selectedElement.scope==='page_overlay');
        }else if(!selectedElement&&document.manga.pages[activePage]?.panels[activePanel]){
          event.preventDefault();
          deletePanelAt(activePanel);
        }
        return;
      }
      if(tab==='storyboard'&&!showNewDialog&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&key==='f'){
        event.preventDefault();addDirectFolder(activePanel,selectedElement?.scope==='page_overlay');return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'm' && tab === 'storyboard' && !showNewDialog) {
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
  }, [document, past, future, paintSession, qwenGeneration, showNewDialog, pendingScannerSession, newLayoutItems.length, newLayoutActiveIndex, newLayoutTask, selectedPanels, selectedElement, activePage, activePanel, tab, environmentOpen, imageExportDialog]);

  const changeTab = (next: WorkspaceTab) => {
    const change=()=>{
      if (materialLinkTarget) {
        const expectedTab = materialLinkTarget.materialType === 'background' ? 'setting' : 'props';
        if (next !== expectedTab) setMaterialLinkTarget(null);
      }
      setTab(next);
      if (next !== 'storyboard' && window.innerWidth < 800) setSidebarCollapsed(true);
    };
    if(paintSession){void paintController.current?.close().then(change).catch(error=>setToast(error instanceof Error?error.message:'画面を切り替えられませんでした'));return;}
    change();
  };
  const mutate = (recipe: (draft: MangaDocument) => void) => { const next = cloneDocument(document); recipe(next); setDocument(next); };

  // Also repair a project already open while the development UI is hot-reloaded.
  useEffect(() => {
    const next = cloneDocument(document);
    const restored = restoreProvisionalScenarioText(next);
    const detached = detachResolvedScenarioLinks(next);
    if (restored || detached) setDocument(next);
  }, []);

  const chooseScenarioBubble = (location: ScenarioBubbleLocation, sourceIds: readonly string[] | null) => {
    const currentPage=documentRef.current.manga.pages[location.pageIndex],currentPanel=location.overlay?undefined:currentPage?.panels[location.panelIndex];
    const currentBubble=location.overlay?currentPage?.page_overlay?.bubbles?.[location.bubbleIndex]:currentPanel?.bubbles[location.bubbleIndex];
    if(!currentBubble||ownerItemLocked(currentBubble)||(currentPanel&&panelLocked(currentPanel)))return;
    mutate((draft) => {
      if (sourceIds) confirmScenarioCorrespondence(draft, location, sourceIds);
      else {
        const page = draft.manga.pages[location.pageIndex];
        const bubble = location.overlay ? page?.page_overlay?.bubbles?.[location.bubbleIndex] : page?.panels[location.panelIndex]?.bubbles[location.bubbleIndex];
        if (bubble) rejectScenarioCorrespondence(bubble);
      }
    });
  };

  const openMaterialsForPanel = (materialType: PanelMaterialLinkTarget['materialType']) => {
    if (!page || !panel || panelLocked(panel)) return;
    setMaterialLinkTarget({ pageIndex: activePage, panelIndex: activePanel, materialType });
    setSelectedElement(null);
    setTab(materialType === 'background' ? 'setting' : 'props');
    if (window.innerWidth < 800) setSidebarCollapsed(true);
  };

  const toggleMaterialForPanel = (materialKey: string, linked: boolean) => {
    if (!materialLinkTarget) return;
    mutate((draft) => {
      const target=draft.manga.pages[materialLinkTarget.pageIndex]?.panels[materialLinkTarget.panelIndex];
      if(!target||panelLocked(target))return;
      setPanelMaterialLink(draft, materialLinkTarget, materialKey, linked);
    });
  };

  const returnFromMaterials = () => {
    const target = materialLinkTarget;
    setMaterialLinkTarget(null);
    if (target) {
      const targetPage = document.manga.pages[target.pageIndex];
      if (targetPage) {
        const targetPanelIndex = Math.min(target.panelIndex, Math.max(0, targetPage.panels.length - 1));
        setActivePage(target.pageIndex);
        setActivePanel(targetPanelIndex);
        setSelectedPanels([targetPanelIndex]);
      }
    }
    setSelectedElement(null);
    setTab('storyboard');
    setMobileStoryboardPane('panel');
  };

  const { workspaceRootKey, createNewCharacterDraft, mergeSavedSeriesCatalog, selectExistingSeries } = createSeriesSelection({
    newWorkTitle, newEpisodeNumber, newLayoutFrameLineWidthMm, newLayoutRowGapMm,
    newLayoutColumnGapMm, newSeriesMode, newSeriesId, newSeriesSelectionGeneration, seriesCatalogs,
    clearNewReferenceText, setNewEpisodeWorkspace, setNewWorkspaceMessage, setNewSeriesId,
    setNewSeriesName, setNewSeriesDirectory, setNewSeriesReference, setNewSeriesReferences,
    setNewSeriesReferenceCandidates, setNewSelectedSeriesReferencePaths, setNewSeriesReferenceMessage,
    setNewCharacterTextLink, setSeriesCatalogMessage, setNewSeriesPreparing, setNewWorkSetting,
  });

  const { chooseLocalText, chooseNewSeriesDirectory, chooseNewSeriesReferenceTextFile, removeSelectedNewSeriesReferences, applySelectedNewSeriesReferences, chooseNewEpisodeWorkspace } = createSeriesReferenceActions({
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
  });

  const { choosePanelDraftWorkspace, setCoverageSource, chooseCoverageWorkspaceSource, chooseCoverageWorkspace, saveCoverageReport, chooseNewReferenceTextFile, chooseNewCharacterImageFiles, chooseNewLayoutImageFiles } = createWorkspaceSourceActions({
    setToast, documentRef, setBoundEpisodeWorkspace, boundEpisodeWorkspace, setBoundSourceSnapshot,
    boundSourceSnapshot, setSourceCoverageDecisions, coverageWorkspace, newCreationBridgeToken,
    characterEditorBridgeToken, newEpisodeWorkspace, setNewReferenceMessage, setNewReferenceSelecting,
    readNewReferenceFile: selection => readNewReferenceFile(selection), newReferenceFileName, newLayoutTask,
    newLayoutImageInput, chooseNewLayoutImages: files => chooseNewLayoutImages(files), setNewLayoutMessage,
  });

  const { patchNewCharacterDocument, returnToSeriesSelection, continueFromSeriesSelection } = createSeriesPreparation({
    newSeriesPreparing, newEpisodeWorkspace, setNewWorkspaceMessage, newSeriesMode,
    createNewCharacterDraft, setNewSeriesName, setNewSeriesId, setNewCharacterDocument,
    setNewCharacterTextLink, setNewCreationStep, newSeriesName, setSeriesCatalogMessage, newSeriesId,
    seriesCatalogs, setNewSeriesPreparing, mergeSavedSeriesCatalog, newSeriesReferences,
    newSeriesReference, setNewWorkSetting, newCharacterDraftSession, newCharacterDocumentRef,
    seriesCatalogSaving, discardNewCharacterDraft, setToast,
  });

  const { syncCharacterText, persistNewCharacterCatalog, persistSeriesCatalog, linkCharacterText, deleteSeriesCharacter, restoreDeletedCharacter } = createSeriesCatalogActions({
    showNewDialog, seriesCatalogPendingCount, setSeriesCatalogSaving, seriesCatalogSaveQueue,
    documentRef, newSeriesDirectory, newEpisodeWorkspace, newSeriesReference, setNewCharacterDocument,
    newCreationBridgeToken, characterEditorBridgeToken, setToast, chooseLocalText,
    setCharacterTextBusy,
  });

  useEffect(() => {
    if (isLanClient || showNewDialog || tab !== 'characters') return;
    const seriesId = document.manga.meta.series_id;
    if (!document.manga.meta.series.trim() || !seriesId) {
      setCharacterTextLink(null);
      return;
    }
    let ignored = false;
    let leaseToken = '';
    void startNewCreationBridgeSession()
      .then(async (session) => {
        leaseToken = session.token;
        if (ignored) {
          await stopNewCreationBridgeSession(session.token).catch(() => undefined);
          return;
        }
        characterEditorBridgeToken.current = session.token;
        const status = await getSeriesCharacterTextStatus(seriesId);
        if (!ignored) setCharacterTextLink(status.linked || status.needsRelink || status.deletedCharacters.length ? status : null);
      })
      .catch(() => undefined);
    return () => {
      ignored = true;
      window.clearTimeout(characterTextSyncTimer.current);
      if (leaseToken && characterEditorBridgeToken.current === leaseToken) characterEditorBridgeToken.current = null;
      if (leaseToken) void stopNewCreationBridgeSession(leaseToken).catch(() => undefined);
    };
  }, [tab, document.manga.meta.series_id, showNewDialog]);

  useEffect(() => {
    window.clearTimeout(characterTextSyncTimer.current);
    const source = document;
    const link = characterTextLink;
    const shouldSync = !isLanClient && !showNewDialog && link?.linked
      && source.manga.meta.series_id === link.seriesId
      && tab === 'characters'
      && !characterTextBusy;
    if (!shouldSync) return;
    characterTextSyncTimer.current = window.setTimeout(() => {
      void syncCharacterText(source)
        .then((synced) => {
          if (!synced) return;
          setCharacterTextLink(synced);
        })
        .catch((error) => setToast(`人物テキストを同期できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`));
    }, 1200);
    return () => window.clearTimeout(characterTextSyncTimer.current);
  }, [document, characterTextLink?.linked, characterTextLink?.seriesId, showNewDialog, tab, characterTextBusy]);

  const { readNewReferenceFile, continueFromNewCharacters, applySuggestedReferenceTexts, saveNewCharacters, continueFromNewSetting, updateNewSeriesSetting, updateNewWorkSetting } = createEpisodeSettingActions({
    newCharacterDocumentRef, persistNewCharacterCatalog, newCharacterTextLink, syncCharacterText,
    setNewCharacterTextLink, commitNewCharacterDraft, newCharacterDraftSession, setToast,
    seriesCatalogSaving, setNewCharacterDocument, newSeriesMode, setNewWorkSetting,
    setNewCreationStep, setNewSettingMessage, patchNewCharacterDocument, setNewSourceSnapshot,
    newEpisodeWorkspace, setNewReferenceFileName, setNewSuggestedEpisodeReference,
    setNewReferenceMessage, setNewSeriesName, newSeriesReferences, setNewWorkTitle,
    setNewEpisodeNumber, newSuggestedEpisodeReference, newWorkSetting,
  });

  const { applyPreparedSeriesIdentifiers, importBackgroundModel, saveBackgroundsFromEditor, saveCharactersFromEditor } = createWorkspaceCatalogActions({
    documentRef, setDocument, endTextEdit: () => endTextEdit(), saveProjectAction, persistSeriesCatalog, characterTextLink,
    syncCharacterText, setCharacterTextLink, setToast, projectOperation, setProjectBusy,
    patchLatestDocument,
  });

  const { saveProject, exportOmny, openProject } = createProjectFileActions({
    hasDocument, showNewDialog, projectOperation, endTextEdit: () => endTextEdit(), documentRef, setToast, setProjectBusy,
    boundEpisodeWorkspace, paintController, persistSeriesCatalog, applyPreparedSeriesIdentifiers,
    paintSessionRef, setPaintSession, setBoundEpisodeWorkspace, replaceDocument,
    setBoundSourceSnapshot, setSourceCoverageDecisions, setActivePage, setActivePanel,
    setSelectedPanels, setSelectedElement, setTab, setMobileStoryboardPane, setDocument,
    saveProjectAction,
  });

  const { chooseNewLayoutImages, requestScannerFinish, launchScanner, updateNewLayoutGutter, updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans, rotateActiveLayoutImage, analyzeNewLayouts } = createNewLayoutImportActions({
    newLayoutTask, newLayoutOperationGeneration, updateNewLayoutTask, discardScannerSources,
    discardNewLayoutItems, newLayoutItemsRef, setNewLayoutItems, setNewLayoutActiveIndex,
    setNewLayoutMessage, newLayoutImageInput, setNewLayoutRowGapMm, setNewLayoutColumnGapMm,
    setNewLayoutFrameLineWidthMm, newLayoutTaskRef, newLayoutRowGapMm, newLayoutColumnGapMm,
    createNewDocument: (...args) => createNewDocument(...args), newLayoutActiveIndex,
    scannerStopRequested, scannerSessionRef, setScannerSession, setScannerReceivedCount,
    finishScannerWatching, detachActiveScannerSession, setPendingScannerSession,
    discardPendingScannerRecovery,
  });

  const { createNewDocument } = createNewProjectAction({
    newLayoutTaskRef, newLayoutOperationGeneration, newPrintConfirmed, editingNewPrintSetup,
    updateNewLayoutTask, newEpisodeWorkspace, setNewLayoutMessage, newLayoutItemsRef,
    newCharacterDocumentRef, persistAnalogAssets, newWorkTitle, commitActiveScannerSession,
    discardScannerSources, newPrintSetup, newLayoutRowGapMm, newLayoutColumnGapMm, newSeriesName,
    newSeriesId, newEpisodeNumber, newLayoutFrameLineWidthMm, newWorkSetting, mergeSavedSeriesCatalog,
    setNewCharacterReadProgress, newSourceSnapshot, newCharacterTextLink, syncCharacterText,
    setNewCharacterTextLink, commitNewCharacterDraft, endNewCreationBridgeSession, lastHistoryPush,
    replaceDocument, setBoundEpisodeWorkspace, setBoundSourceSnapshot, setSourceCoverageDecisions,
    setCharacterTextLink, setActivePage, setActivePanel, setSelectedPanels, setSelectedElement,
    setTab, setMobileStoryboardPane, setShowNewDialog, setNewCharacterDocument, discardNewLayoutItems,
    setToast,
  });

  const { deleteBubbleAt, deletePanelAt, addPanel, addPage, duplicatePage, deletePage, reorderPage, deleteScreenTextAt, deletePanel } = createPageEditActions({
    endTextEdit: () => endTextEdit(), mutate, setActivePage, setActivePanel, setSelectedPanels, setTab,
    setMobileStoryboardPane, page, activePage, activePanel, document, setToast, autoPaintResume,
    setSelectedElement, documentRef, layerTransition: action => layerTransition(action), paintSessionRef, paintController, createdText,
    lastHistoryPush, setDocument,
  });
  const { layerTransition, makePaintScene, openPaint, artworkGuideVisible, selectedPaintOwner, toggleArtworkGuide } = createWorkspacePaintSession({
    activePanel, activePage, document, paintSessionRef, paintController, documentRef,
    pendingLayerAction, selectedElement, imageImportBusy, qwenPreparing, endTextEdit: () => endTextEdit(), setTextTool,
    setZoomTool, setBubblePathTool, paintBleedPx, setMobileStoryboardPane, setPaintToolsCollapsed,
    setPaintLayersCollapsed, autoPaintResume, setPaintSession, setToast, layerSwitch,
    projectOperation, qwenGeneration, setLayerSwitchBusy,
  });
  const { endTextEdit, changeSelectedBubbleLineWidth, chooseZoomTool, chooseTextTool, screenTextPosition, openBubbleMaterials, requestPcFonts, chooseBubblePathTool, closeTextTool, chooseLayoutTool, startBubbleEdit, applyBubbleMaterial, changeTextToolStyle, changeCanvasTextStyle, startTextEdit, createScreenTextAt, wrapScreenText, finishElementMove, changeCanvasText, canvasTextHistory, changeSelectedTextCategory, changeSelectedTextBody } = useWorkspaceTextActions({
    localFontQuery, localFontSynced, localFontCatalog, setLocalFontFamilies, createdText, documentRef,
    setDocument, selectedElement, setSelectedElement, setEditingText,
    imageGestureBoundary: (...args) => imageGestureBoundary(...args), autoPaintResume,
    layerTransition, paintSessionRef, paintController, setTextTool, setZoomTool, setBubblePathTool,
    selectCanvasElement, setTextPaletteRequest, editingText, setPaintToolsCollapsed,
    setSelectedPanels, textToolStyle, imageGesture, lastHistoryPush, setTextToolStyle,
    projectOperation, qwenGeneration, setToast, selectedBubbleTarget, textTool, zoomTool, layerSwitch,
    undo, redo, setActivePage, setActivePanel, setBubbleMaterialsOpen, activePage, activePanel,
    selectCanvasPanel,
  });
  const { addDirectFolder, actOnLayer, toggleTextLayer, selectLayerOwner, reorderOwnerLayers, selectLayerPanel, togglePanelLayer, togglePanelLock, openPanelBackground3d } = createLayerPaletteActions({
    activePage, layerTransition, paintSessionRef, paintController, documentRef, autoPaintResume,
    endTextEdit, setTextTool, setZoomTool, setBubblePathTool, selectCanvasElement, lastHistoryPush,
    setDocument, setSelectedPanels, workspaceSnapshot, makePaintScene, timeline, changedHistory,
    setPaintSession, setActivePanel, setSelectedElement, pendingLayerAction, openPaint, paintBleedPx,
    persistPaintResults: (...args) => persistPaintResults(...args), setToast,
  });
  const { requestOwnerGeneration, prepareQwen, requestCompositionGeneration, requestTextGeneration } = createWorkspaceGeneration({
    paintController, documentRef, setVoiceOpen, qwenGenerationRef, paintSessionRef, setPaintSession,
    lastHistoryPush, setDocument, setQwenGeneration, artworkGuideVisible, selectedElement,
    activePanel, activePage, qwenPreparing, imageImportBusy, projectOperation, makePaintScene,
    selectedPaintOwner, setAgentWorkTarget, setToast, endTextEdit, screenTextPosition,
  });
  const { openImageExportDialog, chooseImageExportFolder, exportPageRange } = createImageExportActions({
    activePanelRef, endTextEdit, activePageRef, setImageExportError, setImageExportProgress,
    setImageExportDialog, imageExportBusy, setImageExportBusy, imageExportDirectory,
    setImageExportDirectory, imageExportDialog, documentRef, setToast,
  });
  const { persistPaintResults, applyPaint } = createWorkspacePaintResults({
    pendingPaintAssets, documentRef, paintSessionRef, setDocument, paintController, setPaintSession,
  });
  const { choosePlacedImage, importPlacedImage, chooseOwnerImage, insertQwenImage } = createImagePlacementActions({
    activePanel, activePage, documentRef, imageImportBusy, imageImportTarget, setActivePage,
    setActivePanel, setSelectedPanels, placedImageInput, selectedPaintOwner, selectedElement,
    projectOperation, qwenGeneration, paintSessionRef, paintController, setImageImportBusy,
    lastHistoryPush, setDocument, activePageRef, activePanelRef, setSelectedElement, setToast,
    setQwenGeneration,
  });
  const { imageGestureBoundary, togglePanelSync, toggleInnerFrameSnap, togglePanelGapSnap, changeShowGuides, changeSpreadView, selectPage, changePanelStyleNumber, changeElementBBox, changeBubbleTail, movePanel, resizePanel, movePanelVertex, movePanelEdge, movePageImageToPanel, changePersistAnalogAssets } = createWorkspaceCanvasActions({
    imageGesture, lastHistoryPush, panel, page, mutate, activePage, activePanel, setSelectedElement,
    innerFrameSnap, setInnerFrameSnap, panelGapSnap, setPanelGapSnap, panelSync, setPanelSync,
    setShowGuides, setSpreadView, setPersistAnalogAssets, documentRef, setDocument, paintSessionRef,
    layerTransition, paintController, setTab, setMobileStoryboardPane, endTextEdit, autoPaintResume,
    setActivePage, setActivePanel, setSelectedPanels,
  });
  const voiceRevision=(withHistory=true)=>JSON.stringify({document:documentRef.current,activePage,activePanel,selectedElement,selectedPanels,tab,
    innerFrameSnap,panelGapSnap,panelSync,showGuides,spreadView,showNewDialog,projectBusy,qwenGeneration:Boolean(qwenGeneration),textTool,zoomTool,editingText,canvasZoomPercent,
    paint:paintController.current?.snapshot(),paintInteraction:paintController.current?.interactionRevision?.(),dragging:imageGesture.current.active,
    past:withHistory?past.length:undefined,future:withHistory?future.length:undefined});
  const latestVoiceRevision=useRef(voiceRevision);latestVoiceRevision.current=voiceRevision;
  const { applyVoiceCommand, inspectAgent, applyAgentBubbleEdit } = createWorkspaceVoiceActions({
    hasDocument, showNewDialog, historyAvailable, paintSessionRef, editingText, imageGesture,
    documentRef, agentRevision, voiceRevision, activePage, activePanel, selectedElement,
    workspaceSnapshot, setDocument, timeline, lastHistoryPush, changedHistory, projectOperation,
    layerSwitch, imageImportBusy, qwenGeneration, paintController, openBubbleMaterials, saveProject,
    past, future, undo, redo, panelSync, innerFrameSnap, panelGapSnap, showGuides, spreadView,
    togglePanelSync, toggleInnerFrameSnap, togglePanelGapSnap, changeShowGuides, changeSpreadView,
    latestVoiceRevision, environmentOpen, closeEnvironmentSettings, requestOwnerGeneration, document,
    selectPage, mutate,
  });
  const activeLayoutItem = newLayoutItems[newLayoutActiveIndex] ?? null;
  const newSeriesReferenceRows = newSeriesReferenceCandidates.length ? newSeriesReferenceCandidates : newSeriesReferences;
  const selectedNewSeriesReferenceRows = newSeriesReferenceRows.filter(reference => newSelectedSeriesReferencePaths.includes(reference.relativePath));
  const newSeriesReferenceBusy = newSeriesReferenceSelecting || newSeriesDirectorySelecting || newSeriesPreparing || newWorkspaceSelecting;
  const hasScannedLayoutItems = newLayoutItems.some((item) => item.source === 'scanner');

  const autoPaintBoundary=(event:Event)=>{
    if(!(event.target instanceof Element))return;
    if(event.target.closest('[data-paint-canvas]')){
      const pending=autoPaintResume.current;
      if(!pending||paintSessionRef.current||autoPaintTransition.current||layerSwitch.current||projectOperation.current||imageImportBusy||qwenGeneration||tab!=='storyboard')return;
      if(pending.pageIndex!==activePage||pending.panelIndex!==activePanel){autoPaintResume.current=null;return;}
      autoPaintResume.current=null;
      openPaint(pending.ownerKey,pending.panelIndex,pending.pageIndex,pending.overlay);
      return;
    }
    if(!event.target.closest('.inspector-content'))return;
    const session=paintSessionRef.current,controller=paintController.current;
    if(!session||!controller||autoPaintTransition.current||layerSwitch.current||projectOperation.current||imageImportBusy||qwenGeneration)return;
    const ownerKey=controller.snapshot().ownerKey||session.initialOwner||'background';
    autoPaintResume.current={pageIndex:session.pageIndex,panelIndex:session.panelIndex,overlay:session.overlay,ownerKey};
    autoPaintTransition.current=true;layerSwitch.current=true;setLayerSwitchBusy(true);
    void controller.close().catch(error=>{autoPaintResume.current=null;setToast(error instanceof Error?error.message:'描画を確定できませんでした');}).finally(()=>{
      autoPaintTransition.current=false;layerSwitch.current=false;setLayerSwitchBusy(false);
    });
  };
  useEffect(()=>{
    const pending=autoPaintResume.current;
    if(pending&&(tab!=='storyboard'||pending.pageIndex!==activePage||pending.panelIndex!==activePanel))autoPaintResume.current=null;
  },[tab,activePage,activePanel]);

  const guardDuringPaint=(event:Event)=>{
    if(!paintSession||!(event.target instanceof Element)||!event.target.closest('.workspace-tabs,.app-header,.page-list,.add-page-button,.sidebar-tools,.canvas-toolbar-actions,.page-switcher,.inspector-content,.mobile-storyboard-tabs'))return;
    if(event instanceof KeyboardEvent&&(event.key==='Tab'||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s')))return;
    if(!projectOperation.current&&!layerSwitch.current&&(event.target.closest('.page-switcher')||event.target.closest('.page-card')&&!event.target.closest('.page-move')))return;
    if(!projectOperation.current&&event.target.closest('[data-project-save],[data-project-history],[data-environment-settings],[data-voice-command],.guide-display-control,.panel-snap-setting,.workspace-tabs'))return;
    event.preventDefault();event.stopPropagation();
    if(event.type==='click')setToast(autoPaintTransition.current?'描画を確定しています。完了後に操作してください':'描画を確定してから操作してください');
  };

  const environmentSettings = <EnvironmentSettings
    initialTab={paintSession?'drawing':undefined}
    prepareDocumentSettings={async()=>{if(paintSessionRef.current)await paintController.current?.close();}}
    document={document}
    onChangeDocument={setDocument}
    onNotify={setToast}
    hasDocument={hasDocument && !showNewDialog}
    onExportOmny={exportOmny}
    agentProfile={agentProfile} onChangeAgentProfile={changeAgentProfile}
    onOpenAgent={()=>setVoiceOpen(true)}
    editGuide={editGuide} onChangeEditGuide={value=>{try{setEditGuide(saveEditGuide(localStorage,value));}catch{setToast('編集ガイドの設定を保存できません');}}}
    showGuides={showGuides}
    spreadView={spreadView}
    pageCount={document.manga.pages.length}
    frameLineWidthMm={document.manga.meta.panel_frame_width_mm}
    rowGapMm={document.manga.meta.panel_gutter_row_mm}
    columnGapMm={document.manga.meta.panel_gutter_column_mm}
    onChangeShowGuides={changeShowGuides}
    onChangeSpreadView={changeSpreadView}
    onChangeFrameLineWidth={(value) => changePanelStyleNumber('panel_frame_width_mm', value)}
    onChangeRowGap={(value) => changePanelStyleNumber('panel_gutter_row_mm', value)}
    onChangeColumnGap={(value) => changePanelStyleNumber('panel_gutter_column_mm', value)}
    fontFamilies={localFontFamilies}
    onRequestFonts={()=>void requestPcFonts()}
    saveDirectory={isLanClient ? boundEpisodeWorkspace?.folderName : boundEpisodeWorkspace?.directory}
    projectBusy={projectBusy}
    historySteps={historySteps} onChangeHistorySteps={changeHistorySteps}
    paintSmoothing={paintSmoothing}
    onChangePaintSmoothing={value=>{try{setPaintSmoothing(savePaintSmoothing(localStorage,value));}catch(error){setToast(String(error));}}}
    paintCursorMode={paintCursorMode}
    onChangePaintCursorMode={value=>{try{savePaintCursor(localStorage,value);setPaintCursorMode(value);}catch{setToast('ペンカーソルの設定を保存できません');}}}
    paintBleedPx={paintBleedPx}
    onChangePaintBleed={value=>{try{setPaintBleedPx(savePaintBleed(localStorage,value));}catch(error){setToast(error instanceof Error?error.message:'ぬりたしを保存できません');}}}
    onChangeSaveDirectory={() => saveProject(true)}
  />;

  return <PaintEditor onAddOutside={action=>{const s=paintSessionRef.current;if(!s)return;const page=documentRef.current.manga.pages[s.pageIndex],panel=page.panels[s.panelIndex];if(!panel)return;actOnLayer(s.panelIndex,{...action,key:'page',position:{stack:{beforePanel:`panel-${panel.id}`}}},makePaintScene(documentRef.current,s.panelIndex,s.pageIndex,true),true);}} selectedBubbleStroke={selectedBubbleStroke} resume={paintSession?.resume} resumeImages={paintSession?.images} historySteps={historySteps} sharedHistory={{checkpoint:recordPaint,undo,redo,canUndo:past.length>0,canRedo:future.length>0}} stages={namedBackgroundStages(document)} zoomTool={zoomTool} bubblePathTool={bubblePathTool} onSelectBubblePath={chooseBubblePathTool} toolPaletteEnabled={hasDocument&&tab==='storyboard'&&!showNewDialog} textTool={textTool} textTools={<PaintTextTools active={textTool} openRequest={textPaletteRequest} disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} select={chooseTextTool} onClose={closeTextTool} onMaterials={openBubbleMaterials} bubbleLineWidthMm={bubbleLineWidthMm} onChangeBubbleLineWidth={value=>changePanelStyleNumber('bubble_line_width_mm',value)}/>} panelTools={<PanelControls disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} hasPanel={Boolean(panel)} onAdd={addPanel} painting={Boolean(paintSession)} innerFrameSnap={innerFrameSnap} panelGapSnap={panelGapSnap} panelSync={panelSync} onToggleInnerFrameSnap={toggleInnerFrameSnap} onTogglePanelGapSnap={togglePanelGapSnap} onTogglePanelSync={togglePanelSync} selectedCount={selectedPanels.length} onMerge={mergeSelectedPanelGroup} splitDirection={panelSplitDirection} onSplitDirection={setPanelSplitDirection} onSplit={splitActivePanel}/>} onStartPaint={()=>{endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);return Boolean(paintSessionRef.current)||openPaint();}} onSelectLayout={chooseLayoutTool} onToggleBubble={(index,group)=>{const s=paintSessionRef.current;if(s)toggleTextLayer({pageIndex:s.pageIndex,panelIndex:s.panelIndex,index,overlay:s.overlay,kind:'bubble'},group);}} onSelectOwner={(key,native)=>{const s=paintSessionRef.current;if(s)selectLayerOwner(key,s.panelIndex,s.pageIndex,s.overlay,native);}} onSelectFigure={index=>{const s=paintSessionRef.current;if(s)selectCanvasElement({type:'figure',index,...(s.overlay?{scope:'page_overlay' as const}:{})},s.panelIndex,s.pageIndex);}} onReorderOwners={(key,target,after)=>{const session=paintSessionRef.current;if(session)reorderOwnerLayers(session.panelIndex,key,target,after,session.overlay);}} embeddedLayers onReady={()=>{const action=pendingLayerAction.current;pendingLayerAction.current=null;if(action)paintController.current?.layerAction(action);}} onEditText={index=>{const s=paintSessionRef.current;if(s)startBubbleEdit({pageIndex:s.pageIndex,panelIndex:s.panelIndex,bubbleIndex:index,overlay:s.overlay});}} controller={paintController} smoothing={paintSmoothing} cursorMode={paintCursorMode} guideVisible={key=>artworkGuideVisible(key,paintSession?.panelIndex,paintSession?.pageIndex,paintSession?.overlay)} onToggleGuide={key=>toggleArtworkGuide(key,paintSession?.panelIndex,paintSession?.pageIndex,paintSession?.overlay)} initial={paintSession?.scene} initialOwner={paintSession?.initialOwner} assets={document.manga.image_assets??[]} title={paintSession?.title??''} page={paintSession?document.manga.pages[paintSession.pageIndex].page:0} panelIndex={paintSession?.panelIndex??-1} overlay={paintSession?.overlay??false} suspended={Boolean(qwenGeneration)||projectBusy||environmentOpen||layerSwitchBusy} onGenerate={(owner,images,pendingAssets)=>{const session=paintSessionRef.current;return session?prepareQwen(session.document,session.pageIndex,session.panelIndex,session.overlay,owner,images,pendingAssets):Promise.reject(new Error('描画先が見つかりません'));}} onApply={applyPaint} onClose={()=>{pendingLayerAction.current=null;paintSessionRef.current=null;setPaintSession(null);}}>
    <PaintToolHelp enabled={editGuide}/><div class={`app-shell ${hasDocument ? '' : 'is-startup'} ${paintSession?'is-painting':''} ${showNewDialog ? 'is-creating' : ''} ${environmentOpen ? 'is-environment-open' : ''}`} onPointerOverCapture={autoPaintBoundary} onFocusCapture={autoPaintBoundary} onKeyDown={environmentKeyDown} onClickCapture={guardDuringPaint} onPointerDownCapture={guardDuringPaint} onKeyDownCapture={guardDuringPaint} onInputCapture={guardDuringPaint} onPasteCapture={guardDuringPaint}>
    <Header onSettings={toggleEnvironmentSettings} settingsOpen={environmentOpen} workspaceBlocked={environmentOpen || showNewDialog || Boolean(imageExportDialog)} hasDocument={hasDocument} busy={projectBusy||imageImportBusy||imageExportBusy} saveDirectory={isLanClient ? boundEpisodeWorkspace?.folderName : boundEpisodeWorkspace?.directory} canUndo={hasDocument && past.length > 0} canRedo={hasDocument && future.length > 0} onUndo={undo} onRedo={redo}
      onImportImage={()=>{void layerTransition(async()=>{if(paintSessionRef.current)await paintController.current?.close();endTextEdit();choosePlacedImage('page');});}}
      onExportImage={()=>{void layerTransition(async()=>{if(paintSessionRef.current)await paintController.current?.close();endTextEdit();openImageExportDialog();});}}
      onNew={openNewDialog} onOpen={openProject} onSave={() => saveProject()} />
    <input ref={placedImageInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => void importPlacedImage(event.currentTarget.files?.[0])} />
    {imageExportDialog&&<div class="image-export-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget&&!imageExportBusy)setImageExportDialog(null);}}>
      <section class="image-export-dialog" role="dialog" aria-modal="true" aria-labelledby="image-export-title" onKeyDown={event=>{if(event.key==='Escape'&&!imageExportBusy){event.preventDefault();setImageExportDialog(null);}}}>
        <header><h2 id="image-export-title">画像を書き出す</h2><button type="button" class="icon-button" aria-label="閉じる" disabled={imageExportBusy} onClick={()=>setImageExportDialog(null)}><X size={18}/></button></header>
        <fieldset disabled={imageExportBusy}><legend>ページ</legend>
          <label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='current'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'current'})}/>現在のページ <span class="image-export-muted">（{activePage+1}）</span></label>
          <div class="image-export-range-choice"><label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='range'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'range'})}/>範囲</label><input aria-label="開始ページ" type="number" min="1" max={document.manga.pages.length} value={imageExportDialog.from} disabled={imageExportDialog.mode!=='range'||imageExportBusy} onInput={event=>setImageExportDialog({...imageExportDialog,from:event.currentTarget.valueAsNumber})}/><span>〜</span><input aria-label="終了ページ" type="number" min="1" max={document.manga.pages.length} value={imageExportDialog.to} disabled={imageExportDialog.mode!=='range'||imageExportBusy} onInput={event=>setImageExportDialog({...imageExportDialog,to:event.currentTarget.valueAsNumber})}/></div>
          <label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='all'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'all'})}/>全ページ <span class="image-export-muted">（{document.manga.pages.length}ページ）</span></label>
        </fieldset>
        <label class="image-export-field"><span>形式</span><select aria-label="書き出し形式" value={imageExportDialog.format} disabled={imageExportBusy} onChange={event=>setImageExportDialog({...imageExportDialog,format:event.currentTarget.value as ImageExportFormat})}><option value="png">PNG</option><option value="clip">CLIP STUDIO（.clip＋元データ）</option><option value="psd">PSD（統合画像）</option></select></label>
        <div class="image-export-field"><span id="image-export-folder-label">保存先</span><div class="image-export-destination"><span title={imageExportDirectory?.name}>{imageExportDirectory?.name??(canChooseImageExportDirectory()?'未選択':'ブラウザーの保存先')}</span>{canChooseImageExportDirectory()&&<button type="button" class="secondary-button" aria-label="保存先を選択" disabled={imageExportBusy} onClick={()=>void chooseImageExportFolder()}>{imageExportDirectory?'変更':'選ぶ'}</button>}</div></div>
        <p class="image-export-note">{imageExportDialog.format==='clip'?'CLIPと元データはZIPにまとめます。':'複数ページはZIPにまとめます。'}{!canChooseImageExportDirectory()&&'保存先の選択にはChrome／Edgeを使ってください。'}</p>
        {imageExportProgress&&<div class="image-export-progress" role="status" aria-live="polite"><div><span>{imageExportProgress.label}</span><span>{Math.round(imageExportProgress.value/imageExportProgress.max*100)}%</span></div><progress aria-label="書き出しの進行状況" value={imageExportProgress.value} max={imageExportProgress.max}/></div>}
        {imageExportError&&<p class="image-export-error" role="alert">{imageExportError}</p>}
        <footer><button type="button" class="secondary-button" disabled={imageExportBusy} onClick={()=>setImageExportDialog(null)}>キャンセル</button><button type="button" class="primary-button" disabled={imageExportBusy} onClick={()=>void exportPageRange()}><Download size={17}/>{imageExportBusy?'処理中…':'書き出す'}</button></footer>
      </section>
    </div>}
    <VoiceCommands onActivity={active=>setAgentWorkTarget(active&&selectedElement?{pageIndex:activePage,panelIndex:activePanel,selection:{...selectedElement}}:null)} generation={qwenGeneration?generationConversation:null} portalTarget={generationConversationHost??(environmentOpen?environmentAgentHost:null)} open={voiceOpen} onToggle={()=>setVoiceOpen(!voiceOpen)} profile={agentProfile} onChangeProfile={changeAgentProfile} revision={voiceRevision} apply={applyVoiceCommand} inspect={inspectAgent} edit={applyAgentBubbleEdit}/>
    {bubbleMaterialsOpen&&<BubbleMaterialPicker onClose={()=>setBubbleMaterialsOpen(false)} canApply={Boolean(selectedElement?.type==='bubble'&&!paintSession&&!projectBusy&&canvasTextEditable(document,{pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:'bubble',overlay:selectedElement.scope==='page_overlay'}))} onApply={id=>{if(selectedElement?.type==='bubble')applyBubbleMaterial({pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:'bubble',overlay:selectedElement.scope==='page_overlay'},id);}}/>}

    {hasDocument ? <>
    <nav inert={environmentOpen} class="workspace-tabs" aria-label="編集カテゴリ">
      {TABS.map((item) => <button class={tab === item.id ? 'is-active' : ''} aria-label={item.label} onClick={() => changeTab(item.id)} key={item.id}><item.icon size={17} /><span>{item.label}</span></button>)}
    </nav>

    <main inert={environmentOpen} class={`workspace-shell ${tab === 'storyboard' ? 'is-storyboard' : ''} mobile-pane-${mobileStoryboardPane}`}>
      <PageSidebar document={document} activePage={activePage} collapsed={sidebarCollapsed} onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} onSelectPage={selectPage} onAddPage={addPage} onDuplicatePage={duplicatePage} onDeletePage={deletePage} onReorderPage={reorderPage} />
      {tab==='storyboard'&&page&&<aside class={`paint-dock paint-tools-dock ${paintToolsCollapsed?'is-collapsed':''}`}>
        <div class="dock-content"><h3>ペンツール</h3><PaintTools/></div>
        <button class="dock-rail" aria-expanded={!paintToolsCollapsed} aria-label={paintToolsCollapsed?'ペンツールを開く':'ペンツールを閉じる'} onClick={()=>setPaintToolsCollapsed(!paintToolsCollapsed)}><span>ペン</span>{paintToolsCollapsed?'›':'‹'}</button>
      </aside>}


      <section class={`workspace-main ${tab === 'storyboard' ? 'has-mobile-storyboard-tabs' : ''}`}>
        {tab === 'storyboard' && <nav class="mobile-storyboard-tabs" aria-label="ネーム作業エリア" role="tablist">
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'pages'} aria-controls="mobile-pages-pane" class={mobileStoryboardPane === 'pages' ? 'is-active' : ''} onClick={() => { setSidebarCollapsed(false); setMobileStoryboardPane('pages'); }}><Files size={17} /><span>ページ</span></button>
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'editor'} aria-controls="mobile-editor-pane" class={mobileStoryboardPane === 'editor' ? 'is-active' : ''} onClick={() => setMobileStoryboardPane('editor')}><LayoutPanelTop size={17} /><span>ネーム編集</span></button>
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'panel'} aria-controls="mobile-panel-pane" class={mobileStoryboardPane === 'panel' ? 'is-active' : ''} onClick={() => setMobileStoryboardPane('panel')}><SlidersHorizontal size={17} /><span>コマ設定</span></button>
        </nav>}
        {tab === 'storyboard' && page && <div class={`storyboard-workspace ${inspectorCollapsed?'inspector-collapsed':''}`}>
          <div id="mobile-editor-pane" class="canvas-stage">
            <div class="canvas-toolbar">
              {paintSession&&<PaintStatus/>}
              <div class="page-switcher"><button aria-label="前のページ" onClick={() => selectPage(Math.max(0, activePage - 1))} disabled={activePage === 0}><ChevronLeft size={17} /></button><span><span class="page-switcher-label">PAGE </span><strong>{String(activePage + 1).padStart(2, '0')}</strong><span class="page-switcher-total"> / {String(document.manga.pages.length).padStart(2, '0')}</span></span><button aria-label="次のページ" onClick={() => selectPage(Math.min(document.manga.pages.length - 1, activePage + 1))} disabled={activePage === document.manga.pages.length - 1}><ChevronRight size={17} /></button></div>
            </div>
            {(() => {
              const leftIndex = spreadPartnerIndex===null?activePage:Math.max(activePage, spreadPartnerIndex);
              const activeCanvas = <MangaCanvas agentWorkTarget={agentWorkTarget?.pageIndex===activePage?agentWorkTarget:undefined} textToolStyle={textToolStyle} onTextToolStyle={changeTextToolStyle} pageIndex={activePage} spreadSide={spreadPartnerIndex===null?undefined:leftIndex===activePage?'left':'right'} onTextStyle={changeCanvasTextStyle} onBubbleMaterial={applyBubbleMaterial} onOpenBubbleMaterials={openBubbleMaterials} zoomTool={zoomTool} textTool={textTool} editingText={editingText?.pageIndex===activePage?editingText:null} onEditScreenText={(panelIndex,index,overlay=false)=>startTextEdit({pageIndex:activePage,panelIndex,index,kind:'screen_text',overlay})} onEditBubble={target=>startBubbleEdit({...target,pageIndex:activePage})} onCreateScreenTextAt={(panelIndex,point)=>createScreenTextAt(activePage,panelIndex,point)} onWrapScreenText={wrapScreenText} onFinishElementMove={(selection,panelIndex)=>finishElementMove(activePage,selection,panelIndex)} onText={changeCanvasText} onTextHistory={canvasTextHistory} onEndTextEdit={endTextEdit} painting={Boolean(paintSession)&&!textTool&&!zoomTool} paintTarget={paintSession?.pageIndex===activePage?{panelIndex:paintSession.panelIndex,overlay:paintSession.overlay}:undefined} guideVisible={(key,index,overlay)=>artworkGuideVisible(key,index,activePage,overlay)} onToggleGuide={(key,index,overlay)=>toggleArtworkGuide(key,index,activePage,overlay)} onGenerateComposition={(scope,index)=>void requestCompositionGeneration(scope,index,activePage)} onGenerateArtwork={(key,index,overlay)=>void requestOwnerGeneration(key,overlay,index,activePage)} dpi={getPrintSetup(document.manga).dpi} outputSize={getPrintSetup(document.manga)} onNotify={setToast} onReplaceArtwork={(index,figure,overlay,bubble)=>chooseOwnerImage(figure!==undefined?`figure-${figure}`:bubble!==undefined?`bubble-${bubble}`:'background',index,activePage,overlay)} imageAssets={document.manga.image_assets} onImageGesture={imageGestureBoundary} title={document.manga.meta.title} author={document.manga.meta.author} page={page} pageCount={document.manga.pages.length} zoomPercent={canvasZoomPercent} onZoomPercentChange={setCanvasZoomPercent} frameLineWidthMm={panelFrameLineWidthMm} bubbleLineWidthMm={bubbleLineWidthMm} defaultBubbleFont={document.manga.meta.font} fontFamilies={localFontFamilies} onRequestFonts={()=>void requestPcFonts()} activePanel={activePanel} selectedPanels={selectedPanels} selectedElement={selectedElement} showGuides={showGuides} innerFrameSnap={innerFrameSnap} panelGutters={panelGutters} panelGapSnap={panelGapSnap} panelSync={panelSync} onSelectPanel={selectCanvasPanel} onSelectElement={(selection, panelIndex, revealDetails) => selectCanvasElement(selection, panelIndex, activePage, revealDetails)} onChangeElementBBox={changeElementBBox} onChangeBubbleTail={changeBubbleTail} onMovePanel={movePanel} onResizePanel={resizePanel} onMoveVertex={movePanelVertex} onMovePanelEdge={movePanelEdge} />;
              const switchToPartner = (panelIndex = 0) => { if(spreadPartnerIndex!==null)void selectPage(spreadPartnerIndex,panelIndex); };
              const partnerCanvas = spreadPartnerIndex===null?null:<MangaCanvas textSettingsOwner={false} textToolStyle={textToolStyle} agentWorkTarget={agentWorkTarget?.pageIndex===spreadPartnerIndex?agentWorkTarget:undefined} pageIndex={spreadPartnerIndex} spreadSide={leftIndex===spreadPartnerIndex?'left':'right'} onTextStyle={changeCanvasTextStyle} onBubbleMaterial={applyBubbleMaterial} onOpenBubbleMaterials={openBubbleMaterials} zoomTool={zoomTool} textTool={textTool} editingText={editingText?.pageIndex===spreadPartnerIndex?editingText:null} onEditScreenText={(panelIndex,index,overlay=false)=>startTextEdit({pageIndex:spreadPartnerIndex,panelIndex,index,kind:'screen_text',overlay})} onEditBubble={target=>startBubbleEdit({...target,pageIndex:spreadPartnerIndex})} onCreateScreenTextAt={(panelIndex,point)=>createScreenTextAt(spreadPartnerIndex,panelIndex,point)} onWrapScreenText={wrapScreenText} onFinishElementMove={(selection,panelIndex)=>finishElementMove(spreadPartnerIndex,selection,panelIndex)} onText={changeCanvasText} onTextHistory={canvasTextHistory} onEndTextEdit={endTextEdit} painting={Boolean(paintSession)&&!textTool&&!zoomTool} paintTarget={paintSession?.pageIndex===spreadPartnerIndex?{panelIndex:paintSession.panelIndex,overlay:paintSession.overlay}:undefined} guideVisible={(key,index,overlay)=>artworkGuideVisible(key,index,spreadPartnerIndex,overlay)} onToggleGuide={(key,index,overlay)=>toggleArtworkGuide(key,index,spreadPartnerIndex,overlay)} onGenerateComposition={(scope,index)=>void requestCompositionGeneration(scope,index,spreadPartnerIndex)} onGenerateArtwork={(key,index,overlay)=>void requestOwnerGeneration(key,overlay,index,spreadPartnerIndex)} dpi={getPrintSetup(document.manga).dpi} outputSize={getPrintSetup(document.manga)} onNotify={setToast} onReplaceArtwork={(index,figure,overlay,bubble)=>chooseOwnerImage(figure!==undefined?`figure-${figure}`:bubble!==undefined?`bubble-${bubble}`:'background',index,spreadPartnerIndex,overlay)} imageAssets={document.manga.image_assets} title={document.manga.meta.title} author={document.manga.meta.author} page={document.manga.pages[spreadPartnerIndex]} pageCount={document.manga.pages.length} zoomPercent={canvasZoomPercent} onZoomPercentChange={setCanvasZoomPercent} frameLineWidthMm={panelFrameLineWidthMm} bubbleLineWidthMm={bubbleLineWidthMm} defaultBubbleFont={document.manga.meta.font} fontFamilies={localFontFamilies} onRequestFonts={()=>void requestPcFonts()} activePanel={-1} selectedPanels={[]} selectedElement={null} showGuides={showGuides} innerFrameSnap={innerFrameSnap} panelGutters={panelGutters} panelGapSnap={panelGapSnap} panelSync={panelSync} onSelectPanel={switchToPartner} onSelectElement={(selection, panelIndex, revealDetails) => selectCanvasElement(selection, panelIndex, spreadPartnerIndex, revealDetails)} onChangeElementBBox={() => {}} onChangeBubbleTail={() => {}} onMovePanel={() => {}} onResizePanel={() => {}} onMoveVertex={() => {}} onMovePanelEdge={() => {}} />;
              // 右綴じ: 若いページが右（flexの後ろ）に来る
              return <div class={`canvas-spread ${spreadPartnerIndex===null?'is-single-page':''}`}>
                <div class="canvas-spread-scroll">
                  <div class="canvas-spread-stage">
                    <div class="canvas-spread-pair">
                      <div class={`spread-pane ${leftIndex !== activePage ? 'is-spread-partner' : ''}`} >{leftIndex === activePage ? activeCanvas : partnerCanvas}</div>
                      {spreadPartnerIndex!==null&&<div class={`spread-pane ${leftIndex === activePage ? 'is-spread-partner' : ''}`} >{leftIndex === activePage ? partnerCanvas : activeCanvas}</div>}
                    </div>
                  </div>
                </div>
              </div>;
            })()}
          </div>
          {<aside class={`paint-dock paint-layers-dock ${paintLayersCollapsed?'is-collapsed':''}`}>
            <button class="dock-rail" aria-expanded={!paintLayersCollapsed} aria-label={paintLayersCollapsed?'レイヤーを開く':'レイヤーを閉じる'} onClick={()=>setPaintLayersCollapsed(!paintLayersCollapsed)}><span>レイヤー</span>{paintLayersCollapsed?'‹':'›'}</button>
            <div class="dock-content"><div class="paint-layer-settings"><PaintDetails/></div><PageLayerPalette expanded={!paintLayersCollapsed} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} onSelectText={(panelIndex,index,overlay)=>startTextEdit({pageIndex:activePage,panelIndex,index,overlay,kind:'screen_text'})} onDeleteText={deleteScreenTextAt} onToggleText={(panelIndex,index,overlay)=>toggleTextLayer({pageIndex:activePage,panelIndex,index,overlay,kind:'screen_text'})} onToggleBubble={(panelIndex,bubbleIndex,overlay=false,group=false)=>toggleTextLayer({pageIndex:activePage,panelIndex,index:bubbleIndex,overlay,kind:'bubble'},group)} onDeleteBubble={deleteBubbleAt} onReorderOwners={reorderOwnerLayers} page={page} activePanel={activePanel} assets={document.manga.image_assets??[]} dpi={getPrintSetup(document.manga).dpi} colorMode={paintColorMode(getPrintSetup(document.manga).format)} disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} onSelect={selectLayerPanel} onVisibility={togglePanelLayer} onLock={togglePanelLock} onDelete={deletePanelAt} onAddFolder={addDirectFolder} onAdd={(index,kind,overlay=false,position)=>{try{const scene=makePaintScene(documentRef.current,index,activePage,overlay);actOnLayer(index,{type:'add',key:overlay?'page':'panel',kind,position:position??{}},scene,overlay);}catch(error){setToast(error instanceof Error?error.message:'レイヤーを追加できませんでした');}}} onAction={actOnLayer} onEditText={(panelIndex,bubbleIndex,overlay=false)=>startBubbleEdit({pageIndex:activePage,panelIndex,bubbleIndex,overlay})} guideVisible={(key,index,overlay=false)=>artworkGuideVisible(key,index,activePage,overlay)} toggleGuide={(key,index,overlay=false)=>toggleArtworkGuide(key,index,activePage,overlay)}/></div>
          </aside>}
          <aside id="mobile-panel-pane" class={`inspector-pane ${inspectorCollapsed?'is-collapsed':''}`}>
            <button class="dock-rail" aria-expanded={!inspectorCollapsed} aria-label={inspectorCollapsed?'コマ情報を開く':'コマ情報を閉じる'} onClick={()=>setInspectorCollapsed(!inspectorCollapsed)}><span>コマ情報</span>{inspectorCollapsed?'‹':'›'}</button>
            <div class="inspector-content">
            {Boolean(page.images?.some(image=>!image.paintScope&&!image.bubbleOriginal)) && <PlacedImageList title="ページ画像（コマ外）" images={page.images} assets={document.manga.image_assets} busy={imageImportBusy}
              selectedIndex={selectedElement?.type === 'image' && selectedElement.scope === 'page' ? selectedElement.index : undefined}
              onSelect={index => setSelectedElement(index === null ? null : { type: 'image', scope: 'page', index })}
              onChange={images => { lastHistoryPush.current = 0; mutate(draft => { draft.manga.pages[activePage].images = images; }); lastHistoryPush.current = 0; }}
              onMoveToPanel={panel ? movePageImageToPanel : undefined} />}
            {(paintSession?paintSession.overlay:selectedElement?.scope === 'page_overlay') && page.page_overlay
            ? <PageOverlayInspector onTextCategory={changeSelectedTextCategory} onSelectedText={changeSelectedTextBody} onHandwrittenHistoryBoundary={()=>{lastHistoryPush.current=0;}} onGenerateText={(kind,index)=>void requestTextGeneration(kind,index,true,0)} generationBusy={Boolean(qwenGeneration)||imageImportBusy||projectBusy} painting={Boolean(paintSession)} pageIndex={activePage} onScenarioChoice={chooseScenarioBubble} manga={document.manga} panels={page.panels} overlay={page.page_overlay} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} onSelectElement={setSelectedElement} onChange={(nextOverlay) => mutate((draft) => {
              if (nextOverlay) draft.manga.pages[activePage].page_overlay = nextOverlay;
              else delete draft.manga.pages[activePage].page_overlay;
            })} />
            : <PanelInspector onTextCategory={changeSelectedTextCategory} onSelectedText={changeSelectedTextBody} onHandwrittenHistoryBoundary={()=>{lastHistoryPush.current=0;}} onGenerateText={(kind,index)=>void requestTextGeneration(kind,index,false,activePanel)} generationBusy={Boolean(qwenGeneration)||imageImportBusy||projectBusy} onOpenBackground3d={()=>openPanelBackground3d(activePanel)} imageImportBusy={imageImportBusy} panelDraftToolbarTarget={null} painting={Boolean(paintSession)} guideVisible={key=>artworkGuideVisible(key,activePanel,activePage,false)} onToggleGuide={key=>toggleArtworkGuide(key,activePanel,activePage,false)} onScenarioChoice={chooseScenarioBubble} manga={document.manga} panel={panel} pageIndex={activePage} panelIndex={activePanel} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} episodeWorkspaceToken={!isLanClient && boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.token : ''} episodeWorkspaceFolder={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.folderName : ''} seriesId={document.manga.meta.series_id} episodeId={document.manga.meta.episode_id} getOmnySnapshot={getOmnySnapshot} onChooseEpisodeWorkspace={choosePanelDraftWorkspace} onSelectElement={setSelectedElement} onChange={(nextPanel,origin='manual') => mutate((draft) => { const current=draft.manga.pages[activePage]?.panels[activePanel];if(current&&(origin==='agent'||!panelLocked(current)))draft.manga.pages[activePage].panels[activePanel] = nextPanel; })} onOpenBackgrounds={() => openMaterialsForPanel('background')} onOpenProps={() => openMaterialsForPanel('prop')} onAdd={addPanel} onDelete={deletePanel} />}</div></aside>
        </div>}
        {tab === 'meta' && <MetaEditor document={document} onChange={setDocument} />}
        {tab === 'setting' && <SettingEditor document={document} onChange={setDocument} onImportBackgroundModel={importBackgroundModel} onSaveBackgrounds={saveBackgroundsFromEditor} backgroundsSaving={seriesCatalogSaving||projectBusy} panelLinkMode={materialLinkTarget?.materialType === 'background' && materialLinkPanel ? {
          pageNumber: materialLinkTarget.pageIndex + 1,
          panelId: materialLinkPanel.id,
          linkedKeys: materialLinkPanel.assets ?? [],
        } : null} onTogglePanelMaterial={toggleMaterialForPanel} onReturnToPanel={returnFromMaterials} />}
        {tab === 'characters' && <CharactersEditor document={document} onChange={setDocument} onNotify={setToast} onSaveCharacters={saveCharactersFromEditor} charactersSaving={seriesCatalogSaving} onPatchDocument={patchLatestDocument} onPersistSeriesCatalog={persistSeriesCatalog} onFinalizeDeletedSeriesMaterial={finalizeDeletedSeriesMaterial} characterTextLink={characterTextLink} characterTextBusy={characterTextBusy} onLinkCharacterText={() => linkCharacterText(documentRef.current, characterTextLink?.seriesDirectory ?? '', setDocument, setCharacterTextLink)} onDeleteSeriesCharacter={(characterLocalId) => deleteSeriesCharacter(documentRef.current, characterLocalId, setDocument, setCharacterTextLink)} onRestoreDeletedCharacter={(deletionId) => restoreDeletedCharacter(documentRef.current, deletionId, setDocument, setCharacterTextLink)} />}
        {tab === 'props' && <PropsEditor document={document} onChange={setDocument} panelLinkMode={materialLinkTarget?.materialType === 'prop' && materialLinkPanel ? {
          pageNumber: materialLinkTarget.pageIndex + 1,
          panelId: materialLinkPanel.id,
          linkedKeys: (materialLinkPanel.figures ?? []).filter(isPropPlacement).map((figure) => figure.name),
        } : null} onTogglePanelMaterial={toggleMaterialForPanel} onReturnToPanel={returnFromMaterials} />}
        {tab === 'coverage' && <div class="scenario-workspace"><ScenarioReview document={document} onChange={setDocument} onNavigate={(pageIndex, panelIndex, bubbleIndex, overlay) => {
          setSelectedPanels([panelIndex]);
          selectCanvasElement(bubbleIndex === undefined ? null : { type: 'bubble', index: bubbleIndex, ...(overlay ? { scope: 'page_overlay' as const } : {}) },panelIndex,pageIndex,false);
          setTab('storyboard');
          if(bubbleIndex!==undefined&&(overlay?document.manga.pages[pageIndex]?.page_overlay:document.manga.pages[pageIndex]?.panels[panelIndex])?.bubbles?.[bubbleIndex]?.shape!=='handwritten'){setTextPaletteRequest(value=>({id:value.id+1,tab:'info'}));setMobileStoryboardPane('editor');}
          else {setInspectorCollapsed(false);setMobileStoryboardPane('panel');}
        }} />
        {!document.manga.scenario && <details class="scenario-legacy"><summary>資料との文字列照合（補助機能）</summary><SourceCoverageReview
          document={document}
          getOmnySnapshot={getOmnySnapshot}
          source={boundSourceSnapshot?.episodeId === document.manga.meta.episode_id ? boundSourceSnapshot.source : null}
          decisions={sourceCoverageDecisions}
          workspaceFolder={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.folderName : ''}
          canChooseWorkspaceSource={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id}
          canSave={!isLanClient && Boolean(coverageWorkspace)}
          onSourceChange={setCoverageSource}
          onChooseWorkspaceSource={chooseCoverageWorkspaceSource}
          onConnectWorkspace={chooseCoverageWorkspace}
          onDecisionsChange={setSourceCoverageDecisions}
          onSave={saveCoverageReport}
          onNavigate={changeTab}
          onNotify={setToast}
        /></details>}</div>}
      </section>
    </main>
    </> : <main inert={environmentOpen} class="startup-home">
      <section class="startup-card" aria-label="起動メニュー">
        <div class="startup-actions">
          <button type="button" class="primary-button" onClick={openNewDialog}><FilePlus2 size={19} />新規作成</button>
          <button type="button" class="secondary-button" disabled={projectBusy} onClick={openProject}><FolderOpen size={19} />作品フォルダを開く</button>
        </div>
      </section>
    </main>}

    {environmentOpen && <>
      <div class="environment-backdrop" aria-hidden="true" onClick={closeEnvironmentSettings} />
      <section ref={environmentPanel} id="environment-dialog" class="environment-dialog" role="dialog" aria-modal="true" aria-label="環境設定" tabIndex={-1}>
        {environmentSettings}
        <aside class="environment-agent-host" ref={setEnvironmentAgentHost} aria-label="設定の会話"/>
      </section>
    </>}

    {showNewDialog && <>
      <button inert={environmentOpen} class="drawer-backdrop" onClick={closeNewDialog} disabled={newLayoutTask === 'creating'} aria-label="新規作成を閉じる" />
      <section inert={environmentOpen} class="new-dialog" role="dialog" aria-modal={!environmentOpen} aria-label="新規作成">
        <div class="drawer-head new-dialog-head"><h2>新規作成</h2><button onClick={closeNewDialog} disabled={newLayoutTask === 'creating'} aria-label="閉じる"><X size={16} /></button></div>
        <NewProjectNavigation {...{
          newCreationStep, seriesCatalogSaving, newLayoutTask, returnToSeriesSelection,
          setNewCreationStep, editingNewPrintSetup, newPrintConfirmed, setEditingNewPrintSetup,
          newSeriesMode, newEpisodeWorkspace, newSeriesPreparing, newWorkspaceSelecting,
          characterTextBusy, continueFromNewCharacters, newWorkSetting,
        }} />
        <div class="new-dialog-body" key={newCreationStep}>
          <div class="new-creation-content">
          {newCreationStep === 'series' && <NewSeriesStep {...{
            continueFromSeriesSelection, newSeriesMode, clearNewReferenceText,
            clearNewSeriesReference, setNewCharacterTextLink, setNewSeriesMode, setNewSeriesName,
            setNewSeriesId, setNewEpisodeWorkspace, setNewWorkspaceMessage, setSeriesCatalogMessage,
            seriesCatalogs, newSeriesName, newSeriesId, selectExistingSeries, newSeriesDirectory,
            chooseNewSeriesDirectory, newSeriesDirectorySelecting, newSeriesReferenceSelecting,
            newSeriesPreparing, newWorkspaceSelecting, newSeriesDirectoryMessage,
            newSeriesReferenceRows, newSelectedSeriesReferencePaths, newSeriesReferenceBusy,
            setNewSelectedSeriesReferencePaths, newSeriesReferenceMessage,
            chooseNewSeriesReferenceTextFile, selectedNewSeriesReferenceRows,
            removeSelectedNewSeriesReferences, newSeriesReferenceCandidates,
            applySelectedNewSeriesReferences, seriesCatalogMessage, newWorkTitle,
            newEpisodeWorkspace, chooseNewEpisodeWorkspace, newReferenceSelecting,
            newWorkspaceMessage, newReferenceFileName, newSuggestedEpisodeReference,
            chooseNewReferenceTextFile, applySuggestedReferenceTexts, newReferenceMessage,
          }} />}
          {newCreationStep === 'characters' && newCharacterDocument && <section class="new-character-step" aria-label="登場人物の登録">
            <CharactersEditor
              document={newCharacterDocument}
              onChange={setNewCharacterDocument}
              onNotify={setToast}
              embedded
              onSaveCharacters={isLanClient ? undefined : saveNewCharacters}
              charactersSaving={seriesCatalogSaving}
              onPatchDocument={patchNewCharacterDocument}
              onPersistSeriesCatalog={persistNewCharacterCatalog}
              onChooseCharacterImages={isLanClient ? undefined : chooseNewCharacterImageFiles}
              hideSystemMob
              characterTextLink={newCharacterTextLink}
              characterTextBusy={characterTextBusy}
              onLinkCharacterText={() => {
                const latest = newCharacterDocumentRef.current;
                if (latest) return linkCharacterText(latest, newEpisodeWorkspace?.directory ?? '', setNewCharacterDocument, setNewCharacterTextLink);
              }}
              onDeleteSeriesCharacter={(characterLocalId) => {
                const latest = newCharacterDocumentRef.current;
                if (latest) return deleteSeriesCharacter(latest, characterLocalId, setNewCharacterDocument, setNewCharacterTextLink);
              }}
              onRestoreDeletedCharacter={(deletionId) => {
                const latest = newCharacterDocumentRef.current;
                if (latest) return restoreDeletedCharacter(latest, deletionId, setNewCharacterDocument, setNewCharacterTextLink);
              }}
            />
          </section>}
          {newCreationStep === 'setting' && <NewSettingStep {...{
            continueFromNewSetting, newSeriesMode, newCharacterDocument, updateNewSeriesSetting,
            patchNewCharacterDocument, setNewSettingMessage, newWorkSetting, updateNewWorkSetting,
            newSettingMessage,
          }} />}
          {newCreationStep === 'layout' && <NewLayoutStep {...{
            editingNewPrintSetup, newPrintSetup, setNewPrintSetup, setNewPrintConfirmed,
            setEditingNewPrintSetup, setToast, newLayoutTask, newPrintConfirmed, createNewDocument,
            chooseNewLayoutImageFiles, requestScannerFinish, scannerReceivedCount, launchScanner,
            pendingScannerSession, persistAnalogAssets, changePersistAnalogAssets, newLayoutRowGapMm,
            updateNewLayoutGutter, newLayoutColumnGapMm, newLayoutFrameLineWidthMm,
            updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans, newLayoutImageInput,
            chooseNewLayoutImages, activeLayoutItem, newLayoutItems, newLayoutActiveIndex,
            setNewLayoutActiveIndex, rotateActiveLayoutImage, analyzeNewLayouts, newLayoutMessage,
            newCharacterReadProgress, scannerSession, hasScannedLayoutItems,
          }} />}
          </div>
        </div>
      </section>
    </>}
    {qwenGeneration&&<QwenGenerationDialog onOpenSettings={()=>{qwenGeneration.agentRequest?.reject(new Error('環境設定へ移動しました'));setQwenGeneration(null);void showEnvironmentSettings();}} adultContent={Boolean(document.manga.series_setting?.adult_content)} agentRequest={qwenGeneration.agentRequest} onConversation={setGenerationConversation} onConversationHost={setGenerationConversationHost} key={qwenGeneration.id} plan={qwenGeneration.plan} poseEditorContext={qwenGeneration.poseEditorContext} layers={qwenGeneration.layers} loadLayer={qwenGeneration.loadLayer} onInsert={insertQwenImage} onClose={()=>{qwenGeneration.agentRequest?.reject(new Error('生成を中止しました'));setQwenGeneration(null);}}/>}
    {toast && <div class="toast"><span>{toast}</span><button onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div></PaintEditor>;
}
