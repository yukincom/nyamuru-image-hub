import type { MaterialScope, MaterialType, CharacterReferenceView, BackgroundStage, ImageAsset, ScenarioSource, MangaPage } from './page.ts';

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
  generated_image_sequence?: number;
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
