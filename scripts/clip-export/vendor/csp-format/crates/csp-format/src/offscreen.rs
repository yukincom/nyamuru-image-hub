//! Raster pixels: the `Offscreen` table and its block data.
//!
//! An offscreen is a grid of 256×256 blocks. `Offscreen.Attribute` says how
//! big it is and how a block's bytes are laid out; `Offscreen.BlockData` is
//! the id of an external chunk holding the zlib-compressed blocks (spec:
//! `docs/spec/04-raster.md`).
//!
//! `Attribute` (big endian): `u32 16, u32 len(Parameter), u32 len(InitColor),
//! u32 len(BlockSize)`, then three sections, each a UTF-16 name followed by
//! `u32` values. The values of `Parameter` and `InitColor` are, in order, the
//! columns of the unused `VOffscreen` table in `ParamScheme`
//! (`BlockDataChannelOrder`, `BlockDataPixelBytes`, … `InitColorDataAlphaValue`).
//!
//! A decompressed block is an alpha plane followed by an image plane:
//!
//! | `channel_order` | kind | block bytes | planes |
//! |---|---|---|---|
//! | 0x21 (33) | colour | 327 680 | alpha 256×256, then BGRA 256×256×4 (the 4th byte unused) |
//! | 0x11 (17), 2 bytes/pixel | gray | 131 072 | alpha, then gray |
//! | 0x11 (17), 1-bit | monochrome | 16 384 | alpha 1 bit/pixel, then 1 bit/pixel |
//! | 0x01 (1) | mask / alpha only | 65 536 | one plane |
//!
//! The external payload (big endian): `u64 length of the rest`, one record
//! per block (`u32 record length, name "BlockDataBeginChunk", u32 index,
//! u32 decompressed size, u32 256, u32 256, u32 has data, [u32 4 + n,
//! u32le n, n bytes of zlib], name "BlockDataEndChunk"`), then the tail
//! sections `BlockStatus` and `BlockCheckSum` (`name, u32 12, u32 count,
//! u32 4, count × u32`). The checksum is the Adler-32 of `u32le n` + the zlib
//! bytes, 0 for an empty block. CSP compresses with zlib level 1.

use std::io::Read;

use flate2::read::ZlibDecoder;

use crate::binary::{Reader, Writer, adler32};
use crate::error::{Error, Result, bail};
use crate::image::{GrayImage, RgbaImage};

/// Width and height of a block in pixels.
pub const BLOCK_SIZE: u32 = 256;
/// Pixels per block.
pub const BLOCK_PIXELS: usize = (BLOCK_SIZE * BLOCK_SIZE) as usize;
const ATTRIBUTE_HEADER: u32 = 16;
const BEGIN_NAME: &str = "BlockDataBeginChunk";
const END_NAME: &str = "BlockDataEndChunk";
const STATUS_NAME: &str = "BlockStatus";
const CHECKSUM_NAME: &str = "BlockCheckSum";
const TABLE_HEADER: u32 = 12;
const TABLE_ENTRY: u32 = 4;
/// Size of a block record without data (the `BlockSize` entry of empty blocks).
pub const EMPTY_RECORD_SIZE: u32 = 104;
/// What a stored block adds to its zlib length in its record.
pub const RECORD_OVERHEAD: u32 = 112;

/// Pixel layout of an offscreen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PixelKind {
    /// BGRA colour with a separate alpha plane.
    Color,
    /// 8-bit gray with alpha.
    Gray,
    /// 1-bit image with 1-bit alpha.
    Monochrome,
    /// One 8-bit plane (layer masks, selections, "alpha only" data).
    Alpha,
    /// A layout this crate does not know.
    Unknown,
}

/// One named section of the attribute: its `u32` values.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Section {
    /// Section name (`Parameter`, `InitColor`, `BlockSize`).
    pub name: String,
    /// The values, as stored.
    pub values: Vec<u32>,
}

/// `Offscreen.Attribute`, kept value for value so it can be written back.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Attribute {
    /// The sections, in stored order.
    pub sections: Vec<Section>,
}

/// The fields of the `Parameter` section, named after `VOffscreen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Parameter {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Blocks per row.
    pub blocks_x: u32,
    /// Block rows.
    pub blocks_y: u32,
    /// `BlockDataChannelOrder`: 0x21 colour (BGRA), 0x11 gray, 0x01 alpha only.
    pub channel_order: u32,
    /// `BlockDataChannelBytes` (1).
    pub channel_bytes: u32,
    /// `BlockDataChannelImageCount`: image channels besides alpha (4, 1, 0).
    pub image_channels: u32,
    /// `BlockDataPixelBytes`: bytes per pixel over all planes (5, 2, 1).
    pub pixel_bytes: u32,
    /// `BlockDataOffsetImageBlockBytes`: where the image plane starts in a block.
    pub image_offset: u32,
    /// `BlockDataOffsetImagePixelBytes`: bytes per pixel of the image plane.
    pub image_pixel_bytes: u32,
    /// `BlockDataOffsetImageRowBytes`: bytes per row of the image plane.
    pub image_row_bytes: u32,
    /// `BlockDataOffsetAlphaPixelBytes`.
    pub alpha_pixel_bytes: u32,
    /// `BlockDataOffsetAlphaRowBytes`: bytes per row of the alpha plane.
    pub alpha_row_bytes: u32,
    /// `BlockDataOffsetImageBlock`: pixels per block (65 536).
    pub block_pixels: u32,
    /// Block width in pixels (256).
    pub block_width: u32,
    /// Block height in pixels (256).
    pub block_height: u32,
    /// log2 of the block width (8).
    pub block_shift_x: u32,
    /// log2 of the block height (8).
    pub block_shift_y: u32,
}

impl Parameter {
    /// The layout CSP uses for a new offscreen of the given kind.
    pub fn new(kind: PixelKind, width: u32, height: u32) -> Self {
        let (channel_order, image_channels, pixel_bytes, image_offset, image_pixel_bytes, image_row_bytes, alpha_row) =
            match kind {
                PixelKind::Color => (0x21, 4, 5, 65536, 4, 1024, 256),
                PixelKind::Gray => (0x11, 1, 2, 65536, 1, 256, 256),
                PixelKind::Monochrome => (0x11, 1, 1, 8192, 1, 32, 32),
                PixelKind::Alpha | PixelKind::Unknown => (0x01, 0, 1, 0, 0, 0, 256),
            };
        Parameter {
            width,
            height,
            blocks_x: width.div_ceil(BLOCK_SIZE),
            blocks_y: height.div_ceil(BLOCK_SIZE),
            channel_order,
            channel_bytes: 1,
            image_channels,
            pixel_bytes,
            image_offset,
            image_pixel_bytes,
            image_row_bytes,
            alpha_pixel_bytes: 1,
            alpha_row_bytes: alpha_row,
            block_pixels: 65536,
            block_width: BLOCK_SIZE,
            block_height: BLOCK_SIZE,
            block_shift_x: 8,
            block_shift_y: 8,
        }
    }

    /// The pixel layout these values describe.
    pub fn kind(&self) -> PixelKind {
        match (self.channel_order, self.image_channels, self.alpha_row_bytes) {
            (0x21, 4, _) => PixelKind::Color,
            (0x11, 1, 32) => PixelKind::Monochrome,
            (0x11, 1, _) => PixelKind::Gray,
            (0x01, 0, _) => PixelKind::Alpha,
            _ => PixelKind::Unknown,
        }
    }

    /// Number of blocks in the grid.
    pub fn block_count(&self) -> usize {
        self.blocks_x as usize * self.blocks_y as usize
    }

    /// Bytes of one decompressed block.
    pub fn block_bytes(&self) -> usize {
        let alpha = self.alpha_row_bytes as usize * BLOCK_SIZE as usize;
        let image = self.image_row_bytes as usize * BLOCK_SIZE as usize;
        if self.image_channels == 0 { alpha } else { (self.image_offset as usize).max(alpha) + image }
    }

    /// Top-left pixel of block `index` (blocks are numbered row by row).
    pub fn block_origin(&self, index: usize) -> (u32, u32) {
        let column = index % self.blocks_x.max(1) as usize;
        let row = index / self.blocks_x.max(1) as usize;
        (column as u32 * BLOCK_SIZE, row as u32 * BLOCK_SIZE)
    }

    fn check(&self) -> Result<()> {
        if self.blocks_x != self.width.div_ceil(BLOCK_SIZE) || self.blocks_y != self.height.div_ceil(BLOCK_SIZE) {
            bail!(
                "Block grid {}×{} does not fit the size {}×{}",
                self.blocks_x,
                self.blocks_y,
                self.width,
                self.height
            );
        }
        if self.block_width != BLOCK_SIZE || self.block_height != BLOCK_SIZE {
            bail!("Unsupported block size {}×{}", self.block_width, self.block_height);
        }
        if self.width > 1 << 20 || self.height > 1 << 20 {
            bail!("Offscreen too large: {}×{}", self.width, self.height);
        }
        Ok(())
    }
}

/// `InitColor`: how blocks that are not stored start out.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct InitColor {
    /// Not stored blocks are filled (`DoInitialize`).
    pub do_initialize: bool,
    /// Alpha of a not stored pixel (0xFFFFFFFF = opaque, as on paper).
    pub alpha: u32,
    /// Colour values of a not stored pixel.
    pub image_values: Vec<u32>,
}

impl Attribute {
    /// Parses an `Offscreen.Attribute` blob.
    pub fn parse(data: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(data);
        let header = reader.be_u32()?;
        if header != ATTRIBUTE_HEADER {
            bail!("Offscreen attribute starts with {header}, expected 16");
        }
        let lengths = [reader.be_u32()?, reader.be_u32()?, reader.be_u32()?];
        let mut sections = Vec::new();
        for length in lengths {
            let start = reader.position();
            let name = reader.utf16_name()?;
            let end = start + length as usize;
            if end > data.len() || end < reader.position() || !(end - reader.position()).is_multiple_of(4) {
                bail!("Offscreen attribute section {name:?} has a bad length {length}");
            }
            let mut values = Vec::new();
            while reader.position() < end {
                values.push(reader.be_u32()?);
            }
            sections.push(Section { name, values });
        }
        if !reader.is_empty() {
            bail!("{} bytes after the offscreen attribute sections", reader.remaining());
        }
        Ok(Attribute { sections })
    }

    /// The blob; an unchanged attribute gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bodies = Vec::new();
        for section in &self.sections {
            let mut writer = Writer::new();
            writer.utf16_name(&section.name);
            for value in &section.values {
                writer.be_u32(*value);
            }
            bodies.push(writer.into_inner());
        }
        let mut writer = Writer::new();
        writer.be_u32(ATTRIBUTE_HEADER);
        for body in &bodies {
            writer.be_u32(body.len() as u32);
        }
        for body in &bodies {
            writer.bytes(body);
        }
        writer.into_inner()
    }

    /// The section of this name.
    pub fn section(&self, name: &str) -> Option<&Section> {
        self.sections.iter().find(|section| section.name == name)
    }

    fn section_mut(&mut self, name: &str) -> Option<&mut Section> {
        self.sections.iter_mut().find(|section| section.name == name)
    }

    /// The `Parameter` section, typed and checked.
    pub fn parameter(&self) -> Result<Parameter> {
        let values = &self
            .section("Parameter")
            .ok_or_else(|| Error::format("Offscreen attribute has no Parameter section"))?
            .values;
        if values.len() < 18 {
            bail!("Parameter section has {} values, expected at least 18", values.len());
        }
        let parameter = Parameter {
            width: values[0],
            height: values[1],
            blocks_x: values[2],
            blocks_y: values[3],
            channel_order: values[4],
            channel_bytes: values[5],
            image_channels: values[6],
            pixel_bytes: values[7],
            image_offset: values[8],
            image_pixel_bytes: values[9],
            image_row_bytes: values[10],
            alpha_pixel_bytes: values[11],
            alpha_row_bytes: values[12],
            block_pixels: values[13],
            block_width: values[14],
            block_height: values[15],
            block_shift_x: values[16],
            block_shift_y: values[17],
        };
        parameter.check()?;
        Ok(parameter)
    }

    /// The two values after the named ones (observed `0, 0`, and `1, 0` for
    /// 1-bit offscreens).
    pub fn parameter_extra(&self) -> &[u32] {
        self.section("Parameter").map(|section| section.values.get(18..).unwrap_or(&[])).unwrap_or(&[])
    }

    /// The `InitColor` section, if any.
    pub fn init_color(&self) -> Option<InitColor> {
        // u32 20 (fixed part), DoInitialize, AlphaValue, ImageValueCount, u32 4, values.
        let values = &self.section("InitColor")?.values;
        let count = *values.get(3)? as usize;
        Some(InitColor {
            do_initialize: *values.get(1)? != 0,
            alpha: *values.get(2)?,
            image_values: values.get(5..5 + count)?.to_vec(),
        })
    }

    /// `BlockSize`: the length of every block record in the payload.
    pub fn block_sizes(&self) -> Option<&[u32]> {
        let values = &self.section("BlockSize")?.values;
        let count = *values.get(1)? as usize;
        values.get(3..3 + count)
    }

    /// Replaces (or adds) the `BlockSize` section.
    pub fn set_block_sizes(&mut self, sizes: &[u32]) {
        let values = vec![TABLE_HEADER, sizes.len() as u32, TABLE_ENTRY].into_iter().chain(sizes.iter().copied());
        match self.section_mut("BlockSize") {
            Some(section) => section.values = values.collect(),
            None => self.sections.push(Section { name: "BlockSize".into(), values: values.collect() }),
        }
    }

    /// A new attribute as CSP writes it for an offscreen without init colour.
    pub fn new(parameter: &Parameter, init: Option<&InitColor>) -> Self {
        let mut values = vec![
            parameter.width,
            parameter.height,
            parameter.blocks_x,
            parameter.blocks_y,
            parameter.channel_order,
            parameter.channel_bytes,
            parameter.image_channels,
            parameter.pixel_bytes,
            parameter.image_offset,
            parameter.image_pixel_bytes,
            parameter.image_row_bytes,
            parameter.alpha_pixel_bytes,
            parameter.alpha_row_bytes,
            parameter.block_pixels,
            parameter.block_width,
            parameter.block_height,
            parameter.block_shift_x,
            parameter.block_shift_y,
        ];
        values.extend([(parameter.kind() == PixelKind::Monochrome) as u32, 0]);
        let init_values = match init {
            Some(init) => {
                let mut values = vec![20, init.do_initialize as u32, init.alpha, init.image_values.len() as u32, 4];
                values.extend(&init.image_values);
                values
            }
            None => vec![20, 0, 0, 0, 4],
        };
        let mut attribute = Attribute {
            sections: vec![
                Section { name: "Parameter".into(), values },
                Section { name: "InitColor".into(), values: init_values },
            ],
        };
        attribute.set_block_sizes(&vec![EMPTY_RECORD_SIZE; parameter.block_count()]);
        attribute
    }
}

/// One block record of the payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    /// Index in the grid (row by row).
    pub index: u32,
    /// Decompressed size the record declares.
    pub raw_size: u32,
    /// Block width in pixels.
    pub width: u32,
    /// Block height in pixels.
    pub height: u32,
    /// zlib stream; None when the block is not stored (all transparent).
    pub zlib: Option<Vec<u8>>,
}

impl Block {
    /// Length of the block's record in the payload.
    pub fn record_size(&self) -> u32 {
        match &self.zlib {
            Some(zlib) => RECORD_OVERHEAD + zlib.len() as u32,
            None => EMPTY_RECORD_SIZE,
        }
    }

    /// The checksum CSP stores for this block.
    pub fn checksum(&self) -> u32 {
        match &self.zlib {
            Some(zlib) => {
                let mut stored = (zlib.len() as u32).to_le_bytes().to_vec();
                stored.extend_from_slice(zlib);
                adler32(&stored)
            }
            None => 0,
        }
    }

    /// The decompressed block; None when it is not stored.
    pub fn inflate(&self) -> Result<Option<Vec<u8>>> {
        let Some(zlib) = &self.zlib else { return Ok(None) };
        let mut raw = Vec::with_capacity(self.raw_size as usize);
        ZlibDecoder::new(zlib.as_slice())
            .take(self.raw_size as u64 + 1)
            .read_to_end(&mut raw)
            .map_err(|_| Error::format(format!("Block {} is not valid zlib data", self.index)))?;
        if raw.len() != self.raw_size as usize {
            bail!("Block {} has {} bytes, expected {}", self.index, raw.len(), self.raw_size);
        }
        Ok(Some(raw))
    }
}

/// A tail table (`BlockStatus`, `BlockCheckSum`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Table {
    /// Table name.
    pub name: String,
    /// First value after the name (12).
    pub header: u32,
    /// Bytes per entry (4).
    pub entry_size: u32,
    /// One value per block.
    pub values: Vec<u32>,
}

/// The external payload of an offscreen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockData {
    /// One record per block of the grid.
    pub blocks: Vec<Block>,
    /// The tables after the blocks.
    pub tables: Vec<Table>,
}

impl BlockData {
    /// Parses an `Offscreen.BlockData` external payload.
    pub fn parse(payload: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(payload);
        let length = reader.be_u64()?;
        if length != (payload.len() - 8) as u64 {
            bail!("Block data says {length} bytes follow, {} do", payload.len() - 8);
        }
        let mut blocks = Vec::new();
        let mut tables = Vec::new();
        while !reader.is_empty() {
            let start = reader.position();
            let peek = Reader::at(payload, start + 4);
            if peek.peek_utf16_name().as_deref() == Some(BEGIN_NAME) {
                let record_length = reader.be_u32()? as usize;
                reader.utf16_name()?;
                let index = reader.be_u32()?;
                let raw_size = reader.be_u32()?;
                let width = reader.be_u32()?;
                let height = reader.be_u32()?;
                let has_data = reader.be_u32()?;
                let zlib = match has_data {
                    0 => None,
                    1 => {
                        let stored = reader.be_u32()? as usize;
                        let zlib_length = reader.le_u32()? as usize;
                        if stored != zlib_length + 4 {
                            bail!("Block {index}: stored length {stored} vs zlib length {zlib_length}");
                        }
                        Some(reader.bytes(zlib_length)?.to_vec())
                    }
                    other => bail!("Block {index}: unknown data flag {other}"),
                };
                if reader.utf16_name()? != END_NAME {
                    bail!("Block {index}: record does not end with {END_NAME}");
                }
                if reader.position() - start != record_length {
                    bail!("Block {index}: record is {} bytes, says {record_length}", reader.position() - start);
                }
                blocks.push(Block { index, raw_size, width, height, zlib });
            } else {
                let name = reader.utf16_name()?;
                let header = reader.be_u32()?;
                let count = reader.be_u32()? as usize;
                let entry_size = reader.be_u32()?;
                if entry_size != 4 || count > reader.remaining() / 4 {
                    bail!("Table {name:?} has entries of {entry_size} bytes × {count}");
                }
                let mut values = Vec::with_capacity(count);
                for _ in 0..count {
                    values.push(reader.be_u32()?);
                }
                tables.push(Table { name, header, entry_size, values });
            }
        }
        Ok(BlockData { blocks, tables })
    }

    /// The payload; unchanged data gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut writer = Writer::new();
        writer.be_u64(0);
        for block in &self.blocks {
            writer.be_u32(block.record_size()).utf16_name(BEGIN_NAME);
            writer
                .be_u32(block.index)
                .be_u32(block.raw_size)
                .be_u32(block.width)
                .be_u32(block.height)
                .be_u32(block.zlib.is_some() as u32);
            if let Some(zlib) = &block.zlib {
                writer.be_u32(zlib.len() as u32 + 4).le_u32(zlib.len() as u32).bytes(zlib);
            }
            writer.utf16_name(END_NAME);
        }
        for table in &self.tables {
            writer.utf16_name(&table.name).be_u32(table.header).be_u32(table.values.len() as u32);
            writer.be_u32(table.entry_size);
            for value in &table.values {
                writer.be_u32(*value);
            }
        }
        let mut data = writer.into_inner();
        let length = (data.len() - 8) as u64;
        data[..8].copy_from_slice(&length.to_be_bytes());
        data
    }

    /// The table of this name.
    pub fn table(&self, name: &str) -> Option<&Table> {
        self.tables.iter().find(|table| table.name == name)
    }

    /// Block indexes whose stored checksum does not match their data.
    pub fn checksum_mismatches(&self) -> Vec<u32> {
        let Some(table) = self.table(CHECKSUM_NAME) else { return Vec::new() };
        self.blocks
            .iter()
            .zip(&table.values)
            .filter(|(block, stored)| block.checksum() != **stored)
            .map(|(block, _)| block.index)
            .collect()
    }

    /// Build from decompressed blocks (None = not stored), compressing as CSP does.
    pub fn from_raw_blocks(raw_blocks: &[Option<Vec<u8>>], raw_size: usize) -> Result<Self> {
        let mut blocks = Vec::with_capacity(raw_blocks.len());
        for (index, raw) in raw_blocks.iter().enumerate() {
            if let Some(raw) = raw
                && raw.len() != raw_size
            {
                bail!("Block {index} has {} bytes, expected {raw_size}", raw.len());
            }
            blocks.push(Block {
                index: index as u32,
                raw_size: raw_size as u32,
                width: BLOCK_SIZE,
                height: BLOCK_SIZE,
                zlib: raw.as_ref().map(|raw| compress(raw)),
            });
        }
        let checksums = blocks.iter().map(Block::checksum).collect();
        Ok(BlockData {
            tables: vec![
                Table {
                    name: STATUS_NAME.into(),
                    header: TABLE_HEADER,
                    entry_size: TABLE_ENTRY,
                    values: vec![1; blocks.len()],
                },
                Table { name: CHECKSUM_NAME.into(), header: TABLE_HEADER, entry_size: TABLE_ENTRY, values: checksums },
            ],
            blocks,
        })
    }

    /// Record length of every block, for the `BlockSize` section.
    pub fn record_sizes(&self) -> Vec<u32> {
        self.blocks.iter().map(Block::record_size).collect()
    }
}

/// zlib with CSP's settings: the bundled C zlib at level 1, window bits 15,
/// memory level 9 (gives CSP's bytes exactly).
pub fn compress(raw: &[u8]) -> Vec<u8> {
    crate::zlib::compress(raw).expect("compressing in memory")
}

/// A decoded offscreen.
#[derive(Debug, Clone)]
pub struct Offscreen {
    /// The attribute.
    pub attribute: Attribute,
    /// Its `Parameter` section.
    pub parameter: Parameter,
    /// The block data, when the payload is stored.
    pub data: Option<BlockData>,
}

impl Offscreen {
    /// Parses an attribute and, if given, its block data payload, and checks they agree.
    pub fn parse(attribute: &[u8], payload: Option<&[u8]>) -> Result<Self> {
        let attribute = Attribute::parse(attribute)?;
        let parameter = attribute.parameter()?;
        let data = payload.map(BlockData::parse).transpose()?;
        if let Some(data) = &data
            && data.blocks.len() != parameter.block_count()
        {
            bail!("Block data has {} blocks, the grid {}", data.blocks.len(), parameter.block_count());
        }
        Ok(Offscreen { attribute, parameter, data })
    }

    /// The pixel layout.
    pub fn kind(&self) -> PixelKind {
        self.parameter.kind()
    }

    /// Visit every stored block decompressed: (block index, raw bytes).
    pub fn for_each_block(&self, mut visit: impl FnMut(usize, &[u8]) -> Result<()>) -> Result<()> {
        let Some(data) = &self.data else { return Ok(()) };
        let expected = self.parameter.block_bytes();
        for (index, block) in data.blocks.iter().enumerate() {
            if let Some(raw) = block.inflate()? {
                if raw.len() < expected {
                    bail!("Block {index} has {} bytes, the layout needs {expected}", raw.len());
                }
                visit(index, &raw)?;
            }
        }
        Ok(())
    }

    /// Colour, gray and monochrome offscreens as RGBA (not premultiplied).
    /// Blocks that are not stored are transparent (or the init colour).
    pub fn to_rgba(&self) -> Result<RgbaImage> {
        let p = self.parameter;
        let kind = p.kind();
        if !matches!(kind, PixelKind::Color | PixelKind::Gray | PixelKind::Monochrome | PixelKind::Alpha) {
            bail!("Unknown pixel layout (channel order {:#x})", p.channel_order);
        }
        let mut image = RgbaImage::new(p.width, p.height);
        if let Some(init) = self.attribute.init_color()
            && init.do_initialize
        {
            let alpha = (init.alpha & 0xff) as u8;
            image.fill([255, 255, 255, alpha]);
        }
        self.for_each_block(|index, raw| {
            let (left, top) = p.block_origin(index);
            let width = BLOCK_SIZE.min(p.width - left) as usize;
            let height = BLOCK_SIZE.min(p.height - top) as usize;
            for y in 0..height {
                let row = image.row_mut(top + y as u32);
                for x in 0..width {
                    let alpha = plane_value(raw, 0, p.alpha_row_bytes, x, y);
                    let target = (left as usize + x) * 4;
                    let rgb = match kind {
                        PixelKind::Color => {
                            let at = p.image_offset as usize + y * p.image_row_bytes as usize + x * 4;
                            [raw[at + 2], raw[at + 1], raw[at]]
                        }
                        PixelKind::Gray | PixelKind::Monochrome => {
                            let value = plane_value(raw, p.image_offset as usize, p.image_row_bytes, x, y);
                            [value; 3]
                        }
                        _ => [0, 0, 0],
                    };
                    row[target..target + 3].copy_from_slice(&rgb);
                    row[target + 3] = alpha;
                }
            }
            Ok(())
        })?;
        Ok(image)
    }

    /// Boxes `(x0, y0, x1, y1)` in offscreen pixels of the blocks that store
    /// data. Nothing is decompressed; edge blocks end at the offscreen's size.
    pub fn stored_boxes(&self) -> Vec<(u32, u32, u32, u32)> {
        let p = self.parameter;
        let Some(data) = &self.data else { return Vec::new() };
        data.blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| block.zlib.is_some())
            .map(|(index, _)| {
                let (left, top) = p.block_origin(index);
                (left, top, (left + BLOCK_SIZE).min(p.width), (top + BLOCK_SIZE).min(p.height))
            })
            .collect()
    }

    /// [`Offscreen::to_rgba`] of the box `(x0, y0, x1, y1)` in offscreen
    /// pixels, which may reach outside the offscreen (that part is
    /// transparent). Only the blocks the box overlaps are decompressed, so
    /// part of a large sheet can be read without decoding all of it.
    pub fn to_rgba_region(&self, region: (i64, i64, i64, i64)) -> Result<RgbaImage> {
        let p = self.parameter;
        if p.kind() == PixelKind::Unknown {
            bail!("Unknown pixel layout (channel order {:#x})", p.channel_order);
        }
        let (x0, y0, x1, y1) = region;
        let mut image = RgbaImage::new((x1 - x0).max(0) as u32, (y1 - y0).max(0) as u32);
        // The part of the box inside the offscreen.
        let inside = (x0.max(0), y0.max(0), x1.min(p.width as i64), y1.min(p.height as i64));
        if inside.0 >= inside.2 || inside.1 >= inside.3 {
            return Ok(image);
        }
        // The init colour covers the offscreen only.
        if let Some(init) = self.attribute.init_color()
            && init.do_initialize
        {
            let mut fill = RgbaImage::new((inside.2 - inside.0) as u32, (inside.3 - inside.1) as u32);
            fill.fill([255, 255, 255, (init.alpha & 0xff) as u8]);
            image.paste(&fill, inside.0 - x0, inside.1 - y0);
        }
        let Some(data) = &self.data else { return Ok(image) };
        let expected = p.block_bytes();
        let size = BLOCK_SIZE as i64;
        let columns = (inside.0 / size)..(inside.2 - 1) / size + 1;
        for row in (inside.1 / size)..(inside.3 - 1) / size + 1 {
            for column in columns.clone() {
                let index = (row * p.blocks_x as i64 + column) as usize;
                let Some(raw) = data.blocks.get(index).map(Block::inflate).transpose()?.flatten() else { continue };
                if raw.len() < expected {
                    bail!("Block {index} has {} bytes, the layout needs {expected}", raw.len());
                }
                let (left, top) = p.block_origin(index);
                let tile = block_to_rgba(&p, BLOCK_SIZE.min(p.width - left), BLOCK_SIZE.min(p.height - top), &raw);
                image.paste(&tile, left as i64 - x0, top as i64 - y0);
            }
        }
        Ok(image)
    }

    /// [`Offscreen::to_rgba`] halved `halvings` times with
    /// [`RgbaImage::halve`], one block at a time, so a large offscreen read
    /// at a small scale never exists at full size. Blocks are 256 pixels and
    /// aligned, so up to 8 halvings give exactly the result of halving the
    /// whole image; more are done on the reduced image.
    pub fn to_rgba_halved(&self, halvings: u32) -> Result<RgbaImage> {
        self.halved(halvings, false)
    }

    /// The mask plane as opaque grey pixels (`v, v, v, 255`), halved like
    /// [`Offscreen::to_rgba_halved`].
    pub fn to_mask_rgba_halved(&self, halvings: u32) -> Result<RgbaImage> {
        self.halved(halvings, true)
    }

    fn halved(&self, halvings: u32, mask: bool) -> Result<RgbaImage> {
        let p = self.parameter;
        let within = halvings.min(BLOCK_SIZE.trailing_zeros());
        let reduce = |mut v: u32| {
            for _ in 0..within {
                v = (v / 2).max(1);
            }
            v
        };
        let mut image = RgbaImage::new(reduce(p.width), reduce(p.height));
        let init = self.attribute.init_color().filter(|init| init.do_initialize).map(|init| (init.alpha & 0xff) as u8);
        match (init, mask) {
            (Some(alpha), false) => image.fill([255, 255, 255, alpha]),
            (alpha, true) => image.fill([alpha.unwrap_or(0), alpha.unwrap_or(0), alpha.unwrap_or(0), 255]),
            (None, false) => {}
        }
        self.for_each_block(|index, raw| {
            let (left, top) = p.block_origin(index);
            let (width, height) = (BLOCK_SIZE.min(p.width - left), BLOCK_SIZE.min(p.height - top));
            let mut tile =
                if mask { block_to_mask(&p, width, height, raw) } else { block_to_rgba(&p, width, height, raw) };
            for _ in 0..within {
                tile = tile.halve();
            }
            image.paste(&tile, (left >> within) as i64, (top >> within) as i64);
            Ok(())
        })?;
        for _ in within..halvings {
            image = image.halve();
        }
        Ok(image)
    }

    /// The first plane as an 8-bit image (masks: 0 = hidden, 255 = shown).
    pub fn to_alpha(&self) -> Result<GrayImage> {
        let p = self.parameter;
        let mut image = GrayImage::new(p.width, p.height);
        if let Some(init) = self.attribute.init_color()
            && init.do_initialize
        {
            image.pixels.fill((init.alpha & 0xff) as u8);
        }
        self.for_each_block(|index, raw| {
            let (left, top) = p.block_origin(index);
            let width = BLOCK_SIZE.min(p.width - left) as usize;
            let height = BLOCK_SIZE.min(p.height - top) as usize;
            for y in 0..height {
                let start = ((top as usize + y) * p.width as usize) + left as usize;
                for x in 0..width {
                    image.pixels[start + x] = plane_value(raw, 0, p.alpha_row_bytes, x, y);
                }
            }
            Ok(())
        })?;
        Ok(image)
    }

    /// Re-encode the decoded pixels and compare with the stored blocks:
    /// (blocks equal byte for byte, blocks with equal pixels, stored blocks).
    pub fn reencode_check(&self) -> Result<(usize, usize, usize)> {
        let Some(data) = &self.data else { return Ok((0, 0, 0)) };
        let (mut same_bytes, mut same_pixels, mut stored) = (0, 0, 0);
        for block in &data.blocks {
            let Some(raw) = block.inflate()? else { continue };
            stored += 1;
            let zlib = compress(&raw);
            if Some(&zlib) == block.zlib.as_ref() {
                same_bytes += 1;
            }
            let again = Block { zlib: Some(zlib), ..block.clone() }.inflate()?;
            if again.as_deref() == Some(raw.as_slice()) {
                same_pixels += 1;
            }
        }
        Ok((same_bytes, same_pixels, stored))
    }
}

/// One decompressed block (`width × height` of it) as an image.
fn block_to_rgba(p: &Parameter, width: u32, height: u32, raw: &[u8]) -> RgbaImage {
    let kind = p.kind();
    let mut image = RgbaImage::new(width, height);
    for y in 0..height as usize {
        let row = image.row_mut(y as u32);
        for x in 0..width as usize {
            let rgb = match kind {
                PixelKind::Color => {
                    let at = p.image_offset as usize + y * p.image_row_bytes as usize + x * 4;
                    [raw[at + 2], raw[at + 1], raw[at]]
                }
                PixelKind::Gray | PixelKind::Monochrome => {
                    [plane_value(raw, p.image_offset as usize, p.image_row_bytes, x, y); 3]
                }
                _ => [0, 0, 0],
            };
            row[x * 4..x * 4 + 3].copy_from_slice(&rgb);
            row[x * 4 + 3] = plane_value(raw, 0, p.alpha_row_bytes, x, y);
        }
    }
    image
}

/// The first plane of a block as opaque grey pixels.
fn block_to_mask(p: &Parameter, width: u32, height: u32, raw: &[u8]) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    for y in 0..height as usize {
        let row = image.row_mut(y as u32);
        for x in 0..width as usize {
            let v = plane_value(raw, 0, p.alpha_row_bytes, x, y);
            row[x * 4..x * 4 + 4].copy_from_slice(&[v, v, v, 255]);
        }
    }
    image
}

/// Value of pixel (x, y) of a plane starting at `offset`: 8-bit planes
/// directly, 1-bit planes (row bytes = 32) as 0 or 255, most significant bit first.
fn plane_value(raw: &[u8], offset: usize, row_bytes: u32, x: usize, y: usize) -> u8 {
    if row_bytes == BLOCK_SIZE / 8 {
        let byte = raw[offset + y * row_bytes as usize + x / 8];
        if byte & (0x80 >> (x % 8)) != 0 { 255 } else { 0 }
    } else {
        raw[offset + y * row_bytes as usize + x]
    }
}

/// Encode an image into blocks for `parameter` (colour, gray or alpha).
/// Blocks whose pixels are all transparent are not stored, as CSP does.
pub fn encode(parameter: &Parameter, rgba: Option<&RgbaImage>, alpha: Option<&GrayImage>) -> Result<BlockData> {
    let kind = parameter.kind();
    let raw_size = parameter.block_bytes();
    let mut raw_blocks = Vec::with_capacity(parameter.block_count());
    for index in 0..parameter.block_count() {
        let (left, top) = parameter.block_origin(index);
        let mut raw = vec![0u8; raw_size];
        let mut visible = false;
        for y in 0..BLOCK_SIZE {
            let source_y = top + y;
            if source_y >= parameter.height {
                break;
            }
            for x in 0..BLOCK_SIZE {
                let source_x = left + x;
                if source_x >= parameter.width {
                    break;
                }
                let at = (y * BLOCK_SIZE + x) as usize;
                match (kind, rgba, alpha) {
                    (PixelKind::Color, Some(image), _) => {
                        let pixel = image.pixel(source_x, source_y);
                        raw[at] = pixel[3];
                        let base = parameter.image_offset as usize + at * 4;
                        raw[base..base + 4].copy_from_slice(&[pixel[2], pixel[1], pixel[0], 0]);
                        visible |= pixel[3] != 0;
                    }
                    (PixelKind::Gray, Some(image), _) => {
                        let pixel = image.pixel(source_x, source_y);
                        raw[at] = pixel[3];
                        raw[parameter.image_offset as usize + at] = crate::image::luma(pixel[0], pixel[1], pixel[2]);
                        visible |= pixel[3] != 0;
                    }
                    (PixelKind::Alpha, _, Some(image)) => {
                        let value = image.pixels[(source_y * image.width + source_x) as usize];
                        raw[at] = value;
                        visible |= value != 0;
                    }
                    _ => bail!("Encoding {kind:?} offscreens from this input is not supported"),
                }
            }
        }
        raw_blocks.push(visible.then_some(raw));
    }
    BlockData::from_raw_blocks(&raw_blocks, raw_size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colour_offscreens_round_trip() {
        let mut image = RgbaImage::new(300, 10);
        image.set_pixel(299, 9, [10, 20, 30, 40]);
        image.set_pixel(0, 0, [200, 100, 50, 255]);
        let parameter = Parameter::new(PixelKind::Color, 300, 10);
        let data = encode(&parameter, Some(&image), None).unwrap();
        assert_eq!(data.blocks.len(), 2);
        assert!(data.checksum_mismatches().is_empty());
        let bytes = data.to_bytes();
        assert_eq!(BlockData::parse(&bytes).unwrap(), data);
        let mut attribute = Attribute::new(&parameter, None);
        attribute.set_block_sizes(&data.record_sizes());
        let attribute_bytes = attribute.to_bytes();
        assert_eq!(Attribute::parse(&attribute_bytes).unwrap(), attribute);
        let offscreen = Offscreen::parse(&attribute_bytes, Some(&bytes)).unwrap();
        assert_eq!(offscreen.kind(), PixelKind::Color);
        let decoded = offscreen.to_rgba().unwrap();
        assert_eq!(decoded.pixel(299, 9), [10, 20, 30, 40]);
        assert_eq!(decoded.pixel(0, 0), [200, 100, 50, 255]);
        assert_eq!(decoded.pixel(1, 1)[3], 0);
        assert_eq!(offscreen.reencode_check().unwrap(), (2, 2, 2));
    }

    #[test]
    fn regions_decode_only_what_they_cover() {
        // 600×300: blocks of 256 px, the last column and row cut short.
        let mut image = RgbaImage::new(600, 300);
        for (x, y) in [(0, 0), (255, 255), (256, 0), (599, 299), (300, 280)] {
            image.set_pixel(x, y, [x as u8, y as u8, 7, 200]);
        }
        let parameter = Parameter::new(PixelKind::Color, 600, 300);
        let data = encode(&parameter, Some(&image), None).unwrap();
        let mut attribute = Attribute::new(&parameter, None);
        attribute.set_block_sizes(&data.record_sizes());
        let offscreen = Offscreen::parse(&attribute.to_bytes(), Some(&data.to_bytes())).unwrap();
        // Blocks 0, 1, 4 and 5 store pixels; 2 (512..600, 0..256) and 3 do not.
        assert_eq!(
            offscreen.stored_boxes(),
            [(0, 0, 256, 256), (256, 0, 512, 256), (256, 256, 512, 300), (512, 256, 600, 300)]
        );
        let whole = offscreen.to_rgba().unwrap();
        for region in
            [(0, 0, 600, 300), (250, 250, 310, 290), (-10, -20, 5, 5), (590, 290, 700, 400), (700, 0, 710, 10)]
        {
            let part = offscreen.to_rgba_region(region).unwrap();
            assert_eq!((part.width as i64, part.height as i64), (region.2 - region.0, region.3 - region.1));
            for y in 0..part.height as i64 {
                for x in 0..part.width as i64 {
                    let (cx, cy) = (x + region.0, y + region.1);
                    let expected = if (0..600).contains(&cx) && (0..300).contains(&cy) {
                        whole.pixel(cx as u32, cy as u32)
                    } else {
                        [0; 4]
                    };
                    assert_eq!(part.pixel(x as u32, y as u32), expected, "{region:?} at {cx},{cy}");
                }
            }
        }
    }

    #[test]
    fn regions_keep_the_init_colour_inside_only() {
        let parameter = Parameter::new(PixelKind::Color, 100, 100);
        let init = InitColor { do_initialize: true, alpha: 0xffff_ffff, image_values: vec![0xffff_ffff; 4] };
        let attribute = Attribute::new(&parameter, Some(&init));
        let offscreen = Offscreen::parse(&attribute.to_bytes(), None).unwrap();
        let part = offscreen.to_rgba_region((90, 90, 110, 110)).unwrap();
        assert_eq!(part.pixel(0, 0), [255, 255, 255, 255]);
        assert_eq!(part.pixel(9, 9), [255, 255, 255, 255]);
        assert_eq!(part.pixel(10, 10), [0; 4]);
        assert!(offscreen.stored_boxes().is_empty());
    }

    #[test]
    fn masks_round_trip() {
        let mut mask = GrayImage::new(256, 256);
        mask.pixels[5] = 128;
        let parameter = Parameter::new(PixelKind::Alpha, 256, 256);
        let data = encode(&parameter, None, Some(&mask)).unwrap();
        let offscreen = Offscreen { attribute: Attribute::new(&parameter, None), parameter, data: Some(data) };
        assert_eq!(offscreen.to_alpha().unwrap().pixels, mask.pixels);
    }

    #[test]
    fn halving_by_blocks_equals_halving_the_image() {
        let (width, height) = (601, 300);
        let mut image = RgbaImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                let v = (x * 7 + y * 13) as u8;
                let alpha = if (x / 37 + y / 23) % 3 == 0 { 0 } else { v / 2 + 100 };
                image.set_pixel(x, y, [v, 255 - v, (x ^ y) as u8, alpha]);
            }
        }
        let parameter = Parameter::new(PixelKind::Color, width, height);
        let data = encode(&parameter, Some(&image), None).unwrap();
        let mut attribute = Attribute::new(&parameter, None);
        attribute.set_block_sizes(&data.record_sizes());
        let offscreen = Offscreen::parse(&attribute.to_bytes(), Some(&data.to_bytes())).unwrap();
        let mut expected = offscreen.to_rgba().unwrap();
        for halvings in 1..=10 {
            expected = expected.halve();
            assert_eq!(offscreen.to_rgba_halved(halvings).unwrap(), expected, "{halvings}");
        }
    }

    #[test]
    fn broken_payloads_are_errors() {
        let parameter = Parameter::new(PixelKind::Color, 16, 16);
        let mut image = RgbaImage::new(16, 16);
        image.fill([1, 2, 3, 4]);
        let bytes = encode(&parameter, Some(&image), None).unwrap().to_bytes();
        for cut in [4, 20, bytes.len() / 2, bytes.len() - 1] {
            assert!(BlockData::parse(&bytes[..cut]).is_err(), "cut {cut}");
        }
    }
}
