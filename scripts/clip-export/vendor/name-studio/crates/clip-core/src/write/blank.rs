//! Pages and works made from settings, for writing without a CSP-made
//! template.
//!
//! csp-format carries the files CLIP STUDIO PAINT EX 5.1.4 saved for this
//! (see docs/builtin-template.md): an empty single page, a work (.cmc) and
//! a page with one vector line and one text to copy editable layers from,
//! and sets their canvas, frames, binding and story info (作品名・話数・作者名・
//! ノンブル) from a [`PageSetup`]. Here are the file names, and the reasons
//! shown to the person when a setup cannot be made.

use std::path::{Path, PathBuf};

pub use csp_format::blank::{
    NombrePlace, PageNumber, PageSetup, ShownNombre, StoryFont, StoryLayout, StoryPosition, apply_setup, blank_page,
};
use serde::Serialize;

use crate::error::{CspError, Result};

/// File names of a built template, in its folder.
pub const PAGE_FILE: &str = "page.clip";
pub const PARTS_FILE: &str = "parts.clip";
pub const WORK_FILE: &str = "work.cmc";
/// The largest canvas side CSP makes, in px.
const MAX_SIDE_PX: i64 = csp_format::blank::MAX_SIDE_PX;

/// Whether CSP can make a page like `setup`; the reason when not, for the
/// person (csp-format checks the same again, in English).
pub fn check_setup(setup: &PageSetup) -> Result<()> {
    let fail = |message: &str| Err(CspError::format(message.to_owned()));
    let positive = |values: &[f64]| values.iter().all(|value| value.is_finite() && *value > 0.0);
    if !positive(&[setup.canvas_mm[0], setup.canvas_mm[1]]) {
        return fail("キャンバスの幅と高さを入れてください");
    }
    if !(setup.resolution.is_finite() && (72.0..=1200.0).contains(&setup.resolution)) {
        return fail("解像度は 72〜1200 dpi にしてください");
    }
    if !positive(&[setup.trim_mm[0], setup.trim_mm[1]]) {
        return fail("仕上がりの幅と高さを入れてください");
    }
    if setup.trim_mm[0] > setup.canvas_mm[0] + 1e-9 || setup.trim_mm[1] > setup.canvas_mm[1] + 1e-9 {
        return fail("仕上がりがキャンバスより大きくなっています");
    }
    if !(setup.bleed_mm.is_finite() && setup.bleed_mm >= 0.0) {
        return fail("裁ち落とし幅は 0 以上にしてください");
    }
    if !positive(&[setup.basic_mm[0], setup.basic_mm[1]]) {
        return fail("基本枠の幅と高さを入れてください");
    }
    let [ox, oy] = setup.basic_offset_mm;
    if !(ox.is_finite() && oy.is_finite())
        || setup.basic_mm[0] / 2.0 + ox.abs() > setup.canvas_mm[0] / 2.0 + 1e-9
        || setup.basic_mm[1] / 2.0 + oy.abs() > setup.canvas_mm[1] / 2.0 + 1e-9
    {
        return fail("基本枠がキャンバスからはみ出しています");
    }
    let (width, height) = setup.canvas_px();
    if width > MAX_SIDE_PX || height > MAX_SIDE_PX {
        return fail("キャンバスが大きすぎます（解像度を下げてください）");
    }
    if setup.title.trim().is_empty() {
        return fail("作品名を入れてください");
    }
    if setup.story_index.is_some_and(|index| index < 0) || setup.nombre_start < 0 {
        return fail("話数とノンブルの開始番号は 0 以上にしてください");
    }
    if setup.story.page_number.as_ref().is_some_and(|number| number.start < 0) {
        return fail("ページ番号の開始番号は 0 以上にしてください");
    }
    if let Some(nombre) = &setup.story.nombre {
        if !(nombre.size_pt.is_finite() && (4.0..=72.0).contains(&nombre.size_pt)) {
            return fail("ノンブルの大きさは 4〜72 pt にしてください");
        }
        if nombre
            .edge_mm
            .is_some_and(|edge| !(edge.is_finite() && (0.0..=5.0).contains(&edge)))
        {
            return fail("ノンブルのフチは 0〜5 mm にしてください");
        }
        if !nombre
            .offset_mm
            .iter()
            .all(|offset| offset.is_finite() && offset.abs() <= 100.0)
        {
            return fail("ノンブルの基本枠との間隔は ±100 mm までにしてください");
        }
    }
    Ok(())
}

/// Write the page, the parts page and the work for `setup` into `folder`.
pub fn write_builtin_template(setup: &PageSetup, folder: &Path) -> Result<BuiltTemplate> {
    check_setup(setup)?;
    std::fs::create_dir_all(folder)?;
    let built = BuiltTemplate {
        page: folder.join(PAGE_FILE),
        parts: folder.join(PARTS_FILE),
        work: folder.join(WORK_FILE),
    };
    super::layers::save(&blank_page(setup)?, &built.page)?;
    super::layers::save(&csp_format::blank::blank_parts()?, &built.parts)?;
    let work = csp_format::blank::blank_work(setup)?;
    name_model::atomic::replace_with(&built.work, |temporary| work.save(temporary))?;
    Ok(built)
}

/// Where [`write_builtin_template`] put its files.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltTemplate {
    pub page: PathBuf,
    /// The vector and text layers to copy (a donor).
    pub parts: PathBuf,
    pub work: PathBuf,
}
