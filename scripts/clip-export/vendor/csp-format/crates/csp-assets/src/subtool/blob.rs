//! The binary columns of sub tool settings (`Variant`), all big endian.
//!
//! Four layouts cover the 32 BLOB columns seen:
//!
//! - [`Records`]: `u32 12, u32 count, u32 record size`, then the records.
//!   `VariantShowParam` (u32 item ids shown in the tool property palette),
//!   `BrushInOutTarget` (12-byte records: id, on, value), `IncludeFillColor`,
//!   `ContourFillBlendGraph` and graphs (16-byte f64 x, y points) such as
//!   `Manager.PressureGraph` and the graphs inside [`Effector`].
//! - [`Effector`]: 影響元設定 (what changes a setting while drawing): a
//!   header of 40, 44 or 48 bytes and up to three graphs.
//! - [`MaterialList`]: `u32 8, u32 count`, then material references
//!   (brush tips `*PatternImageArray`, paper textures `*TextureImage`).
//! - `GradationData`: the gradient stops of `.clip` gradient layers and
//!   `.sgs` gradient sets, see [`crate::gradient`].
//!
//! Every parser keeps what it does not understand, so `parse` then
//! `to_bytes` gives back the stored bytes (checked on every sample).

use serde::Serialize;

use crate::error::{Error, Result};

fn word(data: &[u8], at: usize) -> Result<u32> {
    data.get(at..at + 4)
        .map(|b| u32::from_be_bytes(b.try_into().unwrap()))
        .ok_or_else(|| Error::format(format!("sub tool blob: 4 bytes needed at {at:#x} of {}", data.len())))
}

/// Fixed-size records with a 12-byte header. As JSON: 16-byte records as
/// `[x, y]` points, 4-, 8- and 12-byte records as lists of words,
/// anything else as `{"recordSize", "hex"}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Records {
    /// Bytes per record.
    pub record_size: u32,
    /// Each record's bytes.
    pub records: Vec<Vec<u8>>,
}

impl Records {
    /// Parses the header and records; fails when the sizes do not add up.
    pub fn parse(data: &[u8]) -> Result<Records> {
        let (header, count, size) = (word(data, 0)?, word(data, 4)? as usize, word(data, 8)?);
        if header != 12 || size == 0 {
            return Err(Error::format(format!("records: header {header}, record size {size}")));
        }
        let expected = 12 + count.checked_mul(size as usize).ok_or_else(|| Error::format("records: count"))?;
        if data.len() != expected {
            return Err(Error::format(format!("records: {count} × {size} bytes, blob has {}", data.len())));
        }
        let records = data[12..].chunks_exact(size as usize).map(<[u8]>::to_vec).collect();
        Ok(Records { record_size: size, records })
    }

    /// The blob; unchanged records give the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(12 + self.records.len() * self.record_size as usize);
        out.extend_from_slice(&12u32.to_be_bytes());
        out.extend_from_slice(&(self.records.len() as u32).to_be_bytes());
        out.extend_from_slice(&self.record_size.to_be_bytes());
        for record in &self.records {
            out.extend_from_slice(record);
        }
        out
    }

    /// Records of u32 words.
    pub fn words(&self) -> Vec<Vec<u32>> {
        self.records.iter().map(|r| r.as_chunks::<4>().0.iter().map(|w| u32::from_be_bytes(*w)).collect()).collect()
    }

    /// Records of (f64 x, f64 y) points.
    pub fn points(&self) -> Vec<[f64; 2]> {
        self.records
            .iter()
            .filter(|r| r.len() >= 16)
            .map(|r| {
                [f64::from_be_bytes(r[0..8].try_into().unwrap()), f64::from_be_bytes(r[8..16].try_into().unwrap())]
            })
            .collect()
    }

    /// 16-byte records of two `f64` (graph points).
    pub fn from_points(points: &[[f64; 2]]) -> Records {
        Records {
            record_size: 16,
            records: points.iter().map(|p| [p[0].to_be_bytes(), p[1].to_be_bytes()].concat()).collect(),
        }
    }

    /// Records of `size` bytes from rows of `u32` words.
    pub fn from_words(size: u32, rows: &[Vec<u32>]) -> Records {
        Records {
            record_size: size,
            records: rows.iter().map(|r| r.iter().flat_map(|w| w.to_be_bytes()).collect()).collect(),
        }
    }
}

impl Records {
    fn json(&self, as_points: bool) -> serde_json::Value {
        match self.record_size {
            16 if as_points => serde_json::json!(self.points()),
            4 | 8 | 12 => serde_json::json!(self.words()),
            _ => serde_json::json!({
                "recordSize": self.record_size,
                "hex": self.records.iter().map(|x| crate::serial::hex(x)).collect::<Vec<_>>(),
            }),
        }
    }
}

impl Serialize for Records {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        self.json(true).serialize(serializer)
    }
}

/// `VariantShowParam`: the ids of the items shown in the tool property
/// palette, in palette order (see `docs/assets/spec/subtool-items.tsv`).
pub fn show_items(data: &[u8]) -> Result<Vec<u32>> {
    Ok(Records::parse(data)?.words().into_iter().filter_map(|w| w.first().copied()).collect())
}

/// The `VariantShowParam` blob of these item ids.
pub fn show_items_bytes(items: &[u32]) -> Vec<u8> {
    Records::from_words(4, &items.iter().map(|&i| vec![i]).collect::<Vec<_>>()).to_bytes()
}

/// One entry of `BrushInOutTarget` (入り抜きの影響先).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct InOutTarget {
    /// The [`Effector`] item id of the setting (e.g. 1001 brush size).
    pub item: u32,
    /// The setting changes with 入り抜き.
    pub enabled: bool,
    /// The value word (0..100): 入り抜きで変化する最小値 (%), see the spec.
    pub value: u32,
}

/// Decodes `BrushInOutTarget`.
pub fn in_out_targets(data: &[u8]) -> Result<Vec<InOutTarget>> {
    let records = Records::parse(data)?;
    if records.record_size != 12 {
        return Err(Error::format(format!("BrushInOutTarget: {}-byte records", records.record_size)));
    }
    Ok(records.words().into_iter().map(|w| InOutTarget { item: w[0], enabled: w[1] != 0, value: w[2] }).collect())
}

/// The `BrushInOutTarget` blob of these entries.
pub fn in_out_targets_bytes(targets: &[InOutTarget]) -> Vec<u8> {
    let rows: Vec<Vec<u32>> = targets.iter().map(|t| vec![t.item, t.enabled as u32, t.value]).collect();
    Records::from_words(12, &rows).to_bytes()
}

/// Inputs of an effector (bits of header words 1 and 2).
pub const INPUT_PRESSURE: u32 = 0x10;
/// Pen tilt (header bit).
pub const INPUT_TILT: u32 = 0x20;
/// Pen speed (header bit).
pub const INPUT_VELOCITY: u32 = 0x40;
/// Randomness (header bit).
pub const INPUT_RANDOM: u32 = 0x80;
/// Offered on brush size, density and the like since CSP 1.x (meaning
/// not known yet; see the spec).
pub const INPUT_0X100: u32 = 0x100;

/// 影響元設定: how pen pressure, tilt, speed and randomness change a
/// setting.
///
/// Header words (u32, big endian): `[0]` header size (40, 44 or 48),
/// `[1]` inputs offered by this setting, `[2]` inputs in use, `[3]`..`[6]`
/// signed values per input (pressure, tilt, velocity, random; the
/// minimum in %), `[7]` 0, `[8]` / `[9]` byte sizes of the pressure and
/// tilt graphs, `[10]` (44+) the maximum (%) with tilt, `[11]` (48) byte size
/// of the velocity graph. The graphs ([`Records`] of points) follow the
/// header in that order.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Effector {
    /// Header size in bytes (word 0).
    pub header_size: u32,
    /// Inputs this setting offers (word 1, `INPUT_*` bits).
    pub offered: u32,
    /// Inputs in use (word 2, `INPUT_*` bits).
    pub inputs: u32,
    /// Minimum (%) with pressure, tilt, velocity and random.
    pub minimum: [i32; 4],
    /// Header word 7 (0 in every file seen).
    pub word7: u32,
    /// Header word 10 (44- and 48-byte headers): the maximum (%) with tilt
    /// (W4).
    pub word10: Option<u32>,
    /// The pressure graph (筆圧), if stored.
    pub pressure_graph: Option<Records>,
    /// The tilt graph, if stored.
    pub tilt_graph: Option<Records>,
    /// The velocity graph, if stored.
    pub velocity_graph: Option<Records>,
}

impl Effector {
    /// Parses an `…Effector` blob.
    pub fn parse(data: &[u8]) -> Result<Effector> {
        let header_size = word(data, 0)?;
        if !matches!(header_size, 40 | 44 | 48) {
            return Err(Error::format(format!("effector: header of {header_size} bytes")));
        }
        let w = |i: usize| word(data, i * 4);
        let graph_sizes = [w(8)? as usize, w(9)? as usize, if header_size >= 48 { w(11)? as usize } else { 0 }];
        let mut at = header_size as usize;
        let mut graphs = Vec::new();
        for size in graph_sizes {
            if size == 0 {
                graphs.push(None);
                continue;
            }
            let bytes = data.get(at..at + size).ok_or_else(|| Error::format("effector: graph runs past the end"))?;
            graphs.push(Some(Records::parse(bytes)?));
            at += size;
        }
        if at != data.len() {
            return Err(Error::format(format!("effector: {} bytes after the graphs", data.len() - at)));
        }
        let mut graphs = graphs.into_iter();
        Ok(Effector {
            header_size,
            offered: w(1)?,
            inputs: w(2)?,
            minimum: [w(3)? as i32, w(4)? as i32, w(5)? as i32, w(6)? as i32],
            word7: w(7)?,
            word10: if header_size >= 44 { Some(w(10)?) } else { None },
            pressure_graph: graphs.next().flatten(),
            tilt_graph: graphs.next().flatten(),
            velocity_graph: graphs.next().flatten(),
        })
    }

    /// The blob; an unchanged effector gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let graphs =
            [&self.pressure_graph, &self.tilt_graph, &self.velocity_graph].map(|g| g.as_ref().map(Records::to_bytes));
        let size = |i: usize| graphs[i].as_ref().map_or(0, Vec::len) as u32;
        let mut words = vec![
            self.header_size,
            self.offered,
            self.inputs,
            self.minimum[0] as u32,
            self.minimum[1] as u32,
            self.minimum[2] as u32,
            self.minimum[3] as u32,
            self.word7,
            size(0),
            size(1),
        ];
        if self.header_size >= 44 {
            words.push(self.word10.unwrap_or(0));
        }
        if self.header_size >= 48 {
            words.push(size(2));
        }
        let mut out: Vec<u8> = words.iter().flat_map(|w| w.to_be_bytes()).collect();
        for graph in graphs.into_iter().flatten() {
            out.extend_from_slice(&graph);
        }
        out
    }

    /// Whether an input (`INPUT_*`) is in use.
    pub fn uses(&self, input: u32) -> bool {
        self.inputs & input != 0
    }

    /// Turn an input on or off (it must be offered).
    pub fn set_input(&mut self, input: u32, on: bool) -> Result<()> {
        if on && self.offered & input == 0 {
            return Err(Error::format(format!("effector: input {input:#x} is not offered by this setting")));
        }
        if on {
            self.inputs |= input
        } else {
            self.inputs &= !input
        }
        Ok(())
    }

    /// Replace the pressure graph (control points in 0..1).
    pub fn set_pressure_graph(&mut self, points: &[[f64; 2]]) {
        self.pressure_graph = Some(Records::from_points(points));
    }
}

/// A material a brush tip or paper texture uses.
///
/// `u32 size` (including itself), then fields until the size is used up:
/// `path` (u32 bytes, UTF-16LE with a final NUL): where CSP found the
/// material, `.:Paint005:<uuid>:data:material.layer` for materials CSP
/// installs and `.:56:16:<uuid>:data:material_0.layer` for ones in the
/// user's material folder (`Material/56/16/<uuid>/data/…`); `kind` (u32:
/// 3 installed, 2 in the user's folder); `name` (u32 bytes, UTF-16LE);
/// `u32 1`; then, in newer files, the install path (`.:Install:Paint005:…`,
/// empty for user materials) and `u32 0`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MaterialRef {
    /// Where CSP found the material (`.:Paint005:<uuid>:data:material.layer`).
    pub path: String,
    /// 3 installed, 2 in the user's material folder.
    pub kind: Option<u32>,
    /// Material name.
    pub name: Option<String>,
    /// The `u32` after the name (1).
    pub flag: Option<u32>,
    /// Install path (`.:Install:Paint005:…`), in newer files.
    pub install_path: Option<String>,
    /// Bytes after the known fields.
    #[serde(skip)]
    pub rest: Vec<u8>,
}

impl MaterialRef {
    /// The material folder's id (the uuid in the path).
    pub fn uuid(&self) -> Option<&str> {
        self.path.split(':').find(|part| part.len() >= 30 && part.contains('-'))
    }

    /// Path components under CSP's material root (`56/16/<uuid>/data/x`),
    /// for user materials.
    pub fn user_relative_path(&self) -> Option<String> {
        let parts: Vec<&str> = self.path.trim_end_matches('\0').split(':').collect();
        if parts.first() != Some(&".") || parts.get(1).is_some_and(|p| p.starts_with("Paint") || *p == "Install") {
            return None;
        }
        Some(parts[1..].join("/"))
    }
}

fn utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    String::from_utf16_lossy(&units)
}

fn utf16_bytes(text: &str) -> Vec<u8> {
    text.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

/// `*PatternImageArray` and `*TextureImage`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MaterialList {
    /// The materials, in stored order.
    pub materials: Vec<MaterialRef>,
}

impl MaterialList {
    /// Parses a material list.
    pub fn parse(data: &[u8]) -> Result<MaterialList> {
        let (header, count) = (word(data, 0)?, word(data, 4)? as usize);
        if header != 8 {
            return Err(Error::format(format!("material list: header {header}")));
        }
        let mut at = 8;
        let mut materials = Vec::with_capacity(count.min(256));
        for _ in 0..count {
            let size = word(data, at)? as usize;
            let item =
                data.get(at + 4..at + size).ok_or_else(|| Error::format("material list: item runs past the end"))?;
            materials.push(parse_ref(item)?);
            at += size;
        }
        if at != data.len() {
            return Err(Error::format("material list: bytes after the last item"));
        }
        Ok(MaterialList { materials })
    }

    /// The blob; an unchanged list gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&8u32.to_be_bytes());
        out.extend_from_slice(&(self.materials.len() as u32).to_be_bytes());
        for material in &self.materials {
            let item = ref_bytes(material);
            out.extend_from_slice(&(item.len() as u32 + 4).to_be_bytes());
            out.extend_from_slice(&item);
        }
        out
    }
}

fn parse_ref(item: &[u8]) -> Result<MaterialRef> {
    let mut at = 0;
    let string = |at: &mut usize| -> Result<Option<String>> {
        if *at >= item.len() {
            return Ok(None);
        }
        let n = word(item, *at)? as usize;
        let bytes = item
            .get(*at + 4..*at + 4 + n)
            .ok_or_else(|| Error::format("material reference: text runs past the end"))?;
        *at += 4 + n;
        Ok(Some(utf16(bytes)))
    };
    let path = string(&mut at)?.unwrap_or_default();
    let number = |at: &mut usize| -> Result<Option<u32>> {
        if *at >= item.len() {
            return Ok(None);
        }
        let value = word(item, *at)?;
        *at += 4;
        Ok(Some(value))
    };
    let kind = number(&mut at)?;
    let name = string(&mut at)?;
    let flag = number(&mut at)?;
    let install_path = string(&mut at)?;
    Ok(MaterialRef { path, kind, name, flag, install_path, rest: item[at.min(item.len())..].to_vec() })
}

fn ref_bytes(material: &MaterialRef) -> Vec<u8> {
    let mut out = Vec::new();
    let string = |out: &mut Vec<u8>, text: &str| {
        let bytes = utf16_bytes(text);
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        out.extend_from_slice(&bytes);
    };
    string(&mut out, &material.path);
    if let Some(kind) = material.kind {
        out.extend_from_slice(&kind.to_be_bytes());
        if let Some(name) = &material.name {
            string(&mut out, name);
            if let Some(flag) = material.flag {
                out.extend_from_slice(&flag.to_be_bytes());
                if let Some(install) = &material.install_path {
                    string(&mut out, install);
                }
            }
        }
    }
    out.extend_from_slice(&material.rest);
    out
}

/// What layout a column uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BlobKind {
    /// [`Records`].
    Records,
    /// [`Effector`].
    Effector,
    /// [`MaterialList`].
    MaterialList,
    /// A gradation (`crate::gradient`).
    Gradation,
    /// Not known.
    Unknown,
}

/// The layout of a `Variant` column, from its name.
pub fn kind_of_column(column: &str) -> BlobKind {
    if column.ends_with("Effector") {
        BlobKind::Effector
    } else if column.ends_with("ImageArray") || column.ends_with("TextureImage") {
        BlobKind::MaterialList
    } else if column == "GradationData" {
        BlobKind::Gradation
    } else if matches!(
        column,
        "VariantShowParam" | "BrushInOutTarget" | "IncludeFillColor" | "ContourFillBlendGraph" | "PressureGraph"
    ) || column.ends_with("FixedPointArray")
    {
        BlobKind::Records
    } else {
        BlobKind::Unknown
    }
}

/// Parse and re-serialise a blob by its column; `Ok(true)` when the bytes
/// come back unchanged.
pub fn round_trips(column: &str, data: &[u8]) -> Result<bool> {
    let again = match kind_of_column(column) {
        BlobKind::Records => Records::parse(data)?.to_bytes(),
        BlobKind::Effector => Effector::parse(data)?.to_bytes(),
        BlobKind::MaterialList => MaterialList::parse(data)?.to_bytes(),
        BlobKind::Gradation => crate::gradient::GradientData::parse(data)?.to_bytes(),
        BlobKind::Unknown => return Err(Error::format(format!("no parser for column {column}"))),
    };
    Ok(again == data)
}

/// A readable form of a blob for reports and `cspf asset inspect`.
pub fn to_json(column: &str, data: &[u8]) -> serde_json::Value {
    let parsed = match kind_of_column(column) {
        // IncludeFillColor's 16-byte records are not points.
        BlobKind::Records => Records::parse(data).map(|r| r.json(column != "IncludeFillColor")),
        BlobKind::Effector => {
            Effector::parse(data).and_then(|e| serde_json::to_value(e).map_err(|e| Error::format(e.to_string())))
        }
        BlobKind::MaterialList => {
            MaterialList::parse(data).and_then(|m| serde_json::to_value(m).map_err(|e| Error::format(e.to_string())))
        }
        BlobKind::Gradation => crate::gradient::GradientData::parse(data)
            .and_then(|g| serde_json::to_value(g).map_err(|e| Error::format(e.to_string()))),
        BlobKind::Unknown => Err(Error::format("unknown")),
    };
    parsed.unwrap_or_else(|_| serde_json::json!({ "hex": crate::serial::hex(data) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_round_trip() {
        let bytes = show_items_bytes(&[1000, 1081, 20]);
        assert_eq!(show_items(&bytes).unwrap(), [1000, 1081, 20]);
        let targets = [InOutTarget { item: 1001, enabled: true, value: 100 }];
        assert_eq!(in_out_targets(&in_out_targets_bytes(&targets)).unwrap(), targets);
        assert!(Records::parse(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn effector_round_trips() {
        let mut effector = Effector {
            header_size: 48,
            offered: 0xf0,
            inputs: 0x10,
            minimum: [10, 100, 0, -100],
            word7: 0,
            word10: Some(500),
            pressure_graph: None,
            tilt_graph: None,
            velocity_graph: Some(Records::from_points(&[[0.0, 1.0], [1.0, 0.0]])),
        };
        effector.set_pressure_graph(&[[0.0, 0.0], [0.5, 0.8], [1.0, 1.0]]);
        let bytes = effector.to_bytes();
        assert_eq!(Effector::parse(&bytes).unwrap(), effector);
        assert!(effector.set_input(INPUT_0X100, true).is_err());
        assert!(round_trips("BrushSizeEffector", &bytes).unwrap());
    }

    #[test]
    fn material_list_round_trips() {
        let list = MaterialList {
            materials: vec![
                MaterialRef {
                    path: ".:56:16:0f1e2d3c4b-5a69-7887-96a5-b4c3d2e1f0:data:material_0.layer\0".into(),
                    kind: Some(2),
                    name: Some("ブラシ".into()),
                    flag: Some(1),
                    install_path: Some(String::new()),
                    rest: vec![0, 0, 0, 0],
                },
                MaterialRef {
                    path: ".:Paint005:x:data:material.layer\0".into(),
                    kind: Some(3),
                    name: Some("x".into()),
                    flag: Some(1),
                    install_path: None,
                    rest: vec![],
                },
            ],
        };
        let bytes = list.to_bytes();
        assert_eq!(MaterialList::parse(&bytes).unwrap(), list);
        assert_eq!(list.materials[0].uuid(), Some("0f1e2d3c4b-5a69-7887-96a5-b4c3d2e1f0"));
        assert_eq!(
            list.materials[0].user_relative_path().as_deref(),
            Some("56/16/0f1e2d3c4b-5a69-7887-96a5-b4c3d2e1f0/data/material_0.layer")
        );
        assert_eq!(list.materials[1].user_relative_path(), None);
    }
}
