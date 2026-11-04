//! New vector objects: lines and コマ枠 (frame) borders (from name-studio's
//! clip-core).
//!
//! A line is written in the layout CSP 5 gives a pen or polyline object
//! (92-byte header, 88-byte points; see `docs/spec/05-vector.md`), with the
//! fields that are not decoded copied from a CSP-made object. A frame
//! border copies the header and first point of a border CSP made
//! ([`FrameTemplate`]) and sets the corners' miter values, which CSP uses to
//! draw the border's outside edge.
//!
//! Objects name their brush by `BrushStyle.MainId`, so the brush style id
//! must exist in the file the data goes into: take it from an object of the
//! same file ([`VectorObject::brush_style`]).

use crate::binary::be_u32_at;
use crate::vector::{VectorData, VectorObject};

/// Header and point CSP 5 writes for a pen or polyline object; fields this
/// module does not set keep these values.
const LINE_HEADER: [u8; 92] = hex(concat!(
    "0000005c0000004c00000058000000580000000000000011000000000000000000000000000000000000000000000000",
    "00000000a244a2445f1f5f1f54ec54ec3ff0000000000000000000000000000240040000000000000f806b70",
));
const LINE_POINT: [u8; 88] = hex(concat!(
    "000000000000000000000000000000000000000000000000000000000000000000000001",
    "3f8000003f80000000000000000000003f8000003f8000003f800000000000000000000000000000",
    "000000000f806b7000000000",
));
const OPEN_FLAGS: u32 = 0x11;
/// Closed polylines (CSP's 折れ線 with 線を閉じる) add 0x100.
const CLOSED_FLAGS: u32 = 0x111;
const HEADER_POINT_COUNT: usize = 16;
const HEADER_FLAGS: usize = 20;
const HEADER_BBOX: usize = 24;
/// Main colour, `u32` × 3 (black is all zero).
const HEADER_COLOR: usize = 40;
/// The brush style id new objects are drawn with (the second id of a
/// 92-byte header).
const HEADER_BRUSH_STYLE: usize = 76;
const BRUSH_SIZE_FROM_END: usize = 12;
const POINT_BBOX: usize = 16;
/// 1 when a segment leaves the point (all but the last point of an open line).
const POINT_HAS_SEGMENT: usize = 32;
/// Width factor of the point (pen pressure), `f32`.
const POINT_WIDTH: usize = 36;
/// Border corners keep the miter length (`f32`) and the outward unit
/// bisector (`f32` × 2) after the point's common fields.
const FRAME_POINT_MITER: usize = 64;
const FRAME_HEADER_MIN: usize = 96;
const FRAME_POINT_MIN: usize = 80;

const fn hex<const N: usize>(text: &str) -> [u8; N] {
    const fn digit(d: u8) -> u8 {
        match d {
            b'0'..=b'9' => d - b'0',
            b'a'..=b'f' => d - b'a' + 10,
            _ => panic!("not a hex digit"),
        }
    }
    let bytes = text.as_bytes();
    assert!(bytes.len() == N * 2, "hex length does not match");
    let mut result = [0u8; N];
    let mut i = 0;
    while i < N {
        result[i] = (digit(bytes[2 * i]) << 4) | digit(bytes[2 * i + 1]);
        i += 1;
    }
    result
}

fn put(data: &mut [u8], offset: usize, bytes: &[u8]) {
    data[offset..offset + bytes.len()].copy_from_slice(bytes);
}

fn put_bbox(data: &mut [u8], offset: usize, bbox: [i32; 4]) {
    for (i, value) in bbox.iter().enumerate() {
        put(data, offset + 4 * i, &value.to_be_bytes());
    }
}

/// Box of the segment a → b widened by `radius`, in whole pixels.
fn segment_box(a: (f64, f64), b: (f64, f64), radius: f64) -> [i32; 4] {
    [
        (a.0.min(b.0) - radius).floor() as i32,
        (a.1.min(b.1) - radius).floor() as i32,
        (a.0.max(b.0) + radius).ceil() as i32,
        (a.1.max(b.1) + radius).ceil() as i32,
    ]
}

fn points_box(points: &[(f64, f64)], radius: f64) -> [i32; 4] {
    points.iter().fold(segment_box(points[0], points[0], radius), |acc, &point| {
        let one = segment_box(point, point, radius);
        [acc[0].min(one[0]), acc[1].min(one[1]), acc[2].max(one[2]), acc[3].max(one[3])]
    })
}

/// Set the point count, bounding box, brush style and brush size (radius)
/// of a copied header.
fn fill_header(header: &mut [u8], count: usize, bbox: [i32; 4], brush_style: u32, radius: f64) {
    put(header, HEADER_POINT_COUNT, &(count as u32).to_be_bytes());
    put_bbox(header, HEADER_BBOX, bbox);
    put(header, HEADER_BRUSH_STYLE, &brush_style.to_be_bytes());
    let size_offset = header.len() - BRUSH_SIZE_FROM_END;
    put(header, size_offset, &radius.to_be_bytes());
}

/// A line to draw as a new vector object, in layer pixels.
#[derive(Debug, Clone, PartialEq)]
pub struct NewVectorLine {
    /// `(x, y, width factor)`; the factor (pen pressure) is 0..1.
    pub points: Vec<(f64, f64, f64)>,
    /// Join the last point to the first.
    pub closed: bool,
    /// Full line width in pixels.
    pub width_px: f64,
}

impl NewVectorLine {
    /// The points without the width factors.
    pub fn xy(&self) -> Vec<(f64, f64)> {
        self.points.iter().map(|&(x, y, _)| (x, y)).collect()
    }
}

/// One panel of a コマ枠フォルダー: its outline (layer pixels) and the
/// border's full width.
#[derive(Debug, Clone, PartialEq)]
pub struct NewFrame {
    /// Outline of the panel, in layer pixels.
    pub points: Vec<(f64, f64)>,
    /// Full width of the border in pixels.
    pub width_px: f64,
}

/// The layout of one コマ枠フォルダー border, taken from a CSP-made frame
/// folder: its header and first point, whose undecoded fields new borders
/// keep (header 96 bytes and points 88 bytes in CSP 5).
#[derive(Debug, Clone, PartialEq)]
pub struct FrameTemplate {
    header: Vec<u8>,
    point: Vec<u8>,
}

impl FrameTemplate {
    /// The first border of a frame folder's vector data, if it is in the
    /// known layout.
    pub fn of(data: &VectorData) -> Option<Self> {
        let object = data.objects.first()?;
        if object.header.len() < FRAME_HEADER_MIN || object.point_size < FRAME_POINT_MIN {
            return None;
        }
        Some(FrameTemplate { header: object.header.clone(), point: object.points.first()?.clone() })
    }

    /// Brush style id the borders are drawn with.
    pub fn brush_style(&self) -> u32 {
        be_u32_at(&self.header, HEADER_BRUSH_STYLE)
    }
}

impl VectorObject {
    /// The brush style id (`BrushStyle.MainId`) a new object copying this
    /// one should use: the only id of an 88-byte header, the one at +76 of
    /// larger headers (the second; the first of a 92-byte header can be 0).
    pub fn brush_style(&self) -> Option<u32> {
        match self.header.len() {
            76 | 88 => Some(be_u32_at(&self.header, 72)),
            size if size >= 92 => Some(be_u32_at(&self.header, HEADER_BRUSH_STYLE)),
            _ => None,
        }
    }

    /// A black line drawn with brush style `brush_style`. None for lines
    /// with fewer than two points.
    pub fn new_line(line: &NewVectorLine, brush_style: u32) -> Option<VectorObject> {
        if line.points.len() < 2 {
            return None;
        }
        let radius = (line.width_px / 2.0).max(0.5);
        let points = line.xy();
        let mut header = LINE_HEADER.to_vec();
        fill_header(&mut header, points.len(), points_box(&points, radius), brush_style, radius);
        put(&mut header, HEADER_FLAGS, &(if line.closed { CLOSED_FLAGS } else { OPEN_FLAGS }).to_be_bytes());
        header[HEADER_COLOR..HEADER_COLOR + 12].fill(0);
        let raw_points = line
            .points
            .iter()
            .enumerate()
            .map(|(index, &(x, y, width))| {
                let next = match points.get(index + 1) {
                    Some(&next) => Some(next),
                    None if line.closed => Some(points[0]),
                    None => None,
                };
                let mut point = LINE_POINT.to_vec();
                put(&mut point, 0, &x.to_be_bytes());
                put(&mut point, 8, &y.to_be_bytes());
                put_bbox(&mut point, POINT_BBOX, segment_box((x, y), next.unwrap_or((x, y)), radius));
                put(&mut point, POINT_HAS_SEGMENT, &(next.is_some() as u32).to_be_bytes());
                put(&mut point, POINT_WIDTH, &(width.clamp(0.0, 1.0) as f32).to_be_bytes());
                point
            })
            .collect();
        Some(VectorObject { header, point_size: LINE_POINT.len(), points: raw_points })
    }

    /// A closed frame border laid out like `template`, drawn with brush
    /// style `brush_style`. None for outlines with fewer than three points.
    pub fn new_frame(frame: &NewFrame, template: &FrameTemplate, brush_style: u32) -> Option<VectorObject> {
        let points = &frame.points;
        if points.len() < 3 {
            return None;
        }
        let radius = (frame.width_px / 2.0).max(0.5);
        let reach = radius + 2.0;
        let mut header = template.header.clone();
        fill_header(&mut header, points.len(), points_box(points, reach), brush_style, radius);
        let raw_points = points
            .iter()
            .zip(frame_corners(points, radius))
            .enumerate()
            .map(|(index, (&(x, y), (bisector, miter)))| {
                let next = points[(index + 1) % points.len()];
                let mut point = template.point.clone();
                put(&mut point, 0, &x.to_be_bytes());
                put(&mut point, 8, &y.to_be_bytes());
                put_bbox(&mut point, POINT_BBOX, segment_box((x, y), next, reach));
                for (offset, value) in [(0, miter), (4, bisector.0), (8, bisector.1)] {
                    put(&mut point, FRAME_POINT_MITER + offset, &(value as f32).to_be_bytes());
                }
                point
            })
            .collect();
        Some(VectorObject { header, point_size: template.point.len(), points: raw_points })
    }
}

/// Outward unit bisector and miter length of each corner of `points`.
fn frame_corners(points: &[(f64, f64)], radius: f64) -> Vec<((f64, f64), f64)> {
    let n = points.len();
    let unit = |(x, y): (f64, f64)| {
        let length = x.hypot(y);
        if length > 1e-9 { (x / length, y / length) } else { (0.0, 0.0) }
    };
    // Signed area: which side of each edge is inside.
    let area: f64 = (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum();
    let side = if area >= 0.0 { 1.0 } else { -1.0 };
    (0..n)
        .map(|i| {
            let (a, b, c) = (points[(i + n - 1) % n], points[i], points[(i + 1) % n]);
            let incoming = unit((b.0 - a.0, b.1 - a.1));
            let outgoing = unit((c.0 - b.0, c.1 - b.1));
            // Outward normals of the two edges (y points down, as in CSP).
            let normal = |(x, y): (f64, f64)| (y * side, -x * side);
            let (n1, n2) = (normal(incoming), normal(outgoing));
            let bisector = unit((n1.0 + n2.0, n1.1 + n2.1));
            let bisector = if bisector == (0.0, 0.0) { n2 } else { bisector };
            // The corner's half angle: miter = r / cos(half the turn).
            let cos = (bisector.0 * n2.0 + bisector.1 * n2.1).max(0.1);
            (bisector, radius / cos)
        })
        .collect()
}

impl VectorData {
    /// Vector data holding `lines` (see [`VectorObject::new_line`]).
    pub fn from_lines(lines: &[NewVectorLine], brush_style: u32) -> VectorData {
        let objects = lines.iter().filter_map(|line| VectorObject::new_line(line, brush_style)).collect();
        VectorData { lead: 0, objects, trailing: Vec::new() }
    }

    /// A frame folder's vector data holding `frames` (see
    /// [`VectorObject::new_frame`]).
    pub fn from_frames(frames: &[NewFrame], template: &FrameTemplate, brush_style: u32) -> VectorData {
        let objects = frames.iter().filter_map(|frame| VectorObject::new_frame(frame, template, brush_style)).collect();
        VectorData { lead: 0, objects, trailing: Vec::new() }
    }

    /// The brush style of the first object (see [`VectorObject::brush_style`]).
    pub fn brush_style(&self) -> Option<u32> {
        self.objects.first()?.brush_style()
    }
}

/// A short fingerprint of lines' shapes (points to the pixel, in order), to
/// tell whether a vector layer still holds what was written into it.
pub fn shape_signature<'a>(lines: impl IntoIterator<Item = &'a [(f64, f64)]>) -> String {
    // FNV-1a: the same on every build, unlike the standard hasher.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |value: i64| {
        for byte in value.to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    };
    let mut count = 0;
    for points in lines {
        count += 1;
        feed(points.len() as i64);
        for (x, y) in points {
            feed(x.round() as i64);
            feed(y.round() as i64);
        }
    }
    format!("{count}:{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(points: &[(f64, f64)], closed: bool) -> NewVectorLine {
        NewVectorLine { points: points.iter().map(|&(x, y)| (x, y, 1.0)).collect(), closed, width_px: 6.0 }
    }

    #[test]
    fn lines_parse_back() {
        let lines = [line(&[(10.0, 20.0), (30.5, 40.0), (50.0, 20.0)], false), line(&[(1.0, 1.0)], false)];
        let bytes = VectorData::from_lines(&lines, 7).to_bytes();
        let data = VectorData::parse(&bytes).unwrap();
        assert_eq!(data.objects.len(), 1, "a one-point line is skipped");
        let object = &data.objects[0];
        assert_eq!(object.coordinates(), lines[0].xy());
        assert_eq!(object.brush_size(), Some(3.0));
        assert_eq!(object.brush_style(), Some(7));
        assert_eq!(data.brush_style(), Some(7));
        assert_eq!(object.bbox(), [7, 17, 53, 43]);
        assert_eq!(object.main_color(), [0, 0, 0]);
        assert!(!object.is_closed());
        // The last point of an open line starts no segment.
        assert_eq!(object.point(1).unwrap().flags, 1);
        assert_eq!(object.point(2).unwrap().flags, 0);
        assert_eq!(object.point(2).unwrap().bbox, [47, 17, 53, 23]);
        assert_eq!(object.point(0).unwrap().values[0], 1.0);
    }

    #[test]
    fn closed_lines_join_the_ends() {
        let bytes = VectorData::from_lines(&[line(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)], true)], 2).to_bytes();
        let object = &VectorData::parse(&bytes).unwrap().objects[0];
        assert_eq!(object.flags(), CLOSED_FLAGS);
        let last = object.point(2).unwrap();
        assert_eq!(last.flags, 1);
        assert_eq!(last.bbox, [-3, -3, 13, 13]);
    }

    #[test]
    fn frames_copy_the_template_and_set_corners() {
        let mut header = vec![0u8; 96];
        put(&mut header, 0, &96u32.to_be_bytes());
        put(&mut header, 8, &88u32.to_be_bytes());
        put(&mut header, 20, &0x1111u32.to_be_bytes());
        put(&mut header, 92, &[0xab; 4]);
        let template_data = VectorData {
            lead: 0,
            objects: vec![VectorObject { header, point_size: 88, points: vec![vec![0x5a; 88]] }],
            trailing: vec![],
        };
        let template = FrameTemplate::of(&template_data).unwrap();
        let square = NewFrame { points: vec![(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)], width_px: 4.0 };
        let data = VectorData::from_frames(std::slice::from_ref(&square), &template, 9);
        let parsed = VectorData::parse(&data.to_bytes()).unwrap();
        let object = &parsed.objects[0];
        assert_eq!(object.coordinates(), square.points);
        assert_eq!(object.flags(), 0x1111, "flags come from the template");
        assert_eq!(&object.header[92..96], &[0xab; 4], "undecoded bytes are kept");
        assert_eq!(object.brush_size(), Some(2.0));
        assert_eq!(object.brush_style(), Some(9));
        assert_eq!(object.bbox(), [-4, -4, 104, 54]);
        // A right-angled corner: miter r·√2 along the outward diagonal.
        let point = object.point(0).unwrap();
        let miter = f32::from_bits(be_u32_at(&object.points[0], FRAME_POINT_MITER));
        assert!((miter - 2.0 * std::f32::consts::SQRT_2).abs() < 1e-4);
        let bisector = (point.values[8], point.values[9]);
        let diagonal = std::f32::consts::FRAC_1_SQRT_2;
        assert!((bisector.0 + diagonal).abs() < 1e-4 && (bisector.1 + diagonal).abs() < 1e-4, "{bisector:?}");
        assert_eq!(&object.points[0][76..88], &[0x5a; 12]);
    }

    #[test]
    fn signatures_follow_rounded_points() {
        let a = [(1.2, 2.0), (3.0, 4.0)];
        let b = [(0.9, 2.4), (3.0, 4.0)];
        assert_eq!(shape_signature([&a[..]]), shape_signature([&b[..]]));
        assert_ne!(shape_signature([&a[..]]), shape_signature([&a[..1]]));
    }
}
