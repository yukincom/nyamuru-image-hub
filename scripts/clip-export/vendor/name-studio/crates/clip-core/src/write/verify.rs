//! 書き出しの自己確認: read a written page or work back and check it holds
//! what was meant to go in, and none of the faults CSP has shown before.
//!
//! The checks come from what went wrong on opening pages in CSP: vector
//! layers that opened empty (no `Canvas.BrushStyleManager`), white text drawn
//! black (the font run's own colour wins over the text colour), text stored
//! as TEXT instead of a blob (CSP shows garbage) and works whose page links
//! point nowhere. On top of these, csp-format's own self-check looks at the
//! container, the database, the pixel blocks, vectors and text as CSP
//! stores them. Messages are in Japanese for the user.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::raster_page::{PageLayer, TemplateCanvas};
use crate::clip::{ClipDocument, ClipLayer, LayerKind};
use crate::cmc::CmcProject;
use crate::text::text_color;
use crate::vector::brush_style_of;

/// What one written layer should hold, without its pixels.
#[derive(Debug, Clone, PartialEq)]
pub enum ExpectedLayer {
    /// A raster layer; `bbox` is where its opaque pixels are, in page
    /// pixels (None for an empty layer).
    Raster {
        name: String,
        bbox: Option<[f64; 4]>,
    },
    Vector {
        name: String,
        lines: usize,
    },
    Text {
        text: String,
        color: Option<[u8; 3]>,
    },
    /// A コマ枠フォルダー with this many frames, holding the `ink` layer.
    Frames {
        name: String,
        frames: usize,
        ink: Option<String>,
    },
    /// A folder (with a layer mask that hides part of it, if `mask`) holding these layers.
    Folder {
        name: String,
        mask: bool,
        children: Vec<ExpectedLayer>,
    },
}

impl ExpectedLayer {
    /// What `layer` should look like once written onto a `width` × `height` page.
    pub fn of(layer: &PageLayer, width: u32, height: u32) -> Self {
        match layer {
            PageLayer::Raster(raster) => {
                let (sx, sy) = (
                    f64::from(width) / f64::from(raster.image.width.max(1)),
                    f64::from(height) / f64::from(raster.image.height.max(1)),
                );
                ExpectedLayer::Raster {
                    name: raster.name.clone(),
                    bbox: raster.image.alpha_bbox().map(|(x0, y0, x1, y1)| {
                        [
                            f64::from(x0) * sx,
                            f64::from(y0) * sy,
                            f64::from(x1) * sx,
                            f64::from(y1) * sy,
                        ]
                    }),
                }
            }
            PageLayer::Vector { name, lines } => ExpectedLayer::Vector {
                name: name.clone(),
                lines: lines.iter().filter(|line| line.points.len() >= 2).count(),
            },
            PageLayer::Text(text) => ExpectedLayer::Text {
                text: text.stored_text(),
                color: text.color,
            },
            PageLayer::Frames { name, frames, ink } => ExpectedLayer::Frames {
                name: name.clone(),
                frames: frames.iter().filter(|frame| frame.points.len() >= 3).count(),
                ink: ink.clone(),
            },
            PageLayer::Folder { name, mask, children } => ExpectedLayer::Folder {
                name: name.clone(),
                mask: mask.is_some(),
                children: children.iter().map(|child| Self::of(child, width, height)).collect(),
            },
        }
    }

    fn describe(&self) -> String {
        match self {
            ExpectedLayer::Raster { name, .. }
            | ExpectedLayer::Vector { name, .. }
            | ExpectedLayer::Frames { name, .. } => format!("レイヤー「{name}」"),
            ExpectedLayer::Folder { name, .. } => format!("フォルダー「{name}」"),
            ExpectedLayer::Text { text, .. } => {
                let first: String = text.lines().next().unwrap_or_default().chars().take(16).collect();
                format!("セリフ「{first}」")
            }
        }
    }
}

/// The result of checking one file.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheck {
    pub path: PathBuf,
    /// Empty when everything is as meant.
    pub problems: Vec<String>,
    pub layers: usize,
    pub vector_lines: usize,
    pub texts: usize,
}

impl FileCheck {
    pub fn ok(&self) -> bool {
        self.problems.is_empty()
    }
}

/// Raster pixels are stored in 256 px blocks, so the stored area of a layer
/// is up to a block larger than its pixels; resampling adds a fringe.
const BLOCK: f64 = 256.0;
const FRINGE: f64 = 8.0;

/// Check a page written by [`super::raster_page::write_name_page`]: the
/// `expected` layers are the last ones of the page, in order.
pub fn verify_page(path: &Path, expected: &[ExpectedLayer], canvas: &TemplateCanvas) -> FileCheck {
    let mut check = FileCheck {
        path: path.to_path_buf(),
        ..FileCheck::default()
    };
    let document = match ClipDocument::read(path) {
        Ok(document) => document,
        Err(error) => {
            check.problems.push(format!("読み直せません: {error}"));
            return check;
        }
    };
    check_document(&document, &mut check);
    let size = (document.canvas.width_px, document.canvas.height_px);
    if size != (i64::from(canvas.width_px), i64::from(canvas.height_px)) {
        check.problems.push(format!(
            "キャンバスの大きさが {}×{} px（ひな形は {}×{} px）",
            size.0, size.1, canvas.width_px, canvas.height_px
        ));
    }
    let children = &document.root.children;
    if children.len() < expected.len() {
        check.problems.push(format!(
            "レイヤーが {} 枚しかありません（書いたのは {} 枚）",
            children.len(),
            expected.len()
        ));
        return check;
    }
    let written = &children[children.len() - expected.len()..];
    for (layer, expected) in written.iter().zip(expected) {
        check_layer(&document, layer, expected, &mut check.problems);
    }
    check
}

fn check_layer(document: &ClipDocument, layer: &ClipLayer, expected: &ExpectedLayer, problems: &mut Vec<String>) {
    let what = expected.describe();
    match expected {
        ExpectedLayer::Raster { name, bbox } => {
            if layer.kind != LayerKind::Raster || layer.name != *name {
                problems.push(format!(
                    "{what}の場所に「{}」（{}）があります",
                    layer.name,
                    layer.kind.as_str()
                ));
                return;
            }
            let blocks = match document.occupied_pixel_boxes(layer) {
                Ok(blocks) => blocks,
                Err(error) => {
                    problems.push(format!("{what}の画素を読めません: {error}"));
                    return;
                }
            };
            let stored = blocks.iter().fold(None, |acc: Option<[f64; 4]>, &(x0, y0, x1, y1)| {
                let block = [x0 as f64, y0 as f64, x1 as f64, y1 as f64];
                Some(match acc {
                    None => block,
                    Some(a) => [
                        a[0].min(block[0]),
                        a[1].min(block[1]),
                        a[2].max(block[2]),
                        a[3].max(block[3]),
                    ],
                })
            });
            match (bbox, stored) {
                (None, None) => {}
                // Stored blocks may all be transparent (as in a CSP-made empty layer).
                (None, Some(_)) => {
                    let drawn = document
                        .render_layer_pixels(layer)
                        .map(|image| image.and_then(|image| image.alpha_bbox()));
                    if !matches!(drawn, Ok(None)) {
                        problems.push(format!("{what}は空のはずが、絵が入っています"));
                    }
                }
                (Some(_), None) => problems.push(format!("{what}が空です（絵が入っていません）")),
                (Some(meant), Some(stored)) => {
                    let inside = stored[0] <= meant[0] + FRINGE
                        && stored[1] <= meant[1] + FRINGE
                        && stored[2] >= meant[2] - FRINGE
                        && stored[3] >= meant[3] - FRINGE;
                    let near = stored[0] >= meant[0] - BLOCK - FRINGE
                        && stored[1] >= meant[1] - BLOCK - FRINGE
                        && stored[2] <= meant[2] + BLOCK + FRINGE
                        && stored[3] <= meant[3] + BLOCK + FRINGE;
                    // Blocks are kept even when transparent, so look at the pixels there.
                    let region = (
                        meant[0].floor() as i64,
                        meant[1].floor() as i64,
                        meant[2].ceil() as i64,
                        meant[3].ceil() as i64,
                    );
                    let drawn = document
                        .layer_pixels_in_box(layer, region)
                        .is_ok_and(|image| image.alpha_bbox().is_some());
                    if !(inside && near) {
                        problems.push(format!(
                            "{what}の絵の位置がずれています（{:.0},{:.0}–{:.0},{:.0} のはずが {:.0},{:.0}–{:.0},{:.0}）",
                            meant[0], meant[1], meant[2], meant[3], stored[0], stored[1], stored[2], stored[3]
                        ));
                    } else if !drawn {
                        problems.push(format!("{what}が空です（絵が入っていません）"));
                    }
                }
            }
        }
        ExpectedLayer::Vector { name, lines } => {
            if layer.kind != LayerKind::Vector || layer.name != *name {
                problems.push(format!(
                    "{what}の場所に「{}」（{}）があります",
                    layer.name,
                    layer.kind.as_str()
                ));
                return;
            }
            match document.vector_objects(layer) {
                Ok(objects) => {
                    if objects.len() != *lines {
                        problems.push(format!("{what}の線が {} 本（書いたのは {lines} 本）", objects.len()));
                    }
                    if objects
                        .iter()
                        .any(|object| object.points.len() < 2 || object.brush_size <= 0.0)
                    {
                        problems.push(format!("{what}に点や太さのない線があります"));
                    }
                }
                Err(error) => problems.push(format!("{what}の線を読めません: {error}")),
            }
        }
        ExpectedLayer::Frames { name, frames, ink } => {
            if layer.kind != LayerKind::FrameFolder || layer.name != *name {
                problems.push(format!(
                    "{what}の場所に「{}」（{}）があります",
                    layer.name,
                    layer.kind.as_str()
                ));
                return;
            }
            match document.vector_objects(layer) {
                Ok(objects) if objects.len() != *frames => {
                    problems.push(format!("{what}のコマが {} 個（書いたのは {frames} 個）", objects.len()))
                }
                Ok(objects) if objects.iter().any(|object| object.points.len() < 3 || !object.closed()) => {
                    problems.push(format!("{what}に閉じていないコマがあります"))
                }
                Ok(_) => {}
                Err(error) => problems.push(format!("{what}のコマを読めません: {error}")),
            }
            let row = document.layer_row(layer.main_id);
            if !layer.has_mask || row.is_none_or(|row| row.int("ComicFrameLineMipmap") == 0) {
                problems.push(format!("{what}にマスクか枠線の画像がありません"));
            }
            let inside: Vec<&str> = layer.children.iter().map(|child| child.name.as_str()).collect();
            if let Some(ink) = ink
                && inside != [ink.as_str()]
            {
                problems.push(format!("{what}の中に「{ink}」がありません（{inside:?}）"));
            }
        }
        ExpectedLayer::Folder { name, mask, children } => {
            if layer.kind != LayerKind::Folder || layer.name != *name {
                problems.push(format!(
                    "{what}の場所に「{}」（{}）があります",
                    layer.name,
                    layer.kind.as_str()
                ));
                return;
            }
            if *mask {
                let shown = document
                    .layer_row(layer.main_id)
                    .is_some_and(|row| row.int("LayerVisibility") & 2 != 0);
                match document.layer_mask_pixels(layer) {
                    Ok(Some(image)) if image.alpha_bbox().is_some() && shown => {}
                    Ok(_) => problems.push(format!("{what}のマスクが空か、使われていません")),
                    Err(error) => problems.push(format!("{what}のマスクを読めません: {error}")),
                }
            } else if layer.has_mask {
                problems.push(format!("{what}に要らないマスクがあります"));
            }
            if layer.children.len() != children.len() {
                let inside: Vec<&str> = layer.children.iter().map(|child| child.name.as_str()).collect();
                problems.push(format!(
                    "{what}の中が {inside:?} です（書いたのは {} 枚）",
                    children.len()
                ));
                return;
            }
            for (child, expected) in layer.children.iter().zip(children) {
                check_layer(document, child, expected, problems);
            }
        }
        ExpectedLayer::Text { text, color } => {
            if layer.kind != LayerKind::Text {
                problems.push(format!(
                    "{what}の場所に「{}」（{}）があります",
                    layer.name,
                    layer.kind.as_str()
                ));
                return;
            }
            let strings = document.text_strings(layer);
            if strings.first() != Some(text) {
                problems.push(format!("{what}の文字が違います: {:?}", strings.first()));
            }
            let row = document.layer_row(layer.main_id);
            if let Some(attributes) = row.and_then(|row| row.blob("TextLayerAttributes")) {
                match (text_color(attributes), color) {
                    (Ok(drawn), Some(meant)) if drawn != Some(*meant) => problems.push(format!(
                        "{what}の色が {} です（{} のはず）",
                        drawn.map_or("不明".to_owned(), hex),
                        hex(*meant)
                    )),
                    (Err(error), _) => problems.push(format!("{what}の書式を読めません: {error}")),
                    _ => {}
                }
            } else {
                problems.push(format!("{what}に書式（TextLayerAttributes）がありません"));
            }
        }
    }
}

fn hex(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

/// Checks that need no knowledge of what was written: faults CSP has shown.
/// csp-format's self-check of the file as stored: what it finds wrong, in
/// a few words each. Blocks are decoded but not compressed again (slow on
/// large pages; written blocks use CSP's zlib settings already).
fn format_problems(path: &Path) -> Vec<String> {
    let data = match std::fs::read(path) {
        Ok(data) => data,
        Err(error) => return vec![format!("読み直せません: {error}")],
    };
    let options = csp_format::verify::CheckOptions {
        decode_pixels: true,
        reencode_pixels: false,
    };
    let report = csp_format::verify::check_clip(data, options);
    if report.ok() {
        return Vec::new();
    }
    let mut problems: Vec<String> = report.errors.iter().map(|error| format!("CSP 形式: {error}")).collect();
    let (container, pixels) = (&report.container, &report.pixels);
    let mut found = |broken: bool, what: &str| {
        if broken {
            problems.push(format!("CSP 形式: {what}"));
        }
    };
    found(
        !container.findings.is_empty(),
        &format!("ファイルの構造 {}", container.findings.join(" / ")),
    );
    found(
        !container.reassembles || !container.writer_reproduces || !container.external_offsets_match,
        "ファイルの組み立てが CSP と違います",
    );
    found(!container.external_ids_text, "外部データの id の型が違います");
    found(
        !report.database.unreadable_tables.is_empty(),
        &format!("読めない表 {:?}", report.database.unreadable_tables),
    );
    found(
        report.layers.unreachable > 0 || report.layers.tree_error.is_some(),
        "レイヤーのつながりが壊れています",
    );
    found(
        pixels.attribute_errors
            + pixels.attribute_round_trip_failures
            + pixels.payload_errors
            + pixels.payload_round_trip_failures
            > 0,
        "画素の記録が読めません",
    );
    found(
        pixels.block_size_table_mismatches > 0,
        "画素のブロックの大きさの表が合いません",
    );
    found(
        pixels.checksum_mismatches + pixels.decode_errors > 0,
        &format!(
            "画素のブロックが壊れています（{}）",
            pixels.first_error.as_deref().unwrap_or("")
        ),
    );
    found(
        report.references.unreferenced_chunks > 0,
        "どこからも使われない外部データがあります",
    );
    found(
        report.vectors.parse_errors + report.vectors.round_trip_failures > 0,
        &format!(
            "ベクターの記録（{}）",
            report.vectors.first_error.as_deref().unwrap_or("")
        ),
    );
    found(
        report.texts.parse_errors + report.texts.round_trip_failures > 0,
        &format!(
            "テキストの記録（{}）",
            report.texts.first_error.as_deref().unwrap_or("")
        ),
    );
    found(
        report.effects.parse_errors + report.effects.round_trip_failures > 0,
        "レイヤー効果の記録",
    );
    found(report.preview_error.is_some(), "サムネイルを読めません");
    found(!report.unchanged_save_identical, "そのまま保存し直すと中身が変わります");
    problems
}

fn check_document(document: &ClipDocument, check: &mut FileCheck) {
    check.problems.extend(format_problems(&document.path));
    let database = document.database();
    let layers = document.layers();
    check.layers = layers.len();
    let mut brush_styles = Vec::new();
    for layer in &layers {
        match layer.kind {
            LayerKind::Vector => match document.vector_objects(layer) {
                Ok(objects) => {
                    check.vector_lines += objects.len();
                    if let Ok(payloads) = document.vector_payloads(layer) {
                        brush_styles.extend(
                            payloads
                                .iter()
                                .filter_map(|payload| brush_style_of(payload).ok().flatten()),
                        );
                    }
                }
                Err(error) => check
                    .problems
                    .push(format!("ベクターレイヤー「{}」の線を読めません: {error}", layer.name)),
            },
            LayerKind::FrameFolder => match document.vector_payloads(layer) {
                Ok(payloads) => brush_styles.extend(
                    payloads
                        .iter()
                        .filter_map(|payload| crate::vector::frame_template_of(payload))
                        .map(|frame| frame.brush_style()),
                ),
                Err(error) => check
                    .problems
                    .push(format!("コマ枠フォルダー「{}」のコマを読めません: {error}", layer.name)),
            },
            LayerKind::Text => {
                check.texts += 1;
                let stored: Option<rusqlite::types::Value> = database
                    .query_row(
                        "SELECT TextLayerString FROM Layer WHERE MainId = ?1",
                        [layer.main_id],
                        |row| row.get(0),
                    )
                    .ok();
                if matches!(stored, Some(rusqlite::types::Value::Text(_))) {
                    check.problems.push(format!(
                        "テキストレイヤー「{}」の文字が TEXT 型です（CSP では文字化けします）",
                        layer.name
                    ));
                }
            }
            _ => {}
        }
    }
    if !brush_styles.is_empty() {
        let manager: Option<i64> = database
            .query_row("SELECT BrushStyleManager FROM Canvas", [], |row| row.get(0))
            .ok()
            .flatten();
        let managed = manager.is_some_and(|id| {
            database
                .query_row(
                    "SELECT COUNT(*) FROM BrushStyleManager WHERE MainId = ?1",
                    [id],
                    |row| row.get::<_, i64>(0),
                )
                .is_ok_and(|count| count == 1)
        });
        if !managed {
            check
                .problems
                .push("Canvas.BrushStyleManager がありません（CSP ではベクターの線が見えなくなります）".to_owned());
        }
        brush_styles.sort_unstable();
        brush_styles.dedup();
        for style in brush_styles {
            let found = database
                .query_row("SELECT COUNT(*) FROM BrushStyle WHERE MainId = ?1", [style], |row| {
                    row.get::<_, i64>(0)
                })
                .is_ok_and(|count| count > 0);
            if !found {
                check.problems.push(format!(
                    "ベクターの線が使うブラシ（BrushStyle {style}）がファイルにありません"
                ));
            }
        }
    }
    if document.preview_png.is_none() {
        check.problems.push("サムネイルがありません".to_owned());
    }
}

/// Check any .clip without knowing what was meant to be in it.
pub fn check_clip(path: &Path) -> FileCheck {
    let mut check = FileCheck {
        path: path.to_path_buf(),
        ..FileCheck::default()
    };
    match ClipDocument::read(path) {
        Ok(document) => check_document(&document, &mut check),
        Err(error) => check.problems.push(format!("読めません: {error}")),
    }
    check
}

/// Check a work: it reads, and lists exactly `pages` (when given) in order,
/// each link pointing at a file next to it.
pub fn verify_work(path: &Path, pages: Option<&[PathBuf]>) -> FileCheck {
    let mut check = FileCheck {
        path: path.to_path_buf(),
        ..FileCheck::default()
    };
    let project = match CmcProject::read(path) {
        Ok(project) => project,
        Err(error) => {
            check.problems.push(format!("作品ファイルを読めません: {error}"));
            return check;
        }
    };
    check.layers = project.pages.len();
    let folder = path.parent().unwrap_or(Path::new("."));
    for page in &project.pages {
        if !folder.join(&page.file_name).is_file() {
            check.problems.push(format!(
                "{} ページ目のファイル {} がありません",
                page.order + 1,
                page.file_name
            ));
        }
    }
    if let Some(pages) = pages {
        let listed: Vec<&str> = project.pages.iter().map(|page| page.file_name.as_str()).collect();
        let written: Vec<String> = pages
            .iter()
            .filter_map(|page| page.file_name().map(|name| name.to_string_lossy().into_owned()))
            .collect();
        if listed != written.iter().map(String::as_str).collect::<Vec<_>>() {
            check.problems.push(format!(
                "作品のページの並びが書き出したものと違います（作品 {} ページ、書き出し {} ページ）",
                listed.len(),
                written.len()
            ));
        }
    }
    check
}
