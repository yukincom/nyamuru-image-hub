//! Page cells of a name (ネーム) sheet, found from its vector rectangles.
//!
//! Port of `name_splitter/csp/name_layout.py`:
//! 1. collect axis-aligned closed 4-point objects of visible vector layers;
//! 2. keep sizes that repeat (template cells), so freely drawn panels are not
//!    mistaken for pages;
//! 3. a rectangle holding two inner rectangles side by side is a spread split
//!    at its centre; one inner rectangle is one page; inner rectangles become
//!    the cell's `frame`;
//! 4. order by sheet half (double pages), rows top to bottom, then right to
//!    left (`RightToLeft`) or left to right.

use serde::Serialize;

use crate::clip::{ClipDocument, ClipLayer, LayerKind};
use crate::error::Result;
use crate::vector::VectorObject;

const SIZE_TOLERANCE: f64 = 0.02;
const EDGE_TOLERANCE_PX: f64 = 3.0;
const MIN_REPEAT: usize = 2;

/// Axis-aligned rectangle in canvas pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Self {
        Rect { x0, y0, x1, y1 }
    }

    pub fn width(&self) -> f64 {
        self.x1 - self.x0
    }

    pub fn height(&self) -> f64 {
        self.y1 - self.y0
    }

    pub fn center(&self) -> (f64, f64) {
        ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)
    }

    /// Whether `other` lies inside (within the edge tolerance) and is smaller.
    pub fn contains(&self, other: &Rect) -> bool {
        other.x0 >= self.x0 - EDGE_TOLERANCE_PX
            && other.y0 >= self.y0 - EDGE_TOLERANCE_PX
            && other.x1 <= self.x1 + EDGE_TOLERANCE_PX
            && other.y1 <= self.y1 + EDGE_TOLERANCE_PX
            && (other.width() < self.width() || other.height() < self.height())
    }

    pub fn contains_point(&self, x: f64, y: f64) -> bool {
        self.x0 <= x && x <= self.x1 && self.y0 <= y && y <= self.y1
    }

    fn rounded(&self) -> [f64; 4] {
        let round = |value: f64| (value * 100.0).round_ties_even() / 100.0;
        [round(self.x0), round(self.y0), round(self.x1), round(self.y1)]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SpreadSide {
    Left,
    Right,
}

/// One page of the sheet, in reading order (index from 1).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageCell {
    pub index: usize,
    pub rect: Rect,
    pub frame: Option<Rect>,
    pub spread_side: Option<SpreadSide>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadingOrder {
    /// Rows top to bottom, right to left (Japanese manga).
    RightToLeft,
    LeftToRight,
}

/// Rectangles drawn on the visible vector layers (canvas pixels).
pub fn find_rectangles(document: &ClipDocument) -> Result<Vec<Rect>> {
    let mut layers = Vec::new();
    visible_vector_layers(&document.root.children, true, &mut layers);
    let mut rects = Vec::new();
    for layer in layers {
        for object in document.vector_objects(layer)? {
            if let Some(rect) = as_rectangle(&object) {
                let (dx, dy) = (layer.offset_x as f64, layer.offset_y as f64);
                rects.push(Rect::new(rect.x0 + dx, rect.y0 + dy, rect.x1 + dx, rect.y1 + dy));
            }
        }
    }
    Ok(deduplicate(rects))
}

fn visible_vector_layers<'a>(layers: &'a [ClipLayer], parent_visible: bool, result: &mut Vec<&'a ClipLayer>) {
    for layer in layers {
        let visible = parent_visible && layer.visible;
        if layer.kind == LayerKind::Vector && visible {
            result.push(layer);
        }
        visible_vector_layers(&layer.children, visible, result);
    }
}

/// The axis-aligned rectangle drawn by `object` (layer-local), if it is one.
pub fn as_rectangle(object: &VectorObject) -> Option<Rect> {
    let mut points = object.points.clone();
    if points.len() == 5 && close(points[0], points[4]) {
        points.truncate(4);
    }
    if !object.closed() || points.len() != 4 {
        return None;
    }
    let mut xs: Vec<f64> = points.iter().map(|point| point.0).collect();
    let mut ys: Vec<f64> = points.iter().map(|point| point.1).collect();
    xs.sort_by(f64::total_cmp);
    ys.sort_by(f64::total_cmp);
    let paired =
        |values: &[f64]| values[1] - values[0] <= EDGE_TOLERANCE_PX && values[3] - values[2] <= EDGE_TOLERANCE_PX;
    if !paired(&xs) || !paired(&ys) {
        return None;
    }
    let rect = Rect::new(
        (xs[0] + xs[1]) / 2.0,
        (ys[0] + ys[1]) / 2.0,
        (xs[2] + xs[3]) / 2.0,
        (ys[2] + ys[3]) / 2.0,
    );
    (rect.width() > EDGE_TOLERANCE_PX && rect.height() > EDGE_TOLERANCE_PX).then_some(rect)
}

fn close(a: (f64, f64), b: (f64, f64)) -> bool {
    (a.0 - b.0).abs() <= EDGE_TOLERANCE_PX && (a.1 - b.1).abs() <= EDGE_TOLERANCE_PX
}

fn same_box(a: &Rect, b: &Rect) -> bool {
    a.rounded()
        .iter()
        .zip(b.rounded())
        .all(|(p, q)| (p - q).abs() <= EDGE_TOLERANCE_PX)
}

fn same_size(a: &Rect, b: &Rect) -> bool {
    (a.width() - b.width()).abs() <= SIZE_TOLERANCE * a.width().max(b.width())
        && (a.height() - b.height()).abs() <= SIZE_TOLERANCE * a.height().max(b.height())
}

fn deduplicate(rects: Vec<Rect>) -> Vec<Rect> {
    let mut unique: Vec<Rect> = Vec::new();
    for rect in rects {
        if !unique.iter().any(|other| same_box(&rect, other)) {
            unique.push(rect);
        }
    }
    unique
}

/// Rectangles whose size repeats: the page / spread outlines of a template.
pub fn template_rectangles(rects: &[Rect]) -> Vec<Rect> {
    rects
        .iter()
        .filter(|rect| rects.iter().filter(|other| same_size(rect, other)).count() >= MIN_REPEAT)
        .copied()
        .collect()
}

/// Indexes of the rectangles directly inside `outer` (not inside another child).
fn children(outer: usize, rects: &[Rect]) -> Vec<usize> {
    let inside: Vec<usize> = (0..rects.len())
        .filter(|&i| i != outer && rects[outer].contains(&rects[i]))
        .collect();
    inside
        .iter()
        .copied()
        .filter(|&i| {
            !inside
                .iter()
                .any(|&other| other != i && rects[other].contains(&rects[i]))
        })
        .collect()
}

fn side_by_side(a: &Rect, b: &Rect) -> bool {
    let (left, right) = if a.x0 <= b.x0 { (a, b) } else { (b, a) };
    left.x1 <= right.x0 + EDGE_TOLERANCE_PX && (left.center().1 - right.center().1).abs() < left.height() / 2.0
}

type Cell = (Rect, Option<Rect>, Option<SpreadSide>);

/// Turn template rectangles into ordered page cells.
pub fn detect_page_cells(rects: &[Rect], canvas_width: f64, double_page: bool, order: ReadingOrder) -> Vec<PageCell> {
    let template = template_rectangles(rects);
    let inner_ids: Vec<usize> = (0..template.len())
        .flat_map(|outer| children(outer, &template))
        .collect();
    let mut cells: Vec<Cell> = Vec::new();
    for (index, outer) in template.iter().enumerate() {
        if inner_ids.contains(&index) {
            continue;
        }
        let inner: Vec<Rect> = children(index, &template).into_iter().map(|i| template[i]).collect();
        match inner.as_slice() {
            [a, b] if side_by_side(a, b) => {
                let middle = outer.center().0;
                let (left, right) = if a.x0 <= b.x0 { (*a, *b) } else { (*b, *a) };
                cells.push((
                    Rect::new(outer.x0, outer.y0, middle, outer.y1),
                    Some(left),
                    Some(SpreadSide::Left),
                ));
                cells.push((
                    Rect::new(middle, outer.y0, outer.x1, outer.y1),
                    Some(right),
                    Some(SpreadSide::Right),
                ));
            }
            [frame] => cells.push((*outer, Some(*frame), None)),
            [] => cells.push((*outer, None, None)),
            _ => {}
        }
    }
    reading_order(cells, canvas_width, double_page, order)
        .into_iter()
        .enumerate()
        .map(|(index, (rect, frame, spread_side))| PageCell {
            index: index + 1,
            rect,
            frame,
            spread_side,
        })
        .collect()
}

/// Rectangles of `document` → ordered page cells.
pub fn detect_document_cells(document: &ClipDocument, order: ReadingOrder) -> Result<Vec<PageCell>> {
    Ok(detect_page_cells(
        &find_rectangles(document)?,
        document.canvas.width_px as f64,
        document.canvas.is_double_page,
        order,
    ))
}

fn reading_order(cells: Vec<Cell>, canvas_width: f64, double_page: bool, order: ReadingOrder) -> Vec<Cell> {
    let rtl = order == ReadingOrder::RightToLeft;
    let halves = if double_page {
        let middle = canvas_width / 2.0;
        let (left, right): (Vec<Cell>, Vec<Cell>) = cells.into_iter().partition(|cell| cell.0.center().0 < middle);
        if rtl { vec![right, left] } else { vec![left, right] }
    } else {
        vec![cells]
    };
    let mut result = Vec::new();
    for half in halves {
        for mut row in rows(half) {
            // Stable sort, like Python's sorted().
            row.sort_by(|a, b| {
                let ordering = a.0.center().0.total_cmp(&b.0.center().0);
                if rtl { ordering.reverse() } else { ordering }
            });
            result.extend(row);
        }
    }
    result
}

fn rows(mut cells: Vec<Cell>) -> Vec<Vec<Cell>> {
    cells.sort_by(|a, b| a.0.y0.total_cmp(&b.0.y0));
    let mut rows: Vec<Vec<Cell>> = Vec::new();
    for cell in cells {
        let center_y = cell.0.center().1;
        match rows
            .iter_mut()
            .find(|row| row[0].0.y0 <= center_y && center_y <= row[0].0.y1)
        {
            Some(row) => row.push(cell),
            None => rows.push(vec![cell]),
        }
    }
    rows
}
