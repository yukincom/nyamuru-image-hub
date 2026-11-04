//! Text layers: `TextLayerString` (UTF-8) and its attributes.
//!
//! `TextLayerAttributes` is a little-endian list of records `u32 id, u32
//! length, bytes` (spec: `docs/spec/06-text.md`). A layer with several text
//! blocks (balloons) keeps them in `TextLayerStringArray` /
//! `TextLayerAttributesArray`: `u32le length` + string / attribute list per
//! block. Records whose ids this module does not decode are kept as bytes,
//! so the attributes are written back unchanged.

use crate::binary::{Reader, Writer};
use crate::error::{Result, bail};

/// Record ids whose meaning is known (see the spec for the confidence of each).
pub mod ids {
    /// Character runs with a font size (u32 count, then runs).
    pub const RUN_FONT_SIZE: u32 = 11;
    /// Font size × 100 in points (u32).
    pub const FONT_SIZE: u32 = 32;
    /// Text block bounding box, layer pixels (i32 × 4: x0, y0, x1, y1).
    pub const BBOX: u32 = 42;
    /// The balloon the block sits in: 1-based index of the layer's vector
    /// objects, whose bbox centre the block's bbox is relative to (0 = none,
    /// the bbox is in layer pixels).
    pub const BALLOON: u32 = 45;
    /// Id of the offscreen CSP rendered the text into (u32; 0 = render again).
    pub const RENDER_OFFSCREEN: u32 = 50;
    /// Font (u16 ?, u16 length, UTF-8 name, u16 length, PostScript name).
    pub const FONT: u32 = 57;
    /// Text block width and height in pixels (i32 × 2).
    pub const BLOCK_SIZE: u32 = 63;
    /// Four corners in 1/100 px relative to the anchor (i32 × 8).
    pub const QUAD: u32 = 64;
}

/// One attribute record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    /// Record id (see [`ids`]).
    pub id: u32,
    /// Record bytes, as stored.
    pub data: Vec<u8>,
}

/// A parsed attribute list.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Attributes {
    /// The records, in stored order.
    pub records: Vec<Record>,
}

/// Font name pair of record 57.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Font {
    /// First field of the record, not decoded (kept on writing).
    pub lead: u16,
    /// Font name as CSP shows it.
    pub name: String,
    /// PostScript name of the font.
    pub postscript_name: String,
}

impl Attributes {
    /// Parses a `TextLayerAttributes` blob.
    pub fn parse(blob: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(blob);
        let mut records = Vec::new();
        while !reader.is_empty() {
            let id = reader.le_u32()?;
            let length = reader.le_u32()? as usize;
            if length > reader.remaining() {
                bail!("Text attribute {id} says {length} bytes, {} remain", reader.remaining());
            }
            records.push(Record { id, data: reader.bytes(length)?.to_vec() });
        }
        Ok(Attributes { records })
    }

    /// The blob, records in the same order (unchanged records give the same bytes).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut writer = Writer::new();
        for record in &self.records {
            writer.le_u32(record.id).le_u32(record.data.len() as u32).bytes(&record.data);
        }
        writer.into_inner()
    }

    /// The bytes of the first record with this id.
    pub fn get(&self, id: u32) -> Option<&[u8]> {
        self.records.iter().find(|record| record.id == id).map(|record| record.data.as_slice())
    }

    /// Replaces the first record with this id, or appends one.
    pub fn set(&mut self, id: u32, data: Vec<u8>) {
        match self.records.iter_mut().find(|record| record.id == id) {
            Some(record) => record.data = data,
            None => self.records.push(Record { id, data }),
        }
    }

    fn i32s(&self, id: u32) -> Option<Vec<i32>> {
        let data = self.get(id)?;
        Some(data.as_chunks::<4>().0.iter().map(|b| i32::from_le_bytes(*b)).collect())
    }

    fn set_i32s(&mut self, id: u32, values: &[i32]) {
        self.set(id, values.iter().flat_map(|value| value.to_le_bytes()).collect());
    }

    /// Font size in points.
    pub fn font_size(&self) -> Option<f64> {
        self.i32s(ids::FONT_SIZE)?.first().map(|value| *value as f64 / 100.0)
    }

    /// Text block bounding box in layer pixels (record 42: x0, y0, x1, y1).
    pub fn bbox(&self) -> Option<[i32; 4]> {
        self.i32s(ids::BBOX)?.try_into().ok()
    }

    /// Sets record 42.
    pub fn set_bbox(&mut self, bbox: [i32; 4]) {
        self.set_i32s(ids::BBOX, &bbox);
    }

    /// Text block width and height in pixels (record 63).
    pub fn block_size(&self) -> Option<[i32; 2]> {
        self.i32s(ids::BLOCK_SIZE)?.try_into().ok()
    }

    /// Four corners in 1/100 px relative to the anchor (record 64).
    pub fn quad(&self) -> Option<[i32; 8]> {
        self.i32s(ids::QUAD)?.try_into().ok()
    }

    /// The 1-based index of the balloon object the block sits in (record 45).
    pub fn balloon(&self) -> Option<u32> {
        self.i32s(ids::BALLOON)?.first().map(|value| *value as u32).filter(|value| *value > 0)
    }

    /// Id of the offscreen CSP rendered the text into (record 50; 0 = render again).
    pub fn render_offscreen(&self) -> Option<u32> {
        self.i32s(ids::RENDER_OFFSCREEN)?.first().map(|value| *value as u32)
    }

    /// Make CSP render the text again on opening (needed after changing it).
    pub fn clear_render_offscreen(&mut self) {
        if self.get(ids::RENDER_OFFSCREEN).is_some() {
            self.set_i32s(ids::RENDER_OFFSCREEN, &[0]);
        }
    }

    /// The font (record 57).
    pub fn font(&self) -> Option<Font> {
        let data = self.get(ids::FONT)?;
        let mut reader = Reader::new(data);
        let lead = reader.le_u16().ok()?;
        let length = reader.le_u16().ok()? as usize;
        let name = String::from_utf8_lossy(reader.bytes(length).ok()?).into_owned();
        let length = reader.le_u16().ok()? as usize;
        let postscript_name = String::from_utf8_lossy(reader.bytes(length).ok()?).into_owned();
        Some(Font { lead, name, postscript_name })
    }

    /// Move and scale the geometry records (bbox, block size, quad).
    pub fn transform(&mut self, scale: f64, dx: f64, dy: f64) {
        if let Some(b) = self.bbox() {
            self.set_bbox([
                (b[0] as f64 * scale + dx).floor() as i32,
                (b[1] as f64 * scale + dy).floor() as i32,
                (b[2] as f64 * scale + dx).ceil() as i32,
                (b[3] as f64 * scale + dy).ceil() as i32,
            ]);
        }
        if let Some(size) = self.block_size() {
            self.set_i32s(ids::BLOCK_SIZE, &size.map(|v| (v as f64 * scale).round() as i32));
        }
        if let Some(quad) = self.quad() {
            self.set_i32s(ids::QUAD, &quad.map(|v| (v as f64 * scale).round() as i32));
        }
    }
}

/// Split a `…Array` column: `u32le length` + bytes, repeated.
pub fn split_array(blob: &[u8]) -> Result<Vec<&[u8]>> {
    let mut reader = Reader::new(blob);
    let mut parts = Vec::new();
    while !reader.is_empty() {
        let length = reader.le_u32()? as usize;
        if length > reader.remaining() {
            bail!("Array entry of {length} bytes, {} remain", reader.remaining());
        }
        parts.push(reader.bytes(length)?);
    }
    Ok(parts)
}

/// Joins parts into a `…Array` column (the inverse of [`split_array`]).
pub fn join_array<T: AsRef<[u8]>>(parts: &[T]) -> Vec<u8> {
    let mut writer = Writer::new();
    for part in parts {
        writer.le_u32(part.as_ref().len() as u32).bytes(part.as_ref());
    }
    writer.into_inner()
}

/// One text block of a text layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextBlock {
    /// The text (UTF-8, `\n` between lines).
    pub text: String,
    /// Its attribute records.
    pub attributes: Attributes,
}

/// The text blocks of a layer: the single string and attributes first,
/// then one block per entry of the arrays. The arrays hold the other
/// blocks, not a copy of the first: in the corpus the single block always
/// has its own bounding box and rendered image (V7).
pub fn read_blocks(row: &crate::database::Row) -> Result<Vec<TextBlock>> {
    let mut blocks = Vec::new();
    let (text, attributes) = (row.blob("TextLayerString"), row.blob("TextLayerAttributes"));
    if text.is_some() || attributes.is_some() {
        blocks.push(block(text.unwrap_or_default(), attributes)?);
    }
    let strings = row.blob("TextLayerStringArray").map(split_array).transpose()?.unwrap_or_default();
    let attributes = row.blob("TextLayerAttributesArray").map(split_array).transpose()?.unwrap_or_default();
    for index in 0..strings.len().max(attributes.len()) {
        blocks.push(block(strings.get(index).copied().unwrap_or_default(), attributes.get(index).copied())?);
    }
    Ok(blocks)
}

fn block(text: &[u8], attributes: Option<&[u8]>) -> Result<TextBlock> {
    let attributes = match attributes {
        Some(blob) => Attributes::parse(blob)?,
        None => Attributes::default(),
    };
    Ok(TextBlock { text: String::from_utf8_lossy(text).into_owned(), attributes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attributes_round_trip_and_decode() {
        let mut attributes = Attributes::default();
        attributes.set(ids::FONT_SIZE, 600i32.to_le_bytes().to_vec());
        attributes.set_bbox([1, 2, 30, 40]);
        attributes.set(99, vec![1, 2, 3]);
        let bytes = attributes.to_bytes();
        let parsed = Attributes::parse(&bytes).unwrap();
        assert_eq!(parsed, attributes);
        assert_eq!(parsed.font_size(), Some(6.0));
        assert_eq!(parsed.bbox(), Some([1, 2, 30, 40]));
        assert!(Attributes::parse(&bytes[..bytes.len() - 1]).is_err());
        let array = join_array(&[bytes.clone(), vec![]]);
        assert_eq!(split_array(&array).unwrap(), vec![bytes.as_slice(), &[][..]]);
    }

    #[test]
    fn the_arrays_follow_the_single_block() {
        use crate::database::{Row, SqlValue as Value};
        let mut first = Attributes::default();
        first.set_bbox([0, 0, 10, 10]);
        let mut second = Attributes::default();
        second.set_bbox([20, 0, 30, 10]);
        let columns = ["TextLayerString", "TextLayerAttributes", "TextLayerStringArray", "TextLayerAttributesArray"];
        let row = Row::new(
            columns.iter().map(|c| c.to_string()).collect(),
            vec![
                Value::Blob(b"one".to_vec()),
                Value::Blob(first.to_bytes()),
                Value::Blob(join_array(&[b"two".to_vec()])),
                Value::Blob(join_array(&[second.to_bytes()])),
            ],
        );
        let blocks = read_blocks(&row).unwrap();
        assert_eq!(blocks.iter().map(|b| b.text.as_str()).collect::<Vec<_>>(), ["one", "two"]);
        assert_eq!(blocks[1].attributes.bbox(), Some([20, 0, 30, 10]));
        let single = Row::new(vec!["TextLayerString".into()], vec![Value::Blob(b"only".to_vec())]);
        assert_eq!(read_blocks(&single).unwrap().len(), 1);
    }
}
