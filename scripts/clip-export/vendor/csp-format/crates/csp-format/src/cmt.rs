//! "cmt " documents: CSP's binary tree format for animation track mixers
//! (`Track.TrackActionMixer` and `TrackActionMixer2`).
//!
//! A document is `"cmt "`, a four-character version (`0100` or `0110`),
//! `"binc"`, a CRC-32 (little endian) of everything after it, then a string
//! table and one root node. All numbers are little endian. Version `0110`
//! puts a 12-byte header before each node (16, then the offsets of the
//! attribute count and of the child count from the node's start).
//!
//! The string table starts with the type names of the version (see
//! [`TYPES_0100`] / [`TYPES_0110`]), followed by every other string in the
//! order a pre-order walk first uses it: node name, string values,
//! attribute names and values, then the children. [`Document::to_bytes`]
//! rebuilds the table that way, so documents CSP wrote are reproduced byte
//! for byte. See `docs/spec/08-animation.md`.

use crate::binary::{Reader, Writer};
use crate::error::{Error, Result, bail};

/// Type names of version `0100` (single precision arrays and pairs).
pub const TYPES_0100: [&str; 22] = [
    "null",
    "Byte",
    "SByte",
    "UInt16",
    "Int16",
    "UInt32",
    "Int32",
    "Single",
    "Double",
    "String",
    "Float2",
    "Float3",
    "Quat",
    "Matrix44",
    "Single[]",
    "Byte[]",
    "Int32[]",
    "String[]",
    "Float2[]",
    "Float3[]",
    "Quat[]",
    "Matrix44[]",
];

/// Type names of version `0110` (double precision arrays and pairs).
pub const TYPES_0110: [&str; 22] = [
    "null",
    "Byte",
    "SByte",
    "UInt16",
    "Int16",
    "UInt32",
    "Int32",
    "Single",
    "Double",
    "String",
    "Double2",
    "Double3",
    "Quat",
    "Matrix44",
    "Double[]",
    "Byte[]",
    "Int32[]",
    "String[]",
    "Double2[]",
    "Double3[]",
    "Quat[]",
    "Matrix44[]",
];

const MAGIC: &[u8; 4] = b"cmt ";
const BINARY: &[u8; 4] = b"binc";
/// First word of a `0110` node header.
const NODE_HEADER: u32 = 16;

/// A node's value. `Quat` and `Matrix44` have not been seen in a file and
/// are refused rather than guessed.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum Value {
    /// No value.
    Null,
    /// `Byte`.
    Byte(u8),
    /// `SByte`.
    SByte(i8),
    /// `UInt16`.
    UInt16(u16),
    /// `Int16`.
    Int16(i16),
    /// `UInt32`.
    UInt32(u32),
    /// `Int32`.
    Int32(i32),
    /// `Single` (f32).
    Single(f32),
    /// `Double` (f64).
    Double(f64),
    /// `String` (UTF-8, at most 255 bytes, kept in the string table).
    String(String),
    /// `Float2`.
    Float2([f32; 2]),
    /// `Float3`.
    Float3([f32; 3]),
    /// `Double2`.
    Double2([f64; 2]),
    /// `Double3`.
    Double3([f64; 3]),
    /// `SingleArray`.
    SingleArray(Vec<f32>),
    /// `DoubleArray`.
    DoubleArray(Vec<f64>),
    /// `ByteArray`.
    ByteArray(Vec<u8>),
    /// `Int32Array`.
    Int32Array(Vec<i32>),
    /// `StringArray`.
    StringArray(Vec<String>),
    /// `Float2Array`.
    Float2Array(Vec<[f32; 2]>),
    /// `Float3Array`.
    Float3Array(Vec<[f32; 3]>),
    /// `Double2Array`.
    Double2Array(Vec<[f64; 2]>),
    /// `Double3Array`.
    Double3Array(Vec<[f64; 3]>),
}

impl Value {
    /// The type name stored in the document (`"null"` for no value).
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Byte(_) => "Byte",
            Value::SByte(_) => "SByte",
            Value::UInt16(_) => "UInt16",
            Value::Int16(_) => "Int16",
            Value::UInt32(_) => "UInt32",
            Value::Int32(_) => "Int32",
            Value::Single(_) => "Single",
            Value::Double(_) => "Double",
            Value::String(_) => "String",
            Value::Float2(_) => "Float2",
            Value::Float3(_) => "Float3",
            Value::Double2(_) => "Double2",
            Value::Double3(_) => "Double3",
            Value::SingleArray(_) => "Single[]",
            Value::DoubleArray(_) => "Double[]",
            Value::ByteArray(_) => "Byte[]",
            Value::Int32Array(_) => "Int32[]",
            Value::StringArray(_) => "String[]",
            Value::Float2Array(_) => "Float2[]",
            Value::Float3Array(_) => "Float3[]",
            Value::Double2Array(_) => "Double2[]",
            Value::Double3Array(_) => "Double3[]",
        }
    }

    /// A number (any scalar numeric type).
    pub fn as_f64(&self) -> Option<f64> {
        Some(match self {
            Value::Byte(v) => *v as f64,
            Value::SByte(v) => *v as f64,
            Value::UInt16(v) => *v as f64,
            Value::Int16(v) => *v as f64,
            Value::UInt32(v) => *v as f64,
            Value::Int32(v) => *v as f64,
            Value::Single(v) => *v as f64,
            Value::Double(v) => *v,
            _ => return None,
        })
    }

    /// A pair (`Float2` / `Double2`).
    pub fn as_pair(&self) -> Option<[f64; 2]> {
        match self {
            Value::Float2([x, y]) => Some([*x as f64, *y as f64]),
            Value::Double2(pair) => Some(*pair),
            _ => None,
        }
    }

    /// A numeric array (`Single[]`, `Double[]`, `Byte[]` or `Int32[]`).
    pub fn as_numbers(&self) -> Option<Vec<f64>> {
        match self {
            Value::SingleArray(v) => Some(v.iter().map(|x| *x as f64).collect()),
            Value::DoubleArray(v) => Some(v.clone()),
            Value::ByteArray(v) => Some(v.iter().map(|x| *x as f64).collect()),
            Value::Int32Array(v) => Some(v.iter().map(|x| *x as f64).collect()),
            _ => None,
        }
    }

    /// The strings of a `StringArray`.
    pub fn as_strings(&self) -> Option<&[String]> {
        match self {
            Value::StringArray(v) => Some(v),
            _ => None,
        }
    }

    /// The text of a `String`.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(v) => Some(v),
            _ => None,
        }
    }

    /// The strings this value adds to the string table, in order.
    fn strings(&self) -> Vec<&str> {
        match self {
            Value::String(v) => vec![v.as_str()],
            Value::StringArray(v) => v.iter().map(String::as_str).collect(),
            _ => Vec::new(),
        }
    }
}

/// One node: a name, a value, attributes (name, value) and children.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Node {
    /// Node name.
    pub name: String,
    /// Node value.
    pub value: Value,
    /// Attributes (name, value), in stored order.
    pub attributes: Vec<(String, String)>,
    /// Child nodes, in stored order.
    pub children: Vec<Node>,
}

impl Node {
    /// A node without attributes or children.
    pub fn new(name: impl Into<String>, value: Value) -> Self {
        Node { name: name.into(), value, attributes: Vec::new(), children: Vec::new() }
    }

    /// The value of an attribute.
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }

    /// The first child with this name.
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|child| child.name == name)
    }

    /// The first child with this name, mutably.
    pub fn child_mut(&mut self, name: &str) -> Option<&mut Node> {
        self.children.iter_mut().find(|child| child.name == name)
    }

    /// Follow a path of child names.
    pub fn find(&self, path: &[&str]) -> Option<&Node> {
        path.iter().try_fold(self, |node, name| node.child(name))
    }

    /// Follow a path of child names, mutably.
    pub fn find_mut(&mut self, path: &[&str]) -> Option<&mut Node> {
        path.iter().try_fold(self, |node, name| node.child_mut(name))
    }

    /// Indented text, one node per line (for inspection).
    pub fn dump(&self) -> String {
        let mut out = String::new();
        self.dump_into(0, &mut out);
        out
    }

    fn dump_into(&self, depth: usize, out: &mut String) {
        use std::fmt::Write;
        let _ = write!(out, "{}{}", "  ".repeat(depth), self.name);
        if self.value != Value::Null {
            let _ = write!(out, " : {} = {}", self.value.type_name(), value_text(&self.value));
        }
        if !self.attributes.is_empty() {
            let attributes: Vec<String> = self.attributes.iter().map(|(k, v)| format!("{k}={v:?}")).collect();
            let _ = write!(out, " [{}]", attributes.join(" "));
        }
        out.push('\n');
        for child in &self.children {
            child.dump_into(depth + 1, out);
        }
    }
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(v) => format!("{v:?}"),
        Value::Byte(v) => v.to_string(),
        Value::SByte(v) => v.to_string(),
        Value::UInt16(v) => v.to_string(),
        Value::Int16(v) => v.to_string(),
        Value::UInt32(v) => v.to_string(),
        Value::Int32(v) => v.to_string(),
        Value::Single(v) => v.to_string(),
        Value::Double(v) => v.to_string(),
        other => serde_json::to_value(other)
            .ok()
            .and_then(|json| json.as_object().and_then(|o| o.values().next().cloned()))
            .map(|inner| inner.to_string())
            .unwrap_or_default(),
    }
}

/// A whole document.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Document {
    /// `0100` or `0110`.
    pub version: String,
    /// The root node.
    pub root: Node,
}

impl Document {
    /// Parses a "cmt " document (checks the magic, the version and the CRC).
    pub fn parse(data: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(data);
        if reader.bytes(4)? != MAGIC {
            bail!("Not a cmt document");
        }
        let version = String::from_utf8_lossy(reader.bytes(4)?).into_owned();
        if version != "0100" && version != "0110" {
            bail!("Unknown cmt version {version:?}");
        }
        if reader.bytes(4)? != BINARY {
            bail!("cmt document is not binary");
        }
        let crc = reader.le_u32()?;
        if crc != crc32(&data[16..]) {
            bail!("cmt document checksum does not match");
        }
        let count = reader.le_u32()? as usize;
        let mut strings = Vec::with_capacity(count.min(data.len()));
        for _ in 0..count {
            let length = reader.u8()? as usize;
            let text =
                std::str::from_utf8(reader.bytes(length)?).map_err(|_| Error::format("cmt string is not UTF-8"))?;
            strings.push(text.to_owned());
        }
        let types = types(&version);
        if strings.len() < types.len() || strings.iter().zip(types).any(|(a, b)| a != b) {
            bail!("cmt string table does not start with the {version} type names");
        }
        let parser = Parser { strings: &strings, headers: version == "0110" };
        let root = parser.node(&mut reader, 0)?;
        if !reader.is_empty() {
            bail!("{} bytes after the cmt root node", reader.remaining());
        }
        Ok(Document { version, root })
    }

    /// The document bytes with a new CRC; an unchanged document gives the same bytes.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let types = types(&self.version);
        let mut strings: Vec<String> = types.iter().map(|t| (*t).to_owned()).collect();
        collect_strings(&self.root, &mut strings);
        let index = |text: &str| -> u32 { strings.iter().position(|s| s == text).expect("collected") as u32 };
        let mut body = Writer::new();
        body.le_u32(strings.len() as u32);
        for text in &strings {
            let length = u8::try_from(text.len()).map_err(|_| Error::format("cmt string longer than 255 bytes"))?;
            body.u8(length).bytes(text.as_bytes());
        }
        write_node(&self.root, &mut body, &index, types, self.version == "0110")?;
        let body = body.into_inner();
        let mut out = Writer::new();
        out.bytes(MAGIC).bytes(self.version.as_bytes()).bytes(BINARY).le_u32(crc32(&body)).bytes(&body);
        Ok(out.into_inner())
    }

    /// The `ActionNodeClip` node of a track mixer.
    pub fn action_clip(&self) -> Option<&Node> {
        self.root.find(&["General", "ActionNodeClip"])
    }

    /// The `ActionNodeClip` node of a track mixer, mutably.
    pub fn action_clip_mut(&mut self) -> Option<&mut Node> {
        self.root.find_mut(&["General", "ActionNodeClip"])
    }
}

fn types(version: &str) -> &'static [&'static str; 22] {
    if version == "0110" { &TYPES_0110 } else { &TYPES_0100 }
}

fn collect_strings(node: &Node, strings: &mut Vec<String>) {
    let mut add = |text: &str| {
        if !strings.iter().any(|s| s == text) {
            strings.push(text.to_owned());
        }
    };
    add(&node.name);
    for text in node.value.strings() {
        add(text);
    }
    for (name, value) in &node.attributes {
        add(name);
        add(value);
    }
    for child in &node.children {
        collect_strings(child, strings);
    }
}

struct Parser<'a> {
    strings: &'a [String],
    headers: bool,
}

impl Parser<'_> {
    fn string(&self, index: u32) -> Result<String> {
        self.strings.get(index as usize).cloned().ok_or_else(|| Error::format(format!("cmt string {index} missing")))
    }

    fn node(&self, reader: &mut Reader, depth: usize) -> Result<Node> {
        if depth > 64 {
            bail!("cmt tree too deep");
        }
        let start = reader.position();
        let offsets = if self.headers {
            let first = reader.le_u32()?;
            if first != NODE_HEADER {
                bail!("cmt node header {first}, expected {NODE_HEADER}");
            }
            Some((reader.le_u32()? as usize, reader.le_u32()? as usize))
        } else {
            None
        };
        let name = self.string(reader.le_u32()?)?;
        let type_index = reader.le_u32()? as usize;
        let type_name =
            *TYPES_0100.get(type_index).ok_or_else(|| Error::format(format!("cmt type {type_index} unknown")))?;
        let value = self.value(reader, type_index, type_name)?;
        if let Some((attributes, _)) = offsets
            && reader.position() != start + attributes
        {
            bail!("cmt node {name:?}: attributes at {}, header says {attributes}", reader.position() - start);
        }
        let count = reader.le_u32()? as usize;
        let mut attribute_list = Vec::with_capacity(count.min(reader.remaining() / 8));
        for _ in 0..count {
            attribute_list.push((self.string(reader.le_u32()?)?, self.string(reader.le_u32()?)?));
        }
        if let Some((_, children)) = offsets
            && reader.position() != start + children
        {
            bail!("cmt node {name:?}: children at {}, header says {children}", reader.position() - start);
        }
        let count = reader.le_u32()? as usize;
        let mut children = Vec::with_capacity(count.min(reader.remaining() / 12));
        for _ in 0..count {
            children.push(self.node(reader, depth + 1)?);
        }
        Ok(Node { name, value, attributes: attribute_list, children })
    }

    fn value(&self, reader: &mut Reader, type_index: usize, name0100: &str) -> Result<Value> {
        // Index 7 and 8 are Single and Double in both versions; 10, 11, 14,
        // 18 and 19 are single precision in 0100 and double in 0110.
        let double = self.headers;
        let pair = |r: &mut Reader| -> Result<[f64; 2]> { Ok([r.le_f64()?, r.le_f64()?]) };
        let triple = |r: &mut Reader| -> Result<[f64; 3]> { Ok([r.le_f64()?, r.le_f64()?, r.le_f64()?]) };
        let fpair = |r: &mut Reader| -> Result<[f32; 2]> { Ok([r.le_f32()?, r.le_f32()?]) };
        let ftriple = |r: &mut Reader| -> Result<[f32; 3]> { Ok([r.le_f32()?, r.le_f32()?, r.le_f32()?]) };
        let count = |r: &mut Reader, size: usize| -> Result<usize> {
            let n = r.le_u32()? as usize;
            if n.saturating_mul(size) > r.remaining() {
                bail!("cmt array of {n} does not fit");
            }
            Ok(n)
        };
        Ok(match type_index {
            0 => Value::Null,
            1 => Value::Byte(reader.u8()?),
            2 => Value::SByte(reader.u8()? as i8),
            3 => Value::UInt16(reader.le_u16()?),
            4 => Value::Int16(reader.le_u16()? as i16),
            5 => Value::UInt32(reader.le_u32()?),
            6 => Value::Int32(reader.le_i32()?),
            7 => Value::Single(reader.le_f32()?),
            8 => Value::Double(reader.le_f64()?),
            9 => Value::String(self.string(reader.le_u32()?)?),
            10 if double => Value::Double2(pair(reader)?),
            10 => Value::Float2(fpair(reader)?),
            11 if double => Value::Double3(triple(reader)?),
            11 => Value::Float3(ftriple(reader)?),
            14 if double => {
                let n = count(reader, 8)?;
                Value::DoubleArray((0..n).map(|_| reader.le_f64()).collect::<Result<_>>()?)
            }
            14 => {
                let n = count(reader, 4)?;
                Value::SingleArray((0..n).map(|_| reader.le_f32()).collect::<Result<_>>()?)
            }
            15 => {
                let n = count(reader, 1)?;
                Value::ByteArray(reader.bytes(n)?.to_vec())
            }
            16 => {
                let n = count(reader, 4)?;
                Value::Int32Array((0..n).map(|_| reader.le_i32()).collect::<Result<_>>()?)
            }
            17 => {
                let n = count(reader, 4)?;
                Value::StringArray((0..n).map(|_| self.string(reader.le_u32()?)).collect::<Result<_>>()?)
            }
            18 if double => {
                let n = count(reader, 16)?;
                Value::Double2Array((0..n).map(|_| pair(reader)).collect::<Result<_>>()?)
            }
            18 => {
                let n = count(reader, 8)?;
                Value::Float2Array((0..n).map(|_| fpair(reader)).collect::<Result<_>>()?)
            }
            19 if double => {
                let n = count(reader, 24)?;
                Value::Double3Array((0..n).map(|_| triple(reader)).collect::<Result<_>>()?)
            }
            19 => {
                let n = count(reader, 12)?;
                Value::Float3Array((0..n).map(|_| ftriple(reader)).collect::<Result<_>>()?)
            }
            _ => bail!("cmt value type {name0100} is not supported"),
        })
    }
}

fn write_node(
    node: &Node,
    out: &mut Writer,
    index: &dyn Fn(&str) -> u32,
    types: &[&str; 22],
    headers: bool,
) -> Result<()> {
    let type_name = node.value.type_name();
    let type_index = types
        .iter()
        .position(|t| *t == type_name)
        .ok_or_else(|| Error::format(format!("cmt type {type_name} does not exist in this version")))?;
    let mut value = Writer::new();
    match &node.value {
        Value::Null => {}
        Value::Byte(v) => {
            value.u8(*v);
        }
        Value::SByte(v) => {
            value.u8(*v as u8);
        }
        Value::UInt16(v) => {
            value.le_u16(*v);
        }
        Value::Int16(v) => {
            value.le_u16(*v as u16);
        }
        Value::UInt32(v) => {
            value.le_u32(*v);
        }
        Value::Int32(v) => {
            value.le_i32(*v);
        }
        Value::Single(v) => {
            value.le_f32(*v);
        }
        Value::Double(v) => {
            value.le_f64(*v);
        }
        Value::String(v) => {
            value.le_u32(index(v));
        }
        Value::Float2(v) => v.iter().for_each(|x| {
            value.le_f32(*x);
        }),
        Value::Float3(v) => v.iter().for_each(|x| {
            value.le_f32(*x);
        }),
        Value::Double2(v) => v.iter().for_each(|x| {
            value.le_f64(*x);
        }),
        Value::Double3(v) => v.iter().for_each(|x| {
            value.le_f64(*x);
        }),
        Value::SingleArray(v) => {
            value.le_u32(v.len() as u32);
            v.iter().for_each(|x| {
                value.le_f32(*x);
            });
        }
        Value::DoubleArray(v) => {
            value.le_u32(v.len() as u32);
            v.iter().for_each(|x| {
                value.le_f64(*x);
            });
        }
        Value::ByteArray(v) => {
            value.le_u32(v.len() as u32).bytes(v);
        }
        Value::Int32Array(v) => {
            value.le_u32(v.len() as u32);
            v.iter().for_each(|x| {
                value.le_i32(*x);
            });
        }
        Value::StringArray(v) => {
            value.le_u32(v.len() as u32);
            v.iter().for_each(|x| {
                value.le_u32(index(x));
            });
        }
        Value::Float2Array(v) => {
            value.le_u32(v.len() as u32);
            v.iter().flatten().for_each(|x| {
                value.le_f32(*x);
            });
        }
        Value::Float3Array(v) => {
            value.le_u32(v.len() as u32);
            v.iter().flatten().for_each(|x| {
                value.le_f32(*x);
            });
        }
        Value::Double2Array(v) => {
            value.le_u32(v.len() as u32);
            v.iter().flatten().for_each(|x| {
                value.le_f64(*x);
            });
        }
        Value::Double3Array(v) => {
            value.le_u32(v.len() as u32);
            v.iter().flatten().for_each(|x| {
                value.le_f64(*x);
            });
        }
    }
    let value = value.into_inner();
    if headers {
        let attributes = 12 + 8 + value.len();
        let children = attributes + 4 + 8 * node.attributes.len();
        out.le_u32(NODE_HEADER).le_u32(attributes as u32).le_u32(children as u32);
    }
    out.le_u32(index(&node.name)).le_u32(type_index as u32).bytes(&value);
    out.le_u32(node.attributes.len() as u32);
    for (name, value) in &node.attributes {
        out.le_u32(index(name)).le_u32(index(value));
    }
    out.le_u32(node.children.len() as u32);
    for child in &node.children {
        write_node(child, out, index, types, headers)?;
    }
    Ok(())
}

/// CRC-32 (zlib's) of `data`.
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = flate2::Crc::new();
    crc.update(data);
    crc.sum()
}

/// Decode an external chunk payload holding a zlib-compressed document:
/// u64 big endian (bytes that follow), u32 little endian (zlib stream
/// length), the stream.
pub fn unpack(payload: &[u8]) -> Result<Vec<u8>> {
    let mut reader = Reader::new(payload);
    let rest = reader.be_u64()?;
    let length = reader.le_u32()? as usize;
    if rest as usize != payload.len() - 8 || length != payload.len() - 12 {
        bail!("cmt chunk lengths {rest}/{length} do not match its size {}", payload.len());
    }
    let mut out = Vec::new();
    std::io::Read::read_to_end(&mut flate2::read::ZlibDecoder::new(&payload[12..]), &mut out)?;
    Ok(out)
}

/// The external chunk payload of a document's bytes, compressed as CSP does.
pub fn pack(document: &[u8]) -> Result<Vec<u8>> {
    let stream = crate::zlib::compress(document)?;
    let mut out = Writer::new();
    out.be_u64(stream.len() as u64 + 4).le_u32(stream.len() as u32).bytes(&stream);
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(version: &str) -> Document {
        let double = version == "0110";
        let numbers = |v: &[f64]| {
            if double {
                Value::DoubleArray(v.to_vec())
            } else {
                Value::SingleArray(v.iter().map(|x| *x as f32).collect())
            }
        };
        let mut curve = Node::new("FCurve", Value::Null);
        curve.attributes.push(("Type".into(), "Opacity".into()));
        curve.children = vec![
            Node::new("Frame", numbers(&[10.0, 90.0])),
            Node::new("Value", numbers(&[89.84375, 30.078125])),
            Node::new("Interp", Value::StringArray(vec!["Constant".into(), "Default".into()])),
            Node::new("ReviseConstant", Value::ByteArray(vec![1, 1])),
        ];
        let mut param = Node::new("Param", Value::Double(30.0));
        param.attributes.push(("Name".into(), "Opacity".into()));
        let mut anim = Node::new("AnimInfo", Value::Null);
        anim.children = vec![param, curve];
        let mut clip = Node::new("ActionNodeClip", Value::Null);
        clip.attributes.push(("Name".into(), String::new()));
        let mut time = Node::new("TimeClip", Value::Null);
        time.children = vec![Node::new("Start", Value::Double(10.0)), Node::new("End", Value::Double(145.0))];
        clip.children = vec![time, Node::new("Blend", Value::Byte(0)), anim];
        let mut general = Node::new("General", Value::Null);
        general.attributes.push(("Version".into(), if double { "2.1.0" } else { "2.0.0" }.into()));
        general.children = vec![clip];
        let mut info = Node::new("Version-Information", Value::Null);
        info.children = vec![
            Node::new("Software", Value::String("CLIP STUDIO".into())),
            Node::new("Version", Value::String("2.1.0".into())),
        ];
        let mut root = Node::new("celsysdocument", Value::Null);
        root.attributes.push(("version".into(), "1.0.0".into()));
        root.children = vec![info, general];
        Document { version: version.into(), root }
    }

    #[test]
    fn both_versions_round_trip() {
        for version in ["0100", "0110"] {
            let document = sample(version);
            let bytes = document.to_bytes().unwrap();
            assert_eq!(&bytes[..8], format!("cmt {version}").as_bytes());
            let parsed = Document::parse(&bytes).unwrap();
            assert_eq!(parsed, document);
            assert_eq!(parsed.to_bytes().unwrap(), bytes);
            let clip = parsed.action_clip().unwrap();
            assert_eq!(clip.find(&["TimeClip", "End"]).unwrap().value.as_f64(), Some(145.0));
        }
    }

    #[test]
    fn version_0110_has_node_headers() {
        let bytes = sample("0110").to_bytes().unwrap();
        let count = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
        let mut at = 20;
        for _ in 0..count {
            at += 1 + bytes[at] as usize;
        }
        // Root: header 16, attributes after 12 + 8 (null value), children after one attribute.
        let words: Vec<u32> =
            (0..3).map(|i| u32::from_le_bytes(bytes[at + 4 * i..at + 4 * i + 4].try_into().unwrap())).collect();
        assert_eq!(words, [16, 20, 32]);
    }

    #[test]
    fn string_table_follows_first_use() {
        let bytes = sample("0100").to_bytes().unwrap();
        let mut reader = Reader::new(&bytes[16..]);
        let count = reader.le_u32().unwrap() as usize;
        let strings: Vec<String> = (0..count)
            .map(|_| {
                let n = reader.u8().unwrap() as usize;
                String::from_utf8(reader.bytes(n).unwrap().to_vec()).unwrap()
            })
            .collect();
        assert_eq!(
            &strings[22..28],
            ["celsysdocument", "version", "1.0.0", "Version-Information", "Software", "CLIP STUDIO"]
        );
    }

    #[test]
    fn checksum_and_packing_are_checked() {
        let mut bytes = sample("0110").to_bytes().unwrap();
        let packed = pack(&bytes).unwrap();
        assert_eq!(unpack(&packed).unwrap(), bytes);
        *bytes.last_mut().unwrap() ^= 1;
        assert!(Document::parse(&bytes).is_err());
    }
}
