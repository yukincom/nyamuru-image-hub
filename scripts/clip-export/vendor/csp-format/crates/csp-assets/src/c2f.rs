//! The chunk envelope of CSP's material data (`data/material_0.layer`,
//! `.tool`, `.pose` …) and of `catalog.zip` / `info.zip` in material
//! folders.
//!
//! PNG-like: the signature `89 "C2F" 0D 0A 1A 0A`, then chunks of
//! `u32 length (little endian), 4-byte type, data, u32 CRC-32 of type and
//! data (little endian)`. Every file seen has `HEAD` (empty), one or more
//! `dATA` and `TAIL` (empty). Each `dATA` starts with a `u16` (1 in the
//! first chunk, 0 after it).
//!
//! The data is encrypted by CELSYS (the material's `catalog.xml` marks
//! these files `encrypt="true"`). This crate does not decrypt it: it reads
//! the envelope, checks the CRCs and keeps the payload as opaque bytes
//! (`docs/assets/requirements.md`, C5).

use crate::error::{Error, Result};

/// The first 8 bytes of a C2F file.
pub const SIGNATURE: &[u8; 8] = b"\x89C2F\r\n\x1a\n";

/// One chunk of the envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// Chunk type (`HEAD`, `dATA`, `TAIL`).
    pub kind: [u8; 4],
    /// Chunk data (encrypted for `dATA`).
    pub data: Vec<u8>,
    /// The stored CRC matches the type and data.
    pub crc_ok: bool,
}

impl Chunk {
    /// The type as text.
    pub fn kind_name(&self) -> String {
        String::from_utf8_lossy(&self.kind).into_owned()
    }
}

/// Whether the bytes start with [`SIGNATURE`].
pub fn looks_like(data: &[u8]) -> bool {
    data.starts_with(SIGNATURE)
}

/// The chunks of a C2F file.
pub fn parse(data: &[u8]) -> Result<Vec<Chunk>> {
    if !looks_like(data) {
        return Err(Error::format("not a C2F file"));
    }
    let mut at = SIGNATURE.len();
    let mut chunks = Vec::new();
    while at < data.len() {
        let header = data.get(at..at + 8).ok_or_else(|| Error::format(format!("C2F: chunk header cut at {at:#x}")))?;
        let length = u32::from_le_bytes(header[0..4].try_into().unwrap()) as usize;
        let kind: [u8; 4] = header[4..8].try_into().unwrap();
        let end = at + 8 + length;
        let crc =
            data.get(end..end + 4).ok_or_else(|| Error::format(format!("C2F: chunk at {at:#x} runs past the end")))?;
        let stored = u32::from_le_bytes(crc.try_into().unwrap());
        let body = &data[at + 8..end];
        chunks.push(Chunk { kind, data: body.to_vec(), crc_ok: stored == crc32(&kind, body) });
        at = end + 4;
    }
    Ok(chunks)
}

/// A C2F file of these chunks, with fresh CRCs.
pub fn write(chunks: &[Chunk]) -> Vec<u8> {
    let mut out = SIGNATURE.to_vec();
    for chunk in chunks {
        out.extend_from_slice(&(chunk.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&chunk.kind);
        out.extend_from_slice(&chunk.data);
        out.extend_from_slice(&crc32(&chunk.kind, &chunk.data).to_le_bytes());
    }
    out
}

/// CRC-32 (IEEE, as zlib) of `kind` followed by `data`.
pub fn crc32(kind: &[u8], data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in kind.iter().chain(data) {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// What an envelope holds, for reports.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Summary {
    /// Chunk types, in order.
    pub chunks: Vec<String>,
    /// Bytes of all `dATA` chunks.
    pub payload_bytes: usize,
    /// Every CRC matches.
    pub crc_ok: bool,
    /// Always true for material data: the payload is encrypted.
    pub encrypted: bool,
}

/// The envelope summary of a C2F file.
pub fn summarize(data: &[u8]) -> Result<Summary> {
    let chunks = parse(data)?;
    Ok(Summary {
        chunks: chunks.iter().map(Chunk::kind_name).collect(),
        payload_bytes: chunks.iter().filter(|c| &c.kind == b"dATA").map(|c| c.data.len()).sum(),
        crc_ok: chunks.iter().all(|c| c.crc_ok),
        encrypted: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_crc_matches_csp() {
        // CSP's empty HEAD chunk stores 28 1b 66 91.
        assert_eq!(crc32(b"HEAD", &[]).to_le_bytes(), [0x28, 0x1b, 0x66, 0x91]);
    }

    #[test]
    fn round_trips() {
        let chunks = vec![
            Chunk { kind: *b"HEAD", data: vec![], crc_ok: true },
            Chunk { kind: *b"dATA", data: vec![1, 0, 9, 9, 9], crc_ok: true },
            Chunk { kind: *b"TAIL", data: vec![], crc_ok: true },
        ];
        let bytes = write(&chunks);
        assert_eq!(parse(&bytes).unwrap(), chunks);
        let summary = summarize(&bytes).unwrap();
        assert_eq!(summary.chunks, ["HEAD", "dATA", "TAIL"]);
        assert_eq!(summary.payload_bytes, 5);
        let mut broken = bytes.clone();
        broken[30] ^= 1;
        assert!(!parse(&broken).unwrap()[1].crc_ok);
        assert!(parse(&bytes[..bytes.len() - 2]).is_err());
    }
}
