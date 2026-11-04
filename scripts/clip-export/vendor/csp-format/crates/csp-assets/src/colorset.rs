//! Colour sets exported by CSP (`.cls`, カラーセット素材の書き出し).
//!
//! Little endian:
//!
//! ```text
//! "SLCC"  u16 version (0x0100)
//! u32 n   name block of n bytes:
//!           u16 length, set name in Shift_JIS (CP932)
//!           u32 0
//!           u16 length, set name in UTF-8
//! u32 4   (colour format; 4 = 8-bit RGBA in every sample)
//! u32 count
//! u32 bytes of the colour list
//! colour × count:
//!   u32 n (bytes that follow: 8, or more with a name)
//!   u8 R, G, B, A        A = 0: the transparent colour (透明色)
//!   u32 flag (0 no name, 1 named)
//!   flag 1: u16 length, name in UTF-16LE
//! ```
//!
//! Unexplained values (the word after the Shift_JIS name, the format word)
//! are kept and written back, so parsing then writing gives the original
//! bytes.

use crate::error::{Error, Result};

/// One colour of a set.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Color {
    /// 8-bit straight RGBA (alpha 0 is the transparent entry).
    pub rgba: [u8; 4],
    /// Colour name, when it has one.
    pub name: Option<String>,
    /// The flag word as stored (0 or 1 so far).
    #[serde(skip)]
    flag: u32,
    /// Bytes after the colour and name that this reader does not know.
    #[serde(skip)]
    extra: Vec<u8>,
}

impl Color {
    /// A colour, flagged as named when it has a name.
    pub fn new(rgba: [u8; 4], name: Option<&str>) -> Color {
        Color { rgba, name: name.map(str::to_owned), flag: name.is_some() as u32, extra: Vec::new() }
    }

    /// The transparent colour entry (alpha 0).
    pub fn is_transparent(&self) -> bool {
        self.rgba[3] == 0
    }
}

/// A `.cls` colour set.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ColorSet {
    /// Set name (UTF-8 copy).
    pub name: String,
    /// The Shift_JIS copy of the name, as stored (CSP writes it from the
    /// name; kept so that files round-trip even when it differs).
    #[serde(skip)]
    sjis_name: Vec<u8>,
    #[serde(skip)]
    after_sjis: u32,
    /// Format version (0x0100).
    pub version: u16,
    /// Format word as stored (4).
    pub format: u32,
    /// The colours, in palette order.
    pub colors: Vec<Color>,
}

/// Whether the bytes start with the `SLCC` signature.
pub fn looks_like(data: &[u8]) -> bool {
    data.starts_with(b"SLCC")
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.at.checked_add(n).filter(|&end| end <= self.data.len());
        let Some(end) = end else {
            return Err(Error::format(format!("colour set: {n} bytes needed at {:#x}", self.at)));
        };
        let bytes = &self.data[self.at..end];
        self.at = end;
        Ok(bytes)
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
}

impl ColorSet {
    /// A new set; the Shift_JIS name is made from `name`.
    pub fn new(name: &str, colors: Vec<Color>) -> ColorSet {
        ColorSet { name: name.into(), sjis_name: encode_sjis(name), after_sjis: 0, version: 0x0100, format: 4, colors }
    }

    /// Parses a `.cls` file.
    pub fn parse(data: &[u8]) -> Result<ColorSet> {
        if !looks_like(data) {
            return Err(Error::format("not a colour set (no SLCC signature)"));
        }
        let mut r = Reader { data, at: 4 };
        let version = r.u16()?;
        let block = r.u32()? as usize;
        let block_end = r.at + block;
        let n = r.u16()? as usize;
        let sjis_name = r.take(n)?.to_vec();
        let after_sjis = r.u32()?;
        let n = r.u16()? as usize;
        let name =
            String::from_utf8(r.take(n)?.to_vec()).map_err(|_| Error::format("colour set: name is not UTF-8"))?;
        if r.at != block_end {
            return Err(Error::format(format!("colour set: name block ends at {:#x}, not {block_end:#x}", r.at)));
        }
        let format = r.u32()?;
        let count = r.u32()? as usize;
        let list = r.u32()? as usize;
        let list_end = r.at + list;
        if list_end != data.len() {
            return Err(Error::format(format!("colour set: list of {list} bytes, file has {}", data.len() - r.at)));
        }
        let mut colors = Vec::with_capacity(count.min(4096));
        for _ in 0..count {
            let size = r.u32()? as usize;
            let entry = r.take(size)?;
            if size < 8 {
                return Err(Error::format(format!("colour set: {size}-byte colour")));
            }
            let rgba = [entry[0], entry[1], entry[2], entry[3]];
            let flag = u32::from_le_bytes(entry[4..8].try_into().unwrap());
            let mut at = 8;
            let mut name = None;
            if flag == 1 && entry.len() >= 10 {
                let n = u16::from_le_bytes(entry[8..10].try_into().unwrap()) as usize;
                if let Some(units) = entry.get(10..10 + n) {
                    let units: Vec<u16> = units.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
                    name = Some(String::from_utf16_lossy(&units));
                    at = 10 + n;
                }
            }
            colors.push(Color { rgba, name, flag, extra: entry[at..].to_vec() });
        }
        if r.at != list_end {
            return Err(Error::format("colour set: colour list length does not match"));
        }
        Ok(ColorSet { name, sjis_name, after_sjis, version, format, colors })
    }

    /// The file; an unchanged set gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = b"SLCC".to_vec();
        out.extend_from_slice(&self.version.to_le_bytes());
        let mut block = Vec::new();
        block.extend_from_slice(&(self.sjis_name.len() as u16).to_le_bytes());
        block.extend_from_slice(&self.sjis_name);
        block.extend_from_slice(&self.after_sjis.to_le_bytes());
        block.extend_from_slice(&(self.name.len() as u16).to_le_bytes());
        block.extend_from_slice(self.name.as_bytes());
        out.extend_from_slice(&(block.len() as u32).to_le_bytes());
        out.extend_from_slice(&block);
        let mut list = Vec::new();
        for color in &self.colors {
            let mut entry = color.rgba.to_vec();
            match &color.name {
                Some(name) => {
                    let units: Vec<u8> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
                    entry.extend_from_slice(&1u32.max(color.flag).to_le_bytes());
                    entry.extend_from_slice(&(units.len() as u16).to_le_bytes());
                    entry.extend_from_slice(&units);
                }
                None => entry.extend_from_slice(&color.flag.to_le_bytes()),
            }
            entry.extend_from_slice(&color.extra);
            list.extend_from_slice(&(entry.len() as u32).to_le_bytes());
            list.extend_from_slice(&entry);
        }
        out.extend_from_slice(&self.format.to_le_bytes());
        out.extend_from_slice(&(self.colors.len() as u32).to_le_bytes());
        out.extend_from_slice(&(list.len() as u32).to_le_bytes());
        out.extend_from_slice(&list);
        out
    }

    /// Rename the set (both stored copies of the name).
    pub fn rename(&mut self, name: &str) {
        self.name = name.into();
        self.sjis_name = encode_sjis(name);
    }
}

/// The name in Shift_JIS (Windows code page 932).
fn encode_sjis(name: &str) -> Vec<u8> {
    encoding_rs::SHIFT_JIS.encode(name).0.into_owned()
}

impl ColorSet {
    /// The Shift_JIS copy of the name, decoded.
    pub fn sjis_name(&self) -> String {
        encoding_rs::SHIFT_JIS.decode(&self.sjis_name).0.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_made_set() {
        let set = ColorSet::new(
            "Test",
            vec![
                Color::new([0, 0, 0, 255], Some("黒")),
                Color::new([255, 50, 100, 255], None),
                Color::new([0, 0, 0, 0], None),
            ],
        );
        let bytes = set.to_bytes();
        let parsed = ColorSet::parse(&bytes).unwrap();
        assert_eq!(parsed, set);
        assert_eq!(parsed.to_bytes(), bytes);
        assert!(parsed.colors[2].is_transparent());
        assert_eq!(parsed.colors[0].name.as_deref(), Some("黒"));
    }

    #[test]
    fn reads_the_layout_csp_writes() {
        // Name block "AB": u16 2 "AB" u32 0 u16 2 "AB"; one named colour.
        let mut data = b"SLCC\x00\x01".to_vec();
        data.extend_from_slice(&12u32.to_le_bytes());
        data.extend_from_slice(b"\x02\x00AB\x00\x00\x00\x00\x02\x00AB");
        data.extend_from_slice(&4u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&16u32.to_le_bytes());
        data.extend_from_slice(&12u32.to_le_bytes());
        data.extend_from_slice(&[0, 0, 0, 0xff, 1, 0, 0, 0, 2, 0, 0xd2, 0x9e]);
        let set = ColorSet::parse(&data).unwrap();
        assert_eq!(set.name, "AB");
        assert_eq!(set.version, 0x0100);
        assert_eq!(set.colors[0].name.as_deref(), Some("黒"));
        assert_eq!(set.to_bytes(), data);
    }
}
