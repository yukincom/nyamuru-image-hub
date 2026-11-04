//! Gradients: `GradationData` (gradient tools' `Variant.GradationData`, the
//! `gradationData` bytes of `.sgs` gradient sets, and the section of the
//! same name in `.clip` gradient layers) and gradient sets (`.sgs`).
//!
//! `GradationData`, big endian:
//!
//! ```text
//! u32 header size (16 or 24)  u32 stop size (28)  u32 stop count  u32 16
//! [header 24: i32 mixing (0 通常, 1 知覚的, 2 知覚的 (Photoshop互換),
//!             3 リニア (Photoshop互換)), i32 luminance correction (0..3)]
//! stop × count (28 bytes):
//!   u32 R, G, B, A   16-bit value repeated in both halves (0xffffffff = 1)
//!   u32 flags        1 main colour (描画色), 2 sub colour (背景色),
//!                    0x10 the change to the next stop follows a curve
//!   u32 position     0..=0x8000
//!   u32 curve points (with flag 0x10)
//! curve points × (all stops with flag 0x10): f64 x, f64 y
//! ```
//!
//! The colour model (how CSP mixes between stops) is in
//! `csp_format::gradient`; this module keeps the bytes exactly.
//!
//! A gradient set file (`.sgs`) is a [`crate::serial`] document:
//! `gradationSetArray` → `gradationSetName` + `gradationItemArray` →
//! `gradationName` + `gradationData`.

use serde::Serialize;

use crate::error::{Error, Result};
use crate::serial::{Document, Object, Value};

/// One colour stop, as stored.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Stop {
    /// Straight RGBA words as stored (`0xffffffff` = 1.0).
    pub rgba: [u32; 4],
    /// 1 main colour (描画色), 2 sub colour (背景色), 0x10 curved to the next stop.
    pub flags: u32,
    /// 0..=0x8000.
    pub position: u32,
    /// Control points of the curve to the next stop (flag 0x10).
    pub curve: Vec<[f64; 2]>,
}

impl Stop {
    /// The colour as straight RGBA 0..1 (main and sub colour stops keep a stored colour too).
    pub fn color(&self) -> [f64; 4] {
        self.rgba.map(|w| (w >> 16) as f64 / 65535.0)
    }

    /// An 8-bit colour stop at `position` (0..1).
    pub fn rgba8(rgba: [u8; 4], position: f64) -> Stop {
        Stop {
            rgba: rgba.map(|c| (c as u32) * 0x0101_0101),
            flags: 0,
            position: (position.clamp(0.0, 1.0) * 32768.0).round() as u32,
            curve: Vec::new(),
        }
    }

    /// The stop takes the main colour (描画色).
    pub fn uses_main_color(&self) -> bool {
        self.flags & 1 != 0
    }

    /// The stop takes the sub colour (背景色).
    pub fn uses_sub_color(&self) -> bool {
        self.flags & 2 != 0
    }
}

/// A `GradationData` blob, kept byte for byte.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GradientData {
    /// Header size (16 or 24).
    pub header_size: u32,
    /// Bytes per stop record (28).
    pub stop_size: u32,
    /// Header word 3 (16).
    pub word3: u32,
    /// Mixing and luminance correction (24-byte headers).
    pub mixing: Option<[i32; 2]>,
    /// The stops, in stored order.
    pub stops: Vec<Stop>,
    /// Bytes inside each stop record after its 28 known bytes.
    #[serde(skip)]
    stop_extra: Vec<Vec<u8>>,
    #[serde(skip)]
    trailing: Vec<u8>,
}

fn word(data: &[u8], at: usize) -> Result<u32> {
    data.get(at..at + 4)
        .map(|b| u32::from_be_bytes(b.try_into().unwrap()))
        .ok_or_else(|| Error::format(format!("GradationData: cut at {at:#x}")))
}

fn real(data: &[u8], at: usize) -> Result<f64> {
    data.get(at..at + 8)
        .map(|b| f64::from_be_bytes(b.try_into().unwrap()))
        .ok_or_else(|| Error::format(format!("GradationData: cut at {at:#x}")))
}

impl GradientData {
    /// A 16-byte-header gradient with these stops.
    pub fn new(stops: Vec<Stop>) -> GradientData {
        let stop_extra = vec![Vec::new(); stops.len()];
        GradientData {
            header_size: 16,
            stop_size: 28,
            word3: 16,
            mixing: None,
            stops,
            stop_extra,
            trailing: Vec::new(),
        }
    }

    /// Parses a `GradationData` blob.
    pub fn parse(data: &[u8]) -> Result<GradientData> {
        let header_size = word(data, 0)?;
        let stop_size = word(data, 4)?;
        let count = word(data, 8)? as usize;
        let word3 = word(data, 12)?;
        if !(16..=64).contains(&header_size) || stop_size < 28 || count > 4096 {
            return Err(Error::format(format!("GradationData: header {header_size}, {count} stops of {stop_size}")));
        }
        let mixing = if header_size >= 24 { Some([word(data, 16)? as i32, word(data, 20)? as i32]) } else { None };
        let mut stops = Vec::with_capacity(count);
        let mut stop_extra = Vec::with_capacity(count);
        let mut curve_at = header_size as usize + count * stop_size as usize;
        for index in 0..count {
            let at = header_size as usize + index * stop_size as usize;
            let rgba = [word(data, at)?, word(data, at + 4)?, word(data, at + 8)?, word(data, at + 12)?];
            let flags = word(data, at + 16)?;
            let position = word(data, at + 20)?;
            let points = word(data, at + 24)? as usize;
            let mut curve = Vec::new();
            if flags & 0x10 != 0 {
                if points > 1024 {
                    return Err(Error::format("GradationData: curve too long"));
                }
                for p in 0..points {
                    curve.push([real(data, curve_at + 16 * p)?, real(data, curve_at + 16 * p + 8)?]);
                }
                curve_at += 16 * points;
            } else if points != 0 {
                return Err(Error::format("GradationData: curve points without flag 0x10"));
            }
            stop_extra.push(data[at + 28..at + stop_size as usize].to_vec());
            stops.push(Stop { rgba, flags, position, curve });
        }
        if curve_at > data.len() {
            return Err(Error::format("GradationData: curves run past the end"));
        }
        Ok(GradientData {
            header_size,
            stop_size,
            word3,
            mixing,
            stops,
            stop_extra,
            trailing: data[curve_at..].to_vec(),
        })
    }

    /// The blob; an unchanged gradient gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let put = |out: &mut Vec<u8>, w: u32| out.extend_from_slice(&w.to_be_bytes());
        put(&mut out, self.header_size);
        put(&mut out, self.stop_size);
        put(&mut out, self.stops.len() as u32);
        put(&mut out, self.word3);
        if let Some([mixing, correction]) = self.mixing {
            put(&mut out, mixing as u32);
            put(&mut out, correction as u32);
        }
        out.resize(self.header_size as usize, 0);
        for (index, stop) in self.stops.iter().enumerate() {
            for w in stop.rgba {
                put(&mut out, w);
            }
            put(&mut out, stop.flags);
            put(&mut out, stop.position);
            put(&mut out, if stop.flags & 0x10 != 0 { stop.curve.len() as u32 } else { 0 });
            match self.stop_extra.get(index) {
                Some(extra) => out.extend_from_slice(extra),
                None => out.resize(out.len() + (self.stop_size as usize - 28), 0),
            }
        }
        for stop in self.stops.iter().filter(|s| s.flags & 0x10 != 0) {
            for [x, y] in &stop.curve {
                out.extend_from_slice(&x.to_be_bytes());
                out.extend_from_slice(&y.to_be_bytes());
            }
        }
        out.extend_from_slice(&self.trailing);
        out
    }

    /// The colour model of `csp_format` for these stops.
    pub fn ramp(&self) -> Result<csp_format::gradient::Ramp> {
        let bytes = self.to_bytes();
        let mut sized = (bytes.len() as u32).to_be_bytes().to_vec();
        sized.extend_from_slice(&bytes);
        csp_format::gradient::Ramp::parse(&sized)
    }
}

/// One gradient of a set.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Gradient {
    /// `gradationName`.
    pub name: String,
    /// `gradationData`.
    pub data: GradientData,
}

/// A named group of gradients (a tab in the gradient set list).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GradientGroup {
    /// `gradationSetName`.
    pub name: String,
    /// The gradients, in list order.
    pub gradients: Vec<Gradient>,
}

/// A `.sgs` gradient set file.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GradientSet {
    /// The groups, in list order.
    pub groups: Vec<GradientGroup>,
}

impl GradientSet {
    /// Parses a `.sgs` file.
    pub fn parse(data: &[u8]) -> Result<GradientSet> {
        GradientSet::from_document(&Document::parse(data)?)
    }

    /// Reads the gradient set of a parsed [`crate::serial`] document.
    pub fn from_document(document: &Document) -> Result<GradientSet> {
        let sets = document
            .root
            .array("gradationSetArray")
            .ok_or_else(|| Error::format("gradient set: no gradationSetArray"))?;
        let mut groups = Vec::new();
        for set in sets {
            let set = set.as_object().ok_or_else(|| Error::format("gradient set: entry is not an object"))?;
            let mut gradients = Vec::new();
            for item in set.array("gradationItemArray").unwrap_or(&[]) {
                let item = item.as_object().ok_or_else(|| Error::format("gradient set: item is not an object"))?;
                let data = item
                    .get("gradationData")
                    .and_then(Value::as_bytes)
                    .ok_or_else(|| Error::format("gradient set: no gradationData"))?;
                gradients.push(Gradient {
                    name: item.str("gradationName").unwrap_or("").into(),
                    data: GradientData::parse(data)?,
                });
            }
            groups.push(GradientGroup { name: set.str("gradationSetName").unwrap_or("").into(), gradients });
        }
        Ok(GradientSet { groups })
    }

    /// A document in the layout CSP writes (typenames empty, as in CSP's files).
    pub fn to_document(&self) -> Document {
        let array = |items: Vec<Value>| Value::Array { head: Object::new("", vec![]).head, items };
        let sets = self
            .groups
            .iter()
            .map(|group| {
                let items = group
                    .gradients
                    .iter()
                    .map(|g| {
                        Value::Object(Object::new(
                            "",
                            vec![
                                ("gradationName".into(), Value::String(g.name.clone())),
                                ("gradationData".into(), Value::Bytes(g.data.to_bytes())),
                            ],
                        ))
                    })
                    .collect();
                Value::Object(Object::new(
                    "",
                    vec![
                        ("gradationSetName".into(), Value::String(group.name.clone())),
                        ("gradationItemArray".into(), array(items)),
                    ],
                ))
            })
            .collect();
        Document { root: Object::new("", vec![("gradationSetArray".into(), array(sets))]), trailing: Vec::new() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gradient_data_round_trips() {
        let mut data = GradientData::new(vec![Stop::rgba8([0, 0, 0, 255], 0.0), Stop::rgba8([255, 255, 255, 0], 1.0)]);
        data.stops[0].flags = 0x11;
        data.stops[0].curve = vec![[0.0, 0.0], [1.0, 1.0]];
        data.mixing = Some([1, 3]);
        data.header_size = 24;
        let bytes = data.to_bytes();
        let parsed = GradientData::parse(&bytes).unwrap();
        assert_eq!(parsed, data);
        assert_eq!(parsed.to_bytes(), bytes);
        assert!(parsed.stops[0].uses_main_color());
        let ramp = parsed.ramp().unwrap();
        assert_eq!(ramp.color(0.0)[3], 1.0);
    }

    #[test]
    fn gradient_set_round_trips_through_the_document() {
        let set = GradientSet {
            groups: vec![GradientGroup {
                name: "Test".into(),
                gradients: vec![Gradient {
                    name: "A".into(),
                    data: GradientData::new(vec![Stop::rgba8([255, 0, 0, 255], 0.0)]),
                }],
            }],
        };
        let bytes = set.to_document().to_bytes();
        assert!(crate::serial::looks_like(&bytes));
        assert_eq!(GradientSet::parse(&bytes).unwrap(), set);
    }
}
