//! Vector objects of a CSP vector layer (`VectorObjectList.VectorData`).
//!
//! Vector layers (name frames, lines, balloons) store no pixels; CSP redraws
//! them from this data. Big endian layout:
//!
//! ```text
//! u32 0, u32 length of the rest
//! object × n:
//!   header (header_size bytes): u32 header_size, u32 ?, u32 point_size, u32 ?,
//!     u32 point_count, u32 flags, i32 bbox[4], ..., f64 brush size at
//!     header_size - 12, u32 ?
//!   point × point_count (point_size bytes each): f64 x, f64 y, i32 bbox[4], ...
//! ```
//!
//! Coordinates are layer-local (add `LayerOffsetX/Y` for the canvas).
//! New lines and frames are built by csp-format (`vector_build`).

use csp_format::vector::VectorData;
pub use csp_format::vector_build::{FrameTemplate, NewFrame, NewVectorLine, shape_signature};

use crate::error::{CspError, Result};

pub const CLOSED_FLAG: u32 = csp_format::vector::FLAG_CLOSED;

pub type BBox = (i32, i32, i32, i32);

/// One stroke or shape (layer-local coordinates).
#[derive(Debug, Clone, PartialEq)]
pub struct VectorObject {
    pub flags: u32,
    pub bbox: BBox,
    pub points: Vec<(f64, f64)>,
    /// 0 for header layouts without one.
    pub brush_size: f64,
}

impl VectorObject {
    /// Whether the shape is closed (observed for rectangles and balloons).
    pub fn closed(&self) -> bool {
        self.flags & CLOSED_FLAG != 0
    }
}

/// Decode all objects of a `VectorData` payload (csp-format reads it).
pub fn parse_vector_data(payload: &[u8]) -> Result<Vec<VectorObject>> {
    Ok(VectorData::parse(payload)?
        .objects
        .iter()
        .map(|object| {
            let [x0, y0, x1, y1] = object.bbox();
            VectorObject {
                flags: object.flags(),
                bbox: (x0, y0, x1, y1),
                points: object.coordinates(),
                brush_size: object.brush_size().unwrap_or(0.0),
            }
        })
        .collect())
}

/// Copy of `payload` with every coordinate mapped to `p * scale + d`; bounding
/// boxes, control points and the brush size follow, so lines keep their
/// relative width.
pub fn transform_vector_data(payload: &[u8], scale: f64, dx: f64, dy: f64) -> Result<Vec<u8>> {
    if scale <= 0.0 {
        return Err(CspError::format("scale must be positive"));
    }
    let mut data = VectorData::parse(payload)?;
    for object in &mut data.objects {
        object.transform(scale, dx, dy);
    }
    Ok(data.to_bytes())
}

/// Payload keeping only the objects at `indexes` (in their original order).
pub fn select_vector_objects(payload: &[u8], indexes: &[usize]) -> Result<Vec<u8>> {
    let mut data = VectorData::parse(payload)?;
    let mut index = 0;
    data.objects.retain(|_| {
        index += 1;
        indexes.contains(&(index - 1))
    });
    Ok(data.to_bytes())
}

/// Brush style id the first object of `payload` uses (vector objects name
/// their brush by `BrushStyle.MainId`), if it has one in the known layout.
pub fn brush_style_of(payload: &[u8]) -> Result<Option<u32>> {
    Ok(VectorData::parse(payload)?.brush_style())
}

/// The layout of a frame folder's borders, from its `VectorData`.
pub fn frame_template_of(payload: &[u8]) -> Option<FrameTemplate> {
    FrameTemplate::of(&VectorData::parse(payload).ok()?)
}
