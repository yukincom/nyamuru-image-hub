//! Plan how a name sheet is split into pages, keeping its layers.
//!
//! Port of `split_plan.py`. Before any .clip is written, every page cell
//! gets the layers (and parts of them) that belong to it, and the transform
//! from sheet to page pixels. By default each cell's inner frame is scaled
//! uniformly onto the page's basic frame (基本枠), centred; `Fit::Trim` uses
//! the trim frame and `Fit::Cell` fits the whole cell into the canvas.
//!
//! - raster layers: every cell one of their stored 256 px blocks touches
//!   gets a crop of the layer;
//! - vector layers: each object goes to the cell holding its bbox centre;
//!   layers made only of the template rectangles are left out;
//! - text layers: each block with an absolute bbox goes to the cell holding
//!   its centre. Blocks inside balloons store a bbox relative to an
//!   unidentified anchor, so such a layer follows its balloons and is copied
//!   whole when they fall in several cells (with a warning).

use std::collections::BTreeMap;

use serde::Serialize;

use crate::clip::{ClipDocument, ClipLayer, LayerKind};
use crate::error::Result;
use crate::layout::{
    PageCell, ReadingOrder, Rect, as_rectangle, detect_page_cells, find_rectangles, template_rectangles,
};

const EDGE_TOLERANCE_PX: f64 = 3.0;

pub type Box4 = (f64, f64, f64, f64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Basic,
    Trim,
    Cell,
}

/// Maps sheet pixels to page pixels: `page = sheet * scale + d`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct CellTransform {
    pub scale: f64,
    pub dx: f64,
    pub dy: f64,
}

impl CellTransform {
    pub fn map_box(&self, b: Box4) -> Box4 {
        (
            b.0 * self.scale + self.dx,
            b.1 * self.scale + self.dy,
            b.2 * self.scale + self.dx,
            b.3 * self.scale + self.dy,
        )
    }
}

/// The part of one source layer that goes onto a page.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlannedContent {
    pub layer_id: i64,
    pub name: String,
    pub kind: LayerKind,
    pub folder_path: Vec<String>,
    pub folder_ids: Vec<i64>,
    pub crop: Option<Box4>,
    pub items: Vec<usize>,
    pub whole_layer: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlannedPage {
    pub number: i64,
    pub cell: PageCell,
    pub transform: CellTransform,
    pub contents: Vec<PlannedContent>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetPlan {
    pub page_width: i64,
    pub page_height: i64,
    pub pages: Vec<PlannedPage>,
    pub fit: Fit,
    pub trim: Option<Rect>,
    pub basic: Option<Rect>,
    pub template_layer_ids: Vec<i64>,
    pub warnings: Vec<String>,
}

impl SheetPlan {
    /// The page frame each cell's inner frame is mapped onto (None for `Fit::Cell`).
    pub fn target(&self) -> Option<Rect> {
        match self.fit {
            Fit::Basic => self.basic.or(self.trim),
            Fit::Trim => self.trim,
            Fit::Cell => None,
        }
    }
}

/// Uniformly scale `cell` to fit the page canvas, centred.
pub fn fit_cell(cell: &Rect, page_width: f64, page_height: f64) -> CellTransform {
    let scale = (page_width / cell.width()).min(page_height / cell.height());
    CellTransform {
        scale,
        dx: (page_width - cell.width() * scale) / 2.0 - cell.x0 * scale,
        dy: (page_height - cell.height() * scale) / 2.0 - cell.y0 * scale,
    }
}

/// Uniformly scale a cell's inner `frame` onto the page frame `target`, centred.
pub fn fit_frame(frame: &Rect, target: &Rect) -> CellTransform {
    let scale = (target.width() / frame.width()).min(target.height() / frame.height());
    let (frame_x, frame_y) = frame.center();
    let (target_x, target_y) = target.center();
    CellTransform {
        scale,
        dx: target_x - frame_x * scale,
        dy: target_y - frame_y * scale,
    }
}

/// A page frame (trim or basic) centred on the canvas, moved by `offset` px.
pub fn centered_frame(page_width: i64, page_height: i64, size: (i64, i64), offset: (i64, i64)) -> Rect {
    let x0 = (page_width - size.0) as f64 / 2.0 + offset.0 as f64;
    let y0 = (page_height - size.1) as f64 / 2.0 + offset.1 as f64;
    Rect::new(x0, y0, x0 + size.0 as f64, y0 + size.1 as f64)
}

/// Options of [`plan_sheet`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlanOptions {
    pub order: ReadingOrder,
    pub first_page: i64,
    pub fit: Fit,
    pub trim: Option<Rect>,
    pub basic: Option<Rect>,
}

impl Default for PlanOptions {
    fn default() -> Self {
        PlanOptions {
            order: ReadingOrder::RightToLeft,
            first_page: 1,
            fit: Fit::Basic,
            trim: None,
            basic: None,
        }
    }
}

/// Build the split plan of one name sheet for pages of `page_width` x `page_height` px.
pub fn plan_sheet(
    document: &ClipDocument,
    page_width: i64,
    page_height: i64,
    options: PlanOptions,
) -> Result<SheetPlan> {
    let rects = find_rectangles(document)?;
    let cells = detect_page_cells(
        &rects,
        document.canvas.width_px as f64,
        document.canvas.is_double_page,
        options.order,
    );
    let mut plan = SheetPlan {
        page_width,
        page_height,
        pages: Vec::new(),
        fit: options.fit,
        trim: options.trim,
        basic: options.basic,
        template_layer_ids: Vec::new(),
        warnings: Vec::new(),
    };
    if options.fit == Fit::Basic && options.basic.is_none() && options.trim.is_some() {
        plan.warnings
            .push("ひな形に基本枠の大きさがないため、内枠を仕上がり線に合わせました".into());
    }
    if options.fit != Fit::Cell && plan.target().is_none() {
        let name = if options.fit == Fit::Basic {
            "基本枠"
        } else {
            "仕上がり線"
        };
        plan.warnings.push(format!(
            "ひな形に{name}の大きさがないため、ページ枠全体をキャンバスに収めました"
        ));
    }
    if cells.is_empty() {
        plan.warnings
            .push("ページ枠が見つかりません（同じ大きさのベクターの四角形が繰り返し描かれていません）".into());
        return Ok(plan);
    }
    let template = template_rectangles(&rects);
    let mut per_cell: BTreeMap<usize, Vec<PlannedContent>> =
        cells.iter().map(|cell| (cell.index, Vec::new())).collect();
    let mut layers = Vec::new();
    leaf_layers(&document.root.children, &[], true, &mut layers);
    for (layer, path) in layers {
        if layer.kind == LayerKind::Vector && is_template_layer(document, layer, &template)? {
            plan.template_layer_ids.push(layer.main_id);
            continue;
        }
        for (index, content) in assign(document, layer, &path, &cells, &mut plan.warnings)? {
            per_cell.get_mut(&index).expect("cell index").push(content);
        }
    }
    let target = plan.target();
    for cell in &cells {
        let transform = match (target, &cell.frame) {
            (Some(target), Some(frame)) => fit_frame(frame, &target),
            _ => fit_cell(&cell.rect, page_width as f64, page_height as f64),
        };
        plan.pages.push(PlannedPage {
            number: options.first_page + cell.index as i64 - 1,
            cell: cell.clone(),
            transform,
            contents: per_cell.remove(&cell.index).unwrap_or_default(),
        });
    }
    if target.is_some() && cells.iter().any(|cell| cell.frame.is_none()) {
        plan.warnings
            .push("内枠のないページ枠は、枠全体をキャンバスに収めました".into());
    }
    Ok(plan)
}

fn leaf_layers<'a>(
    layers: &'a [ClipLayer],
    path: &[&'a ClipLayer],
    visible: bool,
    result: &mut Vec<(&'a ClipLayer, Vec<&'a ClipLayer>)>,
) {
    for layer in layers {
        if matches!(layer.kind, LayerKind::Paper | LayerKind::StoryInfo) {
            continue;
        }
        if layer.kind.is_folder() {
            let mut inner = path.to_vec();
            inner.push(layer);
            leaf_layers(&layer.children, &inner, visible && layer.visible, result);
        } else if visible && layer.visible {
            result.push((layer, path.to_vec()));
        }
    }
}

fn near(a: &Rect, b: &Rect) -> bool {
    [(a.x0, b.x0), (a.y0, b.y0), (a.x1, b.x1), (a.y1, b.y1)]
        .iter()
        .all(|(p, q)| {
            ((p * 100.0).round_ties_even() / 100.0 - (q * 100.0).round_ties_even() / 100.0).abs() <= EDGE_TOLERANCE_PX
        })
}

fn is_template_layer(document: &ClipDocument, layer: &ClipLayer, template: &[Rect]) -> Result<bool> {
    let objects = document.vector_objects(layer)?;
    if objects.is_empty() {
        return Ok(false);
    }
    let (dx, dy) = (layer.offset_x as f64, layer.offset_y as f64);
    Ok(objects.iter().all(|object| {
        as_rectangle(object).is_some_and(|rect| {
            let moved = Rect::new(rect.x0 + dx, rect.y0 + dy, rect.x1 + dx, rect.y1 + dy);
            template.iter().any(|other| near(&moved, other))
        })
    }))
}

fn content(layer: &ClipLayer, path: &[&ClipLayer]) -> PlannedContent {
    PlannedContent {
        layer_id: layer.main_id,
        name: layer.name.clone(),
        kind: layer.kind,
        folder_path: path.iter().map(|folder| folder.name.clone()).collect(),
        folder_ids: path.iter().map(|folder| folder.main_id).collect(),
        crop: None,
        items: Vec::new(),
        whole_layer: false,
    }
}

fn offset_box(b: (i32, i32, i32, i32), layer: &ClipLayer) -> Box4 {
    let (dx, dy) = (layer.offset_x as f64, layer.offset_y as f64);
    (b.0 as f64 + dx, b.1 as f64 + dy, b.2 as f64 + dx, b.3 as f64 + dy)
}

fn holds_center(rect: &Rect, b: Box4) -> bool {
    let (x, y) = ((b.0 + b.2) / 2.0, (b.1 + b.3) / 2.0);
    rect.x0 <= x && x < rect.x1 && rect.y0 <= y && y < rect.y1
}

fn assign(
    document: &ClipDocument,
    layer: &ClipLayer,
    path: &[&ClipLayer],
    cells: &[PageCell],
    warnings: &mut Vec<String>,
) -> Result<Vec<(usize, PlannedContent)>> {
    match layer.kind {
        LayerKind::Raster => {
            let boxes = document.occupied_pixel_boxes(layer)?;
            Ok(cells
                .iter()
                .filter(|cell| {
                    let r = &cell.rect;
                    boxes.iter().any(|b| {
                        (b.0 as f64) < r.x1 && (b.2 as f64) > r.x0 && (b.1 as f64) < r.y1 && (b.3 as f64) > r.y0
                    })
                })
                .map(|cell| {
                    let r = &cell.rect;
                    (
                        cell.index,
                        PlannedContent {
                            crop: Some((r.x0, r.y0, r.x1, r.y1)),
                            ..content(layer, path)
                        },
                    )
                })
                .collect())
        }
        LayerKind::Vector => {
            let boxes: Vec<Box4> = document
                .vector_objects(layer)?
                .iter()
                .map(|o| offset_box(o.bbox, layer))
                .collect();
            Ok(group_items(&boxes, cells, layer, path))
        }
        LayerKind::Text => {
            let balloons: Vec<Box4> = document
                .vector_objects(layer)?
                .iter()
                .map(|o| offset_box(o.bbox, layer))
                .collect();
            if balloons.is_empty() {
                let boxes: Vec<Box4> = document
                    .text_blocks(layer)?
                    .iter()
                    .filter_map(|block| block.bbox.map(|b| offset_box(b, layer)))
                    .collect();
                return Ok(group_items(&boxes, cells, layer, path));
            }
            let mut touched: Vec<usize> = cells
                .iter()
                .filter(|cell| balloons.iter().any(|b| holds_center(&cell.rect, *b)))
                .map(|cell| cell.index)
                .collect();
            touched.sort_unstable();
            if touched.len() > 1 {
                warnings.push(format!(
                    "テキストレイヤー「{}」のフキダシが複数のページ（{}）にあるため、レイヤーごとそれぞれに写しました",
                    layer.name,
                    touched.iter().map(usize::to_string).collect::<Vec<_>>().join("・")
                ));
            }
            Ok(touched
                .into_iter()
                .map(|index| {
                    (
                        index,
                        PlannedContent {
                            whole_layer: true,
                            ..content(layer, path)
                        },
                    )
                })
                .collect())
        }
        _ => Ok(Vec::new()),
    }
}

fn group_items(
    boxes: &[Box4],
    cells: &[PageCell],
    layer: &ClipLayer,
    path: &[&ClipLayer],
) -> Vec<(usize, PlannedContent)> {
    let mut grouped: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (item, b) in boxes.iter().enumerate() {
        if let Some(cell) = cells.iter().find(|cell| holds_center(&cell.rect, *b)) {
            grouped.entry(cell.index).or_default().push(item);
        }
    }
    grouped
        .into_iter()
        .map(|(index, items)| {
            (
                index,
                PlannedContent {
                    items,
                    ..content(layer, path)
                },
            )
        })
        .collect()
}
