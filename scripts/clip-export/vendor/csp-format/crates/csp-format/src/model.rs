//! Typed view of the `Project`, `Canvas` and `Layer` tables of a .clip.
//!
//! The layer tree is stored as first-child / next-sibling links:
//! `Canvas.CanvasRootFolder` is the root folder's `Layer.MainId`, and
//! `LayerFirstChildIndex` / `LayerNextIndex` hold `MainId`s (0 = none).
//! Siblings are listed bottom to top (the paper first). See
//! `docs/spec/03-canvas-and-layers.md`.

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::database::{Row, select, select_all, table_exists};
use crate::error::{Result, bail};

/// `LayerOpacity` of a fully opaque layer (100 %).
pub const OPACITY_FULL: i64 = 256;
const MAX_DEPTH: usize = 256;

/// `CanvasUnit` / `CropFrameUnitKind` and friends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum Unit {
    /// `CanvasUnit` 0.
    Pixel,
    /// `CanvasUnit` 1.
    Centimeter,
    /// `CanvasUnit` 2.
    Millimeter,
    /// `CanvasUnit` 3.
    Inch,
    /// `CanvasUnit` 5.
    Point,
    /// A code this crate does not know; sizes are taken as pixels.
    Unknown(i64),
}

impl Unit {
    /// The unit of a stored unit code.
    pub fn from_code(code: i64) -> Self {
        match code {
            0 => Unit::Pixel,
            1 => Unit::Centimeter,
            2 => Unit::Millimeter,
            3 => Unit::Inch,
            5 => Unit::Point,
            other => Unit::Unknown(other),
        }
    }

    /// Pixels of `value` at `dpi`, rounded half to even (as the Python reference).
    pub fn to_pixels(&self, value: f64, dpi: f64) -> f64 {
        match self {
            Unit::Pixel | Unit::Unknown(_) => value,
            Unit::Centimeter => value * dpi / 2.54,
            Unit::Millimeter => value * dpi / 25.4,
            Unit::Inch => value * dpi,
            Unit::Point => value * dpi / 72.0,
        }
    }
}

/// Settings of the canvas (one row of `Canvas`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct Canvas {
    /// `MainId` of the row.
    pub main_id: i64,
    /// Unit of `width` and `height` (`CanvasUnit`).
    pub unit: Unit,
    /// Width in `unit` (`CanvasWidth`).
    pub width: f64,
    /// Height in `unit` (`CanvasHeight`).
    pub height: f64,
    /// Resolution in dots per inch (`CanvasResolution`).
    pub resolution: f64,
    /// Size in pixels as CSP computes it from `width`/`height`.
    pub width_px: u32,
    /// Height in pixels, as `width_px`.
    pub height_px: u32,
    /// `MainId` of the root folder layer (`CanvasRootFolder`).
    pub root_folder: i64,
    /// Bytes per colour channel (`CanvasChannelBytes`, 1 in CSP files).
    pub channel_bytes: i64,
    /// The canvas is a two-page spread (`CanvasDoublePage`).
    pub double_page: bool,
    /// The whole row, for the columns not typed here.
    #[serde(skip)]
    pub row: Row,
}

impl Canvas {
    /// Types the columns of a `Canvas` row.
    pub fn from_row(row: Row) -> Self {
        let unit = Unit::from_code(row.int("CanvasUnit"));
        let width = row.real("CanvasWidth");
        let height = row.real("CanvasHeight");
        let resolution = row.real("CanvasResolution");
        Canvas {
            main_id: row.int("MainId"),
            width_px: unit.to_pixels(width, resolution).round_ties_even().max(0.0) as u32,
            height_px: unit.to_pixels(height, resolution).round_ties_even().max(0.0) as u32,
            unit,
            width,
            height,
            resolution,
            root_folder: row.int("CanvasRootFolder"),
            channel_bytes: row.int("CanvasChannelBytes"),
            double_page: row.truthy("CanvasDoublePage"),
            row,
        }
    }
}

/// What a layer is. Derived from `LayerType`, `LayerFolder` and which
/// optional columns are filled (no single column holds it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum LayerKind {
    /// The root folder (`LayerType` 256), not shown in CSP.
    Root,
    /// 用紙 (`LayerType` 1584).
    Paper,
    /// Comic story info / nombre text (`LayerType` 800).
    StoryInfo,
    /// A folder (`LayerFolder` bit 0).
    Folder,
    /// コマ枠フォルダー: a folder with `ComicFrameLineMipmap`.
    FrameFolder,
    /// Pixel layer (`LayerType` bit 0).
    Raster,
    /// Vector layer: has a `VectorObjectList` row (or the vector index columns when nothing is drawn).
    Vector,
    /// Text layer (`TextLayerString`).
    Text,
    /// Gradient or fill layer (`GradationFillInfo`).
    Gradient,
    /// Tone-correction layer (`FilterLayerInfo`, `LayerType` bit 12).
    Correction,
    /// Image material (`ResizableImageInfo`).
    ImageMaterial,
    /// 3D layer (`FirstLayerObject`).
    ThreeD,
    /// Something else (e.g. a ruler-only layer).
    Other,
}

impl LayerKind {
    /// Root, folder or frame folder: a layer that holds other layers.
    pub fn is_folder(self) -> bool {
        matches!(self, LayerKind::Root | LayerKind::Folder | LayerKind::FrameFolder)
    }

    /// A short snake_case name (`"raster"`, `"frame_folder"`, …), the same as the serde name.
    pub fn name(self) -> &'static str {
        match self {
            LayerKind::Root => "root",
            LayerKind::Paper => "paper",
            LayerKind::StoryInfo => "story_info",
            LayerKind::Folder => "folder",
            LayerKind::FrameFolder => "frame_folder",
            LayerKind::Raster => "raster",
            LayerKind::Vector => "vector",
            LayerKind::Text => "text",
            LayerKind::Gradient => "gradient",
            LayerKind::Correction => "correction",
            LayerKind::ImageMaterial => "image_material",
            LayerKind::ThreeD => "3d",
            LayerKind::Other => "other",
        }
    }
}

/// `LayerType` bit of a pixel layer.
pub const LAYER_TYPE_RASTER: i64 = 1;
/// `LayerType` bit of a layer with a mask.
pub const LAYER_TYPE_MASKED: i64 = 2;
/// `LayerType` of the root folder.
pub const LAYER_TYPE_ROOT: i64 = 256;
/// `LayerType` of a story info (作品情報) layer.
pub const LAYER_TYPE_STORY_INFO: i64 = 800;
/// `LayerType` of the paper (用紙) layer.
pub const LAYER_TYPE_PAPER: i64 = 1584;
/// `LayerType` bit of a tone-correction layer.
pub const LAYER_TYPE_CORRECTION: i64 = 4096;

/// One row of `Layer`, with the commonly used columns typed.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Layer {
    /// `MainId` of the row; other rows refer to the layer by it.
    pub main_id: i64,
    /// Name shown in the layer palette (`LayerName`).
    pub name: String,
    /// What the layer is (derived, see [`LayerKind`]).
    pub kind: LayerKind,
    /// `LayerType` as stored.
    pub layer_type: i64,
    /// `LayerVisibility` bit 0.
    pub visible: bool,
    /// `LayerVisibility` bit 1: the layer mask is applied.
    pub mask_enabled: bool,
    /// 0–256 (`LayerOpacity`, 256 = 100 %).
    pub opacity: i64,
    /// `LayerComposite`.
    pub blend: i64,
    /// Clipped to the layer below (`LayerClip`).
    pub clipping: bool,
    /// `LayerLock` is set.
    pub locked: bool,
    /// `LayerFolder` as stored (bit 0 folder, bit 4 open in the palette).
    pub folder_flags: i64,
    /// Layer position on the canvas (`LayerOffsetX/Y`); pixel, vector and text positions are relative to it.
    pub offset: (i64, i64),
    /// Offset of the render offscreen from `offset` (`LayerRenderOffscrOffsetX/Y`).
    pub render_offset: (i64, i64),
    /// Offset of the mask from `offset` (`LayerMaskOffsetX/Y`).
    pub mask_offset: (i64, i64),
    /// Offset of the mask offscreen from the mask offset (`LayerMaskOffscrOffsetX/Y`).
    pub mask_render_offset: (i64, i64),
    /// `MainId` of the `Mipmap` row of the layer's pixels (`LayerRenderMipmap`, 0 = none).
    pub render_mipmap: i64,
    /// `MainId` of the `Mipmap` row of the mask (`LayerLayerMaskMipmap`, 0 = none).
    pub mask_mipmap: i64,
    /// `MainId` of the bottom child (`LayerFirstChildIndex`, 0 = none).
    pub first_child: i64,
    /// `MainId` of the sibling above (`LayerNextIndex`, 0 = none).
    pub next: i64,
    /// `LayerUuid`, when set.
    pub uuid: Option<String>,
    /// The whole row, for the columns not typed here.
    #[serde(skip)]
    pub row: Row,
}

impl Layer {
    /// Types the columns of a `Layer` row. `vector_layers` are the `LayerId`s of `VectorObjectList`, used to tell vector layers.
    pub fn from_row(row: Row, vector_layers: &HashSet<i64>) -> Self {
        let main_id = row.int("MainId");
        let layer_type = row.int("LayerType");
        let folder_flags = row.int("LayerFolder");
        let kind = classify(&row, main_id, layer_type, folder_flags, vector_layers);
        let visibility = row.int("LayerVisibility");
        let pair = |x: &str, y: &str| (row.int(x), row.int(y));
        Layer {
            main_id,
            name: row.text("LayerName").unwrap_or_default(),
            kind,
            layer_type,
            visible: visibility & 1 != 0,
            mask_enabled: visibility & 2 != 0,
            opacity: row.opt_int("LayerOpacity").unwrap_or(OPACITY_FULL),
            blend: row.int("LayerComposite"),
            clipping: row.int("LayerClip") != 0,
            locked: row.int("LayerLock") != 0,
            folder_flags,
            offset: pair("LayerOffsetX", "LayerOffsetY"),
            render_offset: pair("LayerRenderOffscrOffsetX", "LayerRenderOffscrOffsetY"),
            mask_offset: pair("LayerMaskOffsetX", "LayerMaskOffsetY"),
            mask_render_offset: pair("LayerMaskOffscrOffsetX", "LayerMaskOffscrOffsetY"),
            render_mipmap: row.int("LayerRenderMipmap"),
            mask_mipmap: row.int("LayerLayerMaskMipmap"),
            first_child: row.int("LayerFirstChildIndex"),
            next: row.int("LayerNextIndex"),
            uuid: row.text("LayerUuid"),
            row,
        }
    }

    /// Canvas position of the render offscreen's top-left pixel.
    pub fn pixel_origin(&self) -> (i64, i64) {
        (self.offset.0 + self.render_offset.0, self.offset.1 + self.render_offset.1)
    }

    /// Canvas position of the mask offscreen's top-left pixel. The mask
    /// offsets are relative to the layer's offset (a moved layer keeps its
    /// mask in place: offset (7018, 1) with mask offset (−7018, −1) puts a
    /// canvas-sized mask at (0, 0)).
    pub fn mask_origin(&self) -> (i64, i64) {
        (
            self.offset.0 + self.mask_offset.0 + self.mask_render_offset.0,
            self.offset.1 + self.mask_offset.1 + self.mask_render_offset.1,
        )
    }

    /// The layer has a mask.
    pub fn has_mask(&self) -> bool {
        self.mask_mipmap != 0
    }

    /// Opacity as 0.0–1.0.
    pub fn opacity_fraction(&self) -> f64 {
        self.opacity.clamp(0, OPACITY_FULL) as f64 / OPACITY_FULL as f64
    }

    /// Folder shown expanded in the layer palette (`LayerFolder` bit 4).
    pub fn is_open(&self) -> bool {
        self.folder_flags & 16 != 0
    }

    /// A colour column pair as 8-bit RGB (`DrawColorMainRed` …): CSP stores
    /// each channel as a 32-bit value whose top byte is the 8-bit value.
    pub fn color(&self, prefix: &str) -> Option<[u8; 3]> {
        let channel =
            |name: &str| self.row.opt_int(&format!("{prefix}{name}")).map(|v| ((v as u64 >> 24) & 0xff) as u8);
        Some([channel("Red")?, channel("Green")?, channel("Blue")?])
    }
}

fn classify(row: &Row, main_id: i64, layer_type: i64, folder: i64, vector_layers: &HashSet<i64>) -> LayerKind {
    if layer_type == LAYER_TYPE_ROOT {
        return LayerKind::Root;
    }
    if layer_type == LAYER_TYPE_PAPER {
        return LayerKind::Paper;
    }
    if layer_type == LAYER_TYPE_STORY_INFO {
        return LayerKind::StoryInfo;
    }
    if folder & 1 != 0 {
        return if row.truthy("ComicFrameLineMipmap") { LayerKind::FrameFolder } else { LayerKind::Folder };
    }
    if row.is_set("TextLayerString") {
        return LayerKind::Text;
    }
    if row.truthy("GradationFillInfo") {
        return LayerKind::Gradient;
    }
    if row.truthy("FilterLayerInfo") || layer_type & LAYER_TYPE_CORRECTION != 0 {
        return LayerKind::Correction;
    }
    if row.truthy("FirstLayerObject") {
        return LayerKind::ThreeD;
    }
    if row.truthy("ResizableImageInfo") {
        return LayerKind::ImageMaterial;
    }
    if vector_layers.contains(&main_id) {
        return LayerKind::Vector;
    }
    if layer_type & LAYER_TYPE_RASTER != 0 {
        return LayerKind::Raster;
    }
    // A vector layer nothing was drawn on: no `VectorObjectList` row, but
    // the vector index columns are there (all 101 such layers in the corpus
    // had `LayerType` 0 and blank pixels).
    if layer_type == 0 && row.is_set("VectorNormalStrokeIndex") {
        return LayerKind::Vector;
    }
    LayerKind::Other
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::types::Value;

    #[test]
    fn empty_vector_layers_are_vector() {
        let row = |columns: &[(&str, Value)]| {
            Row::new(
                columns.iter().map(|(c, _)| c.to_string()).collect(),
                columns.iter().map(|(_, v)| v.clone()).collect(),
            )
        };
        let none = HashSet::new();
        let empty = row(&[("VectorNormalStrokeIndex", Value::Integer(0))]);
        assert_eq!(classify(&empty, 5, 0, 0, &none), LayerKind::Vector);
        let raster = row(&[("VectorNormalStrokeIndex", Value::Null)]);
        assert_eq!(classify(&raster, 5, 1, 0, &none), LayerKind::Raster);
        assert_eq!(classify(&raster, 5, 0, 0, &none), LayerKind::Other);
    }
}

/// A layer and its children (bottom to top).
#[derive(Debug, Clone)]
pub struct LayerNode {
    /// The layer.
    pub layer: Layer,
    /// Its children, bottom to top.
    pub children: Vec<LayerNode>,
}

impl LayerNode {
    /// Depth-first, parents before children, siblings bottom to top.
    pub fn walk<'a>(&'a self, depth: usize, visit: &mut impl FnMut(&'a LayerNode, usize)) {
        visit(self, depth);
        for child in &self.children {
            child.walk(depth + 1, visit);
        }
    }

    /// The node of a layer in this subtree.
    pub fn find(&self, main_id: i64) -> Option<&LayerNode> {
        if self.layer.main_id == main_id {
            return Some(self);
        }
        self.children.iter().find_map(|child| child.find(main_id))
    }
}

/// All layers and the tree they form.
#[derive(Debug, Clone)]
pub struct LayerTree {
    /// Every row of `Layer`, in table order.
    pub layers: Vec<Layer>,
    /// The root folder and everything reachable from it.
    pub root: LayerNode,
    /// Layers not reachable from the root (CSP files have none).
    pub unreachable: Vec<i64>,
}

impl LayerTree {
    /// Reads `Layer` and links the tree from the root folder `root_id` (`Canvas.CanvasRootFolder`). Fails on a cycle, a missing link or a tree deeper than 256.
    pub fn read(connection: &Connection, root_id: i64) -> Result<Self> {
        let vector_layers: HashSet<i64> = if table_exists(connection, "VectorObjectList")? {
            select(connection, "SELECT LayerId FROM VectorObjectList", [])?
                .iter()
                .map(|row| row.int("LayerId"))
                .collect()
        } else {
            HashSet::new()
        };
        let layers: Vec<Layer> =
            select_all(connection, "Layer")?.into_iter().map(|row| Layer::from_row(row, &vector_layers)).collect();
        let by_id: HashMap<i64, &Layer> = layers.iter().map(|layer| (layer.main_id, layer)).collect();
        if by_id.len() != layers.len() {
            bail!("Layer MainIds are not unique");
        }
        let mut seen = HashSet::new();
        let root = build(&by_id, root_id, &mut seen, 0)?;
        let unreachable = layers.iter().map(|layer| layer.main_id).filter(|id| !seen.contains(id)).collect();
        Ok(LayerTree { layers: layers.clone(), root, unreachable })
    }

    /// The layer with this `MainId`.
    pub fn get(&self, main_id: i64) -> Option<&Layer> {
        self.layers.iter().find(|layer| layer.main_id == main_id)
    }

    /// (layer, depth) in palette order: parents first, siblings bottom to top.
    pub fn flatten(&self) -> Vec<(&Layer, usize)> {
        let mut result = Vec::new();
        self.root.walk(0, &mut |node, depth| result.push((&node.layer, depth)));
        result
    }
}

fn build(by_id: &HashMap<i64, &Layer>, id: i64, seen: &mut HashSet<i64>, depth: usize) -> Result<LayerNode> {
    if depth > MAX_DEPTH {
        bail!("Layer tree deeper than {MAX_DEPTH}");
    }
    let layer = *by_id.get(&id).ok_or_else(|| crate::Error::format(format!("Layer {id} does not exist")))?;
    if !seen.insert(id) {
        bail!("Layer {id} is linked twice (the tree has a cycle)");
    }
    let mut children = Vec::new();
    let mut child = layer.first_child;
    while child != 0 {
        let node = build(by_id, child, seen, depth + 1)?;
        child = node.layer.next;
        children.push(node);
    }
    Ok(LayerNode { layer: layer.clone(), children })
}

/// One row of `Project` (in a .clip: name and links to the canvas).
#[derive(Debug, Clone, serde::Serialize)]
pub struct Project {
    /// `ProjectInternalVersion`.
    pub internal_version: Option<String>,
    /// `ProjectName`.
    pub name: Option<String>,
    /// `MainId` of the canvas (`ProjectCanvas`).
    pub canvas: i64,
    /// The whole row, for the columns not typed here.
    #[serde(skip)]
    pub row: Row,
}

impl Project {
    /// Types the columns of a `Project` row.
    pub fn from_row(row: Row) -> Self {
        Project {
            internal_version: row.text("ProjectInternalVersion"),
            name: row.text("ProjectName"),
            canvas: row.int("ProjectCanvas"),
            row,
        }
    }
}
