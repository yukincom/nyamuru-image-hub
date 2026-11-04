//! Read, verify and write CLIP STUDIO PAINT files (.clip / .cmc).
//!
//! The format is not published; everything here was learnt from real files
//! and is written down in the repository's `docs/spec/`. Input files are
//! never modified: files are read into memory, and changes are written only
//! by an explicit save. This crate is not made or endorsed by CELSYS.
//!
//! # Reading
//!
//! [`ClipFile`] opens a .clip: the canvas settings, the layer tree, every
//! table of the embedded SQLite database, and the pixels, vectors and texts
//! of the layers. [`CmcFile`] opens a .cmc (a multi-page work) and lists its
//! pages in reading order.
//!
//! ```no_run
//! use csp_format::{ClipFile, CmcFile};
//!
//! let file = ClipFile::open("page0001.clip")?;
//! for (layer, depth) in file.layers.flatten() {
//!     println!("{}{} ({})", "  ".repeat(depth), layer.name, layer.kind.name());
//!     if let Some((image, (x, y))) = file.layer_pixels(layer)? {
//!         println!("  {}x{} px at ({x}, {y})", image.width, image.height);
//!     }
//! }
//!
//! let work = CmcFile::open("work.cmc")?;
//! for path in work.page_paths(std::path::Path::new("."))? {
//!     println!("{}", path.display());
//! }
//! # Ok::<(), csp_format::Error>(())
//! ```
//!
//! # Writing
//!
//! A file saved without changes is byte-identical to the input. Changes go
//! through [`ClipFile`]'s methods ([`edit`]) or straight into its database;
//! new canvases and works are made with [`NewCanvas`] and [`NewWork`].
//!
//! ```
//! use csp_format::{ClipFile, LayerKind, NewCanvas, RgbaImage};
//!
//! let mut file = ClipFile::create(&NewCanvas { width: 640, height: 480, ..NewCanvas::default() })?;
//! let mut image = RgbaImage::new(64, 64);
//! image.fill([200, 30, 30, 255]);
//! let id = file.add_raster_layer("red square", &image, (10, 20))?;
//! file.set_layer_opacity(id, 0.5)?;
//!
//! let reopened = ClipFile::from_bytes(file.to_bytes()?)?;
//! let layer = reopened.layers.get(id).unwrap();
//! assert_eq!(layer.kind, LayerKind::Raster);
//! let (pixels, (x, y)) = reopened.layer_pixels(layer)?.unwrap();
//! assert_eq!(pixels.pixel((10 - x) as u32, (20 - y) as u32), [200, 30, 30, 255]);
//! assert_eq!(pixels.pixel((9 - x) as u32, (20 - y) as u32)[3], 0);
//! # Ok::<(), csp_format::Error>(())
//! ```
//!
//! # Rendering and checking
//!
//! [`render::render`] composites the layers (blend modes, clipping, masks,
//! effects, corrections, gradients, vectors) into an image, and
//! [`verify::check_clip`] runs every self-check (round trips of each part,
//! references between tables and chunks).
//!
//! # Modules
//!
//! | Area | Modules |
//! |---|---|
//! | Files | [`clip`], [`cmc`], [`container`], [`database`], [`schema`], [`version`] |
//! | Layers | [`model`], [`offscreen`], [`vector`], [`text`], [`gradient`], [`correction`], [`effect`], [`tone`], [`material`] |
//! | Animation | [`animation`], [`cmt`] |
//! | Writing | [`create`], [`edit`], [`copy`], [`work`], [`cmc_pages`], [`blank`], [`story`], [`vector_build`] |
//! | Output | [`render`], [`verify`], [`image`] |
//!
//! Items hidden from these docs are used by the project's investigation
//! tools and are not part of the stable API.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod animation;
#[doc(hidden)]
pub mod binary;
pub mod blank;
pub mod clip;
pub mod cmc;
pub mod cmc_pages;
pub mod cmt;
pub mod container;
pub mod copy;
pub mod correction;
pub mod create;
mod curve;
pub mod database;
pub mod edit;
pub mod effect;
pub mod error;
pub mod gradient;
pub mod image;
pub mod material;
pub mod model;
pub mod offscreen;
pub mod render;
pub mod schema;
pub mod story;
#[doc(hidden)]
pub mod stroke;
pub mod text;
pub mod tone;
pub mod vector;
pub mod vector_build;
pub mod verify;
pub mod version;
pub mod work;
mod zlib;

/// The SQLite binding this crate's database API uses (`rusqlite`), so that
/// callers use the same version.
pub use rusqlite;

pub use clip::ClipFile;
pub use cmc::CmcFile;
pub use create::NewCanvas;
pub use error::{Error, Result};
pub use image::{GrayImage, RgbaImage};
pub use model::{Canvas, Layer, LayerKind, LayerTree};
pub use version::VersionInfo;
pub use work::NewWork;
