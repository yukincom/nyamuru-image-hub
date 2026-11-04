//! Write one page .clip from a name sheet and its split plan.
//!
//! Each planned page becomes a .clip that keeps the sheet's layers: raster
//! parts are cropped and enlarged, vector and text layers are copied with
//! their coordinates moved and scaled. A CSP-made empty page of the same
//! work is the template; the sheet's schema (vector tables, extra layer
//! columns) and brush styles are added to it, then every planned content is
//! copied in sheet order, inside the same folders as on the sheet.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use csp_format::ClipFile;
use csp_format::database::Row;
use csp_format::story::{drop_render_cache, move_run_length};
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};

use super::layers::{copy_layer, csp_image, format_error, raster_like, save, set_row_value};
use super::{Values, value_of};
use crate::clip::{ClipDocument, LayerKind, round_half_even};
use crate::error::Result;
use crate::plan::{CellTransform, PlannedContent, PlannedPage};
use crate::raster::{Filter, decode_png, resize};
use crate::text::{split_attribute_array, transform_text_attributes};
use crate::vector::{select_vector_objects, transform_vector_data};

const TEXT_BLOBS: [&str; 1] = ["TextLayerAttributes"];
const TEXT_ARRAYS: [&str; 2] = ["TextLayerAttributesArray", "TextLayerAddAttributesV01"];

#[derive(Debug, Clone, PartialEq)]
pub struct PageResult {
    pub path: PathBuf,
    pub layer_ids: Vec<i64>,
    pub warnings: Vec<String>,
}

/// Write `page` of `sheet` into a copy of `template` saved as `output`.
///
/// `page_index` is the 0-based position of the page in the work (CSP's
/// `ComicPageIndex`, used for the ノンブル); it defaults to `page.number - 1`.
/// `canvas_values` overrides Canvas columns the template has (for example
/// the work's `ComicStory*` settings from its .cmc).
pub fn write_page(
    template: &Path,
    sheet: &ClipDocument,
    page: &PlannedPage,
    output: &Path,
    page_index: Option<i64>,
    canvas_values: &Values,
) -> Result<PageResult> {
    let mut file = ClipFile::open(template)?;
    file.renew_file_id();
    file.renew_layer_uuids()?;
    apply_page_settings(&mut file, page_index.unwrap_or(page.number - 1), canvas_values, None)?;
    file.prepare_copy_from(sheet.file())?;
    let mut result = PageResult {
        path: output.to_path_buf(),
        layer_ids: Vec::new(),
        warnings: Vec::new(),
    };
    let mut folders: HashMap<i64, i64> = HashMap::new();
    for content in &page.contents {
        let mut parent = file.canvas.root_folder;
        for folder_id in &content.folder_ids {
            let folder = match folders.get(folder_id) {
                Some(folder) => *folder,
                None => {
                    let folder = copy_layer(&mut file, sheet.file(), *folder_id, parent, &mut |_| Ok(()), None)?;
                    folders.insert(*folder_id, folder);
                    folder
                }
            };
            parent = folder;
        }
        let new_id = add_content(&mut file, sheet, content, &page.transform, parent, &mut result.warnings)?;
        result.layer_ids.push(new_id);
    }
    update_preview(file.database(), sheet, page)?;
    save(&file, output)?;
    Ok(result)
}

/// Set the page position in the work and the work's canvas settings (and
/// with them the episode number in the story information text).
///
/// `zero_left` is whether page index 0 is a left page; none keeps the
/// template's own parity. On a spread it tells which half has the page that
/// comes first in the book (the right one in a right-bound manga).
pub(crate) fn apply_page_settings(
    file: &mut ClipFile,
    page_index: i64,
    canvas_values: &Values,
    zero_left: Option<bool>,
) -> Result<()> {
    // Page `page_index` is on the left when page 0 is and the two are an even
    // number apart; the other half of a spread is the next page.
    let first_right = zero_left
        .map(|left| left != (page_index.rem_euclid(2) == 0))
        .unwrap_or(true);
    // A spread keeps its sides: the right half is the right page.
    file.set_comic_page(page_index, zero_left)?;
    if !canvas_values.is_empty() {
        let old_index = file.canvas_value("ComicStoryStoryIndex")?;
        for (column, value) in canvas_values {
            file.set_canvas_value(column, value.clone())?;
        }
        if let (Some(Value::Integer(old)), Some(Value::Integer(new))) =
            (old_index, value_of(canvas_values, "ComicStoryStoryIndex"))
            && old != *new
        {
            replace_story_index(file.database(), old, *new)?;
        }
    }
    Ok(file.update_story_numbers(first_right)?)
}

fn add_content(
    file: &mut ClipFile,
    sheet: &ClipDocument,
    content: &PlannedContent,
    transform: &CellTransform,
    parent: i64,
    warnings: &mut Vec<String>,
) -> Result<i64> {
    let layer = sheet.find_layer(content.layer_id)?;
    if content.kind == LayerKind::Raster {
        // A new raster layer that looks like the sheet's, holding the
        // page's part of its pixels (the sheet layer's are not copied).
        let row = sheet.file().row("Layer", layer.main_id)?;
        let new_id = raster_like(file, parent, &layer.name, row.as_ref().map(|row| (sheet.file(), row)))?;
        if let Some(crop) = content.crop {
            let (x0, y0, x1, y1) = (
                crop.0.floor() as i64,
                crop.1.floor() as i64,
                crop.2.ceil() as i64,
                crop.3.ceil() as i64,
            );
            let region = sheet.layer_pixels_in_box(layer, (x0, y0, x1, y1))?;
            if !crate::raster::is_transparent(&region) {
                let (tx0, ty0, tx1, ty1) = transform.map_box((x0 as f64, y0 as f64, x1 as f64, y1 as f64));
                let width = round_half_even(tx1 - tx0).max(1) as u32;
                let height = round_half_even(ty1 - ty0).max(1) as u32;
                let scaled = resize(&region, width, height, Filter::Lanczos3);
                file.set_layer_pixels(
                    new_id,
                    &csp_image(&scaled),
                    (round_half_even(tx0), round_half_even(ty0)),
                )?;
            }
        }
        return Ok(new_id);
    }
    let scale = transform.scale;
    let dx = transform.dx + layer.offset_x as f64 * scale;
    let dy = transform.dy + layer.offset_y as f64 * scale;
    let payload_hook = |table: &str, _column: &str, payload: Vec<u8>| -> csp_format::Result<Vec<u8>> {
        if table != "VectorObjectList" {
            return Ok(payload);
        }
        let moved = (|| {
            let payload = if content.kind == LayerKind::Vector && !content.items.is_empty() {
                select_vector_objects(&payload, &content.items)?
            } else {
                payload
            };
            transform_vector_data(&payload, scale, dx, dy)
        })();
        moved.map_err(format_error)
    };
    let mut array_warnings = Vec::new();
    let mut edit = |row: &mut Row| -> Result<()> {
        for column in TEXT_BLOBS {
            if let Some(blob) = row.blob(column).filter(|blob| !blob.is_empty()) {
                let moved = transform_text_attributes(blob, scale, dx, dy)?;
                set_row_value(row, column, Value::Blob(moved));
            }
        }
        for column in TEXT_ARRAYS {
            if let Some(blob) = row.blob(column).filter(|blob| !blob.is_empty()) {
                let moved = transform_array(blob, scale, dx, dy, column, &mut array_warnings);
                set_row_value(row, column, Value::Blob(moved));
            }
        }
        Ok(())
    };
    let new_id = copy_layer(
        file,
        sheet.file(),
        layer.main_id,
        parent,
        &mut edit,
        Some(&payload_hook),
    )?;
    warnings.append(&mut array_warnings);
    if content.kind == LayerKind::Text && !content.items.is_empty() && sheet.text_blocks(layer)?.len() > 1 {
        warnings.push(format!(
            "テキストレイヤー「{}」はレイヤーごと写したため、ほかのページの文字も含まれます",
            layer.name
        ));
    }
    Ok(new_id)
}

fn transform_array(blob: &[u8], scale: f64, dx: f64, dy: f64, column: &str, warnings: &mut Vec<String>) -> Vec<u8> {
    let moved = split_attribute_array(blob).and_then(|blocks| {
        blocks
            .into_iter()
            .map(|block| transform_text_attributes(block, scale, dx, dy))
            .collect::<Result<Vec<_>>>()
    });
    match moved {
        Ok(blocks) => blocks
            .into_iter()
            .flat_map(|block| {
                let mut entry = (block.len() as u32).to_le_bytes().to_vec();
                entry.extend(block);
                entry
            })
            .collect(),
        Err(_) => {
            warnings.push(format!("{column} の形式が分からないため、そのまま写しました"));
            blob.to_vec()
        }
    }
}

pub(crate) fn has_column(db: &Connection, table: &str, column: &str) -> Result<bool> {
    Ok(csp_format::database::has_column(db, table, column)?)
}

/// Set the page position and side (left / right) on the copied canvas.
///
fn is_digit(character: char) -> bool {
    character.is_ascii_digit() || ('０'..='９').contains(&character)
}

/// Replace "<old>話" (not preceded by a digit) with "<new>話".
fn replace_episode(text: &str, old: i64, new: i64) -> String {
    let pattern = format!("{old}話");
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(position) = rest.find(&pattern) {
        let before = &rest[..position];
        let preceded = before
            .chars()
            .next_back()
            .or_else(|| result.chars().next_back())
            .is_some_and(is_digit);
        result.push_str(before);
        result.push_str(&if preceded { pattern.clone() } else { format!("{new}話") });
        rest = &rest[position + pattern.len()..];
    }
    result.push_str(rest);
    result
}

/// Change the episode number written in the template's 作品情報 text layer.
///
/// CSP shows the text stored in the story info layer (for example
/// "ユメノストラ 3話") rather than rebuilding it from the Canvas settings, so
/// a template from another episode would keep showing that episode. The
/// character count of its single style run (TLV 0x0b) follows the change,
/// and the cached rendering of the text (TLV 0x32) is cleared.
fn replace_story_index(db: &Connection, old: i64, new: i64) -> Result<()> {
    if !has_column(db, "Layer", "ComicStoryInfoType")? {
        return Ok(());
    }
    let rows: Vec<(i64, Value, Value)> = {
        let mut statement =
            db.prepare("SELECT MainId, TextLayerString, TextLayerAttributes FROM Layer WHERE ComicStoryInfoType = 1")?;
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<std::result::Result<_, _>>()?
    };
    for (layer_id, string, attributes) in rows {
        let (text, as_blob) = match string {
            Value::Blob(bytes) => (String::from_utf8_lossy(&bytes).into_owned(), true),
            Value::Text(text) => (text, false),
            _ => continue,
        };
        let changed = replace_episode(&text, old, new);
        if changed == text {
            continue;
        }
        let stored = if as_blob {
            Value::Blob(changed.clone().into_bytes())
        } else {
            Value::Text(changed.clone())
        };
        db.execute(
            "UPDATE Layer SET TextLayerString = ?1 WHERE MainId = ?2",
            (stored, layer_id),
        )?;
        if let Value::Blob(attributes) = attributes {
            let delta = changed.chars().count() as i64 - text.chars().count() as i64;
            let moved = move_run_length(&attributes, delta)?;
            db.execute(
                "UPDATE Layer SET TextLayerAttributes = ?1 WHERE MainId = ?2",
                (moved, layer_id),
            )?;
        }
        drop_render_cache(db, layer_id)?;
    }
    Ok(())
}

pub(crate) fn canvas_width_px(width: f64, resolution: f64, unit: i64) -> f64 {
    let per_inch = match unit {
        2 => 25.4,
        1 => 2.54,
        3 => 1.0,
        5 => 72.0,
        _ => return width,
    };
    width * resolution / per_inch
}

/// Draw the page's part of the sheet preview onto the page preview.
///
/// CSP shows `CanvasPreview` as the page thumbnail in a work's page list
/// without opening the page, and the template's preview is blank. The sheet
/// preview was rendered by CSP, so cropping the cell from it and placing it
/// with the cell transform gives a faithful thumbnail.
fn update_preview(db: &Connection, sheet: &ClipDocument, page: &PlannedPage) -> Result<()> {
    let Some(sheet_png) = &sheet.preview_png else {
        return Ok(());
    };
    if !csp_format::database::has_table(db, "CanvasPreview")? {
        return Ok(());
    }
    let row: Option<(i64, Option<Vec<u8>>)> = db
        .query_row(
            "SELECT rowid, ImageData FROM CanvasPreview ORDER BY rowid LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((row_id, Some(preview_png))) = row else {
        return Ok(());
    };
    let (width, resolution, unit): (f64, f64, i64) = db.query_row(
        "SELECT CanvasWidth, CanvasResolution, CanvasUnit FROM Canvas",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let (Ok(mut preview), Ok(source)) = (decode_png(&preview_png), decode_png(sheet_png)) else {
        return Ok(());
    };
    let page_width = canvas_width_px(width, resolution, unit);
    if page_width <= 0.0 || sheet.canvas.width_px <= 0 {
        return Ok(());
    }
    let to_preview = preview.width as f64 / page_width;
    let from_sheet = source.width as f64 / sheet.canvas.width_px as f64;
    let cell = &page.cell.rect;
    let crop = crate::raster::crop(
        &source,
        (
            round_half_even(cell.x0 * from_sheet),
            round_half_even(cell.y0 * from_sheet),
            round_half_even(cell.x1 * from_sheet),
            round_half_even(cell.y1 * from_sheet),
        ),
    );
    let (x0, y0, x1, y1) = page.transform.map_box((cell.x0, cell.y0, cell.x1, cell.y1));
    let (x0, y0, x1, y1) = (x0 * to_preview, y0 * to_preview, x1 * to_preview, y1 * to_preview);
    let width = round_half_even(x1 - x0).max(1) as u32;
    let height = round_half_even(y1 - y0).max(1) as u32;
    preview.paste(
        &resize(&crop, width, height, Filter::Lanczos3),
        round_half_even(x0),
        round_half_even(y0),
    );
    db.execute(
        "UPDATE CanvasPreview SET ImageData = ?1 WHERE rowid = ?2",
        (preview.to_png()?, row_id),
    )?;
    Ok(())
}

/// Replace the page preview with `image` (the whole page) shrunk to its size.
pub(crate) fn replace_preview(db: &Connection, image: &crate::RgbaImage) -> Result<()> {
    if !csp_format::database::has_table(db, "CanvasPreview")? {
        return Ok(());
    }
    let row: Option<(i64, Option<Vec<u8>>)> = db
        .query_row(
            "SELECT rowid, ImageData FROM CanvasPreview ORDER BY rowid LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((row_id, Some(preview_png))) = row else {
        return Ok(());
    };
    let Ok(preview) = decode_png(&preview_png) else {
        return Ok(());
    };
    let shrunk = resize(image, preview.width, preview.height, Filter::Box);
    db.execute(
        "UPDATE CanvasPreview SET ImageData = ?1 WHERE rowid = ?2",
        (shrunk.to_png()?, row_id),
    )?;
    Ok(())
}
