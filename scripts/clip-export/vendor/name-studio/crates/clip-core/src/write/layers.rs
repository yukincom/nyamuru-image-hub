//! Small edits of a page's layers that csp-format leaves to its users: where
//! a layer sits among its siblings, a raster layer that looks like another,
//! a layer mask from pixels, and saving without leaving half a file.

use std::path::Path;

use csp_format::copy::{CopyLayer, DROPPED_LAYER_LINKS, RowCopier, column_infos, external_columns};
use csp_format::database::Row;
use csp_format::edit::NewLayer;
use csp_format::offscreen::{Attribute, Parameter, PixelKind, encode};
use csp_format::{ClipFile, GrayImage};
use rusqlite::types::Value;

use crate::RgbaImage;
use crate::error::{CspError, Result};
use crate::raster::{Filter, resize};

/// `LayerType` bit of a layer with a layer mask (CSP: 2 on a folder or
/// vector layer, 3 on a raster layer).
const LAYER_TYPE_MASKED: i64 = 2;
/// `LayerVisibility` bit: the layer mask is in use (bit 0 shows the layer).
const VISIBILITY_MASK_ON: i64 = 2;
/// Values after the size and block grid in a layer mask's `Parameter`
/// section (one 8-bit plane), as CSP writes them.
const MASK_PARAMETERS: [u32; 12] = [1, 1, 0, 1, 0, 0, 0, 1, 256, 0, 256, 256];
/// Position columns of a layer: a copy starts at the canvas origin.
const POSITION_COLUMNS: [&str; 8] = [
    "LayerOffsetX",
    "LayerOffsetY",
    "LayerRenderOffscrOffsetX",
    "LayerRenderOffscrOffsetY",
    "LayerMaskOffsetX",
    "LayerMaskOffsetY",
    "LayerMaskOffscrOffsetX",
    "LayerMaskOffscrOffsetY",
];
/// Layer columns a raster layer made like another does not take from it:
/// ids, the tree, its images and where they are.
const OWN_COLUMNS: [&str; 10] = [
    "_PW_ID",
    "MainId",
    "CanvasId",
    "LayerName",
    "LayerType",
    "LayerUuid",
    "LayerNextIndex",
    "LayerFirstChildIndex",
    "LayerSelect",
    "LayerFolder",
];

/// The column names of `table`.
pub(crate) fn column_names(db: &rusqlite::Connection, table: &str) -> Result<Vec<String>> {
    Ok(csp_format::database::columns(db, table)?
        .into_iter()
        .map(|(name, _)| name)
        .collect())
}

/// This crate's error as csp-format's (inside csp-format's hooks).
pub(crate) fn format_error(error: CspError) -> csp_format::Error {
    csp_format::Error::format(error.to_string())
}

/// Set `column` of `row`, adding it at the end when the row lacks it.
pub(crate) fn set_row_value(row: &mut Row, column: &str, value: Value) {
    if !row.set(column, value.clone()) {
        let mut columns = row.columns().to_vec();
        let mut values = row.values().to_vec();
        columns.push(column.to_owned());
        values.push(value);
        *row = Row::new(columns, values);
    }
}

/// Put a copied row at the canvas origin (csp-format keeps the source's
/// position; the name's layers are drawn in page pixels).
pub(crate) fn at_origin(row: &mut Row) {
    for column in POSITION_COLUMNS {
        row.set(column, Value::Integer(0));
    }
}

/// Copy layer `layer_id` of `source` into `file`, at the canvas origin,
/// on top of `parent`'s children; `edit` changes the new row first.
pub(crate) fn copy_layer(
    file: &mut ClipFile,
    source: &ClipFile,
    layer_id: i64,
    parent: i64,
    edit: &mut dyn FnMut(&mut Row) -> Result<()>,
    payload_hook: Option<&csp_format::copy::PayloadHook<'_>>,
) -> Result<i64> {
    let mut row_hook = |row: &mut Row| -> csp_format::Result<()> {
        at_origin(row);
        edit(row).map_err(format_error)
    };
    let options = CopyLayer {
        payload_hook,
        row_hook: Some(&mut row_hook),
        parent: Some(parent),
    };
    Ok(file.copy_layer_from(source, layer_id, options)?)
}

/// A new raster layer on top of `parent`'s children that looks like
/// `like` (a raster layer's row, from any file): its opacity, blending,
/// colour settings and the rest of what CSP keeps there, but not its
/// pixels, its mask or where it was.
pub(crate) fn raster_like(
    file: &mut ClipFile,
    parent: i64,
    name: &str,
    like: Option<(&ClipFile, &Row)>,
) -> Result<i64> {
    let id = file.add_layer(parent, NewLayer::Raster, name)?;
    let Some((source, row)) = like else { return Ok(id) };
    let infos = column_infos(source.database(), "Layer")?;
    let externals = external_columns(source.database())?;
    let target = column_names(file.database(), "Layer")?;
    let mut values = Vec::new();
    for (column, value) in row.iter() {
        let linked = infos
            .get(column)
            .is_some_and(|info| info.link_table.is_some() || info.owner_type != 0);
        if linked
            || OWN_COLUMNS.contains(&column)
            || POSITION_COLUMNS.contains(&column)
            || DROPPED_LAYER_LINKS.contains(&column)
            || externals.contains(&("Layer".to_owned(), column.to_owned()))
            || column.starts_with("LayerRender")
            || !target.iter().any(|name| name == column)
        {
            continue;
        }
        let value = match column {
            // Without a mask, the mask's bit goes.
            "LayerVisibility" => Value::Integer(row.int(column) & !VISIBILITY_MASK_ON),
            _ => value.clone(),
        };
        values.push((column.to_owned(), value));
    }
    file.set_layer_values(
        id,
        values.iter().map(|(column, value)| (column.as_str(), value.clone())),
    )?;
    Ok(id)
}

/// Move `layer_id` right above `anchor` (in `anchor`'s folder `folder`).
pub(crate) fn place_above(file: &mut ClipFile, folder: i64, anchor: i64, layer_id: i64) -> Result<()> {
    let siblings = file.layer_children(folder)?;
    let next = siblings
        .iter()
        .position(|sibling| *sibling == anchor)
        .and_then(|index| siblings.get(index + 1))
        .copied()
        .filter(|next| *next != layer_id);
    Ok(file.move_layer(layer_id, folder, next)?)
}

/// A layer mask's offscreen `Attribute` (one 8-bit plane) of `width` × `height`.
fn mask_attribute(width: u32, height: u32) -> Attribute {
    let mut attribute = Attribute::new(&Parameter::new(PixelKind::Color, width, height), None);
    if let Some(section) = attribute
        .sections
        .iter_mut()
        .find(|section| section.name == "Parameter")
    {
        section.values[4..16].copy_from_slice(&MASK_PARAMETERS);
    }
    attribute
}

/// Give a layer (or folder) a レイヤーマスク: what is under the opaque
/// pixels of `mask` (canvas px, placed at the top left) shows, the rest is
/// hidden. The mask is turned on, as CSP's 「レイヤーマスクを作成」 does.
///
/// The mask's images copy the layer's own render images (the size of the
/// canvas), then hold the mask in one plane at every zoom level.
pub fn set_layer_mask(file: &mut ClipFile, layer_id: i64, mask: &RgbaImage) -> Result<()> {
    let layer = file
        .layers
        .get(layer_id)
        .ok_or_else(|| CspError::format(format!("No layer {layer_id}")))?
        .clone();
    let thumbnail = layer.row.int("LayerRenderThumbnail");
    let (mipmap, mask_thumbnail) = {
        let mut copier = RowCopier::new(file, None, file.canvas.main_id)?;
        copier.owner_layer = layer_id;
        let mipmap = copier.copy(file.database(), "Mipmap", layer.render_mipmap)?;
        let mask_thumbnail = if thumbnail != 0 {
            copier.copy(file.database(), "LayerThumbnail", thumbnail)?
        } else {
            0
        };
        (mipmap, mask_thumbnail)
    };
    let levels = file
        .mipmap(mipmap)?
        .ok_or_else(|| CspError::format(format!("No mipmap {mipmap}")))?
        .levels;
    let mut base: Option<RgbaImage> = None;
    for level in levels {
        let row = file
            .row("Offscreen", level.offscreen)?
            .ok_or_else(|| CspError::format(format!("No Offscreen {}", level.offscreen)))?;
        let size = Attribute::parse(row.blob("Attribute").unwrap_or_default())?.parameter()?;
        let mut attribute = mask_attribute(size.width, size.height);
        let parameter = attribute.parameter()?;
        let full = base.get_or_insert_with(|| {
            let mut image = RgbaImage::new(size.width, size.height);
            image.paste(mask, 0, 0);
            image
        });
        let image = if (size.width, size.height) == (full.width, full.height) {
            full.clone()
        } else {
            resize(full, size.width, size.height, Filter::Box)
        };
        let alpha = GrayImage {
            width: image.width,
            height: image.height,
            pixels: image.pixels.as_chunks::<4>().0.iter().map(|pixel| pixel[3]).collect(),
        };
        let data = encode(&parameter, None, Some(&alpha))?;
        attribute.set_block_sizes(&data.record_sizes());
        let external = csp_format::edit::new_external_id();
        file.set_external(&external, data.to_bytes());
        file.database().execute(
            "UPDATE Offscreen SET Attribute = ?1, BlockData = ?2 WHERE MainId = ?3",
            (
                attribute.to_bytes(),
                Value::Blob(external.into_bytes()),
                level.offscreen,
            ),
        )?;
    }
    let db = file.database();
    db.execute(
        "UPDATE Layer SET LayerType = LayerType | ?1, LayerVisibility = LayerVisibility | ?2, \
         LayerLayerMaskMipmap = ?3, LayerLayerMaskThumbnail = ?4 WHERE MainId = ?5",
        (LAYER_TYPE_MASKED, VISIBILITY_MASK_ON, mipmap, mask_thumbnail, layer_id),
    )?;
    file.reload()?;
    Ok(())
}

/// `image` as csp-format's image type.
pub(crate) fn csp_image(image: &RgbaImage) -> csp_format::RgbaImage {
    csp_format::RgbaImage {
        width: image.width,
        height: image.height,
        pixels: image.pixels.clone(),
    }
}

/// Save `file` whole or not at all (`name_model::atomic`), so a failed write never leaves
/// half a page (pages are written over the person's own files when updated).
pub(crate) fn save(file: &ClipFile, path: &Path) -> Result<()> {
    let data = file.to_bytes()?;
    name_model::atomic::write(path, &data)?;
    Ok(())
}
