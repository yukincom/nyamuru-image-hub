//! The name data the tool owns (正本). CSP files are only imported from and
//! exported to; panels, dialogue and story structure live here.
//!
//! Page coordinates are millimetres on the page canvas, origin at its top
//! left, so they do not depend on the resolution of the sheet or the page.
//! Story structure (scenes, characters, emotion values) is kept from the
//! first version so that overview views (構成, タイムライン, 感情曲線) can be
//! added later without changing the file format.

use serde::{Deserialize, Serialize};

/// 2: panel styles, balloon shapes and tails, breakouts (コマ割り・フキダシの語彙).
pub const FORMAT_VERSION: u32 = 2;

pub type Point = [f64; 2];
/// `[x0, y0, x1, y1]` in millimetres.
pub type BoxMm = [f64; 4];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub format_version: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_index: Option<u32>,
    #[serde(default)]
    pub author: String,
    pub binding: Binding,
    pub page_format: PageFormat,
    pub pages: Vec<Page>,
    #[serde(default)]
    pub characters: Vec<Character>,
    #[serde(default)]
    pub scenes: Vec<Scene>,
    #[serde(default)]
    pub emotions: Vec<EmotionPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceSheet>,
    /// Pens and erasers the strokes are drawn with (often taken from CSP).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub brushes: Vec<Brush>,
    /// 別案: other versions of runs of pages, kept to compare and switch to.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternatives: Vec<Alternatives>,
    /// 構成補助: the aimed page count and story shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<Plan>,
    /// 作品ごとのフキダシの既定: the shape new lines of each kind get.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_shapes: Option<LineShapes>,
    /// 保留コマ: panels taken off the pages until it is decided where they go.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held: Vec<HeldPanel>,
    /// 資料画像: pictures laid under pages ([`Page::references`]), each kept once.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<StoredImage>,
    /// コマ間: the gaps new panels get (cuts, panel patterns); none is the default 2 mm / 6 mm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gutters: Option<Gutters>,
    /// 縦スクロール (Webtoon): the pages are pieces of one tall strip, read
    /// top to bottom, with no spreads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll: Option<bool>,
    /// 用途ごとのフォント: the typeface each kind of line (and 強調) is set in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fonts: Option<LineFonts>,
    /// 作品の既定: sizes and line widths new things get (and borders without their own width).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NameStyle>,
    /// CSP のページ設定: the CSP page the name is written out on when no
    /// CSP-made template is chosen; none: from the name's page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csp_page: Option<CspPage>,
    /// ラフ線のレイヤー, bottom first; none is one layer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rough_layers: Vec<RoughLayer>,
    /// シリーズ: the series file this name belongs to, from the name's folder
    /// (`/` between folders). The name keeps its own copy of what is shared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    /// Next number used by [`Project::new_id`]; ids are never reused.
    pub next_id: u64,
}

/// 保留コマ: a panel taken off its page with what is in it, where they were
/// on that page (mm).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct HeldPanel {
    pub id: String,
    pub panel: Panel,
    #[serde(default)]
    pub lines: Vec<Line>,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fills: Vec<Fill>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stickies: Vec<Sticky>,
    /// このあたり: the page it is meant to go near.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// The page it was taken from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// 欄外: laid beside page `near` (the top left of its panel's box, mm on
    /// that page, off the page); none: only in the 保留 list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<Point>,
}

/// 別案: versions of the same run of pages (a page, a 見開き, a scene). The
/// option in use has its pages in [`Project::pages`]; the others keep theirs here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Alternatives {
    pub id: String,
    /// Pages of the option in use, as they are in the project.
    pub page_ids: Vec<String>,
    /// Id of the option in use.
    pub active: String,
    pub options: Vec<AlternativeOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct AlternativeOption {
    pub id: String,
    pub name: String,
    /// The option's pages while another option is in use (empty for the one in use).
    #[serde(default)]
    pub pages: Vec<Page>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Binding {
    /// 右綴じ (manga): pages run right to left.
    Right,
    Left,
}

/// Size of the manuscript page and its frames, in millimetres.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct PageFormat {
    /// The page canvas (A3 in the user's manuscripts).
    pub canvas_mm: [f64; 2],
    /// 仕上がり枠 (trim), centred on the canvas.
    pub trim_mm: [f64; 2],
    /// 基本枠 (basic frame), centred on the canvas and moved by `basic_offset_mm`.
    pub basic_mm: [f64; 2],
    #[serde(default)]
    pub basic_offset_mm: [f64; 2],
}

impl Default for PageFormat {
    /// A3 canvas, B4 trim and a common 180 x 270 mm basic frame.
    fn default() -> Self {
        PageFormat {
            canvas_mm: [297.0, 420.0],
            trim_mm: [257.0, 364.0],
            basic_mm: [180.0, 270.0],
            basic_offset_mm: [0.0, 0.0],
        }
    }
}

impl PageFormat {
    fn centred(&self, size: [f64; 2], offset: [f64; 2]) -> BoxMm {
        let x0 = (self.canvas_mm[0] - size[0]) / 2.0 + offset[0];
        let y0 = (self.canvas_mm[1] - size[1]) / 2.0 + offset[1];
        [x0, y0, x0 + size[0], y0 + size[1]]
    }

    pub fn trim_box(&self) -> BoxMm {
        self.centred(self.trim_mm, [0.0, 0.0])
    }

    pub fn basic_box(&self) -> BoxMm {
        self.centred(self.basic_mm, self.basic_offset_mm)
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    #[serde(default)]
    pub memo: String,
    #[serde(default)]
    pub panels: Vec<Panel>,
    #[serde(default)]
    pub lines: Vec<Line>,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default)]
    pub roughs: Vec<RoughImage>,
    /// はみ出し: areas drawn over the panels (a figure or effect breaking out
    /// of its panel). Panel borders and gutters under them are blanked.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub breakouts: Vec<Breakout>,
    /// 見開きページ: this page and the next (its facing page) go to CSP as
    /// one spread page.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub join_next: bool,
    /// 付箋: notes stuck on the page while working (never exported).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stickies: Vec<Sticky>,
    /// 投げなわ塗り: areas filled with one tone (ベタ and the like).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fills: Vec<Fill>,
    /// 資料画像: photos or backgrounds laid faintly under the page to draw over.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<ReferenceImage>,
}

/// 資料画像 on a page: which picture ([`Project::images`]) and where it lies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceImage {
    pub id: String,
    pub image: String,
    #[serde(rename = "box")]
    pub box_mm: BoxMm,
    /// How strongly it shows (0–1); none is half.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    /// "name": the name itself, taken in from a picture of it (a ミニネーム
    /// or a page drawn on paper), written out with the name's own lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// A picture kept in the name (made smaller when it was taken in).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct StoredImage {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// "image/jpeg" or "image/png".
    pub mime: String,
    pub data_base64: String,
    pub width_px: u32,
    pub height_px: u32,
}

/// 投げなわ塗り: an outline filled with one tone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Fill {
    pub id: String,
    pub shape: Vec<Point>,
    /// "gray" or "white"; none is black (ベタ).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
}

/// 付箋: a note on the page, at its top-left corner in millimetres.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Sticky {
    pub id: String,
    #[serde(default)]
    pub text: String,
    pub at: [f64; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 紐づけ: the panel or line the note is about; it points there wherever
    /// the note is put.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<StickyLink>,
}

/// A panel or a line a 付箋 is about, and the point on it the note points to
/// (from the top left of the panel's bounds or the line's box, in mm).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct StickyLink {
    /// "panel" or "line".
    pub kind: String,
    pub id: String,
    pub at: [f64; 2],
}

/// コマ間 in millimetres: between panels side by side and one above the other.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Gutters {
    pub across: f64,
    pub down: f64,
}

/// 用途ごとのフォント: a font name (as CLIP STUDIO PAINT shows it) for each
/// kind of line, and for lines marked 強調. None: the usual one (セリフ's, else the app's).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct LineFonts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thought: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sfx: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aside: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emphasis: Option<String>,
}

/// 作品の既定: the sizes and line widths a name draws with. None: the app's
/// (13 pt dialogue, 12 pt narration, 0.6 mm borders, 1.2 mm 太枠, 0.3 mm balloons).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct NameStyle {
    /// 文字の大きさ (pt) new lines of each kind get.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_pt: Option<KindSizes>,
    /// 枠線の太さ (mm) of plain, dashed and wavy borders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_line_mm: Option<f64>,
    /// 太枠の太さ (mm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thick_line_mm: Option<f64>,
    /// フキダシの線の太さ (mm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balloon_line_mm: Option<f64>,
    /// セリフの行間 (% of the font size), as CSP's 行間.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_spacing: Option<f64>,
}

/// CSP のページ設定 (mm): the CLIP STUDIO PAINT page made without a template.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct CspPage {
    pub canvas_mm: [f64; 2],
    pub trim_mm: [f64; 2],
    pub bleed_mm: f64,
    pub basic_mm: [f64; 2],
    pub basic_offset_mm: [f64; 2],
    pub resolution: f64,
    /// None: as the binding has it (a manga's first page on the left).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_page_left: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nombre_start: Option<i64>,
    /// 作品情報・ノンブルのフォント, as CSP names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// 縦スクロール: the pieces joined one under the other into tall pages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_pieces: Option<bool>,
    /// The rest of CSP's 作品情報 and ノンブル settings; none: CSP's defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story: Option<CspStory>,
}

/// Where a 作品情報 text goes under the 仕上がり: 左下・下・右下.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum StoryPosition {
    Left,
    Center,
    Right,
}

/// CSP's 作品情報 and ノンブル settings besides 作品名・話数・作者名.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct CspStory {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_position: Option<StoryPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_position: Option<StoryPosition>,
    /// ページ番号 in the 作品情報.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_number: Option<StoryPageNumber>,
    /// A ノンブル printed on the page rather than the hidden one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nombre: Option<ShownNombre>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct StoryPageNumber {
    pub start: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<StoryPosition>,
}

/// Where a shown ノンブル goes: above or below the 基本枠, 内側・中央・外側.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum NombrePlace {
    TopInner,
    Top,
    TopOuter,
    BottomInner,
    Bottom,
    BottomOuter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct ShownNombre {
    pub place: NombrePlace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub white: Option<bool>,
    /// フチ (mm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_mm: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    /// 基本枠との間隔: 横, 縦.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset_mm: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_pt: Option<f64>,
}

/// A number for each kind of line.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct KindSizes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thought: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narration: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sfx: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aside: Option<f64>,
}

/// 構成補助: what the name is aimed at, to compare the page split with.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// 目標ページ数.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_pages: Option<u32>,
    /// The shape of the story the page split is held against: a built-in
    /// one (起承転結, Save the Cat and the like) or the id of one in `shapes`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    /// オリジナルの型 made for this name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shapes: Vec<StoryShape>,
}

/// 話の型: parts over the pages by share, and beats (turning points) at
/// points in them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct StoryShape {
    pub id: String,
    pub label: String,
    pub parts: Vec<ShapePart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub beats: Vec<ShapeBeat>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct ShapePart {
    pub name: String,
    /// Share of the pages; the shares of a shape need not add up to 1.
    pub share: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct ShapeBeat {
    pub name: String,
    /// Where it falls, 0..1 of the pages.
    pub at: f64,
}

/// コマ: a polygon (usually a rectangle) in reading order.
///
/// Beyond the shape, a panel carries how it is drawn: its border (or none),
/// edges left open (裁ち切り: the panel runs off the page there), a fill
/// (ベタ for flashbacks), a background effect, and its stacking order so
/// that inset panels (はめ込み) sit on top of the panel they overlap.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub id: String,
    pub shape: Vec<Point>,
    pub order: u32,
    #[serde(default, skip_serializing_if = "is_default")]
    pub border: PanelBorder,
    /// Edges not drawn: edge `i` runs from `shape[i]` to `shape[i + 1]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub open_edges: Vec<u32>,
    #[serde(default, skip_serializing_if = "is_default")]
    pub fill: PanelFill,
    #[serde(default, skip_serializing_if = "is_default")]
    pub effect: PanelEffect,
    /// Stacking order; higher is drawn later (on top). Inset panels use 1.
    #[serde(default, skip_serializing_if = "is_default")]
    pub z: i32,
    /// 演出メモ: camera, timing or what the panel is for.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// Where the memo's tag was moved to: its top left from the top left of
    /// the panel's bounds (mm); none: in the panel's corner. Screen only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_at: Option<[f64; 2]>,
    /// 見開き: shared by the two halves of a panel across the gutter, one on
    /// each page of the spread.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub spread: String,
    /// 枠線の太さ (mm) of this panel alone; none: the name's for its border.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_mm: Option<f64>,
    /// 仮のコマ: laid out roughly (drawn by hand) and not decided yet;
    /// 整える makes it exact. Exported like any panel.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub draft: bool,
}

fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    *value == T::default()
}

/// 枠線
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum PanelBorder {
    #[default]
    Solid,
    /// 太枠: a heavier line for a key panel.
    Thick,
    /// 枠なし: the picture fades into the page.
    None,
    /// 破線: flashback, imagination.
    Dashed,
    /// 波線: dream, haze.
    Wavy,
}

/// 塗り (inside the border, under everything else in the panel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum PanelFill {
    /// Transparent: panels under it show through.
    #[default]
    None,
    /// White: covers what is under it (inset panels).
    White,
    /// ベタ: flashback, darkness, a silent beat.
    Black,
    /// グレー (tone).
    Gray,
}

/// Background effect drawn inside the panel (a note for the drawing stage).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum PanelEffect {
    #[default]
    None,
    /// 流線: motion.
    Speed,
    /// 集中線: focus, surprise.
    Focus,
    /// ウニフラ: shock, inner turmoil.
    Flash,
    /// キラキラ・花: warmth, charm.
    Sparkle,
}

/// はみ出し: an area that breaks out of the panels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Breakout {
    pub id: String,
    pub shape: Vec<Point>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    /// セリフ
    #[default]
    Speech,
    /// モノローグ・心の声
    Thought,
    /// ナレーション
    Narration,
    /// 描き文字・効果音
    Sfx,
    /// 小書き: a muttered aside written small without a balloon.
    Aside,
}

/// The balloon shape new lines of each kind get in a work (such as 多角形 for monologue).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct LineShapes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech: Option<BalloonShape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thought: Option<BalloonShape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narration: Option<BalloonShape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sfx: Option<BalloonShape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aside: Option<BalloonShape>,
}

/// フキダシの形
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum BalloonShape {
    /// The usual shape for the kind of line (楕円 / モコモコ / 四角 / なし).
    #[default]
    Auto,
    /// 楕円: ordinary speech.
    Ellipse,
    /// 角丸
    Rounded,
    /// 四角: narration, captions.
    Box,
    /// 多角形: monologue, words heard or recalled.
    Polygon,
    /// モコモコ (雲): thoughts.
    Cloud,
    /// トゲ: shouting.
    Spike,
    /// 爆発: a burst of anger or surprise.
    Burst,
    /// ふるえ (波線): fear, weakness.
    Wavy,
    /// ウニフラ: shock, inner voice in turmoil.
    Flash,
    /// 電子音: phones, machines, broadcasts.
    Electric,
    /// 破線: whispers.
    Dashed,
    /// なし: text only.
    None,
    /// An outline imported from CSP, kept as it is in `balloon`.
    Custom,
}

/// しっぽの種類
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum TailStyle {
    /// 三角
    #[default]
    Wedge,
    /// 泡: thoughts.
    Bubbles,
    /// 線: a thin pointer to a small or far speaker.
    Line,
    /// ギザギザ: electric voices.
    Zigzag,
}

/// しっぽ: points from the balloon to the speaker, even off the panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Tail {
    pub tip: Point,
    #[serde(default, skip_serializing_if = "is_default")]
    pub style: TailStyle,
    /// 曲がり: how far (mm) the middle of the tail is pushed to its left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bend: Option<f64>,
    /// 根本: the direction (radians from the balloon's centre, 0 right, π/2
    /// down) where it leaves the balloon; none is towards the tip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<f64>,
}

/// セリフ and other text placed on a page.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub kind: LineKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel: Option<String>,
    #[serde(rename = "box")]
    pub box_mm: BoxMm,
    pub font_size_pt: f64,
    pub vertical: bool,
    /// Balloon outline without tails and links, when the line has one. Made
    /// from `balloon_shape` by the editor; kept as is for `Custom`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balloon: Option<Vec<Point>>,
    #[serde(default, skip_serializing_if = "is_default")]
    pub balloon_shape: BalloonShape,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tails: Vec<Tail>,
    /// 連結: the line whose balloon this one is joined to (same speaker).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_to: Option<String>,
    /// 白抜き: black balloon (or none on a black panel) with white text.
    #[serde(default, skip_serializing_if = "is_default")]
    pub inverted: bool,
    /// 強調: bold type.
    #[serde(default, skip_serializing_if = "is_default")]
    pub emphasis: bool,
    /// コマ枠でマスク: the balloon is cut off at the border of its panel.
    #[serde(default, skip_serializing_if = "is_default")]
    pub mask: bool,
    /// フキダシの大きさ: its width and height as shares of the usual size
    /// for its text, when changed without the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balloon_scale: Option<[f64; 2]>,
    /// フォント for this line alone (as CLIP STUDIO PAINT names it); none
    /// is the one for its kind in [`Project::fonts`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
}

/// A rough line (ラフ).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    pub id: String,
    #[cfg_attr(feature = "ts", ts(type = "StrokePoint[]"))]
    pub points: Vec<StrokePoint>,
    pub width_mm: f64,
    #[serde(default)]
    pub closed: bool,
    /// Drawn over the panel borders (inside a はみ出し), not under them.
    #[serde(default, skip_serializing_if = "is_default")]
    pub over: bool,
    /// [`Brush::id`] of the pen it was drawn with; none is the plain pen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brush: Option<String>,
    /// Whether the start / end was left by an eraser (no 入り抜き there).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cut: Option<[bool; 2]>,
    /// The [`RoughLayer`] it is on; none (or one gone) is the first layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer: Option<String>,
}

/// ラフ線のレイヤー: rough lines kept apart (人物・背景・効果…), shown,
/// faded and locked together.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct RoughLayer {
    pub id: String,
    pub name: String,
    /// Not shown on the page (written to CSP hidden).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// 0.1..1; none is 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    /// Not drawn on, erased or picked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    /// 指示のレイヤー: notes scribbled over the name for whoever inks it,
    /// drawn over everything in `color` and kept apart from the rough.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marks: Option<bool>,
    /// A 指示のレイヤー's colour (`#rrggbb`); none: red.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// A point of a rough line, written as `[x, y, pressure]`, or
/// `[x, y, pressure, tilt, speed]` when the brush changes with them. All but
/// x and y are 0..1; tilt 0 is the pen held upright.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "Vec<f64>", into = "Vec<f64>")]
pub struct StrokePoint {
    pub x: f64,
    pub y: f64,
    pub pressure: f64,
    pub motion: Option<Motion>,
}

/// How the pen was held and moved at a point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Motion {
    pub tilt: f64,
    pub speed: f64,
}

impl StrokePoint {
    pub fn new(x: f64, y: f64, pressure: f64) -> StrokePoint {
        StrokePoint {
            x,
            y,
            pressure,
            motion: None,
        }
    }
}

impl TryFrom<Vec<f64>> for StrokePoint {
    type Error = String;

    fn try_from(values: Vec<f64>) -> Result<StrokePoint, String> {
        match values[..] {
            [x, y, pressure] => Ok(StrokePoint::new(x, y, pressure)),
            [x, y, pressure, tilt, speed] => Ok(StrokePoint {
                x,
                y,
                pressure,
                motion: Some(Motion { tilt, speed }),
            }),
            _ => Err(format!("a line point has 3 or 5 numbers, not {}", values.len())),
        }
    }
}

impl From<StrokePoint> for Vec<f64> {
    fn from(point: StrokePoint) -> Vec<f64> {
        match point.motion {
            None => vec![point.x, point.y, point.pressure],
            Some(Motion { tilt, speed }) => vec![point.x, point.y, point.pressure, tilt, speed],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum BrushKind {
    #[default]
    Pen,
    Eraser,
}

/// How an eraser takes away rough lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum EraseMode {
    /// 触れた部分: cut away what the eraser touches.
    Touched,
    /// 交点まで: up to where the line crosses other lines.
    Intersection,
    /// 線全体: the whole line.
    Whole,
}

/// How pen pressure (or tilt, speed, chance) changes a setting: `min` at the
/// lightest touch, the full value at the hardest, along `curve` (control
/// points in 0..1; empty is a straight line).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct PressureCurve {
    pub min: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub curve: Vec<[f64; 2]>,
}

/// Picture of the brush tip: white with the coverage in alpha.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct BrushTip {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    /// Stamp spacing in % of the size.
    #[serde(default = "default_interval")]
    pub interval: f64,
    /// Drawn with the picture; off falls back to a round tip.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_interval() -> f64 {
    10.0
}

fn default_true() -> bool {
    true
}

fn default_one() -> f64 {
    1.0
}

/// A pen or eraser (ブラシ). Sizes are millimetres on the page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Brush {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: BrushKind,
    pub size_mm: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_pressure: Option<PressureCurve>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_tilt: Option<PressureCurve>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_speed: Option<PressureCurve>,
    /// Random change along the line (only `min` is used).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_random: Option<PressureCurve>,
    #[serde(default = "default_one")]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity_pressure: Option<PressureCurve>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity_tilt: Option<PressureCurve>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity_speed: Option<PressureCurve>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity_random: Option<PressureCurve>,
    /// 1 is a hard edge.
    #[serde(default = "default_one")]
    pub hardness: f64,
    /// 手ブレ補正, 0..100.
    #[serde(default)]
    pub stabilization: f64,
    /// 速度による手ブレ補正.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stabilization_by_speed: bool,
    /// 後補正: smoothing applied once a line is drawn, 0..100 (0: off).
    #[serde(default, skip_serializing_if = "is_default")]
    pub post_correction: f64,
    /// 入り・抜き lengths.
    #[serde(default)]
    pub taper_in_mm: f64,
    #[serde(default)]
    pub taper_out_mm: f64,
    /// Tip height in % of its width, and its angle in degrees.
    #[serde(default = "default_thickness")]
    pub thickness: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tip: Option<BrushTip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub erase: Option<EraseMode>,
    /// Where it came from, e.g. "CSP: ペン / 丸ペン".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

fn default_thickness() -> f64 {
    100.0
}

/// Raster rough kept in the source sheet; the pixels are read from there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct RoughImage {
    pub id: String,
    pub layer_id: i64,
    pub layer_name: String,
    /// Crop of the sheet, in sheet pixels.
    pub sheet_crop: [f64; 4],
    /// Where the crop lands on the page, in millimetres.
    #[serde(rename = "box")]
    pub box_mm: BoxMm,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 口調のメモ: how the character talks, to keep the dialogue in voice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
}

/// A scene: a run of pages, with its place in story time for the timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub first_page: String,
    pub last_page: String,
    /// Label of when the scene happens in the story (e.g. "1日目 朝").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_time: Option<String>,
    /// Sort key in story time; differs from page order for flashbacks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_order: Option<f64>,
}

/// How a character feels at a page: -1 (negative) .. 1 (positive).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct EmotionPoint {
    pub character: String,
    pub page: String,
    pub value: f64,
    #[serde(default)]
    pub note: String,
}

/// The name sheet a project was imported from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct SourceSheet {
    pub path: String,
    pub resolution: f64,
    /// Sheet pixels of each page cell, in page order.
    pub cells: Vec<[f64; 4]>,
}

impl Project {
    pub fn new(title: &str) -> Self {
        Project {
            format_version: FORMAT_VERSION,
            title: title.to_owned(),
            story_index: None,
            author: String::new(),
            binding: Binding::Right,
            page_format: PageFormat::default(),
            pages: Vec::new(),
            characters: Vec::new(),
            scenes: Vec::new(),
            emotions: Vec::new(),
            source: None,
            brushes: Vec::new(),
            alternatives: Vec::new(),
            plan: None,
            line_shapes: None,
            held: Vec::new(),
            images: Vec::new(),
            gutters: None,
            scroll: None,
            fonts: None,
            style: None,
            csp_page: None,
            rough_layers: Vec::new(),
            series: None,
            next_id: 1,
        }
    }

    /// A new id such as "page12" or "line40"; unique within the project.
    pub fn new_id(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}{}", self.next_id);
        self.next_id += 1;
        id
    }

    pub fn page_number(&self, page_id: &str) -> Option<usize> {
        self.pages
            .iter()
            .position(|page| page.id == page_id)
            .map(|index| index + 1)
    }
}
