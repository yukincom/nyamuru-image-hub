//! Sub tools (サブツール: pens, erasers, brushes) saved by CSP, as the
//! name tool draws with them.
//!
//! csp-assets reads an exported sub tool (.sut) and CSP's own tool database
//! (`Tool/EditImageTool.todb`): the tool tree, each sub tool's settings
//! (`Variant`), its 影響元設定 and material lists, and the materials a .sut
//! carries. This module picks the pens and erasers and turns their settings
//! into what the app draws with.
//!
//! Settings that matter for drawing lines:
//! - `BrushSize` with `BrushSizeUnit` (0 = pixels of the canvas, 2 = mm).
//! - `BrushSizeEffector`, `BrushOpacityEffector`, `BrushFlowEffector`: how pen
//!   pressure and the like change the value; see [`Dynamics::parse`].
//! - `Opacity` (%), `BrushHardness` (%), `AntiAlias` (0..3),
//!   `FlickerReduction` (手ブレ補正, 0..100), `FlickerReductionBySpeed` (速度による手ブレ補正),
//!   `BrushUseRevision` with `BrushRevision` (後補正 and its strength, 0..100).
//! - `BrushUseIn` / `BrushUseOut` with `BrushInLength`, `BrushOutLength` and
//!   their units: 入り抜き (tapering at both ends).
//! - `BrushInterval` (% of the size between stamps), `BrushThickness`
//!   (% of the width kept for the height of the tip), `BrushRotation` (°).
//! - `BrushPatternImageArray`: the tip materials, see [`pattern_paths`].
//!   Tools in the database refer to installed materials, which live under
//!   `CLIPStudioCommon/Material/<a>/<b>/<uuid>/` with a thumbnail of the tip.
//! - `CompositeMode` 27 is "erase"; `BrushUseVectorEraser` with
//!   `BrushVectorEraserType` (0 touched part, 1 up to intersections,
//!   2 whole line) is how it erases vector lines.

use std::path::{Path, PathBuf};

use csp_assets::subtool::blob::{
    Effector, INPUT_PRESSURE, INPUT_RANDOM, INPUT_TILT, INPUT_VELOCITY, MaterialList, Records,
};
use csp_assets::subtool::{MaterialFile, Node, SubToolDb};
use serde::Serialize;

use crate::RgbaImage;
use crate::error::{CspError, Result};
use crate::raster::{Filter, decode_png, luma, resize};
use csp_format::database::Row;

/// Largest side of the tip mask handed to the app.
pub const TIP_SIZE: u32 = 128;
/// `CompositeMode` of erasers.
const COMPOSITE_ERASE: i64 = 27;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SubToolKind {
    Pen,
    Eraser,
    /// Fills, selections, rulers and the like.
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LengthUnit {
    /// Pixels of the canvas the tool draws on.
    Px,
    Mm,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Length {
    pub value: f64,
    pub unit: LengthUnit,
}

impl Length {
    fn from_row(row: &Row, value: &str, unit: &str) -> Option<Length> {
        if !present(row, value) {
            return None;
        }
        let unit = match row.int(unit) {
            2 => LengthUnit::Mm,
            _ => LengthUnit::Px,
        };
        Some(Length {
            value: row.real(value),
            unit,
        })
    }

    pub fn to_mm(self, dpi: f64) -> f64 {
        match self.unit {
            LengthUnit::Mm => self.value,
            LengthUnit::Px => self.value * 25.4 / dpi,
        }
    }
}

/// What changes a setting while drawing (影響元設定): which inputs are on
/// (pen pressure, tilt, speed, random), the value at their lightest touch and
/// their graphs. Graph points are control points: CSP draws a smooth curve
/// through the ends that bends towards the points in between.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dynamics {
    pub pressure: bool,
    /// Value at the lightest pressure, 0..1 of the setting.
    pub pressure_min: f64,
    /// Pressure graph; empty when it is the straight line.
    pub pressure_curve: Vec<[f64; 2]>,
    pub tilt: bool,
    pub tilt_min: f64,
    pub tilt_curve: Vec<[f64; 2]>,
    pub velocity: bool,
    pub velocity_min: f64,
    pub velocity_curve: Vec<[f64; 2]>,
    pub random: bool,
    pub random_min: f64,
}

impl Dynamics {
    /// From an `…Effector` blob (csp-assets reads it); None when it is not one.
    pub fn parse(blob: &[u8]) -> Option<Dynamics> {
        let effector = Effector::parse(blob).ok()?;
        let min = |index: usize| (effector.minimum[index] as f64 / 100.0).clamp(0.0, 1.0);
        Some(Dynamics {
            pressure: effector.uses(INPUT_PRESSURE),
            pressure_min: min(0),
            pressure_curve: graph_points(effector.pressure_graph.as_ref()),
            tilt: effector.uses(INPUT_TILT),
            tilt_min: min(1),
            tilt_curve: graph_points(effector.tilt_graph.as_ref()),
            velocity: effector.uses(INPUT_VELOCITY),
            velocity_min: min(2),
            // Without a speed graph CSP thins the line as the pen speeds up:
            // the graph CSP itself saves for its own brushes (水彩丸筆,
            // にじみ墨...) is this straight line down.
            velocity_curve: match &effector.velocity_graph {
                Some(graph) => graph_points(Some(graph)),
                None => vec![[0.0, 1.0], [1.0, 0.0]],
            },
            random: effector.uses(INPUT_RANDOM),
            random_min: min(3),
        })
    }
}

/// The points of one graph, in 0..1; empty for none or the straight line.
fn graph_points(graph: Option<&Records>) -> Vec<[f64; 2]> {
    let points: Vec<[f64; 2]> = graph
        .map(|graph| {
            graph
                .points()
                .into_iter()
                .map(|[x, y]| [x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)])
                .collect()
        })
        .unwrap_or_default();
    if points == [[0.0, 0.0], [1.0, 1.0]] {
        Vec::new()
    } else {
        points
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VectorErase {
    /// 触れた部分: cut away what the eraser touches.
    Touched,
    /// 交点まで: up to where the line crosses other lines.
    Intersection,
    /// 線全体: the whole line.
    Whole,
}

/// A brush tip picture: white, with the tip's coverage in alpha.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipImage {
    pub width: u32,
    pub height: u32,
    /// PNG, base64.
    pub png_base64: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTool {
    pub name: String,
    /// Tool and group names above it (empty in a .sut).
    pub group: Vec<String>,
    pub kind: SubToolKind,
    pub size: Option<Length>,
    pub size_dynamics: Option<Dynamics>,
    /// 0..1.
    pub opacity: f64,
    pub opacity_dynamics: Option<Dynamics>,
    /// ブラシ濃度, 0..1.
    pub flow: f64,
    pub flow_dynamics: Option<Dynamics>,
    /// 0..1; 1 is a hard edge.
    pub hardness: f64,
    pub anti_alias: i64,
    /// 手ブレ補正, 0..100.
    pub stabilization: f64,
    /// 速度による手ブレ補正: steadier the faster the pen moves.
    pub stabilization_by_speed: bool,
    /// 後補正: the strength the line is smoothed with once drawn (0 when off).
    pub post_correction: f64,
    pub taper_in: Option<Length>,
    pub taper_out: Option<Length>,
    /// Stamp spacing in % of the size.
    pub interval: f64,
    /// Tip height in % of its width.
    pub thickness: f64,
    /// Tip rotation in degrees.
    pub rotation: f64,
    /// Material path of the first tip picture, as CSP stores it.
    pub tip_material: Option<String>,
    pub tip: Option<TipImage>,
    pub vector_erase: Option<VectorErase>,
}

/// Where CSP keeps its tools and materials on Windows, under `%APPDATA%`.
pub fn default_locations(appdata: &Path) -> (PathBuf, PathBuf) {
    let celsys = appdata.join("CELSYSUserData").join("CELSYS");
    (
        celsys
            .join("CLIPStudioPaintVer1_5_0")
            .join("Tool")
            .join("EditImageTool.todb"),
        celsys.join("CLIPStudioCommon").join("Material"),
    )
}

/// Read every drawing sub tool (pens, brushes, erasers) of a .sut or of CSP's
/// tool database. `material_root` resolves tips the database refers to.
pub fn read_sub_tools(path: impl AsRef<Path>, material_root: Option<&Path>) -> Result<Vec<SubTool>> {
    // Open a copy: CSP may hold the database open, and nothing is written back.
    let bytes = std::fs::read(path.as_ref())?;
    read_sub_tools_from_bytes(&bytes, material_root)
}

pub fn read_sub_tools_from_bytes(bytes: &[u8], material_root: Option<&Path>) -> Result<Vec<SubTool>> {
    if !csp_assets::subtool::looks_like(bytes) {
        return Err(CspError::format(
            "CSP のサブツール（.sut）でもツールのデータベースでもありません",
        ));
    }
    let db =
        SubToolDb::from_bytes(bytes).map_err(|error| CspError::format(format!("サブツールを読めません: {error}")))?;
    let mut tools = Vec::new();
    for entry in db.sub_tools() {
        let node = &db.nodes[entry.node];
        let Some(variant) = db.variant(node.variant_id) else {
            continue;
        };
        let kind = kind_of(node, variant);
        if kind == SubToolKind::Other || !variant.has("BrushSize") {
            continue;
        }
        tools.push(sub_tool(node, variant, entry.path, kind, &db.materials, material_root));
    }
    Ok(tools)
}

fn kind_of(node: &Node, variant: &Row) -> SubToolKind {
    let (input, output) = (node.input_op, node.output_op);
    if input == 12 || output == 12 {
        return SubToolKind::Eraser;
    }
    if matches!(output, 10 | 11 | 14) && matches!(input, 10 | 11 | 14) {
        if variant.int("CompositeMode") == COMPOSITE_ERASE {
            return SubToolKind::Eraser;
        }
        return SubToolKind::Pen;
    }
    SubToolKind::Other
}

/// Whether the column exists and is not NULL.
fn present(row: &Row, column: &str) -> bool {
    row.get(column)
        .is_some_and(|value| !matches!(value, rusqlite::types::Value::Null))
}

fn real_or(row: &Row, column: &str, default: f64) -> f64 {
    if present(row, column) {
        row.real(column)
    } else {
        default
    }
}

fn percent(row: &Row, column: &str, default: f64) -> f64 {
    (real_or(row, column, default * 100.0) / 100.0).clamp(0.0, 1.0)
}

fn sub_tool(
    node: &Node,
    variant: &Row,
    group: Vec<String>,
    kind: SubToolKind,
    materials: &[MaterialFile],
    material_root: Option<&Path>,
) -> SubTool {
    let dynamics = |column: &str| variant.blob(column).and_then(Dynamics::parse);
    let taper = |use_column: &str, length: &str, unit: &str| {
        if variant.int(use_column) != 0 {
            Length::from_row(variant, length, unit)
        } else {
            None
        }
    };
    let tip_material = if variant.int("BrushUsePatternImage") != 0 {
        variant
            .blob("BrushPatternImageArray")
            .and_then(|blob| pattern_paths(blob).into_iter().next())
    } else {
        None
    };
    let tip = tip_material
        .as_deref()
        .and_then(|path| tip_picture(path, materials, material_root))
        .and_then(|png| tip_mask(&png).ok());
    let vector_erase = (kind == SubToolKind::Eraser).then(|| {
        if variant.int("BrushUseVectorEraser") == 0 {
            return VectorErase::Touched;
        }
        match variant.int("BrushVectorEraserType") {
            1 => VectorErase::Intersection,
            2 => VectorErase::Whole,
            _ => VectorErase::Touched,
        }
    });
    SubTool {
        name: node.name.clone(),
        group,
        kind,
        size: Length::from_row(variant, "BrushSize", "BrushSizeUnit"),
        size_dynamics: dynamics("BrushSizeEffector"),
        opacity: percent(variant, "Opacity", 1.0),
        opacity_dynamics: dynamics("BrushOpacityEffector"),
        flow: percent(variant, "BrushFlow", 1.0),
        flow_dynamics: dynamics("BrushFlowEffector"),
        hardness: percent(variant, "BrushHardness", 1.0),
        anti_alias: variant.int("AntiAlias"),
        stabilization: variant.real("FlickerReduction"),
        stabilization_by_speed: variant.int("FlickerReductionBySpeed") != 0,
        post_correction: if variant.int("BrushUseRevision") != 0 {
            variant.real("BrushRevision")
        } else {
            0.0
        },
        taper_in: taper("BrushUseIn", "BrushInLength", "BrushInLengthUnit"),
        taper_out: taper("BrushUseOut", "BrushOutLength", "BrushOutLengthUnit"),
        interval: real_or(variant, "BrushInterval", 10.0),
        thickness: real_or(variant, "BrushThickness", 100.0),
        rotation: variant.real("BrushRotation"),
        tip_material,
        tip,
        vector_erase,
    }
}

/// Material paths in `BrushPatternImageArray` (csp-assets reads the list),
/// such as `.:91:20:<uuid>:data:material_0.layer` (an installed material) or
/// `.:Paint001:<uuid>:data:material.layer` (one that comes with CSP).
pub fn pattern_paths(blob: &[u8]) -> Vec<String> {
    MaterialList::parse(blob)
        .map(|list| {
            list.materials
                .into_iter()
                .map(|material| material.path.trim_end_matches('\0').to_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Folders a tip path may be in, relative to the material root:
/// `.:91:20:<uuid>:data:material_0.layer` → `91/20/<uuid>` (downloaded), and
/// `.:Paint106:<uuid>:data:…` → `Install/Paint106/<uuid>` or `Install2/…`
/// (materials that come with CSP).
pub fn material_folders(path: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = path.trim_start_matches(".:").split(':').collect();
    let Some(data) = parts.iter().position(|part| *part == "data") else {
        return Vec::new();
    };
    let folder = &parts[..data];
    if folder.is_empty()
        || folder
            .iter()
            .any(|part| part.is_empty() || part.contains(['/', '\\']) || *part == "..")
    {
        return Vec::new();
    }
    let relative: PathBuf = folder.iter().collect();
    if folder[0].starts_with("Paint") {
        ["Install", "Install2"]
            .iter()
            .map(|root| Path::new(root).join(&relative))
            .collect()
    } else {
        vec![relative]
    }
}

/// PNG of the tip: from the .sut's own materials, else from the installed one.
fn tip_picture(path: &str, materials: &[MaterialFile], material_root: Option<&Path>) -> Option<Vec<u8>> {
    let embedded = materials
        .iter()
        .filter(|material| material.original_path == path)
        .find_map(MaterialFile::thumbnail);
    if embedded.is_some() {
        return embedded;
    }
    let root = material_root?;
    material_folders(path)
        .into_iter()
        .find_map(|folder| std::fs::read(root.join(folder).join("thumbnail").join("thumbnail.png")).ok())
}

/// Turn a tip picture into a white mask: coverage is alpha times darkness,
/// so black-on-white and black-on-transparent pictures both work. Trimmed to
/// what is drawn and shrunk to at most [`TIP_SIZE`].
pub fn tip_mask(png: &[u8]) -> Result<TipImage> {
    let image = decode_png(png)?;
    let mut mask = RgbaImage::new(image.width, image.height);
    for (source, target) in image
        .pixels
        .as_chunks::<4>()
        .0
        .iter()
        .zip(mask.pixels.as_chunks_mut::<4>().0)
    {
        let darkness = 255 - luma(source[0], source[1], source[2]) as u32;
        let coverage = (darkness * source[3] as u32 / 255) as u8;
        target.copy_from_slice(&[255, 255, 255, coverage]);
    }
    let mask = match mask.alpha_bbox() {
        Some((x0, y0, x1, y1)) => crate::raster::crop(&mask, (x0 as i64, y0 as i64, x1 as i64, y1 as i64)),
        None => return Err(CspError::format("ブラシ先端の画像が空です")),
    };
    let scale = (TIP_SIZE as f64 / mask.width.max(mask.height) as f64).min(1.0);
    let width = ((mask.width as f64 * scale).round() as u32).max(1);
    let height = ((mask.height as f64 * scale).round() as u32).max(1);
    let mask = if scale < 1.0 {
        resize(&mask, width, height, Filter::Box)
    } else {
        mask
    };
    Ok(TipImage {
        width: mask.width,
        height: mask.height,
        png_base64: base64(&mask.to_png()?),
    })
}

fn base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let bytes = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let value = (bytes[0] as u32) << 16 | (bytes[1] as u32) << 8 | bytes[2] as u32;
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(TABLE[(value >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effector(header: usize, inputs: u32, min: u32, curve: &[[f64; 2]]) -> Vec<u8> {
        let mut words = vec![0u32; header / 4];
        words[0] = header as u32;
        words[1] = 0x1f0;
        words[2] = inputs;
        words[3] = min;
        words[8] = if curve.is_empty() {
            0
        } else {
            12 + 16 * curve.len() as u32
        };
        if header >= 44 {
            words[10] = 100;
        }
        let mut blob: Vec<u8> = words.iter().flat_map(|w| w.to_be_bytes()).collect();
        if !curve.is_empty() {
            for w in [12u32, curve.len() as u32, 16] {
                blob.extend(w.to_be_bytes());
            }
            for [x, y] in curve {
                blob.extend(x.to_be_bytes());
                blob.extend(y.to_be_bytes());
            }
        }
        blob
    }

    #[test]
    fn reads_pressure_settings_from_both_header_sizes() {
        let curve = [[0.0, 0.0], [0.664, 0.082], [1.0, 1.0]];
        for header in [44, 48] {
            let dynamics = Dynamics::parse(&effector(header, 0x10, 0, &curve)).unwrap();
            assert!(dynamics.pressure);
            assert_eq!(dynamics.pressure_min, 0.0);
            assert_eq!(dynamics.pressure_curve, curve.to_vec());
        }
        let off = Dynamics::parse(&effector(44, 0, 100, &[])).unwrap();
        assert!(!off.pressure);
        let straight = Dynamics::parse(&effector(44, 0x10, 20, &[[0.0, 0.0], [1.0, 1.0]])).unwrap();
        assert!(straight.pressure_curve.is_empty());
        assert_eq!(straight.pressure_min, 0.2);
        assert!(Dynamics::parse(&[0, 0, 0, 8]).is_none());
    }

    #[test]
    fn reads_tilt_speed_and_random() {
        // Laid out like CSP's own: pressure, tilt and speed graphs in a row.
        let graphs: [&[[f64; 2]]; 3] = [
            &[[0.0, 0.0], [0.5, 0.75], [1.0, 1.0]],
            &[[0.0, 1.0], [0.5, 1.0], [0.8, 0.0], [1.0, 0.0]],
            &[[0.0, 1.0], [0.005, 0.0], [1.0, 0.0]],
        ];
        let lengths: Vec<u32> = graphs.iter().map(|g| 12 + 16 * g.len() as u32).collect();
        let words = [
            48, 240, 0xf0, 30, 100, 10, 5, 0, lengths[0], lengths[1], 100, lengths[2],
        ];
        let mut blob: Vec<u8> = words.iter().flat_map(|w: &u32| w.to_be_bytes()).collect();
        for graph in graphs {
            for w in [12u32, graph.len() as u32, 16] {
                blob.extend(w.to_be_bytes());
            }
            for [x, y] in graph {
                blob.extend(x.to_be_bytes());
                blob.extend(y.to_be_bytes());
            }
        }
        let dynamics = Dynamics::parse(&blob).unwrap();
        assert!(dynamics.pressure && dynamics.tilt && dynamics.velocity && dynamics.random);
        assert_eq!(
            (
                dynamics.pressure_min,
                dynamics.tilt_min,
                dynamics.velocity_min,
                dynamics.random_min
            ),
            (0.3, 1.0, 0.1, 0.05)
        );
        assert_eq!(dynamics.pressure_curve, graphs[0].to_vec());
        assert_eq!(dynamics.tilt_curve, graphs[1].to_vec());
        assert_eq!(dynamics.velocity_curve, graphs[2].to_vec());
        // A 40-byte header has no speed graph.
        let short = Dynamics::parse(&effector(40, 0x10, 40, &[[0.0, 0.0], [0.3, 0.6], [1.0, 1.0]])).unwrap();
        assert_eq!(short.pressure_min, 0.4);
        assert_eq!(short.velocity_curve, [[0.0, 1.0], [1.0, 0.0]]);
    }

    /// A `BrushPatternImageArray` with one material, as CSP writes it.
    fn material_list(path: &str, install_path: Option<&str>) -> Vec<u8> {
        let material = csp_assets::subtool::blob::MaterialRef {
            path: path.to_owned(),
            kind: Some(2),
            name: Some(String::new()),
            flag: Some(1),
            install_path: install_path.map(str::to_owned),
            rest: Vec::new(),
        };
        MaterialList {
            materials: vec![material],
        }
        .to_bytes()
    }

    #[test]
    fn finds_tip_material_paths() {
        let path = ".:91:20:e6ae21f672-c949-8fb8-0f2b-4fd949ca57:data:material_0.layer";
        let blob = material_list(
            &format!("{path}\0"),
            Some(".:91:20:e6ae21f672-c949-8fb8-0f2b-4fd949ca57"),
        );
        assert_eq!(pattern_paths(&blob), vec![path.to_owned()]);
        assert_eq!(
            material_folders(path),
            vec![
                ["91", "20", "e6ae21f672-c949-8fb8-0f2b-4fd949ca57"]
                    .iter()
                    .collect::<PathBuf>()
            ]
        );
        assert_eq!(
            material_folders(".:Paint106:eca6:data:material_0.layer"),
            vec![
                PathBuf::from("Install/Paint106/eca6"),
                PathBuf::from("Install2/Paint106/eca6")
            ]
        );
        assert!(material_folders(".:..:x:data:a.layer").is_empty());
    }

    pub(crate) fn tar(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        for (name, data) in files {
            let mut header = [0u8; 512];
            header[..name.len()].copy_from_slice(name.as_bytes());
            let size = format!("{:011o}\0", data.len());
            header[124..136].copy_from_slice(size.as_bytes());
            header[257..263].copy_from_slice(b"ustar\0");
            out.extend(header);
            out.extend(*data);
            out.resize(out.len().div_ceil(512) * 512, 0);
        }
        out.extend([0u8; 1024]);
        out
    }

    fn tip_png() -> Vec<u8> {
        // A black dot on white, 8 x 8 with a 4 x 2 mark.
        let mut image = RgbaImage::new(8, 8);
        for (index, pixel) in image.pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let (x, y) = (index % 8, index / 8);
            let ink = (2..6).contains(&x) && (3..5).contains(&y);
            pixel.copy_from_slice(if ink { &[0, 0, 0, 255] } else { &[255, 255, 255, 255] });
        }
        image.to_png().unwrap()
    }

    #[test]
    fn tip_mask_keeps_the_mark_only() {
        let mask = tip_mask(&tip_png()).unwrap();
        assert_eq!((mask.width, mask.height), (4, 2));
        assert!(mask.png_base64.starts_with("iVBORw0KGgo"));
    }

    #[test]
    fn base64_matches_known_values() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    /// A .sut like the ones CSP writes: one node, its variant, one material.
    fn sut(name: &str, input: i64, composite: i64, vector_eraser: Option<i64>) -> Vec<u8> {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE Manager(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, ToolType INTEGER, Version INTEGER, RootUuid BLOB);
                 CREATE TABLE Node(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, NodeUuid BLOB, NodeName TEXT, NodeInputOp INTEGER, NodeOutputOp INTEGER, NodeFirstChildUuid BLOB, NodeNextUuid BLOB, NodeVariantID INTEGER);
                 CREATE TABLE Variant(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, VariantID INTEGER, Opacity INTEGER, CompositeMode INTEGER, FlickerReduction INTEGER, BrushSize REAL, BrushSizeUnit INTEGER, BrushSizeEffector BLOB, BrushHardness INTEGER, BrushUsePatternImage INTEGER, BrushPatternImageArray BLOB, BrushUseIn INTEGER, BrushInLength REAL, BrushInLengthUnit INTEGER, BrushUseOut INTEGER, BrushOutLength REAL, BrushOutLengthUnit INTEGER, BrushUseVectorEraser INTEGER, BrushVectorEraserType INTEGER, FlickerReductionBySpeed INTEGER, BrushUseRevision INTEGER, BrushRevision INTEGER);
                 CREATE TABLE MaterialFile(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, InstallFolder INTEGER, OriginalPath TEXT, OldMaterial INTEGER, FileData BLOB, CatalogPath TEXT, MaterialUuid TEXT);",
            )
            .unwrap();
        let uuid = [7u8; 16];
        connection
            .execute(
                "INSERT INTO Manager(ToolType, Version, RootUuid) VALUES (0, 145, ?1)",
                [&uuid[..]],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO Node(NodeUuid, NodeName, NodeInputOp, NodeOutputOp, NodeFirstChildUuid, NodeNextUuid, NodeVariantID) VALUES (?1, ?2, ?3, ?3, X'00', X'00', 87)",
                rusqlite::params![&uuid[..], name, input],
            )
            .unwrap();
        let path = ".:91:20:abc:data:material_0.layer";
        let pattern = material_list(path, None);
        connection
            .execute(
                "INSERT INTO Variant VALUES (NULL, 87, 80, ?1, 6, 5.0, 0, ?2, 100, 1, ?3, 1, 20.0, 0, 1, 1.5, 2, ?4, ?5, 1, 1, 30)",
                rusqlite::params![
                    composite,
                    effector(48, 0x10, 10, &[[0.0, 0.0], [0.6, 0.1], [1.0, 1.0]]),
                    pattern,
                    vector_eraser.is_some() as i64,
                    vector_eraser.unwrap_or(0)
                ],
            )
            .unwrap();
        connection
            .execute("INSERT INTO Variant(VariantID) VALUES (88)", [])
            .unwrap();
        connection
            .execute(
                "INSERT INTO MaterialFile(InstallFolder, OriginalPath, FileData) VALUES (0, ?1, ?2)",
                rusqlite::params![path, tar(&[("thumbnail/thumbnail.png", &tip_png())])],
            )
            .unwrap();
        connection.serialize(rusqlite::MAIN_DB).unwrap().to_vec()
    }

    #[test]
    fn reads_a_pen_from_a_sut() {
        let tools = read_sub_tools_from_bytes(&sut("丸ペン", 11, 0, None), None).unwrap();
        assert_eq!(tools.len(), 1);
        let pen = &tools[0];
        assert_eq!(pen.name, "丸ペン");
        assert_eq!(pen.kind, SubToolKind::Pen);
        assert_eq!(
            pen.size,
            Some(Length {
                value: 5.0,
                unit: LengthUnit::Px
            })
        );
        assert!((pen.size.unwrap().to_mm(600.0) - 5.0 * 25.4 / 600.0).abs() < 1e-9);
        let size = pen.size_dynamics.as_ref().unwrap();
        assert!(size.pressure);
        assert_eq!(size.pressure_min, 0.1);
        assert_eq!(size.pressure_curve.len(), 3);
        assert_eq!(pen.opacity, 0.8);
        assert_eq!(pen.stabilization, 6.0);
        assert!(pen.stabilization_by_speed);
        assert_eq!(pen.post_correction, 30.0);
        assert_eq!(
            pen.taper_in,
            Some(Length {
                value: 20.0,
                unit: LengthUnit::Px
            })
        );
        assert_eq!(
            pen.taper_out,
            Some(Length {
                value: 1.5,
                unit: LengthUnit::Mm
            })
        );
        assert_eq!(pen.tip_material.as_deref(), Some(".:91:20:abc:data:material_0.layer"));
        assert_eq!(pen.tip.as_ref().map(|tip| (tip.width, tip.height)), Some((4, 2)));
        assert_eq!(pen.vector_erase, None);
    }

    #[test]
    fn reads_erasers() {
        let eraser = &read_sub_tools_from_bytes(&sut("硬め", 12, COMPOSITE_ERASE, Some(1)), None).unwrap()[0];
        assert_eq!(eraser.kind, SubToolKind::Eraser);
        assert_eq!(eraser.vector_erase, Some(VectorErase::Intersection));
        let soft = &read_sub_tools_from_bytes(&sut("軟らかめ", 10, COMPOSITE_ERASE, None), None).unwrap()[0];
        assert_eq!(soft.kind, SubToolKind::Eraser);
        assert_eq!(soft.vector_erase, Some(VectorErase::Touched));
    }

    #[test]
    fn skips_tools_that_do_not_draw() {
        assert!(
            read_sub_tools_from_bytes(&sut("塗りつぶし", 50, 0, None), None)
                .unwrap()
                .is_empty()
        );
        assert!(read_sub_tools_from_bytes(b"not sqlite", None).is_err());
    }

    /// Real files from CSP, when CSP_SUBTOOL_SAMPLES names a folder of them
    /// (.sut and EditImageTool.todb). Artwork-free, but not in the repository.
    #[test]
    fn reads_real_sub_tools_when_available() {
        let Some(folder) = std::env::var_os("CSP_SUBTOOL_SAMPLES") else {
            return;
        };
        for entry in std::fs::read_dir(folder).unwrap().flatten() {
            let path = entry.path();
            let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(extension, "sut" | "todb") {
                continue;
            }
            let tools = read_sub_tools(&path, None).unwrap();
            assert!(!tools.is_empty(), "{}", path.display());
            // A few (ドットペン) leave the size to the tool above them.
            let sized = tools.iter().filter(|tool| tool.size.is_some()).count();
            assert!(sized * 10 >= tools.len() * 9, "{}", path.display());
        }
    }
}
