//! Bounds-checked reading and writing of the binary blobs inside CSP files.
//!
//! CSP mixes byte orders: the chunk container, offscreen attributes, block
//! data and vector data are big endian; text attributes (TLV) and the zlib
//! length inside a block are little endian.

use crate::error::{Error, Result, bail};

/// A position in a byte slice; every read checks the bounds.
#[derive(Debug, Clone)]
pub struct Reader<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Reader { data, position: 0 }
    }

    pub fn at(data: &'a [u8], position: usize) -> Self {
        Reader { data, position }
    }

    pub fn position(&self) -> usize {
        self.position
    }

    pub fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.position)
    }

    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    pub fn data(&self) -> &'a [u8] {
        self.data
    }

    pub fn seek(&mut self, position: usize) -> Result<()> {
        if position > self.data.len() {
            bail!("Seek to {position} beyond the end ({})", self.data.len());
        }
        self.position = position;
        Ok(())
    }

    pub fn skip(&mut self, count: usize) -> Result<()> {
        self.bytes(count).map(|_| ())
    }

    pub fn bytes(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self.position.checked_add(count).filter(|end| *end <= self.data.len()).ok_or_else(|| {
            Error::format(format!(
                "Unexpected end of data: {count} bytes wanted at {}, {} available",
                self.position,
                self.remaining()
            ))
        })?;
        let slice = &self.data[self.position..end];
        self.position = end;
        Ok(slice)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        Ok(self.bytes(N)?.try_into().expect("length checked"))
    }

    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.array::<1>()?[0])
    }

    pub fn be_u16(&mut self) -> Result<u16> {
        Ok(u16::from_be_bytes(self.array()?))
    }

    pub fn be_u32(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(self.array()?))
    }

    pub fn be_i32(&mut self) -> Result<i32> {
        Ok(i32::from_be_bytes(self.array()?))
    }

    pub fn be_u64(&mut self) -> Result<u64> {
        Ok(u64::from_be_bytes(self.array()?))
    }

    pub fn be_f32(&mut self) -> Result<f32> {
        Ok(f32::from_be_bytes(self.array()?))
    }

    pub fn be_f64(&mut self) -> Result<f64> {
        Ok(f64::from_be_bytes(self.array()?))
    }

    pub fn le_u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.array()?))
    }

    pub fn le_u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    pub fn le_i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.array()?))
    }

    pub fn le_f32(&mut self) -> Result<f32> {
        Ok(f32::from_le_bytes(self.array()?))
    }

    pub fn le_f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.array()?))
    }

    /// A `u32` (big endian) count of UTF-16BE code units, then the units.
    pub fn utf16_name(&mut self) -> Result<String> {
        let length = self.be_u32()? as usize;
        let bytes = self.bytes(length.checked_mul(2).ok_or_else(|| Error::format("String too long"))?)?;
        let units: Vec<u16> =
            bytes.as_chunks::<2>().0.iter().map(|pair| u16::from_be_bytes([pair[0], pair[1]])).collect();
        Ok(String::from_utf16_lossy(&units))
    }

    /// Peek at a UTF-16 name without moving; None when it does not fit.
    pub fn peek_utf16_name(&self) -> Option<String> {
        self.clone().utf16_name().ok()
    }
}

/// Append-only writer, the inverse of [`Reader`].
#[derive(Debug, Clone, Default)]
pub struct Writer {
    pub data: Vec<u8>,
}

impl Writer {
    pub fn new() -> Self {
        Writer::default()
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn bytes(&mut self, bytes: &[u8]) -> &mut Self {
        self.data.extend_from_slice(bytes);
        self
    }

    pub fn u8(&mut self, value: u8) -> &mut Self {
        self.data.push(value);
        self
    }

    pub fn be_u16(&mut self, value: u16) -> &mut Self {
        self.bytes(&value.to_be_bytes())
    }

    pub fn be_u32(&mut self, value: u32) -> &mut Self {
        self.bytes(&value.to_be_bytes())
    }

    pub fn be_i32(&mut self, value: i32) -> &mut Self {
        self.bytes(&value.to_be_bytes())
    }

    pub fn be_u64(&mut self, value: u64) -> &mut Self {
        self.bytes(&value.to_be_bytes())
    }

    pub fn be_f32(&mut self, value: f32) -> &mut Self {
        self.bytes(&value.to_be_bytes())
    }

    pub fn be_f64(&mut self, value: f64) -> &mut Self {
        self.bytes(&value.to_be_bytes())
    }

    pub fn le_u16(&mut self, value: u16) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn le_u32(&mut self, value: u32) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn le_i32(&mut self, value: i32) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn le_f32(&mut self, value: f32) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn le_f64(&mut self, value: f64) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    pub fn utf16_name(&mut self, text: &str) -> &mut Self {
        let units: Vec<u16> = text.encode_utf16().collect();
        self.be_u32(units.len() as u32);
        for unit in units {
            self.be_u16(unit);
        }
        self
    }

    pub fn into_inner(self) -> Vec<u8> {
        self.data
    }
}

/// Adler-32 as used by zlib and by CSP's block checksums.
/// The big-endian `u32` at `offset`, 0 past the end.
pub fn be_u32_at(data: &[u8], offset: usize) -> u32 {
    data.get(offset..offset + 4).map(|b| u32::from_be_bytes(b.try_into().expect("4"))).unwrap_or(0)
}

/// The big-endian `f64` at `offset`, 0 past the end.
pub fn be_f64_at(data: &[u8], offset: usize) -> f64 {
    data.get(offset..offset + 8).map(|b| f64::from_be_bytes(b.try_into().expect("8"))).unwrap_or(0.0)
}

pub fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for byte in chunk {
            a += *byte as u32;
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    (b << 16) | a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        let mut writer = Writer::new();
        writer.utf16_name("Parameter").be_u32(7);
        let data = writer.into_inner();
        let mut reader = Reader::new(&data);
        assert_eq!(reader.utf16_name().unwrap(), "Parameter");
        assert_eq!(reader.be_u32().unwrap(), 7);
        assert!(reader.is_empty());
        assert!(reader.u8().is_err());
    }

    #[test]
    fn adler32_matches_zlib() {
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
        assert_eq!(adler32(b""), 1);
    }
}
