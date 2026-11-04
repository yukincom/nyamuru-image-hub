//! CSP's typed serialisation (`.laf` / `.las` auto actions, `.sgs`
//! gradient sets): a tree of objects, arrays and scalars.
//!
//! ```text
//! object    = fields(head) fields(body)      head holds "typename"
//! fields    = count key value × count
//! count     = number
//! key       = number(length) UTF-8 bytes
//! number    = u8 n, n bytes big endian (0 bytes = 0); minimal width
//! value     = u8 tag, then by tag:
//!   0x06 string   number(length) UTF-8 bytes
//!   0x07 bytes    number(length) bytes
//!   0x11 bool     number, always 1 byte (01 00 / 01 01); CSP reads 0 bytes as true
//!   0x13 int      number (4 bytes when negative: two's complement)
//!   0x14 uint     number
//!   0x15 real     number(8 bytes) = f64 big endian
//!   0x48 array    u32 length, fields(head), count, (tag value) × count
//!   0x49 object   u32 length, object
//! ```
//!
//! A file is one object without tag and length. Bytes after it are kept
//! ([`Document::trailing`]); CSP ignores them (one file shipped with CSP
//! has 21 such bytes). Parsing then serialising gives the original bytes
//! (checked on every sample, `docs/assets/validation/W1-samples.md`).

use serde_json::{Map, Value as Json, json};

use crate::error::{Error, Result};

/// Tag of a string.
pub const TAG_STRING: u8 = 0x06;
/// Tag of a byte string.
pub const TAG_BYTES: u8 = 0x07;
/// Tag of a bool.
pub const TAG_BOOL: u8 = 0x11;
/// Tag of a signed number.
pub const TAG_INT: u8 = 0x13;
/// Tag of an unsigned number.
pub const TAG_UINT: u8 = 0x14;
/// Tag of an `f64`.
pub const TAG_REAL: u8 = 0x15;
/// Tag of an array.
pub const TAG_ARRAY: u8 = 0x48;
/// Tag of an object.
pub const TAG_OBJECT: u8 = 0x49;

/// Named values in file order.
pub type Fields = Vec<(String, Value)>;

/// One value of the tree.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// A string (0x06).
    String(String),
    /// Bytes (0x07).
    Bytes(Vec<u8>),
    /// 0x11, 0x13 or 0x14 with the stored big-endian bytes (kept so that
    /// unusual widths survive a round trip).
    Number {
        /// 0x11, 0x13 or 0x14.
        tag: u8,
        /// The big-endian bytes as stored.
        raw: Vec<u8>,
    },
    /// An `f64` (0x15).
    Real(f64),
    /// An array (0x48).
    Array {
        /// Fields before the items.
        head: Fields,
        /// The items.
        items: Vec<Value>,
    },
    /// An object (0x49).
    Object(Object),
}

/// An object: a head (its type name) and its members.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Object {
    /// The first field group: `typename` (the class name, often empty).
    pub head: Fields,
    /// The members.
    pub body: Fields,
}

/// A whole file.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Document {
    /// The root object.
    pub root: Object,
    /// Bytes after the root object.
    pub trailing: Vec<u8>,
}

/// Whether `data` starts like a serialised object (`01 01 01 08 typename`).
pub fn looks_like(data: &[u8]) -> bool {
    data.starts_with(b"\x01\x01\x01\x08typename")
}

impl Value {
    /// A bool as CSP writes it.
    pub fn bool(value: bool) -> Value {
        Value::Number { tag: TAG_BOOL, raw: vec![value as u8] }
    }

    /// A signed number in the width CSP uses.
    pub fn int(value: i64) -> Value {
        let raw = if value < 0 { (value as i32).to_be_bytes().to_vec() } else { minimal(value as u64) };
        Value::Number { tag: TAG_INT, raw }
    }

    /// An unsigned number in the minimal width.
    pub fn uint(value: u64) -> Value {
        Value::Number { tag: TAG_UINT, raw: minimal(value) }
    }

    /// Numbers as i64: 4-byte ints are signed, everything else unsigned.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Number { tag, raw } => {
                let unsigned = raw.iter().fold(0u64, |acc, &b| (acc << 8) | b as u64);
                Some(if *tag == TAG_INT && raw.len() == 4 { unsigned as u32 as i32 as i64 } else { unsigned as i64 })
            }
            Value::Real(value) => Some(*value as i64),
            _ => None,
        }
    }

    /// Numbers and reals as `f64`.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Real(value) => Some(*value),
            Value::Number { .. } => self.as_i64().map(|v| v as f64),
            _ => None,
        }
    }

    /// The text of a string.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(text) => Some(text),
            _ => None,
        }
    }

    /// The bytes of a byte string.
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Value::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }

    /// The object of an object value.
    pub fn as_object(&self) -> Option<&Object> {
        match self {
            Value::Object(object) => Some(object),
            _ => None,
        }
    }

    /// The items of an array.
    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array { items, .. } => Some(items),
            _ => None,
        }
    }

    /// The tag the value is written with.
    pub fn tag(&self) -> u8 {
        match self {
            Value::String(_) => TAG_STRING,
            Value::Bytes(_) => TAG_BYTES,
            Value::Number { tag, .. } => *tag,
            Value::Real(_) => TAG_REAL,
            Value::Array { .. } => TAG_ARRAY,
            Value::Object(_) => TAG_OBJECT,
        }
    }
}

impl Object {
    /// An object with this type name and members.
    pub fn new(typename: &str, body: Fields) -> Object {
        Object { head: vec![("typename".into(), Value::String(typename.into()))], body }
    }

    /// The `typename` of the head (empty when missing).
    pub fn typename(&self) -> &str {
        self.head.iter().find(|(k, _)| k == "typename").and_then(|(_, v)| v.as_str()).unwrap_or("")
    }

    /// The member with this key.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.body.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// The member with this key, mutably.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Value> {
        self.body.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// Replace a member, or append it when missing.
    pub fn set(&mut self, key: &str, value: Value) {
        match self.get_mut(key) {
            Some(slot) => *slot = value,
            None => self.body.push((key.into(), value)),
        }
    }

    /// A string member.
    pub fn str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }

    /// A number member as `i64`.
    pub fn i64(&self, key: &str) -> Option<i64> {
        self.get(key).and_then(Value::as_i64)
    }

    /// A number member as `f64`.
    pub fn f64(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(Value::as_f64)
    }

    /// An object member.
    pub fn object(&self, key: &str) -> Option<&Object> {
        self.get(key).and_then(Value::as_object)
    }

    /// The items of an array member.
    pub fn array(&self, key: &str) -> Option<&[Value]> {
        self.get(key).and_then(Value::as_array)
    }
}

fn minimal(value: u64) -> Vec<u8> {
    let bytes = value.to_be_bytes();
    let skip = bytes.iter().take_while(|&&b| b == 0).count();
    bytes[skip..].to_vec()
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.at.checked_add(n).filter(|&end| end <= self.data.len());
        let Some(end) = end else {
            return Err(Error::format(format!("serialisation: {n} bytes needed at {:#x}", self.at)));
        };
        let bytes = &self.data[self.at..end];
        self.at = end;
        Ok(bytes)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn raw_number(&mut self) -> Result<&'a [u8]> {
        let n = self.u8()? as usize;
        if n > 8 {
            return Err(Error::format(format!("serialisation: {n}-byte number at {:#x}", self.at - 1)));
        }
        self.take(n)
    }

    fn number(&mut self) -> Result<usize> {
        let raw = self.raw_number()?;
        Ok(raw.iter().fold(0usize, |acc, &b| (acc << 8) | b as usize))
    }

    fn text(&mut self) -> Result<String> {
        let n = self.number()?;
        let bytes = self.take(n)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| Error::format(format!("serialisation: text at {:#x}", self.at)))
    }

    fn fields(&mut self, depth: usize) -> Result<Fields> {
        let count = self.number()?;
        let mut fields = Vec::with_capacity(count.min(1024));
        for _ in 0..count {
            let key = self.text()?;
            let tag = self.u8()?;
            fields.push((key, self.value(tag, depth)?));
        }
        Ok(fields)
    }

    fn object(&mut self, depth: usize) -> Result<Object> {
        let head = self.fields(depth)?;
        let body = self.fields(depth)?;
        Ok(Object { head, body })
    }

    fn sized(&mut self) -> Result<usize> {
        let length = u32::from_be_bytes(self.take(4)?.try_into().unwrap()) as usize;
        let end = self.at + length;
        if end > self.data.len() {
            return Err(Error::format(format!(
                "serialisation: {length}-byte block at {:#x} runs past the end",
                self.at
            )));
        }
        Ok(end)
    }

    fn value(&mut self, tag: u8, depth: usize) -> Result<Value> {
        if depth > 64 {
            return Err(Error::format("serialisation: nested too deeply"));
        }
        Ok(match tag {
            TAG_STRING => Value::String(self.text()?),
            TAG_BYTES => {
                let n = self.number()?;
                Value::Bytes(self.take(n)?.to_vec())
            }
            TAG_BOOL | TAG_INT | TAG_UINT => Value::Number { tag, raw: self.raw_number()?.to_vec() },
            TAG_REAL => {
                let raw = self.raw_number()?;
                match raw.len() {
                    8 => Value::Real(f64::from_be_bytes(raw.try_into().unwrap())),
                    _ => return Err(Error::format(format!("serialisation: {}-byte real", raw.len()))),
                }
            }
            TAG_ARRAY => {
                let end = self.sized()?;
                let head = self.fields(depth + 1)?;
                let count = self.number()?;
                let mut items = Vec::with_capacity(count.min(1024));
                for _ in 0..count {
                    let tag = self.u8()?;
                    items.push(self.value(tag, depth + 1)?);
                }
                self.expect_end(end)?;
                Value::Array { head, items }
            }
            TAG_OBJECT => {
                let end = self.sized()?;
                let object = self.object(depth + 1)?;
                self.expect_end(end)?;
                Value::Object(object)
            }
            other => {
                return Err(Error::format(format!("serialisation: unknown tag {other:#04x} at {:#x}", self.at - 1)));
            }
        })
    }

    fn expect_end(&self, end: usize) -> Result<()> {
        if self.at != end {
            return Err(Error::format(format!("serialisation: block ends at {:#x}, content at {:#x}", end, self.at)));
        }
        Ok(())
    }
}

impl Document {
    /// Parses a file; bytes after the root object go into `trailing`.
    pub fn parse(data: &[u8]) -> Result<Document> {
        let mut reader = Reader { data, at: 0 };
        let root = reader.object(0)?;
        Ok(Document { root, trailing: data[reader.at..].to_vec() })
    }

    /// The file; an unchanged document gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        write_object(&mut out, &self.root);
        out.extend_from_slice(&self.trailing);
        out
    }

    /// The tree as JSON; [`Document::from_json`] reads it back unchanged.
    pub fn to_json(&self) -> Json {
        let mut json = object_json(&self.root);
        if !self.trailing.is_empty() {
            json.as_object_mut().unwrap().insert("@trailing".into(), Json::String(hex(&self.trailing)));
        }
        json
    }

    /// Reads the JSON of [`Document::to_json`].
    pub fn from_json(json: &Json) -> Result<Document> {
        let trailing = match json.get("@trailing") {
            Some(Json::String(text)) => unhex(text)?,
            _ => Vec::new(),
        };
        Ok(Document { root: object_from_json(json)?, trailing })
    }
}

fn write_number(out: &mut Vec<u8>, value: usize) {
    let raw = minimal(value as u64);
    out.push(raw.len() as u8);
    out.extend_from_slice(&raw);
}

fn write_text(out: &mut Vec<u8>, text: &str) {
    write_number(out, text.len());
    out.extend_from_slice(text.as_bytes());
}

fn write_fields(out: &mut Vec<u8>, fields: &Fields) {
    write_number(out, fields.len());
    for (key, value) in fields {
        write_text(out, key);
        out.push(value.tag());
        write_value(out, value);
    }
}

fn write_object(out: &mut Vec<u8>, object: &Object) {
    write_fields(out, &object.head);
    write_fields(out, &object.body);
}

fn write_sized(out: &mut Vec<u8>, body: impl FnOnce(&mut Vec<u8>)) {
    let at = out.len();
    out.extend_from_slice(&[0; 4]);
    body(out);
    let length = (out.len() - at - 4) as u32;
    out[at..at + 4].copy_from_slice(&length.to_be_bytes());
}

fn write_value(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::String(text) => write_text(out, text),
        Value::Bytes(bytes) => {
            write_number(out, bytes.len());
            out.extend_from_slice(bytes);
        }
        Value::Number { raw, .. } => {
            out.push(raw.len() as u8);
            out.extend_from_slice(raw);
        }
        Value::Real(value) => {
            out.push(8);
            out.extend_from_slice(&value.to_be_bytes());
        }
        Value::Array { head, items } => write_sized(out, |out| {
            write_fields(out, head);
            write_number(out, items.len());
            for item in items {
                out.push(item.tag());
                write_value(out, item);
            }
        }),
        Value::Object(object) => write_sized(out, |out| write_object(out, object)),
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn unhex(text: &str) -> Result<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return Err(Error::format("odd hex length"));
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(|_| Error::format("bad hex")))
        .collect()
}

// JSON form: objects are JSON objects whose "@head" holds the head fields
// (omitted when it is just an empty typename) and "@typename" the class
// name; strings are strings; other scalars are one-key objects
// ({"bool": true}, {"int": -1}, {"uint": 60}, {"real": 0.5}, {"hex": ".."});
// arrays are {"@array": [...]} with "@head" as for objects. A number
// stored with a non-minimal width keeps its bytes in "@raw".

fn fields_json(fields: &Fields) -> Map<String, Json> {
    fields.iter().map(|(k, v)| (k.clone(), value_json(v))).collect()
}

fn head_json(map: &mut Map<String, Json>, head: &Fields) {
    let simple = head.len() == 1 && head[0].0 == "typename" && matches!(head[0].1, Value::String(_));
    if simple {
        let name = head[0].1.as_str().unwrap();
        if !name.is_empty() {
            map.insert("@typename".into(), Json::String(name.into()));
        }
    } else {
        map.insert("@head".into(), Json::Object(fields_json(head)));
    }
}

fn object_json(object: &Object) -> Json {
    let mut map = Map::new();
    head_json(&mut map, &object.head);
    map.extend(fields_json(&object.body));
    Json::Object(map)
}

fn value_json(value: &Value) -> Json {
    match value {
        Value::String(text) => Json::String(text.clone()),
        Value::Bytes(bytes) => json!({ "hex": hex(bytes) }),
        Value::Number { tag, raw } => {
            let number = value.as_i64().unwrap_or(0);
            let mut map = Map::new();
            match *tag {
                TAG_BOOL => map.insert("bool".into(), json!(number != 0)),
                TAG_INT => map.insert("int".into(), json!(number)),
                TAG_UINT => map.insert("uint".into(), json!(number)),
                other => map.insert(format!("tag{other:02x}"), json!(number)),
            };
            let canonical = match *tag {
                TAG_INT => *value == Value::int(number),
                TAG_BOOL => *raw == [number as u8],
                _ => *raw == minimal(number as u64),
            };
            if !canonical || (*tag == TAG_BOOL && number > 1) {
                map.insert("@raw".into(), Json::String(hex(raw)));
            }
            Json::Object(map)
        }
        Value::Real(value) => json!({ "real": value }),
        Value::Array { head, items } => {
            let mut map = Map::new();
            head_json(&mut map, head);
            map.insert("@array".into(), Json::Array(items.iter().map(value_json).collect()));
            Json::Object(map)
        }
        Value::Object(object) => object_json(object),
    }
}

fn head_from_json(json: &Map<String, Json>) -> Result<Fields> {
    if let Some(Json::Object(head)) = json.get("@head") {
        return fields_from_json(head);
    }
    let name = json.get("@typename").and_then(Json::as_str).unwrap_or("");
    Ok(vec![("typename".into(), Value::String(name.into()))])
}

fn fields_from_json(map: &Map<String, Json>) -> Result<Fields> {
    map.iter().filter(|(k, _)| !k.starts_with('@')).map(|(k, v)| Ok((k.clone(), value_from_json(v)?))).collect()
}

fn object_from_json(json: &Json) -> Result<Object> {
    let Json::Object(map) = json else {
        return Err(Error::format("serialisation JSON: expected an object"));
    };
    Ok(Object { head: head_from_json(map)?, body: fields_from_json(map)? })
}

fn value_from_json(json: &Json) -> Result<Value> {
    let bad = || Error::format(format!("serialisation JSON: cannot read {json}"));
    match json {
        Json::String(text) => Ok(Value::String(text.clone())),
        Json::Object(map) => {
            if let Some(Json::Array(items)) = map.get("@array") {
                let head = head_from_json(map)?;
                let items = items.iter().map(value_from_json).collect::<Result<_>>()?;
                return Ok(Value::Array { head, items });
            }
            let raw = match map.get("@raw") {
                Some(Json::String(text)) => Some(unhex(text)?),
                _ => None,
            };
            let number = |tag: u8, value: Value| -> Value {
                match &raw {
                    Some(raw) => Value::Number { tag, raw: raw.clone() },
                    None => value,
                }
            };
            if let Some(value) = map.get("bool") {
                return Ok(number(TAG_BOOL, Value::bool(value.as_bool().ok_or_else(bad)?)));
            }
            if let Some(value) = map.get("int") {
                return Ok(number(TAG_INT, Value::int(value.as_i64().ok_or_else(bad)?)));
            }
            if let Some(value) = map.get("uint") {
                return Ok(number(TAG_UINT, Value::uint(value.as_u64().ok_or_else(bad)?)));
            }
            if let Some(value) = map.get("real") {
                return Ok(Value::Real(value.as_f64().ok_or_else(bad)?));
            }
            if let Some(Json::String(text)) = map.get("hex") {
                return Ok(Value::Bytes(unhex(text)?));
            }
            if let Some((key, value)) = map.iter().find(|(k, _)| k.starts_with("tag")) {
                let tag = u8::from_str_radix(&key[3..], 16).map_err(|_| bad())?;
                let value = value.as_u64().ok_or_else(bad)?;
                return Ok(number(tag, Value::Number { tag, raw: minimal(value) }));
            }
            Ok(Value::Object(object_from_json(json)?))
        }
        _ => Err(bad()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Document {
        let item = Object::new(
            "typeActionItem",
            vec![
                ("actionItemEnable".into(), Value::bool(true)),
                ("actionItemKind".into(), Value::String("layeractionrasterdetailnew".into())),
                ("value".into(), Value::Real(20.0)),
                ("offset".into(), Value::int(-10)),
                ("color".into(), Value::uint(0x6161_6162)),
                ("data".into(), Value::Bytes(vec![0, 1, 2])),
            ],
        );
        let array = Value::Array { head: Object::new("", vec![]).head, items: vec![Value::Object(item)] };
        Document { root: Object::new("typeActionSet", vec![("actionArray".into(), array)]), trailing: vec![] }
    }

    #[test]
    fn round_trips_bytes_and_json() {
        let document = sample();
        let bytes = document.to_bytes();
        assert!(looks_like(&bytes));
        let parsed = Document::parse(&bytes).unwrap();
        assert_eq!(parsed, document);
        assert_eq!(parsed.to_bytes(), bytes);
        let json = parsed.to_json();
        assert_eq!(Document::from_json(&json).unwrap().to_bytes(), bytes);
    }

    #[test]
    fn negative_ints_take_four_bytes() {
        assert_eq!(Value::int(-1), Value::Number { tag: TAG_INT, raw: vec![0xff; 4] });
        assert_eq!(Value::int(-100).as_i64(), Some(-100));
        assert_eq!(Value::Number { tag: TAG_INT, raw: vec![0xff, 0xff] }.as_i64(), Some(65535));
        assert_eq!(Value::int(0), Value::Number { tag: TAG_INT, raw: vec![] });
    }

    #[test]
    fn bools_take_one_byte() {
        // CSP writes 01 00 for false and reads a 0-byte bool as true (W3).
        assert_eq!(Value::bool(false), Value::Number { tag: TAG_BOOL, raw: vec![0] });
        assert_eq!(Value::bool(true), Value::Number { tag: TAG_BOOL, raw: vec![1] });
        assert_eq!(value_json(&Value::bool(false)), json!({ "bool": false }));
        let short = Value::Number { tag: TAG_BOOL, raw: vec![] };
        assert_eq!(value_json(&short), json!({ "bool": false, "@raw": "" }));
    }

    #[test]
    fn keeps_trailing_bytes() {
        let mut bytes = sample().to_bytes();
        bytes.extend_from_slice(&[0, 0, 0x3f]);
        let parsed = Document::parse(&bytes).unwrap();
        assert_eq!(parsed.trailing, vec![0, 0, 0x3f]);
        assert_eq!(parsed.to_bytes(), bytes);
    }

    #[test]
    fn rejects_truncated_blocks() {
        let bytes = sample().to_bytes();
        assert!(Document::parse(&bytes[..bytes.len() - 3]).is_err());
    }
}
