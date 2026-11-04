//! Copying layers from another .clip (from name-studio's clip-core).
//!
//! A layer is copied with the rows its row links to, following the id links
//! `ParamScheme` lists (`LinkTable`, for example Layer → VectorObjectList),
//! as CSP itself links them. Every copied row gets a new `MainId` (see
//! [`ClipFile::next_main_id`]), columns owned by the canvas or the layer
//! (`OwnerType` 2 and 4) get the target's ids, and external chunks (vector
//! data) are copied under new ids.
//!
//! The target file may lack the tables and columns the copied rows use (CSP
//! creates `VectorObjectList` only when a file first has a vector layer):
//! [`merge_schema`] and [`merge_columns`] add them with their `ParamScheme`
//! and `ElemScheme` rows. Vector objects name their brush by
//! `BrushStyle.MainId`, so brush styles are copied keeping their ids
//! ([`share_rows`]) when the target has none, together with the rows brush
//! styles link to (tip and texture images, spray shapes, effector graphs):
//! CSP crashes on opening a file whose brush style names a texture that is
//! not there.

use std::collections::{HashMap, HashSet};

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params_from_iter};

use crate::clip::ClipFile;
use crate::database::{Row, has_column, has_table, quote, select, value_as_text};
use crate::edit::new_external_id;
use crate::error::{Error, Result};
use crate::model::{LAYER_TYPE_MASKED, LayerKind};
use crate::offscreen::{Attribute, Parameter, PixelKind};

/// `ParamScheme.OwnerType` of a column holding the canvas id.
pub const OWNER_CANVAS: i64 = 2;
/// `ParamScheme.OwnerType` of a column holding the owning layer's id.
pub const OWNER_LAYER: i64 = 4;
/// Self-links (linked lists) that `ParamScheme` does not list as links.
const CHAIN_COLUMNS: [(&str, &str); 2] = [("MipmapInfo", "NextIndex"), ("BrushStyle", "NextIndex")];
/// Tables (and Canvas columns) a vector or text layer copied from another
/// file needs: vector lines find their brush styles through
/// `Canvas.BrushStyleManager`, and without it CSP opens them empty.
/// `Canvas.BrushStyleReadProtect070` (1 in newer files) comes with the brush
/// styles: it seems to tell CSP how to read them (not needed by any file
/// tried so far, but the styles were saved with it).
pub const LAYER_TABLES: [&str; 9] = [
    "Layer",
    "VectorObjectList",
    "BrushStyleManager",
    "BrushStyle",
    "BrushEffectorGraphData",
    "BrushPatternImage",
    "BrushPatternStyle",
    "BrushFixedSpray",
    "FillStyle",
];
/// The `Canvas` columns copied with the tables of [`LAYER_TABLES`].
pub const LAYER_CANVAS_COLUMNS: [&str; 2] = ["BrushStyleManager", "BrushStyleReadProtect070"];
/// Rows vector objects refer to by id, copied keeping their ids: the brush
/// styles and every table `BrushStyleManager` and `BrushStyle` link to.
pub const SHARED_TABLES: [&str; 7] = [
    "BrushStyleManager",
    "BrushStyle",
    "BrushEffectorGraphData",
    "BrushPatternImage",
    "BrushPatternStyle",
    "BrushFixedSpray",
    "FillStyle",
];
/// Layer columns that would tie a copy to data that is not copied: masks,
/// frame images, 3D, rulers and the like. A copy gets NULL in them, as CSP's
/// own layers without these have: CSP crashes drawing a vector layer whose
/// `ComicFrameLineMipmap` is 0 rather than NULL.
pub const DROPPED_LAYER_LINKS: [&str; 13] = [
    "LayerLayerMaskMipmap",
    "LayerLayerMaskThumbnail",
    "ResizableOriginalMipmap",
    "ComicFrameLineMipmap",
    "FirstLayerObject",
    "Manager3D",
    "Manager3DOd",
    "SpecialRulerManager",
    "StreamLineIndex",
    "VoiceSpeakParam",
    "RulerVectorIndex",
    "TimeLineOriginalMipmap",
    "TimeLineOriginalMaskMipmap",
];
/// Values after the size and block grid in a layer mask's `Parameter`
/// section (one 8-bit plane), as CSP writes them for a frame folder.
const MASK_PARAMETERS: [u32; 12] = [1, 1, 0, 1, 0, 0, 0, 1, 256, 0, 256, 256];

/// Rewrites an external payload while it is copied: (table, column, payload).
pub type PayloadHook<'a> = dyn Fn(&str, &str, Vec<u8>) -> Result<Vec<u8>> + 'a;
/// Rewrites the copied Layer row before it is inserted.
pub type RowHook<'a> = dyn FnMut(&mut Row) -> Result<()> + 'a;

/// What `ParamScheme` says about one column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnInfo {
    /// Table the column refers to (`ParamScheme` link), if any.
    pub link_table: Option<String>,
    /// `ParamScheme.OwnerType` of the column.
    pub owner_type: i64,
}

fn table_columns(database: &Connection, table: &str) -> Result<Vec<String>> {
    Ok(crate::database::columns(database, table)?.into_iter().map(|(name, _)| name).collect())
}

/// `ParamScheme` information for the columns of `table`.
pub fn column_infos(database: &Connection, table: &str) -> Result<HashMap<String, ColumnInfo>> {
    let mut infos = HashMap::new();
    if has_table(database, "ParamScheme")? {
        for row in
            select(database, "SELECT LabelName, LinkTable, OwnerType FROM ParamScheme WHERE TableName = ?1", [table])?
        {
            let label = row.text("LabelName").unwrap_or_default();
            let mut link_table = row.text("LinkTable").filter(|link| !link.is_empty() && link != "0");
            if CHAIN_COLUMNS.contains(&(table, label.as_str())) {
                link_table = Some(table.to_owned());
            }
            infos.insert(label, ColumnInfo { link_table, owner_type: row.int("OwnerType") });
        }
    }
    for (chain_table, label) in CHAIN_COLUMNS {
        if chain_table == table {
            infos.entry(label.to_owned()).or_insert(ColumnInfo { link_table: Some(table.to_owned()), owner_type: 0 });
        }
    }
    Ok(infos)
}

/// (table, column) pairs whose values are external chunk ids.
pub fn external_columns(database: &Connection) -> Result<HashSet<(String, String)>> {
    if !has_table(database, "ExternalTableAndColumnName")? {
        return Ok(HashSet::new());
    }
    Ok(select(database, "SELECT TableName, ColumnName FROM ExternalTableAndColumnName", [])?
        .iter()
        .map(|row| (row.text("TableName").unwrap_or_default(), row.text("ColumnName").unwrap_or_default()))
        .collect())
}

/// Insert `row` into `table`, keeping only the columns the table has.
pub fn insert_row(database: &Connection, table: &str, row: &Row) -> Result<()> {
    let known: HashSet<String> = table_columns(database, table)?.into_iter().collect();
    let kept: Vec<(&str, &Value)> = row.iter().filter(|(column, _)| known.contains(*column)).collect();
    let names: Vec<String> = kept.iter().map(|(column, _)| quote(column)).collect();
    let marks: Vec<String> = (1..=kept.len()).map(|i| format!("?{i}")).collect();
    database.execute(
        &format!("INSERT INTO {} ({}) VALUES ({})", quote(table), names.join(", "), marks.join(", ")),
        params_from_iter(kept.iter().map(|(_, value)| *value)),
    )?;
    Ok(())
}

/// A row with `column` set, added at the end when the row lacks it.
fn with_value(row: Row, column: &str, value: Value) -> Row {
    let mut row = row;
    if !row.set(column, value.clone()) {
        let mut columns = row.columns().to_vec();
        let mut values = row.values().to_vec();
        columns.push(column.to_owned());
        values.push(value);
        row = Row::new(columns, values);
    }
    row
}

/// The next `MainId` of `table` (see [`crate::schema::allocate_main_id`]).
fn allocate(database: &Connection, table: &str) -> Result<i64> {
    crate::schema::allocate_main_id(database, table)
}

/// Copies rows, and everything they link to, from one file's database to
/// another's.
pub struct RowCopier<'a> {
    source: &'a ClipFile,
    payload_hook: Option<&'a PayloadHook<'a>>,
    /// The target's `Canvas.MainId`.
    canvas_id: i64,
    /// The layer id written into layer-owned columns.
    pub owner_layer: i64,
    /// (table, column) values copied unchanged (links not followed).
    pub skip: HashSet<(String, String)>,
    done: HashMap<(String, i64), i64>,
    externals: HashSet<(String, String)>,
    infos: HashMap<String, HashMap<String, ColumnInfo>>,
    /// External chunks copied so far, to be stored in the target file.
    pub new_externals: Vec<(String, Vec<u8>)>,
}

impl<'a> RowCopier<'a> {
    /// A copier reading from `source`. `payload_hook` rewrites external payloads as they are copied; `canvas_id` is the target's `Canvas.MainId`.
    pub fn new(source: &'a ClipFile, payload_hook: Option<&'a PayloadHook<'a>>, canvas_id: i64) -> Result<Self> {
        Ok(RowCopier {
            source,
            payload_hook,
            canvas_id,
            owner_layer: 0,
            skip: HashSet::new(),
            done: HashMap::new(),
            externals: external_columns(source.database())?,
            infos: HashMap::new(),
            new_externals: Vec::new(),
        })
    }

    /// Copy row `main_id` of `table` into `target`; return its id there.
    pub fn copy(&mut self, target: &Connection, table: &str, main_id: i64) -> Result<i64> {
        let key = (table.to_owned(), main_id);
        if let Some(id) = self.done.get(&key) {
            return Ok(*id);
        }
        let row = self
            .source
            .row(table, main_id)?
            .ok_or_else(|| Error::format(format!("{table} {main_id} not found in the source")))?;
        let new_id = allocate(target, table)?;
        self.done.insert(key, new_id);
        let row = self.translate(target, table, row, new_id)?;
        insert_row(target, table, &row)?;
        Ok(new_id)
    }

    /// Rewrite the id, owner columns, links and external ids of one row.
    pub fn translate(&mut self, target: &Connection, table: &str, row: Row, new_id: i64) -> Result<Row> {
        if !self.infos.contains_key(table) {
            self.infos.insert(table.to_owned(), column_infos(self.source.database(), table)?);
        }
        let mut columns = Vec::with_capacity(row.columns().len());
        let mut values = Vec::with_capacity(row.columns().len());
        for (column, value) in row.iter() {
            if column == "_PW_ID" {
                continue;
            }
            let info = self.infos[table].get(column).cloned();
            let key = (table.to_owned(), column.to_owned());
            let value = if column == "MainId" {
                Value::Integer(new_id)
            } else if self.skip.contains(&key) {
                value.clone()
            } else if info.as_ref().is_some_and(|info| info.owner_type == OWNER_CANVAS) {
                Value::Integer(self.canvas_id)
            } else if info.as_ref().is_some_and(|info| info.owner_type == OWNER_LAYER) {
                Value::Integer(self.owner_layer)
            } else if let (Some(link), Value::Integer(id)) = (info.and_then(|info| info.link_table), value)
                && *id != 0
            {
                Value::Integer(self.copy(target, &link, *id)?)
            } else if let Value::Blob(_) | Value::Text(_) = value
                && self.externals.contains(&key)
                && let Some(id) = value_as_text(value).filter(|id| !id.is_empty())
            {
                Value::Blob(self.copy_external(table, column, &id)?.into_bytes())
            } else {
                value.clone()
            };
            columns.push(column.to_owned());
            values.push(value);
        }
        Ok(Row::new(columns, values))
    }

    fn copy_external(&mut self, table: &str, column: &str, external_id: &str) -> Result<String> {
        let new_id = new_external_id();
        if let Some(payload) = self.source.external(external_id) {
            let mut payload = payload.to_vec();
            if let Some(hook) = self.payload_hook {
                payload = hook(table, column, payload)?;
            }
            self.new_externals.push((new_id.clone(), payload));
        }
        Ok(new_id)
    }
}

/// Give `target` every table and column of `tables` that `source` has,
/// with their `ParamScheme` and `ElemScheme` rows.
pub fn merge_schema(target: &Connection, source: &Connection, tables: &[&str]) -> Result<()> {
    for table in tables {
        if !has_table(source, table)? {
            continue;
        }
        if !has_table(target, table)? {
            let sql: String = source.query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )?;
            target.execute(&sql, [])?;
            copy_scheme_rows(target, source, table, None)?;
            ensure_elem_scheme(target, source, table)?;
            continue;
        }
        merge_columns(target, source, table, None)?;
    }
    Ok(())
}

/// Give `target`'s existing `table` the columns `source` has (only those in
/// `only`, when given), with their `ParamScheme` rows.
pub fn merge_columns(target: &Connection, source: &Connection, table: &str, only: Option<&[&str]>) -> Result<()> {
    if !has_table(source, table)? || !has_table(target, table)? {
        return Ok(());
    }
    let have: HashSet<String> = table_columns(target, table)?.into_iter().collect();
    let mut statement = source.prepare(&format!("PRAGMA table_info({})", quote(table)))?;
    let columns: Vec<(String, String, Option<String>)> = statement
        .query_map([], |row| Ok((row.get(1)?, row.get(2)?, row.get(4)?)))?
        .collect::<std::result::Result<_, _>>()?;
    for (name, declared_type, default) in columns {
        if have.contains(&name) || only.is_some_and(|only| !only.contains(&name.as_str())) {
            continue;
        }
        let mut definition = format!("{} {declared_type}", quote(&name));
        if let Some(default) = default {
            definition += &format!(" DEFAULT {default}");
        }
        target.execute(&format!("ALTER TABLE {} ADD COLUMN {definition}", quote(table)), [])?;
        copy_scheme_rows(target, source, table, Some(&name))?;
    }
    Ok(())
}

fn copy_scheme_rows(target: &Connection, source: &Connection, table: &str, column: Option<&str>) -> Result<()> {
    if !has_table(target, "ParamScheme")? || !has_table(source, "ParamScheme")? {
        return Ok(());
    }
    let target_columns: HashSet<String> = table_columns(target, "ParamScheme")?.into_iter().collect();
    let common: Vec<String> = table_columns(source, "ParamScheme")?
        .into_iter()
        .filter(|name| name != "_PW_ID" && target_columns.contains(name))
        .collect();
    if !common.iter().any(|name| name == "LabelName") {
        return Ok(());
    }
    let quoted: Vec<String> = common.iter().map(|name| quote(name)).collect();
    let mut sql = format!("SELECT {} FROM ParamScheme WHERE TableName = ?1", quoted.join(", "));
    let mut parameters = vec![table.to_owned()];
    if let Some(column) = column {
        sql += " AND LabelName = ?2";
        parameters.push(column.to_owned());
    }
    let present: HashSet<String> = select(target, "SELECT LabelName FROM ParamScheme WHERE TableName = ?1", [table])?
        .iter()
        .filter_map(|row| row.text("LabelName"))
        .collect();
    let marks: Vec<String> = (1..=common.len()).map(|i| format!("?{i}")).collect();
    let insert = format!("INSERT INTO ParamScheme ({}) VALUES ({})", quoted.join(", "), marks.join(", "));
    for row in select(source, &sql, params_from_iter(parameters.iter()))? {
        if row.text("LabelName").is_some_and(|label| present.contains(&label)) {
            continue;
        }
        target.execute(&insert, params_from_iter(row.values().iter()))?;
    }
    Ok(())
}

fn ensure_elem_scheme(target: &Connection, source: &Connection, table: &str) -> Result<()> {
    if !has_table(target, "ElemScheme")? {
        return Ok(());
    }
    let query = "SELECT ElemType FROM ElemScheme WHERE TableName = ?1";
    if target.query_row(query, [table], |_| Ok(())).optional()?.is_some() {
        return Ok(());
    }
    let element_type: i64 = if has_table(source, "ElemScheme")? {
        source.query_row(query, [table], |row| row.get::<_, Option<i64>>(0)).optional()?.flatten().unwrap_or(0)
    } else {
        0
    };
    target
        .execute("INSERT INTO ElemScheme (TableName, ElemType, MaxIndex) VALUES (?1, ?2, 0)", (table, element_type))?;
    Ok(())
}

/// Copy the rows of `tables` keeping their ids, for each table that is empty
/// in `target`, and point `Canvas.BrushStyleManager` at the copied manager
/// when the target has none. When brush styles are copied, the source's
/// `Canvas.BrushStyleReadProtect070` comes with them. Returns the tables copied. Links out of the
/// copied rows are left as they are (see [`ClipFile::prepare_copy_from`]
/// for brush textures).
pub fn share_rows(target: &Connection, source: &Connection, tables: &[&str]) -> Result<Vec<String>> {
    let mut copied = Vec::new();
    for table in tables {
        if !has_table(source, table)? || !has_table(target, table)? {
            continue;
        }
        let count: i64 = target.query_row(&format!("SELECT COUNT(*) FROM {}", quote(table)), [], |row| row.get(0))?;
        if count > 0 {
            continue;
        }
        for row in select(source, &format!("SELECT * FROM {}", quote(table)), [])? {
            let kept: Vec<String> = row.columns().iter().filter(|c| *c != "_PW_ID").cloned().collect();
            let values: Vec<Value> = kept.iter().map(|c| row.get(c).cloned().unwrap_or(Value::Null)).collect();
            insert_row(target, table, &Row::new(kept, values))?;
        }
        copied.push((*table).to_owned());
        if has_table(source, "ElemScheme")? && has_table(target, "ElemScheme")? {
            let source_max: Option<i64> = source
                .query_row("SELECT MaxIndex FROM ElemScheme WHERE TableName = ?1", [table], |row| row.get(0))
                .optional()?
                .flatten();
            if let Some(source_max) = source_max {
                target.execute(
                    "UPDATE ElemScheme SET MaxIndex = MAX(MaxIndex, ?1) WHERE TableName = ?2",
                    (source_max, table),
                )?;
            }
        }
    }
    if has_column(target, "Canvas", "BrushStyleManager")? && has_column(source, "Canvas", "BrushStyleManager")? {
        let manager: Value = source.query_row("SELECT BrushStyleManager FROM Canvas", [], |row| row.get(0))?;
        let current: Value = target.query_row("SELECT BrushStyleManager FROM Canvas", [], |row| row.get(0))?;
        if matches!(current, Value::Null | Value::Integer(0)) {
            target.execute("UPDATE Canvas SET BrushStyleManager = ?1", [manager])?;
        }
    }
    let flag = "BrushStyleReadProtect070";
    if copied.iter().any(|table| table == "BrushStyle")
        && has_column(target, "Canvas", flag)?
        && has_column(source, "Canvas", flag)?
    {
        let value: Value = source.query_row(&format!("SELECT {flag} FROM Canvas"), [], |row| row.get(0))?;
        target.execute(&format!("UPDATE Canvas SET {flag} = ?1"), [value])?;
    }
    Ok(copied)
}

/// Options for [`ClipFile::copy_layer_from`].
#[derive(Default)]
pub struct CopyLayer<'h> {
    /// Rewrites external payloads while they are copied (for example the
    /// copied layer's `VectorObjectList.VectorData`).
    pub payload_hook: Option<&'h PayloadHook<'h>>,
    /// Rewrites the new Layer row before it is inserted.
    pub row_hook: Option<&'h mut RowHook<'h>>,
    /// Folder the copy goes into (on top of its children); the root folder
    /// when None.
    pub parent: Option<i64>,
}

impl ClipFile {
    /// Give this file the tables, columns and brush styles a layer copied
    /// from `source` needs ([`LAYER_TABLES`], [`share_rows`]).
    pub fn prepare_copy_from(&mut self, source: &ClipFile) -> Result<()> {
        merge_schema(self.database(), source.database(), &LAYER_TABLES)?;
        merge_columns(self.database(), source.database(), "Canvas", Some(&LAYER_CANVAS_COLUMNS))?;
        let copied = share_rows(self.database(), source.database(), &SHARED_TABLES)?;
        if copied.iter().any(|table| table == "BrushPatternImage") {
            self.copy_pattern_images(source)?;
        }
        Ok(())
    }

    /// A brush texture (`BrushPatternImage`) is an image stored like a
    /// layer's (Mipmap → MipmapInfo → Offscreen, owned by no layer). Copy
    /// each one and point the copied row at it: left as it was, the row
    /// names another image of this file, or none, and CSP crashes.
    fn copy_pattern_images(&mut self, source: &ClipFile) -> Result<()> {
        let images = select(source.database(), "SELECT MainId, Mipmap FROM BrushPatternImage", [])?;
        let mut copier = RowCopier::new(source, None, self.canvas.main_id)?;
        let mut moved = Vec::new();
        for image in images {
            let mipmap = image.int("Mipmap");
            if mipmap != 0 {
                moved.push((image.int("MainId"), copier.copy(self.database(), "Mipmap", mipmap)?));
            }
        }
        for (id, payload) in copier.new_externals {
            self.set_external(&id, payload);
        }
        for (image, mipmap) in moved {
            self.database().execute("UPDATE BrushPatternImage SET Mipmap = ?1 WHERE MainId = ?2", (mipmap, image))?;
        }
        Ok(())
    }

    /// Copy layer `layer_id` of `source` (its row, without children) and the
    /// rows it links to (vector data and the like) into this file; return
    /// the new layer's id.
    ///
    /// The copy keeps its position (`LayerOffsetX/Y`), gets a new uuid and
    /// new render offscreens, and loses what it cannot carry
    /// ([`DROPPED_LAYER_LINKS`]: the layer mask, a frame folder's images, 3D,
    /// rulers). A raster layer's stored pixels are copied with the area they
    /// are stored in (which may reach past the canvas); other layers get
    /// offscreens the size of this canvas, which CSP draws into when it opens
    /// the file. Call [`ClipFile::prepare_copy_from`] first.
    pub fn copy_layer_from(&mut self, source: &ClipFile, layer_id: i64, options: CopyLayer<'_>) -> Result<i64> {
        let layer = source
            .layers
            .get(layer_id)
            .ok_or_else(|| Error::format(format!("No layer {layer_id} in the source")))?
            .clone();
        if layer.kind == LayerKind::Root {
            return Err(Error::format("The root folder cannot be copied"));
        }
        let mut row = layer.row.clone();
        for column in DROPPED_LAYER_LINKS {
            row.set(column, Value::Null);
        }
        let new_id = self.next_main_id("Layer")?;
        let (translated, copied) = {
            let mut copier = RowCopier::new(source, options.payload_hook, self.canvas.main_id)?;
            copier.owner_layer = new_id;
            for column in ["LayerRenderMipmap", "LayerRenderThumbnail", "LayerNextIndex", "LayerFirstChildIndex"] {
                copier.skip.insert(("Layer".to_owned(), column.to_owned()));
            }
            let translated = copier.translate(self.database(), "Layer", row, new_id)?;
            (translated, copier.new_externals)
        };
        for (id, payload) in copied {
            self.set_external(&id, payload);
        }
        let raster = layer.layer_type & crate::model::LAYER_TYPE_RASTER != 0;
        // A raster layer keeps the stored area of its pixels, which can reach
        // past the canvas; other layers get offscreens the size of the canvas
        // at its origin.
        let stored = if raster { source.mipmap_base(layer.render_mipmap)? } else { None };
        let (mipmap, render_offset) = match &stored {
            Some(base) => (
                self.new_mipmap_sized(new_id, (base.parameter.width, base.parameter.height), None, true)?,
                layer.render_offset,
            ),
            None => (self.new_mipmap(new_id, None, raster)?, (-layer.offset.0, -layer.offset.1)),
        };
        let thumbnail = self.new_thumbnail(new_id)?;
        let int = Value::Integer;
        let mut row = translated;
        // Without a mask the masked bit goes.
        let layer_type = row.int("LayerType") & !LAYER_TYPE_MASKED;
        for (column, value) in [
            ("LayerType", int(layer_type)),
            ("LayerRenderMipmap", int(mipmap)),
            ("LayerRenderThumbnail", int(thumbnail)),
            ("LayerNextIndex", int(0)),
            ("LayerFirstChildIndex", int(0)),
            ("LayerRenderOffscrOffsetX", int(render_offset.0)),
            ("LayerRenderOffscrOffsetY", int(render_offset.1)),
            ("LayerMaskOffsetX", int(0)),
            ("LayerMaskOffsetY", int(0)),
            ("LayerMaskOffscrOffsetX", int(0)),
            ("LayerMaskOffscrOffsetY", int(0)),
            ("LayerSelect", int(0)),
            ("LayerUuid", Value::Text(crate::edit::layer_uuid())),
        ] {
            row = with_value(row, column, value);
        }
        let visibility = row.int("LayerVisibility");
        if visibility & 2 != 0 {
            row = with_value(row, "LayerVisibility", int(visibility & !2));
        }
        if let Some(hook) = options.row_hook {
            hook(&mut row)?;
        }
        insert_row(self.database(), "Layer", &row)?;
        let parent = options.parent.unwrap_or(self.canvas.root_folder);
        self.link_on_top(parent, new_id)?;
        self.reload()?;
        if raster && let Some((image, origin)) = source.layer_pixels(&layer)? {
            self.set_layer_pixels(new_id, &image, origin)?;
        }
        Ok(new_id)
    }

    /// Give a frame folder (コマ枠フォルダー) copied with
    /// [`ClipFile::copy_layer_from`] its mask and border images: offscreens
    /// the size of the canvas with no pixels stored, which CSP draws from
    /// the frames when it opens the file (CSP saves a frame folder's so).
    pub fn add_frame_images(&mut self, folder_id: i64) -> Result<()> {
        let mask = self.new_mipmap(folder_id, None, false)?;
        let mask_thumbnail = self.new_thumbnail(folder_id)?;
        let line = self.new_mipmap(folder_id, None, false)?;
        let levels = self.mipmap(mask)?.map(|mipmap| mipmap.levels).unwrap_or_default();
        for level in levels {
            let row = self
                .row("Offscreen", level.offscreen)?
                .ok_or_else(|| Error::format(format!("No Offscreen {}", level.offscreen)))?;
            let parameter = Attribute::parse(row.blob("Attribute").unwrap_or_default())?.parameter()?;
            self.database().execute(
                "UPDATE Offscreen SET Attribute = ?1 WHERE MainId = ?2",
                (mask_attribute(parameter.width, parameter.height), level.offscreen),
            )?;
        }
        let int = Value::Integer;
        for (column, value) in [
            ("LayerLayerMaskMipmap", int(mask)),
            ("LayerLayerMaskThumbnail", int(mask_thumbnail)),
            ("ComicFrameLineMipmap", int(line)),
        ] {
            self.set_layer_value(folder_id, column, value)?;
        }
        self.reload()
    }
}

/// The `Attribute` of a layer mask offscreen with no pixels stored.
fn mask_attribute(width: u32, height: u32) -> Vec<u8> {
    let mut attribute = Attribute::new(&Parameter::new(PixelKind::Color, width, height), None);
    if let Some(section) = attribute.sections.iter_mut().find(|section| section.name == "Parameter") {
        section.values[4..16].copy_from_slice(&MASK_PARAMETERS);
    }
    attribute.to_bytes()
}

/// `id` when `target` has that brush style, else its first brush style (or
/// `id` when it has none): the brush a copied vector object should name.
pub fn brush_style_in(target: &Connection, id: u32) -> Result<u32> {
    if !has_table(target, "BrushStyle")? {
        return Ok(id);
    }
    if target.query_row("SELECT 1 FROM BrushStyle WHERE MainId = ?1", [id], |_| Ok(())).optional()?.is_some() {
        return Ok(id);
    }
    let first: Option<i64> = target.query_row("SELECT MIN(MainId) FROM BrushStyle", [], |row| row.get(0))?;
    Ok(first.map_or(id, |first| first as u32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create::NewCanvas;
    use crate::edit::NewLayer;
    use crate::image::RgbaImage;

    #[test]
    fn raster_layers_copy_with_their_pixels() {
        let mut source = ClipFile::create(&NewCanvas::default()).unwrap();
        let mut image = RgbaImage::new(40, 30);
        image.fill([10, 200, 30, 255]);
        let id = source.add_raster_layer("source", &image, (100, 50)).unwrap();
        source.set_layer_opacity(id, 0.5).unwrap();
        let source = ClipFile::from_bytes(source.to_bytes().unwrap()).unwrap();

        let mut target = ClipFile::create(&NewCanvas::default()).unwrap();
        let folder = target.add_layer(target.canvas.root_folder, NewLayer::Folder, "folder").unwrap();
        target.prepare_copy_from(&source).unwrap();
        let mut rename = |row: &mut Row| {
            row.set("LayerName", Value::Text("copy".into()));
            Ok(())
        };
        let options = CopyLayer { row_hook: Some(&mut rename), parent: Some(folder), ..Default::default() };
        let copy = target.copy_layer_from(&source, id, options).unwrap();
        let target = ClipFile::from_bytes(target.to_bytes().unwrap()).unwrap();
        let layer = target.layers.get(copy).unwrap();
        assert_eq!(layer.name, "copy");
        assert_eq!(layer.kind, LayerKind::Raster);
        assert_eq!(target.layers.get(folder).unwrap().first_child, copy);
        assert!((layer.opacity_fraction() - 0.5).abs() < 0.01);
        assert_ne!(layer.row.text("LayerUuid"), source.layers.get(id).unwrap().row.text("LayerUuid"));
        let part = target.layer_pixels_in_box(layer, (100, 50, 140, 80)).unwrap();
        assert_eq!(part, image);
        assert_eq!(target.layer_pixels_in_box(layer, (99, 49, 100, 50)).unwrap().pixel(0, 0), [0; 4]);
        let report = crate::verify::check_clip(target.to_bytes().unwrap(), Default::default());
        assert!(report.ok(), "{:?}", report.errors);
    }

    #[test]
    fn dropped_links_become_null() {
        let mut source = ClipFile::create(&NewCanvas::default()).unwrap();
        let layer = source.add_raster_layer("one", &RgbaImage::new(4, 4), (0, 0)).unwrap();
        source
            .database()
            .execute_batch(
                "ALTER TABLE Layer ADD COLUMN ComicFrameLineMipmap INTEGER; UPDATE Layer SET ComicFrameLineMipmap = 0;",
            )
            .unwrap();
        let source = ClipFile::from_bytes(source.to_bytes().unwrap()).unwrap();
        let mut target = ClipFile::create(&NewCanvas::default()).unwrap();
        target.prepare_copy_from(&source).unwrap();
        let copy = target.copy_layer_from(&source, layer, CopyLayer::default()).unwrap();
        let value: Value = target
            .database()
            .query_row("SELECT ComicFrameLineMipmap FROM Layer WHERE MainId = ?1", [copy], |row| row.get(0))
            .unwrap();
        assert_eq!(value, Value::Null);
    }

    #[test]
    fn brush_styles_come_with_the_textures_they_use() {
        // The texture image: a layer's mipmap, handed over to the pattern.
        let mut source = ClipFile::create(&NewCanvas::default()).unwrap();
        let mut texture = RgbaImage::new(8, 8);
        texture.fill([90, 90, 90, 255]);
        let layer = source.add_raster_layer("texture", &texture, (0, 0)).unwrap();
        let texture_mipmap = source.layers.get(layer).unwrap().render_mipmap;
        source
            .database()
            .execute_batch(
                "CREATE TABLE BrushStyleManager(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER, CanvasId INTEGER, FirstBrushStyle INTEGER, FirstPatternImage INTEGER);
                 CREATE TABLE BrushStyle(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER, NextIndex INTEGER, TexturePattern INTEGER);
                 CREATE TABLE BrushPatternImage(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER, NextIndex INTEGER, ImageData BLOB);
                 INSERT INTO BrushStyleManager(MainId, CanvasId, FirstBrushStyle, FirstPatternImage) VALUES (1, 1, 1, 1);
                 INSERT INTO BrushStyle(MainId, NextIndex, TexturePattern) VALUES (1, 2, 0), (2, 0, 1);
                 INSERT INTO BrushPatternImage(MainId, NextIndex, ImageData) VALUES (1, 0, x'0102');",
            )
            .unwrap();
        source.database().execute("ALTER TABLE BrushPatternImage ADD COLUMN Mipmap INTEGER", []).unwrap();
        source.database().execute("UPDATE BrushPatternImage SET Mipmap = ?1", [texture_mipmap]).unwrap();
        source
            .database()
            .execute(
                "INSERT INTO ParamScheme (TableName, LabelName, DataType, OwnerType, LinkTable) VALUES ('BrushPatternImage', 'Mipmap', 1, 0, 'Mipmap')",
                [],
            )
            .unwrap();
        source
            .database()
            .execute_batch("ALTER TABLE Canvas ADD COLUMN BrushStyleReadProtect070 INTEGER; UPDATE Canvas SET BrushStyleReadProtect070 = 1;")
            .unwrap();
        let source = ClipFile::from_bytes(source.to_bytes().unwrap()).unwrap();
        let mut target = ClipFile::create(&NewCanvas::default()).unwrap();
        target.add_raster_layer("other", &RgbaImage::new(4, 4), (0, 0)).unwrap();
        target.prepare_copy_from(&source).unwrap();
        let target = ClipFile::from_bytes(target.to_bytes().unwrap()).unwrap();
        let images = select(target.database(), "SELECT MainId, ImageData, Mipmap FROM BrushPatternImage", []).unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].int("MainId"), 1);
        assert_eq!(images[0].blob("ImageData"), Some(&[1u8, 2][..]));
        // The texture is a copy of its own, not whatever image had its id.
        let mipmap = images[0].int("Mipmap");
        assert!(target.layers.flatten().iter().all(|(layer, _)| layer.render_mipmap != mipmap));
        let base = target.mipmap_base(mipmap).unwrap().unwrap();
        let original = source.mipmap_base(texture_mipmap).unwrap().unwrap();
        assert_eq!(base.parameter, original.parameter);
        let levels = |file: &ClipFile, id| file.mipmap(id).unwrap().unwrap().levels.len();
        assert_eq!(levels(&target, mipmap), levels(&source, texture_mipmap));
        let styles = select(target.database(), "SELECT MainId FROM BrushStyle ORDER BY MainId", []).unwrap();
        assert_eq!(styles.iter().map(|row| row.int("MainId")).collect::<Vec<_>>(), [1, 2]);
        let flag: i64 =
            target.database().query_row("SELECT BrushStyleReadProtect070 FROM Canvas", [], |row| row.get(0)).unwrap();
        assert_eq!(flag, 1);
    }
}
