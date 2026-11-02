import {connectAgentImageGeneration} from '../lib/localBridge';
import type {QwenAgentRequest} from '../lib/qwenGeneration';
import VoiceCommands from './VoiceCommands';
import { isLanClient } from '../lib/clientRuntime';
import { browserWorkspaces, isBrowserWorkspace } from '../lib/browserWorkspace';
import { chooseBrowserFiles, downloadBrowserBlob, blobRevision } from '../lib/browserFiles';
import { createPortableProject, restorePortableProject } from '../lib/portableProject';
import { rememberBrowserCatalog, browserCatalogImageIds } from '../lib/browserCatalog';
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
import { namedBackgroundStages, prepareBackgroundStage, verifyBackgroundStage } from '../lib/background3d';
import { persistSeriesBackgroundModels } from '../lib/backgroundStageStore';
import PaintEditor, { PaintTools, PaintDetails, PaintStatus, type PaintResult } from './PaintEditor';
import { paintGenerationOwner, applyPaintAnchorIds, paintOwnerShouldClear, ensureDirectPaintOwner, movePaintEntry, validatePaintDocument, applyOwnerPaint, applyPaintOwnerLock, canvasPaintOwnerKey, clearOwnerPaint, figurePaintVisible, insertGeneratedPaintImage, generatedPaintName, hasAdoptedPaintImages, paintAssetIds, paintOwnerCanvasSelection, paintScene, withPaintBleed, type PaintScene, type PaintOwner } from '../lib/paintDocument';
import { paintColorMode } from '../lib/paintColor';
import PlacedImageList from './PlacedImageList';
import { imageAssetIds, setFigureArtwork, createFrameArtwork, createImagePlacement, prepareImageAsset, validateImagePlacements, validImageBox } from '../lib/imagePlacement';
import { fallbackBox, panelBounds } from '../lib/canvasGeometry';
import { overlayFallbackBox, resizePageCanvas } from '../lib/pageCanvas';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { BookOpen, Box, ChevronLeft, ChevronRight, ClipboardCheck, Download, FilePlus2, Files, FileText, FolderOpen, Images, LayoutPanelTop, ScanLine, Settings2, SlidersHorizontal, Sparkles, Trash2, UsersRound, X } from 'lucide-preact';
import Header from './Header';
import PrintSettingsEditor from './PrintSettingsEditor';
import { getPrintSetup, defaultPrintSetup, loadPrintPreferences, printSummary, savePrintPreferences, withPrintSetup, type PrintSetup } from '../lib/printSettings';
import { createProjectSnapshot, restoreProjectSnapshot, type ProjectBinding } from '../lib/projectPersistence';
import { saveEpisodeProject, loadEpisodeProject } from '../lib/localBridge';
import PageSidebar from './PageSidebar';
import MangaCanvas from './MangaCanvas';
import PanelInspector from './PanelInspector';
import {getOutputSettings} from '../lib/finishLayout.ts';
import QwenGenerationDialog, { qwenInputImage, qwenLayerImage, type GenerationPoseEditorContext } from './QwenGenerationDialog';
import { buildQwenGenerationPlan, qwenLayerCandidates, type QwenGenerationPlan, type QwenLayerCandidate, type QwenGenerationConversation, type QwenAdoption } from '../lib/qwenGeneration';
import { buildQwenCompositionPlan, captureQwenComposition, captureQwenCompositionCanvas, type QwenCompositionScope } from '../lib/qwenComposition';
import { downloadImageBlob, flattenedPsd, pageExportIndices, pageExportPixels, safeExportName, uncompressedZip, type ImageExportFormat } from '../lib/pageExport';
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
import { applyScenarioToNewDocument, confirmScenarioCorrespondence, detachResolvedScenarioLinks, parseScenario, rejectScenarioCorrespondence, restoreProvisionalScenarioText, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import { initializePanelBackgrounds } from '../lib/panelContext.ts';
import { initializeImportedBubbleLineBreaks } from '../lib/initialBubbleLineBreaks.ts';
import CharacterReadProgress, { type CharacterReadProgressState } from './CharacterReadProgress';
import NewLayoutAnalysisFeed from './NewLayoutAnalysisFeed';
import NewLayoutSourceImage from './NewLayoutSourceImage';
import { CharactersEditor, MetaEditor, PropsEditor, SettingEditor } from './DocumentEditors';
import { cloneDocument, MAX_PANELS_PER_PAGE, newPage, newPanel, parseMangaYaml, parseOmayYaml, toSeparatedMangaYaml, omnyFileName, toSeriesCatalogMangaYaml } from '../lib/manga';
import { clamp, DEFAULT_PANEL_GUTTERS, inferPanelGutters, movePanelEdge as movePanelEdgeGeometry, movePanelVertexWithSnap, resizePanelToBounds, roundMm, syncPanelBleedAtTrim, translatePanel, type PanelEdgeReference } from '../lib/canvasGeometry';
import { applyPanelTemplate, mergeSelectedPanels, PANEL_TEMPLATES, reconcileSplitOverlapFlags, splitPanel, type PanelSplitDirection, type PanelTemplate } from '../lib/panelTemplates';
import { analyzeFigureCharacterMatchWithLocalVlm, attachDetectedFiguresToPage, attachRecognizedTextToPage, beginSeriesCatalogDraft, cancelScannerSession, chooseEpisodeWorkspaceImages, chooseEpisodeWorkspaceSource, chooseSeriesDirectory, chooseSeriesReferenceText, collectScannerImages, commitScannerSession, commitSeriesCatalogDraft, discardPendingScannerSession, discardSeriesCatalogDraft, discardSeriesCatalogDraftOnPageExit, finishScannerSession, getPendingScannerSession, getSeriesCharacterTextStatus, linkSeriesCharacterText, listSeriesCatalogs, loadSeriesCatalog, openMacScanner, persistAnalogAsset, prepareEpisodeWorkspace, recognizePanelLayout, restoreSeriesCharacterText, resumePendingScannerSession, saveSeriesCatalog, saveSourceCoverageReport, selectEpisodeWorkspace, suggestEpisodeWorkspaceText, syncSeriesCharacterText, type DetectedFigureRegion, type EpisodeWorkspace, type EpisodeWorkspaceTextSelection, type LayoutRecognitionResult, type PendingScannerSession, type ReferenceTextSuggestion, type ScannerSession, type SeriesCatalogDraftSession, type SeriesCatalogSummary, type SeriesCharacterTextLink, type SeriesReferenceTextCandidate, type SeriesReferenceTextSelection } from '../lib/localBridge';
import { mergeSeriesCatalog, prefillEpisodeSettingFromSeries, prepareDocumentForSeriesSave, removeCharactersFromSeriesCatalog, removeMaterialsFromSeriesCatalog, upsertEpisodeIntoSeriesCatalog } from '../lib/seriesCatalog';
import { detectedFigureCrops, detectedFigureImport } from '../lib/analogFigureCrops';
import { prepareDetectedTextCrops } from '../lib/analogTextCrops';
import { separateBubbleOriginals } from '../lib/bubbleOriginals';
import { beginFigureCropImport, onFigureCropAssetsChanged, pruneFigureCropAssets, collectFigureCropAssetIds, deleteFigureCropAssets, loadFigureCropAsset, saveFigureCropAssets } from '../lib/figureCropStore';
import { spreadPartnerIndex as findSpreadPartnerIndex } from '../lib/pageSpread';
import { setPanelMaterialLink, type PanelMaterialLinkTarget } from '../lib/panelMaterialLinks';
import { isPropPlacement, synchronizeCatalogReferences } from '../lib/catalogModel';
import { panelDisplayLabel, textDisplayLabel } from '../lib/displayLabels';
import { createSystemMobCharacter } from '../lib/systemCharacters';
import { applyCharacterReadOutcomes, buildCharacterMatchCandidates, collectUnmatchedCharacterTargets, type CharacterReadOutcome } from '../lib/characterMatching';
import { parseSeriesSettingText, parseSeriesTitleText, parseStoryReferenceText, type ImportedSeriesSetting, type ImportedStorySetting } from '../lib/settingTextImport.ts';
import { replaceSeriesReferenceCandidate, seriesReferenceConfirmationState } from '../lib/seriesReferenceCandidates.ts';
import { buildSourceCoverageReport, sha256Hex, type SourceCoverageDecision, type SourceCoverageSource } from '../lib/sourceCoverage.ts';
import { characterArchiveDocument, mergeCharacterTextCatalog, parseCharacterText, seriesCharacterCatalogIds, toCharacterTextMarkdown } from '../lib/characterTextCatalog.ts';
import {
  startNewCreationBridgeSession,
  stopNewCreationBridgeSession,
  stopNewCreationBridgeSessionOnPageExit,
  withNewCreationBridgeSession,
} from '../lib/localBridgeLifecycle.ts';
import { createEmptyWorkspaceDocument, createInitialWorkspace, type WorkspaceStartupState } from '../lib/workspaceStartup.ts';
import type { AnalogFigureImport, AnalogTextImport, BBox, ImageAsset, BubbleTailTarget, CanvasElementSelection, MangaDocument, MangaSeriesSetting, PanelShape, WorkspaceTab } from '../types';

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

type MobileStoryboardPane = 'pages' | 'editor' | 'panel';
type NewLayoutTask = 'idle' | 'scanner' | 'analyzing' | 'creating';
type NewCreationStep = 'series' | 'characters' | 'setting' | 'layout';
type NewSeriesMode = '' | 'new' | 'existing' | 'none';
type NewLayoutSource = 'manual' | 'scanner';
type RightAngle = 0 | 90 | 180 | 270;

interface NewLayoutItem {
  id: string;
  file: File;
  source: NewLayoutSource;
  analysis: LayoutRecognitionResult | null;
  analyzing: boolean;
  rotationOverride: RightAngle;
  error?: string;
}

interface DetectedPageLayout {
  sourceItemId: string;
  analysis: LayoutRecognitionResult;
}

interface SeriesCatalogPersistOptions {
  deleteMaterialCatalogIds?: readonly string[];
  deleteCharacterCatalogIds?: readonly string[];
  seriesSetting?: MangaSeriesSetting;
  seriesDirectory?: string;
  seriesReference?: SeriesReferenceTextSelection | null;
}

type BoundEpisodeWorkspace = ProjectBinding;

interface NewSourceSnapshot {
  source: SourceCoverageSource;
  seriesMode: NewSeriesMode;
  workspaceDirectory: string;
  selectedByteSize: number;
  selectedSha256: string | null;
}

interface BoundSourceSnapshot extends NewSourceSnapshot {
  episodeId: string;
}

const NEW_LAYOUT_SPREAD_ORDER = [1, 0, 3, 2, 5, 4, 7, 6, 9, 8] as const;

function emptyNewWorkSetting(): ImportedStorySetting {
  return { location: '', time: '', weather: '', situation: '' };
}

function emptyNewSeriesSetting(): MangaSeriesSetting {
  return {
    genre: '',
    target_audience: '',
    adult_content: false,
    location: '',
    time: '',
    weather: '',
    situation: '',
  };
}

function seriesSettingFromImported(imported: ImportedSeriesSetting): MangaSeriesSetting {
  return {
    genre: imported.genre,
    target_audience: imported.targetAudience,
    adult_content: imported.adultContent,
    location: imported.location,
    time: imported.time,
    weather: imported.weather,
    situation: imported.situation,
  };
}

function fillEmptySeriesSetting(
  current: MangaSeriesSetting,
  incoming: MangaSeriesSetting,
): MangaSeriesSetting {
  return {
    genre: current.genre?.trim() ? current.genre : incoming.genre,
    target_audience: current.target_audience?.trim() ? current.target_audience : incoming.target_audience,
    adult_content: current.adult_content === true || incoming.adult_content === true,
    location: current.location.trim() ? current.location : incoming.location,
    time: current.time.trim() ? current.time : incoming.time,
    weather: current.weather.trim() ? current.weather : incoming.weather,
    situation: current.situation.trim() ? current.situation : incoming.situation,
  };
}

function seriesSettingSummary(setting: MangaSeriesSetting): string {
  return [setting.genre, setting.target_audience, setting.adult_content ? '成人指定' : '', setting.situation]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('・');
}

function detectedSeriesReferenceKind(selection: SeriesReferenceTextSelection): SeriesReferenceTextCandidate['kind'] {
  if (selection.kind) return selection.kind;
  // 人物の入力エラーは反映時に示し、候補の分類では画面を止めない。
  try {
    if (parseCharacterText(selection.text).length) return 'characters';
  } catch {
    return 'characters';
  }
  const setting = parseSeriesSettingText(selection.text);
  if (setting.genre || setting.targetAudience || setting.adultContent || setting.location
    || setting.time || setting.weather || setting.situation) return 'series-setting';
  return 'series-reference';
}

const seriesTitleFromReferences = (selections: readonly SeriesReferenceTextSelection[]): string => selections
  .map((selection) => parseSeriesTitleText(selection.text, detectedSeriesReferenceKind(selection) !== 'characters'))
  .find((title) => title.trim()) ?? '';

function withoutSeriesCharacter(source: MangaDocument, characterLocalId: string): MangaDocument {
  const next = cloneDocument(source);
  const character = next.manga.characters.find((entry) => entry.localId === characterLocalId);
  if (!character) return next;
  const catalogId = character.catalog_id;
  next.manga.characters = next.manga.characters.filter((entry) => entry.localId !== characterLocalId);
  next.manga.materials = next.manga.materials.filter((material) => (
    material.characterId !== characterLocalId
    && (!catalogId || material.character_catalog_id !== catalogId)
  ));
  synchronizeCatalogReferences(next);
  return next;
}

function displayedLayoutRotation(item: NewLayoutItem): RightAngle {
  return item.rotationOverride;
}

function layoutPreviewImageStyle(rotation: RightAngle) {
  if (rotation % 180 === 0) return { transform: `rotate(${rotation}deg)` };
  return {
    width: '141.4214%',
    height: '70.7107%',
    transform: `rotate(${rotation}deg)`,
  };
}

function nextLayoutIndexFromArrow(current: number, key: string, length: number): number {
  if (key === 'ArrowLeft' && current % 2 === 0 && current + 1 < length) return current + 1;
  if (key === 'ArrowRight' && current % 2 === 1) return current - 1;
  if (key === 'ArrowUp' && current >= 2) return current - 2;
  if (key === 'ArrowDown' && current + 2 < length) return current + 2;
  return current;
}

const INNER_FRAME_SNAP_KEY = 'manga-name-studio.inner-frame-snap.v1';
const PANEL_SYNC_KEY = 'manga-name-studio.panel-sync.v1';
const LEGACY_PANEL_SYNC_KEY = 'manga-name-studio.panel-snap.v1';
const PANEL_GAP_SNAP_KEY = 'manga-name-studio.panel-gap-snap.v1';
const SHOW_GUIDES_KEY = 'manga-name-studio.show-guides.v1';
const SPREAD_VIEW_KEY = 'manga-name-studio.spread-view.v2';
const LEGACY_SPREAD_VIEW_KEY = 'manga-name-studio.spread-view.v1';
const PERSIST_ANALOG_ASSETS_KEY = 'manga-name-studio.persist-analog-assets.v1';
const EPISODE_WORKSPACE_ROOTS_KEY = 'manga-name-studio.episode-workspace-roots.v1';
const PC_FONT_CATALOG_KEY = 'manga-name-studio.pc-font-catalog.v1';

function storedPcFontCatalog(): PcFontFamily[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PC_FONT_CATALOG_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PcFontFamily => Boolean(
      value && typeof value === 'object'
      && typeof (value as PcFontFamily).family === 'string'
      && ((value as PcFontFamily).displayName === undefined || typeof (value as PcFontFamily).displayName === 'string')
      && ((value as PcFontFamily).weights === undefined || Array.isArray((value as PcFontFamily).weights) && (value as PcFontFamily).weights!.every(option=>option&&typeof option.label==='string'&&Number.isInteger(option.value)&&option.value>=1&&option.value<=1000))
      && ['japanese', 'other', 'unreadable'].includes((value as PcFontFamily).support),
    ));
  } catch { /* private mode or an old malformed value */ }
  return [];
}

function rememberPcFontCatalog(families: readonly PcFontFamily[]): void {
  try { localStorage.setItem(PC_FONT_CATALOG_KEY, JSON.stringify(families)); } catch { /* private mode */ }
}

function savedWorkspaceRoot(key: string): string {
  try {
    const value = JSON.parse(localStorage.getItem(EPISODE_WORKSPACE_ROOTS_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const roots = value as Record<string, unknown>;
    const exact = roots[key];
    return typeof exact === 'string' ? exact : typeof roots._last === 'string' ? roots._last : '';
  } catch { /* private mode or an old malformed value */ }
  return '';
}

function rememberWorkspaceRoot(key: string, directory: string): void {
  if (!directory) return;
  try {
    const value = JSON.parse(localStorage.getItem(EPISODE_WORKSPACE_ROOTS_KEY) || '{}');
    const roots = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    roots[key] = directory;
    roots._last = directory;
    localStorage.setItem(EPISODE_WORKSPACE_ROOTS_KEY, JSON.stringify(roots));
  } catch { /* private mode */ }
}

function initialInnerFrameSnap(): boolean {
  try {
    return localStorage.getItem(INNER_FRAME_SNAP_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

function initialPanelSync(): boolean {
  try {
    const saved = localStorage.getItem(PANEL_SYNC_KEY);
    if (saved !== null) {
      localStorage.removeItem(LEGACY_PANEL_SYNC_KEY);
      return saved !== '0';
    }
    const legacy = localStorage.getItem(LEGACY_PANEL_SYNC_KEY);
    const enabled = legacy !== '0';
    localStorage.setItem(PANEL_SYNC_KEY, enabled ? '1' : '0');
    localStorage.removeItem(LEGACY_PANEL_SYNC_KEY);
    return enabled;
  } catch { /* private mode */ }
  return true;
}

function initialPanelGapSnap(): boolean {
  try {
    return localStorage.getItem(PANEL_GAP_SNAP_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

function initialShowGuides(): boolean {
  try {
    return localStorage.getItem(SHOW_GUIDES_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

function initialSpreadView(): boolean {
  try {
    const saved = localStorage.getItem(SPREAD_VIEW_KEY);
    if (saved !== null) return saved !== '0';
    // 旧版は見開きOFFが初期値だったため引き継がず、今回の作品向け初期値へ更新する。
    localStorage.removeItem(LEGACY_SPREAD_VIEW_KEY);
  } catch { /* private mode */ }
  return true;
}

function initialPersistAnalogAssets(): boolean {
  try {
    return localStorage.getItem(PERSIST_ANALOG_ASSETS_KEY) === '1';
  } catch { /* private mode */ }
  return false;
}


function TemplateThumb({ shapes, figures = [], frameLineWidthMm }: { shapes: readonly PanelShape[]; figures?: readonly DetectedFigureRegion[]; frameLineWidthMm?: number }) {
  const frameStyle = frameLineWidthMm === undefined ? undefined : { strokeWidth: Math.max(1, frameLineWidthMm * 4) };
  return <svg viewBox="0 0 210 297" aria-hidden="true">
    {shapes.map((shape, index) => shape.type === 'rect'
      ? <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} style={frameStyle} />
      : <polygon key={index} points={shape.points.map((point) => point.join(',')).join(' ')} style={frameStyle} />)}
    {figures.map((figure, index) => <rect class="detected-figure-thumb" key={`figure-${index}`} x={figure.bbox.x * 210} y={figure.bbox.y * 297} width={figure.bbox.w * 210} height={figure.bbox.h * 297} rx="2" />)}
  </svg>;
}

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

interface WorkspacePaintSession {document:MangaDocument;pageIndex:number;panelIndex:number;overlay:boolean;scene:PaintScene;initialOwner?:string;title:string;resume?:PaintSessionSnapshot;images?:PaintImages}
interface WorkspaceSnapshot {document:MangaDocument;textSelection?:CanvasTextTarget;paint?:Omit<WorkspacePaintSession,'document'|'scene'|'resume'|'images'>&{state:PaintSessionSnapshot}}

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
      if (qwenGeneration || environmentOpen) return;
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
  }, [document, past, future, paintSession, qwenGeneration, showNewDialog, pendingScannerSession, newLayoutItems.length, newLayoutActiveIndex, newLayoutTask, selectedPanels, selectedElement, activePage, activePanel, tab, environmentOpen]);

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

  const continueFromSeriesSelection = async () => {
    if (newSeriesPreparing) return;
    if (!newEpisodeWorkspace) {
      setNewWorkspaceMessage('このエピソードの保存先を選んでください。');
      return;
    }
    if (newSeriesMode === 'none') {
      const draft = createNewCharacterDraft('', '');
      setNewSeriesName('');
      setNewSeriesId('');
      setNewCharacterDocument(draft);
      setNewCharacterTextLink(null);
      setNewCreationStep('characters');
      return;
    }
    if (newSeriesMode === 'new' && !newSeriesName.trim()) {
      setSeriesCatalogMessage(isLanClient ? 'シリーズ名を入力してください。' : 'シリーズ名を含む資料（例：シリーズ名：作品名）を反映してください。');
      return;
    }
    if (newSeriesMode === 'existing' && !newSeriesId) {
      setSeriesCatalogMessage('追加先のシリーズを選んでください。');
      return;
    }
    const selected = newSeriesMode === 'existing'
      ? seriesCatalogs.find((item) => item.seriesId === newSeriesId)
      : undefined;
    const seriesName = selected?.seriesName ?? newSeriesName.trim();
    const seriesId = selected?.seriesId ?? (newSeriesId || crypto.randomUUID());
    setNewSeriesPreparing(true);
    setSeriesCatalogMessage('登場人物を準備しています…');
    let draftSession: SeriesCatalogDraftSession | null = null;
    try {
      const draft = createNewCharacterDraft(seriesName, seriesId);
      const merged = await mergeSavedSeriesCatalog(draft);
      let preparedDocument = merged.document;
      const references = newSeriesReferences.length
        ? newSeriesReferences
        : newSeriesReference ? [newSeriesReference] : [];
      for (const reference of references) {
        preparedDocument = mergeCharacterTextCatalog(
          preparedDocument,
          parseCharacterText(reference.text),
        ).document;
        preparedDocument.manga.series_setting = fillEmptySeriesSetting(
          preparedDocument.manga.series_setting,
          seriesSettingFromImported(parseSeriesSettingText(reference.text)),
        );
      }
      setNewWorkSetting((current) => prefillEpisodeSettingFromSeries(current, preparedDocument.manga.series_setting));
      const resolvedSeriesId = preparedDocument.manga.meta.series_id || seriesId;
      if (!isLanClient) draftSession = await beginSeriesCatalogDraft(seriesName, resolvedSeriesId, draft.manga.meta.episode_id);
      newCharacterDraftSession.current = draftSession;
      setNewSeriesName(seriesName);
      setNewSeriesId(resolvedSeriesId);
      setNewCharacterDocument(preparedDocument);
      if (isLanClient) { setNewCharacterTextLink(null); }
      else if (newSeriesMode === 'existing') {
        const status = await getSeriesCharacterTextStatus(preparedDocument.manga.meta.series_id || seriesId).catch(() => null);
        setNewCharacterTextLink(status?.linked || status?.needsRelink || status?.deletedCharacters.length ? status : null);
      } else if (newSeriesReference) {
        setNewCharacterTextLink({
          linked: true,
          needsRelink: false,
          seriesId: resolvedSeriesId,
          seriesDirectory: newSeriesReference.seriesDirectory,
          relativePath: newSeriesReference.relativePath,
          fileName: newSeriesReference.fileName,
          text: newSeriesReference.text,
          deletedCharacters: [],
        });
      } else {
        setNewCharacterTextLink(null);
      }
      setSeriesCatalogMessage(merged.warning || '');
      setNewCreationStep('characters');
    } catch (error) {
      if (draftSession) {
        await discardSeriesCatalogDraft(draftSession.token).catch(() => undefined);
        if (newCharacterDraftSession.current?.token === draftSession.token) newCharacterDraftSession.current = null;
      }
      setSeriesCatalogMessage(error instanceof Error ? error.message : '登場人物を準備できませんでした。');
    } finally {
      setNewSeriesPreparing(false);
    }
  };

  const patchNewCharacterDocument = (recipe: (draft: MangaDocument) => boolean | void): MangaDocument => {
    const latest = newCharacterDocumentRef.current;
    if (!latest) throw new Error('新規作成中の人物台帳がありません');
    const next = cloneDocument(latest);
    if (recipe(next) === false) return latest;
    synchronizeCatalogReferences(next);
    setNewCharacterDocument(next);
    return next;
  };

  const returnToSeriesSelection = async () => {
    if (seriesCatalogSaving) return;
    setSeriesCatalogMessage('保存していない人物データを破棄しています…');
    try {
      await discardNewCharacterDraft();
      setNewCharacterDocument(null);
      setNewCharacterTextLink(null);
      setSeriesCatalogMessage('');
      setNewCreationStep('series');
    } catch (error) {
      setToast(`保存していない人物データを破棄できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const persistSeriesCatalogNow = async (
    source: MangaDocument,
    options: SeriesCatalogPersistOptions = {},
  ): Promise<MangaDocument> => {
    let prepared = prepareDocumentForSeriesSave(source);
    if (isLanClient && showNewDialog) return prepared;
    const seriesName = prepared.manga.meta.series.trim();
    if (!seriesName) return prepared;
    const loaded = await loadSeriesCatalog(seriesName, prepared.manga.meta.series_id);
    if (loaded.seriesId) prepared.manga.meta.series_id = loaded.seriesId;
    let catalogSource = prepared;
    if (loaded.found && loaded.omnyYaml) {
      const withoutMaterials = removeMaterialsFromSeriesCatalog(
        parseMangaYaml(loaded.omnyYaml),
        options.deleteMaterialCatalogIds ?? [],
      );
      const existing = removeCharactersFromSeriesCatalog(
        withoutMaterials,
        options.deleteCharacterCatalogIds ?? [],
      );
      const upserted = upsertEpisodeIntoSeriesCatalog(existing, prepared);
      if (upserted.conflicts.length) {
        throw new Error(`同名で別IDのシリーズ項目があります: ${upserted.conflicts.join('、')}`);
      }
      catalogSource = upserted.document;
    }
    if (options.seriesSetting) catalogSource.manga.series_setting = structuredClone(options.seriesSetting);
    if (!isLanClient) await persistSeriesBackgroundModels(catalogSource,prepared.manga.meta.series_id);
    for(const stage of prepared.manga.background_stages??[]){const saved=catalogSource.manga.background_stages?.find(item=>item.id===stage.id);if(saved?.seriesId)stage.seriesId=saved.seriesId;}
    const saved = await saveSeriesCatalog(
      seriesName,
      prepared.manga.meta.series_id,
      toSeriesCatalogMangaYaml(catalogSource, { seriesSetting: options.seriesSetting }),
      loaded.revision,
      {
        seriesDirectory: options.seriesDirectory,
        seriesTextRelativePath: options.seriesReference?.relativePath,
      },
    );
    prepared.manga.meta.series_id = saved.seriesId;
    return prepared;
  };

  const persistSeriesCatalog = async (
    source: MangaDocument,
    options: SeriesCatalogPersistOptions = {},
  ): Promise<MangaDocument> => {
    seriesCatalogPendingCount.current += 1;
    setSeriesCatalogSaving(true);
    const task = seriesCatalogSaveQueue.current.then(() => {
      const latest = documentRef.current;
      const sameEpisode = latest.manga.meta.episode_id && source.manga.meta.episode_id
        ? latest.manga.meta.episode_id === source.manga.meta.episode_id
        : latest.manga.meta.title.trim() === source.manga.meta.title.trim();
      const sameOpenEpisode = latest.manga.meta.series.trim() === source.manga.meta.series.trim()
        && sameEpisode;
      const selected = sameOpenEpisode ? latest : source;
      const catalogIdsToDelete = options.deleteMaterialCatalogIds ?? [];
      const characterIdsToDelete = options.deleteCharacterCatalogIds ?? [];
      const withoutMaterials = catalogIdsToDelete.length
        ? removeMaterialsFromSeriesCatalog(selected, catalogIdsToDelete)
        : selected;
      const preparedSource = characterIdsToDelete.length
        ? removeCharactersFromSeriesCatalog(withoutMaterials, characterIdsToDelete)
        : withoutMaterials;
      return persistSeriesCatalogNow(preparedSource, options);
    });
    seriesCatalogSaveQueue.current = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } finally {
      seriesCatalogPendingCount.current = Math.max(0, seriesCatalogPendingCount.current - 1);
      setSeriesCatalogSaving(seriesCatalogPendingCount.current > 0);
    }
  };

  const persistNewCharacterCatalog = async (
    source: MangaDocument,
    options: Omit<SeriesCatalogPersistOptions, 'seriesSetting'> = {},
  ): Promise<MangaDocument> => {
    const prepared = await persistSeriesCatalog(source, {
      ...options,
      seriesSetting: structuredClone(source.manga.series_setting),
      seriesDirectory: newSeriesDirectory || newEpisodeWorkspace?.seriesDirectory,
      seriesReference: newSeriesReference,
    });
    setNewCharacterDocument(prepared);
    return prepared;
  };

  const withCharacterTextBridge = async <T,>(task: () => Promise<T>): Promise<T> => {
    if (isLanClient) return task();
    if (newCreationBridgeToken.current || characterEditorBridgeToken.current) return task();
    const session = await startNewCreationBridgeSession();
    try {
      return await task();
    } finally {
      await stopNewCreationBridgeSession(session.token).catch(() => undefined);
    }
  };

  const syncCharacterText = async (
    source: MangaDocument,
    archive?: { characterCatalogId: string; characterName: string; omnyYaml: string },
  ): Promise<SeriesCharacterTextLink | null> => {
    const seriesId = source.manga.meta.series_id;
    if (isLanClient || !source.manga.meta.series.trim() || !seriesId) return null;
    return withCharacterTextBridge(() => syncSeriesCharacterText(
      seriesId,
      toCharacterTextMarkdown(source),
      seriesCharacterCatalogIds(source),
      archive,
    ));
  };

  const linkCharacterText = async (
    source: MangaDocument,
    defaultDirectory: string,
    apply: (next: MangaDocument) => void,
    applyLink: (next: SeriesCharacterTextLink | null) => void,
  ) => {
    if (!source.manga.meta.series.trim()) {
      setToast('シリーズ共通人物だけが人物テキストと連携できます');
      return;
    }
    if (isLanClient) {
      try {
        const selected = await chooseLocalText();
        if (!selected) return;
        const merged = mergeCharacterTextCatalog(source, parseCharacterText(await selected.file.text()));
        apply(await (showNewDialog ? persistNewCharacterCatalog : persistSeriesCatalogNow)(merged.document));
        applyLink(null); setToast(`${selected.file.name}から人物を読み込みました。作品を保存すると反映されます`);
      } catch (error) { setToast(`人物を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`); }
      return;
    }
    setCharacterTextBusy(true);
    try {
      await withCharacterTextBridge(async () => {
        const persistForCurrentFlow = showNewDialog
          ? persistNewCharacterCatalog
          : persistSeriesCatalogNow;
        const prepared = await persistForCurrentFlow(source);
        const seriesId = prepared.manga.meta.series_id;
        if (!seriesId) throw new Error('シリーズの保存先を準備できませんでした');
        const linked = await linkSeriesCharacterText(prepared.manga.meta.series, seriesId, defaultDirectory);
        if (!linked) return;
        const imported = parseCharacterText(linked.text);
        const merged = mergeCharacterTextCatalog(prepared, imported);
        const saved = await persistForCurrentFlow(merged.document);
        const synced = showNewDialog ? linked : await syncSeriesCharacterText(
          saved.manga.meta.series_id,
          toCharacterTextMarkdown(saved),
          seriesCharacterCatalogIds(saved),
        );
        apply(saved);
        applyLink(synced);
        setToast(imported.length
          ? `${linked.fileName}から人物${imported.length}名を読み込み、シリーズ人物台帳と連携しました`
          : `${linked.fileName}をシリーズ人物台帳として連携しました`);
      });
    } catch (error) {
      setToast(`人物テキストを連携できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setCharacterTextBusy(false);
    }
  };

  const deleteSeriesCharacter = async (
    source: MangaDocument,
    characterLocalId: string,
    apply: (next: MangaDocument) => void,
    applyLink: (next: SeriesCharacterTextLink | null) => void,
  ) => {
    const character = source.manga.characters.find((entry) => entry.localId === characterLocalId);
    if (!character?.catalog_id || !source.manga.meta.series_id) return;
    setCharacterTextBusy(true);
    try {
      await withCharacterTextBridge(async () => {
        const archiveDocument = characterArchiveDocument(source, character.catalog_id!);
        const next = withoutSeriesCharacter(source, characterLocalId);
        if (showNewDialog || isLanClient) {
          const saved = await (showNewDialog ? persistNewCharacterCatalog : persistSeriesCatalogNow)(next, { deleteCharacterCatalogIds: [character.catalog_id!] });
          apply(saved);
          setToast(`「${character.name}」を削除しました。保存しなければ元に戻ります`);
          return;
        }
        const synced = await syncSeriesCharacterText(
          source.manga.meta.series_id,
          toCharacterTextMarkdown(next),
          seriesCharacterCatalogIds(next),
          {
            characterCatalogId: character.catalog_id!,
            characterName: character.name,
            omnyYaml: toSeriesCatalogMangaYaml(archiveDocument),
          },
        );
        const saved = await persistSeriesCatalogNow(next, { deleteCharacterCatalogIds: [character.catalog_id!] });
        apply(saved);
        applyLink(synced);
        setToast(`「${character.name}」を削除しました。30日以内なら復元できます`);
      });
    } catch (error) {
      setToast(`人物を削除できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setCharacterTextBusy(false);
    }
  };

  const restoreDeletedCharacter = async (
    source: MangaDocument,
    deletionId: string,
    apply: (next: MangaDocument) => void,
    applyLink: (next: SeriesCharacterTextLink | null) => void,
  ) => {
    const seriesId = source.manga.meta.series_id;
    if (!seriesId) return;
    setCharacterTextBusy(true);
    try {
      await withCharacterTextBridge(async () => {
        const restored = await restoreSeriesCharacterText(seriesId, deletionId);
        if (!restored.found) throw new Error('復元期限を過ぎたか、復元データが見つかりません');
        const archived = parseMangaYaml(restored.omnyYaml);
        const merged = mergeSeriesCatalog(source, archived).document;
        const saved = await persistSeriesCatalogNow(merged);
        const synced = await syncSeriesCharacterText(
          saved.manga.meta.series_id,
          toCharacterTextMarkdown(saved),
          seriesCharacterCatalogIds(saved),
        );
        apply(saved);
        applyLink(synced);
        setToast(`「${restored.characterName}」を復元しました`);
      });
    } catch (error) {
      setToast(`人物を復元できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    } finally {
      setCharacterTextBusy(false);
    }
  };

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

  const saveNewCharacters = async () => {
    const latest = newCharacterDocumentRef.current;
    if (!latest) return;
    try {
      const prepared = await persistNewCharacterCatalog(latest);
      if (newCharacterTextLink?.linked) {
        const synced = await syncCharacterText(prepared);
        if (synced) setNewCharacterTextLink(synced);
      }
      await commitNewCharacterDraft();
      if (!isLanClient && prepared.manga.meta.series.trim() && prepared.manga.meta.series_id) {
        try {
          newCharacterDraftSession.current = await beginSeriesCatalogDraft(
            prepared.manga.meta.series,
            prepared.manga.meta.series_id,
            prepared.manga.meta.episode_id,
          );
        } catch (error) {
          setToast(`登場人物は保存しましたが、続きの仮編集を準備できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
          return;
        }
      }
      setToast('登場人物を保存しました');
    } catch (error) {
      setToast(`登場人物を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const continueFromNewCharacters = async () => {
    const latest = newCharacterDocumentRef.current;
    if (!latest || seriesCatalogSaving) return;
    try {
      const prepared = await persistNewCharacterCatalog(latest);
      setNewCharacterDocument(prepared);
      if (newCharacterTextLink?.linked) {
        const synced = await syncCharacterText(prepared);
        if (synced) setNewCharacterTextLink(synced);
      }
      if (newSeriesMode !== 'none') {
        setNewWorkSetting((current) => prefillEpisodeSettingFromSeries(current, prepared.manga.series_setting));
      }
      setNewCreationStep('setting');
    } catch (error) {
      setToast(`登場人物を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const updateNewWorkSetting = (key: keyof ImportedStorySetting, value: string) => {
    setNewWorkSetting((current) => ({ ...current, [key]: value }));
    setNewSettingMessage('');
  };

  const updateNewSeriesSetting = (key: 'genre' | 'target_audience' | 'situation', value: string) => {
    patchNewCharacterDocument((draft) => {
      draft.manga.series_setting[key] = value;
    });
    setNewSettingMessage('');
  };

  const readNewReferenceFile = async (selection?: EpisodeWorkspaceTextSelection) => {
    if (!selection) return;
    const { file } = selection;
    try {
      const text = await file.text();
      setNewSourceSnapshot({
        source: { fileName: file.name, relativePath: selection.relativePath, text },
        seriesMode: newSeriesMode,
        workspaceDirectory: newEpisodeWorkspace?.directory ?? '',
        selectedByteSize: selection.byteSize,
        selectedSha256: selection.sha256,
      });
      setNewReferenceFileName(file.name);
      setNewSuggestedEpisodeReference(null);
      const imported = parseStoryReferenceText(text);
      const scenario = parseScenario(text);
      const applied = [
        imported.seriesTitle,
        imported.subtitle,
        imported.episodeNumber,
        ...Object.values(imported.setting),
      ].filter((value) => value.trim()).length;
      if (!applied && !scenario) {
        setNewReferenceMessage(`${file.name}を資料テキストとして保持します。シナリオは「# シナリオ」の下にページ・コマごとに記載してください。`);
        return;
      }
      if (newSeriesMode === 'new' && imported.seriesTitle) {
        setNewSeriesName(seriesTitleFromReferences(newSeriesReferences) || imported.seriesTitle);
      }
      if (newSeriesMode === 'none') setNewWorkTitle(imported.subtitle || imported.seriesTitle);
      else if (imported.subtitle) setNewWorkTitle(imported.subtitle);
      if (imported.episodeNumber) setNewEpisodeNumber(imported.episodeNumber);
      setNewWorkSetting((current) => ({
        location: imported.setting.location || current.location,
        time: imported.setting.time || current.time,
        weather: imported.setting.weather || current.weather,
        situation: imported.setting.situation || current.situation,
      }));
      const fields = [
        imported.seriesTitle ? 'タイトル' : '',
        imported.subtitle ? 'サブタイトル' : '',
        imported.episodeNumber ? '話数' : '',
        Object.values(imported.setting).some((value) => value.trim()) ? '舞台設定' : '',
        scenario ? `シナリオ（${scenario.panels.length}コマ・セリフ${scenario.panels.reduce((sum, panel) => sum + panel.dialogues.length, 0)}件）` : '',
      ].filter(Boolean).join('・');
      setNewReferenceMessage(`${file.name}から${fields}を読み込みました。`);
      setNewSettingMessage('');
    } catch (error) {
      setNewReferenceMessage(`読み込めませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const applySuggestedReferenceTexts = async () => {
    if (newSuggestedEpisodeReference) {
      const mediaType = /\.(?:md|markdown)$/iu.test(newSuggestedEpisodeReference.fileName) ? 'text/markdown' : 'text/plain';
      const bytes = new TextEncoder().encode(newSuggestedEpisodeReference.text);
      await readNewReferenceFile({
        file: new File([bytes], newSuggestedEpisodeReference.fileName, { type: mediaType }),
        relativePath: newSuggestedEpisodeReference.relativePath,
        byteSize: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      });
    }
  };

  const continueFromNewSetting = async () => {
    if (!newWorkSetting.situation.trim()) {
      setNewSettingMessage('あらすじを入力してください。');
      return;
    }
    try {
      if (newSeriesMode !== 'none') {
        const latest = newCharacterDocumentRef.current;
        if (!latest) throw new Error('シリーズの舞台を確認できません');
        await persistNewCharacterCatalog(latest);
      }
      setNewSettingMessage('');
      setNewCreationStep('layout');
    } catch (error) {
      setNewSettingMessage(`シリーズの舞台を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const applyPreparedSeriesIdentifiers = (prepared: MangaDocument): MangaDocument | null => {
    const latest = documentRef.current;
    const sameEpisode = latest.manga.meta.episode_id && prepared.manga.meta.episode_id
      ? latest.manga.meta.episode_id === prepared.manga.meta.episode_id
      : latest.manga.meta.title.trim() === prepared.manga.meta.title.trim();
    if (latest.manga.meta.series.trim() !== prepared.manga.meta.series.trim() || !sameEpisode) return null;
    const next = cloneDocument(latest);
    let changed = false;
    const assign = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]) => {
      if (value !== undefined && target[key] !== value) {
        target[key] = value;
        changed = true;
      }
    };
    assign(next.manga.meta, 'series_id', prepared.manga.meta.series_id);
    assign(next.manga.meta, 'episode_id', prepared.manga.meta.episode_id);
    for(const stage of prepared.manga.background_stages??[]){const target=next.manga.background_stages?.find(item=>item.id===stage.id);if(target&&stage.seriesId)assign(target,'seriesId',stage.seriesId);}
    prepared.manga.characters.filter((entry) => entry.scope === 'series').forEach((entry) => {
      const target = next.manga.characters.find((candidate) => (
        (entry.localId && candidate.localId === entry.localId)
        || (entry.catalog_id && candidate.catalog_id === entry.catalog_id)
      ));
      if (target) assign(target, 'catalog_id', entry.catalog_id);
    });
    prepared.manga.materials.filter((entry) => entry.scope === 'series').forEach((entry) => {
      const target = next.manga.materials.find((candidate) => (
        (entry.localId && candidate.localId === entry.localId)
        || (entry.catalog_id && candidate.catalog_id === entry.catalog_id)
      ));
      if (!target) return;
      assign(target, 'catalog_id', entry.catalog_id);
      assign(target, 'character_catalog_id', entry.character_catalog_id);
      if (entry.origin && JSON.stringify(target.origin) !== JSON.stringify(entry.origin)) {
        target.origin = structuredClone(entry.origin);
        changed = true;
      }
    });
    if (changed) setDocument(next);
    return changed ? next : latest;
  };

  const saveCatalogFromEditor = async (label:string) => {
    endTextEdit();
    const source=documentRef.current;
    if (isLanClient || !source.manga.meta.series.trim()) {
      await saveProjectAction.current();
      return;
    }
    try {
      const persist=()=>persistSeriesCatalog(source, {
        seriesSetting: structuredClone(source.manga.series_setting),
      });
      const prepared=!isLanClient&&label==='舞台設定'?await withNewCreationBridgeSession(persist):await persist();
      const applied = applyPreparedSeriesIdentifiers(prepared);
      const savedDocument = applied ?? documentRef.current;
      if (label==='人物設定'&&characterTextLink?.linked) {
        const synced = await syncCharacterText(savedDocument);
        if (synced) setCharacterTextLink(synced);
      }
      setToast(`${label}を保存しました`);
    } catch (error) {
      setToast(`${label}を保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const saveCharactersFromEditor=()=>saveCatalogFromEditor('人物設定');
  const saveBackgroundsFromEditor=()=>saveCatalogFromEditor('舞台設定');
  const importBackgroundModel=async(materialId:string,file:File)=>{
    if(projectOperation.current)throw new Error('保存・読み込みが終わってから登録してください');
    const episodeId=documentRef.current.manga.meta.episode_id;
    projectOperation.current=true;setProjectBusy(true);
    const finishImageImport=beginFigureCropImport();
    try{
      const item=await prepareBackgroundStage(file);
      const {loadStageShape}=await import('../lib/background3dRenderer');
      await loadStageShape(item.stage,item.blob);
      const current=documentRef.current;
      if(current.manga.meta.episode_id!==episodeId||!current.manga.materials.some(material=>material.localId===materialId&&material.type==='background'))throw new Error('登録先の背景が変更されたため読み込みを中止しました');
      const existing=current.manga.background_stages?.find(stage=>stage.id===item.stage.id);
      await saveFigureCropAssets([{id:existing?.storageId??item.stage.storageId,blob:item.blob}]);
      patchLatestDocument(draft=>{
        if(draft.manga.meta.episode_id!==episodeId)throw new Error('登録先の作品が変わりました');
        const material=draft.manga.materials.find(entry=>entry.localId===materialId&&entry.type==='background');
        if(!material)throw new Error('登録先の背景が見つかりません');
        const stages=draft.manga.background_stages??=[];
        if(!stages.some(stage=>stage.id===item.stage.id))stages.push(item.stage);
        material.source_stage_id=item.stage.id;
      });
      setToast('背景の3Dモデルを登録しました');
    }finally{projectOperation.current=false;setProjectBusy(false);finishImageImport();}
  };

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

  const createNewDocument = async (
    layout?: PanelTemplate | DetectedPageLayout[],
    confirmScannedLayouts = false,
    analysisGeneration?: number,
  ) => {
    const continuingAnalysis = analysisGeneration !== undefined;
    if (newLayoutTaskRef.current !== (continuingAnalysis ? 'analyzing' : 'idle')
      || (continuingAnalysis && analysisGeneration !== newLayoutOperationGeneration.current)
      || !newPrintConfirmed || editingNewPrintSetup) return;
    const finishImageImport=beginFigureCropImport();
    try {
    const generation = analysisGeneration ?? ++newLayoutOperationGeneration.current;
    const isCurrentOperation = () => generation === newLayoutOperationGeneration.current;
    updateNewLayoutTask('creating');
    if (!newEpisodeWorkspace) {
      setNewLayoutMessage('エピソードの保存先をもう一度選んでください。');
      updateNewLayoutTask('idle');
      return;
    }
    setNewLayoutMessage(isLanClient ? '作品を準備しています…' : '制作フォルダを準備しています…');
    try {
      if (isLanClient) await browserWorkspaces.prepare(newEpisodeWorkspace.token);
      else await prepareEpisodeWorkspace(newEpisodeWorkspace.token);
    } catch (error) {
      if (!isCurrentOperation()) return;
      setNewLayoutMessage(error instanceof Error ? error.message : '制作フォルダを準備できませんでした');
      updateNewLayoutTask('idle');
      return;
    }
    if (!isCurrentOperation()) return;
    const analyzedItems = [...newLayoutItemsRef.current];
    const detectedLayouts = Array.isArray(layout) ? layout : [];
    const template = layout && !Array.isArray(layout) ? layout : undefined;
    const characterDraft = newCharacterDocumentRef.current;
    const freshEpisodeId = characterDraft?.manga.meta.episode_id || crypto.randomUUID();
    const usedSourceItemIds = new Set(detectedLayouts.map((item) => item.sourceItemId));
    if (!detectedLayouts.length && template && analyzedItems[0]?.analysis) usedSourceItemIds.add(analyzedItems[0].id);
    const figureImportsByItem = new Map<string, Map<string, AnalogFigureImport>>();
    const textImportsByItem = new Map<string, Map<string, AnalogTextImport>>();
    const savedAssetIds: string[] = [];
    const discardStaleAssets = async () => {
      await deleteFigureCropAssets(savedAssetIds).catch(() => undefined);
    };
    try {
      for (const item of analyzedItems) {
        if (!usedSourceItemIds.has(item.id) || !item.analysis) continue;
        if (item.analysis.detectedFigures.length) {
          figureImportsByItem.set(item.id, new Map(item.analysis.detectedFigures.map(
            region => [region.id, detectedFigureImport(item.id, region)],
          )));
        }
        if (item.analysis.ocrLines.length) {
          setNewLayoutMessage(`${item.file.name} から手書き文字の参照画像を作っています…`);
          const prepared = await prepareDetectedTextCrops(item.file, item.rotationOverride, item.id, item.analysis.ocrLines);
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          await saveFigureCropAssets(prepared.map((crop) => crop.asset));
          savedAssetIds.push(...prepared.map((crop) => crop.asset.id));
          if (!isLanClient && persistAnalogAssets) {
            for (const crop of prepared) {
              crop.metadata.persistentAsset = await persistAnalogAsset(
                crop.asset.blob,
                freshEpisodeId,
                newWorkTitle.trim(),
                'texts',
                crop.asset.id,
              );
            }
          }
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          textImportsByItem.set(item.id, new Map(prepared.map((crop) => [crop.lineId, crop.metadata])));
        }
      }
    } catch (error) {
      await deleteFigureCropAssets(savedAssetIds).catch(() => undefined);
      if (!isCurrentOperation()) return;
      updateNewLayoutTask('idle');
      setNewLayoutMessage(`原画参照を保存できなかったため、原画は破棄していません。${error instanceof Error ? error.message : ''}`.trim());
      return;
    }
    const finishScannerImport = async () => {
      try {
        if (!isCurrentOperation()) { await discardStaleAssets(); return false; }
        if (confirmScannedLayouts) await commitActiveScannerSession();
        else await discardScannerSources();
        if (!isCurrentOperation()) { await discardStaleAssets(); return false; }
        return true;
      } catch (error) {
        await discardStaleAssets();
        if (isCurrentOperation()) {
          updateNewLayoutTask('idle');
          setNewLayoutMessage(error instanceof Error ? error.message : 'スキャン処理を完了できませんでした');
        }
        return false;
      }
    };
    if (!figureImportsByItem.size && !(await finishScannerImport())) return;
    const empty = createEmptyWorkspaceDocument();
    let importedFigureCount = 0;
    let importedTextCount = 0;
    let reviewTextCount = 0;
    const pages = detectedLayouts.length ? detectedLayouts.map((detectedLayout, index) => {
      const page = newPage(index + 1);
      page.panels = detectedLayout.analysis.detectedPanels.map((shape, panelIndex) => ({
        id: panelIndex + 1,
        shape: structuredClone(shape),
        bg: 1,
        bubbles: [],
        action: null,
      }));
      const ownerPanels = new Map(detectedLayout.analysis.detectedPanelIds.map((id, panelIndex) => [id, page.panels[panelIndex]]));
      if (detectedLayout.analysis.detectedFigures.length) {
        importedFigureCount += attachDetectedFiguresToPage(
          page,
          detectedLayout.analysis.detectedFigures,
          figureImportsByItem.get(detectedLayout.sourceItemId),
          detectedLayout.analysis.sourceFrame,
          ownerPanels,
        ).added;
      }
      if (detectedLayout.analysis.ocrLines.length) {
        const attached = attachRecognizedTextToPage(
          page,
          detectedLayout.analysis.ocrLines,
          textImportsByItem.get(detectedLayout.sourceItemId),
          detectedLayout.analysis.sourceFrame,
          ownerPanels,
        );
        importedTextCount += attached.added;
        reviewTextCount += attached.needsReview;
      }
      return page;
    }) : Array.from({ length: newPrintSetup.purpose === 'illustration' ? 1 : newPrintSetup.body_pages }, (_, index) => newPage(index + 1, analyzedItems[0]?.analysis ? undefined : { w: newPrintSetup.width_mm, h: newPrintSetup.height_mm }));
    if (!detectedLayouts.length) {
      if (template) {
        for (const page of pages) {
          page.panels = [];
          applyPanelTemplate(page, template);
        }
        const analysis = analyzedItems[0]?.analysis;
        if (analysis?.detectedFigures.length) {
          importedFigureCount += attachDetectedFiguresToPage(
            pages[0],
            analysis.detectedFigures,
            figureImportsByItem.get(analyzedItems[0].id),
            analysis.sourceFrame,
          ).added;
        }
        if (analysis?.ocrLines.length) {
          const attached = attachRecognizedTextToPage(
            pages[0],
            analysis.ocrLines,
            textImportsByItem.get(analyzedItems[0].id),
            analysis.sourceFrame,
          );
          importedTextCount += attached.added;
          reviewTextCount += attached.needsReview;
        }
      } else {
        for (const page of pages) page.panels[0].bubbles = [];
      }
    }
    // Imported positions are in the analysis canvas, including OCR retained with a template.
    // Map them together before print setup; pages already created at the target size are unchanged.
    for (const page of pages) resizePageCanvas(page, { w: newPrintSetup.width_mm, h: newPrintSetup.height_mm }, 'inner-frame');
    const creationGutters = detectedLayouts.length
      ? { rowGapMm: newLayoutRowGapMm, columnGapMm: newLayoutColumnGapMm }
      : inferPanelGutters(
        pages[0].panels.map((item) => item.shape),
        template ? { rowGapMm: 5, columnGapMm: 5 } : DEFAULT_PANEL_GUTTERS,
      );
    const fresh: MangaDocument = {
      manga: {
        schema_name: empty.manga.schema_name,
        schema_version: empty.manga.schema_version,
        meta: {
          document_type: 'story',
          title: newWorkTitle.trim(),
          series: newSeriesName.trim(),
          series_id: newSeriesName.trim() ? (newSeriesId || crypto.randomUUID()) : '',
          episode_number: newEpisodeNumber.trim(),
          episode_id: freshEpisodeId,
          author: '', format: empty.manga.meta.format, page_count: pages.length,
          reading_direction: empty.manga.meta.reading_direction,
          text_orientation: empty.manga.meta.text_orientation,
          font: empty.manga.meta.font,
          bubble_line_width_mm: empty.manga.meta.bubble_line_width_mm,
          panel_frame_width_mm: newLayoutFrameLineWidthMm,
          panel_gutter_row_mm: creationGutters.rowGapMm,
          panel_gutter_column_mm: creationGutters.columnGapMm,
          style_notes: [],
        },
        layout_spec: '',
        series_setting: characterDraft
          ? structuredClone(characterDraft.manga.series_setting)
          : emptyNewSeriesSetting(),
        setting: structuredClone(newWorkSetting),
        characters: characterDraft
          ? structuredClone(characterDraft.manga.characters)
          : [createSystemMobCharacter()],
        materials: characterDraft
          ? structuredClone(characterDraft.manga.materials)
          : [],
        pages,
      },
    };
    const seriesMerge = await mergeSavedSeriesCatalog(withPrintSetup(fresh, newPrintSetup));
    if (!isCurrentOperation()) { await discardStaleAssets(); return; }
    const characterReadTargets = collectUnmatchedCharacterTargets(seriesMerge.document);
    initializePanelBackgrounds(seriesMerge.document);
    const characterCandidates = buildCharacterMatchCandidates(seriesMerge.document.manga.characters);
    const characterReadOutcomes = new Map<string, CharacterReadOutcome>();
    const readTargetsByRegion = new Map(characterReadTargets.map(target => [target.sourceRegionId, target]));
    const persistedFigures = new Map<string, NonNullable<AnalogFigureImport['persistentAsset']>>();
    try {
      for (const item of analyzedItems) {
        const imports = figureImportsByItem.get(item.id);
        if (!imports || !item.analysis) continue;
        for await (const crop of detectedFigureCrops(item.file, item.rotationOverride, item.analysis.detectedFigures)) {
          const metadata = imports.get(crop.regionId)!;
          const target = readTargetsByRegion.get(metadata.sourceRegionId);
          if (target) {
            setNewLayoutMessage('人物と演技を読み取っています…');
            setNewCharacterReadProgress({ completed: characterReadOutcomes.size, total: characterReadTargets.length, startedAt: Date.now() });
            try {
              const suggestion = await analyzeFigureCharacterMatchWithLocalVlm(
                await crop.original(), characterCandidates, target.currentSize, await crop.face(),
              );
              const { candidateId, confidence, action, suggestedSize, reason, expressionReading } = suggestion;
              characterReadOutcomes.set(target.sourceRegionId, { ok: true, candidateId, confidence, action, suggestedSize, reason, expressionReading });
            } catch (error) {
              characterReadOutcomes.set(target.sourceRegionId, {
                ok: false,
                error: error instanceof Error ? error.message : '人物と演技を読み取れませんでした',
              });
            }
          }
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          const blob = await crop.forStorage();
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          await saveFigureCropAssets([{ id: metadata.assetId, blob }]);
          savedAssetIds.push(metadata.assetId);
          if (!isLanClient && persistAnalogAssets) {
            persistedFigures.set(metadata.assetId, await persistAnalogAsset(blob, freshEpisodeId, newWorkTitle.trim(), 'figures', metadata.assetId));
          }
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
        }
      }
    } catch (error) {
      await discardStaleAssets();
      if (!isCurrentOperation()) return;
      updateNewLayoutTask('idle');
      setNewLayoutMessage(`原画参照を保存できなかったため、原画は破棄していません。${error instanceof Error ? error.message : ''}`.trim());
      return;
    }
    if (figureImportsByItem.size && !(await finishScannerImport())) return;
    if (persistedFigures.size) {
      for (const page of seriesMerge.document.manga.pages) {
        for (const owner of [...page.panels, page.page_overlay]) {
          for (const figure of owner?.figures ?? []) {
            const metadata = figure.analogImport;
            const ref = metadata && persistedFigures.get(metadata.assetId);
            if (metadata && ref) metadata.persistentAsset = ref;
          }
        }
      }
    }
    setNewCharacterReadProgress(characterReadTargets.length ? { completed: characterReadTargets.length, total: characterReadTargets.length, startedAt: Date.now() } : null);
    const characterRead = applyCharacterReadOutcomes(seriesMerge.document, characterReadOutcomes);
    const scenarioResult = newSourceSnapshot
      && (isLanClient || newSourceSnapshot.workspaceDirectory === newEpisodeWorkspace?.directory)
      ? applyScenarioToNewDocument(seriesMerge.document, {
        version: 1, fileName: newSourceSnapshot.source.fileName, text: newSourceSnapshot.source.text,
      }) : null;
    if (seriesMerge.document.manga.scenario) reviewTextCount = scenarioResult?.review ?? 0;
    initializeImportedBubbleLineBreaks(seriesMerge.document);
    setNewLayoutMessage('原本ラスターとベクターの吹き出しを分離しています…');
    try {
      seriesMerge.document=await separateBubbleOriginals(seriesMerge.document);
      if(!isCurrentOperation()){await discardStaleAssets();return;}
    }catch(error){
      updateNewLayoutTask('idle');
      setNewLayoutMessage(error instanceof Error?error.message:'原本レイヤーを作成できませんでした');
      return;
    }
    setNewLayoutMessage('人物データの保存を確定しています…');
    try {
      if (newCharacterTextLink?.linked && characterDraft) {
        const synced = await syncCharacterText(characterDraft);
        if (synced) setNewCharacterTextLink(synced);
      }
      await commitNewCharacterDraft();
    } catch (error) {
      await discardStaleAssets();
      updateNewLayoutTask('idle');
      setNewLayoutMessage(`人物データの保存を確定できませんでした。${error instanceof Error ? error.message : ''}`.trim());
      return;
    }
    let coverageSaveWarning = '';
    if (!isLanClient && newEpisodeWorkspace && newSourceSnapshot && !seriesMerge.document.manga.scenario) {
      try {
        if (newSourceSnapshot.workspaceDirectory !== newEpisodeWorkspace.directory) {
          throw new Error('原文を選んだ保存先と現在のエピソード保存先が一致しません');
        }
        const initialCoverage = await buildSourceCoverageReport(
          newSourceSnapshot.source,
          seriesMerge.document,
          { omnyYaml: toSeparatedMangaYaml(seriesMerge.document) },
        );
        await saveSourceCoverageReport(
          newEpisodeWorkspace.token,
          seriesMerge.document.manga.meta.episode_id,
          initialCoverage,
        );
      } catch (error) {
        coverageSaveWarning = `原文確認reportは自動保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`;
      }
    }
    let bridgeStopWarning = '';
    setNewLayoutMessage('ローカル連携を終了しています…');
    try {
      await endNewCreationBridgeSession();
    } catch (error) {
      bridgeStopWarning = `ローカル連携を終了できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`;
    }
    lastHistoryPush.current = 0;
    replaceDocument(seriesMerge.document);
    setBoundEpisodeWorkspace({ ...newEpisodeWorkspace, episodeId: seriesMerge.document.manga.meta.episode_id });
    setBoundSourceSnapshot(newSourceSnapshot ? {
      ...newSourceSnapshot,
      episodeId: seriesMerge.document.manga.meta.episode_id,
      workspaceDirectory: newEpisodeWorkspace?.directory ?? '',
    } : null);
    setSourceCoverageDecisions([]);
    setCharacterTextLink(newCharacterTextLink);
    setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setSelectedElement(null); setTab('storyboard'); setMobileStoryboardPane('editor'); setShowNewDialog(false);
    setNewCharacterDocument(null);
    discardNewLayoutItems();
    updateNewLayoutTask('idle');
    const creationMessage = detectedLayouts.length
      ? `検出したコマ領域から${detectedLayouts.length}ページを新規作成しました`
      : template ? `パターン${template.id}で新規作成しました` : 'まっさらな漫画を作成しました';
    const importedDetails = [
      importedFigureCount ? `人物あたり${importedFigureCount}件` : '',
      importedTextCount ? `文字候補${importedTextCount}件` : '',
      characterReadTargets.length ? `人物・演技${characterReadTargets.length}件` : '',
      seriesMerge.added ? `シリーズ共通人物・資料${seriesMerge.added}件` : '',
      scenarioResult?.matched ? `シナリオのセリフ${scenarioResult.matched}件` : '',
      scenarioResult?.actions ? `ト書き${scenarioResult.actions}コマ` : '',
    ].filter(Boolean).join('、');
    const completedMessage = importedDetails
      ? `${creationMessage}。${importedDetails}を配置しました${reviewTextCount || characterRead.needsReview ? `（${[reviewTextCount ? `OCR仮入力${reviewTextCount}件` : '', characterRead.needsReview ? `人物要確認${characterRead.needsReview}件` : ''].filter(Boolean).join('、')}）` : ''}${seriesMerge.warning ? `。${seriesMerge.warning}` : ''}`
      : `${creationMessage}${seriesMerge.warning ? `。${seriesMerge.warning}` : ''}`;
    const completionWarnings = [coverageSaveWarning, bridgeStopWarning].filter(Boolean).join('。');
    setToast(completionWarnings ? `${completedMessage}。${completionWarnings}` : completedMessage);
    } finally { finishImageImport(); }
  };

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
  const pageExportBlob = async(current:MangaDocument,pageIndex:number,format:ImageExportFormat) => {
    const page=current.manga.pages[pageIndex];
    if(!page)throw new Error('書き出すページが見つかりません');
    const setup=getPrintSetup(current.manga),size=pageExportPixels(setup.width_mm,setup.height_mm,setup.dpi),guides:Record<string,boolean>={};
    page.panels.forEach((panel,index)=>['background',...(panel.figures??[]).map((_,i)=>`figure-${i}`),...panel.bubbles.map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`${index}:${key}`]=false;}));
    const overlay=page.page_overlay;[...(overlay?.figures??[]).map((_,i)=>`figure-${i}`),...(overlay?.bubbles??[]).map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`overlay:${key}`]=false;});
    const canvas=await captureQwenCompositionCanvas(current.manga,pageIndex,Math.min(activePanelRef.current,Math.max(0,page.panels.length-1)),'page',guides,{...size,includeGenerated:true});
    try{
      let blob:Blob;
      if(format==='psd'){
        const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('ページ画像を読み出せませんでした');
        blob=flattenedPsd(context.getImageData(0,0,canvas.width,canvas.height),setup.dpi,paintColorMode(setup.format));
      }else blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNGを書き出せませんでした')),'image/png'));
      const name=safeExportName(`${current.manga.meta.title||'manga'}-page-${String(page.page).padStart(3,'0')}-${setup.width_mm}x${setup.height_mm}mm-${setup.dpi}dpi`);
      return {blob,name:`${name}.${format}`,page:page.page};
    }finally{canvas.width=canvas.height=1;}
  };
  const openImageExportDialog=()=>{
    endTextEdit();
    const page=activePageRef.current+1;
    setImageExportDialog({mode:'current',from:page,to:page,format:'png'});
  };
  const exportPageRange=async()=>{
    const choice=imageExportDialog;if(!choice||imageExportBusy)return;
    endTextEdit();
    const current=documentRef.current;
    try{
      setImageExportBusy(true);
      const indices=pageExportIndices(current.manga.pages.length,{...choice,current:activePageRef.current+1}),files:Array<{name:string;bytes:Uint8Array;blob:Blob;page:number}>=[];
      for(let position=0;position<indices.length;position++){
        if(documentRef.current!==current)throw new Error('作品が変更されました。ページ範囲を選び直してください');
        setToast(`画像を書き出しています… ${position+1}/${indices.length}`);
        const result=await pageExportBlob(current,indices[position],choice.format);
        files.push({...result,bytes:new Uint8Array(await result.blob.arrayBuffer())});
      }
      if(files.length===1)downloadImageBlob(files[0].blob,files[0].name);
      else{
        const first=String(files[0].page).padStart(3,'0'),last=String(files.at(-1)!.page).padStart(3,'0');
        downloadImageBlob(uncompressedZip(files.map(({name,bytes})=>({name,bytes}))),`${safeExportName(current.manga.meta.title||'manga')}-pages-${first}-${last}-${choice.format}.zip`);
      }
      setImageExportDialog(null);
      setToast(files.length===1?`ページ ${files[0].page} を${choice.format.toUpperCase()}で書き出しました`:`ページ ${files[0].page}〜${files.at(-1)!.page} を${choice.format.toUpperCase()}のZIPで書き出しました`);
    }catch(error){setToast(error instanceof Error?error.message:'画像を書き出せませんでした');}
    finally{setImageExportBusy(false);}
  };
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
    if(!projectOperation.current&&event.target.closest('[data-project-save],[data-project-history],[data-environment-settings],[data-voice-command],.guide-display-control,.panel-controls summary,.panel-snap-setting,.workspace-tabs'))return;
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

  return <PaintEditor onAddOutside={action=>{const s=paintSessionRef.current;if(!s)return;const page=documentRef.current.manga.pages[s.pageIndex],panel=page.panels[s.panelIndex];if(!panel)return;actOnLayer(s.panelIndex,{...action,key:'page',position:{stack:{beforePanel:`panel-${panel.id}`}}},makePaintScene(documentRef.current,s.panelIndex,s.pageIndex,true),true);}} selectedBubbleStroke={selectedBubbleStroke} resume={paintSession?.resume} resumeImages={paintSession?.images} historySteps={historySteps} sharedHistory={{checkpoint:recordPaint,undo,redo,canUndo:past.length>0,canRedo:future.length>0}} stages={namedBackgroundStages(document)} zoomTool={zoomTool} bubblePathTool={bubblePathTool} onSelectBubblePath={chooseBubblePathTool} toolPaletteEnabled={hasDocument&&tab==='storyboard'&&!showNewDialog} textTool={textTool} textTools={<PaintTextTools active={textTool} openRequest={textPaletteRequest} disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} select={chooseTextTool} onClose={closeTextTool} onMaterials={openBubbleMaterials} bubbleLineWidthMm={bubbleLineWidthMm} onChangeBubbleLineWidth={value=>changePanelStyleNumber('bubble_line_width_mm',value)}/>} onStartPaint={()=>{endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);return Boolean(paintSessionRef.current)||openPaint();}} onSelectLayout={chooseLayoutTool} onToggleBubble={(index,group)=>{const s=paintSessionRef.current;if(s)toggleTextLayer({pageIndex:s.pageIndex,panelIndex:s.panelIndex,index,overlay:s.overlay,kind:'bubble'},group);}} onSelectOwner={(key,native)=>{const s=paintSessionRef.current;if(s)selectLayerOwner(key,s.panelIndex,s.pageIndex,s.overlay,native);}} onSelectFigure={index=>{const s=paintSessionRef.current;if(s)selectCanvasElement({type:'figure',index,...(s.overlay?{scope:'page_overlay' as const}:{})},s.panelIndex,s.pageIndex);}} onReorderOwners={(key,target,after)=>{const session=paintSessionRef.current;if(session)reorderOwnerLayers(session.panelIndex,key,target,after,session.overlay);}} embeddedLayers onReady={()=>{const action=pendingLayerAction.current;pendingLayerAction.current=null;if(action)paintController.current?.layerAction(action);}} onEditText={index=>{const s=paintSessionRef.current;if(s)startBubbleEdit({pageIndex:s.pageIndex,panelIndex:s.panelIndex,bubbleIndex:index,overlay:s.overlay});}} controller={paintController} smoothing={paintSmoothing} cursorMode={paintCursorMode} guideVisible={key=>artworkGuideVisible(key,paintSession?.panelIndex,paintSession?.pageIndex,paintSession?.overlay)} onToggleGuide={key=>toggleArtworkGuide(key,paintSession?.panelIndex,paintSession?.pageIndex,paintSession?.overlay)} initial={paintSession?.scene} initialOwner={paintSession?.initialOwner} assets={document.manga.image_assets??[]} title={paintSession?.title??''} page={paintSession?document.manga.pages[paintSession.pageIndex].page:0} panelIndex={paintSession?.panelIndex??-1} overlay={paintSession?.overlay??false} suspended={Boolean(qwenGeneration)||projectBusy||environmentOpen||layerSwitchBusy} onGenerate={(owner,images,pendingAssets)=>{const session=paintSessionRef.current;return session?prepareQwen(session.document,session.pageIndex,session.panelIndex,session.overlay,owner,images,pendingAssets):Promise.reject(new Error('描画先が見つかりません'));}} onApply={applyPaint} onClose={()=>{pendingLayerAction.current=null;paintSessionRef.current=null;setPaintSession(null);}}>
    <PaintToolHelp enabled={editGuide}/><div class={`app-shell ${hasDocument ? '' : 'is-startup'} ${paintSession?'is-painting':''} ${showNewDialog ? 'is-creating' : ''} ${environmentOpen ? 'is-environment-open' : ''}`} onPointerOverCapture={autoPaintBoundary} onFocusCapture={autoPaintBoundary} onKeyDown={environmentKeyDown} onClickCapture={guardDuringPaint} onPointerDownCapture={guardDuringPaint} onKeyDownCapture={guardDuringPaint} onInputCapture={guardDuringPaint} onPasteCapture={guardDuringPaint}>
    <Header onSettings={toggleEnvironmentSettings} settingsOpen={environmentOpen} workspaceBlocked={environmentOpen || showNewDialog || Boolean(imageExportDialog)} hasDocument={hasDocument} busy={projectBusy||imageImportBusy||imageExportBusy} saveDirectory={isLanClient ? boundEpisodeWorkspace?.folderName : boundEpisodeWorkspace?.directory} canUndo={hasDocument && past.length > 0} canRedo={hasDocument && future.length > 0} onUndo={undo} onRedo={redo}
      onImportImage={()=>{void layerTransition(async()=>{if(paintSessionRef.current)await paintController.current?.close();endTextEdit();choosePlacedImage('page');});}}
      onExportImage={()=>{void layerTransition(async()=>{if(paintSessionRef.current)await paintController.current?.close();endTextEdit();openImageExportDialog();});}}
      onNew={openNewDialog} onOpen={openProject} onSave={() => saveProject()} />
    <input ref={placedImageInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => void importPlacedImage(event.currentTarget.files?.[0])} />
    {imageExportDialog&&<div class="image-export-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget&&!imageExportBusy)setImageExportDialog(null);}}>
      <section class="image-export-dialog" role="dialog" aria-modal="true" aria-labelledby="image-export-title" onKeyDown={event=>{if(event.key==='Escape'&&!imageExportBusy){event.preventDefault();setImageExportDialog(null);}}}>
        <header><div><h2 id="image-export-title">画像を書き出す</h2><p>ページ範囲と画像形式を選びます。</p></div><button type="button" class="icon-button" aria-label="閉じる" disabled={imageExportBusy} onClick={()=>setImageExportDialog(null)}><X size={18}/></button></header>
        <fieldset><legend>書き出すページ</legend>
          <label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='current'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'current'})}/>現在のページ（PAGE {String(activePage+1).padStart(2,'0')}）</label>
          <label class="image-export-range-choice"><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='range'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'range'})}/><span>範囲</span><span class="image-export-page-input">PAGE <input aria-label="開始ページ" type="number" min="1" max={document.manga.pages.length} value={imageExportDialog.from} disabled={imageExportDialog.mode!=='range'||imageExportBusy} onInput={event=>setImageExportDialog({...imageExportDialog,from:event.currentTarget.valueAsNumber})}/></span><span>〜</span><span class="image-export-page-input">PAGE <input aria-label="終了ページ" type="number" min="1" max={document.manga.pages.length} value={imageExportDialog.to} disabled={imageExportDialog.mode!=='range'||imageExportBusy} onInput={event=>setImageExportDialog({...imageExportDialog,to:event.currentTarget.valueAsNumber})}/></span></label>
          <label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='all'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'all'})}/>全ページ（{document.manga.pages.length}ページ）</label>
        </fieldset>
        <fieldset><legend>画像形式</legend><div class="image-export-format" role="radiogroup">
          {(['png','psd'] as const).map(format=><label><input type="radio" name="image-export-format" checked={imageExportDialog.format===format} disabled={imageExportBusy} onChange={()=>setImageExportDialog({...imageExportDialog,format})}/><strong>{format.toUpperCase()}</strong><span>{format==='png'?'一般的な統合画像':'Photoshop／CLIP STUDIO向け統合画像'}</span></label>)}
        </div></fieldset>
        <p class="image-export-note">複数ページは1つのZIPにまとめます。用紙サイズと解像度は作品の印刷設定を使います。</p>
        <footer><button type="button" class="secondary-button" disabled={imageExportBusy} onClick={()=>setImageExportDialog(null)}>キャンセル</button><button type="button" class="primary-button" disabled={imageExportBusy} onClick={()=>void exportPageRange()}><Download size={17}/>{imageExportBusy?'書き出し中…':'書き出す'}</button></footer>
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
            : <PanelInspector onTextCategory={changeSelectedTextCategory} onSelectedText={changeSelectedTextBody} onHandwrittenHistoryBoundary={()=>{lastHistoryPush.current=0;}} onGenerateText={(kind,index)=>void requestTextGeneration(kind,index,false,activePanel)} generationBusy={Boolean(qwenGeneration)||imageImportBusy||projectBusy} onOpenBackground3d={()=>openPanelBackground3d(activePanel)} panelControls={<PanelControls painting={Boolean(paintSession)} innerFrameSnap={innerFrameSnap} panelGapSnap={panelGapSnap} panelSync={panelSync} onToggleInnerFrameSnap={toggleInnerFrameSnap} onTogglePanelGapSnap={togglePanelGapSnap} onTogglePanelSync={togglePanelSync} selectedCount={selectedPanels.length} onMerge={mergeSelectedPanelGroup} splitDirection={panelSplitDirection} onSplitDirection={setPanelSplitDirection} onSplit={splitActivePanel}/>} imageImportBusy={imageImportBusy} panelDraftToolbarTarget={null} painting={Boolean(paintSession)} guideVisible={key=>artworkGuideVisible(key,activePanel,activePage,false)} onToggleGuide={key=>toggleArtworkGuide(key,activePanel,activePage,false)} onScenarioChoice={chooseScenarioBubble} manga={document.manga} panel={panel} pageIndex={activePage} panelIndex={activePanel} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} episodeWorkspaceToken={!isLanClient && boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.token : ''} episodeWorkspaceFolder={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.folderName : ''} seriesId={document.manga.meta.series_id} episodeId={document.manga.meta.episode_id} getOmnySnapshot={getOmnySnapshot} onChooseEpisodeWorkspace={choosePanelDraftWorkspace} onSelectElement={setSelectedElement} onChange={(nextPanel,origin='manual') => mutate((draft) => { const current=draft.manga.pages[activePage]?.panels[activePanel];if(current&&(origin==='agent'||!panelLocked(current)))draft.manga.pages[activePage].panels[activePanel] = nextPanel; })} onOpenBackgrounds={() => openMaterialsForPanel('background')} onOpenProps={() => openMaterialsForPanel('prop')} onAdd={addPanel} onDelete={deletePanel} />}</div></aside>
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
        <div class="new-dialog-navigation">
          <ol class="new-creation-steps" aria-label="新規作成の手順">
            <li class={newCreationStep === 'series' ? 'is-active' : ''} aria-current={newCreationStep === 'series' ? 'step' : undefined}><span>1</span>シリーズ</li>
            <li class={newCreationStep === 'characters' ? 'is-active' : ''} aria-current={newCreationStep === 'characters' ? 'step' : undefined}><span>2</span>登場人物</li>
            <li class={newCreationStep === 'setting' ? 'is-active' : ''} aria-current={newCreationStep === 'setting' ? 'step' : undefined}><span>3</span>舞台設定</li>
            <li class={newCreationStep === 'layout' ? 'is-active' : ''} aria-current={newCreationStep === 'layout' ? 'step' : undefined}><span>4</span>ページ設定</li>
          </ol>
          <div class="new-step-toolbar">
            <div class="new-step-heading">
              <h3 id="new-creation-step-title">{{ series: 'シリーズ', characters: '登場人物', setting: '舞台設定', layout: 'ページ設定' }[newCreationStep]}</h3>
              <p>{{ series: '作品の種類・保存先・資料を選びます。', characters: '人物の設定と資料を確認します。', setting: '舞台と今回のあらすじを確認します。', layout: '用紙サイズや印刷条件を設定します。' }[newCreationStep]}</p>
            </div>
            <nav class="new-step-navigation" aria-label="作成手順の移動">
              <button type="button" class="secondary-button" disabled={newCreationStep === 'series' || seriesCatalogSaving || newLayoutTask !== 'idle'} onClick={() => {
                if (newCreationStep === 'characters') void returnToSeriesSelection();
                else if (newCreationStep === 'setting') setNewCreationStep('characters');
                else if (newCreationStep === 'layout') {
                  if (editingNewPrintSetup && newPrintConfirmed) setEditingNewPrintSetup(false);
                  else setNewCreationStep('setting');
                }
              }}><ChevronLeft size={15} aria-hidden="true" />戻る</button>
              <div class="new-step-forward">
                {newCreationStep === 'series' && <button type="submit" form="new-series-form" class="primary-button" disabled={!newSeriesMode || !newEpisodeWorkspace || newSeriesPreparing || newWorkspaceSelecting}>{newSeriesPreparing ? '準備中…' : '次へ'}<ChevronRight size={15} aria-hidden="true" /></button>}
                {newCreationStep === 'characters' && <button type="button" class="primary-button" disabled={seriesCatalogSaving || characterTextBusy} onClick={() => void continueFromNewCharacters()}>{seriesCatalogSaving ? '保存中…' : '次へ'}<ChevronRight size={15} aria-hidden="true" /></button>}
                {newCreationStep === 'setting' && <button type="submit" form="new-setting-form" class="primary-button" disabled={seriesCatalogSaving || !newWorkSetting.situation.trim()}>{seriesCatalogSaving ? '保存中…' : '次へ'}<ChevronRight size={15} aria-hidden="true" /></button>}
                {newCreationStep === 'layout' && editingNewPrintSetup && <button type="submit" form="new-print-form" class="primary-button" disabled={newLayoutTask !== 'idle'}>設定完了</button>}
              </div>
            </nav>
          </div>
        </div>
        <div class="new-dialog-body" key={newCreationStep}>
          <div class="new-creation-content">
          {newCreationStep === 'series' && <form id="new-series-form" class="new-series-step" aria-labelledby="new-creation-step-title" onSubmit={(event) => { event.preventDefault(); void continueFromSeriesSelection(); }} onKeyDown={(event) => {
            const target = event.target as HTMLElement;
            if (event.key !== 'Enter' || event.isComposing || (target.tagName !== 'INPUT' && target.tagName !== 'SELECT')) return;
            event.preventDefault();
            void continueFromSeriesSelection();
          }}>
            <div class="new-series-mode-grid">
              <button type="button" class={newSeriesMode === 'new' ? 'is-selected' : ''} onClick={() => { clearNewReferenceText(); clearNewSeriesReference(); setNewCharacterTextLink(null); setNewSeriesMode('new'); setNewSeriesName(''); setNewSeriesId(crypto.randomUUID()); setNewEpisodeWorkspace(null); setNewWorkspaceMessage(''); setSeriesCatalogMessage(''); }}><FilePlus2 size={18} aria-hidden="true" /><strong>新しいシリーズ</strong></button>
              <button type="button" class={newSeriesMode === 'existing' ? 'is-selected' : ''} onClick={() => { clearNewReferenceText(); clearNewSeriesReference(); setNewCharacterTextLink(null); setNewSeriesMode('existing'); setNewSeriesName(''); setNewSeriesId(''); setNewEpisodeWorkspace(null); setNewWorkspaceMessage(''); setSeriesCatalogMessage(seriesCatalogs.length ? '' : '保存済みシリーズはまだありません。'); }}><Files size={18} aria-hidden="true" /><strong>既存シリーズ</strong></button>
              <button type="button" class={newSeriesMode === 'none' ? 'is-selected' : ''} onClick={() => { clearNewReferenceText(); clearNewSeriesReference(); setNewCharacterTextLink(null); setNewSeriesMode('none'); setNewSeriesName(''); setNewSeriesId(''); setNewEpisodeWorkspace(null); setNewWorkspaceMessage(''); setSeriesCatalogMessage(''); }}><FileText size={18} aria-hidden="true" /><strong>読み切り</strong></button>
            </div>
            {(newSeriesMode === 'new' || newSeriesMode === 'existing') && <section class="new-creation-topic" aria-labelledby="new-series-topic-title">
              <h4 id="new-series-topic-title"><span>シリーズ</span>{newSeriesName.trim() && <span class="new-creation-topic-name">{`「　${newSeriesName.trim()}　」`}</span>}</h4>
              {newSeriesMode === 'existing' && <label class="new-series-field"><span>シリーズ名</span><select value={newSeriesId} onChange={(event) => {
                void selectExistingSeries(event.currentTarget.value);
              }}><option value="">選択してください</option>{seriesCatalogs.map((item) => <option value={item.seriesId} key={item.seriesId}>{item.seriesName}</option>)}</select></label>}
              {isLanClient && newSeriesMode === 'new' && <label class="new-series-field"><span>シリーズ名</span><input value={newSeriesName} onInput={event => setNewSeriesName(event.currentTarget.value)} /></label>}
              {(newSeriesMode === 'new' || newSeriesId) && <>
                <div class="new-creation-row" aria-label="シリーズフォルダ">
                  <strong>保存先</strong>
                  <span class="new-creation-value" >{newSeriesDirectory.split('/').filter(Boolean).at(-1) || 'フォルダを選択してください。'}</span>
                  <button class="new-creation-change" type="button" onClick={() => void chooseNewSeriesDirectory()} disabled={newSeriesDirectorySelecting || newSeriesReferenceSelecting || newSeriesPreparing || newWorkspaceSelecting}><FolderOpen size={15} aria-hidden="true" />{newSeriesDirectorySelecting ? '選択中…' : newSeriesDirectory ? '変更' : '選択'}</button>
                </div>
                {newSeriesDirectoryMessage && <p class="new-workspace-message" role="status">{newSeriesDirectoryMessage}</p>}
                {(isLanClient || newSeriesDirectory) && <div class="new-creation-references" aria-label="シリーズの設定資料">
                  <div class="new-creation-reference-list">
                  {newSeriesReferenceRows.map((reference) => <div class="new-creation-reference-row" key={reference.relativePath}>
                    <label class="new-creation-reference-label">
                      <input
                        type="checkbox"
                        aria-label={`${reference.fileName}を選択`}
                        checked={newSelectedSeriesReferencePaths.includes(reference.relativePath)}
                        disabled={newSeriesReferenceBusy}
                        onChange={() => setNewSelectedSeriesReferencePaths((current) => current.includes(reference.relativePath)
                          ? current.filter((path) => path !== reference.relativePath)
                          : [...current, reference.relativePath])}
                      />
                      <span class="new-creation-file-name" >{reference.fileName}</span>
                    </label>
                  </div>)}
                  </div>
                  <div class="new-creation-reference-actions">
                    {newSeriesReferenceMessage && <p class="new-reference-message" role="status">{newSeriesReferenceMessage}</p>}
                    <button class="new-creation-change" type="button" onClick={() => void chooseNewSeriesReferenceTextFile()} disabled={newSeriesReferenceBusy}><FilePlus2 size={15} aria-hidden="true" />{newSeriesReferenceSelecting ? '選択中…' : newSeriesReferenceRows.length ? '資料を追加' : '資料を選択'}</button>
                    <button class="new-creation-change" type="button" aria-label="選択した資料を変更"  disabled={newSeriesReferenceBusy || selectedNewSeriesReferenceRows.length !== 1} onClick={() => { if (selectedNewSeriesReferenceRows.length === 1) void chooseNewSeriesReferenceTextFile(selectedNewSeriesReferenceRows[0].relativePath); }}><FileText size={15} aria-hidden="true" />変更</button>
                    <button class="new-creation-change" type="button" aria-label="選択した資料を削除"  disabled={newSeriesReferenceBusy || !selectedNewSeriesReferenceRows.length} onClick={removeSelectedNewSeriesReferences}><Trash2 size={15} aria-hidden="true" />削除</button>
                    {newSeriesReferenceCandidates.length > 0 && <button class="primary-button" type="button" disabled={!selectedNewSeriesReferenceRows.length || newSeriesReferenceBusy} onClick={applySelectedNewSeriesReferences}><ClipboardCheck size={15} aria-hidden="true" />選んだ{selectedNewSeriesReferenceRows.length}件を反映</button>}
                  </div>
                </div>}
              </>}
              {seriesCatalogMessage && <p class="new-reference-message" role="status">{seriesCatalogMessage}</p>}
            </section>}
            {newSeriesMode && (newSeriesMode !== 'existing' || newSeriesId) && <section class="new-creation-topic" aria-labelledby="new-episode-topic-title">
              <h4 id="new-episode-topic-title"><span>今回のエピソード</span>{newWorkTitle.trim() && <span class="new-creation-topic-name">{`「　${newWorkTitle.trim()}　」`}</span>}</h4>
              <div class="new-creation-row" aria-label="今回のエピソード保存先">
                <strong>保存先</strong>
                <span class="new-creation-value" >{newEpisodeWorkspace?.folderName || 'フォルダを選択してください。'}</span>
                <button class="new-creation-change" type="button" onClick={() => void chooseNewEpisodeWorkspace()} disabled={newWorkspaceSelecting || newReferenceSelecting || newSeriesReferenceSelecting || newSeriesDirectorySelecting || newSeriesPreparing}><FolderOpen size={15} aria-hidden="true" />{newWorkspaceSelecting ? '選択中…' : newEpisodeWorkspace ? '変更' : '選択'}</button>
              </div>
              {newWorkspaceMessage && <p class="new-workspace-message" role="status">{newWorkspaceMessage}</p>}
              {newEpisodeWorkspace && <div class="new-creation-references" aria-label="今回のエピソード資料">
                <div class="new-creation-source-row">
                  <div class="new-creation-reference-list"><span class="new-creation-file-name" >{newReferenceFileName || newSuggestedEpisodeReference?.fileName || '資料を指定できます'}</span></div>
                  <button class="new-creation-change" type="button" onClick={() => void chooseNewReferenceTextFile()} disabled={newReferenceSelecting || newWorkspaceSelecting || newSeriesDirectorySelecting || newSeriesPreparing}><FileText size={15} aria-hidden="true" />{newReferenceSelecting ? '選択中…' : newReferenceFileName || newSuggestedEpisodeReference ? '変更' : '資料を選択'}</button>
                </div>
                {newSuggestedEpisodeReference && <div class="new-creation-reference-actions is-end"><button class="primary-button" type="button" disabled={newReferenceSelecting || newWorkspaceSelecting || newSeriesDirectorySelecting || newSeriesPreparing} onClick={() => void applySuggestedReferenceTexts()}><ClipboardCheck size={15} aria-hidden="true" />この資料を反映</button></div>}
                {newReferenceMessage && <p class="new-reference-message is-file-aligned" role="status">{newReferenceMessage}</p>}
              </div>}
            </section>}
          </form>}
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
          {newCreationStep === 'setting' && <form id="new-setting-form" class="new-setting-step" aria-labelledby="new-creation-step-title" onSubmit={(event) => { event.preventDefault(); void continueFromNewSetting(); }}>
            {newSeriesMode !== 'none' && newCharacterDocument && <section class="new-setting-group is-series">
              <h4>シリーズの舞台</h4>
              <div class="new-setting-fields">
                <label><span>ジャンル</span><input value={newCharacterDocument.manga.series_setting.genre ?? ''} placeholder="例：SF・ファンタジー" onInput={(event) => updateNewSeriesSetting('genre', event.currentTarget.value)} /></label>
                <label><span>対象読者</span><input value={newCharacterDocument.manga.series_setting.target_audience ?? ''} placeholder="例：少年・少女" onInput={(event) => updateNewSeriesSetting('target_audience', event.currentTarget.value)} /></label>
                <label><span>成人指定</span><input type="checkbox" style={{ width: '18px', height: '18px', margin: '5px 0', padding: 0, accentColor: 'var(--accent)' }} checked={newCharacterDocument.manga.series_setting.adult_content === true} onChange={(event) => {
                  patchNewCharacterDocument((draft) => { draft.manga.series_setting.adult_content = event.currentTarget.checked; });
                  setNewSettingMessage('');
                }} /></label>
                <label class="is-wide"><span>世界観</span><textarea rows={4} value={newCharacterDocument.manga.series_setting.situation} placeholder="シリーズを通して共通する舞台や世界観" onInput={(event) => updateNewSeriesSetting('situation', event.currentTarget.value)} /></label>
              </div>
            </section>}
            <section class="new-setting-group is-episode">
              <h4>今回のエピソードの舞台・状況</h4>
              <div class="new-setting-fields">
                <label><span>場所</span><input value={newWorkSetting.location} placeholder="例：放課後の教室" onInput={(event) => updateNewWorkSetting('location', event.currentTarget.value)} /></label>
                <label><span>時間帯</span><input value={newWorkSetting.time} placeholder="例：夕方" onInput={(event) => updateNewWorkSetting('time', event.currentTarget.value)} /></label>
                <label><span>天候</span><input value={newWorkSetting.weather} placeholder="例：雨" onInput={(event) => updateNewWorkSetting('weather', event.currentTarget.value)} /></label>
                <label class="is-wide"><span>あらすじ <em>必須</em></span><textarea rows={8} required value={newWorkSetting.situation} placeholder="この話で何が起きるかを入力してください" onInput={(event) => updateNewWorkSetting('situation', event.currentTarget.value)} /></label>
              </div>
            </section>
            <p class="new-setting-message">背景ごとの3Dモデルは、作品作成後に「舞台設定」→「背景作画資料」の各カードから登録できます。シリーズ共通にすると別エピソードでも再利用できます。</p>
            {newSettingMessage && <p class="new-setting-message" role="status">{newSettingMessage}</p>}
          </form>}
          {newCreationStep === 'layout' && <section class="new-layout-step" aria-labelledby="new-creation-step-title">
          {editingNewPrintSetup ? <PrintSettingsEditor initial={newPrintSetup} externalFormId="new-print-form" onConfirm={setup => {
            setNewPrintSetup(setup);
            setNewPrintConfirmed(true);
            setEditingNewPrintSetup(false);
            try { savePrintPreferences(localStorage, setup); }
            catch { setToast('今回の設定は使えますが、本体へ前回設定を保存できませんでした。'); }
          }} /> : <div class="print-summary"><p>{printSummary(newPrintSetup)}{newPrintSetup.printer && <small>{newPrintSetup.printer}</small>}</p><button type="button" class="secondary-button" disabled={newLayoutTask !== 'idle'} onClick={() => setEditingNewPrintSetup(true)}>変更</button></div>}
          {newPrintConfirmed && !editingNewPrintSetup && <>
          <button class="new-blank-button" onClick={() => createNewDocument()} disabled={newLayoutTask !== 'idle'}><FilePlus2 size={16} />まっさらで開始（コマ割りはあとで選べます）</button>
          <section class="new-layout-import" aria-labelledby="new-layout-import-title">
            <div class="new-layout-import-head">
              <div><h3 id="new-layout-import-title">紙のネームからコマを読み取る</h3></div>
              <div class="new-layout-import-actions">
                <button type="button" onClick={() => void chooseNewLayoutImageFiles()} disabled={newLayoutTask !== 'idle'}><Images size={15} />画像を読み込む</button>
                {!isLanClient && (newLayoutTask === 'scanner'
                  ? <button type="button" class="scanner-finish-button" onClick={requestScannerFinish}><ScanLine size={15} />取り込みを終了{scannerReceivedCount ? `（${scannerReceivedCount}枚）` : ''}</button>
                  : <button type="button" onClick={launchScanner} disabled={newLayoutTask !== 'idle' || Boolean(pendingScannerSession)}><ScanLine size={15} />スキャナーを起動</button>)}
              </div>
            </div>
            {!isLanClient && <label class="new-layout-persist-row">
              <input type="checkbox" checked={persistAnalogAssets} disabled={newLayoutTask !== 'idle'} onChange={(event) => changePersistAnalogAssets(event.currentTarget.checked)} />
              <span><strong>切り出した原画参照をすぐファイル保存</strong><small>紙のネームから抽出した人物の下書きと手書き文字だけを ~/Documents/Image-Hub/&lt;episode_id&gt;/ に保存します。登場人物・背景・小道具の資料保存とは別です。</small></span>
            </label>}
            <div class="new-layout-style-controls" role="group" aria-label="取り込み後のコマ枠設定">
              <label><span>上下の間隔</span><span><input type="number" min="0" max="20" step="0.5" value={newLayoutRowGapMm} disabled={newLayoutTask !== 'idle'} onInput={(event) => updateNewLayoutGutter('row', event.currentTarget.valueAsNumber)} />mm</span></label>
              <label><span>左右の間隔</span><span><input type="number" min="0" max="20" step="0.5" value={newLayoutColumnGapMm} disabled={newLayoutTask !== 'idle'} onInput={(event) => updateNewLayoutGutter('column', event.currentTarget.valueAsNumber)} />mm</span></label>
              <label><span>枠線の太さ</span><span><input type="number" min="0.1" max="5" step="0.1" value={newLayoutFrameLineWidthMm} disabled={newLayoutTask !== 'idle'} onInput={(event) => updateNewLayoutFrameLineWidth(event.currentTarget.valueAsNumber)} />mm</span></label>
              <small>間隔は解析結果の座標へ、枠線幅は新しい作品の作画指定へ保存します。</small>
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
                      <span class="new-layout-thumb-media"><NewLayoutSourceImage file={item.file} alt="" style={layoutPreviewImageStyle(displayedLayoutRotation(item))} /></span>
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
                      <span class="new-layout-thumb-media">{hasPanels && item.analysis ? <TemplateThumb shapes={item.analysis.detectedPanels} figures={item.analysis.detectedFigures} frameLineWidthMm={newLayoutFrameLineWidthMm} /> : <span class="new-layout-analysis-placeholder">{item.analyzing ? '解析中' : item.error ? '!' : ''}</span>}</span>
                      <em>{String(itemIndex + 1).padStart(2, '0')}</em>
                    </button>;
                  })}
                </div>
              </section>
              <section class="new-layout-focus-pane" aria-labelledby="new-layout-focus-title">
                <h4 id="new-layout-focus-title">フォーカス中</h4>
                <div class="new-layout-focus-body">
                  <div class="new-layout-focus-image"><NewLayoutSourceImage file={activeLayoutItem.file} alt="読み込んだネーム画像のプレビュー" style={layoutPreviewImageStyle(displayedLayoutRotation(activeLayoutItem))} /></div>
                  <div class="new-layout-focus-controls">
                    <span class="new-layout-page-number">PAGE {String(newLayoutActiveIndex + 1).padStart(2, '0')} / {String(newLayoutItems.length).padStart(2, '0')}</span>
                    <strong >{activeLayoutItem.file.name}</strong>
                    <div class="new-layout-rotation-controls" aria-label="画像の向きを手動指定"><button type="button" onClick={() => rotateActiveLayoutImage(270)} disabled={newLayoutTask !== 'idle'}>左90°</button><button type="button" onClick={() => rotateActiveLayoutImage(180)} disabled={newLayoutTask !== 'idle'}>180°</button><button type="button" onClick={() => rotateActiveLayoutImage(90)} disabled={newLayoutTask !== 'idle'}>右90°</button></div>
                    <button type="button" class="primary-button" onClick={analyzeNewLayouts} disabled={newLayoutTask !== 'idle'} ><Sparkles size={15} />{newLayoutTask === 'analyzing' || newLayoutTask === 'creating' ? '解析中…' : '解析開始'}</button>
                  </div>
                </div>
                <NewLayoutAnalysisFeed items={newLayoutItems} message={newLayoutMessage} characterProgress={newCharacterReadProgress} />
              </section>
            </div>}
            {!activeLayoutItem && (newCharacterReadProgress ? <CharacterReadProgress progress={newCharacterReadProgress} /> : newLayoutMessage && <p class="new-layout-message" role="status">{newLayoutMessage}</p>)}
            {scannerSession && <p class="new-layout-session">開始 {new Date(scannerSession.startedAt).toLocaleTimeString('ja-JP')} · 保存先 {scannerSession.directory}</p>}
          </section>
          <details class="new-template-picker">
          <summary>コマ割りを選んで開始</summary>
          <div class="new-template-grid">
            {PANEL_TEMPLATES.map((template) => <button type="button" id={`new-template-${template.id}`} class="new-template-card" key={template.id} disabled={newLayoutTask !== 'idle'} onClick={() => createNewDocument(template, hasScannedLayoutItems)}>
              <TemplateThumb shapes={template.shapes} />
              <strong>パターン{template.id} · {template.name}</strong>
              <small>{template.shapes.length}コマ · {template.usage}</small>
            </button>)}
          </div>
          </details>
          </>}
          </section>}
          </div>
        </div>
      </section>
    </>}
    {qwenGeneration&&<QwenGenerationDialog onOpenSettings={()=>{qwenGeneration.agentRequest?.reject(new Error('環境設定へ移動しました'));setQwenGeneration(null);void showEnvironmentSettings();}} adultContent={Boolean(document.manga.series_setting?.adult_content)} agentRequest={qwenGeneration.agentRequest} onConversation={setGenerationConversation} onConversationHost={setGenerationConversationHost} key={qwenGeneration.id} plan={qwenGeneration.plan} poseEditorContext={qwenGeneration.poseEditorContext} layers={qwenGeneration.layers} loadLayer={qwenGeneration.loadLayer} onInsert={insertQwenImage} onClose={()=>{qwenGeneration.agentRequest?.reject(new Error('生成を中止しました'));setQwenGeneration(null);}}/>}
    {toast && <div class="toast"><span>{toast}</span><button onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div></PaintEditor>;
}
