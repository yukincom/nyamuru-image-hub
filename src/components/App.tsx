import {connectAgentImageGeneration} from '../lib/localBridge';
import type {QwenAgentRequest} from '../lib/qwenGeneration';
import VoiceCommands from './VoiceCommands';
import { isLanClient } from '../lib/clientRuntime';
import { type BrowserDirectoryHandle } from '../lib/browserWorkspace';
import { browserCatalogImageIds } from '../lib/browserCatalog';
import {textStyleOf,typingTextStyle,updateTextStyle,type TextStylePatch,type TextSelection} from '../lib/textStyle';
import type {Bubble,TextStyle} from '../types';
import { loadAgentPreferences, saveAgentPreferences, type AgentPreferences } from '../lib/agentPreferences';
import {agentEditorSnapshot,createAgentRevision,prepareAgentBubbleEdit,selectedAgentBubble} from '../lib/agentTools';
import {resolveVoiceGenerationTarget,type VoiceCommand} from '../lib/voiceCommands';
import { applyArtworkSettings, getArtworkSettings } from '../lib/artworkRules';
import standardArtworkSource from '../content/standard-settings.yaml?raw';
import {artworkLocked,paintFolderChain,paintOwnerPlacementLocked} from '../lib/paintLock';
import PaintTextTools, {type TextPaletteTab} from './PaintTextTools';
import BubbleMaterialPicker from './BubbleMaterialPicker';
import PaintToolHelp from './PaintToolHelp';
import { addCanvasTextAt, ensureCanvasTextOwner, canvasTextAt, canvasTextCategory, changeCanvasTextCategory, type TextCategory, canvasTextEditable, canvasBubbleLineWidthEditable, changeCanvasDefaultBubbleLineWidth, editCanvasBubbleLineWidth, convertScreenTextToBubble, editCanvasText, editCanvasTextStyle, editCanvasBubbleMaterial, removeCanvasText, screenTextCoveredByBubble, toggleCanvasTextVisibility, type CanvasTextTarget } from '../lib/canvasText';
import {bubbleStrokeWidthMm,isHandwrittenText,isBalloonText} from '../lib/bubblePresentation';
import {availableFontWeights,classifyPcFontFamilies,queryPcFontFamilies,type PcFontFamily} from '../lib/bubbleFonts';
import PageLayerPalette from './PageLayerPalette';
import { ownerItemLocked, bubbleVisible, panelGeometryLocked, panelLocked, panelVisible, reorderPanelArt, toggleBubbleVisibility, unlockPanelDescendants, type BubbleTextTarget } from '../lib/panelLayers';
import PanelControls from './PanelControls';
import { namedBackgroundStages, verifyBackgroundStage } from '../lib/background3d';
import PaintEditor, { PaintTools, PaintDetails, PaintStatus, type PaintResult } from './PaintEditor';
import { paintGenerationOwner, applyPaintAnchorIds, paintOwnerShouldClear, ensureDirectPaintOwner, movePaintEntry, validatePaintDocument, applyOwnerPaint, applyPaintOwnerLock, canvasPaintOwnerKey, clearOwnerPaint, figurePaintVisible, insertGeneratedPaintImage, generatedPaintName, hasAdoptedPaintImages, paintAssetIds, paintOwnerCanvasSelection, paintScene, withPaintBleed, type PaintScene, type PaintOwner } from '../lib/paintDocument';
import { paintColorMode } from '../lib/paintColor';
import PlacedImageList from './PlacedImageList';
import { imageAssetIds, setFigureArtwork, createFrameArtwork, createImagePlacement, prepareImageAsset, validateImagePlacements, validImageBox } from '../lib/imagePlacement';
import { fallbackBox, panelBounds } from '../lib/canvasGeometry';
import { overlayFallbackBox } from '../lib/pageCanvas';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { BookOpen, Box, ChevronLeft, ChevronRight, ClipboardCheck, Download, FilePlus2, Files, FolderOpen, LayoutPanelTop, Settings2, SlidersHorizontal, UsersRound, X } from 'lucide-preact';
import Header from './Header';
import { getPrintSetup, defaultPrintSetup, type PrintSetup } from '../lib/printSettings';
import { type ProjectBinding } from '../lib/projectPersistence';
import PageSidebar from './PageSidebar';
import MangaCanvas from './MangaCanvas';
import PanelInspector from './PanelInspector';
import {getOutputSettings} from '../lib/finishLayout.ts';
import QwenGenerationDialog, { qwenInputImage, qwenLayerImage, type GenerationPoseEditorContext } from './QwenGenerationDialog';
import { buildQwenGenerationPlan, qwenLayerCandidates, type QwenGenerationPlan, type QwenLayerCandidate, type QwenGenerationConversation, type QwenAdoption } from '../lib/qwenGeneration';
import { buildQwenCompositionPlan, captureQwenComposition, type QwenCompositionScope } from '../lib/qwenComposition';
import { canChooseImageExportDirectory, type ImageExportFormat } from '../lib/pageExport';
import { humanPoseOwnerImage } from '../lib/humanPoseComposition';
import {generationMaskBounds,loadPaintImages,renderPaintPng,type PaintImages} from '../lib/paintRenderer';
import {prepareGuideLayer} from '../lib/paintGuide';
import PageOverlayInspector from './PageOverlayInspector';
import EnvironmentSettings from './EnvironmentSettings';
import { loadEditGuide, saveEditGuide, loadPaintBleed, savePaintBleed, loadPaintSmoothing, savePaintSmoothing, loadPaintCursor, savePaintCursor, type PaintCursorMode } from '../lib/paintPreferences';
import { workspaceHistory } from '../lib/workspaceHistory';
import { loadHistorySteps, saveHistorySteps } from '../lib/historyPreferences';
import type { PaintController, PaintLayerAction, PaintSessionSnapshot } from '../lib/paintSession';
import type { BubblePathToolMode, PaintLayoutTarget } from '../lib/paintWorkspace';
import SourceCoverageReview from './SourceCoverageReview';
import ScenarioReview from './ScenarioReview';
import { confirmScenarioCorrespondence, detachResolvedScenarioLinks, rejectScenarioCorrespondence, restoreProvisionalScenarioText, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import type { CharacterReadProgressState } from './CharacterReadProgress';
import { CharactersEditor, MetaEditor, PropsEditor, SettingEditor } from './DocumentEditors';
import { cloneDocument, MAX_PANELS_PER_PAGE, newPage, newPanel, parseOmayYaml, toSeparatedMangaYaml } from '../lib/manga';
import { clamp, DEFAULT_PANEL_GUTTERS, movePanelEdge as movePanelEdgeGeometry, movePanelVertexWithSnap, resizePanelToBounds, syncPanelBleedAtTrim, translatePanel, type PanelEdgeReference } from '../lib/canvasGeometry';
import { mergeSelectedPanels, reconcileSplitOverlapFlags, splitPanel, type PanelSplitDirection } from '../lib/panelTemplates';
import { discardSeriesCatalogDraftOnPageExit, getPendingScannerSession, getSeriesCharacterTextStatus, type EpisodeWorkspace, type PendingScannerSession, type ReferenceTextSuggestion, type ScannerSession, type SeriesCatalogDraftSession, type SeriesCatalogSummary, type SeriesCharacterTextLink, type SeriesReferenceTextCandidate, type SeriesReferenceTextSelection } from '../lib/localBridge';
import { removeMaterialsFromSeriesCatalog } from '../lib/seriesCatalog';
import { beginFigureCropImport, onFigureCropAssetsChanged, pruneFigureCropAssets, collectFigureCropAssetIds, deleteFigureCropAssets, loadFigureCropAsset, saveFigureCropAssets } from '../lib/figureCropStore';
import { spreadPartnerIndex as findSpreadPartnerIndex } from '../lib/pageSpread';
import { setPanelMaterialLink, type PanelMaterialLinkTarget } from '../lib/panelMaterialLinks';
import { isPropPlacement, synchronizeCatalogReferences } from '../lib/catalogModel';
import { panelDisplayLabel, textDisplayLabel } from '../lib/displayLabels';
import { type ImportedStorySetting } from '../lib/settingTextImport.ts';
import { type SourceCoverageDecision } from '../lib/sourceCoverage.ts';
import { startNewCreationBridgeSession, stopNewCreationBridgeSession, stopNewCreationBridgeSessionOnPageExit } from '../lib/localBridgeLifecycle.ts';
import { createInitialWorkspace, type WorkspaceStartupState } from '../lib/workspaceStartup.ts';
import type { BBox, ImageAsset, BubbleTailTarget, CanvasElementSelection, MangaDocument, WorkspaceTab } from '../types';

import { type NewCreationStep, type NewSeriesMode, type NewSourceSnapshot, type BoundSourceSnapshot, emptyNewWorkSetting } from '../lib/newProjectSettings';
import { type NewLayoutTask, type NewLayoutItem, nextLayoutIndexFromArrow } from '../lib/newLayoutPreview';
import { INNER_FRAME_SNAP_KEY, PANEL_SYNC_KEY, PANEL_GAP_SNAP_KEY, SHOW_GUIDES_KEY, SPREAD_VIEW_KEY, PERSIST_ANALOG_ASSETS_KEY, storedPcFontCatalog, rememberPcFontCatalog, initialInnerFrameSnap, initialPanelSync, initialPanelGapSnap, initialShowGuides, initialSpreadView, initialPersistAnalogAssets } from '../lib/workspacePreferences';

import NewSeriesStep from './new-project/NewSeriesStep';
import NewSettingStep from './new-project/NewSettingStep';
import NewLayoutStep from './new-project/NewLayoutStep';
import NewProjectNavigation from './new-project/NewProjectNavigation';

import { createNewProjectAction } from './workspace/newProjectCreation';
import { createProjectFileActions } from './workspace/workspaceProjectFiles';
import { createImageExportActions } from './workspace/workspaceImageExport';
import type { MobileStoryboardPane, WorkspacePaintSession, WorkspaceSnapshot } from './workspace/workspaceTypes';

import { createNewProjectSessions } from './workspace/newProjectSessions';
import { createSeriesSelection } from './workspace/newSeriesSelection';
import { createSeriesReferenceActions } from './workspace/newSeriesReferences';
import { createWorkspaceSourceActions } from './workspace/episodeWorkspaceSources';
import { createSeriesPreparation } from './workspace/newSeriesPreparation';
import { createSeriesCatalogActions } from './workspace/seriesCatalogActions';
import { createEpisodeSettingActions } from './workspace/newEpisodeSettings';
import { createWorkspaceCatalogActions } from './workspace/workspaceCatalog';
import { createNewLayoutImportActions } from './workspace/newLayoutImportActions';

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
  const [qwenGeneration,setQwenGeneration]=useState<{id:string;plan:QwenGenerationPlan;poseEditorContext?:GenerationPoseEditorContext;layers:QwenLayerCandidate[];loadLayer:(id:string,correction:boolean,crop?:BBox,native?:boolean)=>Promise<string>;document:MangaDocument;pageIndex:number;panelIndex:number;overlay:boolean;owner?:PaintOwner;agentRequest?:QwenAgentRequest;textSource?:{target:CanvasTextTarget;position?:Bubble['text_position']}}|null>(null);
  const [agentWorkTarget,setAgentWorkTarget]=useState<{pageIndex:number;panelIndex:number;selection:CanvasElementSelection}|null>(null);
  const qwenGenerationRef=useRef(qwenGeneration);qwenGenerationRef.current=qwenGeneration;
  const [selectedPanels, setSelectedPanels] = useState<number[]>([0]);
  const [selectedElement, setSelectedElement] = useState<CanvasElementSelection | null>(null);
  const placedImageInput = useRef<HTMLInputElement>(null);
  const imageImportTarget = useRef<{ document: MangaDocument; pageIndex: number; panelIndex: number; scope: 'page' | 'panel' | 'page_overlay'; figureIndex?: number; bubbleIndex?: number; box: BBox; generatedOwner?:PaintOwner; generatedAdoption?:QwenAdoption; generatedFolderId?:string; textSource?:{target:CanvasTextTarget;position?:Bubble['text_position']}; generationScope?:'page'|'panel' } | null>(null);
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
    disabled:layerSwitchBusy||!canvasBubbleLineWidthEditable(document,selectedBubbleTarget),onChange:changeSelectedBubbleLineWidth,
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
    updateNewLayoutTask, setToast, setNewCharacterDocument, setShowNewDialog, endTextEdit,
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
    documentRef, setDocument, endTextEdit, saveProjectAction, persistSeriesCatalog, characterTextLink,
    syncCharacterText, setCharacterTextLink, setToast, projectOperation, setProjectBusy,
    patchLatestDocument,
  });

  const { saveProject, exportOmny, openProject } = createProjectFileActions({
    hasDocument, showNewDialog, projectOperation, endTextEdit, documentRef, setToast, setProjectBusy,
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

  const addPage = () => {endTextEdit();mutate((draft) => { const index = draft.manga.pages.length; const setup = getPrintSetup(draft.manga); draft.manga.pages.push(newPage(index + 1, { w: setup.width_mm, h: setup.height_mm })); setActivePage(index); setActivePanel(0); setSelectedPanels([0]); setTab('storyboard'); setMobileStoryboardPane('editor'); });};
  const duplicatePage = () => {
    if (!page) return;
    endTextEdit();
    mutate((draft) => { const copy = structuredClone(draft.manga.pages[activePage]); draft.manga.pages.splice(activePage + 1, 0, copy); draft.manga.pages.forEach((item, index) => { item.page = index + 1; }); setActivePage(activePage + 1); setSelectedPanels([activePanel]); });
  };
  const deletePage = () => {
    if (document.manga.pages.length <= 1 || !confirm(`ページ ${activePage + 1} を削除しますか？`)) return;
    endTextEdit();
    mutate((draft) => { draft.manga.pages.splice(activePage, 1); draft.manga.pages.forEach((item, index) => { item.page = index + 1; }); setActivePage(Math.max(0, activePage - 1)); setActivePanel(0); setSelectedPanels([0]); });
  };
  const reorderPage = (from: number, to: number) => {
    if (from === to) return;
    endTextEdit();
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
    if (!page || page.panels.length >= MAX_PANELS_PER_PAGE) { setToast(`1ページに追加できるのは${MAX_PANELS_PER_PAGE}コマまでです`); return; }
    endTextEdit();
    mutate((draft) => { const page = draft.manga.pages[activePage]; const panels = page.panels; panels.push(newPanel(panels.length + 1, panels.length * 45, page.canvas)); setActivePanel(panels.length - 1); setSelectedPanels([panels.length - 1]); });
  };
  const deletePanelAt = (index:number) => {
    const target=document.manga.pages[activePage]?.panels[index];
    if (!target || panelLocked(target) || !confirm(`${panelDisplayLabel(target.id)} を削除しますか？`)) return;
    endTextEdit();
    autoPaintResume.current=null;
    mutate((draft) => { const panels = draft.manga.pages[activePage].panels; panels.splice(index, 1); panels.forEach((item, panelIndex) => { item.id = panelIndex + 1; }); const nextIndex = Math.max(0, Math.min(index - 1, panels.length - 1)); setActivePanel(nextIndex); setSelectedPanels(panels.length?[nextIndex]:[]);setSelectedElement(null); });
  };
  const deletePanel = () => deletePanelAt(activePanel);
  const deleteScreenTextAt=(panelIndex:number,index:number,overlay:boolean)=>{
    const target:CanvasTextTarget={pageIndex:activePage,panelIndex,index,overlay,kind:'screen_text'};
    if(!canvasTextEditable(documentRef.current,target))return;
    void layerTransition(async()=>{
      autoPaintResume.current=null;
      if(paintSessionRef.current)await paintController.current?.close();
      createdText.current=null;endTextEdit();
      const next=cloneDocument(documentRef.current);
      if(!removeCanvasText(next,target))return;
      lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;setSelectedElement(null);
    });
  };
  const deleteBubbleAt=(panelIndex:number,bubbleIndex:number,overlay=false)=>{
    const target:CanvasTextTarget={pageIndex:activePage,panelIndex,index:bubbleIndex,overlay,kind:'bubble'};
    const bubble=canvasTextAt(documentRef.current,target);
    const targetPanel=!overlay?documentRef.current.manga.pages[activePage]?.panels[panelIndex]:undefined;
    if(!bubble||ownerItemLocked(bubble)||('paint_overlay' in bubble&&artworkLocked(bubble.paint_overlay))||targetPanel&&panelLocked(targetPanel)||!confirm(`${overlay?'ページ前景':'コマ'}の${textDisplayLabel(bubbleIndex)}を削除しますか？`))return;
    void layerTransition(async()=>{
      autoPaintResume.current=null;
      if(paintSessionRef.current)await paintController.current?.close();
      endTextEdit();
      const next=cloneDocument(documentRef.current);
      if(!removeCanvasText(next,target))return;
      lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
      setSelectedElement(null);
    });
  };
  const makePaintScene = (current:MangaDocument,panelIndex:number,pageIndex:number,overlay:boolean) => {
    const targetPage=current.manga.pages[pageIndex],targetPanel=targetPage?.panels[panelIndex];
    if(!targetPage||(!overlay&&!targetPanel))throw new Error('対象のあたりが見つかりません');
    validateImagePlacements(current);
    const source=overlay?{id:0,shape:{type:'rect' as const,x:0,y:0,...targetPage.canvas},bg:0 as const,action:null,
      layer:targetPage.layer,screen_text:targetPage.page_overlay?.screen_text,
      images:targetPage.images?.filter(image=>image.paintScope==='page'||image.bubbleOriginal),
      figures:targetPage.page_overlay?.figures?.map((figure,index)=>({...figure,bbox:figure.bbox??overlayFallbackBox(targetPage.canvas,'figure',index)})),
      bubbles:(targetPage.page_overlay?.bubbles??[]).map((bubble,index)=>({...bubble,bbox:bubble.bbox??overlayFallbackBox(targetPage.canvas,'bubble',index)}))}:targetPanel;
    const setup=getPrintSetup(current.manga);
    const scene=paintScene(source,setup.dpi,current.manga.image_assets??[],paintColorMode(setup.format),overlay?'page':'panel',overlay?targetPage.panels:undefined);
    if(overlay)scene.owners=scene.owners.filter(owner=>owner.kind!=='background');
    if(!scene.owners.length)throw new Error('描画先を選んでください');
    return {...scene,generatedImageSequence:current.manga.generated_image_sequence??0};
  };
  const artworkGuideVisible=(key:string,panelIndex=activePanel,pageIndex=activePage,overlay=false,source=document):boolean=>{
    if(key.startsWith('bubble-'))return false;
    const page=source.manga.pages[pageIndex],target=overlay?page?.page_overlay:page?.panels[panelIndex];
    const index=Number(key.split('-')[1]);
    const figure=key.startsWith('figure-')?target?.figures?.[index]:undefined,bubble=key.startsWith('bubble-')?target?.bubbles?.[index]:undefined;
    const paint=key==='background'?page?.panels[panelIndex]?.background_images?.[0]?.paint:figure?.artwork?.paint??bubble?.paint_overlay?.paint;
    if(paint?.guideInitialized){
      if(figure)return figurePaintVisible(figure);
      return paint.layers.some(layer=>layer.guide&&layer.visible&&layer.opacity>0);
    }
    if(key==='background')return !page?.panels[panelIndex]?.background_images?.length;
    return key.startsWith('figure-')?!target?.figures?.[index]?.artwork:!target?.bubbles?.[index]?.paint_overlay;
  };
  const toggleArtworkGuide=(key:string,panelIndex=activePanel,pageIndex=activePage,overlay=false)=>{
    if(key.startsWith('bubble-'))return;
    const session=paintSessionRef.current;
    if(!key.startsWith('bubble-')&&session?.pageIndex===pageIndex&&session.panelIndex===panelIndex&&session.overlay===overlay){paintController.current?.layerAction({type:'guide',key});return;}
    if(!key.startsWith('bubble-')){void layerTransition(async()=>{
      if(paintSessionRef.current)await paintController.current?.close();
      const source=makePaintScene(documentRef.current,panelIndex,pageIndex,overlay),owner=source.owners.find(o=>o.key===key);
      if(!owner?.paint.guideInitialized)return;
      pendingLayerAction.current={type:'guide',key};
      if(!openPaint(key,panelIndex,pageIndex,overlay,source))pendingLayerAction.current=null;
    });return;}
  };
  const selectedPaintOwner = () => canvasPaintOwnerKey(documentRef.current.manga.pages[activePage],activePanel,selectedElement)??'background';
  const openPaint = (initialOwner?:string,panelIndex=activePanel,pageIndex=activePage,overlay=selectedElement?.scope==='page_overlay'||selectedElement?.scope==='page', preview?:PaintScene) => {
    if(imageImportBusy||paintSessionRef.current||qwenPreparing.current)return false;
    endTextEdit();
    const current=documentRef.current;
    try {
      if(!overlay&&!panelVisible(current.manga.pages[pageIndex].panels[panelIndex]))throw new Error('レイヤーの目を押してコマを表示してください');
      setTextTool(false);setZoomTool(false);setBubblePathTool(false);
      const scene={...(preview??makePaintScene(current,panelIndex,pageIndex,overlay)),layerSequence:current.manga.pages[pageIndex].paint_layer_sequence??0,generatedImageSequence:preview?.generatedImageSequence??current.manga.generated_image_sequence??0};
      scene.owners=scene.owners.map(owner=>withPaintBleed(owner,paintBleedPx));
      setMobileStoryboardPane('editor');setPaintToolsCollapsed(false);setPaintLayersCollapsed(false);
      const ownerKey=initialOwner??selectedPaintOwner();
      const session={document:current,pageIndex,panelIndex,overlay,scene,initialOwner:ownerKey,title:overlay?'ページ前景':panelDisplayLabel(current.manga.pages[pageIndex].panels[panelIndex].id)};
      autoPaintResume.current=null;paintSessionRef.current=session;setPaintSession(session);return true;
    }catch(error){setToast(error instanceof Error?error.message:'ペイントを開けませんでした');return false;}
  };
  async function layerTransition(action:()=>void|Promise<void>){
    if(layerSwitch.current||projectOperation.current||imageImportBusy||qwenGeneration)return;
    layerSwitch.current=true;setLayerSwitchBusy(true);
    try{await action();}catch(error){setToast(error instanceof Error?error.message:'レイヤーを切り替えられません');}
    finally{layerSwitch.current=false;setLayerSwitchBusy(false);}
  }
  function requestPcFonts(){
    if(localFontQuery.current)return localFontQuery.current;
    if(localFontSynced.current)return Promise.resolve();
    const request=queryPcFontFamilies()
      .then(names=>{
        if(names.length!==localFontCatalog.current.length||names.some((name,index)=>{
          const old=localFontCatalog.current[index],weights=name.weights??[],oldWeights=old.weights??[];
          return name.family!==old.family||(name.displayName??name.family)!==(old.displayName??old.family)||weights.length!==oldWeights.length||weights.some((option,i)=>option.value!==oldWeights[i].value||option.label!==oldWeights[i].label);
        })){
          const families=classifyPcFontFamilies(names);
          localFontCatalog.current=families;
          setLocalFontFamilies(families);
          rememberPcFontCatalog(families);
        }
        localFontSynced.current=true;
      })
      .catch(()=>{/* Startup may lack permission; opening the selected-text picker retries inside a user gesture. */})
      .finally(()=>{localFontQuery.current=null;});
    localFontQuery.current=request;
    return request;
  }
  useEffect(()=>{void requestPcFonts();},[]);
  function endTextEdit(){
    const created=createdText.current;
    createdText.current=null;
    if(created){
      const item=canvasTextAt(documentRef.current,created);
      if(item&&!item.text.trim()){
        const next=cloneDocument(documentRef.current);
        if(removeCanvasText(next,created)){
          setDocument(next);
          const selected=selectedElement;
          if(selected?.type===created.kind&&selected.index===created.index&&(selected.scope==='page_overlay')===created.overlay)setSelectedElement(null);
        }
      }
    }
    setEditingText(null);imageGestureBoundary('end');
  }
  function startBubbleEdit(target:BubbleTextTarget){startTextEdit({...target,index:target.bubbleIndex,kind:'bubble'});}
  function startTextEdit(target:CanvasTextTarget){
    autoPaintResume.current=null;
    if(canvasTextAt(documentRef.current,target)?.hidden){
      void layerTransition(async()=>{
        if(paintSessionRef.current)await paintController.current?.close();
        endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);
        selectCanvasElement({type:target.kind,index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})},target.panelIndex,target.pageIndex,false);
      });return;
    }
    setTextPaletteRequest(value=>({id:value.id+1,tab:'text'}));
    if(editingText&&editingText.pageIndex===target.pageIndex&&editingText.panelIndex===target.panelIndex&&editingText.index===target.index&&editingText.kind===target.kind&&editingText.overlay===target.overlay)return;
    void requestPcFonts();
    void layerTransition(async()=>{
      if(paintSessionRef.current)await paintController.current?.close();
      const current=documentRef.current;
      if(!canvasTextEditable(current,target))return;
      endTextEdit();setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);setSelectedPanels([target.panelIndex]);
      selectCanvasElement({type:target.kind,index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})},target.panelIndex,target.pageIndex,false);
      imageGestureBoundary('start');setEditingText(target);
    });
  }
  function changeCanvasText(target:CanvasTextTarget,text:string,edit?:TextSelection){
    const next=cloneDocument(documentRef.current);
    if(editCanvasText(next,target,text,edit,'manual',typingTextStyle(textToolStyle))){imageGesture.current.pushed=false;lastHistoryPush.current=0;setDocument(next);}
  }
  function changeTextToolStyle(patch:TextStylePatch){
    setTextToolStyle(current=>{
      const item={text:'',orientation:current.orientation??'vertical',text_style:{...current}};
      return updateTextStyle(item,'screen_text',patch,undefined,patch.font?availableFontWeights(patch.font,localFontCatalog.current):undefined)?textStyleOf(item,'screen_text'):current;
    });
  }
  function changeCanvasTextStyle(target:CanvasTextTarget,patch:TextStylePatch,selection?:TextSelection){
    if(paintSessionRef.current||projectOperation.current||qwenGeneration)return;
    try{const next=editCanvasTextStyle(documentRef.current,target,patch,selection,patch.font?availableFontWeights(patch.font,localFontCatalog.current):undefined);if(next!==documentRef.current){changeTextToolStyle(patch);if(imageGesture.current.source!=='text-size'){imageGesture.current.pushed=false;lastHistoryPush.current=0;}setDocument(next);}}
    catch(error){setToast(error instanceof Error?error.message:'文字設定を変更できません');}
  }
  function changeSelectedBubbleLineWidth(width:number){
    if(!selectedBubbleTarget||textTool||zoomTool||paintSessionRef.current||projectOperation.current||layerSwitch.current||qwenGeneration)return;
    const current=documentRef.current,next=editCanvasBubbleLineWidth(current,selectedBubbleTarget,width*25.4/getPrintSetup(current.manga).dpi);
    if(next===current)return;
    imageGestureBoundary('end');lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  }
  function canvasTextHistory(direction:'undo'|'redo'){
    const target=editingText;
    (direction==='undo'?undo:redo)();
    if(target&&canvasTextEditable(documentRef.current,target)&&canvasTextAt(documentRef.current,target)?.text_style?.fontSize!==undefined){
      imageGestureBoundary('start');setEditingText(target);
      setSelectedElement({type:target.kind,index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})});
    }
  }
  function applyBubbleMaterial(target:CanvasTextTarget,id:string){
    void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    try{
      const next=cloneDocument(documentRef.current);
      if(!editCanvasBubbleMaterial(next,target,id))return;
      endTextEdit();lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
      setActivePage(target.pageIndex);setActivePanel(target.panelIndex);setSelectedElement({type:'bubble',index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})});
      setTextTool(false);setZoomTool(false);setBubblePathTool(false);
      setToast('文字・大きさ・位置を保って、吹き出しの輪郭を入れ替えました');
    }catch(error){setToast(error instanceof Error?error.message:'素材を適用できません');}
    });
  }
  function openBubbleMaterials(){endTextEdit();setBubbleMaterialsOpen(true);setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);setTextPaletteRequest(value=>({id:value.id+1,tab:'bubble'}));}
  function chooseTextTool(){void requestPcFonts();void layerTransition(async()=>{
    setTextPaletteRequest(value=>({id:value.id+1,tab:'text'}));
    autoPaintResume.current=null;
    const session=paintSessionRef.current;
    if(session){
      const snapshot=paintController.current?.snapshot(),scene=snapshot?.scene??session.scene;
      const key=snapshot?.ownerKey??session.initialOwner;
      const owner=key?paintGenerationOwner(scene,key):undefined;
      let selection=owner?.kind==='bubble'?paintOwnerCanvasSelection(documentRef.current.manga.pages[session.pageIndex],session.panelIndex,owner.key,session.overlay):undefined;
      // Point text has no paint owner; preserve its existing P -> T editing route.
      if(!selection&&selectedElement?.type==='screen_text'&&session.pageIndex===activePage&&session.panelIndex===activePanel&&(selectedElement.scope==='page_overlay')===session.overlay
        &&canvasTextAt(documentRef.current,{pageIndex:session.pageIndex,panelIndex:session.panelIndex,index:selectedElement.index,kind:'screen_text',overlay:session.overlay}))selection=selectedElement;
      if(selection){
        await paintController.current?.close();
        selectCanvasElement(selection,session.panelIndex,session.pageIndex,false);
      }else{
        await paintController.current?.pause();
        setSelectedElement(null);
      }
    }
    setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);
  });}
  function closeTextTool(){
    endTextEdit();setTextTool(false);
  }
  function chooseBubblePathTool(mode:Exclude<BubblePathToolMode,false>){void layerTransition(async()=>{
    autoPaintResume.current=null;
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(mode);setPaintToolsCollapsed(false);
  });}
  function chooseLayoutTool(target?:PaintLayoutTarget){
    const session=paintSessionRef.current;
    const select=()=>{
      autoPaintResume.current=null;endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(target?.direct?'node':false);
      if(!target){setSelectedElement(null);return;}
      const pageIndex=session?.pageIndex??activePage,panelIndex=target.panelIndex??session?.panelIndex??activePanel;
      const selection=target.key?paintOwnerCanvasSelection(documentRef.current.manga.pages[pageIndex],panelIndex,target.key,session?.overlay):target.selection;
      if(selection)selectCanvasElement(selection,panelIndex,pageIndex);
      else {selectCanvasPanel(panelIndex,target.additive);setSelectedElement(null);}
    };
    if(target&&session)void layerTransition(async()=>{await paintController.current?.close();select();});
    else select();
  }
  function chooseZoomTool(){void layerTransition(async()=>{
    autoPaintResume.current=null;
    if(paintSessionRef.current)await paintController.current?.pause();
    endTextEdit();setTextTool(false);setZoomTool(true);setBubblePathTool(false);setPaintToolsCollapsed(false);
  });}
  function createScreenTextAt(pageIndex:number,panelIndex:number|null,point:{x:number;y:number}){
    void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();
    const next=cloneDocument(documentRef.current),target=addCanvasTextAt(next,pageIndex,panelIndex,point,textToolStyle);
    if(!target)return;
    imageGestureBoundary('start');lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
    createdText.current=target;
    setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);
    setSelectedPanels([target.panelIndex]);
    selectCanvasElement({type:'screen_text',index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})},target.panelIndex,pageIndex,false);
    setEditingText(target);
    });
  }
  function changeSelectedTextBody(text:string){
    if(selectedElement?.type!=='bubble'&&selectedElement?.type!=='screen_text')return;
    changeCanvasText({pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:selectedElement.type},text);
  }
  function screenTextPosition(target:CanvasTextTarget):Bubble['text_position']{
    if(target.kind!=='screen_text')return;
    const element=window.document.querySelector<HTMLElement>(`[data-content-kind="screen_text"][data-content-index="${target.index}"].is-element-selected${target.overlay?'[data-content-overlay]':`[data-content-panel="${target.panelIndex}"]`}`);
    const frame=element?.getBoundingClientRect(),body=element?.querySelector('.screen-text-body');
    if(frame?.width&&frame.height&&body){
      // Match BubbleText's content-block range, including glyph overhang beyond its line box.
      const range=window.document.createRange();range.selectNode(body);
      const content=range.getBoundingClientRect();
      return {x:(content.x+content.width/2-frame.x)/frame.width,y:(content.y+content.height/2-frame.y)/frame.height};
    }
  }
  function changeSelectedTextCategory(category:TextCategory){
    if(selectedElement?.type!=='bubble'&&selectedElement?.type!=='screen_text')return;
    const target:CanvasTextTarget={pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:selectedElement.type};
    const item=canvasTextAt(documentRef.current,target);
    if(!item||!canvasTextEditable(documentRef.current,target)||canvasTextCategory(item,target.kind)===category)return;
    // Point text starts at an edge; native balloon text is centered on text_position.
    // Keep the visible text center even when its authored box has spare space.
    const screenPosition=screenTextPosition(target);
    void layerTransition(async()=>{
      if(paintSessionRef.current)await paintController.current?.close();
      const next=cloneDocument(documentRef.current),converted=changeCanvasTextCategory(next,target,category,screenPosition);
      if(!converted)return;
      createdText.current=null;setEditingText(null);imageGestureBoundary('end');
      lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
      setSelectedElement({type:converted.kind,index:converted.index,...(converted.overlay?{scope:'page_overlay' as const}:{})});
      setTextPaletteRequest(value=>({id:value.id+1,tab:'info'}));
    });
  }
  function wrapScreenText(target:CanvasTextTarget,materialId:string){
    void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    createdText.current=null;setEditingText(null);imageGestureBoundary('end');
    const next=cloneDocument(documentRef.current);
    const converted=convertScreenTextToBubble(next,{screenText:target,materialId});
    if(!converted)return;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
    setActivePage(converted.pageIndex);setActivePanel(converted.panelIndex);setSelectedPanels([converted.panelIndex]);
    setSelectedElement({type:'bubble',index:converted.index,...(converted.overlay?{scope:'page_overlay' as const}:{})});
    setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    setToast('写植文字を吹き出しの中央へ入れ、文字量に合わせて一度だけサイズを調整しました');
    });
  }
  function finishElementMove(pageIndex:number,selection:CanvasElementSelection,panelIndex:number|null){
    if(selection.type!=='bubble')return;
    const bubbleTarget:CanvasTextTarget={pageIndex,panelIndex:panelIndex??0,index:selection.index,overlay:selection.scope==='page_overlay',kind:'bubble'};
    const covered=screenTextCoveredByBubble(documentRef.current,bubbleTarget);
    if(!covered)return;
    createdText.current=null;setEditingText(null);imageGestureBoundary('end');
    const next=cloneDocument(documentRef.current),converted=convertScreenTextToBubble(next,{screenText:covered,bubble:bubbleTarget});
    if(!converted)return;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
    setSelectedElement({type:'bubble',index:converted.index,...(converted.overlay?{scope:'page_overlay' as const}:{})});
    setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    setToast('文字を吹き出しの中央へ入れ、文字量に合わせて一度だけサイズを調整しました');
  }
  function selectLayerOwner(key:string,panelIndex:number,pageIndex=activePage,overlay=false,native=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    const page=documentRef.current.manga.pages[pageIndex],selection=paintOwnerCanvasSelection(page,panelIndex,key,overlay);
    if(!selection)return;
    if(selection.type==='bubble'&&!bubbleVisible((overlay?page.page_overlay:page.panels[panelIndex])!.bubbles![selection.index]))return;
    autoPaintResume.current=null;endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    selectCanvasElement(native?{...selection,part:'native'}:selection,panelIndex,pageIndex);
  });}
  function toggleTextLayer(target:CanvasTextTarget,group=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();const next=cloneDocument(documentRef.current);if(!(target.kind==='bubble'?toggleBubbleVisibility(next,{...target,bubbleIndex:target.index},group):toggleCanvasTextVisibility(next,target)))return;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  });}
  function selectLayerPanel(index:number,frame=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    autoPaintResume.current=null;endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    setSelectedPanels([index]);selectCanvasElement(frame?{type:'panel_frame',index}:null,index);
  });}
  function togglePanelLayer(index:number,frame:boolean){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();const next=cloneDocument(documentRef.current),panel=next.manga.pages[activePage]?.panels[index];if(!panel)return;
    panel.layer??={};if(frame)panel.layer.frameHidden=!panel.layer.frameHidden;else panel.layer.hidden=!panel.layer.hidden;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  });}
  function togglePanelLock(index:number,frame=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();const next=cloneDocument(documentRef.current),panel=next.manga.pages[activePage]?.panels[index];if(!panel)return;
    panel.layer??={};if(frame)panel.layer.frameLocked=!panel.layer.frameLocked;else if(panelLocked(panel))unlockPanelDescendants(panel);else panel.layer.locked=true;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  });}
  function reorderOwnerLayers(index:number,key:string,target:string,after:boolean,overlay=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.pause();
    const session=paintSessionRef.current,controller=paintController.current,before=workspaceSnapshot();
    const validate=()=>{
      const next=cloneDocument(documentRef.current),page=next.manga.pages[activePage],panel=page?.panels[index],owner=overlay?page?.page_overlay:panel;
      if(!owner||(!overlay&&(!panelVisible(panel)||panelLocked(panel))))return;
      const moved=makePaintScene(next,index,activePage,overlay).owners.find(item=>item.key===key);
      if(!moved||paintOwnerPlacementLocked(moved)||!reorderPanelArt(owner,key,target,after,overlay?(page.layer??={}):undefined))return;
      return next;
    };
    if(!validate())return;
    if(session)await controller?.flush();
    const next=validate();if(!next)return;
    setDocument(next,false);timeline.current.record(before);lastHistoryPush.current=0;changedHistory();
    if(session){
      const live=controller?.snapshot(),active=session.pageIndex===activePage&&session.overlay===overlay&&(overlay||session.panelIndex===index);
      if(live&&active){
        const layout=makePaintScene(next,index,activePage,overlay);
        const scene={...live.scene,anchorIds:layout.anchorIds,owners:layout.owners.map(owner=>{
          const original=live.scene.owners.find(item=>item.key===owner.key);
          return original?{...original,bubble:owner.bubble,figure:owner.figure}:owner;
        })};
        const updated={...session,document:next,scene,resume:{...live,scene,saved:scene},images:new Map(controller?.images())};
        paintSessionRef.current=updated;setPaintSession(updated);
      }else{const updated={...session,document:next};paintSessionRef.current=updated;setPaintSession(updated);}
    }
  });}
  function actOnLayer(index:number,action:PaintLayerAction,preview:PaintScene,overlay=false){
    if(action.type==='select'&&!action.mask&&!action.id&&paintOwnerCanvasSelection(documentRef.current.manga.pages[activePage],index,action.key,overlay)){selectLayerOwner(action.key,index,activePage,overlay,action.native);return;}
    void layerTransition(async()=>{
    const session=paintSessionRef.current;
    if((action.type==='move-layer'||action.type==='move-folder')&&action.destination){
      const destination=action.destination;
      if(session?.pageIndex===activePage&&session.overlay===overlay&&(overlay||session.panelIndex===index)
        &&destination.overlay===overlay&&(overlay||destination.panelIndex===index)){
        paintController.current?.layerAction(action);return;
      }
      await movePaletteEntry(index,overlay,preview,action);return;
    }
    if(session?.pageIndex===activePage&&session.panelIndex===index&&session.overlay===overlay){paintController.current?.layerAction(action);return;}
    if(session)await paintController.current?.close();
    setActivePanel(index);setSelectedPanels([index]);
    // Locking uses paint persistence, but its native owner remains the information target after close.
    setSelectedElement(action.type==='owner-lock'?paintOwnerCanvasSelection(documentRef.current.manga.pages[activePage],index,action.key,overlay)??null:null);
    pendingLayerAction.current=action;
    // Use the preview's layer IDs; untouched empty layers do not exist in the document yet.
    if(!openPaint(action.key,index,activePage,overlay,preview))pendingLayerAction.current=null;
  });}
  async function movePaletteEntry(index:number,overlay:boolean,preview:PaintScene,action:Extract<PaintLayerAction,{type:'move-layer'|'move-folder'}>){
    const destination=action.destination;if(!destination)return;
    const pageIndex=activePage;
    if(paintSessionRef.current)await paintController.current?.pause();
    const session=paintSessionRef.current,controller=paintController.current;
    const liveSnapshot=controller?.snapshot(),live=liveSnapshot?.scene;
    const sourceLive=session?.pageIndex===pageIndex&&session.overlay===overlay&&(overlay||session.panelIndex===index);
    const targetLive=session?.pageIndex===pageIndex&&session.overlay===destination.overlay&&(destination.overlay||session.panelIndex===destination.panelIndex);
    const sameScope=overlay===destination.overlay&&(overlay||index===destination.panelIndex);
    let sourceScene=sourceLive&&live?live:preview;
    let targetScene=sameScope?sourceScene:targetLive&&live?live:destination.scene??makePaintScene(documentRef.current,destination.panelIndex,pageIndex,destination.overlay);
    let targetKey=destination.key;
    if(destination.stack){const direct=ensureDirectPaintOwner(targetScene,destination.stack);if(!direct)return;targetScene=direct.scene;targetKey=direct.key;if(sameScope)sourceScene=targetScene;}
    let source=sourceScene.owners.find(owner=>owner.key===action.key),target=targetScene.owners.find(owner=>owner.key===targetKey);
    if(!source||!target)return;
    const kind=action.type==='move-folder'?'folder':'layer';
    if(!movePaintEntry(source,target,kind,action.id,action.target))return;
    const before=workspaceSnapshot();
    if(session)await controller?.flush();
    const current=documentRef.current,imports:PaintResult['imports']=[...(liveSnapshot?.imports??[])];
    const borrowed=controller?.images()??new Map();
    const prepare=async(owner:PaintOwner)=>{
      let paint=owner.paint;
      for(const layer of paint.layers)if(layer.guide&&!layer.image){
        const prepared=await prepareGuideLayer(owner,layer);imports.push(prepared);
        paint={...paint,layers:paint.layers.map(item=>item.id===layer.id?{...prepared.layer,locked:layer.locked}:item)};
      }
      return paint===owner.paint?owner:{...owner,paint};
    };
    const sameOwner=source===target;
    source=await prepare(source);target=sameOwner?source:await prepare(target);
    const moved=movePaintEntry(source,target,kind,action.id,action.target);if(!moved)return;
    const owners=sameOwner?[moved.destination]:[moved.source,moved.destination];
    const replace=(scene:PaintScene,changed:PaintOwner[])=>({...scene,layerSequence:current.manga.pages[pageIndex].paint_layer_sequence??0,generatedImageSequence:liveSnapshot?.scene.generatedImageSequence??current.manga.generated_image_sequence??0,owners:scene.owners.map(owner=>changed.find(item=>item.key===owner.key)??owner)});
    const sourceAfter=replace(sourceScene,sameScope?owners:[moved.source]),targetAfter=sameScope?sourceAfter:replace(targetScene,[moved.destination]);
    const selectedMoves=sourceLive&&liveSnapshot?.ownerKey===action.key&&(liveSnapshot?.layerId===action.id||kind==='folder'&&paintFolderChain(source.paint,source.paint.layers.find(layer=>layer.id===liveSnapshot.layerId)?.folderId??liveSnapshot.layerId).some(folder=>folder.id===action.id));
    let resumeScene=selectedMoves?targetAfter:sourceLive?sourceAfter:targetLive?targetAfter:liveSnapshot?.scene;
    if(resumeScene){
      const prepared:PaintOwner[]=[];for(const owner of resumeScene.owners)prepared.push(await prepare(withPaintBleed(owner,paintBleedPx)));
      resumeScene={...resumeScene,owners:prepared};
    }
    const assets=[...(current.manga.image_assets??[]),...imports.map(item=>item.asset)];
    const images=await loadPaintImages([...owners,...(resumeScene?.owners??[])].map(owner=>owner.paint),assets,new Map(imports.map(item=>[item.asset.id,item.blob])),borrowed);
    let handedOff=false;
    try{
      const resultFor=async(scene:PaintScene,changed:PaintOwner[]):Promise<PaintResult>=>{
        const result:PaintResult={scene,owners:[],imports,stageImports:liveSnapshot?.stageImports};
        for(const owner of changed){
          if(paintOwnerShouldClear(owner))result.owners.push({owner,blob:new Blob(),remove:true});
          else {validatePaintDocument(owner.paint,assets);result.owners.push({owner,blob:await renderPaintPng(owner.paint,images)});}
        }
        return result;
      };
      const batches=sameScope
        ?[{pageIndex,panelIndex:index,overlay,title:current.manga.meta.title,result:await resultFor(targetScene,owners)}]
        :[{pageIndex,panelIndex:index,overlay,title:current.manga.meta.title,result:await resultFor(sourceScene,[moved.source])},
          {pageIndex,panelIndex:destination.panelIndex,overlay:destination.overlay,title:current.manga.meta.title,result:await resultFor(targetScene,[moved.destination])}];
      await persistPaintResults(current,batches,next=>{
        setDocument(next,false);timeline.current.record(before);lastHistoryPush.current=0;changedHistory();
        if(session&&liveSnapshot&&resumeScene){
          const scene=resumeScene;
          const panelIndex=selectedMoves?destination.panelIndex:session.panelIndex,overlay=selectedMoves?destination.overlay:session.overlay;
          const maskTarget=selectedMoves&&liveSnapshot.maskTarget?{...liveSnapshot.maskTarget,key:targetKey}:liveSnapshot.maskTarget;
          const resume={...liveSnapshot,scene,saved:scene,imports,stageImports:[],maskTarget,...(selectedMoves?{ownerKey:targetKey}:{})};
          const updated={...session,document:next,panelIndex,overlay,scene,resume,images:new Map([...borrowed,...images]),title:overlay?'ページ前景':panelDisplayLabel(next.manga.pages[pageIndex].panels[panelIndex].id)};
          paintSessionRef.current=updated;setPaintSession(updated);handedOff=true;
          if(selectedMoves){setActivePanel(panelIndex);setSelectedPanels([panelIndex]);}
        }
      });
    }finally{if(!handedOff)images.forEach((image,id)=>{if(image!==borrowed.get(id))image.src='';});}
  }
  function addDirectFolder(index:number,overlay=false,position?:import('../lib/paintDocument').PaintAddPosition){
    try{const scene=makePaintScene(documentRef.current,index,activePage,overlay);actOnLayer(index,{type:'add-folder',key:overlay?'page':'panel',position:position??{}},scene,overlay);}
    catch(error){setToast(error instanceof Error?error.message:'フォルダーを追加できませんでした');}
  }
  function openPanelBackground3d(index:number){
    const target=documentRef.current.manga.pages[activePage]?.panels[index];
    if(!target||panelLocked(target)){setToast('コマフォルダが固定されています');return;}
    try{actOnLayer(index,{type:'background3d',key:'background'},makePaintScene(documentRef.current,index,activePage,false));}
    catch(error){setToast(error instanceof Error?error.message:'背景の3D編集を開けません');}
  }
  const prepareQwen = async(current:MangaDocument,pageIndex:number,panelIndex:number,overlay:boolean,owner:PaintOwner,images?:PaintImages,pendingAssets:ImageAsset[]=[],agentRequest?:QwenAgentRequest,textSource?:{target:CanvasTextTarget;position?:Bubble['text_position'];document:MangaDocument}) => {
    const captured=structuredClone(owner),assets=[...pendingAssets,...(current.manga.image_assets??[])];
    if (captured.figure) {
      const sourcePage=current.manga.pages[pageIndex];
      const figure=(overlay?sourcePage.page_overlay:sourcePage.panels[panelIndex])?.figures?.[captured.index];
      if (figure) { captured.figure.human_pose=figure.human_pose; captured.figure.size=figure.size; }
    }
    const needsMask=(captured.kind==='bubble'&&captured.bubble&&!isBalloonText(captured.bubble))
      || (captured.figure&&!isPropPlacement(captured.figure));
    const area=needsMask?generationMaskBounds(captured.paint):undefined;
    const plan=buildQwenGenerationPlan(textSource?.document.manga??current.manga,pageIndex,panelIndex,overlay,captured,parseOmayYaml(standardArtworkSource),area,Boolean(captured.figure&&!isPropPlacement(captured.figure)));
    const selected=paintController.current?.snapshot();
    if(selected?.ownerKey===captured.key){
      plan.folderId=captured.paint.layers.find(layer=>layer.id===selected.layerId)?.folderId
        ??captured.paint.folders?.find(folder=>folder.id===selected.layerId)?.id;
    }
    const loadLayer=async(id:string,correction:boolean,crop?:BBox,native=false)=>{
      if(documentRef.current!==current)throw new Error('作品が変更されました。生成対象を選び直してください');
      const result=await qwenInputImage(await qwenLayerImage(captured,id,assets,images,correction),crop,native);
      if(documentRef.current!==current)throw new Error('作品が変更されました。生成対象を選び直してください');
      return result.image;
    };
    setVoiceOpen(true);
    const panel=current.manga.pages[pageIndex]?.panels[panelIndex];
    const poseEditorContext:GenerationPoseEditorContext|undefined=captured.figure?{
      onConfirmed:(selection, framing)=>{
        const opened=qwenGenerationRef.current;
        if (!opened || opened.document!==current || documentRef.current!==current) throw new Error('作品が変更されました。生成対象を選び直してください');
        const updated=cloneDocument(current), page=updated.manga.pages[pageIndex];
        const figure=(overlay?page.page_overlay:page.panels[panelIndex])?.figures?.[captured.index];
        if (!figure) throw new Error('対象の人物が見つかりません');
        figure.human_pose=selection;
        figure.size=framing;
        const session=paintSessionRef.current;
        if (session?.document===current) {
          const refreshed={...session,document:updated};
          paintSessionRef.current=refreshed;setPaintSession(refreshed);
        }
        current=updated;
        lastHistoryPush.current=0;
        setDocument(updated);
        const generation={...opened,document:updated};
        qwenGenerationRef.current=generation;setQwenGeneration(generation);
      },
      stages:current.manga.background_stages,
      ...(!overlay&&panel?{panelContext:{panel,selectedIndex:captured.index,assets,dpi:getOutputSettings(current.manga).dpi,
        guides:Object.fromEntries((panel.figures??[]).map((_,i)=>[`figure-${i}`,artworkGuideVisible(`figure-${i}`,panelIndex,pageIndex,false,current)]))},
        backgroundCaptures:(panel.background_images??[]).flatMap((item,i)=>item.paint?.background3d?[{label:`このコマの背景 ${i+1}`,capture:item.paint.background3d}]:[])}:{}),
    }:undefined;
    const next={id:crypto.randomUUID(),plan,poseEditorContext,layers:qwenLayerCandidates(captured),loadLayer,document:current,pageIndex,panelIndex,overlay,owner,agentRequest,...(textSource?{textSource:{target:textSource.target,position:textSource.position}}:{})};
    qwenGenerationRef.current=next;setQwenGeneration(next);
  };
  const requestOwnerGeneration = async(key?:string,overlay=selectedElement?.scope==='page_overlay',panelIndex=activePanel,pageIndex=activePage,agentRequest?:QwenAgentRequest) => {
    if(qwenGenerationRef.current||qwenPreparing.current||imageImportBusy||projectOperation.current)return;
    const session=paintSessionRef.current;
    if(session){
      if(session.pageIndex===pageIndex&&session.panelIndex===panelIndex&&session.overlay===Boolean(overlay)){await paintController.current?.generate(key);return;}
      try{await paintController.current?.close();}catch{return;}
    }
    qwenPreparing.current=true;
    const current=documentRef.current;
    try {
      const scene=makePaintScene(current,panelIndex,pageIndex,overlay),owner=scene.owners.find(o=>o.key===(key??selectedPaintOwner()));
      if(!owner)throw new Error('生成対象のフォルダが見つかりません');
      if(agentRequest&&(owner.kind==='figure'||owner.kind==='bubble'))setAgentWorkTarget({pageIndex,panelIndex,selection:{type:owner.kind,index:owner.index,scope:overlay?'page_overlay':'panel'}});
      await prepareQwen(current,pageIndex,panelIndex,overlay,owner,undefined,[],agentRequest);
      return true;
    }catch(error){setToast(error instanceof Error?error.message:'生成の準備ができませんでした');return false;}finally{qwenPreparing.current=false;}
  };
  async function requestTextGeneration(kind:'bubble'|'screen_text',index:number,overlay:boolean,panelIndex:number,pageIndex=activePage){
    endTextEdit();
    if(kind==='bubble')return requestOwnerGeneration(`bubble-${index}`,overlay,panelIndex,pageIndex);
    if(qwenGenerationRef.current||qwenPreparing.current||imageImportBusy||projectOperation.current)return;
    qwenPreparing.current=true;
    try{
      if(paintSessionRef.current)await paintController.current?.close();
      const current=documentRef.current,target:CanvasTextTarget={pageIndex,panelIndex,index,overlay,kind},position=screenTextPosition(target),preview=cloneDocument(current);
      const converted=ensureCanvasTextOwner(preview,target,position);
      if(!converted)throw new Error('生成する写植文字が見つかりません');
      const owner=makePaintScene(preview,panelIndex,pageIndex,overlay).owners.find(item=>item.key===`bubble-${converted.index}`);
      if(!owner)throw new Error('生成する文字のフォルダが見つかりません');
      await prepareQwen(current,pageIndex,panelIndex,overlay,owner,undefined,[],undefined,{target,position,document:preview});
    }catch(error){setToast(error instanceof Error?error.message:'文字の生成を準備できませんでした');}
    finally{qwenPreparing.current=false;}
  }
  const requestCompositionGeneration = async(scope:QwenCompositionScope,panelIndex:number,pageIndex:number) => {
    if(qwenGenerationRef.current||qwenPreparing.current||imageImportBusy||projectOperation.current)return;
    qwenPreparing.current=true;
    try {
      if(paintSessionRef.current)await paintController.current?.close();
      const current=documentRef.current;
      const guides:Record<string,boolean>={};
      current.manga.pages[pageIndex].panels.forEach((panel,index)=>['background',...(panel.figures??[]).map((_,i)=>`figure-${i}`),...panel.bubbles.map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`${index}:${key}`]=artworkGuideVisible(key,index,pageIndex,false,current);}));
      const overlay=current.manga.pages[pageIndex].page_overlay;
      [...(overlay?.figures??[]).map((_,i)=>`figure-${i}`),...(overlay?.bubbles??[]).map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`overlay:${key}`]=artworkGuideVisible(key,0,pageIndex,true,current);});
      const plan=buildQwenCompositionPlan(current.manga,pageIndex,panelIndex,scope,guides);
      setToast('生成用の紙面を準備しています…');
      plan.compositionImage=await captureQwenComposition(current.manga,pageIndex,panelIndex,scope,guides);
      if(documentRef.current!==current)throw new Error('作品が変更されました。生成する範囲を選び直してください');
      const next={id:crypto.randomUUID(),plan,layers:[],loadLayer:async()=>{throw new Error('全体生成では紙面を参照します');},document:current,pageIndex,panelIndex,overlay:false};
      qwenGenerationRef.current=next;setQwenGeneration(next);setVoiceOpen(true);setToast('');
    }catch(error){setToast(error instanceof Error?error.message:'全体生成を準備できませんでした');}
    finally{qwenPreparing.current=false;}
  };
  const { openImageExportDialog, chooseImageExportFolder, exportPageRange } = createImageExportActions({
    activePanelRef, endTextEdit, activePageRef, setImageExportError, setImageExportProgress,
    setImageExportDialog, imageExportBusy, setImageExportBusy, imageExportDirectory,
    setImageExportDirectory, imageExportDialog, documentRef, setToast,
  });
  async function persistPaintResults(current:MangaDocument,batches:Array<{pageIndex:number;panelIndex:number;overlay:boolean;title:string;result:PaintResult}>,publish:(next:MangaDocument)=>void){
    const next=cloneDocument(current), stored=next.manga.image_assets??=[];
    const writes:Array<{id:string;blob:Blob}>=[];
    let committed=false;
    const finishImageImport=beginFigureCropImport();
    try {
      const register=async(prepared:ImageAsset,blob:Blob):Promise<ImageAsset>=>{
        const existing=stored.find(a=>a.id===prepared.id);
        if(existing&&writes.some(item=>item.id===existing.storageId))return existing;
        const cached=existing?await loadFigureCropAsset(existing.storageId):null;
        if(existing&&cached)return existing;
        const asset={...prepared,storageId:`paint-${crypto.randomUUID()}`};
        if(existing)stored.splice(stored.indexOf(existing),1,asset);else stored.push(asset);
        writes.push({id:asset.storageId,blob});pendingPaintAssets.current.add(asset.storageId);return asset;
      };
      for(const batch of batches){
      const {result}=batch;
      if(result.stageImports?.length){
        const stages=next.manga.background_stages??=[];
        for(const {stage,blob} of result.stageImports){
          await verifyBackgroundStage(stage,blob);
          const existing=stages.find(item=>item.id===stage.id);
          if(existing&&await loadFigureCropAsset(existing.storageId))continue;
          const saved={...stage,storageId:`original-stage-${crypto.randomUUID()}`};
          if(existing)stages.splice(stages.indexOf(existing),1,saved);else stages.push(saved);
          writes.push({id:saved.storageId,blob});
        }
      }
      const needed=new Set(result.owners.flatMap(({owner})=>paintAssetIds(owner.paint)));
      for(const item of result.imports)if(needed.has(item.asset.id))await register(item.asset,item.blob);
      const targetPage=next.manga.pages[batch.pageIndex];
      if(!targetPage)throw new Error('描画先が見つかりません');
      applyPaintAnchorIds(targetPage,batch.panelIndex,batch.overlay,result.scene?.anchorIds);
      if(result.scene?.layerSequence!==undefined)targetPage.paint_layer_sequence=result.scene.layerSequence;
      if(result.scene?.generatedImageSequence!==undefined)next.manga.generated_image_sequence=result.scene.generatedImageSequence;
      for(const {owner,blob,remove,metadataOnly} of result.owners){
        const target=owner.kind==='page'||(owner.kind==='original'&&batch.overlay)?targetPage:batch.overlay?targetPage.page_overlay:targetPage.panels[batch.panelIndex];
        if(!target)throw new Error('描画先が見つかりません');
        applyPaintOwnerLock(target,owner);
        if(metadataOnly)continue;
        if(remove){clearOwnerPaint(target,owner);continue;}
        if(!blob)throw new Error('描画画像が見つかりません');
        const prepared=await prepareImageAsset(new File([blob],`${batch.title}-${owner.label}.png`,{type:'image/png'}));
        const asset=await register(prepared,blob);
        const image={...createFrameArtwork(asset,owner.frame),paint:owner.paint};
        applyOwnerPaint(target,owner,image);
      }
      }
      const used=imageAssetIds(next);
      next.manga.image_assets=stored.filter(asset=>!asset.storageId.startsWith('paint-')||used.has(asset.id));
      validateImagePlacements(next);
      await saveFigureCropAssets(writes);
      if(documentRef.current!==current)throw new Error('保存中に作品が変更されました。描画内容はこの画面に残っています');
      publish(next);committed=true;
    }finally{
      writes.forEach(item=>pendingPaintAssets.current.delete(item.id));
      if(!committed&&writes.length)await deleteFigureCropAssets(writes.map(item=>item.id)).catch(()=>undefined);
      finishImageImport();
    }
  }
  const applyPaint = async (result:PaintResult) => {
    const session=paintSessionRef.current;
    if(!session)throw new Error('描画先が見つかりません');
    if(documentRef.current!==session.document)throw new Error('作品が変更されています。ペイントを閉じて配置を確認してください');
    await persistPaintResults(session.document,[{...session,result}],next=>{
      setDocument(next,false);
      const live=paintController.current?.snapshot();
      const updated={...session,document:next,...(result.rebase&&result.scene&&live?{scene:result.scene,resume:{...live,scene:result.scene,saved:result.scene}}:{})};paintSessionRef.current=updated;setPaintSession(updated);
    });
  };
  const choosePlacedImage = (scope: 'page' | 'panel' | 'page_overlay', figureIndex?: number, panelIndex = activePanel, pageIndex = activePage, bubbleIndex?: number) => {
    const page = documentRef.current.manga.pages[pageIndex];
    const panel = page?.panels[panelIndex];
    if (!page || imageImportBusy || (scope === 'panel' && (!panel||panelLocked(panel)))) return;
    let box: BBox = scope === 'panel' ? panelBounds(panel!) : { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h };
    if (figureIndex !== undefined) {
      const figure = scope === 'page_overlay' ? page.page_overlay?.figures?.[figureIndex] : panel?.figures?.[figureIndex];
      if (!figure || figure.locked||artworkLocked(figure.artwork)) return;
      box = figure.bbox ?? (scope === 'page_overlay' ? overlayFallbackBox(page.canvas, 'figure', figureIndex) : fallbackBox(panel!, 'figure', figureIndex));
    } else if (bubbleIndex !== undefined) {
      const bubble = scope === 'page_overlay' ? page.page_overlay?.bubbles?.[bubbleIndex] : panel?.bubbles[bubbleIndex];
      if (!bubble || ownerItemLocked(bubble)) return;
      box = bubble.bbox ?? (scope === 'page_overlay' ? overlayFallbackBox(page.canvas, 'bubble', bubbleIndex) : fallbackBox(panel!, 'bubble', bubbleIndex));
    } else if (scope === 'page_overlay') return;
    imageImportTarget.current = { document: documentRef.current, pageIndex, panelIndex, scope, figureIndex, bubbleIndex, box: { ...box } };
    setActivePage(pageIndex);
    setActivePanel(panelIndex);
    setSelectedPanels([panelIndex]);
    placedImageInput.current?.click();
  };
  const chooseOwnerImage = (key=selectedPaintOwner(),panelIndex=activePanel,pageIndex=activePage,overlay=selectedElement?.scope==='page_overlay'||selectedElement?.scope==='page') => {
    if(imageImportBusy||projectOperation.current||qwenGeneration)return;
    const session=paintSessionRef.current;
    if(session){
      if(session.pageIndex===pageIndex&&session.panelIndex===panelIndex&&session.overlay===Boolean(overlay)){paintController.current?.chooseImage(key);return;}
      void paintController.current?.close().then(()=>chooseOwnerImage(key,panelIndex,pageIndex,overlay)).catch(()=>{});return;
    }
    choosePlacedImage(overlay?'page_overlay':'panel',key.startsWith('figure-')?Number(key.slice(7)):undefined,panelIndex,pageIndex,key.startsWith('bubble-')?Number(key.slice(7)):undefined);
  };
  const importPlacedImage = async (inputFile?: File|File[], explicitTarget?:NonNullable<typeof imageImportTarget.current>) => {
    if (placedImageInput.current) placedImageInput.current.value = '';
    const files=inputFile?(Array.isArray(inputFile)?inputFile:[inputFile]):[],file=files[0];
    const target = explicitTarget??imageImportTarget.current;
    imageImportTarget.current = null;
    if (!file || !target) return;
    if(target.generatedOwner&&target.generatedAdoption&&hasAdoptedPaintImages(target.generatedOwner,target.generatedAdoption.jobId,target.generatedAdoption.indices))return;
    setImageImportBusy(true);
    const newStorageIds:string[]=[];
    const finishImageImport=beginFigureCropImport();
    try {
      const prepared = await prepareImageAsset(file);
      if (documentRef.current !== target.document) throw new Error('取り込み中に作品が変更されたため、配置先を選んでやり直してください');
      const next = cloneDocument(documentRef.current);
      if(target.textSource){
        const converted=ensureCanvasTextOwner(next,target.textSource.target,target.textSource.position);
        if(!converted||converted.index!==target.bubbleIndex)throw new Error('生成する写植文字の差し込み先が変わりました');
      }
      const register=async(prepared:ImageAsset,blob:Blob)=>{
        const existing=next.manga.image_assets?.find(asset=>asset.sha256===prepared.sha256);
        const cached=existing?await loadFigureCropAsset(existing.storageId):null;
        // A fresh cache ID also reloads already-mounted missing-image views.
        const asset=existing&&cached?existing:existing?{...existing,storageId:prepared.storageId}:prepared;
        if(!cached){newStorageIds.push(asset.storageId);await saveFigureCropAssets([{id:asset.storageId,blob:blob.slice(0,blob.size,asset.mediaType)}]);}
        if(!existing)(next.manga.image_assets??=[]).push(asset);
        else next.manga.image_assets=next.manga.image_assets?.map(item=>item.id===asset.id?asset:item);
        return asset;
      };
      const asset=await register(prepared,file);
      const targetPage = next.manga.pages[target.pageIndex];
      let placement = target.scope === 'page' && !target.generationScope ? createImagePlacement(asset, target.box) : createFrameArtwork(asset, target.box);
      if(target.generatedOwner){
        const adoption=target.generatedAdoption;
        if(target.generatedOwner.paint.layers.length+files.length>64)throw new Error('1つのグループには64レイヤーまで追加できます');
        let generated=target.generatedOwner,sequence=next.manga.generated_image_sequence??0;
        for(const [index,source] of files.entries()){
          const image=index===0?asset:await register(await prepareImageAsset(source),source);
          generated=insertGeneratedPaintImage(generated,image,generatedPaintName(sequence++),target.box,
            {folderId:target.generatedFolderId,...(adoption?{generation:{jobId:adoption.jobId,candidateIndex:adoption.indices[index]}}:{})}).owner;
        }
        next.manga.generated_image_sequence=sequence;
        const composite=await humanPoseOwnerImage(generated,next.manga.image_assets??[]);
        const flat=await register(await prepareImageAsset(new File([composite],`${file.name}-layers.png`,{type:'image/png'})),composite);
        placement={...createFrameArtwork(flat,generated.frame),paint:generated.paint};
      }
      if (documentRef.current !== target.document) throw new Error('取り込み中に作品が変更されたため、配置先を選んでやり直してください');
      if(target.generationScope)placement.generationScope=target.generationScope;
      let selection: CanvasElementSelection | null;
      if(target.generationScope){
        const images=target.generationScope==='page'?(targetPage.images??=[]):(targetPage.panels[target.panelIndex].images??=[]);
        images.push(placement);selection={type:'image',index:images.length-1,scope:target.generationScope};
      } else if (target.figureIndex !== undefined) {
        const owner = target.scope === 'page_overlay' ? targetPage.page_overlay : targetPage.panels[target.panelIndex];
        const figure = owner?.figures?.[target.figureIndex];
        if (!figure) throw new Error('差し替えるあたりが見つかりません');
        if(target.generatedOwner)placement.locked=figure.artwork?.locked===true;
        setFigureArtwork(figure, placement);
        selection = { type: 'figure', index: target.figureIndex, scope: target.scope };
      } else if (target.bubbleIndex !== undefined) {
        const owner = target.scope === 'page_overlay' ? targetPage.page_overlay : targetPage.panels[target.panelIndex];
        const bubble = owner?.bubbles?.[target.bubbleIndex];
        if (!bubble) throw new Error('読み込み先のあたりが見つかりません');
        if(target.generatedOwner)placement.locked=bubble.paint_overlay?.locked===true;
        const { id, bbox, ...artwork } = placement;
        bubble.bbox = bbox; bubble.paint_overlay = artwork;
        selection = { type: 'bubble', index: target.bubbleIndex, scope: target.scope };
      } else if (target.scope === 'panel') {
        if(target.generatedOwner)placement.locked=target.generatedOwner.locked===true;
        targetPage.panels[target.panelIndex].background_images = [placement];
        selection = null;
      } else {
        const owner = targetPage;
        const images = owner.images ??= [];
        images.push(placement);
        selection = { type: 'image', index: images.length - 1, scope: target.scope };
      }
      lastHistoryPush.current = 0;
      setDocument(next);
      newStorageIds.length=0;
      lastHistoryPush.current = 0;
      if (activePageRef.current === target.pageIndex && (target.scope !== 'panel' || activePanelRef.current === target.panelIndex)) setSelectedElement(selection);
      setToast(`${file.name} を読み込みました`);
    } catch (error) {
      if (newStorageIds.length) void deleteFigureCropAssets(newStorageIds).catch(() => undefined);
      setToast(error instanceof Error ? error.message : '画像を取り込めませんでした');
      if(explicitTarget)throw error;
    } finally { setImageImportBusy(false); finishImageImport(); }
  };
  const insertQwenImage = async(file:File|File[],generationPlan?:QwenGenerationPlan,adoption?:QwenAdoption) => {
    const target=qwenGeneration;
    if(!target||documentRef.current!==target.document||projectOperation.current||imageImportBusy)throw new Error('作品が変更されました。差し込み先を選び直してください');
    const {pageIndex,panelIndex,overlay,owner}=target,plan=generationPlan??target.plan,session=paintSessionRef.current;
    if(plan.scope){
      await importPlacedImage(file,{document:target.document,pageIndex,panelIndex,scope:plan.scope,generationScope:plan.scope,box:plan.outputFrame!});
      setQwenGeneration(null);setToast(`${plan.label}の生成画像を配置しました`);return;
    }
    if(!owner)throw new Error('生成対象がありません');
    const placement=plan.outputFrame&&plan.referenceFrame?{frame:plan.outputFrame,referenceFrame:plan.referenceFrame,...(plan.folderId?{folderId:plan.folderId}:{})}:plan.folderId?{frame:owner.frame,referenceFrame:owner.frame,folderId:plan.folderId}:undefined;
    if(session){
      if(session.pageIndex!==pageIndex||session.panelIndex!==panelIndex||session.overlay!==overlay||!paintController.current)throw new Error('描画先が変更されています。差し込み先を選び直してください');
      await paintController.current.insertImage(file,owner.key,placement,adoption);
    }else{
      await importPlacedImage(file,{document:target.document,pageIndex,panelIndex,scope:overlay?'page_overlay':'panel',
        figureIndex:owner.kind==='figure'?owner.index:undefined,bubbleIndex:owner.kind==='bubble'?owner.index:undefined,box:{...(placement?.frame??owner.frame)},generatedOwner:owner,generatedAdoption:adoption,generatedFolderId:plan.folderId,...(target.textSource?{textSource:target.textSource}:{})});
    }
    if(!adoption)setQwenGeneration(null);
    setToast(`${Array.isArray(file)?file.length+'枚の生成画像':file.name} を${owner.label}のあたりの上に新規レイヤーとして追加しました`);
  };
  const imageGestureBoundary = (phase: 'start' | 'end', source?:'text-size') => {
    if(source&&(phase==='start'?imageGesture.current.source===source:imageGesture.current.source!==source))return;
    imageGesture.current = { active: phase === 'start', pushed: false, ...(phase==='start'&&source?{source}:{}) };
    lastHistoryPush.current = 0;
  };
  const movePageImageToPanel = (index: number) => {
    if (!panel || panelLocked(panel) || page?.images?.[index]?.locked) return;
    lastHistoryPush.current = 0;
    mutate(draft => {
      const targetPage = draft.manga.pages[activePage];
      const image = targetPage.images?.splice(index, 1)[0];
      if (!image) return;
      const images = targetPage.panels[activePanel].images ??= [];
      if (images.some(item => item.id === image.id)) image.id = crypto.randomUUID();
      images.push(image);
      setSelectedElement({ type: 'image', scope: 'panel', index: images.length - 1 });
    });
    lastHistoryPush.current = 0;
  };
  const changeElementBBox = (selection: CanvasElementSelection, bbox: BBox) => {
    if(selection.type==='panel_frame')return;
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      if (selection.type === 'image') {
        const image = (selection.scope === 'page' ? targetPage?.images : targetPage?.panels[activePanel]?.images)?.[selection.index];
        if (image && !artworkLocked(image,(selection.scope==='page'?targetPage.page_overlay:targetPage.panels[activePanel])?.bubbles) && validImageBox(bbox)) image.bbox = bbox;
        return;
      }
      if (selection.scope === 'page_overlay') {
        const overlay = targetPage?.page_overlay;
        if (!overlay) return;
        if (selection.type === 'figure') {
          const figure = overlay.figures?.[selection.index];
          if (figure && !figure.locked&&!artworkLocked(figure.artwork)) {
            figure.bbox = bbox;
            if (figure.analogImport) figure.analogImport.userEdited = true;
          }
        } else if (selection.type === 'bubble') {
          const bubble = overlay.bubbles?.[selection.index];
          if (bubble&&!ownerItemLocked(bubble)&&!artworkLocked(bubble.paint_overlay)) bubble.bbox = bbox;
        } else if (selection.type === 'screen_text') {
          const screenText=overlay.screen_text?.[selection.index];
          if(screenText)screenText.bbox=bbox;
        }
        return;
      }
      const targetPanel = targetPage?.panels[activePanel];
      if (!targetPanel||panelLocked(targetPanel)) return;
      if (selection.type === 'figure') {
        const figure = targetPanel.figures?.[selection.index];
        if (figure && !figure.locked&&!artworkLocked(figure.artwork)) {
          figure.bbox = bbox;
          if (figure.analogImport) figure.analogImport.userEdited = true;
        }
      } else if (selection.type === 'screen_text') {
        const screenText = targetPanel.screen_text?.[selection.index];
        if (screenText) screenText.bbox = bbox;
      } else {
        const bubble = targetPanel.bubbles[selection.index];
        if (bubble&&!ownerItemLocked(bubble)&&!artworkLocked(bubble.paint_overlay)) bubble.bbox = bbox;
      }
    });
  };
  const toggleInnerFrameSnap = () => {
    const next = !innerFrameSnap;
    setInnerFrameSnap(next);
    try { localStorage.setItem(INNER_FRAME_SNAP_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const togglePanelGapSnap = () => {
    const next = !panelGapSnap;
    setPanelGapSnap(next);
    try { localStorage.setItem(PANEL_GAP_SNAP_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const togglePanelSync = () => {
    const next = !panelSync;
    setPanelSync(next);
    try { localStorage.setItem(PANEL_SYNC_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changeShowGuides = (next: boolean) => {
    setShowGuides(next);
    try { localStorage.setItem(SHOW_GUIDES_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changeSpreadView = (next: boolean) => {
    setSpreadView(next);
    try { localStorage.setItem(SPREAD_VIEW_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changePersistAnalogAssets = (next: boolean) => {
    setPersistAnalogAssets(next);
    try { localStorage.setItem(PERSIST_ANALOG_ASSETS_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changePanelStyleNumber = (
    key: 'bubble_line_width_mm' | 'panel_frame_width_mm' | 'panel_gutter_row_mm' | 'panel_gutter_column_mm',
    value: number,
  ) => {
    if (!Number.isFinite(value)) return;
    const maximum = key === 'bubble_line_width_mm' ? 2 : key === 'panel_frame_width_mm' ? 5 : 20;
    const minimum = key === 'bubble_line_width_mm' || key === 'panel_frame_width_mm' ? 0.1 : 0;
    const normalized = Math.round(clamp(value, minimum, maximum) * 10) / 10;
    if (documentRef.current.manga.meta[key] === normalized) return;
    const apply=()=>{
      const next = cloneDocument(documentRef.current);
      if(key==='bubble_line_width_mm'){
        if(!changeCanvasDefaultBubbleLineWidth(next,normalized))return;
      }else next.manga.meta[key] = normalized;
      setDocument(next);
    };
    if(paintSessionRef.current){void layerTransition(async()=>{await paintController.current?.close();apply();});}
    else apply();
  };
  const changeBubbleTail = (selection: CanvasElementSelection, tail?: BubbleTailTarget, patch?:{bezier?:NonNullable<import('../types').Bubble['bezier']>;tailRoot?:import('../types').BubbleTailRoot;textPosition?:import('../types').BubbleTextPosition}) => {
    if (selection.type !== 'bubble') return;
    const textOnly=!!patch?.textPosition&&!tail&&!patch.bezier&&!patch.tailRoot;
    mutate((draft) => {
      const draftPage = draft.manga.pages[activePage];
      const bubble = selection.scope === 'page_overlay'
        ? draftPage?.page_overlay?.bubbles?.[selection.index]
        : draftPage?.panels[activePanel]?.bubbles[selection.index];
      const enclosingPanel=selection.scope==='page_overlay'?undefined:draftPage?.panels[activePanel];
      const contentLocked=textOnly?bubble?.paint_overlay?.locked===true:artworkLocked(bubble?.paint_overlay);
      if (bubble&&!ownerItemLocked(bubble)&&!(enclosingPanel&&panelLocked(enclosingPanel))&&!contentLocked) {
        if(tail)bubble.tail=tail;
        if(patch?.bezier)bubble.bezier=structuredClone(patch.bezier);
        if(patch?.tailRoot)bubble.tail_root={...patch.tailRoot};
        if(patch?.textPosition)bubble.text_position={...patch.textPosition};
      }
    });
  };
  const movePanel = (panelIndex: number, deltaX: number, deltaY: number) => {
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      const targetPanel = targetPage?.panels[panelIndex];
      if (!targetPanel || panelGeometryLocked(targetPanel)) return;
      translatePanel(targetPanel, deltaX, deltaY);
      syncPanelBleedAtTrim(targetPanel, targetPage.canvas, getPrintSetup(draft.manga).bleed_mm);
    });
  };
  const resizePanel = (panelIndex: number, bounds: BBox) => {
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      const targetPanel = targetPage?.panels[panelIndex];
      if (targetPanel && !panelGeometryLocked(targetPanel)) {
        resizePanelToBounds(targetPanel, bounds);
        syncPanelBleedAtTrim(targetPanel, targetPage.canvas, getPrintSetup(draft.manga).bleed_mm);
      }
    });
  };
  const movePanelVertex = (panelIndex: number, vertexIndex: number, x: number, y: number, linkPanels = false) => {
    mutate((draft) => {
      const panels = draft.manga.pages[activePage]?.panels;
      const targetPage = draft.manga.pages[activePage];
      if (panels && !panelGeometryLocked(panels[panelIndex])) {
        movePanelVertexWithSnap(panels, panelIndex, vertexIndex, x, y, linkPanels, targetPage.canvas);
        panels.forEach(panel=>syncPanelBleedAtTrim(panel,targetPage.canvas,getPrintSetup(draft.manga).bleed_mm));
      }
    });
  };
  const movePanelEdge = (panelIndex: number, edgeIndex: number, deltaX: number, deltaY: number, linkPanels = false, excludedEdge?: PanelEdgeReference) => {
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      const panels = targetPage?.panels;
      if (panels && !panelGeometryLocked(panels[panelIndex])) {
        const bleedMm=getPrintSetup(draft.manga).bleed_mm;
        movePanelEdgeGeometry(panels, panelIndex, edgeIndex, deltaX, deltaY, linkPanels, excludedEdge, targetPage.canvas, bleedMm);
        panels.forEach(panel=>syncPanelBleedAtTrim(panel,targetPage.canvas,bleedMm));
      }
    });
  };
  const selectPage=(index:number,panelIndex=0)=>layerTransition(async()=>{
    if(index===activePage){setTab('storyboard');setMobileStoryboardPane('editor');return;}
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();autoPaintResume.current=null;setActivePage(index);setActivePanel(panelIndex);setSelectedPanels([panelIndex]);setSelectedElement(null);setTab('storyboard');setMobileStoryboardPane('editor');
  });
  const voiceRevision=(withHistory=true)=>JSON.stringify({document:documentRef.current,activePage,activePanel,selectedElement,selectedPanels,tab,
    innerFrameSnap,panelGapSnap,panelSync,showGuides,spreadView,showNewDialog,projectBusy,qwenGeneration:Boolean(qwenGeneration),textTool,zoomTool,editingText,canvasZoomPercent,
    paint:paintController.current?.snapshot(),paintInteraction:paintController.current?.interactionRevision?.(),dragging:imageGesture.current.active,
    past:withHistory?past.length:undefined,future:withHistory?future.length:undefined});
  const latestVoiceRevision=useRef(voiceRevision);latestVoiceRevision.current=voiceRevision;
  const agentBlocked=()=>!hasDocument?'原稿を開いてください':showNewDialog||!historyAvailable()?'現在の処理を終えてください':
    paintSessionRef.current?'配置へ戻ってから操作してください':editingText||imageGesture.current.active?'現在の文字入力やドラッグを終えてください':null;
  const inspectAgent=()=>agentEditorSnapshot(hasDocument?documentRef.current:null,
    agentRevision.current(JSON.stringify({editor:voiceRevision(false),blocked:agentBlocked()})),
    activePage,selectedAgentBubble(activePage,activePanel,selectedElement),agentBlocked(),{panelIndex:activePanel,selection:selectedElement});
  const applyAgentBubbleEdit=(value:unknown)=>{
    const blocked=agentBlocked();if(blocked)throw Error(blocked);
    const snapshot=inspectAgent(),next=prepareAgentBubbleEdit(documentRef.current,selectedAgentBubble(activePage,activePanel,selectedElement),snapshot.revision,value);
    if(JSON.stringify(next)!==JSON.stringify(documentRef.current)){
      const before=workspaceSnapshot();setDocument(next,false);timeline.current.record(before);lastHistoryPush.current=0;changedHistory();
    }
    return inspectAgent();
  };
  async function applyVoiceCommand(command:VoiceCommand,isCurrent:()=>boolean=()=>true):Promise<string>{
    if(!hasDocument||showNewDialog||projectOperation.current||layerSwitch.current||imageImportBusy||qwenGeneration||
       (paintController.current&&!paintController.current.canRestore()))throw new Error('現在の処理が終わってから操作してください');
    if(command.op==='open_bubble_materials'){openBubbleMaterials();return '吹き出し素材を開きました';}
    if(command.op==='save')return await saveProject()??'保存を開始できませんでした';
    if(command.op==='undo'||command.op==='redo'){
      if(!(command.op==='undo'?past:future).length)return '対象の編集履歴がありません';
      if(!historyAvailable())throw new Error('現在の状態では編集履歴を変更できません');
      (command.op==='undo'?undo:redo)();return command.op==='undo'?'作業を元に戻しました':'作業をやり直しました';
    }
    if(command.op==='setting'){
      const state={panel_sync:panelSync,inner_frame_snap:innerFrameSnap,panel_gap_snap:panelGapSnap,guides:showGuides,spread:spreadView};
      if(state[command.key]===command.enabled)return 'すでに指定された設定です';
      if(command.key==='panel_sync')togglePanelSync();else if(command.key==='inner_frame_snap')toggleInnerFrameSnap();
      else if(command.key==='panel_gap_snap')togglePanelGapSnap();else if(command.key==='guides')changeShowGuides(command.enabled);else changeSpreadView(command.enabled);
      return '指定された表示・編集設定に変更しました';
    }
    if(command.op==='paint_tool'){
      if(!paintController.current?.selectTool)throw new Error('描画対象を選んでペイントを開いてから、ペンを切り替えてください');
      paintController.current.selectTool(command.tool);return command.tool==='pen'?'ラスターペンに切り替えました':'ベクターペンに切り替えました';
    }
    if(command.op==='generate_selected'){
      if(paintSessionRef.current)throw new Error('配置へ戻ってから操作してください');
      const target=resolveVoiceGenerationTarget(documentRef.current,activePage,activePanel,selectedElement,command);
      const captured=documentRef.current,revision=latestVoiceRevision.current();
      await connectAgentImageGeneration(isCurrent);
      if(!isCurrent()||documentRef.current!==captured||latestVoiceRevision.current()!==revision)throw new Error('作品や選択が変更されたため生成を中止しました');
      if(environmentOpen)closeEnvironmentSettings();
      return new Promise<string>((resolve,reject)=>{
        const agentRequest={isCurrent,resolve,reject};
        void requestOwnerGeneration(`${target.kind}-${target.index}`,target.overlay,target.panelIndex,target.pageIndex,agentRequest)
          .then(opened=>{if(!opened)reject(new Error('生成の準備を開けませんでした。通知を確認してください'));},reject);
      });
    }
    if(paintSessionRef.current)throw new Error('配置へ戻ってから操作してください');
    if(command.op==='page'){
      const target=command.target;
      const index=typeof target==='number'?document.manga.pages.findIndex(p=>p.page===target):target==='next'?activePage+1:target==='previous'?activePage-1:target==='first'?0:document.manga.pages.length-1;
      if(index<0||index>=document.manga.pages.length)throw new Error('指定されたページがありません');
      selectPage(index);return `${document.manga.pages[index].page}ページを表示しました`;
    }
    if(command.op==='artwork'){
      mutate(draft=>applyArtworkSettings(draft.manga,{...getArtworkSettings(draft.manga),mode:command.mode}));
      return command.mode==='draft'?'作画方式を下書き生成に変更しました':'作画方式を一体生成に変更しました';
    }
    if(command.op==='bubble_shape'||command.op==='bubble_text'){
      if(selectedElement?.type!=='bubble')throw new Error('変更するフキダシを一つ選択してください');
      const target:CanvasTextTarget={pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:'bubble',overlay:selectedElement.scope==='page_overlay'};
      if(!canvasTextEditable(documentRef.current,target,'agent'))throw new Error('対象のフキダシが非表示、または見つかりません');
      mutate(draft=>{if(command.op==='bubble_text')editCanvasText(draft,target,command.text,undefined,'agent');else{
        const bubble=canvasTextAt(draft,target) as import('../types').Bubble;bubble.shape=command.shape;delete bubble.bezier;
      }});
      return command.op==='bubble_text'?'フキダシの本文を変更しました':'フキダシの形を変更しました';
    }
    throw new Error('この操作の実行先がありません');
  }
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
