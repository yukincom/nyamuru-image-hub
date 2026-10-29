import type { HumanPoseTextSelection } from './lib/humanPoseTypes.ts';

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
  /** 人物同定を人間が確認する必要がある時だけ、ネーム画面の人物あたりを警告色にする。 */
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
export interface PaintPoint { x: number; y: number; pressure: number; time: number }
export interface PaintStroke {
  tool: 'pen' | 'eraser' | 'line' | 'rectangle' | 'ellipse' | 'fill' | 'clear';
  color: string | null;
  /** Frozen selection mask for this edit. Empty means no pixels affected. */
  selection?: BBox[];
  /** Closed shape fill; absent or null keeps existing outline-only artwork. */
  fill?: string | null;
  size: number;
  points: PaintPoint[];
}
export interface VectorPoint { x:number; y:number }
export interface VectorNode extends VectorPoint { handleIn?:VectorPoint; handleOut?:VectorPoint }
export interface VectorStyle {
  stroke:string|null; fill:string|null; width:number;
  cap:'butt'|'round'|'square'; join:'miter'|'round'|'bevel'; miterLimit:number;
  dash:number[]; dashOffset:number; alignment:'center'|'inside'|'outside';
  arrowStart:'none'|'triangle'|'open'|'circle'; arrowEnd:'none'|'triangle'|'open'|'circle';
  profile:'uniform'|'taper'|'spindle';
}
export interface VectorPath { id:string; nodes:VectorNode[]; closed:boolean; style:VectorStyle }
export interface PaintMask {
  enabled: boolean;
  /** Unpainted mask pixels reveal the layer when true. Ink reveals; erasing hides. */
  reveal: boolean;
  strokes: PaintStroke[];
}
export interface PaintTone {
  enabled: boolean;
  lpi: number;
  mode: 'image'|'fixed';
  density: number;
  /** Independent solid tone, covered by its own editable mask. */
  fill?: boolean;
  /** Dot angle in degrees. Missing values use 45 degrees. */
  angle?: number;
  /** Pattern origin in document pixels, retained when the canvas gains padding. */
  origin?: {x:number;y:number};
}
export type PaintColorMode = 'color'|'grayscale'|'monochrome';
export interface PaintFolder {
  id: string;
  name: string;
  visible?: boolean;
  locked?: boolean;
  /** Bottom-to-top insertion point used only while the folder is empty. */
  position: number;
  /** Inside a text folder, this folder is in front of its native text. */
  aboveNative?: boolean;
}
export interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: 'normal' | 'multiply';
  image?: { assetId: string; crop: BBox; bbox: BBox };
  clip?: BBox;
  strokes: PaintStroke[];
  kind?: 'raster'|'vector';
  paths?: VectorPath[];
  /** Missing values retain the original full-color rendering. */
  colorMode?: PaintColorMode;
  /** Edge coverage levels: none, weak, medium, strong. No blur. */
  antialias?: 0|1|2|3;
  mask?: PaintMask;
  guide?: boolean;
  tone?: PaintTone;
  /** Optional user-created palette folder. This never changes rendering by itself. */
  folderId?: string;
  /** Inside a text folder, this layer is in front of its native text. */
  aboveNative?: boolean;
}
export interface PaintGenerationMask {
  enabled:boolean;
  strokes:PaintStroke[];
  antialias?:0|1|2|3;
}
export interface PaintDocument {
  version: 1;
  width: number;
  height: number;
  dpi: number;
  /** The original guide has become an editable layer; an empty initialized document suppresses its recreation. */
  guideInitialized?: boolean;
  /** Original guide region in document pixels. Canvas padding does not stretch the guide. */
  referenceFrame?: BBox;
  /** Region hints for this entire generation owner; excluded from normal artwork export. */
  generationMask?:PaintGenerationMask;
  /** Last 3D camera and source; generated layers remain ordinary editable artwork. */
  background3d?: BackgroundCapture;
  /** Bottom to top. Pixel coordinates belong to this document, not the page. */
  layers: PaintLayer[];
  /** Optional user-created groups for organizing layers without flattening artwork. */
  folders?: PaintFolder[];
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

export type CharacterGender = 'female' | 'male' | 'neutral';

export interface Character {
  /** 表示名変更に左右されないローカル識別子。 */
  localId?: string;
  name: string;
  role: string;
  /** 人間が指定した性別。未設定では保存値を補完しない。 */
  gender?: CharacterGender;
  /** 人物像とは分けて画像生成時に英訳して使う、人間が指定した外見・描き方。 */
  visual_prompt?: string;
  /** この話だけの人物か、シリーズ台帳で再利用する人物か。 */
  scope: MaterialScope;
  /** シリーズ台帳内で、名称変更後も同じ人物を追跡する安定ID。 */
  catalog_id?: string;
  /** ネーム上の略称・呼び名など、同一人物の照合候補。 */
  aliases?: string[];
  /** 生成時へ人物単位で注入する、人間が決めた基準頭身。 */
  default_proportion?: { head_count: number };
  /** 代表にする人物資料の安定ID。 */
  primary_material_catalog_id?: string;
  /** ネーム照合で使う、画像から観察・推定した安定造形。 */
  recognition?: CharacterRecognitionProfile;
}

export interface VisualEvidence {
  observed: string[];
  inferred: string[];
}

export interface CharacterRecognitionProfile {
  hair: VisualEvidence;
  face: VisualEvidence;
  silhouette: VisualEvidence;
  outfit: VisualEvidence;
  accessories: VisualEvidence;
  ambiguous_design: VisualEvidence;
  analyzer?: LocalVlmAnalyzer;
}

export interface LocalVlmAnalyzer {
  provider: 'local';
  runtime: 'mlx-vlm';
  model: string;
  prompt_version: string;
  analyzed_at: string;
}

export interface CharacterReferenceSourceImage {
  schema_version: 1;
  asset_id: string;
  /** シリーズディレクトリからの相対パス。絶対パスは保存しない。 */
  file_name: string;
  /** ユーザーが選んだ画像の元ファイル名。パスは保存しない。 */
  original_name?: string;
  media_type: 'image/png';
  byte_size: number;
  width_px: number;
  height_px: number;
  sha256: string;
}
export interface MaterialOrigin {
  episode_id: string;
  episode_title: string;
  episode_number: string;
}
export interface Material {
  /** 表示名変更に左右されないローカル識別子。 */
  localId?: string;
  key: string;
  type: MaterialType;
  scope: MaterialScope;
  keywords: string[];
  note?: string;
  /** type:character の視覚資料が属する人物のローカル識別子。 */
  characterId?: string;
  /** 公開OMNYで人物資料をシリーズ人物へ結ぶ安定ID。 */
  character_catalog_id?: string;
  /** シリーズ共通カタログ内で、名称変更後も同じ素材を追跡する内部ID。 */
  catalog_id?: string;
  /** シリーズ共通へ最初に登録したエピソードの追跡情報。 */
  origin?: MaterialOrigin;
  /** Background model original; null explicitly detaches, absent keeps unseen catalog data. */
  source_stage_id?: string | null;
  /** 人物資料画像の向き・用途。 */
  view?: CharacterReferenceView;
  /** ローカルシリーズ台帳へ保存した人物資料画像。 */
  source_image?: CharacterReferenceSourceImage;
}

export interface MangaSetting {
  location: string;
  time: string;
  weather: string;
  situation: string;
}

export interface MangaSeriesSetting {
  /** SF、ファンタジーなど。複数の場合は人間が読める文字列で保持する。 */
  genre?: string;
  /** 少年、少女、青年、一般など、作品が想定する読者層。 */
  target_audience?: string;
  /** 成人指定作品として人物素材の外部処理を制限する。 */
  adult_content?: boolean;
  /** シリーズ全体で共有する舞台・世界観。 */
  situation: string;
  /** 旧来のシリーズ資料にあれば、空の各話設定へ初期値として注入する。UIでは固定項目として扱わない。 */
  location: string;
  time: string;
  weather: string;
}

export type ArtworkScope = 'common' | 'integrated';
export type ArtworkMode = 'integrated' | 'draft';
/** 編集中の座標系とは独立した、最終書き出しの物理サイズ。 */
export interface FinishSettings {
  width_mm: number;
  height_mm: number;
  dpi: number;
  bleed_mm: number;
}
/** 各原稿の製本・出力条件。寸法は finish_settings、本文の色は meta.format が正本。 */
export interface PrintSettingsData {
  version: 1;
  purpose: 'manga' | 'illustration';
  unit: 'mm' | 'cm' | 'in' | 'px' | 'pt';
  printer: string;
  product: string;
  binding: 'right' | 'left';
  binding_style: 'unspecified' | 'perfect' | 'saddle';
  tone_lpi: number;
  safe_margin_mm: number;
  crop_marks: boolean;
  folio: { enabled: boolean; hidden: boolean; start: number; position: 'outside' | 'center' | 'inside'; font: string; size_pt: number };
  cover: { enabled: boolean; format: string; dpi: number; layout: 'separate' | 'spread'; spine_mm: number };
}
export interface ArtworkRuleGroup {
  id: string;
  label: string;
  scope: ArtworkScope;
  enabled: boolean;
}
/** 編集用の原本。OFFの本文も保持し、生成用のテキストとは分けて保存する。 */
export interface ArtworkSettingsData {
  version: 1;
  mode?: ArtworkMode;
  groups: ArtworkRuleGroup[];
  fragments: { groupId: string; kind: 'style' | 'layout'; text: string }[];
}

export interface Manga {
  /** Original 3D stage files, shared by panel cameras and saved with the work. */
  background_stages?: BackgroundStage[];
  image_assets?: ImageAsset[];
  scenario?: ScenarioSource;
  schema_name: string;
  schema_version: number;
  meta: {
    /** OMNY文書の用途。完成画像の色形式はformatで別に保持する。 */
    document_type: 'story' | 'series-catalog';
    title: string;
    series: string;
    series_id: string;
    episode_number: string;
    episode_id: string;
    author: string;
    format: string;
    page_count: number;
    reading_direction: string;
    text_orientation: string;
    font: string;
    bubble_line_width_mm: number;
    panel_frame_width_mm: number;
    panel_gutter_row_mm: number;
    panel_gutter_column_mm: number;
    style_notes: string[];
  };
  layout_spec: string;
  artwork_settings?: ArtworkSettingsData;
  finish_settings?: FinishSettings;
  print_settings?: PrintSettingsData;
  /** シリーズ全体で共有する作品分類と世界観。 */
  series_setting: MangaSeriesSetting;
  /** このエピソード固有の舞台・状況・あらすじ。 */
  setting: MangaSetting;
  characters: Character[];
  materials: Material[];
  pages: MangaPage[];
}

export interface MangaDocument { manga: Manga }
export type CanvasElementType = 'figure' | 'bubble' | 'screen_text' | 'image';
export interface CanvasElementSelection {
  type: CanvasElementType | 'panel_frame';
  index: number;
  /** 省略時は選択中コマ。ページ画像は page を明示する。 */
  scope?: 'panel' | 'page_overlay' | 'page';
  /** Native text row inside a text folder, rather than the folder heading. */
  part?: 'native';
}
export type IssueLevel = 'error' | 'warning';
export interface ValidationIssue { level: IssueLevel; path: string; message: string }
export type WorkspaceTab = 'storyboard' | 'meta' | 'setting' | 'characters' | 'props' | 'coverage';
export type DocsLanguage = 'ja' | 'en';
