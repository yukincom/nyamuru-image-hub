//! A .clip file: container + database + external chunks, with typed access
//! and lossless saving.
//!
//! Saving keeps everything that was not changed: when neither the database
//! nor any external chunk was touched, the saved bytes equal the input.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;

use crate::container::{Container, ContainerWriter, FILE_ID_LENGTH};
use crate::database::{self, Row, select, select_all, value_as_text};
use crate::error::{Error, Result, bail};
use crate::image::{GrayImage, RgbaImage, decode_png};
use crate::model::{Canvas, Layer, LayerTree, Project};
use crate::offscreen::Offscreen;
use crate::schema::Schema;

/// One level of a mipmap chain.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MipmapLevel {
    /// `MainId` of the `MipmapInfo` row.
    pub info_id: i64,
    /// `ThisScale` in percent (100, 50, 25, …).
    pub scale: f64,
    /// `MainId` of the `Offscreen` row holding the pixels of this level.
    pub offscreen: i64,
}

/// A `Mipmap` row and its `MipmapInfo` levels (`BaseMipmapInfo` → `NextIndex`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Mipmap {
    /// `MainId` of the `Mipmap` row.
    pub main_id: i64,
    /// The layer the mipmap belongs to (`LayerId`).
    pub layer_id: i64,
    /// Number of levels CSP stored (`MipmapCount`).
    pub count: i64,
    /// The levels, largest first.
    pub levels: Vec<MipmapLevel>,
}

#[derive(Debug, Clone)]
enum External {
    /// Payload range in the original container.
    Original(std::ops::Range<usize>),
    New(Vec<u8>),
}

/// An opened .clip file.
///
/// ```no_run
/// use csp_format::ClipFile;
///
/// let mut file = ClipFile::open("page0001.clip")?;
/// println!("{} x {} px", file.canvas.width_px, file.canvas.height_px);
/// for (layer, depth) in file.layers.flatten() {
///     println!("{}{} ({})", "  ".repeat(depth), layer.name, layer.kind.name());
/// }
/// // Arbitrary columns are in the embedded SQLite database.
/// let rows = csp_format::database::select_all(file.database(), "Layer")?;
/// assert_eq!(rows.len(), file.layers.layers.len());
/// file.reload()?;
/// file.save("copy.clip")?; // byte-identical while nothing was changed
/// # Ok::<(), csp_format::Error>(())
/// ```
pub struct ClipFile {
    container: Container,
    database: Connection,
    changes_at_open: u64,
    externals: Vec<(String, External)>,
    externals_changed: bool,
    /// Replaces the container's file id on save (see [`ClipFile::set_file_id`]).
    file_id: Option<[u8; FILE_ID_LENGTH]>,
    /// The `Project` row.
    pub project: Project,
    /// The canvas settings.
    pub canvas: Canvas,
    /// The layer tree, read at open (call [`ClipFile::reload`] after changing `Layer` rows).
    pub layers: LayerTree,
}

impl ClipFile {
    /// Reads and parses a file. The file is not kept open or changed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::from_container(Container::read(path)?)
    }

    /// Parses the bytes of a .clip.
    pub fn from_bytes(data: Vec<u8>) -> Result<Self> {
        Self::from_container(Container::parse(data)?)
    }

    /// Opens the database of a parsed container and reads the typed views.
    pub fn from_container(container: Container) -> Result<Self> {
        let database = database::open_bytes(container.sqlite()?)?;
        let changes_at_open = database.total_changes();
        let externals = container
            .external_chunks()
            .map(|chunk| {
                (
                    chunk.external_id.clone().unwrap_or_default(),
                    External::Original(chunk.payload_offset..chunk.body.end),
                )
            })
            .collect();
        let project = select_all(&database, "Project")?
            .into_iter()
            .next()
            .map(Project::from_row)
            .ok_or_else(|| Error::format("No Project row"))?;
        let canvas = select_all(&database, "Canvas")?
            .into_iter()
            .next()
            .map(Canvas::from_row)
            .ok_or_else(|| Error::format("No Canvas row"))?;
        let layers = LayerTree::read(&database, canvas.root_folder)?;
        Ok(ClipFile {
            container,
            database,
            changes_at_open,
            externals,
            externals_changed: false,
            file_id: None,
            project,
            canvas,
            layers,
        })
    }

    /// The parsed container (chunks of the file as opened).
    pub fn container(&self) -> &Container {
        &self.container
    }

    /// The embedded database (in memory; changes are saved by [`ClipFile::to_bytes`]).
    pub fn database(&self) -> &Connection {
        &self.database
    }

    /// The parameter scheme registry (`ParamScheme` / `ElemScheme`).
    pub fn schema(&self) -> Result<Schema> {
        Schema::read(&self.database)
    }

    /// Which CSP generation saved the file (see [`crate::version`]).
    pub fn version_info(&self) -> Result<crate::VersionInfo> {
        crate::VersionInfo::read(&self.database, self.container.sqlite().ok())
    }

    /// Re-read the typed views after changing the database.
    pub fn reload(&mut self) -> Result<()> {
        self.project = select_all(&self.database, "Project")?
            .into_iter()
            .next()
            .map(Project::from_row)
            .ok_or_else(|| Error::format("No Project row"))?;
        self.canvas = select_all(&self.database, "Canvas")?
            .into_iter()
            .next()
            .map(Canvas::from_row)
            .ok_or_else(|| Error::format("No Canvas row"))?;
        self.layers = LayerTree::read(&self.database, self.canvas.root_folder)?;
        Ok(())
    }

    /// Payload of an external chunk, None when the id is not stored.
    pub fn external(&self, id: &str) -> Option<&[u8]> {
        self.externals.iter().find(|(key, _)| key == id).map(|(_, data)| match data {
            External::Original(range) => &self.container.bytes()[range.clone()],
            External::New(bytes) => bytes.as_slice(),
        })
    }

    /// Ids of the external chunks, in file order.
    pub fn external_ids(&self) -> impl Iterator<Item = &str> {
        self.externals.iter().map(|(id, _)| id.as_str())
    }

    /// Store (or replace) an external chunk's payload.
    pub fn set_external(&mut self, id: &str, payload: Vec<u8>) {
        self.externals_changed = true;
        match self.externals.iter_mut().find(|(key, _)| key == id) {
            Some(entry) => entry.1 = External::New(payload),
            None => self.externals.push((id.to_owned(), External::New(payload))),
        }
    }

    /// Removes an external chunk. Returns whether it was there.
    pub fn remove_external(&mut self, id: &str) -> bool {
        let before = self.externals.len();
        self.externals.retain(|(key, _)| key != id);
        let removed = self.externals.len() != before;
        self.externals_changed |= removed;
        removed
    }

    /// One row by `MainId`.
    pub fn row(&self, table: &str, main_id: i64) -> Result<Option<Row>> {
        let sql = format!("SELECT * FROM {} WHERE MainId = ?1", database::quote(table));
        Ok(select(&self.database, &sql, [main_id])?.into_iter().next())
    }

    /// A mipmap and its levels.
    pub fn mipmap(&self, main_id: i64) -> Result<Option<Mipmap>> {
        let Some(row) = self.row("Mipmap", main_id)? else { return Ok(None) };
        let mut levels = Vec::new();
        let mut next = row.int("BaseMipmapInfo");
        while next != 0 {
            if levels.len() > 64 {
                bail!("Mipmap {main_id} has a looping level list");
            }
            let info = self
                .row("MipmapInfo", next)?
                .ok_or_else(|| Error::format(format!("MipmapInfo {next} does not exist")))?;
            levels.push(MipmapLevel { info_id: next, scale: info.real("ThisScale"), offscreen: info.int("Offscreen") });
            next = info.int("NextIndex");
        }
        Ok(Some(Mipmap { main_id, layer_id: row.int("LayerId"), count: row.int("MipmapCount"), levels }))
    }

    /// Parse an `Offscreen` row and its block data (if stored).
    pub fn offscreen(&self, main_id: i64) -> Result<Option<Offscreen>> {
        let Some(row) = self.row("Offscreen", main_id)? else { return Ok(None) };
        let attribute =
            row.blob("Attribute").ok_or_else(|| Error::format(format!("Offscreen {main_id} has no Attribute")))?;
        let payload = row.get("BlockData").and_then(value_as_text).and_then(|id| self.external(&id));
        Offscreen::parse(attribute, payload).map(Some)
    }

    /// The full-size offscreen of a mipmap (its first level).
    pub fn mipmap_base(&self, mipmap_id: i64) -> Result<Option<Offscreen>> {
        let Some(mipmap) = self.mipmap(mipmap_id)? else { return Ok(None) };
        match mipmap.levels.first() {
            Some(level) => self.offscreen(level.offscreen),
            None => Ok(None),
        }
    }

    /// The stored pixels of a layer and where their top-left lies on the
    /// canvas. None when the layer stores no pixels (CSP renders vector,
    /// text and similar layers itself when opening the file).
    pub fn layer_pixels(&self, layer: &Layer) -> Result<Option<(RgbaImage, (i64, i64))>> {
        if layer.render_mipmap == 0 {
            return Ok(None);
        }
        let Some(offscreen) = self.mipmap_base(layer.render_mipmap)? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        Ok(Some((offscreen.to_rgba()?, layer.pixel_origin())))
    }

    /// The layer's pixels inside the canvas box `(x0, y0, x1, y1)`,
    /// transparent where none are stored. Only the blocks the box overlaps
    /// are decoded.
    pub fn layer_pixels_in_box(&self, layer: &Layer, region: (i64, i64, i64, i64)) -> Result<RgbaImage> {
        let (x0, y0, x1, y1) = region;
        let base = if layer.render_mipmap == 0 { None } else { self.mipmap_base(layer.render_mipmap)? };
        match base {
            Some(offscreen) => {
                let (ox, oy) = layer.pixel_origin();
                offscreen.to_rgba_region((x0 - ox, y0 - oy, x1 - ox, y1 - oy))
            }
            None => Ok(RgbaImage::new((x1 - x0).max(0) as u32, (y1 - y0).max(0) as u32)),
        }
    }

    /// Canvas boxes `(x0, y0, x1, y1)` of the 256-pixel blocks of the layer
    /// that store data, found without decompressing anything.
    pub fn stored_pixel_boxes(&self, layer: &Layer) -> Result<Vec<(i64, i64, i64, i64)>> {
        if layer.render_mipmap == 0 {
            return Ok(Vec::new());
        }
        let Some(offscreen) = self.mipmap_base(layer.render_mipmap)? else { return Ok(Vec::new()) };
        let (ox, oy) = layer.pixel_origin();
        Ok(offscreen
            .stored_boxes()
            .into_iter()
            .map(|(x0, y0, x1, y1)| (x0 as i64 + ox, y0 as i64 + oy, x1 as i64 + ox, y1 as i64 + oy))
            .collect())
    }

    /// The layer mask (0 = hidden, 255 = shown) and its canvas position.
    pub fn layer_mask(&self, layer: &Layer) -> Result<Option<(GrayImage, (i64, i64))>> {
        if layer.mask_mipmap == 0 {
            return Ok(None);
        }
        let Some(offscreen) = self.mipmap_base(layer.mask_mipmap)? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        Ok(Some((offscreen.to_alpha()?, layer.mask_origin())))
    }

    /// The layer palette thumbnail (`Layer.LayerRenderThumbnail` →
    /// `LayerThumbnail.ThumbnailOffscreen`). None when there is none or it
    /// stores no pixels.
    pub fn layer_thumbnail(&self, layer: &Layer) -> Result<Option<RgbaImage>> {
        let id = layer.row.int("LayerRenderThumbnail");
        if id == 0 {
            return Ok(None);
        }
        let Some(row) = self.row("LayerThumbnail", id)? else { return Ok(None) };
        let Some(offscreen) = self.offscreen(row.int("ThumbnailOffscreen"))? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        offscreen.to_rgba().map(Some)
    }

    /// The preview CSP saved with the file (`CanvasPreview`, a PNG).
    pub fn preview(&self) -> Result<Option<RgbaImage>> {
        let rows = select_all(&self.database, "CanvasPreview")?;
        let Some(row) = rows.first() else { return Ok(None) };
        let Some(data) = row.blob("ImageData") else { return Ok(None) };
        decode_png(data).map(Some)
    }

    /// Every external chunk id referenced from the database (table, column, id).
    pub fn external_references(&self) -> Result<Vec<(String, String, String)>> {
        let schema = self.schema()?;
        let mut result = Vec::new();
        for (table, column) in &schema.external_columns {
            if !database::table_exists(&self.database, table)? || !database::has_column(&self.database, table, column)?
            {
                continue;
            }
            let sql = format!("SELECT {} FROM {}", database::quote(column), database::quote(table));
            for row in select(&self.database, &sql, [])? {
                if let Some(id) = row.values().first().and_then(value_as_text) {
                    result.push((table.clone(), column.clone(), id));
                }
            }
        }
        Ok(result)
    }

    /// The 16-byte file id in the `Head` chunk.
    pub fn file_id(&self) -> [u8; FILE_ID_LENGTH] {
        self.file_id.unwrap_or_else(|| {
            self.container
                .head
                .as_ref()
                .and_then(|head| head.file_id.as_slice().try_into().ok())
                .unwrap_or([0; FILE_ID_LENGTH])
        })
    }

    /// Give the saved file another id. CSP gives every "Save As" copy a new
    /// id and treats files with the same id as the same document: a copy
    /// opened while the original is open shows the original's cached
    /// canvas until something is redrawn. Edited copies should get a new id.
    pub fn set_file_id(&mut self, id: [u8; FILE_ID_LENGTH]) {
        self.file_id = Some(id);
    }

    /// Whether anything was changed since the file was opened.
    pub fn is_modified(&self) -> bool {
        self.externals_changed
            || self
                .file_id
                .is_some_and(|id| Some(id.as_slice()) != self.container.head.as_ref().map(|h| h.file_id.as_slice()))
            || self.database.total_changes() != self.changes_at_open
    }

    /// The file's bytes. Unchanged files are returned as read.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        if !self.is_modified() {
            return Ok(self.container.bytes().to_vec());
        }
        let mut writer = ContainerWriter::new(self.file_id());
        for (id, data) in &self.externals {
            let payload = match data {
                External::Original(range) => &self.container.bytes()[range.clone()],
                External::New(bytes) => bytes.as_slice(),
            };
            writer.push_external(id.clone(), payload);
        }
        let offsets: HashMap<String, u64> = writer.external_offsets().into_iter().collect();
        // Offsets are written into a copy so that `self` stays unchanged.
        let image = database::serialize(&self.database)?;
        let copy = database::open_bytes(&image)?;
        update_external_index(&copy, &offsets)?;
        writer.assemble(&database::serialize(&copy)?)
    }

    /// Writes [`ClipFile::to_bytes`] to a file.
    ///
    /// `path` is replaced if it exists, and nothing checks whether it is
    /// the file this was read from. Saving over the source is possible (its
    /// bytes were read into memory), but a failed or interrupted write then
    /// loses the original; keeping inputs intact is the caller's job. The
    /// `cspf` tool refuses an output that is one of its inputs.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let bytes = self.to_bytes()?;
        std::fs::write(path, bytes)?;
        Ok(())
    }
}

/// Make `ExternalChunk` list exactly the given ids with their offsets.
fn update_external_index(database: &Connection, offsets: &HashMap<String, u64>) -> Result<()> {
    let rows = select_all(database, "ExternalChunk")?;
    let mut present = std::collections::HashSet::new();
    for row in &rows {
        let Some(id) = row.get("ExternalID").and_then(value_as_text) else { continue };
        let raw = row.get("ExternalID").cloned().unwrap_or(rusqlite::types::Value::Null);
        match offsets.get(&id) {
            Some(offset) => {
                if row.int("Offset") != *offset as i64 {
                    database.execute(
                        "UPDATE ExternalChunk SET Offset = ?1 WHERE ExternalID = ?2",
                        (*offset as i64, &raw),
                    )?;
                }
                present.insert(id);
            }
            None => {
                database.execute("DELETE FROM ExternalChunk WHERE ExternalID = ?1", [&raw])?;
            }
        }
    }
    let mut missing: Vec<(&String, &u64)> = offsets.iter().filter(|(id, _)| !present.contains(*id)).collect();
    missing.sort_by_key(|(_, offset)| **offset);
    // CSP stores ExternalID as TEXT (the column is declared BLOB) and looks
    // chunks up by text, so a BLOB id is never found: the layer then loads
    // as "broken".
    for (id, offset) in missing {
        database
            .execute("INSERT INTO ExternalChunk(ExternalID, Offset) VALUES (?1, ?2)", (id.as_str(), *offset as i64))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_external_ids_are_indexed_as_text() {
        let database = Connection::open_in_memory().unwrap();
        database.execute("CREATE TABLE ExternalChunk(ExternalID BLOB, Offset INTEGER)", []).unwrap();
        database.execute("INSERT INTO ExternalChunk VALUES ('extrnlidOLD', 10), ('extrnlidGONE', 20)", []).unwrap();
        let offsets = HashMap::from([("extrnlidOLD".to_owned(), 30), ("extrnlidNEW".to_owned(), 40)]);
        update_external_index(&database, &offsets).unwrap();
        let rows: Vec<(String, String, i64)> = database
            .prepare("SELECT ExternalID, typeof(ExternalID), Offset FROM ExternalChunk ORDER BY Offset")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(rows, [("extrnlidOLD".into(), "text".into(), 30), ("extrnlidNEW".into(), "text".into(), 40)]);
    }
}
