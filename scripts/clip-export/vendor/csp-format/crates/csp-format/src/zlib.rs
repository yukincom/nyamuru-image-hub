//! zlib compression with CSP's exact settings.
//!
//! CSP compresses pixel blocks with zlib (the reference C library) at
//! level 1, window bits 15 and memory level 9 (zlib's default is 8). The
//! same stream bytes are only produced by the same library with the same
//! settings, and the Rust zlib crates do not expose the memory level, so
//! this module calls the bundled C zlib through `libz-sys`. It is the only
//! `unsafe` code in the crate.
//!
//! Brush tip images (`BrushPatternImage`) taken from materials keep the
//! blocks they came with, which use zlib's defaults (level 6, memory level
//! 8); [`compress_default`] reproduces those.

#![allow(unsafe_code)]

use libz_sys as z;

use crate::error::{Error, Result};

pub const LEVEL: i32 = 1;
pub const WINDOW_BITS: i32 = 15;
pub const MEM_LEVEL: i32 = 9;
/// zlib's own default level and memory level.
pub const DEFAULT_LEVEL: i32 = 6;
pub const DEFAULT_MEM_LEVEL: i32 = 8;

/// Compress `data` into one zlib stream as CSP does.
pub fn compress(data: &[u8]) -> Result<Vec<u8>> {
    compress_with(data, LEVEL, WINDOW_BITS, MEM_LEVEL)
}

/// Compress with zlib's default settings (material brush tips).
pub fn compress_default(data: &[u8]) -> Result<Vec<u8>> {
    compress_with(data, DEFAULT_LEVEL, WINDOW_BITS, DEFAULT_MEM_LEVEL)
}

/// Compress with explicit settings (used to find which settings a file used).
pub fn compress_with(data: &[u8], level: i32, window_bits: i32, mem_level: i32) -> Result<Vec<u8>> {
    let input_length = z::uInt::try_from(data.len()).map_err(|_| Error::format("Block too large to compress"))?;
    // SAFETY: every field of the stream is initialised (zlib fills `state`,
    // `msg`, the totals and checksums in deflateInit2), the allocator
    // callbacks are valid for the whole use, `next_in`/`next_out` point into
    // live buffers of the stated lengths during `deflate`, and the stream is
    // always released with `deflateEnd` before returning.
    unsafe {
        let mut stream = z::z_stream {
            next_in: std::ptr::null_mut(),
            avail_in: 0,
            total_in: 0,
            next_out: std::ptr::null_mut(),
            avail_out: 0,
            total_out: 0,
            msg: std::ptr::null_mut(),
            state: std::ptr::null_mut(),
            zalloc,
            zfree,
            opaque: std::ptr::null_mut(),
            data_type: 0,
            adler: 0,
            reserved: 0,
        };
        let code = z::deflateInit2_(
            &mut stream,
            level,
            z::Z_DEFLATED,
            window_bits,
            mem_level,
            z::Z_DEFAULT_STRATEGY,
            z::zlibVersion(),
            std::mem::size_of::<z::z_stream>() as i32,
        );
        if code != z::Z_OK {
            return Err(Error::format(format!("deflateInit2 failed ({code})")));
        }
        let bound = z::deflateBound(&mut stream, input_length as z::uLong) as usize;
        let mut output = vec![0u8; bound];
        stream.next_in = data.as_ptr() as *mut u8;
        stream.avail_in = input_length;
        stream.next_out = output.as_mut_ptr();
        stream.avail_out = bound as z::uInt;
        let code = z::deflate(&mut stream, z::Z_FINISH);
        let written = stream.total_out as usize;
        z::deflateEnd(&mut stream);
        if code != z::Z_STREAM_END {
            return Err(Error::format(format!("deflate failed ({code})")));
        }
        output.truncate(written);
        Ok(output)
    }
}

unsafe extern "C" fn zalloc(_opaque: z::voidpf, items: z::uInt, size: z::uInt) -> z::voidpf {
    // SAFETY: plain C allocation; zlib frees it through `zfree`.
    unsafe { libc::calloc(items as usize, size as usize) }
}

unsafe extern "C" fn zfree(_opaque: z::voidpf, address: z::voidpf) {
    // SAFETY: `address` came from `zalloc` (calloc) or is null.
    unsafe { libc::free(address) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn compressed_data_inflates_back() {
        let data: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
        let packed = compress(&data).unwrap();
        assert_eq!(&packed[..2], &[0x78, 0x01]);
        let mut unpacked = Vec::new();
        flate2::read::ZlibDecoder::new(packed.as_slice()).read_to_end(&mut unpacked).unwrap();
        assert_eq!(unpacked, data);
    }
}
