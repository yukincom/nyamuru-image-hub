import type { ProjectBinding } from '../../lib/projectPersistence';
import { type BrowserDirectoryHandle } from '../../lib/browserWorkspace';
import type { TextStyle } from '../../types';
import { loadAgentPreferences, saveAgentPreferences, type AgentPreferences } from '../../lib/agentPreferences';
import { createAgentRevision } from '../../lib/agentTools';
import { type TextPaletteTab } from '../PaintTextTools';
import { type CanvasTextTarget } from '../../lib/canvasText';
import { type PcFontFamily } from '../../lib/bubbleFonts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { defaultPrintSetup, type PrintSetup } from '../../lib/printSettings';
import { type QwenGenerationConversation } from '../../lib/qwenGeneration';
import { type ImageExportFormat } from '../../lib/pageExport';
import { loadEditGuide, loadPaintBleed, loadPaintSmoothing, loadPaintCursor, type PaintCursorMode } from '../../lib/paintPreferences';
import { workspaceHistory } from '../../lib/workspaceHistory';
import { loadHistorySteps, saveHistorySteps } from '../../lib/historyPreferences';
import type { PaintController, PaintLayerAction, PaintSessionSnapshot } from '../../lib/paintSession';
import type { BubblePathToolMode } from '../../lib/paintWorkspace';
import type { CharacterReadProgressState } from '../CharacterReadProgress';
import { DEFAULT_PANEL_GUTTERS } from '../../lib/canvasGeometry';
import { type PanelSplitDirection } from '../../lib/panelTemplates';
import { type EpisodeWorkspace, type PendingScannerSession, type ReferenceTextSuggestion, type ScannerSession, type SeriesCatalogDraftSession, type SeriesCatalogSummary, type SeriesCharacterTextLink, type SeriesReferenceTextCandidate, type SeriesReferenceTextSelection } from '../../lib/localBridge';
import { type PanelMaterialLinkTarget } from '../../lib/panelMaterialLinks';
import { type ImportedStorySetting } from '../../lib/settingTextImport.ts';
import { type SourceCoverageDecision } from '../../lib/sourceCoverage.ts';
import type { CanvasElementSelection, MangaDocument, WorkspaceTab } from '../../types';
import { type NewCreationStep, type NewSeriesMode, type NewSourceSnapshot, type BoundSourceSnapshot, emptyNewWorkSetting } from '../../lib/newProjectSettings';
import { type NewLayoutTask, type NewLayoutItem } from '../../lib/newLayoutPreview';
import { storedPcFontCatalog, initialInnerFrameSnap, initialPanelSync, initialPanelGapSnap, initialShowGuides, initialSpreadView, initialPersistAnalogAssets } from '../../lib/workspacePreferences';
import type { MobileStoryboardPane, WorkspacePaintSession, WorkspaceSnapshot, WorkspaceGeneration, WorkspaceImageTarget } from './workspaceTypes';
import type { WorkspaceStartupState } from '../../lib/workspaceStartup';

export function useWorkspaceState(startupWorkspace: WorkspaceStartupState, initialTab: () => WorkspaceTab, endTextEdit: () => void) {
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
  const [boundEpisodeWorkspace, setBoundEpisodeWorkspace] = useState<ProjectBinding | null>(null);
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
  return {
    document, setDocumentState, hasDocument, setHasDocument, documentRef, activePage, setActivePage,
    activePageRef, activePanel, setActivePanel, activePanelRef, qwenPreparing, generationConversation,
    setGenerationConversation, generationConversationHost, setGenerationConversationHost, qwenGeneration,
    setQwenGeneration, agentWorkTarget, setAgentWorkTarget, qwenGenerationRef, selectedPanels,
    setSelectedPanels, selectedElement, setSelectedElement, placedImageInput, imageImportTarget,
    imageImportBusy, setImageImportBusy, imageExportDialog, setImageExportDialog, imageExportBusy,
    setImageExportBusy, imageExportDirectory, setImageExportDirectory, imageExportProgress,
    setImageExportProgress, imageExportError, setImageExportError, paintSession, setPaintSession,
    paintController, paintSessionRef, autoPaintResume, autoPaintTransition, paintBleedPx, setPaintBleedPx,
    editGuide, setEditGuide, paintSmoothing, setPaintSmoothing, paintCursorMode, setPaintCursorMode,
    imageGesture, canvasSelectionScrollRequest, setCanvasSelectionScrollRequest, tab, setTab,
    environmentOpen, environmentPanel, environmentAgentHost, setEnvironmentAgentHost,
    closeEnvironmentSettings, toggleEnvironmentSettings, showEnvironmentSettings, environmentKeyDown,
    materialLinkTarget, setMaterialLinkTarget, mobileStoryboardPane, setMobileStoryboardPane,
    sidebarCollapsed, setSidebarCollapsed, inspectorCollapsed, setInspectorCollapsed, paintToolsCollapsed,
    setPaintToolsCollapsed, textTool, setTextTool, textToolStyle, setTextToolStyle, textPaletteRequest,
    setTextPaletteRequest, bubblePathTool, setBubblePathTool, localFontFamilies, setLocalFontFamilies,
    localFontCatalog, localFontQuery, localFontSynced, createdText, bubbleMaterialsOpen,
    setBubbleMaterialsOpen, zoomTool, setZoomTool, voiceOpen, setVoiceOpen, agentProfile, agentRevision,
    changeAgentProfile, editingText, setEditingText, layerSwitchBusy, setLayerSwitchBusy, layerSwitch,
    pendingLayerAction, paintLayersCollapsed, setPaintLayersCollapsed, showGuides, setShowGuides,
    innerFrameSnap, setInnerFrameSnap, panelGapSnap, setPanelGapSnap, panelSync, setPanelSync, spreadView,
    setSpreadView, canvasZoomPercent, setCanvasZoomPercent, persistAnalogAssets, setPersistAnalogAssets,
    showNewDialog, setShowNewDialog, newCreationStep, setNewCreationStep, newPrintSetup, setNewPrintSetup,
    editingNewPrintSetup, setEditingNewPrintSetup, newPrintConfirmed, setNewPrintConfirmed, newSeriesMode,
    setNewSeriesMode, newCharacterDocument, setNewCharacterDocumentState, newCharacterDocumentRef,
    newSeriesPreparing, setNewSeriesPreparing, panelSplitDirection, setPanelSplitDirection, newLayoutItems,
    setNewLayoutItems, newLayoutActiveIndex, setNewLayoutActiveIndex, newLayoutMessage,
    setNewLayoutMessage, newCharacterReadProgress, setNewCharacterReadProgress, newLayoutTask,
    setNewLayoutTask, newLayoutTaskRef, newLayoutRowGapMm, setNewLayoutRowGapMm, newLayoutColumnGapMm,
    setNewLayoutColumnGapMm, newLayoutFrameLineWidthMm, setNewLayoutFrameLineWidthMm, newWorkTitle,
    setNewWorkTitle, newWorkSetting, setNewWorkSetting, newSettingMessage, setNewSettingMessage,
    newSeriesName, setNewSeriesName, newSeriesId, setNewSeriesId, newSeriesDirectory,
    setNewSeriesDirectory, newSeriesDirectorySelecting, setNewSeriesDirectorySelecting,
    newSeriesDirectoryMessage, setNewSeriesDirectoryMessage, newSeriesReference, setNewSeriesReference,
    newSeriesReferences, setNewSeriesReferences, newSeriesReferenceCandidates,
    setNewSeriesReferenceCandidates, newSelectedSeriesReferencePaths, setNewSelectedSeriesReferencePaths,
    newSeriesReferenceSelecting, setNewSeriesReferenceSelecting, newSeriesReferenceMessage,
    setNewSeriesReferenceMessage, newEpisodeWorkspace, setNewEpisodeWorkspace, boundEpisodeWorkspace,
    setBoundEpisodeWorkspace, projectBusy, setProjectBusy, projectOperation, saveProjectAction,
    newSourceSnapshot, setNewSourceSnapshot, boundSourceSnapshot, setBoundSourceSnapshot,
    sourceCoverageDecisions, setSourceCoverageDecisions, newWorkspaceSelecting, setNewWorkspaceSelecting,
    newWorkspaceMessage, setNewWorkspaceMessage, newReferenceSelecting, setNewReferenceSelecting,
    newReferenceFileName, setNewReferenceFileName, newSuggestedEpisodeReference,
    setNewSuggestedEpisodeReference, newReferenceMessage, setNewReferenceMessage, characterTextLink,
    setCharacterTextLink, newCharacterTextLink, setNewCharacterTextLink, characterTextBusy,
    setCharacterTextBusy, seriesCatalogs, setSeriesCatalogs, seriesCatalogMessage, setSeriesCatalogMessage,
    seriesCatalogSaving, setSeriesCatalogSaving, newEpisodeNumber, setNewEpisodeNumber, scannerSession,
    setScannerSession, pendingScannerSession, setPendingScannerSession, scannerReceivedCount,
    setScannerReceivedCount, toast, setToast, historySteps, timeline, past, future, changedHistory,
    pendingPaintAssets, workspaceSnapshot, recordPaint, changeHistorySteps, newLayoutImageInput,
    newLayoutItemsRef, newCreationBridgeToken, newCharacterDraftSession, characterEditorBridgeToken,
    characterTextSyncTimer, newLayoutOperationGeneration, newSeriesSelectionGeneration, scannerSessionRef,
    scannerStopRequested, lastHistoryPush, seriesCatalogSaveQueue, seriesCatalogPendingCount,
    pendingCanvasElementSelection,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
