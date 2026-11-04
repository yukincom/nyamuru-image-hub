//! New .clip files without a template (R13).
//!
//! The database gets the tables CSP creates for a raster-only canvas
//! (`data/new_file_schema.sql`) and CSP's own schema registry
//! (`ParamScheme`, `ElemScheme`, `ExternalTableAndColumnName`, from
//! `data/`), all taken from a file CSP wrote; they hold structure only.
//! The rows are written here: the project and canvas settings CSP uses for
//! a new illustration, the root folder, the paper and one raster layer
//! (built by [`ClipFile::add_layer`]), and a preview rendered from them.

use rusqlite::Connection;
use rusqlite::types::Value;

use crate::clip::ClipFile;
use crate::container::ContainerWriter;
use crate::database;
use crate::edit::{NewLayer, new_uuid};
use crate::error::Result;
use crate::image::RgbaImage;

const SCHEMA: &str = include_str!("data/new_file_schema.sql");
const PARAM_SCHEME: &str = include_str!("data/param_scheme.tsv");
const ELEM_SCHEME: &str = include_str!("data/elem_scheme.tsv");

/// Tables whose BLOB columns live in external chunks.
const EXTERNAL_COLUMNS: [(&str, &str); 10] = [
    ("Offscreen", "BlockData"),
    ("VectorObjectList", "VectorData"),
    ("Canvas3DModelBank", "BankData"),
    ("Canvas3DModelLoader", "ModelData"),
    ("Track", "TrackActionMixer"),
    ("Track", "TrackActionMixer2"),
    ("CanvasItemBinary", "ItemBinaryData"),
    ("Manager3DOd", "SceneData"),
    ("ModelData3D", "Layer3DModelData"),
    ("TimeLapseBlob", "BlobData"),
];

/// Settings of a new canvas (pixels; the unit is set to pixels).
#[derive(Debug, Clone, PartialEq)]
pub struct NewCanvas {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Dots per inch.
    pub resolution: f64,
    /// Paper colour; `None` for no paper layer.
    pub paper: Option<[u8; 3]>,
    /// Name of the first raster layer.
    pub layer_name: String,
}

impl Default for NewCanvas {
    fn default() -> Self {
        NewCanvas {
            width: 1024,
            height: 1024,
            resolution: 350.0,
            paper: Some([255; 3]),
            layer_name: "レイヤー 1".to_owned(),
        }
    }
}

/// Ids CSP gives the singletons of a new file.
const CANVAS_ID: i64 = 1;
const ITEM_BANK_ID: i64 = 1;
const CUT_BANK_ID: i64 = 2;
const LAYER_COMP_MANAGER_ID: i64 = 3;
const ROOT_ID: i64 = 2;

/// Size of the stored preview: the canvas halved until it fits in 2048
/// pixels (as in CSP's files).
pub fn preview_size(width: u32, height: u32) -> (u32, u32) {
    let (mut w, mut h) = (width.max(1), height.max(1));
    while w.max(h) > 2048 {
        (w, h) = ((w / 2).max(1), (h / 2).max(1));
    }
    (w, h)
}

impl ClipFile {
    /// A new file: root folder, paper (unless `paper` is `None`) and one
    /// empty raster layer, ready for [`ClipFile::set_layer_pixels`] and
    /// [`ClipFile::add_raster_layer`]. Call [`ClipFile::update_preview`]
    /// after drawing.
    pub fn create(canvas: &NewCanvas) -> Result<ClipFile> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(SCHEMA)?;
        fill_registry(&connection, PARAM_SCHEME, ELEM_SCHEME)?;
        for (table, column) in EXTERNAL_COLUMNS {
            connection.execute("INSERT INTO ExternalTableAndColumnName VALUES (?1, ?2)", (table, column))?;
        }
        fill_singletons(&connection, canvas)?;
        let bytes = ContainerWriter::new(new_uuid()).assemble(&database::serialize(&connection)?)?;
        // The database holds a bare root folder so that it opens; it is
        // replaced by a complete one now that layers can be built.
        let mut file = ClipFile::from_bytes(bytes)?;
        let root = ROOT_ID;
        file.database().execute("DELETE FROM Layer WHERE MainId = ?1", [root])?;
        file.insert_layer_row(root, NewLayer::Root, "")?;
        file.reload()?;
        if let Some(color) = canvas.paper {
            file.add_layer(root, NewLayer::Paper(color), "用紙")?;
        }
        file.add_layer(root, NewLayer::Raster, &canvas.layer_name)?;
        file.update_preview()?;
        Ok(file)
    }
}

/// Fill `ParamScheme` and `ElemScheme` from the tab-separated copies in `data/`.
pub(crate) fn fill_registry(connection: &Connection, param_scheme: &str, elem_scheme: &str) -> Result<()> {
    let mut insert = connection.prepare(
        "INSERT INTO ParamScheme (TableName, LabelName, DataType, Flag, OwnerType, LockType, LockSpecified, \
         AlternativeLockType, AlternativeLockSpecified, LinkTable) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for line in param_scheme.lines().filter(|line| !line.is_empty()) {
        let cells: Vec<Value> = line
            .split('\t')
            .enumerate()
            .map(|(i, cell)| match (i, cell) {
                (_, "\\N") => Value::Null,
                (0 | 1 | 9, text) => Value::Text(text.to_owned()),
                (_, number) => number.parse().map(Value::Integer).unwrap_or(Value::Null),
            })
            .collect();
        insert.execute(rusqlite::params_from_iter(cells))?;
    }
    for line in elem_scheme.lines().filter(|line| !line.is_empty()) {
        let (table, kind) = line.split_once('\t').unwrap_or((line, "0"));
        connection.execute(
            "INSERT INTO ElemScheme (TableName, ElemType, MaxIndex) VALUES (?1, ?2, 0)",
            (table, kind.parse::<i64>().unwrap_or(0)),
        )?;
    }
    Ok(())
}

/// The comic settings CSP writes for a new illustration (Project and Canvas
/// share them).
pub(crate) fn comic_story() -> Vec<(&'static str, Value)> {
    let (int, text, real) = (Value::Integer, |s: &str| Value::Text(s.to_owned()), Value::Real);
    vec![
        ("ComicStoryStoryName", text("")),
        ("ComicStoryUseStoryIndex", int(0)),
        ("ComicStoryStoryIndex", int(1)),
        ("ComicStorySubTitle", text("")),
        ("ComicStoryStoryPosition", int(1)),
        ("ComicStoryAuthorName", text("")),
        ("ComicStoryAuthorPosition", int(2)),
        ("ComicStoryUsePageNumber", int(0)),
        ("ComicStoryPageNumberStart", int(1)),
        ("ComicStoryPageNumberPosition", int(3)),
        ("ComicStoryNombreStart", int(1)),
        ("ComicStoryNombreFont", text("")),
        ("ComicStoryNombreFontSize", real(9.0)),
        ("ComicStoryNombreFontPostScriptName", text("")),
        ("ComicStoryUseShownNombre", int(0)),
        ("ComicStoryNombrePosition", int(5)),
        ("ComicStoryNombrePrefix", text("")),
        ("ComicStoryNombreSuffix", text("")),
        ("ComicStoryUseHiddenNombre", int(0)),
        ("ComicStoryNombreColor", int(0)),
        ("ComicStoryNombreUseEdge", int(0)),
        ("ComicStoryNombreEdgeWidth", real(0.5)),
        ("ComicStoryNombreEdgeUnit", int(2)),
        ("ComicStoryYPageNombreOffset", real(5.0)),
        ("ComicStoryYPageNombreOffsetUnit", int(2)),
        ("ComicStoryXPageNombreOffset", real(0.0)),
        ("ComicStoryXPageNombreOffsetUnit", int(2)),
    ]
}

pub(crate) fn insert(connection: &Connection, table: &str, values: &[(&str, Value)]) -> Result<()> {
    let names: Vec<String> = values.iter().map(|(name, _)| database::quote(name)).collect();
    let marks: Vec<String> = (1..=values.len()).map(|i| format!("?{i}")).collect();
    let sql = format!("INSERT INTO {} ({}) VALUES ({})", database::quote(table), names.join(", "), marks.join(", "));
    connection.execute(&sql, rusqlite::params_from_iter(values.iter().map(|(_, value)| value.clone())))?;
    Ok(())
}

fn fill_singletons(connection: &Connection, canvas: &NewCanvas) -> Result<()> {
    let (int, text, real) = (Value::Integer, |s: &str| Value::Text(s.to_owned()), Value::Real);
    let (width, height) = (canvas.width.max(1) as f64, canvas.height.max(1) as f64);
    let paper = canvas.paper.unwrap_or([255; 3]).map(|c| int(c as i64 * 0x0101_0101));
    let mut project = vec![
        ("ProjectInternalVersion", text("1.1.0")),
        ("ProjectName", text("")),
        ("ProjectCanvas", int(CANVAS_ID)),
        ("ProjectItemBank", int(ITEM_BANK_ID)),
        ("ProjectCutBank", int(CUT_BANK_ID)),
        ("ProjectLayerCompManager", int(LAYER_COMP_MANAGER_ID)),
        ("ProjectRootCanvasNode", int(0)),
    ];
    project.extend(comic_story());
    project.extend([
        ("DefaultPageUnit", int(0)),
        ("DefaultPageWidth", real(width)),
        ("DefaultPageHeight", real(height)),
        ("DefaultPageResolution", real(canvas.resolution)),
        ("DefaultPageChannelBytes", int(1)),
        ("DefaultPageChannelOrder", int(33)),
        ("DefaultPageColorType", int(0)),
        ("DefaultPageBlackChecked", int(1)),
        ("DefaultPageWhiteChecked", int(1)),
        ("DefaultPageToneLine", real(60.0)),
        ("DefaultPageUsePaper", int(canvas.paper.is_some() as i64)),
        ("DefaultPagePaperRed", paper[0].clone()),
        ("DefaultPagePaperGreen", paper[1].clone()),
        ("DefaultPagePaperBlue", paper[2].clone()),
        ("DefaultPageUseTemplate", int(0)),
        ("DefaultPageTemplatePath", text("")),
        ("DefaultPageTemplatePath2", text("")),
        ("DefaultPageTemplateName", text("")),
        ("DefaultPageIsUserTemplate", int(0)),
        ("DefaultPageDoublePage", int(0)),
        ("DefaultPagePresetID", text("")),
        ("DefaultPageCheckBookBinding", int(0)),
        ("DefaultPageCelUseTemplate", int(0)),
        ("DefaultPageCelTemplatePath", text("")),
        ("DefaultPageCelTemplatePath2", text("")),
        ("DefaultPageCelTemplateName", text("")),
        ("DefaultPageCelTemplateUUID", text("")),
        ("DefaultPageCelIsUserTemplate", int(0)),
        ("DefaultPageUseCropFrame", int(0)),
        ("DefaultPageTemplateUUID", text("")),
        ("DefaultPageUseDefaultCoverInfo", int(0)),
        ("DefaultPageSettingType", text("Illust")),
        ("DefaultPageRecordTimeLapse", int(0)),
        ("DefaultPageTimeLapseCodec", int(0)),
    ]);
    insert(connection, "Project", &project)?;
    let mut canvas_row = vec![
        ("MainId", int(CANVAS_ID)),
        ("CanvasUnit", int(0)),
        ("CanvasWidth", real(width)),
        ("CanvasHeight", real(height)),
        ("CanvasResolution", real(canvas.resolution)),
        ("CanvasChannelBytes", int(1)),
        ("CanvasDefaultChannelOrder", int(33)),
        ("CanvasRootFolder", int(ROOT_ID)),
        ("CanvasCurrentLayer", int(0)),
        ("CanvasDoSimulateColor", int(0)),
        ("CanvasSimulateRenderingIntent", int(1)),
        ("CanvasSimulateUseLibraryType", int(2)),
        ("CanvasUseColorAdjustment", int(0)),
        ("CanvasDefaultColorTypeIndex", int(0)),
        ("CanvasDefaultColorBlackChecked", int(1)),
        ("CanvasDefaultColorWhiteChecked", int(1)),
        ("CanvasDefaultToneLine", real(60.0)),
        ("CanvasDoublePage", int(0)),
        ("CanvasRenderMipmapForceSaved", int(0)),
        ("CanvasWorkTime", int(0)),
        ("ComicBindPosition", int(1)),
        ("ComicHasComicCover", int(0)),
        ("ComicHasDoubleCover", int(0)),
        ("ComicPageIndex", int(0)),
        ("ComicIsLeftPage", int(1)),
    ];
    canvas_row.extend(comic_story());
    canvas_row.push(("TimeLapseCodec", int(0)));
    insert(connection, "Canvas", &canvas_row)?;
    insert(
        connection,
        "CanvasItemBank",
        &[("MainId", int(ITEM_BANK_ID)), ("ModelBankMainIndex", int(0)), ("BankRootItemMainIndex", int(0))],
    )?;
    insert(
        connection,
        "AnimationCutBank",
        &[
            ("MainId", int(CUT_BANK_ID)),
            ("FirstTimeLine", int(0)),
            ("FirstScenario", int(0)),
            ("CurrentIndex", int(0)),
            ("Enable", int(0)),
        ],
    )?;
    insert(
        connection,
        "LayerCompManager",
        &[
            ("MainId", int(LAYER_COMP_MANAGER_ID)),
            ("FirstLayerCompIndex", int(0)),
            ("LastStateLayerCompIndex", int(0)),
            ("AppliedLayerCompIndex", int(-1)),
        ],
    )?;
    let (preview_width, preview_height) = preview_size(canvas.width, canvas.height);
    let preview = RgbaImage::new(preview_width, preview_height).to_png()?;
    insert(
        connection,
        "CanvasPreview",
        &[
            ("MainId", int(1)),
            ("CanvasId", int(CANVAS_ID)),
            ("ImageType", int(1)),
            ("ImageWidth", int(preview_width as i64)),
            ("ImageHeight", int(preview_height as i64)),
            ("ImageData", Value::Blob(preview)),
        ],
    )?;
    insert(
        connection,
        "Layer",
        &[
            ("MainId", int(ROOT_ID)),
            ("CanvasId", int(CANVAS_ID)),
            ("LayerType", int(crate::model::LAYER_TYPE_ROOT)),
            ("LayerFolder", int(1)),
            ("LayerFirstChildIndex", int(0)),
            ("LayerNextIndex", int(0)),
        ],
    )?;
    for (table, max) in [("Canvas", CANVAS_ID), ("Project", 1), ("Layer", ROOT_ID)] {
        connection.execute("UPDATE ElemScheme SET MaxIndex = ?1 WHERE TableName = ?2", (max, table))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LayerKind;
    use crate::verify::{CheckOptions, check_clip};

    #[test]
    fn new_files_pass_the_self_check_and_read_back() {
        let canvas = NewCanvas { width: 300, height: 200, ..Default::default() };
        let mut file = ClipFile::create(&canvas).unwrap();
        let mut image = RgbaImage::new(40, 30);
        image.fill([200, 10, 20, 255]);
        let raster = file.layers.flatten().iter().find(|(l, _)| l.kind == LayerKind::Raster).unwrap().0.main_id;
        file.set_layer_pixels(raster, &image, (10, 20)).unwrap();
        file.update_preview().unwrap();
        let bytes = file.to_bytes().unwrap();
        let report = check_clip(bytes.clone(), CheckOptions::default());
        assert!(report.ok(), "{:?}", serde_json::to_string(&report).unwrap());
        let again = ClipFile::from_bytes(bytes).unwrap();
        assert_eq!((again.canvas.width_px, again.canvas.height_px), (300, 200));
        let kinds: Vec<LayerKind> = again.layers.flatten().iter().map(|(l, _)| l.kind).collect();
        assert_eq!(kinds, [LayerKind::Root, LayerKind::Paper, LayerKind::Raster]);
        let (pixels, origin) = again.layer_pixels(again.layers.get(raster).unwrap()).unwrap().unwrap();
        assert_eq!(pixels.pixel(15 - origin.0 as u32, 25 - origin.1 as u32), [200, 10, 20, 255]);
        let preview = again.preview().unwrap().unwrap();
        assert_eq!(preview.pixel(15, 25), [200, 10, 20, 255]);
        assert_eq!(preview.pixel(100, 100), [255, 255, 255, 255]);
        // New thumbnails are blank (CSP redraws them).
        let thumbnail = again.layer_thumbnail(again.layers.get(raster).unwrap()).unwrap().unwrap();
        assert_eq!((thumbnail.width, thumbnail.height, thumbnail.pixel(5, 5)[3]), (512, 512, 0));
    }

    #[test]
    fn empty_raster_layers_store_empty_blocks_like_csp() {
        // CSP reports a raster layer whose base offscreen has no block data as
        // damaged; its own empty layers store every block as an empty record
        // and leave the smaller levels without (V8).
        let file = ClipFile::create(&NewCanvas { width: 600, height: 400, ..Default::default() }).unwrap();
        let file = ClipFile::from_bytes(file.to_bytes().unwrap()).unwrap();
        for (layer, _) in file.layers.flatten() {
            let mipmap = file.mipmap(layer.render_mipmap).unwrap().unwrap();
            for (level, info) in mipmap.levels.iter().enumerate() {
                let offscreen = file.offscreen(info.offscreen).unwrap().unwrap();
                let stored = layer.kind == LayerKind::Raster && level == 0;
                assert_eq!(offscreen.data.is_some(), stored, "{:?} level {level}", layer.kind);
                if let Some(data) = &offscreen.data {
                    assert_eq!(data.blocks.len(), 6);
                    assert!(data.record_sizes().iter().all(|&size| size == crate::offscreen::EMPTY_RECORD_SIZE));
                    assert_eq!(offscreen.attribute.block_sizes().unwrap(), &data.record_sizes()[..]);
                }
            }
        }
    }

    #[test]
    fn layer_thumbnails_are_read_through_their_offscreen() {
        let mut file = ClipFile::create(&NewCanvas { width: 64, height: 48, ..Default::default() }).unwrap();
        let mut image = RgbaImage::new(8, 6);
        image.fill([0, 90, 200, 255]);
        let raster = file.layers.flatten().iter().find(|(l, _)| l.kind == LayerKind::Raster).unwrap().0.main_id;
        file.set_layer_pixels(raster, &image, (0, 0)).unwrap();
        // Point the layer's thumbnail at an offscreen that has pixels.
        let layer = file.layers.get(raster).unwrap().clone();
        let base = file.mipmap(layer.render_mipmap).unwrap().unwrap().levels[0].offscreen;
        file.database()
            .execute(
                "UPDATE LayerThumbnail SET ThumbnailOffscreen = ?1 WHERE MainId = ?2",
                [base, layer.row.int("LayerRenderThumbnail")],
            )
            .unwrap();
        let thumbnail = file.layer_thumbnail(&layer).unwrap().unwrap();
        assert_eq!(thumbnail.pixel(1, 1), [0, 90, 200, 255]);
    }
}
