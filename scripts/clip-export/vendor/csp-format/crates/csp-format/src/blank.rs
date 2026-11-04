//! Pages and works made from settings alone, without a CSP-made template
//! of the work. Moved from name-studio's clip-core (`write/blank.rs`).
//!
//! The crate carries three files saved by CLIP STUDIO PAINT EX 5.1.4
//! (`assets/`): an empty single page, a work (.cmc) listing it, and the page
//! with one vector line and one text to copy editable layers from. A page
//! is the empty one with the canvas, frames, binding and story info
//! (作品名・話数・作者名・ノンブル) set from a [`PageSetup`]. Everything sized by
//! the canvas is resized, and the 作品情報 / ノンブル texts are placed where
//! CSP puts them, relative to the frames. The page is built from CSP's own
//! rather than from [`crate::create`] so that the tables and columns CSP
//! reads stay as CSP writes them.

use rusqlite::Connection;
use rusqlite::types::Value;

use crate::ClipFile;
use crate::cmc::CmcFile;
use crate::database::{has_column, has_table, quote, select, value_as_text};
use crate::error::{Error, Result, bail};
use crate::image::{RgbaImage, decode_png};
use crate::offscreen::{Attribute, BLOCK_SIZE, BlockData, Offscreen, PixelKind, encode};
use crate::story::{
    ATTR_COLOR, ATTR_FONT_LABEL, ATTR_ORIGIN, ATTR_STORY_PART, Align, LEFT_PAGE_FLAG, NOMBRE_INFO, RIGHT_PAGE_FLAG,
    STORY_INFO, StoryPart, array_parts, canvas_value, drop_render_cache, edit_story_blocks, em_px, i32_bytes, i32s,
    map_records, mirror_nombre, page_number_text, resize_block, resolution, round_half_even, set_run_length,
    set_string_array, story_layers, string_array, text_width, update_nombre,
};
use crate::text::{Attributes, ids, join_array, split_array};

/// An empty single page (A3 canvas, B4 仕上がり, 600 dpi, left page).
pub const BLANK_PAGE: &[u8] = include_bytes!("../assets/blank-page.clip");
/// The empty page with one vector layer (a line) and one text layer, to
/// copy editable layers from ([`ClipFile::copy_layer_from`]).
pub const BLANK_PARTS: &[u8] = include_bytes!("../assets/blank-parts.clip");
/// A work listing the empty page.
pub const BLANK_WORK: &[u8] = include_bytes!("../assets/blank-work.cmc");
/// The layer effects CSP gave its (ノンブル) with フチ 0.5 mm at 600 dpi
/// (`LayerEffectInfo`: the フチ on, the other effects off).
pub const NOMBRE_EDGE: &[u8] = include_bytes!("../assets/nombre-edge.bin");

/// The font of the 作品情報 and ノンブル texts.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StoryFont {
    /// As CSP shows it (`ＭＳ ゴシック`).
    pub name: String,
    /// PostScript name of the font (`MS-Gothic`).
    pub postscript: String,
}

fn first_number() -> i64 {
    1
}

/// What a page and its work are made with. Lengths in mm.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    /// キャンバス (用紙) size.
    pub canvas_mm: [f64; 2],
    /// 解像度 (dpi).
    pub resolution: f64,
    /// 仕上がり (製本) size.
    pub trim_mm: [f64; 2],
    /// 裁ち落とし幅.
    pub bleed_mm: f64,
    /// 基本枠 size and its offset from the middle of the canvas.
    pub basic_mm: [f64; 2],
    /// Offset of the 基本枠 from the middle of the canvas (x, y).
    #[serde(default)]
    pub basic_offset_mm: [f64; 2],
    /// 右綴じ (a manga) rather than 左綴じ.
    pub right_binding: bool,
    /// Whether the book's first page (index 0) is a left page.
    pub first_page_left: bool,
    /// 作品名.
    pub title: String,
    /// 話数; none leaves it out of the 作品情報.
    #[serde(default)]
    pub story_index: Option<i64>,
    /// 作者名.
    #[serde(default)]
    pub author: String,
    /// ノンブルの開始番号.
    #[serde(default = "first_number")]
    pub nombre_start: i64,
    /// None keeps the built-in one (ＭＳ ゴシック).
    #[serde(default)]
    pub font: Option<StoryFont>,
    /// サブタイトル, where the 作品情報 go, ページ番号 and a shown ノンブル.
    #[serde(default)]
    pub story: StoryLayout,
}

/// Where a 作品情報 text goes under the 仕上がり: CSP's 左下・下・右下.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoryPosition {
    /// 左下 (1).
    #[default]
    Left,
    /// 下 (2).
    Center,
    /// 右下 (3).
    Right,
}

impl StoryPosition {
    /// `ComicStory*Position`.
    pub fn column(self) -> i64 {
        match self {
            StoryPosition::Left => 1,
            StoryPosition::Center => 2,
            StoryPosition::Right => 3,
        }
    }

    fn align(self) -> Align {
        Align::of_position(self.column())
    }
}

fn center() -> StoryPosition {
    StoryPosition::Center
}

fn right() -> StoryPosition {
    StoryPosition::Right
}

/// The rest of CSP's 作品情報 and ノンブル settings. The default is what
/// CSP's new works have: 作品名 左下, 作者名 下, no ページ番号, the hidden
/// ノンブル.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryLayout {
    /// サブタイトル, after 作品名 and 話数.
    #[serde(default)]
    pub subtitle: String,
    /// Where the 作品名 goes.
    #[serde(default)]
    pub title_position: StoryPosition,
    /// Where the 作者名 goes.
    #[serde(default = "center")]
    pub author_position: StoryPosition,
    /// ページ番号 in the 作品情報 (`7ページ`); none shows none.
    #[serde(default)]
    pub page_number: Option<PageNumber>,
    /// A ノンブル printed on the page, in place of the hidden one.
    #[serde(default)]
    pub nombre: Option<ShownNombre>,
}

impl Default for StoryLayout {
    fn default() -> Self {
        StoryLayout {
            subtitle: String::new(),
            title_position: StoryPosition::Left,
            author_position: StoryPosition::Center,
            page_number: None,
            nombre: None,
        }
    }
}

/// ページ番号 in the 作品情報.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNumber {
    /// The first page's number.
    pub start: i64,
    /// Where the ページ番号 goes.
    #[serde(default = "right")]
    pub position: StoryPosition,
}

/// Where a shown ノンブル goes, from the 基本枠: above or below it, on the
/// binding side (内側), in the middle or on the other side (外側).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NombrePlace {
    /// Above the 基本枠, binding side (1).
    TopInner,
    /// Above the 基本枠, in the middle (2).
    Top,
    /// Above the 基本枠, outer side (3).
    TopOuter,
    /// Below the 基本枠, binding side (4).
    BottomInner,
    /// Below the 基本枠, in the middle (5).
    Bottom,
    /// Below the 基本枠, outer side (6).
    BottomOuter,
}

impl NombrePlace {
    /// `ComicStoryNombrePosition`.
    pub fn column(self) -> i64 {
        match self {
            NombrePlace::TopInner => 1,
            NombrePlace::Top => 2,
            NombrePlace::TopOuter => 3,
            NombrePlace::BottomInner => 4,
            NombrePlace::Bottom => 5,
            NombrePlace::BottomOuter => 6,
        }
    }

    fn top(self) -> bool {
        self.column() <= 3
    }

    fn align(self) -> Align {
        match self.column() {
            1 | 4 => Align::End,
            2 | 5 => Align::Middle,
            _ => Align::Start,
        }
    }
}

fn nombre_offset() -> [f64; 2] {
    [0.0, 5.0]
}

fn nombre_size() -> f64 {
    9.0
}

/// A ノンブル printed on the page (CSP's ノンブル, not the hidden one).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShownNombre {
    /// Where the ノンブル goes.
    pub place: NombrePlace,
    /// 白 rather than 黒.
    #[serde(default)]
    pub white: bool,
    /// フチ width (mm); none: no フチ.
    #[serde(default)]
    pub edge_mm: Option<f64>,
    /// フォーマット: the text before and after the number.
    #[serde(default)]
    pub prefix: String,
    /// Text after the number.
    #[serde(default)]
    pub suffix: String,
    /// 基本枠との間隔: 横 (from the 基本枠's side, inwards) and 縦.
    #[serde(default = "nombre_offset")]
    pub offset_mm: [f64; 2],
    /// サイズ (pt).
    #[serde(default = "nombre_size")]
    pub size_pt: f64,
}

impl ShownNombre {
    fn text(&self, number: i64) -> String {
        format!("{}{number}{}", self.prefix, self.suffix)
    }
}

/// The largest side CSP takes, in px.
pub const MAX_SIDE_PX: i64 = 30_000;

fn mm_to_px(mm: f64, resolution: f64) -> i64 {
    round_half_even(mm * resolution / 25.4)
}

impl PageSetup {
    /// Whether the values make a page CSP opens (sizes, frames inside the
    /// canvas, resolution 72–1200 dpi). Messages for people (and checks of
    /// what a person may type) are the application's.
    pub fn check(&self) -> Result<()> {
        let positive = |values: &[f64]| values.iter().all(|value| value.is_finite() && *value > 0.0);
        if !positive(&[self.canvas_mm[0], self.canvas_mm[1], self.trim_mm[0], self.trim_mm[1]])
            || !positive(&[self.basic_mm[0], self.basic_mm[1]])
        {
            bail!("Canvas, trim and basic frame sizes must be positive");
        }
        if !(self.resolution.is_finite() && (72.0..=1200.0).contains(&self.resolution)) {
            bail!("Resolution {} is outside 72–1200 dpi", self.resolution);
        }
        if self.trim_mm[0] > self.canvas_mm[0] + 1e-9 || self.trim_mm[1] > self.canvas_mm[1] + 1e-9 {
            bail!("The trim frame is larger than the canvas");
        }
        if !(self.bleed_mm.is_finite() && self.bleed_mm >= 0.0) {
            bail!("The bleed must be 0 or more");
        }
        let [ox, oy] = self.basic_offset_mm;
        if !(ox.is_finite() && oy.is_finite())
            || self.basic_mm[0] / 2.0 + ox.abs() > self.canvas_mm[0] / 2.0 + 1e-9
            || self.basic_mm[1] / 2.0 + oy.abs() > self.canvas_mm[1] / 2.0 + 1e-9
        {
            bail!("The basic frame goes past the canvas");
        }
        let (width, height) = self.canvas_px();
        if width > MAX_SIDE_PX || height > MAX_SIDE_PX {
            bail!("The canvas is {width}×{height} px; CSP takes up to {MAX_SIDE_PX}");
        }
        if self.story_index.is_some_and(|index| index < 0)
            || self.nombre_start < 0
            || self.story.page_number.as_ref().is_some_and(|number| number.start < 0)
        {
            bail!("Story and page numbers must be 0 or more");
        }
        if let Some(nombre) = &self.story.nombre
            && !(nombre.size_pt.is_finite()
                && nombre.size_pt > 0.0
                && nombre.edge_mm.is_none_or(|edge| edge.is_finite() && edge >= 0.0)
                && nombre.offset_mm.iter().all(|offset| offset.is_finite()))
        {
            bail!("The shown nombre needs a positive size and finite offsets");
        }
        Ok(())
    }

    fn px(&self, mm: f64) -> i64 {
        mm_to_px(mm, self.resolution)
    }

    /// Canvas size in pixels.
    pub fn canvas_px(&self) -> (i64, i64) {
        (self.px(self.canvas_mm[0]), self.px(self.canvas_mm[1]))
    }

    /// The 作品情報 line: 作品名, 話数 and サブタイトル as CSP writes them.
    pub fn story_line(&self) -> String {
        let mut line = self.title.trim().to_owned();
        if let Some(index) = self.story_index {
            line.push_str(&format!(" {index}話"));
        }
        let subtitle = self.story.subtitle.trim();
        if !subtitle.is_empty() {
            line.push(' ');
            line.push_str(subtitle);
        }
        line
    }
}

/// Canvas size and frames in px, as CSP lays them out (centred, rounded down).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Frames {
    width: i64,
    height: i64,
    resolution: f64,
    trim: [i64; 4],
    basic: [i64; 4],
}

impl Frames {
    fn new(width: i64, height: i64, resolution: f64, trim: (i64, i64), basic: (i64, i64), offset: (i64, i64)) -> Self {
        let centred = |(w, h): (i64, i64), (dx, dy): (i64, i64)| {
            let x0 = (width - w).div_euclid(2) + dx;
            let y0 = (height - h).div_euclid(2) + dy;
            [x0, y0, x0 + w, y0 + h]
        };
        Frames { width, height, resolution, trim: centred(trim, (0, 0)), basic: centred(basic, offset) }
    }

    fn of_setup(setup: &PageSetup) -> Self {
        let (width, height) = setup.canvas_px();
        Frames::new(
            width,
            height,
            setup.resolution,
            (setup.px(setup.trim_mm[0]), setup.px(setup.trim_mm[1])),
            (setup.px(setup.basic_mm[0]), setup.px(setup.basic_mm[1])),
            (setup.px(setup.basic_offset_mm[0]), setup.px(setup.basic_offset_mm[1])),
        )
    }

    /// The frames of a page whose sizes are in mm.
    fn of_page(db: &Connection) -> Result<Self> {
        let real = |column: &str| -> Result<f64> {
            Ok(match canvas_value(db, column)? {
                Some(Value::Real(number)) => number,
                Some(Value::Integer(number)) => number as f64,
                _ => 0.0,
            })
        };
        let resolution = real("CanvasResolution")?;
        let px = |column: &str| -> Result<i64> { Ok(mm_to_px(real(column)?, resolution)) };
        Ok(Frames::new(
            px("CanvasWidth")?,
            px("CanvasHeight")?,
            resolution,
            (px("CropFrameWidth")?, px("CropFrameHeight")?),
            (px("CropFrameInnerWidth")?, px("CropFrameInnerHeight")?),
            (px("CropFrameInnerOffsetX")?, px("CropFrameInnerOffsetY")?),
        ))
    }
}

/// The built-in empty page made for `setup`, with new file and layer ids.
pub fn blank_page(setup: &PageSetup) -> Result<ClipFile> {
    setup.check()?;
    let mut page = ClipFile::from_bytes(BLANK_PAGE.to_vec())?;
    page.renew_file_id();
    renew_layer_uuids(&page)?;
    apply_setup(&mut page, setup)?;
    Ok(page)
}

/// The built-in page with a vector and a text layer (to copy from), with a
/// new file id.
pub fn blank_parts() -> Result<ClipFile> {
    let mut parts = ClipFile::from_bytes(BLANK_PARTS.to_vec())?;
    parts.renew_file_id();
    Ok(parts)
}

fn renew_layer_uuids(page: &ClipFile) -> Result<()> {
    if !has_column(page.database(), "Layer", "LayerUuid")? {
        return Ok(());
    }
    for row in select(page.database(), "SELECT MainId FROM Layer WHERE LayerUuid IS NOT NULL", [])? {
        page.database().execute(
            "UPDATE Layer SET LayerUuid = ?1 WHERE MainId = ?2",
            (crate::edit::layer_uuid(), row.int("MainId")),
        )?;
    }
    Ok(())
}

/// Give a CSP-made empty single page (a left page) the canvas, frames,
/// binding and story info of `setup`.
pub fn apply_setup(page: &mut ClipFile, setup: &PageSetup) -> Result<()> {
    let db = page.database();
    if matches!(canvas_value(db, "CanvasDoublePage")?, Some(Value::Integer(flag)) if flag != 0) {
        bail!("A spread cannot be made into a single page");
    }
    if !matches!(canvas_value(db, "ComicIsLeftPage")?, Some(Value::Integer(1))) {
        bail!("The empty page must be a left page");
    }
    let old = Frames::of_page(db)?;
    let new = Frames::of_setup(setup);
    if setup.story.page_number.is_some() {
        add_page_number(db)?;
    }
    if let Some(nombre) = &setup.story.nombre {
        show_nombre(db, nombre, setup.nombre_start, setup.resolution)?;
    }
    set_story_texts(db, setup)?;
    place_story_texts(db, &old, &new, setup)?;
    drop_text_images(db)?;
    set_canvas(db, setup)?;
    if let Some(font) = &setup.font {
        set_story_font(db, font)?;
    }
    if (old.width, old.height) != (new.width, new.height) {
        // The empty page's offscreens hold one colour (the paper's white) or
        // nothing, so scaling keeps them as they are.
        resize_offscreens(page, (old.width, old.height), (new.width, new.height))?;
        set_thumbnail_canvas(page.database(), new.width, new.height)?;
        blank_preview(page.database(), new.width, new.height)?;
    }
    let db = page.database();
    if !setup.first_page_left {
        db.execute("UPDATE Canvas SET ComicIsLeftPage = 0", [])?;
        if let Some(Value::Integer(flag)) = canvas_value(db, "CropFrameOptionFlag")? {
            let flag = (flag & !(LEFT_PAGE_FLAG | RIGHT_PAGE_FLAG)) | RIGHT_PAGE_FLAG;
            db.execute("UPDATE Canvas SET CropFrameOptionFlag = ?1", [flag])?;
        }
        mirror_nombre(db)?;
    }
    // The page is the first one: its ノンブル is the start number.
    update_nombre(db, !setup.first_page_left)?;
    page.reload()
}

fn set_columns(db: &Connection, table: &str, values: &[(&str, Value)]) -> Result<()> {
    for (column, value) in values {
        if has_column(db, table, column)? {
            db.execute(&format!("UPDATE {} SET {} = ?1", quote(table), quote(column)), [value])?;
        }
    }
    Ok(())
}

/// The work-wide story settings, as both a page's Canvas and a work's
/// Project row hold them.
fn story_values(setup: &PageSetup) -> Vec<(&'static str, Value)> {
    let mut values = vec![
        ("ComicStoryStoryName", Value::Text(setup.title.trim().to_owned())),
        ("ComicStoryUseStoryIndex", Value::Integer(setup.story_index.is_some() as i64)),
        ("ComicStoryAuthorName", Value::Text(setup.author.trim().to_owned())),
        ("ComicStoryNombreStart", Value::Integer(setup.nombre_start)),
        // 1 in CSP's right-bound works.
        ("ComicBindPosition", Value::Integer(setup.right_binding as i64)),
    ];
    if let Some(index) = setup.story_index {
        values.push(("ComicStoryStoryIndex", Value::Integer(index)));
    }
    let story = &setup.story;
    values.extend([
        ("ComicStorySubTitle", Value::Text(story.subtitle.trim().to_owned())),
        ("ComicStoryStoryPosition", Value::Integer(story.title_position.column())),
        ("ComicStoryAuthorPosition", Value::Integer(story.author_position.column())),
        ("ComicStoryUsePageNumber", Value::Integer(story.page_number.is_some() as i64)),
        ("ComicStoryUseShownNombre", Value::Integer(story.nombre.is_some() as i64)),
        ("ComicStoryUseHiddenNombre", Value::Integer(story.nombre.is_none() as i64)),
    ]);
    if let Some(number) = &story.page_number {
        values.push(("ComicStoryPageNumberStart", Value::Integer(number.start)));
        values.push(("ComicStoryPageNumberPosition", Value::Integer(number.position.column())));
    }
    if let Some(nombre) = &story.nombre {
        values.extend([
            ("ComicStoryNombrePosition", Value::Integer(nombre.place.column())),
            ("ComicStoryNombrePrefix", Value::Text(nombre.prefix.clone())),
            ("ComicStoryNombreSuffix", Value::Text(nombre.suffix.clone())),
            ("ComicStoryNombreColor", Value::Integer(nombre.white as i64)),
            ("ComicStoryNombreUseEdge", Value::Integer(nombre.edge_mm.is_some() as i64)),
            ("ComicStoryNombreFontSize", Value::Real(nombre.size_pt)),
            ("ComicStoryXPageNombreOffset", Value::Real(nombre.offset_mm[0])),
            ("ComicStoryXPageNombreOffsetUnit", Value::Integer(2)),
            ("ComicStoryYPageNombreOffset", Value::Real(nombre.offset_mm[1])),
            ("ComicStoryYPageNombreOffsetUnit", Value::Integer(2)),
        ]);
        if let Some(edge) = nombre.edge_mm {
            values.push(("ComicStoryNombreEdgeWidth", Value::Real(edge)));
            values.push(("ComicStoryNombreEdgeUnit", Value::Integer(2)));
        }
    }
    if let Some(font) = &setup.font {
        values.push(("ComicStoryNombreFont", Value::Text(font.name.clone())));
        values.push(("ComicStoryNombreFontPostScriptName", Value::Text(font.postscript.clone())));
    }
    values
}

fn set_canvas(db: &Connection, setup: &PageSetup) -> Result<()> {
    let real = Value::Real;
    let mut values = vec![
        ("CanvasUnit", Value::Integer(2)),
        ("CanvasWidth", real(setup.canvas_mm[0])),
        ("CanvasHeight", real(setup.canvas_mm[1])),
        ("CanvasResolution", real(setup.resolution)),
        ("CropFrameUnitKind", Value::Integer(2)),
        ("CropFrameWidth", real(setup.trim_mm[0])),
        ("CropFrameHeight", real(setup.trim_mm[1])),
        ("CropFrameDitch", real(setup.bleed_mm)),
        ("CropFrameInnerWidth", real(setup.basic_mm[0])),
        ("CropFrameInnerHeight", real(setup.basic_mm[1])),
        ("CropFrameInnerOffsetX", real(setup.basic_offset_mm[0])),
        ("CropFrameInnerOffsetY", real(setup.basic_offset_mm[1])),
        ("CropFrameShow", Value::Integer(1)),
        ("ComicPageIndex", Value::Integer(0)),
    ];
    values.extend(story_values(setup));
    set_columns(db, "Canvas", &values)
}

/// The built-in work with `setup`'s settings, listing its one page (replace
/// the list with [`CmcFile::save_with_pages`] once the pages are written).
pub fn blank_work(setup: &PageSetup) -> Result<CmcFile> {
    setup.check()?;
    let mut work = CmcFile::from_bytes(BLANK_WORK.to_vec())?;
    let real = Value::Real;
    let mut values = vec![
        // 0 in CSP's right-bound works whose first page is a left page (the usual manga).
        ("ComicStartPage", Value::Integer((!setup.first_page_left) as i64)),
        ("DefaultPageUnit", Value::Integer(2)),
        ("DefaultPageWidth", real(setup.canvas_mm[0])),
        ("DefaultPageHeight", real(setup.canvas_mm[1])),
        ("DefaultPageResolution", real(setup.resolution)),
        ("DefaultPageUseCropFrame", Value::Integer(1)),
        ("DefaultPageCropWidth", real(setup.trim_mm[0])),
        ("DefaultPageCropHeight", real(setup.trim_mm[1])),
        ("DefaultPageCropDitch", real(setup.bleed_mm)),
        ("DefaultPageCropInnerWidth", real(setup.basic_mm[0])),
        ("DefaultPageCropInnerHeight", real(setup.basic_mm[1])),
        ("DefaultPageCropInnerOffsetX", real(setup.basic_offset_mm[0])),
        ("DefaultPageCropInnerOffsetY", real(setup.basic_offset_mm[1])),
    ];
    values.extend(story_values(setup));
    set_columns(work.database(), "Project", &values)?;
    work.database().execute(
        "UPDATE CanvasNode SET LinkUnit = 2, LinkWidth = ?1, LinkHeight = ?2, LinkResolution = ?3 WHERE Type = 2",
        (setup.canvas_mm[0], setup.canvas_mm[1], setup.resolution),
    )?;
    work.modified = true;
    work.reload()?;
    Ok(work)
}

/// Rewrite the blocks of one attributes array column.
fn edit_array(db: &Connection, layer_id: i64, column: &str, edit: &dyn Fn(&mut Vec<Attributes>)) -> Result<()> {
    if !has_column(db, "Layer", column)? {
        return Ok(());
    }
    let blob: Value =
        db.query_row(&format!("SELECT {} FROM Layer WHERE MainId = ?1", quote(column)), [layer_id], |row| row.get(0))?;
    let Value::Blob(blob) = blob else { return Ok(()) };
    let mut blocks = split_array(&blob)?.into_iter().map(Attributes::parse).collect::<Result<Vec<_>>>()?;
    edit(&mut blocks);
    let joined = join_array(&blocks.iter().map(Attributes::to_bytes).collect::<Vec<_>>());
    db.execute(&format!("UPDATE Layer SET {} = ?1 WHERE MainId = ?2", quote(column)), (joined, layer_id))?;
    Ok(())
}

fn with_part(attributes: &Attributes, part: StoryPart) -> Attributes {
    map_records(attributes.clone(), |id, data| if id == ATTR_STORY_PART { i32_bytes(&[part.code()]) } else { data })
}

/// Give the 作品情報 a ページ番号: a block after the 作者名's, like it, as CSP
/// adds it (its text and place are set with the others).
fn add_page_number(db: &Connection) -> Result<()> {
    for (layer_id, _) in story_layers(db, STORY_INFO)? {
        if array_parts(db, layer_id)?.contains(&StoryPart::PageNumber) {
            continue;
        }
        for column in ["TextLayerAttributesArray", "TextLayerAddAttributesV01"] {
            edit_array(db, layer_id, column, &|blocks| {
                let author = blocks.iter().rposition(|attributes| {
                    attributes.get(ATTR_STORY_PART).map(i32s).as_deref() == Some(&[StoryPart::Author.code()])
                });
                if let Some(author) = author.or(blocks.len().checked_sub(1)) {
                    let block = with_part(&blocks[author], StoryPart::PageNumber);
                    blocks.push(block);
                }
            })?;
        }
        if let Some(mut strings) = string_array(db, layer_id)? {
            strings.push(String::new());
            set_string_array(db, layer_id, &strings)?;
        }
    }
    Ok(())
}

/// Make the hidden ノンブル a shown one: its part, size and colour, with the
/// first page's text (placed with the others).
fn show_nombre(db: &Connection, nombre: &ShownNombre, start: i64, page_resolution: f64) -> Result<()> {
    let resolution = resolution(db)?;
    let text = nombre.text(start);
    let units = text.encode_utf16().count();
    let size = round_half_even(nombre.size_pt * 100.0);
    for (layer_id, _) in story_layers(db, NOMBRE_INFO)? {
        db.execute("UPDATE Layer SET TextLayerString = ?1 WHERE MainId = ?2", (text.as_bytes(), layer_id))?;
        edit_story_blocks(db, layer_id, NOMBRE_INFO, &|_, counted, attributes| {
            let old = attributes
                .get(ids::FONT_SIZE)
                .map(i32s)
                .and_then(|values| values.first().copied())
                .filter(|old| *old > 0)
                .unwrap_or(600);
            let ratio = size as f64 / old as f64;
            let scale = |values: Vec<i64>| -> Vec<u8> {
                i32_bytes(&values.into_iter().map(|value| round_half_even(value as f64 * ratio)).collect::<Vec<_>>())
            };
            let attributes = map_records(attributes, |id, data| match id {
                ATTR_STORY_PART => i32_bytes(&[StoryPart::Nombre.code()]),
                ids::FONT_SIZE if data.len() == 4 => i32_bytes(&[size]),
                ATTR_COLOR if data.len() == 12 => vec![if nombre.white { 0xff } else { 0 }; 12],
                ids::BLOCK_SIZE | ids::QUAD | ATTR_ORIGIN if data.len() % 4 == 0 => scale(i32s(&data)),
                ids::BBOX if data.len() == 16 => {
                    let [x0, y0, x1, y1] = i32s(&data)[..] else { unreachable!() };
                    i32_bytes(&[x0, y0, x1, y0 + round_half_even((y1 - y0) as f64 * ratio)])
                }
                _ => data,
            });
            let width = text_width(&text, em_px(&attributes, resolution));
            Ok(resize_block(set_run_length(attributes, units, counted), width, Align::Start))
        })?;
        drop_render_cache(db, layer_id)?;
        if let Some(edge) = nombre.edge_mm {
            // In px of the page made (the template's resolution changes after this).
            set_edge(db, layer_id, edge / 25.4 * page_resolution, nombre.white)?;
        }
    }
    Ok(())
}

/// Give a layer CSP's フチ (a layer effect, not a text attribute): `width`
/// px, black around white text and white around black.
fn set_edge(db: &Connection, layer_id: i64, width: f64, white_text: bool) -> Result<()> {
    let mut info = NOMBRE_EDGE.to_vec();
    // After the size, the count and the name `EffectEdge`: on, width, colour.
    let at = 4 + 4 + 4 + "EffectEdge".len() * 2;
    if info.get(at..at + 4) != Some(&[0, 0, 0, 1]) {
        bail!("Unexpected layer effect template");
    }
    info[at + 4..at + 12].copy_from_slice(&width.to_be_bytes());
    let channel: u32 = if white_text { 0 } else { 255 };
    for index in 0..3 {
        let start = at + 12 + index * 4;
        info[start..start + 4].copy_from_slice(&channel.to_be_bytes());
    }
    let mut values: Vec<(&str, Value)> = [
        "EffectLayerRenderType",
        "EffectRenderType",
        "EffectReferAreaType",
        "EffectSetUpdateRectType",
        "EffectOffscreenFixType",
        "EffectOffscreenMoveType",
    ]
    .into_iter()
    .map(|column| (column, Value::Integer(10)))
    .collect();
    values.push(("LayerEffectAttached", Value::Integer(1)));
    values.push(("LayerEffectEdgeNewRender", Value::Integer(1)));
    values.push(("LayerEffectInfo", Value::Blob(info)));
    for (column, value) in values {
        if !has_column(db, "Layer", column)? {
            db.execute(&format!("ALTER TABLE Layer ADD COLUMN {}", quote(column)), [])?;
        }
        db.execute(&format!("UPDATE Layer SET {} = ?1 WHERE MainId = ?2", quote(column)), (value, layer_id))?;
    }
    Ok(())
}

/// Write the 作品名・話数・サブタイトル, 作者名 and ページ番号 into the 作品情報
/// layer: the strings, their style runs' lengths and the blocks' widths.
/// CSP draws them afresh.
fn set_story_texts(db: &Connection, setup: &PageSetup) -> Result<()> {
    let resolution = resolution(db)?;
    let title = setup.story_line();
    let author = setup.author.trim().to_owned();
    // The page is the first one.
    let page = setup.story.page_number.as_ref().map(|number| page_number_text(number.start));
    for (layer_id, _) in story_layers(db, STORY_INFO)? {
        db.execute("UPDATE Layer SET TextLayerString = ?1 WHERE MainId = ?2", (title.as_bytes(), layer_id))?;
        if let Some(mut strings) = string_array(db, layer_id)? {
            let parts = array_parts(db, layer_id)?;
            strings.resize(parts.len().max(strings.len()), String::new());
            for (index, part) in parts.iter().enumerate() {
                match (part, &page) {
                    (StoryPart::Author, _) => strings[index] = author.clone(),
                    (StoryPart::PageNumber, Some(page)) => strings[index] = page.clone(),
                    _ => {}
                }
            }
            set_string_array(db, layer_id, &strings)?;
        }
        edit_story_blocks(db, layer_id, STORY_INFO, &|part, counted, attributes| {
            let text = match (part, &page) {
                (StoryPart::Title, _) => &title,
                (StoryPart::Author, _) => &author,
                (StoryPart::PageNumber, Some(page)) => page,
                _ => return Ok(attributes),
            };
            let width = text_width(text, em_px(&attributes, resolution));
            Ok(resize_block(set_run_length(attributes, text.encode_utf16().count(), counted), width, Align::Start))
        })?;
        drop_render_cache(db, layer_id)?;
    }
    Ok(())
}

fn layer_offset(db: &Connection, layer_id: i64) -> Result<(i64, i64)> {
    let (x, y): (Option<i64>, Option<i64>) =
        db.query_row("SELECT LayerOffsetX, LayerOffsetY FROM Layer WHERE MainId = ?1", [layer_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
    Ok((x.unwrap_or(0), y.unwrap_or(0)))
}

/// Where a 作品情報 part goes: its position and its row there (items at one
/// position stack up: ページ番号, 作品名, 作者名), and how many rows the
/// tallest stack has.
fn story_rows(story: &StoryLayout) -> (impl Fn(StoryPart) -> Option<(StoryPosition, i64)>, i64) {
    let order = [
        (StoryPart::PageNumber, story.page_number.as_ref().map(|number| number.position)),
        (StoryPart::Title, Some(story.title_position)),
        (StoryPart::Author, Some(story.author_position)),
    ];
    let row = move |part: StoryPart| {
        let at = order.iter().position(|(one, _)| *one == part)?;
        let position = order[at].1?;
        let above = order[..at].iter().filter(|(_, other)| *other == Some(position)).count();
        Some((position, above as i64))
    };
    let rows = order
        .iter()
        .filter_map(|(_, position)| *position)
        .map(|position| order.iter().filter(|(_, other)| *other == Some(position)).count())
        .max()
        .unwrap_or(1) as i64;
    (row, rows)
}

/// The least room left under 作品名 and 作者名, from the canvas edge.
const STORY_MARGIN_MM: f64 = 0.5;

/// Move the story info texts from the template's frames to the new ones,
/// scaled by the change of resolution: the 作品情報 under the 仕上がり (at its
/// left edge, middle or right edge), the hidden ノンブル at the binding edge
/// of the 仕上がり, level with the bottom of the 基本枠, and a shown one above
/// or below the 基本枠.
fn place_story_texts(db: &Connection, old: &Frames, new: &Frames, setup: &PageSetup) -> Result<()> {
    let scale = new.resolution / old.resolution;
    let at = |anchor_old: i64, anchor_new: i64, value: i64| {
        anchor_new + round_half_even((value - anchor_old) as f64 * scale)
    };
    let px = |mm: f64| mm_to_px(mm, new.resolution);
    // CSP puts the first row about 6 mm under the 仕上がり (its pages of A3/B4
    // and A4/B5 agree), a row a line high. When the canvas has no room there
    // (a canvas of 仕上がり + 裁ち落とし), they go up, inside the canvas, so they
    // can be seen.
    let margin = round_half_even(STORY_MARGIN_MM / 25.4 * new.resolution);
    let (row_of, rows) = story_rows(&setup.story);
    let below = |y0: i64, height: i64, row: i64| {
        let first = at(old.trim[3], new.trim[3], y0);
        let lift = (first + rows * height - (new.height - margin)).max(0);
        first + row * height - lift
    };
    for info in [STORY_INFO, NOMBRE_INFO] {
        for (layer_id, _) in story_layers(db, info)? {
            let (dx, dy) = layer_offset(db, layer_id)?;
            edit_story_blocks(db, layer_id, info, &|part, _, attributes| {
                Ok(map_records(attributes, |id, data| match id {
                    ids::BBOX if data.len() == 16 => {
                        let [x0, y0, x1, y1] = i32s(&data)[..] else { unreachable!() };
                        let (x0, y0, x1, y1) = (x0 + dx, y0 + dy, x1 + dx, y1 + dy);
                        let width = round_half_even((x1 - x0) as f64 * scale);
                        let height = round_half_even((y1 - y0) as f64 * scale);
                        let along = |align: Align, from: i64, to: i64| match align {
                            Align::Start => from,
                            Align::Middle => (from + to) / 2 - width / 2,
                            Align::End => to - width,
                        };
                        let (x0, y0) = match (part, &setup.story.nombre) {
                            (StoryPart::Nombre, None) => (
                                // A left page: the binding edge is on the right.
                                at(old.trim[2], new.trim[2], x1) - width,
                                at(old.basic[3], new.basic[3], y1) - height,
                            ),
                            (StoryPart::Nombre, Some(nombre)) => {
                                // 内側 is the binding side: the right of a left page.
                                let [across, apart] = [px(nombre.offset_mm[0]), px(nombre.offset_mm[1])];
                                let x = match nombre.place.align() {
                                    Align::Start => new.basic[0] + across,
                                    Align::Middle => along(Align::Middle, new.basic[0], new.basic[2]),
                                    Align::End => new.basic[2] - across - width,
                                };
                                let y = if nombre.place.top() {
                                    new.basic[1] - apart - height
                                } else {
                                    new.basic[3] + apart
                                };
                                (x, y)
                            }
                            (part, _) => match row_of(part) {
                                Some((position, row)) => {
                                    (along(position.align(), new.trim[0], new.trim[2]), below(y0, height, row))
                                }
                                None => (at(old.trim[0], new.trim[0], x0), below(y0, height, 0)),
                            },
                        };
                        i32_bytes(&[x0 - dx, y0 - dy, x0 + width - dx, y0 + height - dy])
                    }
                    ids::BLOCK_SIZE | ids::QUAD | ATTR_ORIGIN if data.len() % 4 == 0 && scale != 1.0 => {
                        let scaled: Vec<i64> =
                            i32s(&data).into_iter().map(|number| round_half_even(number as f64 * scale)).collect();
                        i32_bytes(&scaled)
                    }
                    _ => data,
                }))
            })?;
            drop_render_cache(db, layer_id)?;
        }
    }
    Ok(())
}

/// Remove the images CSP drew of the story info texts (record 0x32, cleared
/// above): offscreens of those layers that no mipmap or thumbnail uses.
/// They showed the template's texts.
fn drop_text_images(db: &Connection) -> Result<()> {
    let mut layers = story_layers(db, STORY_INFO)?;
    layers.extend(story_layers(db, NOMBRE_INFO)?);
    for (layer_id, _) in layers {
        db.execute(
            "DELETE FROM Offscreen WHERE LayerId = ?1 \
             AND MainId NOT IN (SELECT Offscreen FROM MipmapInfo WHERE Offscreen IS NOT NULL) \
             AND MainId NOT IN (SELECT ThumbnailOffscreen FROM LayerThumbnail WHERE ThumbnailOffscreen IS NOT NULL)",
            [layer_id],
        )?;
    }
    Ok(())
}

/// Set the font of the 作品情報 and ノンブル texts.
fn set_story_font(db: &Connection, font: &StoryFont) -> Result<()> {
    // Record 57: u16 1, then the shown and the PostScript name, each u16 length + UTF-8.
    let mut attribute = 1u16.to_le_bytes().to_vec();
    for text in [&font.name, &font.postscript] {
        attribute.extend((text.len() as u16).to_le_bytes());
        attribute.extend(text.as_bytes());
    }
    for info in [STORY_INFO, NOMBRE_INFO] {
        for (layer_id, _) in story_layers(db, info)? {
            edit_story_blocks(db, layer_id, info, &|_, _, attributes| {
                Ok(map_records(attributes, |id, data| match id {
                    ATTR_FONT_LABEL if !data.is_empty() => font.name.as_bytes().to_vec(),
                    ids::FONT if !data.is_empty() => attribute.clone(),
                    _ => data,
                }))
            })?;
        }
    }
    Ok(())
}

/// Mipmap level sizes from a base size: each level is half of the one
/// before, rounded down.
fn levels(base: i64) -> Vec<i64> {
    let mut result = vec![base];
    while result.len() < 16 && *result.last().unwrap() > 1 {
        result.push(result.last().unwrap() / 2);
    }
    result
}

fn padded(size: i64) -> i64 {
    let block = BLOCK_SIZE as i64;
    (size + block - 1) / block * block
}

/// Resize every offscreen sized by the canvas from `old` to `new` (px):
/// render mipmaps (the root's at the exact canvas size, the layers' padded
/// to whole blocks) at every level, their pixels scaled. Layer thumbnails
/// keep their size. An offscreen stays without stored pixels when it had
/// none (CSP makes those levels when it opens the page).
fn resize_offscreens(
    page: &mut ClipFile,
    (width, height): (i64, i64),
    (new_width, new_height): (i64, i64),
) -> Result<()> {
    let families = [
        (levels(width), levels(height), levels(new_width), levels(new_height)),
        (levels(padded(width)), levels(padded(height)), levels(padded(new_width)), levels(padded(new_height))),
    ];
    for row in select(page.database(), "SELECT MainId, Attribute, BlockData FROM Offscreen", [])? {
        let Some(attribute) = row.blob("Attribute") else { continue };
        let Ok(mut attribute) = Attribute::parse(attribute) else { continue };
        let Ok(parameter) = attribute.parameter() else { continue };
        let size = (parameter.width as i64, parameter.height as i64);
        let Some((target_width, target_height)) = families.iter().find_map(|(widths, heights, new_w, new_h)| {
            let count = widths.len().min(heights.len()).min(new_w.len()).min(new_h.len());
            (0..count).find(|level| (widths[*level], heights[*level]) == size).map(|level| (new_w[level], new_h[level]))
        }) else {
            continue;
        };
        let external = row.get("BlockData").and_then(value_as_text).unwrap_or_default();
        let stored = page.external(&external).map(<[u8]>::to_vec);
        let old = match &stored {
            Some(payload) => Some(Offscreen::parse(&attribute.to_bytes(), Some(payload))?.to_rgba()?),
            None => None,
        };
        let resized = crate::offscreen::Parameter {
            width: target_width as u32,
            height: target_height as u32,
            blocks_x: (target_width as u32).div_ceil(BLOCK_SIZE),
            blocks_y: (target_height as u32).div_ceil(BLOCK_SIZE),
            ..parameter
        };
        let image =
            old.filter(|old| old.alpha_bbox().is_some()).map(|old| old.resize_area(resized.width, resized.height));
        let data = match (&image, resized.kind()) {
            (Some(image), PixelKind::Color | PixelKind::Gray) => encode(&resized, Some(image), None)?,
            (Some(_), kind) => bail!("Resizing {kind:?} offscreens with pixels is not supported"),
            (None, _) => BlockData::from_raw_blocks(&vec![None; resized.block_count()], resized.block_bytes())?,
        };
        let values = &mut attribute
            .sections
            .iter_mut()
            .find(|section| section.name == "Parameter")
            .ok_or_else(|| Error::format("Offscreen attribute has no Parameter section"))?
            .values;
        values[..4].copy_from_slice(&[resized.width, resized.height, resized.blocks_x, resized.blocks_y]);
        attribute.set_block_sizes(&data.record_sizes());
        page.database().execute(
            "UPDATE Offscreen SET Attribute = ?1 WHERE MainId = ?2",
            (attribute.to_bytes(), row.int("MainId")),
        )?;
        if stored.is_some() {
            page.set_external(&external, data.to_bytes());
        }
    }
    Ok(())
}

/// Record the canvas size (px) the layer thumbnails were drawn for.
fn set_thumbnail_canvas(db: &Connection, width: i64, height: i64) -> Result<()> {
    for (column, value) in [("ThumbnailCanvasWidth", width), ("ThumbnailCanvasHeight", height)] {
        if has_column(db, "LayerThumbnail", column)? {
            db.execute(&format!("UPDATE LayerThumbnail SET {} = ?1", quote(column)), [value])?;
        }
    }
    Ok(())
}

/// CSP keeps the page preview at an eighth of the canvas.
const PREVIEW_SCALE: f64 = 8.0;

/// A blank (white) preview for a canvas of `width` × `height` px, at the
/// size CSP gives it.
fn blank_preview(db: &Connection, width: i64, height: i64) -> Result<()> {
    if !has_table(db, "CanvasPreview")? {
        return Ok(());
    }
    let Some(row) = select(db, "SELECT rowid AS id, ImageData FROM CanvasPreview ORDER BY rowid LIMIT 1", [])?.pop()
    else {
        return Ok(());
    };
    if row.blob("ImageData").is_none_or(|png| decode_png(png).is_err()) {
        return Ok(());
    }
    let size = |pixels: i64| ((pixels as f64 / PREVIEW_SCALE).round() as u32).max(1);
    let mut preview = RgbaImage::new(size(width), size(height));
    preview.fill([255, 255, 255, 255]);
    let id = row.int("id");
    db.execute("UPDATE CanvasPreview SET ImageData = ?1 WHERE rowid = ?2", (preview.to_png()?, id))?;
    for (column, value) in [("ImageWidth", preview.width), ("ImageHeight", preview.height)] {
        if has_column(db, "CanvasPreview", column)? {
            db.execute(&format!("UPDATE CanvasPreview SET {} = ?1 WHERE rowid = ?2", quote(column)), (value, id))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LayerKind;

    /// The settings the built-in page was saved with in CSP (A3 canvas, B4
    /// 仕上がり, 600 dpi), with another work's story info.
    fn commercial() -> PageSetup {
        PageSetup {
            canvas_mm: [297.0, 420.0],
            resolution: 600.0,
            trim_mm: [257.0, 364.0],
            bleed_mm: 5.0,
            basic_mm: [212.0, 300.0],
            basic_offset_mm: [0.0, 0.0],
            right_binding: true,
            first_page_left: true,
            title: "ユメの話".into(),
            story_index: Some(4),
            author: "だれか".into(),
            nombre_start: 1,
            font: None,
            story: StoryLayout::default(),
        }
    }

    /// G1 / G2, made in CSP EX 5.1.4: a 60 × 80 mm 仕上がり (= 基本枠) on a
    /// 70 × 90 mm canvas at 600 dpi, with サブタイトル, ページ番号 from 7 and a
    /// white ノンブル `p.1-` 3 mm from the 基本枠.
    fn shown(place: NombrePlace, position: StoryPosition) -> PageSetup {
        PageSetup {
            canvas_mm: [70.0, 90.0],
            trim_mm: [60.0, 80.0],
            basic_mm: [60.0, 80.0],
            title: "G1".into(),
            story_index: None,
            author: "作者".into(),
            story: StoryLayout {
                subtitle: "サブ".into(),
                title_position: position,
                author_position: position,
                page_number: Some(PageNumber { start: 7, position }),
                nombre: Some(ShownNombre {
                    place,
                    white: true,
                    edge_mm: Some(0.5),
                    prefix: "p.".into(),
                    suffix: "-".into(),
                    offset_mm: [0.0, 3.0],
                    size_pt: 9.0,
                }),
            },
            ..commercial()
        }
    }

    /// (part code, text, canvas bbox) of every block of the story info layers of `info`.
    fn story_parts(page: &ClipFile, info: i64) -> Vec<(i64, String, [i32; 4])> {
        let mut parts = Vec::new();
        for (id, _) in story_layers(page.database(), info).unwrap() {
            let layer = page.layers.get(id).unwrap();
            let (dx, dy) = (layer.offset.0 as i32, layer.offset.1 as i32);
            for block in crate::text::read_blocks(&layer.row).unwrap() {
                let part = block.attributes.get(ATTR_STORY_PART).map(i32s).map_or(0, |values| values[0]);
                let [x0, y0, x1, y1] = block.attributes.bbox().unwrap();
                parts.push((part, block.text, [x0 + dx, y0 + dy, x1 + dx, y1 + dy]));
            }
        }
        parts
    }

    fn canvas_ints(page: &ClipFile, columns: &[&str]) -> Vec<i64> {
        columns.iter().map(|column| page.canvas.row.int(column)).collect()
    }

    fn reopened(page: ClipFile) -> ClipFile {
        ClipFile::from_bytes(page.to_bytes().unwrap()).unwrap()
    }

    #[test]
    fn a_page_of_a_work_takes_its_side_from_its_number() {
        let nombre_x = |page: &ClipFile| story_parts(page, NOMBRE_INFO)[0].2[0];
        let page = reopened(blank_page(&commercial()).unwrap());
        let left_x = nombre_x(&page);
        // Page 0 is a left page in this right-bound book: page 1 is a right page.
        let mut next = reopened(blank_page(&commercial()).unwrap());
        assert_eq!(next.set_comic_page(1, Some(true)).unwrap(), Some(false));
        assert_eq!(canvas_ints(&next, &["ComicPageIndex", "ComicIsLeftPage", "CropFrameOptionFlag"]), [1, 0, 4]);
        // The ノンブル goes to the other edge, by the gutter of the right page.
        assert!(nombre_x(&next) < left_x, "{} {left_x}", nombre_x(&next));
        // Without being told, the side follows from the page's own number and side.
        assert_eq!(next.set_comic_page(4, None).unwrap(), Some(true));
        assert_eq!(next.set_comic_page(2, Some(false)).unwrap(), Some(false));
        assert_eq!(next.set_comic_page(5, None).unwrap(), Some(true));
        assert_eq!(canvas_ints(&next, &["ComicPageIndex", "ComicIsLeftPage", "CropFrameOptionFlag"]), [5, 1, 2]);
        assert_eq!(nombre_x(&reopened(next)), left_x);
    }

    #[test]
    fn keeps_csp_layout_for_the_settings_it_was_saved_with() {
        let page = reopened(blank_page(&commercial()).unwrap());
        assert_eq!((page.canvas.width_px, page.canvas.height_px), (7016, 9921));
        // Where CSP put them on this page: the 作品名 below the 仕上がり at its
        // left edge, the 作者名 at its middle, the ノンブル at the gutter.
        let story = story_parts(&page, STORY_INFO);
        assert_eq!(story[0].1, "ユメの話 4話");
        assert_eq!(story[0].2[..2], [472, 9402]);
        assert_eq!(story[1].1, "だれか");
        assert!(((story[1].2[0] + story[1].2[2]) / 2 - 3507).abs() <= 1, "{story:?}");
        let nombre = story_parts(&page, NOMBRE_INFO);
        assert_eq!((nombre[0].1.as_str(), nombre[0].2), ("1", [6512, 8454, 6543, 8504]));
        assert_eq!(canvas_ints(&page, &["ComicIsLeftPage", "CropFrameOptionFlag", "ComicBindPosition"]), [1, 2, 1]);
        assert!(crate::verify::check_clip(page.to_bytes().unwrap(), Default::default()).ok());
        let work = blank_work(&commercial()).unwrap();
        assert_eq!(work.project.bind_position, 1);
        assert_eq!(work.project.start_page, 0);
        assert_eq!(work.pages().unwrap().len(), 1);
    }

    #[test]
    fn makes_pages_of_another_size_and_binding() {
        let setup = PageSetup {
            canvas_mm: [158.0, 220.0],
            resolution: 350.0,
            trim_mm: [148.0, 210.0],
            bleed_mm: 3.0,
            basic_mm: [120.0, 180.0],
            basic_offset_mm: [2.0, -3.0],
            right_binding: false,
            first_page_left: false,
            title: "Short".into(),
            story_index: None,
            author: String::new(),
            nombre_start: 3,
            font: Some(StoryFont { name: "BIZ UDゴシック".into(), postscript: "BIZ-UDGothic".into() }),
            story: StoryLayout::default(),
        };
        let page = reopened(blank_page(&setup).unwrap());
        let (width, height) = (page.canvas.width_px as i64, page.canvas.height_px as i64);
        assert_eq!((width, height), (2177, 3031));
        // Every canvas-sized offscreen follows the new size at each mipmap level.
        for row in select(page.database(), "SELECT Attribute FROM Offscreen", []).unwrap() {
            let parameter = Attribute::parse(row.blob("Attribute").unwrap()).unwrap().parameter().unwrap();
            let size = (parameter.width as i64, parameter.height as i64);
            let fits = (0..8).any(|level| {
                size == (width >> level, height >> level) || size == (padded(width) >> level, padded(height) >> level)
            }) || size == (512, 512);
            assert!(fits, "offscreen {size:?} is not sized by the {width}x{height} canvas");
        }
        // A right page: ノンブル at its left edge, level with the bottom of the 基本枠.
        assert_eq!(canvas_ints(&page, &["ComicIsLeftPage", "CropFrameOptionFlag", "ComicBindPosition"]), [0, 4, 0]);
        let nombre = story_parts(&page, NOMBRE_INFO);
        assert!((nombre[0].2[0] as i64 - (width - 2039) / 2).abs() <= 1, "{nombre:?}");
        assert_eq!(nombre[0].2[3] as i64, (height - 2480) / 2 - 41 + 2480);
        assert_eq!(nombre[0].1, "3");
        let story = story_parts(&page, STORY_INFO);
        assert_eq!((story[0].1.as_str(), story[1].1.as_str()), ("Short", ""));
        let fonts = page
            .database()
            .query_row("SELECT TextLayerAttributes FROM Layer WHERE ComicStoryInfoType = 2", [], |row| {
                row.get::<_, Vec<u8>>(0)
            })
            .unwrap();
        assert!(fonts.windows(12).any(|window| window == b"BIZ-UDGothic"));
        let work = blank_work(&setup).unwrap();
        assert_eq!((work.project.bind_position, work.project.start_page), (0, 1));
        assert!(crate::verify::check_clip(page.to_bytes().unwrap(), Default::default()).ok());
    }

    #[test]
    fn lays_out_a_shown_nombre_and_page_numbers_as_csp_does() {
        let close = |a: i32, b: i32| (a - b).abs() <= 1;
        // G1 on a canvas 20 mm taller: everything at 左下, the ノンブル 上部内側.
        let setup = PageSetup { canvas_mm: [70.0, 110.0], ..shown(NombrePlace::TopInner, StoryPosition::Left) };
        let page = reopened(blank_page(&setup).unwrap());
        assert_eq!((page.canvas.width_px, page.canvas.height_px), (1654, 2598));
        let lower = (2598 - 2126) / 2;
        let story = story_parts(&page, STORY_INFO);
        let texts: Vec<(i64, &str)> = story.iter().map(|(part, text, _)| (*part, text.as_str())).collect();
        assert_eq!(texts, [(1, "G1 サブ"), (2, "作者"), (4, "7ページ")]);
        let bbox = |part: i64| story.iter().find(|block| block.0 == part).unwrap().2;
        for (part, y) in [(4, 2150), (1, 2200), (2, 2250)] {
            let [x0, y0, _, y1] = bbox(part);
            assert!(x0 == 118 && close(y0, y + lower) && y1 - y0 == 50, "{part}: {:?}", bbox(part));
        }
        let nombre = story_parts(&page, NOMBRE_INFO);
        let (part, text, [_, y0, x1, y1]) = &nombre[0];
        assert_eq!((*part, text.as_str()), (16, "p.1-"));
        assert!(*x1 == 1535 && close(*y0, -29 + lower) && *y1 == 47 + lower, "{nombre:?}");
        let (attached, info): (i64, Vec<u8>) = page
            .database()
            .query_row(
                "SELECT LayerEffectAttached, LayerEffectInfo FROM Layer WHERE ComicStoryInfoType = 2",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((attached, info.as_slice()), (1, NOMBRE_EDGE));
        // The next page of the work: its ページ番号 and ノンブル follow.
        let mut next = page;
        next.database().execute("UPDATE Canvas SET ComicPageIndex = 1, ComicIsLeftPage = 0", []).unwrap();
        next.update_story_numbers(false).unwrap();
        let next = reopened(next);
        let numbers: Vec<String> = story_parts(&next, STORY_INFO)
            .into_iter()
            .chain(story_parts(&next, NOMBRE_INFO))
            .filter(|(part, ..)| *part == 4 || *part == 16)
            .map(|(_, text, _)| text)
            .collect();
        assert_eq!(numbers, ["8ページ", "p.2-"]);
        assert!(crate::verify::check_clip(next.to_bytes().unwrap(), Default::default()).ok());
        assert!(next.layers.flatten().iter().any(|(layer, _)| layer.kind == LayerKind::StoryInfo));
    }

    #[test]
    fn refuses_settings_csp_cannot_make() {
        let check = |change: &dyn Fn(&mut PageSetup)| {
            let mut setup = commercial();
            change(&mut setup);
            setup.check().is_err()
        };
        assert!(check(&|setup| setup.trim_mm = [300.0, 364.0]));
        assert!(check(&|setup| setup.resolution = 2400.0));
        assert!(check(&|setup| setup.basic_offset_mm = [60.0, 0.0]));
        assert!(check(&|setup| setup.canvas_mm = [2000.0, 2000.0]));
        assert!(commercial().check().is_ok());
    }
}
