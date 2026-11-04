//! Self-checks of a .clip file, used for corpus validation (V1) and for
//! checking written files (V4). Each check records counts, not artwork.

use std::collections::{BTreeMap, HashSet};

use serde::Serialize;

use crate::clip::ClipFile;
use crate::container::{Container, ContainerWriter, FILE_ID_LENGTH};
use crate::database::{self, select_all, value_as_text};
use crate::error::Result;
use crate::offscreen::{Attribute, BlockData, PixelKind, compress};
use crate::text;
use crate::vector::VectorData;

/// Options for [`check_clip`].
#[derive(Debug, Clone, Copy)]
pub struct CheckOptions {
    /// Decompress every block (R5).
    pub decode_pixels: bool,
    /// Recompress every block and compare with CSP's bytes (R6).
    pub reencode_pixels: bool,
}

impl Default for CheckOptions {
    fn default() -> Self {
        CheckOptions { decode_pixels: true, reencode_pixels: true }
    }
}

/// Checks of the CSFCHUNK container.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ContainerReport {
    /// Structural problems found while parsing (see [`crate::container::Container::findings`]).
    pub findings: Vec<String>,
    /// Rebuilding from the parsed chunks gives the same bytes (R1).
    pub reassembles: bool,
    /// The writer, fed the original chunks, gives the same bytes (R11).
    pub writer_reproduces: bool,
    /// Number of external chunks.
    pub external_chunks: usize,
    /// `ExternalChunk.Offset` points at each stored chunk.
    pub external_offsets_match: bool,
    /// Every `ExternalChunk.ExternalID` is stored as TEXT. CSP looks chunks
    /// up by text, so a BLOB id makes the layer load as broken.
    pub external_ids_text: bool,
}

/// Checks of the embedded database.
#[derive(Debug, Clone, Default, Serialize)]
pub struct DatabaseReport {
    /// Number of tables.
    pub tables: usize,
    /// Rows over all tables.
    pub rows: usize,
    /// Tables that could not be read.
    pub unreadable_tables: Vec<String>,
    /// Rows of `ParamScheme`.
    pub param_scheme_rows: usize,
    /// Columns in tables that `ParamScheme` does not list.
    pub unregistered_columns: Vec<String>,
}

/// The layer tree.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LayerReport {
    /// Number of `Layer` rows.
    pub layers: usize,
    /// Layers per [`crate::LayerKind`] name.
    pub kinds: BTreeMap<String, usize>,
    /// Layers not reachable from the root folder.
    pub unreachable: usize,
    /// Why the tree could not be built, if it could not.
    pub tree_error: Option<String>,
    /// Layers per `LayerComposite` value.
    pub blend_modes: BTreeMap<i64, usize>,
}

/// Raster pixels (`Offscreen` rows and their block data).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PixelReport {
    /// `Offscreen` rows.
    pub offscreens: usize,
    /// Offscreens whose block data chunk is stored.
    pub stored: usize,
    /// Offscreens per pixel kind (`color`, `gray`, `monochrome`, `alpha`, `unknown`).
    pub kinds: BTreeMap<String, usize>,
    /// `Attribute` blobs that could not be parsed.
    pub attribute_errors: usize,
    /// `Attribute` blobs not written back byte for byte.
    pub attribute_round_trip_failures: usize,
    /// Block data that could not be parsed or has the wrong number of blocks.
    pub payload_errors: usize,
    /// Block data not written back byte for byte.
    pub payload_round_trip_failures: usize,
    /// Block data whose block sizes differ from the attribute's size table.
    pub block_size_table_mismatches: usize,
    /// Blocks in the grids of all offscreens.
    pub blocks: usize,
    /// Blocks with stored (compressed) pixels.
    pub stored_blocks: usize,
    /// Blocks whose stored checksum is wrong.
    pub checksum_mismatches: usize,
    /// Blocks that could not be inflated or have the wrong size.
    pub decode_errors: usize,
    /// Blocks compressed again to the same bytes, with CSP's zlib settings.
    pub reencoded_identical: usize,
    /// Blocks equal to zlib's default settings instead (material brush tips).
    pub reencoded_identical_default: usize,
    /// Blocks equal to neither.
    pub reencoded_different: usize,
    /// The first problem found, for diagnosis.
    pub first_error: Option<String>,
}

/// External chunk references (`ExternalChunk` ids named by table columns).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ReferenceReport {
    /// Ids referred to by any column.
    pub references: usize,
    /// Referenced ids without a chunk (normal: CSP builds them on opening).
    pub not_stored: usize,
    /// Chunks no column refers to.
    pub unreferenced_chunks: usize,
    /// Per `Table.Column`: (references, of which stored).
    pub by_column: BTreeMap<String, (usize, usize)>,
}

/// Vector data round trips (R7).
#[derive(Debug, Clone, Default, Serialize)]
pub struct VectorReport {
    /// `VectorObjectList` payloads.
    pub payloads: usize,
    /// Vector objects.
    pub objects: usize,
    /// Points over all objects.
    pub points: usize,
    /// Objects per header size.
    pub header_sizes: BTreeMap<usize, usize>,
    /// Objects per point size.
    pub point_sizes: BTreeMap<usize, usize>,
    /// Payloads that could not be parsed.
    pub parse_errors: usize,
    /// Payloads not written back byte for byte.
    pub round_trip_failures: usize,
    /// The first problem found, for diagnosis.
    pub first_error: Option<String>,
}

/// Text layer round trips (R8).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TextReport {
    /// Text layers.
    pub layers: usize,
    /// Text blocks.
    pub blocks: usize,
    /// Attribute records over all blocks.
    pub records: usize,
    /// Records per id.
    pub record_ids: BTreeMap<u32, usize>,
    /// Attribute lists that could not be parsed.
    pub parse_errors: usize,
    /// Texts or attribute lists not written back byte for byte.
    pub round_trip_failures: usize,
    /// The first problem found, for diagnosis.
    pub first_error: Option<String>,
}

/// Layer effect settings (`LayerEffectInfo`) round trips.
#[derive(Debug, Clone, Default, Serialize)]
pub struct EffectReport {
    /// `LayerEffectInfo` blobs.
    pub blobs: usize,
    /// Layers with `LayerEffectAttached`.
    pub attached: usize,
    /// Switched-on effects of attached layers, by section name.
    pub enabled: BTreeMap<String, usize>,
    /// Section names and how often they occur.
    pub sections: BTreeMap<String, usize>,
    /// Blobs that could not be parsed.
    pub parse_errors: usize,
    /// Blobs not written back byte for byte.
    pub round_trip_failures: usize,
    /// The first problem found, for diagnosis.
    pub first_error: Option<String>,
}

/// Result of [`check_clip`]: every check of a .clip.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ClipReport {
    /// The container.
    pub container: ContainerReport,
    /// The database.
    pub database: DatabaseReport,
    /// The layer tree.
    pub layers: LayerReport,
    /// Raster pixels.
    pub pixels: PixelReport,
    /// External chunk references.
    pub references: ReferenceReport,
    /// Vector data.
    pub vectors: VectorReport,
    /// Text layers.
    pub texts: TextReport,
    /// Layer effects.
    pub effects: EffectReport,
    /// Size of the stored preview (`CanvasPreview`), if any.
    pub preview: Option<(u32, u32)>,
    /// Why the preview could not be decoded, if it could not.
    pub preview_error: Option<String>,
    /// Saving without changes gives the input bytes.
    pub unchanged_save_identical: bool,
    /// Checks that could not run, with why.
    pub errors: Vec<String>,
}

impl ClipReport {
    /// Whether every check passed.
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
            && self.container.findings.is_empty()
            && self.container.reassembles
            && self.container.writer_reproduces
            && self.container.external_offsets_match
            && self.container.external_ids_text
            && self.database.unreadable_tables.is_empty()
            && self.layers.unreachable == 0
            && self.layers.tree_error.is_none()
            && self.pixels.attribute_errors == 0
            && self.pixels.attribute_round_trip_failures == 0
            && self.pixels.payload_errors == 0
            && self.pixels.payload_round_trip_failures == 0
            && self.pixels.block_size_table_mismatches == 0
            && self.pixels.checksum_mismatches == 0
            && self.pixels.decode_errors == 0
            && self.pixels.reencoded_different == 0
            && self.references.unreferenced_chunks == 0
            && self.vectors.parse_errors == 0
            && self.vectors.round_trip_failures == 0
            && self.texts.parse_errors == 0
            && self.texts.round_trip_failures == 0
            && self.effects.parse_errors == 0
            && self.effects.round_trip_failures == 0
            && self.preview_error.is_none()
            && self.unchanged_save_identical
    }
}

/// Check one .clip given as bytes.
pub fn check_clip(data: Vec<u8>, options: CheckOptions) -> ClipReport {
    let mut report = ClipReport::default();
    let container = match Container::parse(data) {
        Ok(container) => container,
        Err(error) => {
            report.errors.push(format!("container: {error}"));
            return report;
        }
    };
    check_container(&container, &mut report.container);
    // The database report needs only the (small) database image, so it is
    // made before the container moves into the typed view.
    match container.sqlite().and_then(database::open_bytes) {
        Ok(connection) => check_database(&connection, &mut report.database),
        Err(error) => report.errors.push(format!("database: {error}")),
    }
    let file = match ClipFile::from_container(container) {
        Ok(file) => file,
        Err(error) => {
            report.errors.push(format!("open: {error}"));
            return report;
        }
    };
    check_layers(&file, &mut report.layers);
    if let Err(error) = check_pixels(&file, options, &mut report.pixels) {
        report.errors.push(format!("pixels: {error}"));
    }
    if let Err(error) = check_references(&file, &mut report.references) {
        report.errors.push(format!("references: {error}"));
    }
    if let Err(error) = check_vectors(&file, &mut report.vectors) {
        report.errors.push(format!("vectors: {error}"));
    }
    if let Err(error) = check_texts(&file, &mut report.texts) {
        report.errors.push(format!("texts: {error}"));
    }
    if let Err(error) = check_effects(&file, &mut report.effects) {
        report.errors.push(format!("effects: {error}"));
    }
    match file.preview() {
        Ok(Some(image)) => report.preview = Some((image.width, image.height)),
        Ok(None) => {}
        Err(error) => report.preview_error = Some(error.to_string()),
    }
    // Unchanged files are saved from the original bytes; together with
    // `reassembles` / `writer_reproduces` this shows saving loses nothing.
    report.unchanged_save_identical = !file.is_modified();
    report
}

fn check_container(container: &Container, report: &mut ContainerReport) {
    report.findings = container.findings();
    report.reassembles = container.reassemble() == container.bytes();
    report.external_chunks = container.external_chunks().count();
    let file_id: [u8; FILE_ID_LENGTH] =
        container.head.as_ref().and_then(|head| head.file_id.as_slice().try_into().ok()).unwrap_or([0; FILE_ID_LENGTH]);
    let mut writer = ContainerWriter::new(file_id);
    for chunk in container.external_chunks() {
        writer.push_external(
            chunk.external_id.clone().unwrap_or_default(),
            &container.bytes()[chunk.payload_offset..chunk.body.end],
        );
    }
    report.writer_reproduces = match container.sqlite() {
        Ok(sqlite) => writer.assemble(sqlite).map(|bytes| bytes == container.bytes()).unwrap_or(false),
        Err(_) => false,
    };
    // ExternalChunk.Offset must point at each chunk header.
    report.external_offsets_match = (|| -> Result<bool> {
        let connection = database::open_bytes(container.sqlite()?)?;
        let rows = select_all(&connection, "ExternalChunk")?;
        let mut matched = 0;
        report.external_ids_text =
            rows.iter().all(|row| matches!(row.get("ExternalID"), Some(rusqlite::types::Value::Text(_))));
        for row in &rows {
            let id = row.get("ExternalID").and_then(value_as_text).unwrap_or_default();
            let chunk = container.external_chunk(&id);
            if chunk.map(|chunk| chunk.header_offset as i64) == Some(row.int("Offset")) {
                matched += 1;
            }
        }
        Ok(matched == rows.len() && rows.len() == container.external_chunks().count())
    })()
    .unwrap_or(false);
}

fn check_database(connection: &rusqlite::Connection, report: &mut DatabaseReport) {
    let tables = database::tables(connection).unwrap_or_default();
    report.tables = tables.len();
    let schema = crate::schema::Schema::read(connection).unwrap_or_default();
    report.param_scheme_rows = schema.params.len();
    let registered: HashSet<(String, String)> =
        schema.params.iter().map(|param| (param.table.clone(), param.column.clone())).collect();
    let bookkeeping = ["ExternalTableAndColumnName", "RemovedExternal", "ExternalChunk", "ElemScheme", "ParamScheme"];
    for table in &tables {
        match select_all(connection, table) {
            Ok(rows) => report.rows += rows.len(),
            Err(_) => report.unreadable_tables.push(table.clone()),
        }
        if table == "sqlite_sequence" || bookkeeping.contains(&table.as_str()) {
            continue;
        }
        for (column, _) in database::columns(connection, table).unwrap_or_default() {
            if column != "_PW_ID" && !registered.contains(&(table.clone(), column.clone())) {
                report.unregistered_columns.push(format!("{table}.{column}"));
            }
        }
    }
}

fn check_layers(file: &ClipFile, report: &mut LayerReport) {
    report.layers = file.layers.layers.len();
    report.unreachable = file.layers.unreachable.len();
    for layer in &file.layers.layers {
        *report.kinds.entry(layer.kind.name().to_owned()).or_default() += 1;
        *report.blend_modes.entry(layer.blend).or_default() += 1;
    }
}

fn check_pixels(file: &ClipFile, options: CheckOptions, report: &mut PixelReport) -> Result<()> {
    let rows = select_all(file.database(), "Offscreen")?;
    report.offscreens = rows.len();
    let note = |report: &mut PixelReport, message: String| {
        if report.first_error.is_none() {
            report.first_error = Some(message);
        }
    };
    for row in &rows {
        let main_id = row.int("MainId");
        let Some(raw_attribute) = row.blob("Attribute") else {
            report.attribute_errors += 1;
            continue;
        };
        let attribute = match Attribute::parse(raw_attribute) {
            Ok(attribute) => attribute,
            Err(error) => {
                report.attribute_errors += 1;
                note(report, format!("offscreen {main_id}: {error}"));
                continue;
            }
        };
        if attribute.to_bytes() != raw_attribute {
            report.attribute_round_trip_failures += 1;
        }
        let parameter = match attribute.parameter() {
            Ok(parameter) => parameter,
            Err(error) => {
                report.attribute_errors += 1;
                note(report, format!("offscreen {main_id}: {error}"));
                continue;
            }
        };
        let kind = match parameter.kind() {
            PixelKind::Color => "color",
            PixelKind::Gray => "gray",
            PixelKind::Monochrome => "monochrome",
            PixelKind::Alpha => "alpha",
            PixelKind::Unknown => "unknown",
        };
        *report.kinds.entry(kind.to_owned()).or_default() += 1;
        report.blocks += parameter.block_count();
        let Some(payload) = row.get("BlockData").and_then(value_as_text).and_then(|id| file.external(&id)) else {
            continue;
        };
        report.stored += 1;
        let data = match BlockData::parse(payload) {
            Ok(data) => data,
            Err(error) => {
                report.payload_errors += 1;
                note(report, format!("offscreen {main_id} blocks: {error}"));
                continue;
            }
        };
        if data.to_bytes() != payload {
            report.payload_round_trip_failures += 1;
        }
        if data.blocks.len() != parameter.block_count() {
            report.payload_errors += 1;
            note(
                report,
                format!("offscreen {main_id}: {} blocks for a grid of {}", data.blocks.len(), parameter.block_count()),
            );
        }
        if attribute.block_sizes() != Some(data.record_sizes().as_slice()) {
            report.block_size_table_mismatches += 1;
        }
        report.checksum_mismatches += data.checksum_mismatches().len();
        let expected = parameter.block_bytes();
        for block in &data.blocks {
            if block.zlib.is_none() {
                continue;
            }
            report.stored_blocks += 1;
            if !options.decode_pixels {
                continue;
            }
            match block.inflate() {
                Ok(Some(raw)) => {
                    if raw.len() != expected {
                        report.decode_errors += 1;
                        note(
                            report,
                            format!(
                                "offscreen {main_id} block {}: {} bytes, layout needs {expected}",
                                block.index,
                                raw.len()
                            ),
                        );
                    }
                    if options.reencode_pixels {
                        if block.zlib.as_deref() == Some(compress(&raw).as_slice()) {
                            report.reencoded_identical += 1;
                        } else if block.zlib.as_deref() == crate::zlib::compress_default(&raw).ok().as_deref() {
                            report.reencoded_identical_default += 1;
                        } else {
                            report.reencoded_different += 1;
                            note(report, format!("offscreen {main_id} block {}: re-encoding differs", block.index));
                        }
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    report.decode_errors += 1;
                    note(report, format!("offscreen {main_id}: {error}"));
                }
            }
        }
    }
    Ok(())
}

fn check_references(file: &ClipFile, report: &mut ReferenceReport) -> Result<()> {
    let references = file.external_references()?;
    let mut referenced = HashSet::new();
    for (table, column, id) in &references {
        let stored = file.external(id).is_some();
        let entry = report.by_column.entry(format!("{table}.{column}")).or_default();
        entry.0 += 1;
        if stored {
            entry.1 += 1;
        } else {
            report.not_stored += 1;
        }
        referenced.insert(id.clone());
    }
    report.references = references.len();
    report.unreferenced_chunks = file.external_ids().filter(|id| !referenced.contains(*id)).count();
    Ok(())
}

fn check_vectors(file: &ClipFile, report: &mut VectorReport) -> Result<()> {
    if !database::table_exists(file.database(), "VectorObjectList")? {
        return Ok(());
    }
    for row in select_all(file.database(), "VectorObjectList")? {
        let Some(id) = row.get("VectorData").and_then(value_as_text) else { continue };
        let Some(payload) = file.external(&id) else { continue };
        report.payloads += 1;
        match VectorData::parse(payload) {
            Ok(data) => {
                for object in &data.objects {
                    report.objects += 1;
                    report.points += object.points.len();
                    *report.header_sizes.entry(object.header_size()).or_default() += 1;
                    *report.point_sizes.entry(object.point_size).or_default() += 1;
                }
                if data.to_bytes() != payload {
                    report.round_trip_failures += 1;
                    report.first_error.get_or_insert_with(|| format!("{id}: round trip differs"));
                }
            }
            Err(error) => {
                report.parse_errors += 1;
                report.first_error.get_or_insert_with(|| format!("{id}: {error}"));
            }
        }
    }
    Ok(())
}

fn check_effects(file: &ClipFile, report: &mut EffectReport) -> Result<()> {
    if !database::has_column(file.database(), "Layer", "LayerEffectInfo")? {
        return Ok(());
    }
    for layer in &file.layers.layers {
        let Some(blob) = layer.row.blob("LayerEffectInfo") else { continue };
        report.blobs += 1;
        match crate::effect::LayerEffects::parse(blob) {
            Ok(effects) => {
                for (name, _) in &effects.sections {
                    *report.sections.entry(name.clone()).or_default() += 1;
                }
                if layer.row.truthy("LayerEffectAttached") {
                    report.attached += 1;
                    for name in effects.enabled() {
                        *report.enabled.entry(name.to_owned()).or_default() += 1;
                    }
                }
                if effects.to_bytes() != blob {
                    report.round_trip_failures += 1;
                }
            }
            Err(error) => {
                report.parse_errors += 1;
                report.first_error.get_or_insert_with(|| format!("layer {}: {error}", layer.main_id));
            }
        }
    }
    Ok(())
}

fn check_texts(file: &ClipFile, report: &mut TextReport) -> Result<()> {
    if !database::has_column(file.database(), "Layer", "TextLayerAttributes")? {
        return Ok(());
    }
    for row in select_all(file.database(), "Layer")? {
        let mut blobs: Vec<&[u8]> = Vec::new();
        let mut arrays_ok = true;
        if let Some(blob) = row.blob("TextLayerAttributes") {
            blobs.push(blob);
        }
        if let Some(array) = row.blob("TextLayerAttributesArray") {
            match text::split_array(array) {
                Ok(parts) => {
                    arrays_ok = text::join_array(&parts) == array;
                    blobs.extend(parts);
                }
                Err(error) => {
                    report.parse_errors += 1;
                    report.first_error.get_or_insert_with(|| format!("layer {}: {error}", row.int("MainId")));
                }
            }
        }
        if let Some(array) = row.blob("TextLayerStringArray") {
            match text::split_array(array) {
                Ok(parts) => arrays_ok &= text::join_array(&parts) == array,
                Err(error) => {
                    report.parse_errors += 1;
                    report.first_error.get_or_insert_with(|| format!("layer {}: {error}", row.int("MainId")));
                }
            }
        }
        if blobs.is_empty() {
            continue;
        }
        report.layers += 1;
        if !arrays_ok {
            report.round_trip_failures += 1;
        }
        for blob in blobs {
            report.blocks += 1;
            match text::Attributes::parse(blob) {
                Ok(attributes) => {
                    report.records += attributes.records.len();
                    for record in &attributes.records {
                        *report.record_ids.entry(record.id).or_default() += 1;
                    }
                    if attributes.to_bytes() != blob {
                        report.round_trip_failures += 1;
                    }
                }
                Err(error) => {
                    report.parse_errors += 1;
                    report.first_error.get_or_insert_with(|| format!("layer {}: {error}", row.int("MainId")));
                }
            }
        }
    }
    Ok(())
}

/// Self-check of a .cmc (R14).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CmcReport {
    /// `CanvasNode` rows.
    pub nodes: usize,
    /// Pages in the page list.
    pub pages: usize,
    /// Pages that are spreads.
    pub spreads: usize,
    /// Structural problems, and page files missing next to the .cmc.
    pub findings: Vec<String>,
    /// Saving without changes gives the input bytes.
    pub unchanged_save_identical: bool,
    /// Rewriting the page list in its own order and reading it back gives
    /// the same pages without findings (the edit path, V4).
    pub edit_round_trip: bool,
    /// Checks that could not run, with why.
    pub errors: Vec<String>,
}

impl CmcReport {
    /// Whether every check passed.
    pub fn ok(&self) -> bool {
        self.errors.is_empty() && self.findings.is_empty() && self.unchanged_save_identical && self.edit_round_trip
    }
}

/// Check one .cmc given as bytes; `folder` is where its pages live.
pub fn check_cmc(data: Vec<u8>, folder: Option<&std::path::Path>) -> CmcReport {
    let mut report = CmcReport::default();
    let original = data.clone();
    let mut file = match crate::cmc::CmcFile::from_bytes(data) {
        Ok(file) => file,
        Err(error) => {
            report.errors.push(format!("open: {error}"));
            return report;
        }
    };
    report.nodes = file.nodes.len();
    report.findings = file.findings(folder);
    report.unchanged_save_identical = file.to_bytes().is_ok_and(|bytes| bytes == original);
    let order: Vec<i64> = match file.pages() {
        Ok(pages) => {
            report.pages = pages.len();
            report.spreads = pages.iter().filter(|node| node.spread).count();
            pages.iter().map(|node| node.main_id).collect()
        }
        Err(error) => {
            report.errors.push(format!("pages: {error}"));
            return report;
        }
    };
    let edited = file.reorder(&order).and_then(|()| file.to_bytes()).and_then(crate::cmc::CmcFile::from_bytes);
    report.edit_round_trip = match edited {
        Ok(again) => {
            again.findings(None).is_empty()
                && again.pages().is_ok_and(|pages| pages.iter().map(|node| node.main_id).eq(order.iter().copied()))
        }
        Err(error) => {
            report.errors.push(format!("edit: {error}"));
            false
        }
    };
    report
}
