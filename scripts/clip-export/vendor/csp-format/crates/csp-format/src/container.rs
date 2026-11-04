//! The CSF chunk container ("CSFCHUNK") that wraps every .clip file.
//!
//! All numbers are big endian (spec: `docs/spec/01-container.md`):
//!
//! ```text
//! file header (24 bytes): "CSFCHUNK"  u64 file size  u64 offset of the first chunk (24)
//! chunk:                  8-byte tag  u64 body length  body
//!   CHNKHead  body 40 bytes: u64 256, u64 offset of the CHNKSQLi chunk header,
//!             u64 16, 16-byte file id
//!   CHNKExta  body: u64 40, 40-byte external id ("extrnlid" + 32 hex digits), payload
//!   CHNKSQLi  body: SQLite 3 database image
//!   CHNKFoot  body: empty; the last chunk
//! ```
//!
//! CSP writes Head, every Exta, SQLi, Foot in this order. The table
//! `ExternalChunk` in the database maps each external id to the file offset
//! of its CHNKExta header. The parser keeps the original bytes, so a file
//! that is not changed is written back byte for byte.

use std::collections::HashMap;
use std::ops::Range;
use std::path::Path;

use crate::binary::{Reader, Writer};
use crate::error::{Error, Result, bail};

/// The first 8 bytes of a .clip.
pub const FILE_MAGIC: &[u8; 8] = b"CSFCHUNK";
/// Size of the file header.
pub const FILE_HEADER_SIZE: usize = 24;
/// Size of a chunk header (tag and body length).
pub const CHUNK_HEADER_SIZE: usize = 16;
/// Length of an external id.
pub const EXTERNAL_ID_LENGTH: usize = 40;
/// How every external id starts.
pub const EXTERNAL_ID_PREFIX: &str = "extrnlid";
/// Size of the CHNKHead body.
pub const HEAD_BODY_SIZE: usize = 40;
/// First value of the CHNKHead body.
pub const HEAD_VERSION: u64 = 256;
/// Length of the file id in CHNKHead.
pub const FILE_ID_LENGTH: usize = 16;

/// Tag of the head chunk.
pub const TAG_HEAD: &[u8; 8] = b"CHNKHead";
/// Tag of an external chunk.
pub const TAG_EXTERNAL: &[u8; 8] = b"CHNKExta";
/// Tag of the database chunk.
pub const TAG_SQLITE: &[u8; 8] = b"CHNKSQLi";
/// Tag of the last chunk.
pub const TAG_FOOTER: &[u8; 8] = b"CHNKFoot";

/// Kind of a chunk, from its 8-byte tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ChunkKind {
    /// `CHNKHead`.
    Head,
    /// `CHNKExta`.
    External,
    /// `CHNKSQLi`.
    Sqlite,
    /// `CHNKFoot`.
    Footer,
    /// Any other tag.
    Other([u8; 8]),
}

impl ChunkKind {
    /// The kind of a tag.
    pub fn from_tag(tag: &[u8; 8]) -> Self {
        match tag {
            TAG_HEAD => ChunkKind::Head,
            TAG_EXTERNAL => ChunkKind::External,
            TAG_SQLITE => ChunkKind::Sqlite,
            TAG_FOOTER => ChunkKind::Footer,
            other => ChunkKind::Other(*other),
        }
    }

    /// The 8-byte tag.
    pub fn tag(&self) -> [u8; 8] {
        match self {
            ChunkKind::Head => *TAG_HEAD,
            ChunkKind::External => *TAG_EXTERNAL,
            ChunkKind::Sqlite => *TAG_SQLITE,
            ChunkKind::Footer => *TAG_FOOTER,
            ChunkKind::Other(tag) => *tag,
        }
    }

    /// The tag as text.
    pub fn name(&self) -> String {
        String::from_utf8_lossy(&self.tag()).into_owned()
    }
}

/// One chunk: where its header and body are in the file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    /// Kind, from the tag.
    pub kind: ChunkKind,
    /// File offset of the chunk header.
    pub header_offset: usize,
    /// File range of the body.
    pub body: Range<usize>,
    /// For CHNKExta: the external id and where its payload starts.
    pub external_id: Option<String>,
    /// File offset where the payload starts (after the id, for CHNKExta).
    pub payload_offset: usize,
}

/// Contents of the CHNKHead chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    /// Always 256 in the corpus (format version, presumably).
    pub version: u64,
    /// File offset of the CHNKSQLi chunk header.
    pub sqlite_offset: u64,
    /// Length of the file id (always 16).
    pub file_id_length: u64,
    /// Random-looking id written when the file is created.
    pub file_id: Vec<u8>,
}

/// A parsed .clip container. Holds the original bytes.
#[derive(Debug, Clone)]
pub struct Container {
    data: Vec<u8>,
    /// File size the header declares.
    pub declared_size: u64,
    /// Offset of the first chunk the header declares (24).
    pub first_chunk: u64,
    /// The CHNKHead contents, if the file has one.
    pub head: Option<Head>,
    /// Every chunk, in file order.
    pub chunks: Vec<Chunk>,
    externals: HashMap<String, usize>,
    /// Bytes after the footer chunk (none in CSP files).
    pub trailing: usize,
}

impl Container {
    /// Reads and parses a file.
    pub fn read(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let data =
            std::fs::read(path).map_err(|error| Error::format(format!("Cannot read {}: {error}", path.display())))?;
        Self::parse(data)
    }

    /// Whether `data` starts like a .clip container.
    pub fn sniff(data: &[u8]) -> bool {
        data.starts_with(FILE_MAGIC)
    }

    /// Parses the bytes of a .clip; fails on a truncated or malformed container.
    pub fn parse(data: Vec<u8>) -> Result<Self> {
        if data.len() < FILE_HEADER_SIZE || !Self::sniff(&data) {
            bail!("Not a CLIP STUDIO file (no CSFCHUNK header)");
        }
        let mut reader = Reader::at(&data, 8);
        let declared_size = reader.be_u64()?;
        let first_chunk = reader.be_u64()?;
        let mut chunks = Vec::new();
        let mut externals = HashMap::new();
        let mut head = None;
        let mut position = usize::try_from(first_chunk).map_err(|_| Error::format("Bad first chunk offset"))?;
        let mut ended = false;
        while position < data.len() {
            if position + CHUNK_HEADER_SIZE > data.len() {
                bail!("Truncated chunk header at {position}");
            }
            let mut reader = Reader::at(&data, position);
            let tag: [u8; 8] = reader.bytes(8)?.try_into().expect("8 bytes");
            if !tag.starts_with(b"CHNK") {
                bail!("Unexpected chunk tag {:?} at {position}", String::from_utf8_lossy(&tag));
            }
            let length = usize::try_from(reader.be_u64()?).map_err(|_| Error::format("Chunk too long"))?;
            let body_start = position + CHUNK_HEADER_SIZE;
            let body_end = body_start
                .checked_add(length)
                .filter(|end| *end <= data.len())
                .ok_or_else(|| Error::format(format!("Chunk at {position} overruns the file")))?;
            let kind = ChunkKind::from_tag(&tag);
            let mut chunk = Chunk {
                kind,
                header_offset: position,
                body: body_start..body_end,
                external_id: None,
                payload_offset: body_start,
            };
            match kind {
                ChunkKind::Head => {
                    let mut body = Reader::new(&data[body_start..body_end]);
                    let version = body.be_u64()?;
                    let sqlite_offset = body.be_u64()?;
                    let file_id_length = body.be_u64()?;
                    let file_id = body.bytes(file_id_length.min(body.remaining() as u64) as usize)?.to_vec();
                    head = Some(Head { version, sqlite_offset, file_id_length, file_id });
                }
                ChunkKind::External => {
                    let mut body = Reader::new(&data[body_start..body_end]);
                    let id_length = body.be_u64()? as usize;
                    let id = body.bytes(id_length)?;
                    let id = String::from_utf8_lossy(id).into_owned();
                    chunk.payload_offset = body_start + 8 + id_length;
                    externals.insert(id.clone(), chunks.len());
                    chunk.external_id = Some(id);
                }
                _ => {}
            }
            chunks.push(chunk);
            position = body_end;
            if kind == ChunkKind::Footer {
                ended = true;
                break;
            }
        }
        if !ended {
            bail!("No CHNKFoot chunk: the file is truncated");
        }
        let trailing = data.len() - position;
        Ok(Container { data, declared_size, first_chunk, head, chunks, externals, trailing })
    }

    /// The bytes as read.
    pub fn bytes(&self) -> &[u8] {
        &self.data
    }

    /// The bytes as read, by value.
    pub fn into_bytes(self) -> Vec<u8> {
        self.data
    }

    /// The body of a chunk.
    pub fn body(&self, chunk: &Chunk) -> &[u8] {
        &self.data[chunk.body.clone()]
    }

    /// The embedded SQLite database image.
    pub fn sqlite(&self) -> Result<&[u8]> {
        self.chunks
            .iter()
            .find(|chunk| chunk.kind == ChunkKind::Sqlite)
            .map(|chunk| self.body(chunk))
            .ok_or_else(|| Error::format("No CHNKSQLi chunk"))
    }

    /// The database chunk.
    pub fn sqlite_chunk(&self) -> Option<&Chunk> {
        self.chunks.iter().find(|chunk| chunk.kind == ChunkKind::Sqlite)
    }

    /// External chunks in file order.
    pub fn external_chunks(&self) -> impl Iterator<Item = &Chunk> {
        self.chunks.iter().filter(|chunk| chunk.kind == ChunkKind::External)
    }

    /// The external chunk with this id.
    pub fn external_chunk(&self, id: &str) -> Option<&Chunk> {
        self.externals.get(id).map(|index| &self.chunks[*index])
    }

    /// Payload of an external chunk (after its id). None when the id is
    /// not stored: CSP keeps ids of offscreens it will build on opening.
    pub fn external(&self, id: &str) -> Option<&[u8]> {
        let chunk = self.external_chunk(id)?;
        Some(&self.data[chunk.payload_offset..chunk.body.end])
    }

    /// Ids of the external chunks, in file order.
    pub fn external_ids(&self) -> impl Iterator<Item = &str> {
        self.external_chunks().filter_map(|chunk| chunk.external_id.as_deref())
    }

    /// Structural problems that do not stop reading (empty when CSP-like).
    pub fn findings(&self) -> Vec<String> {
        let mut findings = Vec::new();
        if self.declared_size != self.data.len() as u64 {
            findings.push(format!(
                "declared size {} differs from the file size {}",
                self.declared_size,
                self.data.len()
            ));
        }
        if self.first_chunk != FILE_HEADER_SIZE as u64 {
            findings.push(format!("first chunk at {} (expected 24)", self.first_chunk));
        }
        if self.trailing != 0 {
            findings.push(format!("{} bytes after CHNKFoot", self.trailing));
        }
        match &self.head {
            None => findings.push("no CHNKHead chunk".into()),
            Some(head) => {
                if head.version != HEAD_VERSION {
                    findings.push(format!("CHNKHead version {}", head.version));
                }
                let sqlite = self.sqlite_chunk().map(|chunk| chunk.header_offset as u64);
                if sqlite != Some(head.sqlite_offset) {
                    findings.push(format!("CHNKHead points at {} but CHNKSQLi is at {sqlite:?}", head.sqlite_offset));
                }
            }
        }
        let order: Vec<ChunkKind> = self.chunks.iter().map(|chunk| chunk.kind).collect();
        let expected_order = order.first() == Some(&ChunkKind::Head)
            && order.last() == Some(&ChunkKind::Footer)
            && order.len() >= 3
            && order[order.len() - 2] == ChunkKind::Sqlite
            && order[1..order.len() - 2].iter().all(|kind| *kind == ChunkKind::External);
        if !expected_order {
            findings.push("chunks are not in the order Head, Exta*, SQLi, Foot".into());
        }
        for chunk in self.external_chunks() {
            let id = chunk.external_id.as_deref().unwrap_or("");
            if !is_external_id(id) {
                findings.push(format!("external id {id:?} is not \"extrnlid\" + 32 hex digits"));
            }
        }
        if self.externals.len() != self.external_chunks().count() {
            findings.push("duplicate external ids".into());
        }
        findings
    }

    /// Rebuild the file from its parsed parts (used to prove the parser
    /// misses nothing: the result must equal [`Container::bytes`]).
    pub fn reassemble(&self) -> Vec<u8> {
        let mut writer = Writer::new();
        writer.bytes(FILE_MAGIC).be_u64(self.declared_size).be_u64(self.first_chunk);
        writer.bytes(&self.data[FILE_HEADER_SIZE..self.first_chunk as usize]);
        for chunk in &self.chunks {
            writer.bytes(&chunk.kind.tag()).be_u64(chunk.body.len() as u64);
            match (&chunk.kind, &self.head) {
                (ChunkKind::Head, Some(head)) if chunk.body.len() == 24 + head.file_id.len() => {
                    writer
                        .be_u64(head.version)
                        .be_u64(head.sqlite_offset)
                        .be_u64(head.file_id_length)
                        .bytes(&head.file_id);
                }
                (ChunkKind::External, _) => {
                    let id = chunk.external_id.as_deref().unwrap_or("");
                    writer.be_u64(id.len() as u64).bytes(id.as_bytes());
                    writer.bytes(&self.data[chunk.payload_offset..chunk.body.end]);
                }
                _ => {
                    writer.bytes(self.body(chunk));
                }
            }
        }
        writer.bytes(&self.data[self.data.len() - self.trailing..]);
        writer.into_inner()
    }
}

/// Whether `id` looks like the ids CSP writes ("extrnlid" + 32 hex digits).
pub fn is_external_id(id: &str) -> bool {
    id.len() == EXTERNAL_ID_LENGTH
        && id.starts_with(EXTERNAL_ID_PREFIX)
        && id[EXTERNAL_ID_PREFIX.len()..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Builds a new container: Head, the external chunks in the given order,
/// SQLi, Foot, as CSP writes them.
#[derive(Debug, Clone)]
pub struct ContainerWriter<'a> {
    /// File id written into CHNKHead.
    pub file_id: [u8; FILE_ID_LENGTH],
    /// External chunks (id, payload), in file order.
    pub externals: Vec<(String, &'a [u8])>,
}

impl<'a> ContainerWriter<'a> {
    /// A writer with no external chunks.
    pub fn new(file_id: [u8; FILE_ID_LENGTH]) -> Self {
        ContainerWriter { file_id, externals: Vec::new() }
    }

    /// Appends an external chunk.
    pub fn push_external(&mut self, id: impl Into<String>, payload: &'a [u8]) {
        self.externals.push((id.into(), payload));
    }

    /// File offset of each external chunk header (the `ExternalChunk.Offset`
    /// values). They come before the database, so they do not depend on it.
    pub fn external_offsets(&self) -> Vec<(String, u64)> {
        let mut offset = (FILE_HEADER_SIZE + CHUNK_HEADER_SIZE + HEAD_BODY_SIZE) as u64;
        self.externals
            .iter()
            .map(|(id, payload)| {
                let here = offset;
                offset += (CHUNK_HEADER_SIZE + 8 + id.len() + payload.len()) as u64;
                (id.clone(), here)
            })
            .collect()
    }

    /// The finished file, with `sqlite` as the database image.
    pub fn assemble(&self, sqlite: &[u8]) -> Result<Vec<u8>> {
        for (id, _) in &self.externals {
            if !is_external_id(id) {
                bail!("External id must be \"extrnlid\" + 32 hex digits: {id:?}");
            }
        }
        let payload_size: usize =
            self.externals.iter().map(|(id, payload)| CHUNK_HEADER_SIZE + 8 + id.len() + payload.len()).sum();
        let sqlite_offset = FILE_HEADER_SIZE + CHUNK_HEADER_SIZE + HEAD_BODY_SIZE + payload_size;
        let total = sqlite_offset + CHUNK_HEADER_SIZE + sqlite.len() + CHUNK_HEADER_SIZE;
        let mut writer = Writer { data: Vec::with_capacity(total) };
        writer.bytes(FILE_MAGIC).be_u64(total as u64).be_u64(FILE_HEADER_SIZE as u64);
        writer
            .bytes(TAG_HEAD)
            .be_u64(HEAD_BODY_SIZE as u64)
            .be_u64(HEAD_VERSION)
            .be_u64(sqlite_offset as u64)
            .be_u64(FILE_ID_LENGTH as u64)
            .bytes(&self.file_id);
        for (id, payload) in &self.externals {
            writer
                .bytes(TAG_EXTERNAL)
                .be_u64((8 + id.len() + payload.len()) as u64)
                .be_u64(id.len() as u64)
                .bytes(id.as_bytes())
                .bytes(payload);
        }
        writer.bytes(TAG_SQLITE).be_u64(sqlite.len() as u64).bytes(sqlite);
        writer.bytes(TAG_FOOTER).be_u64(0);
        debug_assert_eq!(writer.len(), total);
        Ok(writer.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<u8> {
        let first = b"payload one".to_vec();
        let second = vec![7u8; 300];
        let mut writer = ContainerWriter::new([9; 16]);
        writer.push_external(format!("extrnlid{}", "A".repeat(32)), &first);
        writer.push_external(format!("extrnlid{}", "0".repeat(32)), &second);
        writer.assemble(b"SQLite format 3\0fake").unwrap()
    }

    #[test]
    fn written_containers_parse_and_reassemble() {
        let data = sample();
        let container = Container::parse(data.clone()).unwrap();
        assert!(container.findings().is_empty(), "{:?}", container.findings());
        assert_eq!(container.reassemble(), data);
        assert_eq!(container.sqlite().unwrap(), b"SQLite format 3\0fake");
        let id = format!("extrnlid{}", "A".repeat(32));
        assert_eq!(container.external(&id).unwrap(), b"payload one");
        let offsets = ContainerWriter { file_id: [9; 16], externals: vec![(id.clone(), b"payload one".as_slice())] }
            .external_offsets();
        assert_eq!(offsets[0].1 as usize, container.external_chunk(&id).unwrap().header_offset);
    }

    #[test]
    fn truncated_files_are_rejected() {
        let data = sample();
        for cut in [10, 30, data.len() - 20, data.len() - 1] {
            assert!(Container::parse(data[..cut].to_vec()).is_err(), "cut at {cut}");
        }
        assert!(Container::parse(b"SQLite format 3\0".to_vec()).is_err());
    }

    #[test]
    fn bad_ids_are_refused_when_writing() {
        let mut writer = ContainerWriter::new([0; 16]);
        writer.push_external("short", b"");
        assert!(writer.assemble(b"").is_err());
    }
}
