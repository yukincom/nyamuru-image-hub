//! Write page .clip files from the name tool's pages, and the work (.cmc)
//! around them.
//!
//! The name tool sends each page as layers: whole-page images, vector lines
//! (panel borders, balloons, rough strokes) and texts (dialogue). They go
//! into copies of a CSP-made empty page, so the page opens in CSP with the
//! name on layers to draw over. Lines and texts stay editable in CSP.
//!
//! CSP's vector and text layers carry many settings this tool does not know,
//! so new ones are copies of a CSP-made layer (a "donor": a vector layer with
//! at least one line, a text layer with one plain text), from the template
//! page or another .clip such as the name sheet, with their content replaced.

use std::path::{Path, PathBuf};

use csp_format::ClipFile;
use csp_format::database::{Row, select};
use csp_format::edit::NewLayer;
use csp_format::vector::VectorData;
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

use super::Values;
use super::cmc::{work_canvas_values, write_cmc};
use super::layers::{copy_layer, csp_image, raster_like, save, set_layer_mask, set_row_value};
use super::manifest::{PageRecord, image_signature};
use super::page::{apply_page_settings, replace_preview};
use super::split::page_file_name;
use super::spread::{SpreadLayout, make_spread_template};
use crate::RgbaImage;
use crate::clip::{ClipDocument, LayerKind};
use crate::error::{CspError, Result};
use crate::raster::{Filter, resize};
use crate::text::{NewText, retarget_add_attributes, retarget_text_attributes};
use crate::vector::{FrameTemplate, NewFrame, NewVectorLine, brush_style_of, frame_template_of, shape_signature};

/// One raster layer of a page; the image covers the whole page canvas.
pub struct RasterLayer {
    pub name: String,
    pub image: RgbaImage,
}

/// One layer of a page, in page canvas pixels.
pub enum PageLayer {
    Raster(RasterLayer),
    /// A vector layer holding these lines.
    Vector {
        name: String,
        lines: Vec<NewVectorLine>,
    },
    /// A text layer holding one text (named after it, as CSP does).
    Text(NewText),
    /// A コマ枠フォルダー: the panels as frames, so what is drawn in the
    /// folder stays inside them; `ink` names an empty raster layer put in it
    /// to draw on.
    Frames {
        name: String,
        frames: Vec<NewFrame>,
        ink: Option<String>,
    },
    /// A folder holding `children` (bottom first). With a `mask` (any size
    /// with the page's proportions, scaled to it) it gets a レイヤーマスク:
    /// what is in the folder shows only under the mask's opaque pixels, and
    /// the rest is hidden, not cut, so it can be shown again in CSP.
    Folder {
        name: String,
        mask: Option<RgbaImage>,
        children: Vec<PageLayer>,
    },
}

/// Text layer columns that hold several blocks; a new text has one block.
const TEXT_BLOCK_ARRAYS: [&str; 2] = ["TextLayerStringArray", "TextLayerAttributesArray"];

/// CSP-made layers that new vector and text layers are copied from.
pub struct PartDonors {
    pub(crate) source: ClipDocument,
    pub(crate) vector: Option<(i64, u32)>,
    pub(crate) text: Option<i64>,
    /// A frame folder and the layout of its borders.
    pub(crate) frame: Option<(i64, FrameTemplate)>,
}

impl PartDonors {
    /// Look for a vector layer with a line and a text layer with one plain
    /// text in `source`.
    pub fn find(source: ClipDocument) -> Result<Self> {
        let probe = NewText {
            text: "a".to_owned(),
            frame: [0, 0, 10, 10],
            font_size_pt: 10.0,
            vertical: true,
            color: None,
            font: None,
            line_spacing: None,
        };
        let mut vector = None;
        let mut text = None;
        let mut frame = None;
        for layer in source.layers() {
            match layer.kind {
                LayerKind::FrameFolder if frame.is_none() => {
                    if let Some(payload) = source.vector_payloads(layer)?.first()
                        && let Some(template) = frame_template_of(payload)
                    {
                        frame = Some((layer.main_id, template));
                    }
                }
                LayerKind::Vector if vector.is_none() => {
                    let row = source.layer_row(layer.main_id);
                    if row.is_none_or(|row| row.int("VectorNormalStrokeIndex") == 0) {
                        continue;
                    }
                    if let Some(payload) = source.vector_payloads(layer)?.first()
                        && let Ok(Some(brush)) = brush_style_of(payload)
                    {
                        vector = Some((layer.main_id, brush));
                    }
                }
                LayerKind::Text if text.is_none() => {
                    let Some(row) = source.layer_row(layer.main_id) else {
                        continue;
                    };
                    // Not the work-info / page-number texts (TextLayerType 2).
                    let plain = row.int("TextLayerType") == 0 && row.int("ComicStoryInfoType") == 0;
                    let usable = plain
                        && row.text("TextLayerString").is_some()
                        && row
                            .blob("TextLayerAttributes")
                            .is_some_and(|blob| retarget_text_attributes(blob, &probe).is_ok())
                        && row
                            .blob("TextLayerAddAttributesV01")
                            .is_none_or(|blob| retarget_add_attributes(blob, &probe).is_ok())
                        && source.vector_payloads(layer)?.is_empty();
                    if usable {
                        text = Some(layer.main_id);
                    }
                }
                _ => {}
            }
        }
        Ok(PartDonors {
            source,
            vector,
            text,
            frame,
        })
    }

    /// The file the layers are copied from (a placeholder for the built-in parts).
    pub fn path(&self) -> &Path {
        &self.source.path
    }

    pub fn has_vector(&self) -> bool {
        self.vector.is_some()
    }

    pub fn has_text(&self) -> bool {
        self.text.is_some()
    }

    pub fn has_frame(&self) -> bool {
        self.frame.is_some()
    }
}

/// Where vector and text layers come from: the first source that has each.
#[derive(Default)]
pub struct Donors {
    pub vector: Option<PartDonors>,
    pub text: Option<PartDonors>,
    /// Only looked for when frame folders are wanted (finished pages are big).
    pub frame: Option<PartDonors>,
}

impl Donors {
    /// Search the template, then each of `others`, then the other .clip files
    /// next to the template (pages of the same work, such as the name sheet),
    /// for each kind of donor; a frame folder only when `frames` is set.
    /// What none of them has comes from csp-format's built-in parts, so a
    /// plain page saved by CSP still gets editable lines and texts.
    pub fn find(template: &Path, others: &[PathBuf], frames: bool) -> Result<Self> {
        let mut donors = Self::search(template, others, frames)?;
        if donors.vector.is_none() || donors.text.is_none() || (frames && donors.frame.is_none()) {
            let built_in = || -> Result<PartDonors> {
                let parts = csp_format::blank::blank_parts()?;
                PartDonors::find(ClipDocument::from_file(parts, Path::new(BUILT_IN_PARTS))?)
            };
            if donors.vector.is_none() {
                donors.vector = Some(built_in()?).filter(PartDonors::has_vector);
            }
            if donors.text.is_none() {
                donors.text = Some(built_in()?).filter(PartDonors::has_text);
            }
            if frames && donors.frame.is_none() {
                donors.frame = Some(built_in()?).filter(PartDonors::has_frame);
            }
        }
        Ok(donors)
    }

    fn search(template: &Path, others: &[PathBuf], frames: bool) -> Result<Self> {
        let mut donors = Donors::default();
        let candidates = std::iter::once((template.to_path_buf(), true))
            .chain(others.iter().map(|path| (path.clone(), false)))
            .chain(neighbours(template).into_iter().map(|path| (path, false)));
        for (path, is_template) in candidates {
            if donors.vector.is_some() && donors.text.is_some() && (!frames || donors.frame.is_some()) {
                break;
            }
            if !path.exists() || path.extension().is_none_or(|extension| extension != "clip") {
                continue;
            }
            // A neighbour that cannot be read is just not a donor.
            let document = match ClipDocument::read(&path) {
                Ok(document) => document,
                Err(_) if !is_template && !others.contains(&path) => continue,
                Err(error) => return Err(error),
            };
            let found = PartDonors::find(document)?;
            let wanted = [
                found.has_vector() && donors.vector.is_none(),
                found.has_text() && donors.text.is_none(),
                frames && found.has_frame() && donors.frame.is_none(),
            ];
            // One document serving several kinds is read once for each.
            let mut found = Some(found);
            for (kind, want) in wanted.into_iter().enumerate() {
                if !want {
                    continue;
                }
                let part = match found.take() {
                    Some(part) => part,
                    None => PartDonors::find(ClipDocument::read(&path)?)?,
                };
                match kind {
                    0 => donors.vector = Some(part),
                    1 => donors.text = Some(part),
                    _ => donors.frame = Some(part),
                }
            }
        }
        Ok(donors)
    }
}

/// The name the built-in parts go by (they are not read from a file).
pub const BUILT_IN_PARTS: &str = "(csp-format blank parts)";

/// How many .clip files next to the template are looked at for donors.
const NEIGHBOURS: usize = 12;

/// The other .clip files in the template's folder, by name, a few at most.
fn neighbours(template: &Path) -> Vec<PathBuf> {
    let Some(folder) = template.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(if folder.as_os_str().is_empty() {
        Path::new(".")
    } else {
        folder
    }) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("clip"))
        })
        .filter(|path| !same_file(path, template))
        .collect();
    paths.sort();
    paths.truncate(NEIGHBOURS);
    paths
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Columns reset on a copied donor so the new layer looks like a fresh one.
const FRESH_LAYER: [(&str, i64); 6] = [
    ("LayerOpacity", 256),
    ("DraftLayer", 0),
    ("LayerVisibility", 1),
    ("LayerComposite", 0),
    ("LayerClip", 0),
    ("LayerLock", 0),
];

fn freshen(row: &mut Row, name: &str) {
    for (column, value) in FRESH_LAYER {
        row.set(column, Value::Integer(value));
    }
    set_row_value(row, "LayerName", Value::Text(name.to_owned()));
}

/// Half opacity for a 下描き layer (CSP's full is 256).
const DRAFT_OPACITY: i64 = 128;

/// A layer's name as it is written.
pub(crate) fn layer_name(layer: &PageLayer) -> &str {
    match layer {
        PageLayer::Raster(layer) => &layer.name,
        PageLayer::Vector { name, .. } => name,
        PageLayer::Text(text) => &text.text,
        PageLayer::Frames { name, .. } => name,
        PageLayer::Folder { name, .. } => name,
    }
}

/// Make a layer a 下描き layer (CSP: レイヤー > 下描きレイヤーに設定) at half opacity.
pub(crate) fn make_draft(file: &mut ClipFile, id: i64) -> Result<()> {
    file.set_layer_draft(id, true)?;
    Ok(file.set_layer_value(id, "LayerOpacity", Value::Integer(DRAFT_OPACITY))?)
}

/// A layer's opacity set to `opacity` (0..1) of CSP's full, whatever it had
/// (never quite 0: the layer stays there to be seen in CSP's palette).
pub(crate) fn set_opacity(file: &mut ClipFile, id: i64, opacity: f64) -> Result<()> {
    let stored = (256.0 * opacity.clamp(0.0, 1.0)).round().max(1.0) as i64;
    Ok(file.set_layer_value(id, "LayerOpacity", Value::Integer(stored))?)
}

/// How a layer is written: its opacity (0..1, times what it has, such as a
/// 下描き layer's half, or as is with `whole`) and whether it is hidden.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerLook {
    pub name: String,
    pub opacity: f64,
    #[serde(default)]
    pub hidden: bool,
    /// The opacity as is, not times a 下描き layer's half: 指示 keep their colour.
    #[serde(default)]
    pub whole: bool,
}

/// Give a written layer its look.
fn apply_look(file: &mut ClipFile, id: i64, look: &LayerLook) -> Result<()> {
    if look.whole {
        set_opacity(file, id, look.opacity)?;
    } else if look.opacity < 1.0 {
        let had = file.row("Layer", id)?.map_or(256, |row| row.int("LayerOpacity")) as f64;
        let stored = (had * look.opacity.clamp(0.0, 1.0)).round().max(1.0) as i64;
        file.set_layer_value(id, "LayerOpacity", Value::Integer(stored))?;
    }
    if look.hidden {
        // Bit 0 shows the layer; the others (its mask in use) stay.
        file.set_layer_visible(id, false)?;
    }
    Ok(())
}

/// Make `file` able to hold the donor's layers (its tables, columns and
/// brush styles, with what they refer to), once per donor document.
pub fn prepare_for(file: &mut ClipFile, donor: &PartDonors) -> Result<()> {
    Ok(file.prepare_copy_from(donor.source.file())?)
}

/// Vector data `data` in place of the copied layer's.
fn with_vector_data(data: Vec<u8>) -> impl Fn(&str, &str, Vec<u8>) -> csp_format::Result<Vec<u8>> {
    move |table: &str, column: &str, payload: Vec<u8>| {
        Ok(if table == "VectorObjectList" && column == "VectorData" {
            data.clone()
        } else {
            payload
        })
    }
}

/// A vector layer holding `lines`, on top of `parent`'s children.
pub fn add_vector_layer(
    file: &mut ClipFile,
    donor: &PartDonors,
    name: &str,
    lines: &[NewVectorLine],
    parent: i64,
) -> Result<i64> {
    let (layer_id, donor_style) = donor
        .vector
        .ok_or_else(|| CspError::format("No vector layer to copy"))?;
    let brush = csp_format::copy::brush_style_in(file.database(), donor_style)?;
    let payload_hook = with_vector_data(VectorData::from_lines(lines, brush).to_bytes());
    let mut edit = |row: &mut Row| -> Result<()> {
        freshen(row, name);
        Ok(())
    };
    copy_layer(
        file,
        donor.source.file(),
        layer_id,
        parent,
        &mut edit,
        Some(&payload_hook),
    )
}

/// A コマ枠フォルダー holding `frames`, copied from the donor's frame folder
/// (without its layers). Its mask and border images are left for CSP to
/// draw from the frames, as CSP itself saves them.
fn add_frame_folder(
    file: &mut ClipFile,
    donor: &PartDonors,
    name: &str,
    frames: &[NewFrame],
    parent: i64,
) -> Result<i64> {
    let (layer_id, template) = donor
        .frame
        .as_ref()
        .ok_or_else(|| CspError::format("No frame folder to copy"))?;
    let brush = csp_format::copy::brush_style_in(file.database(), template.brush_style())?;
    let payload_hook = with_vector_data(VectorData::from_frames(frames, template, brush).to_bytes());
    let mut edit = |row: &mut Row| -> Result<()> {
        freshen(row, name);
        Ok(())
    };
    let id = copy_layer(
        file,
        donor.source.file(),
        *layer_id,
        parent,
        &mut edit,
        Some(&payload_hook),
    )?;
    file.add_frame_images(id)?;
    Ok(id)
}

/// CSP names a text layer after its first line.
fn text_layer_name(text: &NewText) -> String {
    let first = text.text.lines().find(|line| !line.trim().is_empty()).unwrap_or("");
    first.chars().take(32).collect()
}

/// A text layer holding `text`, on top of `parent`'s children.
pub fn add_text_layer(file: &mut ClipFile, donor: &PartDonors, text: &NewText, parent: i64) -> Result<i64> {
    let layer_id = donor.text.ok_or_else(|| CspError::format("No text layer to copy"))?;
    let name = text_layer_name(text);
    let mut edit = |row: &mut Row| -> Result<()> {
        freshen(row, &name);
        // CSP keeps the text as a UTF-8 blob and misreads a TEXT value.
        set_row_value(row, "TextLayerString", Value::Blob(text.stored_text().into_bytes()));
        if let Some(blob) = row.blob("TextLayerAttributes") {
            let blob = retarget_text_attributes(blob, text)?;
            row.set("TextLayerAttributes", Value::Blob(blob));
        }
        if let Some(blob) = row.blob("TextLayerAddAttributesV01") {
            let blob = retarget_add_attributes(blob, text)?;
            row.set("TextLayerAddAttributesV01", Value::Blob(blob));
        }
        for column in TEXT_BLOCK_ARRAYS {
            row.set(column, Value::Null);
        }
        Ok(())
    };
    copy_layer(file, donor.source.file(), layer_id, parent, &mut edit, None)
}

/// Size and frames of the template page, in its pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCanvas {
    pub width_px: u32,
    pub height_px: u32,
    pub resolution: f64,
    /// 仕上がり枠 and 基本枠 as `[x0, y0, x1, y1]`, when the template has them.
    pub trim_px: Option<[f64; 4]>,
    pub basic_px: Option<[f64; 4]>,
}

pub fn template_canvas(template: &ClipDocument) -> TemplateCanvas {
    let canvas = &template.canvas;
    let (width, height) = (canvas.width_px, canvas.height_px);
    let centred = |size: (f64, f64), offset: (f64, f64)| {
        let x0 = (width as f64 - size.0) / 2.0 + offset.0;
        let y0 = (height as f64 - size.1) / 2.0 + offset.1;
        [x0, y0, x0 + size.0, y0 + size.1]
    };
    TemplateCanvas {
        width_px: width as u32,
        height_px: height as u32,
        resolution: canvas.resolution,
        trim_px: canvas
            .crop_size_px
            .map(|(w, h)| centred((w as f64, h as f64), (0.0, 0.0))),
        basic_px: canvas.basic_size_px.map(|(w, h)| {
            centred(
                (w as f64, h as f64),
                (canvas.basic_offset_px.0 as f64, canvas.basic_offset_px.1 as f64),
            )
        }),
    }
}

/// Whether `layer` (or a layer in it) needs a donor of `kind`: 0 vector, 1 text, 2 frame folder.
fn holds(layer: &PageLayer, kind: u8) -> bool {
    match (layer, kind) {
        (PageLayer::Vector { .. }, 0) | (PageLayer::Text(_), 1) | (PageLayer::Frames { .. }, 2) => true,
        (PageLayer::Folder { children, .. }, _) => children.iter().any(|child| holds(child, kind)),
        _ => false,
    }
}

/// `image` with its alpha cut down to `mask`'s (both the same size).
fn masked(image: &RgbaImage, mask: &RgbaImage) -> RgbaImage {
    let mut result = image.clone();
    for (pixel, cover) in result
        .pixels
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(mask.pixels.as_chunks::<4>().0)
    {
        pixel[3] = ((u16::from(pixel[3]) * u16::from(cover[3]) + 127) / 255) as u8;
    }
    result
}

/// Adds the layers of one page, keeping the thumbnail's picture of them.
struct PageBuilder<'a> {
    /// The template and its raster layer, which new raster layers look like.
    source: &'a ClipDocument,
    raster: Option<Row>,
    donors: &'a Donors,
    width: u32,
    height: u32,
    composite: RgbaImage,
    draft_layers: &'a [String],
    looks: &'a [LayerLook],
}

impl PageBuilder<'_> {
    /// Add `layer` at the top of `parent`; `mask` is the folder mask over it
    /// (page size), for the thumbnail.
    fn add(&mut self, file: &mut ClipFile, layer: &PageLayer, parent: i64, mask: Option<&RgbaImage>) -> Result<i64> {
        let like = self.raster.as_ref().map(|row| (self.source.file(), row));
        let missing = |kind: &str| CspError::format(format!("No {kind} layer to copy (template or name sheet)"));
        let (width, height) = (self.width, self.height);
        let fit = |image: &RgbaImage| -> Option<RgbaImage> {
            ((image.width, image.height) != (width, height)).then(|| resize(image, width, height, Filter::Lanczos3))
        };
        let id = match layer {
            PageLayer::Raster(layer) => {
                let image = fit(&layer.image);
                let image = image.as_ref().unwrap_or(&layer.image);
                let id = raster_like(file, parent, &layer.name, like)?;
                if !crate::raster::is_transparent(image) {
                    file.set_layer_pixels(id, &csp_image(image), (0, 0))?;
                    match mask {
                        Some(mask) => self.composite.draw_over(&masked(image, mask), 0, 0),
                        None => self.composite.draw_over(image, 0, 0),
                    }
                }
                id
            }
            PageLayer::Frames { name, frames, ink } => {
                let donor = self.donors.frame.as_ref().ok_or_else(|| missing("frame folder"))?;
                let id = add_frame_folder(file, donor, name, frames, parent)?;
                if let Some(ink) = ink {
                    raster_like(file, id, ink, like)?;
                }
                id
            }
            PageLayer::Vector { name, lines } => {
                let donor = self.donors.vector.as_ref().ok_or_else(|| missing("vector"))?;
                add_vector_layer(file, donor, name, lines, parent)?
            }
            PageLayer::Text(text) => {
                let donor = self.donors.text.as_ref().ok_or_else(|| missing("text"))?;
                add_text_layer(file, donor, text, parent)?
            }
            PageLayer::Folder {
                name,
                mask: own,
                children,
            } => {
                let id = file.add_layer(parent, NewLayer::Folder, name)?;
                // Scaled without Lanczos' ringing, which would show as a faint halo.
                let own = own.as_ref().map(|image| {
                    if (image.width, image.height) == (width, height) {
                        image.clone()
                    } else {
                        resize(image, width, height, Filter::Box)
                    }
                });
                if let Some(own) = &own {
                    set_layer_mask(file, id, own)?;
                }
                // Inside a masked folder in a masked folder, both masks hide.
                let inner = match (mask, &own) {
                    (Some(outer), Some(own)) => Some(masked(own, outer)),
                    (None, Some(own)) => Some(own.clone()),
                    (outer, None) => outer.cloned(),
                };
                for child in children {
                    self.add(file, child, id, inner.as_ref())?;
                }
                id
            }
        };
        if self.draft_layers.iter().any(|draft| *draft == layer_name(layer)) {
            make_draft(file, id)?;
        }
        if let Some(look) = self.looks.iter().find(|look| look.name == layer_name(layer)) {
            apply_look(file, id, look)?;
        }
        Ok(id)
    }
}

/// The first raster layer of a page, which new raster layers look like.
fn first_raster_row(document: &ClipDocument) -> Result<Option<Row>> {
    Ok(select(
        document.database(),
        "SELECT * FROM Layer WHERE LayerType = 1 ORDER BY MainId LIMIT 1",
        [],
    )?
    .into_iter()
    .next())
}

/// Write one page: a copy of `template` with `layers` added on top, bottom
/// layer first. Images of another size are scaled to the page canvas; vector
/// and text layers are copied from `donors`. Vector and text layers are not
/// drawn here, so the thumbnail shows the images with `overlay` (the lines
/// and texts drawn by the caller, any size with the page's proportions) on top.
/// `zero_left` is whether page index 0 is a left page (none: as the template's
/// own index and side say); on a spread template it tells which half is page
/// `page_index`.
#[allow(clippy::too_many_arguments)]
pub fn write_name_page(
    template: &Path,
    layers: &[PageLayer],
    donors: &Donors,
    overlay: Option<&RgbaImage>,
    output: &Path,
    page_index: i64,
    canvas_values: &Values,
    zero_left: Option<bool>,
    draft_layers: &[String],
    looks: &[LayerLook],
) -> Result<Vec<i64>> {
    let source = ClipDocument::read(template)?;
    let (width, height) = (source.canvas.width_px as u32, source.canvas.height_px as u32);
    let mut file = ClipFile::open(template)?;
    file.renew_file_id();
    file.renew_layer_uuids()?;
    apply_page_settings(&mut file, page_index, canvas_values, zero_left)?;
    let needs = |kind: u8| layers.iter().any(|layer| holds(layer, kind));
    for (needed, donor) in [
        (needs(0), &donors.vector),
        (needs(1), &donors.text),
        (needs(2), &donors.frame),
    ] {
        if needed && let Some(donor) = donor {
            prepare_for(&mut file, donor)?;
        }
    }
    let mut builder = PageBuilder {
        raster: first_raster_row(&source)?,
        source: &source,
        donors,
        width,
        height,
        composite: RgbaImage {
            width,
            height,
            pixels: [255, 255, 255, 255].repeat(width as usize * height as usize),
        },
        draft_layers,
        looks,
    };
    let mut ids = Vec::new();
    for layer in layers {
        let root = file.canvas.root_folder;
        ids.push(builder.add(&mut file, layer, root, None)?);
    }
    let composite = builder.composite;
    let thumbnail = match overlay {
        Some(overlay) => {
            let mut base = resize(&composite, overlay.width, overlay.height, Filter::Box);
            base.draw_over(overlay, 0, 0);
            base
        }
        None => composite,
    };
    replace_preview(file.database(), &thumbnail)?;
    save(&file, output)?;
    Ok(ids)
}

/// What `layers` put into a page: its texts, the shapes of its vector
/// layers and the pixels of the image layers named in `images`.
pub fn page_record(layers: &[PageLayer], images: &[String]) -> PageRecord {
    let mut record = PageRecord {
        texts: Some(Vec::new()),
        ..Default::default()
    };
    add_to_record(&mut record, layers, images, "");
    record
}

/// Record `layers`; those in a folder by `folder/name`.
fn add_to_record(record: &mut PageRecord, layers: &[PageLayer], images: &[String], prefix: &str) {
    for layer in layers {
        match layer {
            PageLayer::Text(text) => record.texts.get_or_insert_with(Vec::new).push(text.text.clone()),
            PageLayer::Vector { name, lines } => {
                let points: Vec<Vec<(f64, f64)>> = lines.iter().map(NewVectorLine::xy).collect();
                record.vectors.insert(
                    format!("{prefix}{name}"),
                    shape_signature(points.iter().map(Vec::as_slice)),
                );
            }
            PageLayer::Raster(raster) if images.contains(&raster.name) => {
                record
                    .rasters
                    .insert(format!("{prefix}{}", raster.name), image_signature(&raster.image));
            }
            PageLayer::Folder { name, children, .. } => {
                add_to_record(record, children, images, &format!("{prefix}{name}/"));
            }
            _ => {}
        }
    }
}

/// Where and how a set of pages (and their work) is written.
pub struct WorkOptions {
    pub template: PathBuf,
    pub out_dir: PathBuf,
    pub name_pattern: String,
    /// Writes `<name>.cmc` from this .cmc template.
    pub work: Option<(String, PathBuf)>,
    pub story_index: Option<i64>,
    /// Files the output must not overwrite (their folders are refused as the output folder).
    pub inputs: Vec<PathBuf>,
    /// .clip files (after the template) to copy vector and text layers from.
    pub donor_sources: Vec<PathBuf>,
    /// Layers (by name) made 下描き (draft) layers at half opacity: the
    /// rough, to ink over in CSP without it being filled against or printed.
    pub draft_layers: Vec<String>,
    /// Layers (by name) written fainter or hidden.
    pub layer_looks: Vec<LayerLook>,
    /// Look for a コマ枠フォルダー to copy (in a finished page among the donors).
    pub frame_folders: bool,
    /// The book's binding (true: right-bound), written over the template's
    /// so a left-bound name made from a right-bound work stays left-bound.
    pub right_binding: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReport {
    pub pages: Vec<PathBuf>,
    pub work: Option<PathBuf>,
    /// What was written into each page, in `pages` order.
    #[serde(skip)]
    pub records: Vec<PageRecord>,
}

/// Writes pages one at a time (each page's images can be large), then the work.
pub struct RasterWorkWriter {
    options: WorkOptions,
    canvas_values: Values,
    overrides: Values,
    pages: Vec<PathBuf>,
    records: Vec<PageRecord>,
    /// Position in the book of the next page (a spread takes two).
    next_index: i64,
    pub canvas: TemplateCanvas,
    pub donors: Donors,
    /// Whether page index 0 is a left page (from the template's own pair).
    pub first_page_left: Option<bool>,
    /// The spread template made from the template, or why there is none.
    pub spread: std::result::Result<(PathBuf, SpreadLayout), String>,
}

impl Drop for RasterWorkWriter {
    fn drop(&mut self) {
        if let Ok((path, _)) = &self.spread {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Whether page index 0 is a left page, from a page's own index and side.
fn first_page_left(template: &ClipDocument) -> Option<bool> {
    let row = template
        .database()
        .query_row("SELECT ComicPageIndex, ComicIsLeftPage FROM Canvas", [], |row| {
            Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?))
        })
        .ok()?;
    let (Some(index), Some(left)) = row else { return None };
    Some((left != 0) == (index.rem_euclid(2) == 0))
}

impl RasterWorkWriter {
    pub fn new(options: WorkOptions) -> Result<Self> {
        let mut inputs = vec![options.template.clone()];
        if let Some((_, cmc)) = &options.work {
            inputs.push(cmc.clone());
        }
        for input in &inputs {
            if !input.exists() {
                return Err(CspError::format(format!("Input file not found: {}", input.display())));
            }
        }
        inputs.extend(options.inputs.iter().filter(|path| path.exists()).cloned());
        std::fs::create_dir_all(&options.out_dir)?;
        // Compared canonically; pages are written under the folder as given
        // (on Windows the canonical form is a `\\?\` path).
        let canonical_out = options.out_dir.canonicalize()?;
        for input in &inputs {
            let folder = input
                .canonicalize()?
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_default();
            if folder == canonical_out {
                return Err(CspError::format(
                    "The output folder must differ from the input folders so originals are never overwritten",
                ));
            }
        }
        let template = ClipDocument::read(&options.template)?;
        let canvas = template_canvas(&template);
        let mut first_page_left = first_page_left(&template);
        let spread_path =
            std::env::temp_dir().join(format!("name-studio-spread-{}.clip", uuid::Uuid::new_v4().simple()));
        let spread = make_spread_template(&options.template, &spread_path)
            .map(|layout| (spread_path, layout))
            .map_err(|error| error.to_string());
        let donors = Donors::find(&options.template, &options.donor_sources, options.frame_folders)?;
        let mut canvas_values = match &options.work {
            Some((_, cmc)) => work_canvas_values(cmc)?,
            None => Vec::new(),
        };
        let mut overrides: Values = match options.story_index {
            Some(index) => vec![
                ("ComicStoryUseStoryIndex".to_owned(), Value::Integer(1)),
                ("ComicStoryStoryIndex".to_owned(), Value::Integer(index)),
            ],
            None => Vec::new(),
        };
        if let Some(right) = options.right_binding {
            // 1 in CSP's right-bound works, on the work and on each page.
            let was_right = csp_format::story::canvas_value(template.database(), "ComicBindPosition")?
                .or_else(|| super::value_of(&canvas_values, "ComicBindPosition").cloned())
                .map(|value| super::int_value(Some(&value)) != 0);
            // Bound on the other side, the book starts on the other side too:
            // a right-bound work's first page is a left page, a left-bound one's a right page.
            if was_right.is_some_and(|was| was != right) {
                first_page_left = first_page_left.map(|left| !left);
            }
            overrides.push(("ComicBindPosition".to_owned(), Value::Integer(right as i64)));
            if let Some(left) = first_page_left {
                // The work's 開始ページ (1: from the right), as blank works write it.
                overrides.push(("ComicStartPage".to_owned(), Value::Integer((!left) as i64)));
            }
        }
        for (column, value) in &overrides {
            super::set_value(&mut canvas_values, column, value.clone());
        }
        Ok(RasterWorkWriter {
            options,
            canvas_values,
            overrides,
            pages: Vec::new(),
            records: Vec::new(),
            next_index: 0,
            canvas,
            donors,
            first_page_left,
            spread,
        })
    }

    /// The size a spread page is written at, for checking it.
    pub fn spread_canvas(&self) -> Option<TemplateCanvas> {
        let (_, layout) = self.spread.as_ref().ok()?;
        Some(TemplateCanvas {
            width_px: layout.width_px,
            height_px: layout.height_px,
            resolution: self.canvas.resolution,
            trim_px: None,
            basic_px: None,
        })
    }

    /// Write the next page: a single page, or with `spread` the next two
    /// pages of the book as one 見開き page (the file is numbered after the
    /// first of them, as CSP does).
    pub fn write_page(&mut self, layers: &[PageLayer], overlay: Option<&RgbaImage>, spread: bool) -> Result<PathBuf> {
        let index = self.next_index;
        let output = self
            .options
            .out_dir
            .join(page_file_name(&self.options.name_pattern, index + 1));
        let template = if spread {
            match &self.spread {
                Ok((path, _)) => path.clone(),
                Err(reason) => return Err(CspError::format(format!("見開きページを作れません: {reason}"))),
            }
        } else {
            self.options.template.clone()
        };
        write_name_page(
            &template,
            layers,
            &self.donors,
            overlay,
            &output,
            index,
            &self.canvas_values,
            self.first_page_left,
            &self.options.draft_layers,
            &self.options.layer_looks,
        )?;
        self.next_index += if spread { 2 } else { 1 };
        self.pages.push(output.clone());
        self.records.push(page_record(layers, &self.options.draft_layers));
        Ok(output)
    }

    pub fn out_dir(&self) -> &Path {
        &self.options.out_dir
    }

    /// Where the next page (or 見開き page) was written by the export this
    /// writer repeats, moving on past it as [`Self::write_page`] does.
    pub fn next_page_path(&mut self, spread: bool) -> PathBuf {
        let path = self
            .options
            .out_dir
            .join(page_file_name(&self.options.name_pattern, self.next_index + 1));
        self.next_index += if spread { 2 } else { 1 };
        path
    }

    /// Stopped before the end: the pages written so far and what each holds
    /// (no work file is written).
    pub fn abandon(mut self) -> (Vec<PathBuf>, Vec<PageRecord>) {
        (std::mem::take(&mut self.pages), std::mem::take(&mut self.records))
    }

    pub fn finish(mut self) -> Result<WorkReport> {
        let work = match &self.options.work {
            Some((name, cmc)) => {
                if self.pages.is_empty() {
                    return Err(CspError::format("No pages to put in the work"));
                }
                Some(write_cmc(
                    cmc,
                    &self.pages,
                    &self.options.out_dir.join(format!("{name}.cmc")),
                    &self.overrides,
                )?)
            }
            None => None,
        };
        Ok(WorkReport {
            pages: std::mem::take(&mut self.pages),
            work,
            records: std::mem::take(&mut self.records),
        })
    }
}
