//! Raster pixels: csp-format decodes the offscreens (256x256 zlib blocks)
//! and keeps their geometry; this module names what the tool uses of it.

pub use csp_format::RgbaImage;
pub use csp_format::offscreen::Parameter as OffscreenParameters;

/// The geometry and channel layout of an `Offscreen.Attribute` blob.
pub fn parameters(attribute: &[u8]) -> crate::Result<OffscreenParameters> {
    Ok(csp_format::offscreen::Attribute::parse(attribute)?.parameter()?)
}
