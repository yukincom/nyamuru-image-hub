//! Vector data (`VectorObjectList.VectorData`, an external chunk).
//!
//! Vector layers store no pixels; CSP draws them from this data when it
//! opens the file. Big endian (spec: `docs/spec/05-vector.md`):
//!
//! ```text
//! u32 0, u32 length of the objects
//! object × n:
//!   header (header_size bytes)
//!     +0  u32 header_size (76, 88, 92, 96) +4  u32 72
//!     +8  u32 point_size (88, 104)       +12 u32 88
//!     +16 u32 point_count                +20 u32 flags
//!     +24 i32 bbox x0, y0, x1, y1 (layer pixels)
//!     +40 u32 main colour R, G, B        +52 u32 sub colour R, G, B
//!     +64 f64 opacity (1.0)
//!     +72 …  brush style ids (u32 × 1–3), the brush size (f64), u32
//!   point × point_count (point_size bytes)
//!     +0 f64 x  +8 f64 y  +16 i32 bbox x0, y0, x1, y1  +32 u32 flags
//!     +36 … f32 values (pressure, width ratio, …), +88 f64 x, y (104-byte points)
//! ```
//!
//! Coordinates are layer pixels; add `LayerOffsetX/Y` for the canvas. The
//! parser keeps every byte, so unknown fields are written back unchanged.

use crate::binary::{Reader, Writer, be_f64_at, be_u32_at};
use crate::error::{Result, bail};

/// Header flag (+20) of a closed shape.
pub const FLAG_CLOSED: u32 = 0x1000;

/// One stroke or shape. `header` and every point keep their raw bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct VectorObject {
    /// The header bytes (its size is the first `u32`).
    pub header: Vec<u8>,
    /// Bytes per point (from the header).
    pub point_size: usize,
    /// Each point's bytes.
    pub points: Vec<Vec<u8>>,
}

/// Typed view of one point.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Point {
    /// X in layer pixels.
    pub x: f64,
    /// Y in layer pixels.
    pub y: f64,
    /// Bounding box of the point's stamp in layer pixels (x0, y0, x1, y1).
    pub bbox: [i32; 4],
    /// Point flags (`u32` at +32).
    pub flags: u32,
    /// The f32 values after the flags (meaning partly unknown, see the spec).
    pub values: [f32; 13],
}

fn put(data: &mut [u8], offset: usize, bytes: &[u8]) {
    if let Some(target) = data.get_mut(offset..offset + bytes.len()) {
        target.copy_from_slice(bytes);
    }
}

impl VectorObject {
    /// Header size in bytes (88, 92 or 96 in CSP files; 24 for some old objects).
    pub fn header_size(&self) -> usize {
        self.header.len()
    }

    /// Header flags (`u32` at +20).
    pub fn flags(&self) -> u32 {
        be_u32_at(&self.header, 20)
    }

    /// The shape is closed ([`FLAG_CLOSED`]).
    pub fn is_closed(&self) -> bool {
        self.flags() & FLAG_CLOSED != 0
    }

    /// Bounding box in layer pixels (x0, y0, x1, y1).
    pub fn bbox(&self) -> [i32; 4] {
        [0, 4, 8, 12].map(|i| be_u32_at(&self.header, 24 + i) as i32)
    }

    /// Sets the bounding box.
    pub fn set_bbox(&mut self, bbox: [i32; 4]) {
        for (i, value) in bbox.iter().enumerate() {
            put(&mut self.header, 24 + 4 * i, &value.to_be_bytes());
        }
    }

    /// Main colour as 8-bit RGB (each channel is stored as 32 bits whose
    /// top byte is the 8-bit value).
    pub fn main_color(&self) -> [u8; 3] {
        [0, 4, 8].map(|i| (be_u32_at(&self.header, 40 + i) >> 24) as u8)
    }

    /// Sub colour as 8-bit RGB.
    pub fn sub_color(&self) -> [u8; 3] {
        [0, 4, 8].map(|i| (be_u32_at(&self.header, 52 + i) >> 24) as u8)
    }

    /// Opacity 0.0–1.0 (`f64` at +64).
    pub fn opacity(&self) -> f64 {
        be_f64_at(&self.header, 64)
    }

    /// Offset of the brush size (f64) in the header: after the brush style
    /// ids (one, two or three `u32` from +72) and before a last `u32`.
    fn brush_size_offset(&self) -> Option<usize> {
        match self.header.len() {
            size @ (88 | 92 | 96) => Some(size - 12),
            _ => None,
        }
    }

    /// Brush size in pixels (None for header layouts without one).
    pub fn brush_size(&self) -> Option<f64> {
        self.brush_size_offset().map(|offset| be_f64_at(&self.header, offset))
    }

    /// Sets the brush size, for header layouts that have one.
    pub fn set_brush_size(&mut self, size: f64) {
        if let Some(offset) = self.brush_size_offset() {
            put(&mut self.header, offset, &size.to_be_bytes());
        }
    }

    /// Brush style ids (`BrushStyle.MainId`) the header refers to.
    pub fn brush_styles(&self) -> Vec<u32> {
        let end = self.brush_size_offset().unwrap_or(76).min(self.header.len());
        (72..end).step_by(4).map(|offset| be_u32_at(&self.header, offset)).collect()
    }

    /// The first settings word of a header-96 object (balloons and frames),
    /// which names the kind of shape: 0x130 a balloon, 0x111 or 0x311 a
    /// balloon's tail, 0x410 a frame (values seen in the corpus).
    pub fn shape_kind(&self) -> Option<u32> {
        (self.header.len() == 96).then(|| be_u32_at(&self.header, 72))
    }

    /// A balloon's tail (drawn with the line of the balloon before it).
    pub fn is_balloon_tail(&self) -> bool {
        self.shape_kind().is_some_and(|kind| kind & 0xff == 0x11)
    }

    /// The typed view of point `index`.
    pub fn point(&self, index: usize) -> Option<Point> {
        let raw = self.points.get(index)?;
        let mut values = [0f32; 13];
        for (i, value) in values.iter_mut().enumerate() {
            *value = f32::from_bits(be_u32_at(raw, 36 + 4 * i));
        }
        Some(Point {
            x: be_f64_at(raw, 0),
            y: be_f64_at(raw, 8),
            bbox: [16, 20, 24, 28].map(|offset| be_u32_at(raw, offset) as i32),
            flags: be_u32_at(raw, 32),
            values,
        })
    }

    /// (x, y) of every point, in layer pixels.
    pub fn coordinates(&self) -> Vec<(f64, f64)> {
        self.points.iter().map(|raw| (be_f64_at(raw, 0), be_f64_at(raw, 8))).collect()
    }

    /// Move and scale every coordinate (`p * scale + offset`), with the
    /// bounding boxes and brush size following.
    pub fn transform(&mut self, scale: f64, dx: f64, dy: f64) {
        let map = |bbox: [i32; 4]| {
            [
                (bbox[0] as f64 * scale + dx).floor() as i32,
                (bbox[1] as f64 * scale + dy).floor() as i32,
                (bbox[2] as f64 * scale + dx).ceil() as i32,
                (bbox[3] as f64 * scale + dy).ceil() as i32,
            ]
        };
        self.set_bbox(map(self.bbox()));
        if let Some(size) = self.brush_size() {
            self.set_brush_size(size * scale);
        }
        for raw in &mut self.points {
            let x = be_f64_at(raw, 0) * scale + dx;
            let y = be_f64_at(raw, 8) * scale + dy;
            put(raw, 0, &x.to_be_bytes());
            put(raw, 8, &y.to_be_bytes());
            let bbox = map([16, 20, 24, 28].map(|offset| be_u32_at(raw, offset) as i32));
            for (i, value) in bbox.iter().enumerate() {
                put(raw, 16 + 4 * i, &value.to_be_bytes());
            }
            if raw.len() >= 104 {
                let cx = be_f64_at(raw, 88) * scale + dx;
                let cy = be_f64_at(raw, 96) * scale + dy;
                put(raw, 88, &cx.to_be_bytes());
                put(raw, 96, &cy.to_be_bytes());
            }
        }
    }
}

/// All objects of one `VectorData` payload.
#[derive(Debug, Clone, PartialEq)]
pub struct VectorData {
    /// The first u32 (always 0 in the corpus).
    pub lead: u32,
    /// The objects, in drawing order.
    pub objects: Vec<VectorObject>,
    /// Bytes after the declared length (none in the corpus).
    pub trailing: Vec<u8>,
}

impl VectorData {
    /// Parses a `VectorObjectList.VectorData` external payload.
    pub fn parse(payload: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(payload);
        let lead = reader.be_u32()?;
        let length = reader.be_u32()? as usize;
        let end = 8usize
            .checked_add(length)
            .filter(|end| *end <= payload.len())
            .ok_or_else(|| crate::Error::format("VectorData length exceeds the payload"))?;
        let mut objects = Vec::new();
        while reader.position() < end {
            let start = reader.position();
            let header_size = Reader::at(payload, start).be_u32()? as usize;
            let point_size = Reader::at(payload, start + 8).be_u32()? as usize;
            let point_count = Reader::at(payload, start + 16).be_u32()? as usize;
            if header_size < 24 || point_size < 16 {
                bail!("Vector object at {start}: header {header_size} / point {point_size} bytes");
            }
            if point_count.checked_mul(point_size).is_none_or(|bytes| start + header_size + bytes > end) {
                bail!("Vector object at {start} overruns the data");
            }
            let header = reader.bytes(header_size)?.to_vec();
            let mut points = Vec::with_capacity(point_count);
            for _ in 0..point_count {
                points.push(reader.bytes(point_size)?.to_vec());
            }
            objects.push(VectorObject { header, point_size, points });
        }
        Ok(VectorData { lead, objects, trailing: payload[end..].to_vec() })
    }

    /// The payload; unchanged objects give the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut body = Writer::new();
        for object in &self.objects {
            body.bytes(&object.header);
            for point in &object.points {
                body.bytes(point);
            }
        }
        let mut writer = Writer::new();
        writer.be_u32(self.lead).be_u32(body.len() as u32).bytes(&body.data).bytes(&self.trailing);
        writer.into_inner()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(points: &[(f64, f64)]) -> VectorObject {
        let mut header = vec![0u8; 88];
        put(&mut header, 0, &88u32.to_be_bytes());
        put(&mut header, 4, &72u32.to_be_bytes());
        put(&mut header, 8, &88u32.to_be_bytes());
        put(&mut header, 12, &88u32.to_be_bytes());
        put(&mut header, 16, &(points.len() as u32).to_be_bytes());
        put(&mut header, 20, &0x2081u32.to_be_bytes());
        put(&mut header, 76, &10f64.to_be_bytes());
        let points = points
            .iter()
            .map(|(x, y)| {
                let mut raw = vec![0u8; 88];
                put(&mut raw, 0, &x.to_be_bytes());
                put(&mut raw, 8, &y.to_be_bytes());
                raw
            })
            .collect();
        VectorObject { header, point_size: 88, points }
    }

    #[test]
    fn vector_data_round_trips() {
        let data = VectorData { lead: 0, objects: vec![object(&[(1.0, 2.0), (3.5, 4.5)])], trailing: vec![] };
        let bytes = data.to_bytes();
        let parsed = VectorData::parse(&bytes).unwrap();
        assert_eq!(parsed, data);
        assert_eq!(parsed.objects[0].coordinates(), vec![(1.0, 2.0), (3.5, 4.5)]);
        assert_eq!(parsed.objects[0].brush_size(), Some(10.0));
        assert!(VectorData::parse(&bytes[..bytes.len() - 3]).is_err());
    }

    #[test]
    fn transform_moves_points_and_size() {
        let mut item = object(&[(1.0, 2.0)]);
        item.transform(2.0, 10.0, 20.0);
        assert_eq!(item.coordinates(), vec![(12.0, 24.0)]);
        assert_eq!(item.brush_size(), Some(20.0));
    }
}
