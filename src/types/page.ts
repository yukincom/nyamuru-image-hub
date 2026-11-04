import type { HumanPoseTextSelection } from '../lib/humanPoseTypes.ts';
import type { VectorNode, PaintDocument } from './paint.ts';

export type Anchor = 'right' | 'left' | 'center' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export type FigureSize = 'long' | 'full' | 'knee-up' | 'waist-up' | 'bust-up' | 'shoulder-up' | 'face' | 'face-detail' | 'hand' | 'foot' | 'part';

export type FigureRole = 'main' | 'sub';

export type BubbleShape = 'normal' | 'thought' | 'square' | 'caption' | 'flash' | 'uniflash' | 'wobbly' | 'whisper' | 'handwritten' | 'typeset' | 'critical' | 'tense' | 'toge' | 'announce' | 'toge_natural';

export type MaterialType = 'character' | 'background' | 'prop';

export type MaterialScope = 'episode' | 'series';

export type CharacterReferenceView = 'turnaround' | 'front' | 'three-quarter' | 'side' | 'back' | 'expression' | 'costume' | 'other';

export type PlacementKind = 'person' | 'prop';

export type BleedEdge = 'left' | 'right' | 'top' | 'bottom';

export type ScreenTextOrientation = 'horizontal' | 'vertical';

export interface BBox { x: number; y: number; w: number; h: number }

/** 話者の人物bboxを基準とする相対位置。枠外の値も使い、先端を短く止められる。 */
export interface BubbleTailTarget { x: number; y: number }

/** フキダシbboxを基準とする、しっぽ根元の相対位置。 */
export interface BubbleTailRoot { x: number; y: number }

/** フキダシbboxを基準とする本文中心の有限相対位置。枠外可、未指定時は中央。 */
export interface BubbleTextPosition { x: number; y: number }

export type BubbleTailStyle = 'normal' | 'thinking';

export interface RectShape extends BBox { type: 'rect' }

export interface PolygonShape { type: 'polygon'; points: [number, number][] }

export type PanelShape = RectShape | PolygonShape;

export type AnalogAssetKind = 'figures' | 'texts';

/**
 * OMNYへは書き出さない、Documents/Image-Hub内の原画参照。
 * 絶対パスを作品データへ保存せず、bridgeが検証できる相対要素だけを保持する。
 */
export interface PersistentAnalogAssetRef {
  schemaVersion: 1;
  workKey: string;
  kind: AnalogAssetKind;
  fileName: string;
}

/** Local provenance for one expression read; the editable Figure.action is the generation input. */
export interface ExpressionPart {
  id: string | null;
  evidence_en: string;
  prompt?: string | null;
  extract_en?: string;
  reason?: string;
  source: 'catalog' | 'observation';
}

export interface ReadExpressionFace {
  face_id: string;
  bbox: [number, number, number, number] | null; // normalized xyxy within this figure crop
  confidence: 'high' | 'medium' | 'low';
  parts_mapping: {
    base_emotion: ExpressionPart | null;
    brows: ExpressionPart | null;
    eyes: (ExpressionPart & { is_symbolic_eye: boolean | null }) | null;
    mouth: ExpressionPart | null;
    extras: ExpressionPart[];
  };
  selected_tags?: string[];
  qwen_image21_prompt_en: string | null;
}

export interface FigureExpressionReading {
  read_status?: 'read' | 'unreadable' | 'no_face' | 'ambiguous';
  catalog_version: string;
  catalog_sha256: string;
  target_face_id: string | null;
  target_evidence_en: string | null;
  faces: ReadExpressionFace[];
}

/** OMNYへは書き出さない、アナログ取込由来のローカル中間データ。 */
export interface AnalogFigureImport {
  schemaVersion: 1;
  sourceRegionId: string;
  assetId: string;
  sourceBBox: BBox;
  detectionSource: 'body' | 'face';
  confidence?: number;
  draft: true;
  userEdited?: boolean;
  expressionReading?: FigureExpressionReading;
  /** 人物同定または対象の顔を確認する必要がある時だけ警告色にする。 */
  analysisReview?: 'low-confidence' | 'error';
  analysisReviewMessage?: string;
  persistentAsset?: PersistentAnalogAssetRef;
}

/** OMNYへは書き出さない、手書き文字の原画参照メタデータ。 */
export interface AnalogTextImport {
  schemaVersion: 1;
  sourceRegionId: string;
  assetId: string;
  sourceBBox: BBox;
  detectionSource: string;
  recognitionEngine: 'Baberu OCR';
  confidence?: number;
  needsReview: boolean;
  unreadable?: boolean;
  referenceHidden?: boolean;
  /** Source pixels were copied to an ordinary raster layer; never recreate it after deletion. */
  rasterLayerInitialized?: boolean;
  /** The source raster is an independent image placement. Never recreate it after deletion. */
  rasterLayerSeparated?: boolean;
  /** Same-owner original placement ID; null records an explicitly removed original. */
  originalImageId?: string | null;
  levelAdjusted: true;
  persistentAsset?: PersistentAnalogAssetRef;
}

export interface Figure {
  /** Stable identity of the figure folder that owns both its raster layers and panel settings. */
  layerId?: string;
  /** Locks this figure folder and every paint layer it owns. */
  locked?: boolean;
  name: string;
  /** 人物レイヤーへ渡す、この配置固有の表情・姿勢・視線・動作。 */
  action?: string;
  /** この人物配置のポーズと編集文。素材URLは保存しない。 */
  human_pose?: HumanPoseTextSelection;
  /** ローカル編集時の配置種別。公開OMNYでは person は省略、prop は object:true へ変換する。 */
  kind?: PlacementKind;
  /** 人物または小道具カタログへのローカル参照。 */
  refId?: string;
  /** 読込互換専用。内部正規化後は kind へ移し、公開OMNYでのみ再生成する。 */
  object?: boolean;
  bbox?: BBox;
  anchor?: Anchor;
  size?: FigureSize;
  role?: FigureRole;
  analogImport?: AnalogFigureImport;
  /** あたりの代わりに表示する絵。配置枠はこの figure.bbox を使う。 */
  artwork?: ImageContent;
  /** コマ分割線をまたいだため両方へ複製された、ローカル確認用フラグ。 */
  splitOverlap?: true;
  /** 同じ分割元から生じた複製を追跡するローカルID。 */
  splitOverlapId?: string;
}

/** Local scenario source and OCR correspondence are saved with the project, not generation OMNY. */
export interface ScenarioSource {
  version: 1;
  fileName: string;
  text: string;
}

export interface ScenarioMatch {
  /** Pending/legacy links only. Resolved text has no live source link. */
  sourceIds: string[];
  /** Import history for duplicate prevention and ordering, never for text/role synchronization. */
  resolvedSourceIds?: string[];
  ocrText: string;
  score: number;
  status: 'automatic' | 'confirmed' | 'review' | 'manual' | 'unmatched';
  /** Provisional OCR is already in the editable text (including an intentional empty value). */
  provisionalText?: true;
}

export interface TextStyle {
  /** Align each line within the entire text group; omitted means left/start. */
  textAlign?: 'left' | 'center' | 'right';
  orientation?: 'vertical' | 'horizontal';
  font?: string;
  /** Printed point size, independent of canvas zoom. */
  fontSize?: number;
  /** Line advance relative to font size, retained when changing text category. */
  lineHeight?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

/** UTF-16 offsets match native text selection; ranges never split a surrogate pair. */
export type TextInlineStyle = Pick<TextStyle, 'fontWeight' | 'italic' | 'underline' | 'strikethrough'>;

export interface TextStyleRange extends TextInlineStyle { start: number; end: number }

export interface Bubble {
  /** Stable identity for saved layer order; the array still defines numbering and reading order. */
  layerId?: string;
  /** The native shape, text, tails and painted additions share one layer visibility. */
  hidden?: boolean;
  /** Folder lock inherited by the native child, painted additions and linked original. */
  locked?: boolean;
  /** Individual native child lock, independent of the original when the folder is unlocked. */
  nativeLocked?: boolean;
  /** Drawing above the editable native bubble; source text/shape/OCR remain intact. */
  paint_overlay?: ImageContent;
  text: string;
  text_style?: TextStyle;
  text_runs?: TextStyleRange[];
  /** 対応キャラクター名。描き文字では発話を意味しない。 */
  speaker?: string;
  /** 対応キャラクターの登場人物カタログへのローカル参照。 */
  speakerId?: string;
  shape?: BubbleShape;
  /** Drawing direction for handwritten lettering, separate from its literal text. */
  lettering_description?: string;
  /** Fixed drawing-tool and expression IDs from handwritten-styles.json. */
  lettering_pen?: string;
  lettering_expressions?: string[];
  /** 対応キャラクターとの重なり。描き文字だけに適用し、省略時は手前。 */
  lettering_depth?: 'front' | 'behind';
  /** Hide only the editable lettering guide; painted results retain their visibility. */
  lettering_guide_hidden?: boolean;
  /** Body and tail stroke width in millimeters; absent uses the creation default. */
  line_width_mm?: number;
  /** Closed cubic outline in a fixed 0..100 box; handles are relative to each anchor. */
  bezier?: { nodes: VectorNode[] };
  /** 旧保存データとの読込互換。コマ所属は現在常時クリップし、ページ前景では使わない。 */
  clip_to_panel?: boolean;
  emphasis?: string;
  monologue?: boolean;
  offscreen?: boolean;
  /** 同じ配列内で結合する、先行フキダシの1始まり番号。話者の継承とは無関係。 */
  join_to?: number;
  /** falseはしっぽなし。座標は話者の人物bbox基準の相対位置（枠外可）。未指定時は人物中央。 */
  tail?: false | BubbleTailTarget;
  /** 通常の三角しっぽ、または2〜4個の丸が連なるthinkingしっぽ。旧データは形状から補完する。 */
  tail_style?: BubbleTailStyle;
  /** しっぽの根元。フキダシbbox基準の0..1で、未指定時は先端方向へ自動配置。 */
  tail_root?: BubbleTailRoot;
  /** 本文の中心。フキダシbboxの左上0・右下1を基準にした有限座標（枠外可）。未指定時は中央。 */
  text_position?: BubbleTextPosition;
  bbox?: BBox;
  anchor?: Anchor;
  analogTextImport?: AnalogTextImport;
  scenarioMatch?: ScenarioMatch;
  /** コマ分割線をまたいだため両方へ複製された、ローカル確認用フラグ。 */
  splitOverlap?: true;
  /** 同じ分割元から生じた複製を追跡するローカルID。 */
  splitOverlapId?: string;
}

export interface ScreenText {
  layerId?: string;
  hidden?: boolean;
  text: string;
  text_style?: TextStyle;
  text_runs?: TextStyleRange[];
  bbox?: BBox;
  orientation?: ScreenTextOrientation;
  /** コマ分割線をまたいだため両方へ複製された、ローカル確認用フラグ。 */
  splitOverlap?: true;
  /** 同じ分割元から生じた複製を追跡するローカルID。 */
  splitOverlapId?: string;
}

export interface Panel {
  layerId?: string;
  /** Editor-only visibility, independent folder locks and stable artwork order. */
  layer?: { hidden?: boolean; frameHidden?: boolean; locked?: boolean; frameLocked?:boolean; backgroundLocked?:boolean; directLocked?:boolean; artOrder?:string[] };
  /** 背景あたりの表示内容。操作枠はコマ形状を共用する。 */
  background_images?: PlacedImage[];
  images?: PlacedImage[];
  id: number;
  shape: PanelShape;
  bg: -1 | 0 | 1 | 2;
  /** 背景レイヤーだけへ渡す、場所・構図・光・感情効果の画像生成指示。 */
  background_description?: string;
  no_figures?: boolean;
  bleed?: BleedEdge[];
  figures?: Figure[];
  assets?: string[];
  /** assets と同じ順序で保持する素材カタログへのローカル参照。未解決位置は空文字。 */
  assetIds?: string[];
  bubbles: Bubble[];
  screen_text?: ScreenText[];
  action: string | null;
}

/**
 * 複数コマをまたぐ人物・フキダシを、特定のコマへ所属させず紙面上に置く前景レイヤー。
 * コマ枠を描いた後に figures を一度だけ描き、全フキダシをその手前へ描画する。
 */
export interface PageOverlay {
  frame: false;
  layer: 'above_panel_frames';
  figures?: Figure[];
  bubbles?: Bubble[];
  /** コマに属さず、紙面の余白やコマ間にも置ける写植文字。 */
  screen_text?: ScreenText[];
}

/** Original file metadata. No display transform rewrites the underlying bytes. */
export interface ImageAsset {
  id: string;
  storageId: string;
  sha256: string;
  mediaType: 'image/png' | 'image/jpeg';
  originalName: string;
  widthPx: number;
  heightPx: number;
  byteLength: number;
}

export interface BackgroundStage {
  id: string; storageId: string; name: string; sha256: string; byteLength: number;
  format: 'glb'|'fbx';
  /** Series library fallback when the browser cache is unavailable. */
  seriesId?: string;
}

export interface BackgroundCapture {
  version: 1;
  sourceId: string;
  camera: { position: [number,number,number]; target: [number,number,number]; fov: number; /** Picture translation in frame widths/heights; positive is right/down. */ shift?: [number,number] };
  /** A stable mesh in the immutable stage identifies the selected assembly. */
  focusMesh?: number;
  /** Optional picked surface point within that assembly. */
  focusPoint?: [number,number,number];
  light: { azimuth: number; elevation: number; preset?: 'daylight'|'evening'|'indoor'; intensity?: number; bounce?: number; windowMesh?: number; ceiling?: boolean };
  /** Hide complete parts along the camera-facing room boundary for this shot. */
  cutaway?: { enabled: boolean; depth: number };
  /** Per-shot visibility for a stable mesh identifying a complete assembly. */
  objectVisibility?: Array<{ mesh: number; mode: 'show'|'hide' }>;
  outlineWidth: number; detailWidth: number; creaseAngle: number; detail: number; lineGap: number;
  blackAmount: number; toneEnabled: boolean; toneDensity: number; toneLpi: number;
  /** Lighting determines a binary coverage region; screentone density stays fixed. */
  toneThreshold?: number;
  frame: BBox;
  layerIds: string[];
}

export interface ImageContent {
  /** Editable layers accompany the flattened preview, including original image references. */
  paint?: PaintDocument;
  assetId: string;
  /** Source pixels in browser display orientation, independent of paper millimeters. */
  crop: BBox;
  opacity: number;
  hidden: boolean;
  locked: boolean;
}

export interface PlacedImage extends ImageContent {
  /** Local source crop, independent of native text/shape; association lives on AnalogTextImport. */
  bubbleOriginal?: { sourceRegionId: string; name: string };
  /** Generated page/panel composite; editable source objects stay underneath. */
  generationScope?: 'page'|'panel';
  /** Editable freehand/vector artwork owned directly by a panel folder or the page root. */
  paintScope?: 'panel'|'page';
  /** Position of direct artwork among native folders, or above a panel bar. */
  paintStack?: PaintStackPosition;
  id: string;
  bbox: BBox;
  splitOverlap?: true;
  splitOverlapId?: string;
}

export type PaintStackPosition = {below:string} | {beforePanel:string};

export interface MangaPage {
  /** Last allocated raster/vector work-layer number, shared by all owners on this page. */
  paint_layer_sequence?: number;
  /** Local artwork placements; original pixels live in manga.image_assets. */
  images?: PlacedImage[];
  /** Editor-only state for artwork owned directly by the page. */
  layer?: { directLocked?:boolean; artOrder?:string[] };
  page: number;
  canvas: { w: number; h: number; unit: string };
  panels: Panel[];
  page_overlay?: PageOverlay;
}
