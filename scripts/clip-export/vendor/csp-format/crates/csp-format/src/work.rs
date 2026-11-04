//! New comic works (.cmc and its page files) without a template (R18).
//!
//! The .cmc gets the tables and schema registry of a work CSP created
//! (`data/cmc_schema.sql`, `data/cmc_*_scheme.tsv`; structure only). The
//! rows are written here from [`NewWork`]: the work settings, the page list
//! and one page file per page (or spread), each made by [`ClipFile::create`]
//! and given the comic settings CSP writes into a new work's pages
//! (`docs/spec/07-cmc.md`).
//!
//! Page positions follow CSP (checked with works made in CSP EX):
//!
//! ```text
//! position: pages counted in reading order from 0 (a spread counts 2)
//! side:     left when the position is even, swapped when the work starts on the right
//! spread:   two facing pages; it starts on the right page with right binding
//!           and on the left page with left binding
//! ```

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use rusqlite::types::Value;

use crate::clip::ClipFile;
use crate::cmc::NODE_PAGE;
use crate::create::{NewCanvas, comic_story, fill_registry, insert};
use crate::database;
use crate::error::{Result, bail};

const SCHEMA: &str = include_str!("data/cmc_schema.sql");
const PARAM_SCHEME: &str = include_str!("data/cmc_param_scheme.tsv");
const ELEM_SCHEME: &str = include_str!("data/cmc_elem_scheme.tsv");

const ROOT_NODE: i64 = 1;
/// `CanvasUnit` / `DefaultPageUnit` for millimetres.
const UNIT_MM: i64 = 2;

/// Where the pages are bound (`ComicBindPosition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Binding {
    /// 右綴じ (1): pages are read from right to left.
    Right,
    /// 左綴じ (0).
    Left,
}

impl Binding {
    /// The stored `ComicBindPosition` value.
    pub fn code(self) -> i64 {
        match self {
            Binding::Right => 1,
            Binding::Left => 0,
        }
    }

    /// Reads `ComicBindPosition` (anything but 1 is left binding).
    pub fn from_code(code: i64) -> Self {
        if code == 1 { Binding::Right } else { Binding::Left }
    }
}

/// Which side the first page is on (`ComicStartPage`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartSide {
    /// 左から (0).
    Left,
    /// 右から (1).
    Right,
}

impl StartSide {
    /// The stored `ComicStartPage` value.
    pub fn code(self) -> i64 {
        match self {
            StartSide::Left => 0,
            StartSide::Right => 1,
        }
    }

    /// Reads `ComicStartPage` (anything but 1 starts on the left).
    pub fn from_code(code: i64) -> Self {
        if code == 1 { StartSide::Right } else { StartSide::Left }
    }
}

/// Whether the page at `position` (pages counted from 0) is a left page.
pub fn is_left_page(position: usize, start: StartSide) -> bool {
    position.is_multiple_of(2) != (start == StartSide::Right)
}

/// One page file of a work: a single page or a spread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageSlot {
    /// Position of the (first) page, counted from 0.
    pub position: usize,
    /// The file is a two-page spread.
    pub spread: bool,
    /// Side of the page at `position`.
    pub left: bool,
}

/// Settings of a new work (sizes in millimetres).
#[derive(Debug, Clone, PartialEq)]
pub struct NewWork {
    /// Finished (trim) size of one page.
    pub trim_width: f64,
    /// Height of the finished page.
    pub trim_height: f64,
    /// Bleed around the trim (裁ち落とし幅).
    pub bleed: f64,
    /// Dots per inch.
    pub resolution: f64,
    /// Number of pages (a spread counts 2).
    pub pages: usize,
    /// Join facing pages into spreads (対向ページを見開きにする).
    pub spreads: bool,
    /// Binding side.
    pub binding: Binding,
    /// Side of the first page.
    pub start: StartSide,
    /// Title written into the story info (作品情報).
    pub title: String,
    /// Author written into the story info.
    pub author: String,
}

impl Default for NewWork {
    fn default() -> Self {
        NewWork {
            trim_width: 182.0,
            trim_height: 257.0,
            bleed: 5.0,
            resolution: 600.0,
            pages: 4,
            spreads: false,
            binding: Binding::Right,
            start: StartSide::Left,
            title: String::new(),
            author: String::new(),
        }
    }
}

/// The bytes of a new work: the .cmc and its page files (names relative to
/// the .cmc's folder).
pub struct WorkFiles {
    /// The .cmc file.
    pub cmc: Vec<u8>,
    /// Page files: name relative to the .cmc's folder ("page0001.clip") and bytes.
    pub pages: Vec<(String, Vec<u8>)>,
}

impl NewWork {
    /// The page files in reading order.
    pub fn layout(&self) -> Vec<PageSlot> {
        let mut slots = Vec::new();
        let mut position = 0;
        while position < self.pages {
            let left = is_left_page(position, self.start);
            // A spread starts on the side the reader meets first.
            let first_side_left = self.binding == Binding::Left;
            let spread = self.spreads && position + 1 < self.pages && left == first_side_left;
            slots.push(PageSlot { position, spread, left });
            position += if spread { 2 } else { 1 };
        }
        slots
    }

    /// Size of a page canvas (trim + bleed on both sides) in millimetres.
    fn canvas_mm(&self, spread: bool) -> (f64, f64) {
        let width = self.trim_width + 2.0 * self.bleed;
        (if spread { width * 2.0 } else { width }, self.trim_height + 2.0 * self.bleed)
    }

    /// Builds the .cmc and the page files. Write the pages next to the .cmc.
    pub fn build(&self) -> Result<WorkFiles> {
        if self.pages == 0 {
            bail!("A work needs at least one page");
        }
        if !(self.trim_width > 0.0 && self.trim_height > 0.0 && self.bleed >= 0.0 && self.resolution > 0.0) {
            bail!("Page size, bleed and resolution must be positive");
        }
        let slots = self.layout();
        let pages = slots
            .iter()
            .enumerate()
            .map(|(i, slot)| Ok((format!("page{:04}.clip", i + 1), self.page(slot)?.to_bytes()?)))
            .collect::<Result<Vec<_>>>()?;
        Ok(WorkFiles { cmc: self.cmc(&slots)?, pages })
    }

    /// Write `folder/name.cmc` and the page files next to it; refuses to
    /// replace existing files. Returns the .cmc's path.
    pub fn write(&self, folder: &Path, name: &str) -> Result<PathBuf> {
        let files = self.build()?;
        let cmc = folder.join(format!("{name}.cmc"));
        let paths: Vec<PathBuf> =
            std::iter::once(cmc.clone()).chain(files.pages.iter().map(|(page, _)| folder.join(page))).collect();
        if let Some(existing) = paths.iter().find(|path| path.exists()) {
            bail!("{} already exists", existing.display());
        }
        std::fs::create_dir_all(folder)?;
        for (page, bytes) in &files.pages {
            std::fs::write(folder.join(page), bytes)?;
        }
        std::fs::write(&cmc, files.cmc)?;
        Ok(cmc)
    }

    /// The work and story settings shared by the .cmc and every page.
    fn story(&self) -> Vec<(&'static str, Value)> {
        let text = |s: &str| Value::Text(s.to_owned());
        let mut story = comic_story();
        for (name, value) in story.iter_mut() {
            *value = match *name {
                "ComicStoryStoryName" => text(&self.title),
                "ComicStoryAuthorName" => text(&self.author),
                // CSP's defaults for a new comic.
                "ComicStoryStoryIndex" => Value::Integer(0),
                "ComicStoryNombreFont" => text("I-OTFアンチックStd B"),
                "ComicStoryNombreFontPostScriptName" => text("IwaAntStd-Bd"),
                "ComicStoryNombreEdgeWidth" => Value::Real(0.3),
                _ => value.clone(),
            };
        }
        story
    }

    fn cmc(&self, slots: &[PageSlot]) -> Result<Vec<u8>> {
        let (int, text, real) = (Value::Integer, |s: &str| Value::Text(s.to_owned()), Value::Real);
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(SCHEMA)?;
        fill_registry(&connection, PARAM_SCHEME, ELEM_SCHEME)?;
        let (width, height) = self.canvas_mm(false);
        let mut project = vec![
            ("ProjectInternalVersion", text("1.1.0")),
            ("ProjectRootCanvasNode", int(ROOT_NODE)),
            ("ComicBindPosition", int(self.binding.code())),
            ("ComicStartPage", int(self.start.code())),
            ("ComicBindAndStartPageIndeterminate", int(0)),
            ("ComicShowStyle", int(0)),
            ("ComicWebtoonWrapDirection", int(1)),
            ("ComicCoverExist", int(0)),
        ];
        project.extend(self.story());
        project.extend([
            ("DefaultPageUnit", int(UNIT_MM)),
            ("DefaultPageWidth", real(width)),
            ("DefaultPageHeight", real(height)),
            ("DefaultPageResolution", real(self.resolution)),
            ("DefaultPageChannelBytes", int(1)),
            ("DefaultPageChannelOrder", int(33)),
            ("DefaultPageColorType", int(0)),
            ("DefaultPageBlackChecked", int(1)),
            ("DefaultPageWhiteChecked", int(1)),
            ("DefaultPageToneLine", real(60.0)),
            ("DefaultPageUsePaper", int(1)),
            ("DefaultPagePaperRed", int(0xFFFF_FFFF)),
            ("DefaultPagePaperGreen", int(0xFFFF_FFFF)),
            ("DefaultPagePaperBlue", int(0xFFFF_FFFF)),
            ("DefaultPageUseTemplate", int(0)),
            ("DefaultPageTemplatePath", text("")),
            ("DefaultPageTemplatePath2", text("")),
            ("DefaultPageTemplateName", text("")),
            ("DefaultPageIsUserTemplate", int(0)),
            ("DefaultPageDoublePage", int(self.spreads as i64)),
            ("DefaultPagePresetID", text("")),
            ("DefaultPageCheckBookBinding", int(0)),
            ("DefaultSrcPageColorProfile", Value::Blob(Vec::new())),
            ("DefaultSimulatePageColorProfile", Value::Blob(Vec::new())),
            ("DefaultPageCelUseTemplate", int(0)),
            ("DefaultPageCelTemplatePath", text("")),
            ("DefaultPageCelTemplatePath2", text("")),
            ("DefaultPageCelTemplateName", text("")),
            ("DefaultPageCelTemplateUUID", text("")),
            ("DefaultPageCelIsUserTemplate", int(0)),
        ]);
        project.extend(self.crop_frame("DefaultPage"));
        project.extend([
            ("DefaultPageUseCropFrame", int(1)),
            ("DefaultPageTemplateUUID", text("")),
            ("DefaultPageUseDefaultCoverInfo", int(0)),
            ("DefaultPageSettingType", text("Comic")),
            ("DefaultPageRecordTimeLapse", int(0)),
            ("DefaultPageTimeLapseCodec", int(0)),
            ("MaxCanvasFileIndex", int(slots.len() as i64)),
        ]);
        insert(&connection, "Project", &project)?;
        let page_id = |i: usize| ROOT_NODE + 1 + i as i64;
        let node = |main_id: i64, kind: i64, next: i64, child: i64| {
            vec![
                ("MainId", int(main_id)),
                ("Type", int(kind)),
                ("NextIndex", int(next)),
                ("FirstChildIndex", int(child)),
                ("SelectedIndex", int(child)),
                ("CanvasIndex", int(0)),
                ("PageFlag", int(0)),
                ("Memo", text("")),
                ("BookBindMemo", text("")),
                // Warnings are CSP's own checks; it fills them in.
                ("BookBindWarning", int(0)),
                ("BookBindWarningDef", int((kind == NODE_PAGE) as i64)),
            ]
        };
        insert(&connection, "CanvasNode", &node(ROOT_NODE, crate::cmc::NODE_ROOT, 0, page_id(0)))?;
        for (i, slot) in slots.iter().enumerate() {
            let next = if i + 1 < slots.len() { page_id(i + 1) } else { 0 };
            let mut row = node(page_id(i), NODE_PAGE, next, 0);
            row[6].1 = int(slot.spread as i64);
            row.push(("LinkPath", text(&format!(".:page{:04}.clip", i + 1))));
            insert(&connection, "CanvasNode", &row)?;
        }
        for (table, max) in [("CanvasNode", page_id(slots.len() - 1)), ("Project", 1)] {
            connection.execute("UPDATE ElemScheme SET MaxIndex = ?1 WHERE TableName = ?2", (max, table))?;
        }
        database::serialize(&connection)
    }

    /// The crop frame columns (`CropFrame*` in a page, `DefaultPageCrop*` in
    /// the .cmc).
    fn crop_frame(&self, prefix: &str) -> Vec<(&'static str, Value)> {
        let real = Value::Real;
        let page = prefix == "CropFrame";
        let pick = |page_name: &'static str, cmc_name: &'static str| if page { page_name } else { cmc_name };
        vec![
            (pick("CropFrameWidth", "DefaultPageCropWidth"), real(self.trim_width)),
            (pick("CropFrameHeight", "DefaultPageCropHeight"), real(self.trim_height)),
            (pick("CropFrameDitch", "DefaultPageCropDitch"), real(self.bleed)),
            (pick("CropFrameCropOffsetX", "DefaultPageCropOffsetX"), real(0.0)),
            (pick("CropFrameCropOffsetY", "DefaultPageCropOffsetY"), real(0.0)),
            (pick("CropFrameInnerWidth", "DefaultPageCropInnerWidth"), real(self.trim_width)),
            (pick("CropFrameInnerHeight", "DefaultPageCropInnerHeight"), real(self.trim_height)),
            (pick("CropFrameInnerOffsetX", "DefaultPageCropInnerOffsetX"), real(0.0)),
            (pick("CropFrameInnerOffsetY", "DefaultPageCropInnerOffsetY"), real(0.0)),
            (pick("CropFrameSafeMarginLeft", "DefaultPageSafeMarginLeft"), real(0.0)),
            (pick("CropFrameSafeMarginTop", "DefaultPageSafeMarginTop"), real(0.0)),
            (pick("CropFrameSafeMarginRight", "DefaultPageSafeMarginRight"), real(0.0)),
            (pick("CropFrameSafeMarginBottom", "DefaultPageSafeMarginBottom"), real(0.0)),
            (pick("CropFrameMergeDitch", "DefaultPageCropMergeDitch"), real(0.0)),
        ]
        .into_iter()
        .chain((!page).then_some(("DefaultPageCropOptionFlag", Value::Integer(0))))
        .collect()
    }

    fn page(&self, slot: &PageSlot) -> Result<ClipFile> {
        let (width, height) = self.canvas_mm(slot.spread);
        let pixels = |mm: f64| (mm * self.resolution / 25.4).round().max(1.0) as u32;
        let canvas = NewCanvas {
            width: pixels(width),
            height: pixels(height),
            resolution: self.resolution,
            ..Default::default()
        };
        let mut file = ClipFile::create(&canvas)?;
        let connection = file.database();
        // Columns a comic page has and a new illustration does not.
        let added = [
            ("CropFrameOptionFlag", "INTEGER"),
            ("CropFrameUnitKind", "INTEGER"),
            ("CropFrameWidth", "REAL"),
            ("CropFrameHeight", "REAL"),
            ("CropFrameDitch", "REAL"),
            ("CropFrameInnerWidth", "REAL"),
            ("CropFrameInnerHeight", "REAL"),
            ("CropFrameInnerOffsetX", "REAL"),
            ("CropFrameInnerOffsetY", "REAL"),
            ("CropFrameMergeDitch", "REAL"),
            ("CropFrameCropOffsetX", "REAL"),
            ("CropFrameCropOffsetY", "REAL"),
            ("CropFrameSafeMarginLeft", "REAL"),
            ("CropFrameSafeMarginTop", "REAL"),
            ("CropFrameSafeMarginRight", "REAL"),
            ("CropFrameSafeMarginBottom", "REAL"),
            ("CropFrameInnerOffsetBasePosition", "INTEGER"),
            ("CropFrameDesignationType", "INTEGER"),
            ("CropFrameShow", "INTEGER"),
            ("SafeFrameShow", "INTEGER"),
        ];
        for (column, kind) in added {
            connection.execute_batch(&format!("ALTER TABLE Canvas ADD COLUMN {column} {kind} DEFAULT NULL"))?;
        }
        // Bits: 1 spread, 2 left page, 4 right page (as CSP writes a new work).
        let option = if slot.spread {
            3
        } else if slot.left {
            2
        } else {
            4
        };
        let mut values = vec![
            ("CanvasUnit", Value::Integer(UNIT_MM)),
            ("CanvasWidth", Value::Real(width)),
            ("CanvasHeight", Value::Real(height)),
            ("CanvasDoublePage", Value::Integer(slot.spread as i64)),
            ("ComicBindPosition", Value::Integer(self.binding.code())),
            ("ComicPageIndex", Value::Integer(slot.position as i64)),
            ("ComicIsLeftPage", Value::Integer(slot.left as i64)),
            ("CropFrameOptionFlag", Value::Integer(option)),
            ("CropFrameUnitKind", Value::Integer(UNIT_MM)),
            ("CropFrameInnerOffsetBasePosition", Value::Integer(0)),
            ("CropFrameDesignationType", Value::Integer(1)),
            ("CropFrameShow", Value::Integer(1)),
            ("SafeFrameShow", Value::Integer(0)),
        ];
        values.extend(self.crop_frame("CropFrame"));
        values.extend(self.story());
        let assignments: Vec<String> =
            values.iter().enumerate().map(|(i, (name, _))| format!("{} = ?{}", database::quote(name), i + 1)).collect();
        connection.execute(
            &format!("UPDATE Canvas SET {}", assignments.join(", ")),
            rusqlite::params_from_iter(values.into_iter().map(|(_, value)| value)),
        )?;
        file.reload()?;
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmc::CmcFile;

    fn slots(work: &NewWork) -> Vec<(usize, bool, bool)> {
        work.layout().iter().map(|slot| (slot.position, slot.spread, slot.left)).collect()
    }

    /// The page layouts CSP EX made for the same settings (works e1–e5).
    #[test]
    fn layouts_match_csp() {
        let work = |binding, start, pages, spreads| NewWork { binding, start, pages, spreads, ..Default::default() };
        use {Binding::*, StartSide as S};
        assert_eq!(slots(&work(Right, S::Left, 4, true)), [(0, false, true), (1, true, false), (3, false, false)]);
        assert_eq!(slots(&work(Left, S::Left, 4, true)), [(0, true, true), (2, true, true)]);
        assert_eq!(slots(&work(Right, S::Right, 4, true)), [(0, true, false), (2, true, false)]);
        assert_eq!(
            slots(&work(Right, S::Left, 5, false)),
            [(0, false, true), (1, false, false), (2, false, true), (3, false, false), (4, false, true)]
        );
    }

    #[test]
    fn new_works_read_back() {
        let work = NewWork {
            trim_width: 60.0,
            trim_height: 80.0,
            resolution: 150.0,
            spreads: true,
            title: "T".into(),
            ..Default::default()
        };
        let files = work.build().unwrap();
        let cmc = CmcFile::from_bytes(files.cmc).unwrap();
        assert!(cmc.findings(None).is_empty(), "{:?}", cmc.findings(None));
        assert_eq!(cmc.positions().unwrap(), work.layout());
        let pages = cmc.pages().unwrap();
        assert_eq!(pages.iter().map(|page| page.spread).collect::<Vec<_>>(), [false, true, false]);
        assert_eq!(cmc.project.bind_position, 1);
        assert_eq!(files.pages.len(), 3);
        let spread = ClipFile::from_bytes(files.pages[1].1.clone()).unwrap();
        // (60 + 2 × 5) × 2 mm at 150 dpi.
        assert_eq!((spread.canvas.width_px, spread.canvas.height_px), (827, 531));
        let row = spread.database().query_row(
            "SELECT ComicPageIndex, ComicIsLeftPage, CropFrameOptionFlag, ComicStoryStoryName FROM Canvas",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?)),
        );
        assert_eq!(row.unwrap(), (1, 0, 3, "T".to_owned()));
        let report = crate::verify::check_clip(files.pages[1].1.clone(), crate::verify::CheckOptions::default());
        assert!(report.ok(), "{:?}", serde_json::to_string(&report).unwrap());
    }
}
