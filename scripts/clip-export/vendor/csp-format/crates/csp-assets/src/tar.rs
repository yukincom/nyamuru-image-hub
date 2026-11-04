//! The tar archives CSP stores in `.sut` files (`MaterialFile.FileData`:
//! a material folder) and in material folders (`description.tar`).
//!
//! Plain ustar: 512-byte headers (name, octal size), data padded to 512
//! bytes, two zero blocks at the end. Only regular files are read.

use crate::error::{Error, Result};

/// One regular file of an archive.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// Path inside the archive.
    pub name: String,
    /// File contents.
    pub data: Vec<u8>,
}

fn octal(field: &[u8]) -> Result<usize> {
    let text: String = field.iter().take_while(|&&b| b != 0).map(|&b| b as char).collect();
    let text = text.trim();
    if text.is_empty() {
        return Ok(0);
    }
    usize::from_str_radix(text, 8).map_err(|_| Error::format(format!("tar: bad number {text:?}")))
}

fn text(field: &[u8]) -> String {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

/// The regular files of a ustar archive.
pub fn read(data: &[u8]) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    let mut at = 0;
    while at + 512 <= data.len() {
        let header = &data[at..at + 512];
        if header.iter().all(|&b| b == 0) {
            break;
        }
        let mut name = text(&header[0..100]);
        let prefix = text(&header[345..500]);
        if header[257..262] == *b"ustar" && !prefix.is_empty() {
            name = format!("{prefix}/{name}");
        }
        let size = octal(&header[124..136])?;
        let kind = header[156];
        let start = at + 512;
        let end = start.checked_add(size).filter(|&end| end <= data.len());
        let Some(end) = end else {
            return Err(Error::format(format!("tar: {name} runs past the end")));
        };
        if kind == b'0' || kind == 0 {
            entries.push(Entry { name, data: data[start..end].to_vec() });
        }
        at = start + size.div_ceil(512) * 512;
    }
    Ok(entries)
}

/// The modification time of the first entry (CSP stamps every entry of
/// a `.sut` material with the same time).
pub fn mtime(data: &[u8]) -> Option<u64> {
    data.get(136..148).and_then(|field| octal(field).ok()).map(|t| t as u64)
}

/// A ustar archive of `entries` in CSP's layout (mode 0777, owner
/// `compress`, checksum as 7 digits and NUL), time 0.
pub fn write(entries: &[Entry]) -> Result<Vec<u8>> {
    write_at(entries, 0)
}

/// [`write()`] with every entry stamped `mtime` (seconds since 1970).
pub fn write_at(entries: &[Entry], mtime: u64) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    for entry in entries {
        if entry.name.len() > 99 {
            return Err(Error::format(format!("tar: name too long: {}", entry.name)));
        }
        let mut header = [0u8; 512];
        header[..entry.name.len()].copy_from_slice(entry.name.as_bytes());
        header[100..108].copy_from_slice(b"0000777\0");
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");
        header[124..136].copy_from_slice(format!("{:011o}\0", entry.data.len()).as_bytes());
        header[136..148].copy_from_slice(format!("{mtime:011o}\0").as_bytes());
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        header[265..273].copy_from_slice(b"compress");
        header[148..156].copy_from_slice(b"        ");
        let sum: u32 = header.iter().map(|&b| b as u32).sum();
        header[148..156].copy_from_slice(format!("{sum:07o}\0").as_bytes());
        out.extend_from_slice(&header);
        out.extend_from_slice(&entry.data);
        out.resize(out.len().div_ceil(512) * 512, 0);
    }
    out.resize(out.len() + 1024, 0);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let entries = vec![
            Entry { name: "catalog.zip".into(), data: vec![1; 700] },
            Entry { name: "thumbnail/thumbnail.png".into(), data: vec![2; 3] },
        ];
        let bytes = write(&entries).unwrap();
        assert_eq!(bytes.len() % 512, 0);
        assert_eq!(read(&bytes).unwrap(), entries);
        assert!(read(&bytes[..600]).is_err());
    }
}
