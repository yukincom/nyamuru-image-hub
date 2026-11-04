//! Editing an opened .clip (R12): layer pixels, layer properties, adding
//! and removing layers, and the stored preview.
//!
//! Each change is made in the in-memory database and external chunks, so
//! [`ClipFile::save`] writes a consistent file: new external chunks are
//! listed in `ExternalChunk` with their offsets, and replaced chunks are
//! dropped. Layer pixels are written to every mipmap level (each level is
//! the one above halved with a 2×2 box, as CSP makes them).
//!
//! New rows get their `MainId` from `ElemScheme.MaxIndex` (the largest id
//! handed out so far), and new layers are built like the ones CSP makes:
//! a mipmap of canvas-sized levels halved until the canvas fits in 128
//! pixels (at least 4 levels), and a 512 × 512 thumbnail offscreen. As in
//! CSP's own files, offscreens that hold nothing yet name an external
//! chunk that is not stored.

use std::hash::{BuildHasher, Hasher};

use rusqlite::OptionalExtension;
use rusqlite::types::Value;

use crate::clip::ClipFile;
use crate::database::{has_column, quote, value_as_text};
use crate::error::{Error, Result, bail};
use crate::image::RgbaImage;
use crate::model::{LAYER_TYPE_PAPER, LAYER_TYPE_RASTER, LAYER_TYPE_ROOT, LayerKind};
use crate::offscreen::{Attribute, InitColor, Parameter, PixelKind, encode};
use crate::render::{BlendMode, render_like_preview};

/// 16 random bytes shaped as a version 4 UUID (CSP's ids are UUIDs).
pub fn new_uuid() -> [u8; 16] {
    let mut bytes = [0u8; 16];
    for half in bytes.chunks_mut(8) {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u128(
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(),
        );
        half.copy_from_slice(&hasher.finish().to_be_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    bytes
}

/// A new external chunk id: "extrnlid" and a UUID as 32 upper-case hex digits.
pub fn new_external_id() -> String {
    let mut text = String::from("extrnlid");
    for byte in new_uuid() {
        text.push_str(&format!("{byte:02X}"));
    }
    text
}

impl ClipFile {
    /// Give the saved file a new random id (see [`ClipFile::set_file_id`]).
    pub fn renew_file_id(&mut self) {
        self.set_file_id(new_uuid());
    }

    /// Replace a raster layer's pixels. `image` is placed with its top-left
    /// at canvas position `position`; pixels outside the layer's offscreen
    /// are dropped. Only colour layers are supported.
    pub fn set_layer_pixels(&mut self, layer_id: i64, image: &RgbaImage, position: (i64, i64)) -> Result<()> {
        let layer = self.layers.get(layer_id).ok_or_else(|| Error::format(format!("No layer {layer_id}")))?.clone();
        let mipmap = self
            .mipmap(layer.render_mipmap)?
            .ok_or_else(|| Error::format(format!("Layer {layer_id} has no render mipmap")))?;
        let origin = layer.pixel_origin();
        let mut level_image: Option<RgbaImage> = None;
        for level in &mipmap.levels {
            let row = self
                .row("Offscreen", level.offscreen)?
                .ok_or_else(|| Error::format(format!("No Offscreen {}", level.offscreen)))?;
            let mut attribute = Attribute::parse(row.blob("Attribute").unwrap_or_default())?;
            let parameter = attribute.parameter()?;
            if parameter.kind() != PixelKind::Color {
                bail!("Layer {layer_id} is not a colour layer ({:?})", parameter.kind());
            }
            let pixels = match level_image.take() {
                None => {
                    let mut full = RgbaImage::new(parameter.width, parameter.height);
                    full.paste(image, position.0 - origin.0, position.1 - origin.1);
                    full
                }
                Some(above) => {
                    let mut halved = above.halve();
                    if (halved.width, halved.height) != (parameter.width, parameter.height) {
                        halved = halved.resize_area(parameter.width, parameter.height);
                    }
                    halved
                }
            };
            let data = encode(&parameter, Some(&pixels), None)?;
            attribute.set_block_sizes(&data.record_sizes());
            let old = row.get("BlockData").and_then(value_as_text).filter(|id| !id.is_empty());
            let id = new_external_id();
            if let Some(old) = &old {
                self.remove_external(old);
            }
            self.set_external(&id, data.to_bytes());
            self.database().execute(
                "UPDATE Offscreen SET Attribute = ?1, BlockData = ?2 WHERE MainId = ?3",
                (attribute.to_bytes(), Value::Blob(id.into_bytes()), level.offscreen),
            )?;
            level_image = Some(pixels);
        }
        Ok(())
    }

    /// Set one `Layer` column.
    pub fn set_layer_value(&mut self, layer_id: i64, column: &str, value: Value) -> Result<()> {
        self.set_layer_values(layer_id, [(column, value)])
    }

    /// Set several `Layer` columns of one layer (reading the layers once after).
    pub fn set_layer_values<'a>(
        &mut self,
        layer_id: i64,
        values: impl IntoIterator<Item = (&'a str, Value)>,
    ) -> Result<()> {
        for (column, value) in values {
            if !crate::database::has_column(self.database(), "Layer", column)? {
                bail!("Layer has no column {column}");
            }
            let sql = format!("UPDATE Layer SET {} = ?1 WHERE MainId = ?2", crate::database::quote(column));
            if self.database().execute(&sql, (value, layer_id))? == 0 {
                bail!("No layer {layer_id}");
            }
        }
        self.reload()
    }

    /// Renames a layer (`LayerName`).
    pub fn set_layer_name(&mut self, layer_id: i64, name: &str) -> Result<()> {
        self.set_layer_value(layer_id, "LayerName", Value::Text(name.to_owned()))
    }

    /// Opacity 0.0..=1.0 (stored as 0..=256).
    pub fn set_layer_opacity(&mut self, layer_id: i64, opacity: f64) -> Result<()> {
        let stored = (opacity.clamp(0.0, 1.0) * crate::model::OPACITY_FULL as f64).round() as i64;
        self.set_layer_value(layer_id, "LayerOpacity", Value::Integer(stored))
    }

    /// Sets the blend mode (`LayerComposite`).
    pub fn set_layer_blend(&mut self, layer_id: i64, mode: BlendMode) -> Result<()> {
        self.set_layer_value(layer_id, "LayerComposite", Value::Integer(mode.code()))
    }

    /// Shows or hides a layer (`LayerVisibility` bit 0; the other bits are kept).
    pub fn set_layer_visible(&mut self, layer_id: i64, visible: bool) -> Result<()> {
        let layer = self.layers.get(layer_id).ok_or_else(|| Error::format(format!("No layer {layer_id}")))?;
        let value = (layer.row.int("LayerVisibility") & !1) | visible as i64;
        self.set_layer_value(layer_id, "LayerVisibility", Value::Integer(value))
    }

    /// Makes a layer a 下描き layer or not (`DraftLayer`: CSP leaves it out of
    /// exports and fills). False (and nothing changed) on a file without the column.
    pub fn set_layer_draft(&mut self, layer_id: i64, draft: bool) -> Result<bool> {
        if !has_column(self.database(), "Layer", "DraftLayer")? {
            return Ok(false);
        }
        self.set_layer_value(layer_id, "DraftLayer", Value::Integer(draft as i64))?;
        Ok(true)
    }

    /// Clips the layer to the layer below, or not (`LayerClip`).
    pub fn set_layer_clipping(&mut self, layer_id: i64, clipping: bool) -> Result<()> {
        self.set_layer_value(layer_id, "LayerClip", Value::Integer(clipping as i64))
    }

    /// Re-render `CanvasPreview` from the layers (call after editing pixels
    /// so file browsers show the new content).
    pub fn update_preview(&mut self) -> Result<bool> {
        let Some((image, _, _)) = render_like_preview(self)? else { return Ok(false) };
        let png = image.to_png()?;
        self.database().execute(
            "UPDATE CanvasPreview SET ImageData = ?1, ImageWidth = ?2, ImageHeight = ?3",
            (png, image.width as i64, image.height as i64),
        )?;
        Ok(true)
    }
}

/// The kinds of layer [`ClipFile`] can add.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewLayer {
    /// A raster (pixel) layer.
    Raster,
    /// A folder.
    Folder,
    /// The paper (用紙) in an RGB colour.
    Paper([u8; 3]),
    /// The root folder (only for new files).
    Root,
}

/// Size of the thumbnail offscreen CSP gives every layer.
const THUMBNAIL_SIZE: u32 = 512;

/// CSP's `LightTableInfo` for a new layer (an empty list).
const LIGHT_TABLE_INFO: [u8; 15] = [1, 1, 1, 8, b't', b'y', b'p', b'e', b'n', b'a', b'm', b'e', 6, 0, 0];

/// The `MonochromeFillInfo` CSP gives the paper.
fn monochrome_fill_info() -> Vec<u8> {
    let name = "MonochromeSetting";
    let mut data = Vec::new();
    data.extend(0u32.to_be_bytes());
    data.extend(1u32.to_be_bytes());
    data.extend((name.len() as u32).to_be_bytes());
    for unit in name.encode_utf16() {
        data.extend(unit.to_be_bytes());
    }
    data.extend([0u8; 12]);
    data.extend(1u32.to_be_bytes());
    let total = data.len() as u32;
    data[..4].copy_from_slice(&total.to_be_bytes());
    data
}

/// A colour channel as CSP stores it in 32-bit columns (the top byte is
/// what readers use).
fn color_word(value: u8) -> i64 {
    value as i64 * 0x0101_0101
}

/// A `LayerUuid`: 32 hex digits grouped 10-4-4-4-10, as CSP writes them.
pub(crate) fn layer_uuid() -> String {
    let hex: String = new_uuid().iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[..10], &hex[10..14], &hex[14..18], &hex[18..22], &hex[22..])
}

/// Sizes of a new layer's mipmap levels: the canvas halved (rounded
/// down) until it fits in 128 pixels, with at least 4 levels.
pub fn mipmap_sizes(width: u32, height: u32) -> Vec<(u32, u32)> {
    let mut sizes = vec![(width.max(1), height.max(1))];
    loop {
        let (w, h) = *sizes.last().expect("one level");
        if sizes.len() >= 4 && w.max(h) <= 128 {
            break;
        }
        sizes.push(((w / 2).max(1), (h / 2).max(1)));
    }
    sizes
}

impl ClipFile {
    /// The next `MainId` for `table`: one above both `ElemScheme.MaxIndex`
    /// and the largest id in the table; `MaxIndex` is moved up to it.
    pub fn next_main_id(&self, table: &str) -> Result<i64> {
        let database = self.database();
        let max_index: Option<i64> = database
            .query_row("SELECT MaxIndex FROM ElemScheme WHERE TableName = ?1", [table], |row| row.get(0))
            .optional()?
            .flatten();
        let largest: i64 =
            database
                .query_row(&format!("SELECT COALESCE(MAX(MainId), 0) FROM {}", quote(table)), [], |row| row.get(0))?;
        let id = max_index.unwrap_or(0).max(largest) + 1;
        database.execute("UPDATE ElemScheme SET MaxIndex = ?1 WHERE TableName = ?2", (id, table))?;
        Ok(id)
    }

    /// Insert a row; columns the table does not have are left out.
    fn insert_row(&self, table: &str, values: &[(&str, Value)]) -> Result<()> {
        let mut names = Vec::new();
        let mut kept = Vec::new();
        for (name, value) in values {
            if has_column(self.database(), table, name)? {
                names.push(quote(name));
                kept.push(value.clone());
            }
        }
        let marks: Vec<String> = (1..=kept.len()).map(|i| format!("?{i}")).collect();
        let sql = format!("INSERT INTO {} ({}) VALUES ({})", quote(table), names.join(", "), marks.join(", "));
        self.database().execute(&sql, rusqlite::params_from_iter(kept))?;
        Ok(())
    }

    /// A colour offscreen of `width × height`. With `store`, its (empty)
    /// block data is saved as a new external chunk; without, it only names one.
    fn new_offscreen(&mut self, layer_id: i64, size: (u32, u32), init: Option<&InitColor>, store: bool) -> Result<i64> {
        let id = self.next_main_id("Offscreen")?;
        let parameter = Parameter::new(PixelKind::Color, size.0, size.1);
        let mut attribute = Attribute::new(&parameter, init);
        let external = new_external_id();
        if store {
            let data = encode(&parameter, Some(&RgbaImage::new(size.0, size.1)), None)?;
            attribute.set_block_sizes(&data.record_sizes());
            self.set_external(&external, data.to_bytes());
        }
        self.insert_row(
            "Offscreen",
            &[
                ("MainId", Value::Integer(id)),
                ("CanvasId", Value::Integer(self.canvas.main_id)),
                ("LayerId", Value::Integer(layer_id)),
                ("Attribute", Value::Blob(attribute.to_bytes())),
                ("BlockData", Value::Blob(external.into_bytes())),
            ],
        )?;
        Ok(id)
    }

    /// A render mipmap for a new layer. Only a raster layer's base level
    /// stores blocks (all empty): CSP reports an empty raster layer whose base
    /// offscreen has no block data as damaged, while folders, paper and the
    /// smaller levels go without.
    pub(crate) fn new_mipmap(&mut self, layer_id: i64, init: Option<&InitColor>, store_base: bool) -> Result<i64> {
        self.new_mipmap_sized(layer_id, (self.canvas.width_px, self.canvas.height_px), init, store_base)
    }

    /// [`ClipFile::new_mipmap`] with a base level of `size` instead of the
    /// canvas size.
    pub(crate) fn new_mipmap_sized(
        &mut self,
        layer_id: i64,
        size: (u32, u32),
        init: Option<&InitColor>,
        store_base: bool,
    ) -> Result<i64> {
        let sizes = mipmap_sizes(size.0, size.1);
        let mipmap = self.next_main_id("Mipmap")?;
        let infos = sizes.iter().map(|_| self.next_main_id("MipmapInfo")).collect::<Result<Vec<_>>>()?;
        for (level, size) in sizes.iter().enumerate() {
            let offscreen = self.new_offscreen(layer_id, *size, init, store_base && level == 0)?;
            self.insert_row(
                "MipmapInfo",
                &[
                    ("MainId", Value::Integer(infos[level])),
                    ("CanvasId", Value::Integer(self.canvas.main_id)),
                    ("LayerId", Value::Integer(layer_id)),
                    ("ThisScale", Value::Real(100.0 / (1u64 << level) as f64)),
                    ("Offscreen", Value::Integer(offscreen)),
                    ("NextIndex", Value::Integer(infos.get(level + 1).copied().unwrap_or(0))),
                ],
            )?;
        }
        self.insert_row(
            "Mipmap",
            &[
                ("MainId", Value::Integer(mipmap)),
                ("CanvasId", Value::Integer(self.canvas.main_id)),
                ("LayerId", Value::Integer(layer_id)),
                ("MipmapCount", Value::Integer(sizes.len() as i64)),
                ("BaseMipmapInfo", Value::Integer(infos[0])),
            ],
        )?;
        Ok(mipmap)
    }

    /// A layer thumbnail that CSP redraws when it opens the file.
    pub(crate) fn new_thumbnail(&mut self, layer_id: i64) -> Result<i64> {
        let id = self.next_main_id("LayerThumbnail")?;
        let offscreen = self.new_offscreen(layer_id, (THUMBNAIL_SIZE, THUMBNAIL_SIZE), None, true)?;
        let int = Value::Integer;
        let mut values = vec![("MainId", int(id)), ("CanvasId", int(self.canvas.main_id)), ("LayerId", int(layer_id))];
        for column in [
            "ThumbnailSmallerNeedRefresh",
            "ThumbnailSmallNeedRefresh",
            "ThumbnailMiddleNeedRefresh",
            "ThumbnailLargeNeedRefresh",
            "ThumbnailLargerNeedRefresh",
            "ThumbnailMiddle2xNeedRefresh",
            "ThumbnailLarger2xNeedRefresh",
            "ThumbnailSmallerNeedRefresh1",
            "ThumbnailSmallNeedRefresh1",
            "ThumbnailMiddleNeedRefresh1",
            "ThumbnailLargeNeedRefresh1",
            "ThumbnailLargerNeedRefresh1",
            "ThumbnailMiddle2xNeedRefresh1",
            "ThumbnailLarger2xNeedRefresh1",
        ] {
            values.push((column, int(5)));
        }
        values.extend([
            ("ThumbnailDrewMode", int(0)),
            ("ThumbnailFixMode", int(-1)),
            ("ThumbnailCanvasWidth", int(self.canvas.width_px as i64)),
            ("ThumbnailCanvasHeight", int(self.canvas.height_px as i64)),
            ("ThumbnailUseDrawColor", int(0)),
            ("ThumbnailMainColorRed", int(0)),
            ("ThumbnailMainColorGreen", int(0)),
            ("ThumbnailMainColorBlue", int(0)),
            ("ThumbnailSubColorRed", int(0)),
            ("ThumbnailSubColorGreen", int(0)),
            ("ThumbnailSubColorBlue", int(0)),
            ("ThumbnailOffscreen", int(offscreen)),
            ("ThumbnailColorTypeIndex", int(0)),
            ("ThumbnailColorTypeBlack", int(1)),
            ("ThumbnailColorTypeWhite", int(1)),
            ("ThumbnailPrewviewColorTypeIndex", int(0)),
            ("ThumbnailPrewviewColorTypeBlack", int(1)),
            ("ThumbnailPrewviewColorTypeWhite", int(1)),
            ("ThumbnailPrewviewColorTypeOpacity", int(1)),
            ("ThumbnailPrewviewColorTypeImage", int(0x8000_0000)),
            ("ThumbnailPrewviewColorTypeAlpha", int(0x8000_0000)),
            ("ThumbnailPrewviewMaskBinarize", int(0)),
            ("ThumbnailPrewviewMaskThreshold", int(0x8000_0000)),
            ("ThumbnailDrewUseCanvasAspect0", int(1)),
            ("ThumbnailDrewUseCanvasAspect1", int(1)),
        ]);
        self.insert_row("LayerThumbnail", &values)?;
        Ok(id)
    }

    /// Add a layer on top of the children of folder `parent` and return
    /// its id. Raster layers start empty (see [`ClipFile::set_layer_pixels`]).
    pub fn add_layer(&mut self, parent: i64, kind: NewLayer, name: &str) -> Result<i64> {
        let id = self.next_main_id("Layer")?;
        self.insert_layer_row(id, kind, name)?;
        if kind != NewLayer::Root {
            self.link_on_top(parent, id)?;
        }
        if kind == NewLayer::Raster {
            self.database().execute("UPDATE Canvas SET CanvasCurrentLayer = ?1", [id])?;
        }
        self.reload()?;
        Ok(id)
    }

    /// Add a raster layer on top of the root folder's children holding
    /// `image` with its top-left at canvas position `position`.
    pub fn add_raster_layer(&mut self, name: &str, image: &RgbaImage, position: (i64, i64)) -> Result<i64> {
        let id = self.add_layer(self.canvas.root_folder, NewLayer::Raster, name)?;
        self.set_layer_pixels(id, image, position)?;
        Ok(id)
    }

    pub(crate) fn insert_layer_row(&mut self, id: i64, kind: NewLayer, name: &str) -> Result<()> {
        let paper_init = InitColor { do_initialize: true, alpha: 0xffff_ffff, image_values: vec![0; 4] };
        let init = matches!(kind, NewLayer::Paper(_)).then_some(&paper_init);
        let mipmap = self.new_mipmap(id, init, kind == NewLayer::Raster)?;
        let thumbnail = self.new_thumbnail(id)?;
        let int = Value::Integer;
        let (layer_type, folder, masking) = match kind {
            NewLayer::Raster => (LAYER_TYPE_RASTER, 0, 0),
            NewLayer::Folder => (0, 1, 32),
            NewLayer::Paper(_) => (LAYER_TYPE_PAPER, 0, 0),
            NewLayer::Root => (LAYER_TYPE_ROOT, 1, 32),
        };
        let mut values = vec![
            ("MainId", int(id)),
            ("CanvasId", int(self.canvas.main_id)),
            ("LayerName", Value::Text(name.to_owned())),
            ("LayerType", int(layer_type)),
            ("LayerLock", int(0)),
            ("LayerClip", int(0)),
            ("LayerMasking", int(masking)),
        ];
        for column in [
            "LayerOffsetX",
            "LayerOffsetY",
            "LayerRenderOffscrOffsetX",
            "LayerRenderOffscrOffsetY",
            "LayerMaskOffsetX",
            "LayerMaskOffsetY",
            "LayerMaskOffscrOffsetX",
            "LayerMaskOffscrOffsetY",
        ] {
            values.push((column, int(0)));
        }
        values.extend([
            ("LayerOpacity", int(crate::model::OPACITY_FULL)),
            ("LayerComposite", int(0)),
            ("LayerUsePaletteColor", int(0)),
            ("LayerNoticeablePaletteColor", int(0)),
            ("LayerPaletteRed", int(0)),
            ("LayerPaletteGreen", int(0)),
            ("LayerPaletteBlue", int(0)),
            ("LayerFolder", int(folder)),
            ("LayerVisibility", int(1)),
            ("LayerSelect", int(0)),
            ("LayerNextIndex", int(0)),
            ("LayerFirstChildIndex", int(0)),
            ("LayerUuid", Value::Text(layer_uuid())),
            ("LayerRenderMipmap", int(mipmap)),
            ("LayerLayerMaskMipmap", int(0)),
            ("LayerRenderThumbnail", int(thumbnail)),
            ("LayerLayerMaskThumbnail", int(0)),
        ]);
        if kind != NewLayer::Root {
            values.push(("LightTableInfo", Value::Blob(LIGHT_TABLE_INFO.to_vec())));
        }
        if kind == NewLayer::Raster {
            values.extend([
                ("LayerColorTypeIndex", int(0)),
                ("LayerColorTypeBlackChecked", int(1)),
                ("LayerColorTypeWhiteChecked", int(1)),
            ]);
        }
        if let NewLayer::Paper(color) = kind {
            values.extend([
                ("DrawColorMainRed", int(color_word(color[0]))),
                ("DrawColorMainGreen", int(color_word(color[1]))),
                ("DrawColorMainBlue", int(color_word(color[2]))),
                ("DrawColorEnable", int(1)),
                ("DrawToRenderOffscreenType", int(61)),
                ("SpecialRenderType", int(20)),
                ("DrawToRenderMipmapType", int(31)),
                ("MoveOffsetAndExpandType", int(31)),
                ("FixOffsetAndExpandType", int(31)),
                ("RenderBoundForLayerMoveType", int(31)),
                ("SetRenderThumbnailInfoType", int(31)),
                ("DrawRenderThumbnailType", int(31)),
                ("MonochromeFillInfo", Value::Blob(monochrome_fill_info())),
            ]);
        }
        self.insert_row("Layer", &values)
    }

    /// Make `id` the last (top) child of `parent`.
    pub(crate) fn link_on_top(&mut self, parent: i64, id: i64) -> Result<()> {
        let database = self.database();
        let first: i64 = database
            .query_row("SELECT LayerFirstChildIndex FROM Layer WHERE MainId = ?1", [parent], |row| row.get(0))
            .optional()?
            .ok_or_else(|| Error::format(format!("No layer {parent}")))?;
        if first == 0 {
            database.execute("UPDATE Layer SET LayerFirstChildIndex = ?1 WHERE MainId = ?2", (id, parent))?;
            return Ok(());
        }
        let mut last = first;
        loop {
            let next: i64 =
                database.query_row("SELECT LayerNextIndex FROM Layer WHERE MainId = ?1", [last], |row| row.get(0))?;
            if next == 0 || next == id {
                break;
            }
            last = next;
        }
        database.execute("UPDATE Layer SET LayerNextIndex = ?1 WHERE MainId = ?2", (id, last))?;
        Ok(())
    }

    /// The layers in folder `folder`, bottom first, as the file holds them
    /// now (also between edits that have not reloaded the typed view).
    pub fn layer_children(&self, folder: i64) -> Result<Vec<i64>> {
        let database = self.database();
        let link = |column: &str, id: i64| -> Result<i64> {
            let sql = format!("SELECT {} FROM Layer WHERE MainId = ?1", quote(column));
            let value: Option<Option<i64>> = database.query_row(&sql, [id], |row| row.get(0)).optional()?;
            Ok(value.flatten().unwrap_or(0))
        };
        let mut children = Vec::new();
        let mut child = link("LayerFirstChildIndex", folder)?;
        while child != 0 && !children.contains(&child) {
            children.push(child);
            child = link("LayerNextIndex", child)?;
        }
        Ok(children)
    }

    /// The folder layer `layer_id` is in; the root folder for a layer in no folder.
    pub fn layer_parent(&self, layer_id: i64) -> Result<i64> {
        let folders: Vec<i64> = {
            let mut statement = self.database().prepare(
                "SELECT MainId FROM Layer WHERE LayerFirstChildIndex IS NOT NULL AND LayerFirstChildIndex != 0",
            )?;
            statement.query_map([], |row| row.get(0))?.collect::<std::result::Result<_, _>>()?
        };
        for folder in folders {
            if self.layer_children(folder)?.contains(&layer_id) {
                return Ok(folder);
            }
        }
        Ok(self.canvas.root_folder)
    }

    /// Move layer `layer_id` (with what is in it) into folder `folder`: right
    /// below its child `below`, or on top when `below` is None or not there.
    pub fn move_layer(&mut self, layer_id: i64, folder: i64, below: Option<i64>) -> Result<()> {
        if layer_id == folder || layer_id == self.canvas.root_folder {
            bail!("Layer {layer_id} cannot go into {folder}");
        }
        let old = self.layer_parent(layer_id)?;
        let mut old_siblings = self.layer_children(old)?;
        if old_siblings.contains(&layer_id) {
            old_siblings.retain(|id| *id != layer_id);
            self.relink(old, &old_siblings)?;
        }
        let mut siblings = self.layer_children(folder)?;
        let position = below.and_then(|below| siblings.iter().position(|id| *id == below)).unwrap_or(siblings.len());
        siblings.insert(position, layer_id);
        self.relink(folder, &siblings)?;
        self.reload()
    }

    /// Link `children` (bottom first) as the whole content of `folder`.
    fn relink(&self, folder: i64, children: &[i64]) -> Result<()> {
        let database = self.database();
        database.execute(
            "UPDATE Layer SET LayerFirstChildIndex = ?1 WHERE MainId = ?2",
            (children.first().copied().unwrap_or(0), folder),
        )?;
        for (index, child) in children.iter().enumerate() {
            let next = children.get(index + 1).copied().unwrap_or(0);
            database.execute("UPDATE Layer SET LayerNextIndex = ?1 WHERE MainId = ?2", (next, child))?;
        }
        Ok(())
    }

    /// Give every layer that has a `LayerUuid` a new one. CSP gives each page
    /// file its own; pages written from one template would otherwise share
    /// them (with [`ClipFile::renew_file_id`] for the file's own id).
    pub fn renew_layer_uuids(&mut self) -> Result<()> {
        if !has_column(self.database(), "Layer", "LayerUuid")? {
            return Ok(());
        }
        let ids: Vec<i64> = {
            let mut statement = self.database().prepare("SELECT MainId FROM Layer WHERE LayerUuid IS NOT NULL")?;
            statement.query_map([], |row| row.get(0))?.collect::<std::result::Result<_, _>>()?
        };
        for id in ids {
            self.database().execute("UPDATE Layer SET LayerUuid = ?1 WHERE MainId = ?2", (layer_uuid(), id))?;
        }
        self.reload()
    }

    /// One `Canvas` column; None when the canvas has no such column.
    pub fn canvas_value(&self, column: &str) -> Result<Option<Value>> {
        crate::story::canvas_value(self.database(), column)
    }

    /// Set one `Canvas` column. False (and nothing changed) when the canvas
    /// has no such column, as older files lack some.
    pub fn set_canvas_value(&mut self, column: &str, value: Value) -> Result<bool> {
        if !has_column(self.database(), "Canvas", column)? {
            return Ok(false);
        }
        self.database().execute(&format!("UPDATE Canvas SET {} = ?1", quote(column)), [value])?;
        self.reload()?;
        Ok(true)
    }

    /// Remove a layer (a folder with everything in it): its rows, mipmaps,
    /// thumbnails, offscreens and their external chunks. The root folder
    /// cannot be removed.
    pub fn remove_layer(&mut self, layer_id: i64) -> Result<()> {
        let layer = self.layers.get(layer_id).ok_or_else(|| Error::format(format!("No layer {layer_id}")))?.clone();
        if layer.kind == LayerKind::Root {
            bail!("The root folder cannot be removed");
        }
        // Unlink: whoever points at the layer points past it.
        let next = layer.next;
        let database = self.database();
        database
            .execute("UPDATE Layer SET LayerFirstChildIndex = ?1 WHERE LayerFirstChildIndex = ?2", (next, layer_id))?;
        database.execute("UPDATE Layer SET LayerNextIndex = ?1 WHERE LayerNextIndex = ?2", (next, layer_id))?;
        let mut doomed = vec![layer_id];
        let mut child = layer.first_child;
        let mut stack = Vec::new();
        while child != 0 || !stack.is_empty() {
            if child == 0 {
                child = stack.pop().unwrap_or(0);
                continue;
            }
            doomed.push(child);
            let (first, next): (i64, i64) = database.query_row(
                "SELECT LayerFirstChildIndex, LayerNextIndex FROM Layer WHERE MainId = ?1",
                [child],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            stack.push(next);
            child = first;
        }
        for id in doomed {
            let mut externals = Vec::new();
            {
                let mut statement = self.database().prepare("SELECT BlockData FROM Offscreen WHERE LayerId = ?1")?;
                let rows = statement.query_map([id], |row| row.get::<_, Value>(0))?;
                for value in rows {
                    if let Some(text) = value_as_text(&value?) {
                        externals.push(text);
                    }
                }
            }
            for external in externals {
                self.remove_external(&external);
            }
            for table in ["Offscreen", "MipmapInfo", "Mipmap", "LayerThumbnail"] {
                if crate::database::has_table(self.database(), table)? {
                    self.database().execute(&format!("DELETE FROM {} WHERE LayerId = ?1", quote(table)), [id])?;
                }
            }
            self.database().execute("DELETE FROM Layer WHERE MainId = ?1", [id])?;
        }
        let current: i64 = self.database().query_row("SELECT CanvasCurrentLayer FROM Canvas", [], |row| row.get(0))?;
        if self
            .database()
            .query_row("SELECT COUNT(*) FROM Layer WHERE MainId = ?1", [current], |row| row.get::<_, i64>(0))?
            == 0
        {
            self.database().execute("UPDATE Canvas SET CanvasCurrentLayer = 0", [])?;
        }
        self.reload()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names_in(file: &ClipFile, folder: i64) -> Vec<String> {
        file.layer_children(folder).unwrap().iter().map(|id| file.layers.get(*id).unwrap().name.clone()).collect()
    }

    #[test]
    fn layers_move_between_folders_and_keep_the_order_asked_for() {
        let mut file = ClipFile::create(&crate::NewCanvas { width: 8, height: 8, ..Default::default() }).unwrap();
        let root = file.canvas.root_folder;
        let folder = file.add_layer(root, NewLayer::Folder, "folder").unwrap();
        let a = file.add_layer(root, NewLayer::Raster, "a").unwrap();
        let b = file.add_layer(root, NewLayer::Raster, "b").unwrap();
        let before = names_in(&file, root);
        assert_eq!(before[before.len() - 3..], ["folder", "a", "b"]);

        file.move_layer(a, folder, None).unwrap();
        file.move_layer(b, folder, Some(a)).unwrap();
        assert_eq!(names_in(&file, folder), ["b", "a"]);
        assert_eq!(file.layer_parent(b).unwrap(), folder);
        assert_eq!(*names_in(&file, root).last().unwrap(), "folder");
        // Out again, on top of the root's children.
        file.move_layer(b, root, None).unwrap();
        assert_eq!(names_in(&file, folder), ["a"]);
        assert_eq!(file.layer_parent(b).unwrap(), root);
        assert_eq!(*names_in(&file, root).last().unwrap(), "b");
        assert!(file.move_layer(folder, folder, None).is_err());

        let file = ClipFile::from_bytes(file.to_bytes().unwrap()).unwrap();
        assert_eq!(names_in(&file, folder), ["a"]);
        let report = crate::verify::check_clip(file.to_bytes().unwrap(), Default::default());
        assert!(report.ok(), "{:?}", report.errors);
    }

    #[test]
    fn every_layer_gets_a_new_uuid() {
        let mut file = ClipFile::create(&crate::NewCanvas { width: 8, height: 8, ..Default::default() }).unwrap();
        file.add_layer(file.canvas.root_folder, NewLayer::Raster, "a").unwrap();
        let uuids =
            |file: &ClipFile| file.layers.layers.iter().filter_map(|layer| layer.uuid.clone()).collect::<Vec<_>>();
        let before = uuids(&file);
        assert!(before.len() >= 2);
        file.renew_layer_uuids().unwrap();
        let after = uuids(&file);
        assert_eq!(after.len(), before.len());
        assert!(after.iter().all(|uuid| !before.contains(uuid) && uuid.len() == 36), "{after:?}");
    }

    #[test]
    fn a_layer_becomes_a_draft_layer() {
        let mut file = ClipFile::create(&crate::NewCanvas { width: 8, height: 8, ..Default::default() }).unwrap();
        let id = file.add_layer(file.canvas.root_folder, NewLayer::Raster, "a").unwrap();
        let draft = |file: &ClipFile| file.layers.get(id).unwrap().row.int("DraftLayer");
        assert!(file.set_layer_draft(id, true).unwrap());
        assert_eq!(draft(&file), 1);
        file.set_layer_draft(id, false).unwrap();
        assert_eq!(draft(&file), 0);
        // A file from before 下描き layers has no column: nothing to set.
        let mut old = ClipFile::create(&crate::NewCanvas { width: 8, height: 8, ..Default::default() }).unwrap();
        old.database().execute_batch("ALTER TABLE Layer DROP COLUMN DraftLayer").unwrap();
        assert!(!old.set_layer_draft(id, true).unwrap());
    }

    #[test]
    fn canvas_values_are_set_only_where_the_canvas_has_the_column() {
        let mut file = ClipFile::create(&crate::NewCanvas { width: 8, height: 8, ..Default::default() }).unwrap();
        assert!(file.set_canvas_value("CanvasResolution", Value::Real(600.0)).unwrap());
        assert_eq!(file.canvas_value("CanvasResolution").unwrap(), Some(Value::Real(600.0)));
        assert!(!file.set_canvas_value("NoSuchColumn", Value::Integer(1)).unwrap());
        assert_eq!(file.canvas_value("NoSuchColumn").unwrap(), None);
    }

    #[test]
    fn external_ids_have_csp_shape() {
        let id = new_external_id();
        assert!(crate::container::is_external_id(&id), "{id}");
        assert_ne!(id, new_external_id());
    }
}
