//! Bring changed dialogue into pages already being drawn in CSP.
//!
//! After the pages go to CSP the pen work starts in them, so writing them
//! again would lose it. Here only the dialogue is brought in: texts that are
//! still the same are left as they are (where they were moved to in CSP
//! too), texts that are gone or changed are hidden and renamed 「（旧）…」 so
//! they can be compared and deleted in CSP, and the new ones are added next
//! to them. Balloons (vector lines and the paper under them) that changed in
//! the name are swapped the same way. Nothing is deleted; the file as it was
//! is copied to a backup folder first.
//!
//! What was written last time (the export's manifest) tells the name's
//! changes from CSP's: a text retyped in CSP stays as it is while the name
//! still has the old words, and texts added in CSP are left alone.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use csp_format::ClipFile;
use rusqlite::types::Value;
use serde::Serialize;

use super::layers::{csp_image, place_above, raster_like, save};
use super::manifest::{PageRecord, image_signature};
use super::raster_page::{
    Donors, PageLayer, PartDonors, RasterLayer, add_text_layer, add_vector_layer, layer_name, make_draft, prepare_for,
    set_opacity,
};
use crate::RgbaImage;
use crate::clip::{ClipDocument, ClipLayer, LayerKind};
use crate::error::{CspError, Result};
use crate::raster::{Filter, resize};
use crate::text::NewText;
use crate::vector::{NewVectorLine, brush_style_of, shape_signature};

/// A layer to swap: its id, and the brush style of its lines (vector layers).
type OldLayer = (i64, Option<u32>);

/// What hidden layers are renamed with.
pub const RETIRED_PREFIX: &str = "（旧）";

/// The page's dialogue now, and the layers that go with it.
pub struct DialogueUpdate {
    pub texts: Vec<NewText>,
    /// Layers swapped (found by name) when the balloons changed in the
    /// name: the balloon lines, and the images that go with them (swapped
    /// with the lines, or with the dialogue when there are no lines).
    pub balloons: Vec<PageLayer>,
    /// The memos (a 下描き image layer, redrawn in place: nothing is drawn on it in CSP).
    pub notes: Option<RasterLayer>,
    /// The 指示 (a 下描き image layer each, redrawn in place as the memos are).
    pub marks: Vec<RasterLayer>,
    /// What this tool wrote into the page last time, when known. Other texts
    /// there were added in CSP and are left alone; without it every plain
    /// text counts as this tool's.
    pub written: Option<PageRecord>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueUpdateReport {
    pub path: PathBuf,
    /// The page as it was, when it was changed.
    pub backup: Option<PathBuf>,
    /// Texts left as they were.
    pub kept: usize,
    /// Texts hidden as 「（旧）」.
    pub retired: Vec<String>,
    /// Texts added.
    pub added: Vec<String>,
    /// Texts there that this tool did not write (left alone).
    pub foreign: usize,
    /// Texts changed or deleted in CSP that the name still has as written
    /// last time: CSP's stands.
    pub left_as_in_csp: usize,
    /// Layers swapped, and those that were not found (renamed or deleted in CSP).
    pub replaced: Vec<String>,
    pub not_found: Vec<String>,
    /// Swapped layers that had been changed in CSP too (CSP's are hidden as 「（旧）」).
    pub conflicts: Vec<String>,
    /// Whether the memos were redrawn.
    pub notes: bool,
    /// The 指示 layers redrawn (or added).
    pub marks: Vec<String>,
    /// What the page holds from this tool now, to record.
    #[serde(skip)]
    pub record: PageRecord,
    /// What the page read back does not hold as asked; empty when fine.
    pub problems: Vec<String>,
}

/// A text as compared: line breaks as `\n`, no space around.
pub fn text_key(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n").trim().to_owned()
}

/// A dialogue text layer of the page: visible, plain (not the work info or
/// the page number), not one this tool already hid.
struct PageText {
    id: i64,
    name: String,
    key: String,
}

fn page_texts(document: &ClipDocument) -> Vec<PageText> {
    document
        .layers()
        .into_iter()
        .filter(|layer| layer.kind == LayerKind::Text && layer.visible && !layer.name.starts_with(RETIRED_PREFIX))
        .filter(|layer| {
            document
                .layer_row(layer.main_id)
                .is_some_and(|row| row.int("TextLayerType") == 0 && row.int("ComicStoryInfoType") == 0)
        })
        .map(|layer| PageText {
            id: layer.main_id,
            name: layer.name.clone(),
            key: text_key(&document.text_strings(layer).join("\n")),
        })
        .collect()
}

/// The parent of every layer.
fn parents(layer: &ClipLayer, result: &mut HashMap<i64, i64>) {
    for child in &layer.children {
        result.insert(child.main_id, layer.main_id);
        parents(child, result);
    }
}

/// The visible layer named `name` (not one already hidden by this tool).
fn named_layer<'a>(document: &'a ClipDocument, name: &str) -> Option<&'a ClipLayer> {
    document
        .layers()
        .into_iter()
        .find(|layer| layer.name == name && layer.visible)
}

/// Hide a layer and mark it as the old one.
fn retire(file: &mut ClipFile, id: i64, name: &str) -> Result<()> {
    file.database().execute(
        "UPDATE Layer SET LayerVisibility = LayerVisibility & ~1, LayerName = ?1 WHERE MainId = ?2",
        (format!("{RETIRED_PREFIX}{name}"), id),
    )?;
    file.reload()?;
    Ok(())
}

/// A dialogue text on a page, as CSP has it now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CspText {
    pub text: String,
    /// Where its text sits, in page px (the union of its blocks).
    pub bbox: Option<[i64; 4]>,
}

/// The dialogue of a page as CSP has it now, and what this tool wrote there
/// last (to tell what was changed in CSP).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CspDialogue {
    pub texts: Vec<CspText>,
    pub written: Option<Vec<String>>,
    /// What was written before the name last took this page's dialogue back.
    pub adopted_from: Option<Vec<String>>,
}

/// Read the dialogue texts of the page at `path`, with what the last export
/// or update wrote there.
pub fn read_dialogue(path: &Path) -> Result<CspDialogue> {
    let document = ClipDocument::read(path)?;
    let texts = page_texts(&document)
        .into_iter()
        .map(|text| {
            // Moved in CSP: the layer's offset on top of where its text sits.
            let bbox = document
                .layers()
                .into_iter()
                .find(|layer| layer.main_id == text.id)
                .and_then(|layer| {
                    let (dx, dy) = (layer.offset_x, layer.offset_y);
                    document
                        .text_blocks(layer)
                        .ok()?
                        .into_iter()
                        .filter_map(|block| block.bbox)
                        .map(|(x0, y0, x1, y1)| [x0 as i64 + dx, y0 as i64 + dy, x1 as i64 + dx, y1 as i64 + dy])
                        .reduce(|a, b| [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])])
                });
            CspText { text: text.key, bbox }
        })
        .collect();
    let record = super::manifest::written(path).unwrap_or_default();
    Ok(CspDialogue {
        texts,
        written: record.texts,
        adopted_from: record.adopted_from,
    })
}

/// Record the page's dialogue as CSP has it now as this tool's: once the
/// name has taken it back, the next update leaves it as it is. What was
/// recorded before is kept (`adopted_from`) for a name that undoes it.
pub fn adopt_dialogue(path: &Path) -> Result<()> {
    let document = ClipDocument::read(path)?;
    let texts: Vec<String> = page_texts(&document).into_iter().map(|text| text.key).collect();
    let before = super::manifest::written(path).unwrap_or_default();
    let adopted_from = if before.texts.as_ref() == Some(&texts) {
        before.adopted_from.clone()
    } else {
        before.texts.clone()
    };
    let record = PageRecord {
        texts: Some(texts),
        adopted_from,
        ..before
    };
    super::manifest::record_page(path, record)?;
    Ok(())
}

/// Bring `update` into the page at `path` (see the module notes); the page
/// is left untouched when its dialogue is already the same. `fallback`
/// gives layers to copy when the page has none of a kind.
pub fn update_dialogue(
    path: &Path,
    update: &DialogueUpdate,
    fallback: &Donors,
    backup_dir: &Path,
) -> Result<DialogueUpdateReport> {
    let document = ClipDocument::read(path)?;
    let mut report = DialogueUpdateReport {
        path: path.to_path_buf(),
        ..Default::default()
    };
    let mut ours = page_texts(&document);
    // Texts written last time that are not on the page any more: changed or
    // deleted in CSP, which stands while the name still has them as written.
    let mut edited_in_csp: Vec<String> = Vec::new();
    // Texts typed in CSP (added, or retyped from this tool's).
    let mut csp_texts: Vec<String> = Vec::new();
    if let Some(written) = update.written.as_ref().and_then(|record| record.texts.as_ref()) {
        // Only texts written last time (each once) are this tool's to change.
        let mut left: Vec<String> = written.iter().map(|text| text_key(text)).collect();
        ours.retain(|text| match left.iter().position(|key| *key == text.key) {
            Some(index) => {
                left.remove(index);
                true
            }
            None => {
                csp_texts.push(text.key.clone());
                false
            }
        });
        edited_in_csp = left;
    }
    let mut unmatched: Vec<&PageText> = ours.iter().collect();
    let mut added: Vec<&NewText> = Vec::new();
    for text in &update.texts {
        let key = text_key(&text.text);
        if let Some(index) = unmatched.iter().position(|old| old.key == key) {
            unmatched.remove(index);
            report.kept += 1;
        } else if let Some(index) = csp_texts.iter().position(|old| *old == key) {
            // The name now says what was typed in CSP (read back, or typed
            // in both): that text is the name's from here on.
            csp_texts.remove(index);
            report.kept += 1;
        } else if let Some(index) = edited_in_csp.iter().position(|old| *old == key) {
            edited_in_csp.remove(index);
            report.left_as_in_csp += 1;
        } else {
            added.push(text);
        }
    }
    report.foreign = csp_texts.len();
    let texts_changed = !unmatched.is_empty() || !added.is_empty();
    // Balloon lines are swapped when the name's differ from what was written
    // (or, unrecorded, from what the page has); their images go with them.
    let mut swaps: Vec<&PageLayer> = Vec::new();
    let mut vectors = update
        .written
        .as_ref()
        .map(|record| record.vectors.clone())
        .unwrap_or_default();
    for layer in &update.balloons {
        if let PageLayer::Vector { name, lines } = layer {
            let points: Vec<Vec<(f64, f64)>> = lines.iter().map(NewVectorLine::xy).collect();
            let new = shape_signature(points.iter().map(Vec::as_slice));
            let on_page = named_layer(&document, name)
                .and_then(|old| document.vector_objects(old).ok())
                .map(|objects| shape_signature(objects.iter().map(|object| object.points.as_slice())));
            let recorded = vectors.get(name).cloned();
            if recorded.as_ref().or(on_page.as_ref()) != Some(&new) {
                if recorded.is_some() && on_page.is_some() && on_page != recorded {
                    report.conflicts.push(name.clone());
                }
                swaps.push(layer);
            }
            vectors.insert(name.clone(), new);
        }
    }
    let has_lines = update
        .balloons
        .iter()
        .any(|layer| matches!(layer, PageLayer::Vector { .. }));
    if if has_lines { !swaps.is_empty() } else { texts_changed } {
        swaps.extend(
            update
                .balloons
                .iter()
                .filter(|layer| matches!(layer, PageLayer::Raster(_))),
        );
    }
    // The memos are redrawn in their own layer when they changed in the name
    // (unrecorded: once, if the page has the layer).
    let mut rasters = update
        .written
        .as_ref()
        .map(|record| record.rasters.clone())
        .unwrap_or_default();
    // The 指示 the same way, each in its layer.
    let redrawn: Vec<&RasterLayer> = update
        .notes
        .iter()
        .chain(&update.marks)
        .filter(|layer| {
            let new = image_signature(&layer.image);
            match rasters.insert(layer.name.clone(), new.clone()) {
                Some(recorded) => recorded != new,
                // Unrecorded (written by an older version): compared with the page.
                None => match named_layer(&document, &layer.name) {
                    Some(old) => !same_pixels(&document, old, &layer.image),
                    None => !crate::raster::is_transparent(&layer.image),
                },
            }
        })
        .collect();
    report.record = PageRecord {
        texts: Some(update.texts.iter().map(|text| text.text.clone()).collect()),
        adopted_from: None,
        vectors,
        rasters,
    };
    if !texts_changed && swaps.is_empty() && redrawn.is_empty() {
        return Ok(report);
    }

    std::fs::create_dir_all(backup_dir)?;
    let backup = backup_dir.join(path.file_name().ok_or_else(|| CspError::format("No file name"))?);
    std::fs::copy(path, &backup)?;
    report.backup = Some(backup);

    let mut parent_of = HashMap::new();
    parents(&document.root, &mut parent_of);
    let (width, height) = (document.canvas.width_px as u32, document.canvas.height_px as u32);
    let mut file = ClipFile::open(path)?;
    let root = file.canvas.root_folder;
    // New texts go above the topmost dialogue text (old or kept), else on top.
    let anchor = ours
        .last()
        .map(|text| (parent_of.get(&text.id).copied().unwrap_or(root), text.id));
    for old in &unmatched {
        retire(&mut file, old.id, &old.name)?;
        report.retired.push(old.key.clone());
    }

    // The balloons: swapped in place of the layer of the same name.
    let balloons: Vec<(&PageLayer, Option<OldLayer>)> = update
        .balloons
        .iter()
        .filter(|layer| swaps.iter().any(|swap| std::ptr::eq(*swap, *layer)))
        .map(|layer| {
            let name = layer_name(layer);
            let found = named_layer(&document, name).map(|old| {
                let brush = document.vector_payloads(old).ok().and_then(|payloads| {
                    payloads
                        .first()
                        .and_then(|payload| brush_style_of(payload).ok().flatten())
                });
                (old.main_id, brush)
            });
            (layer, found)
        })
        .collect();
    let redrawn: Vec<(&RasterLayer, Option<i64>)> = redrawn
        .into_iter()
        .map(|layer| (layer, named_layer(&document, &layer.name).map(|old| old.main_id)))
        .collect();
    // The page's own layers are copied first: what CSP saved there fits it.
    let mut own = PartDonors::find(document)?;
    let text_donor = if own.has_text() {
        &own
    } else {
        let donor = fallback
            .text
            .as_ref()
            .ok_or_else(|| CspError::format("No text layer to copy"))?;
        prepare_for(&mut file, donor)?;
        donor
    };
    let mut new_texts = Vec::new();
    for text in &added {
        new_texts.push(add_text_layer(&mut file, text_donor, text, root)?);
        report.added.push(text_key(&text.text));
    }
    // A changed text goes next to its old one, to compare; new ones above the topmost text.
    for (index, id) in new_texts.iter().enumerate().rev() {
        let next_to = unmatched
            .get(index)
            .map(|old| (parent_of.get(&old.id).copied().unwrap_or(root), old.id))
            .or(anchor);
        if let Some((parent, anchor)) = next_to {
            place_above(&mut file, parent, anchor, *id)?;
        }
    }

    for (layer, found) in balloons {
        let name = layer_name(layer).to_owned();
        let Some((old, brush)) = found else {
            report.not_found.push(name);
            continue;
        };
        let parent = parent_of.get(&old).copied().unwrap_or(root);
        let id = match layer {
            PageLayer::Vector { name, lines } => {
                let donor = match brush {
                    Some(brush) => {
                        own.vector = Some((old, brush));
                        &own
                    }
                    None if own.has_vector() => &own,
                    None => {
                        let donor = fallback
                            .vector
                            .as_ref()
                            .ok_or_else(|| CspError::format("No vector layer to copy"))?;
                        prepare_for(&mut file, donor)?;
                        donor
                    }
                };
                add_vector_layer(&mut file, donor, name, lines, parent)?
            }
            PageLayer::Raster(raster) => {
                // Looks like the old one (shown, not a 下描き, not locked), with the new pixels.
                let mut row = own.source.file().row("Layer", old)?;
                if let Some(row) = row.as_mut() {
                    for (column, value) in [("LayerVisibility", 1), ("DraftLayer", 0), ("LayerLock", 0)] {
                        row.set(column, Value::Integer(value));
                    }
                }
                let like = row.as_ref().map(|row| (own.source.file(), row));
                let id = raster_like(&mut file, parent, &raster.name, like)?;
                if !crate::raster::is_transparent(&raster.image) {
                    let image = fit(&raster.image, width, height);
                    file.set_layer_pixels(id, &csp_image(image.as_ref().unwrap_or(&raster.image)), (0, 0))?;
                }
                id
            }
            _ => return Err(CspError::format("Only balloon lines and images are swapped")),
        };
        retire(&mut file, old, &name)?;
        place_above(&mut file, parent, old, id)?;
        report.replaced.push(name);
    }

    let is_notes = |layer: &RasterLayer| update.notes.as_ref().is_some_and(|notes| std::ptr::eq(notes, layer));
    for (layer, found) in redrawn {
        let id = match found {
            Some(id) => id,
            None => {
                // A page written without memos (指示): a new 下描き layer on top.
                let like = first_raster(&own.source)?;
                let like = like.as_ref().map(|row| {
                    let mut row = row.clone();
                    for (column, value) in [("LayerVisibility", 1), ("LayerLock", 0)] {
                        row.set(column, Value::Integer(value));
                    }
                    row
                });
                let id = raster_like(
                    &mut file,
                    root,
                    &layer.name,
                    like.as_ref().map(|row| (own.source.file(), row)),
                )?;
                make_draft(&mut file, id)?;
                if !is_notes(layer) {
                    // 指示 keep their colour: a 下描き layer at full opacity.
                    set_opacity(&mut file, id, 1.0)?;
                }
                id
            }
        };
        // Drawn anew: the old pixels go.
        let image = fit(&layer.image, width, height);
        file.set_layer_pixels(id, &csp_image(image.as_ref().unwrap_or(&layer.image)), (0, 0))?;
        if is_notes(layer) {
            report.notes = true;
        } else {
            report.marks.push(layer.name.clone());
        }
    }

    save(&file, path)?;
    report.problems = check_update(path, update, &report);
    Ok(report)
}

/// The first raster layer of a page, which a new one looks like.
fn first_raster(document: &ClipDocument) -> Result<Option<csp_format::database::Row>> {
    Ok(csp_format::database::select(
        document.database(),
        "SELECT * FROM Layer WHERE LayerType = 1 ORDER BY MainId LIMIT 1",
        [],
    )?
    .into_iter()
    .next())
}

/// Whether `layer` holds `image` (at the page's size): the same coverage,
/// and the same colour where it covers.
fn same_pixels(document: &ClipDocument, layer: &ClipLayer, image: &RgbaImage) -> bool {
    let (width, height) = (document.canvas.width_px as u32, document.canvas.height_px as u32);
    let fitted = fit(image, width, height);
    let image = fitted.as_ref().unwrap_or(image);
    let stored = match document.render_layer_pixels(layer) {
        Ok(Some(stored)) => stored,
        Ok(None) => return crate::raster::is_transparent(image),
        Err(_) => return false,
    };
    let (origin_x, origin_y) = layer.pixel_origin();
    (0..height as i64).all(|y| {
        (0..width as i64).all(|x| {
            let at = ((y * width as i64 + x) * 4) as usize;
            let new = &image.pixels[at..at + 4];
            let (sx, sy) = (x - origin_x, y - origin_y);
            let old: &[u8] = if sx < 0 || sy < 0 || sx >= stored.width as i64 || sy >= stored.height as i64 {
                &[0, 0, 0, 0]
            } else {
                let at = ((sy * stored.width as i64 + sx) * 4) as usize;
                &stored.pixels[at..at + 4]
            };
            new[3] == old[3] && (new[3] == 0 || new[..3] == old[..3])
        })
    })
}

/// `image` at the page's size, when it is not already.
fn fit(image: &RgbaImage, width: u32, height: u32) -> Option<RgbaImage> {
    ((image.width, image.height) != (width, height)).then(|| resize(image, width, height, Filter::Lanczos3))
}

/// Read the page back: every new text is there and visible, the old ones
/// hidden, each swapped layer there once.
fn check_update(path: &Path, update: &DialogueUpdate, report: &DialogueUpdateReport) -> Vec<String> {
    let document = match ClipDocument::read(path) {
        Ok(document) => document,
        Err(error) => return vec![format!("読み直せません: {error}")],
    };
    let mut problems = Vec::new();
    let mut visible: Vec<String> = page_texts(&document).into_iter().map(|text| text.key).collect();
    let mut missing = 0;
    for text in &update.texts {
        let key = text_key(&text.text);
        match visible.iter().position(|old| *old == key) {
            Some(index) => {
                visible.remove(index);
            }
            None => missing += 1,
        }
    }
    if missing > report.left_as_in_csp {
        problems.push(format!("セリフが {} 個足りません", missing - report.left_as_in_csp));
    }
    if visible.len() != report.foreign {
        problems.push(format!(
            "見えているテキストが {} 個多くあります",
            visible.len().saturating_sub(report.foreign)
        ));
    }
    for name in &report.replaced {
        let count = document
            .layers()
            .into_iter()
            .filter(|layer| layer.name == *name && layer.visible)
            .count();
        if count != 1 {
            problems.push(format!("「{name}」レイヤーが {count} 枚あります"));
        }
    }
    problems
}
