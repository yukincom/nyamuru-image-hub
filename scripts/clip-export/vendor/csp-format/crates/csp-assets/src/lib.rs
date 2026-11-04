//! Read and write CLIP STUDIO PAINT's files other than canvases: sub tools
//! (`.sut`, `EditImageTool.todb`), auto actions (`.las`, `.laf`), colour
//! sets (`.cls`), gradient sets (`.sgs`), shortcut settings, material
//! folders and the envelope of encrypted material data. Canvases (.clip,
//! .cmc) are in the `csp-format` crate.
//!
//! Requirements and validation are in the repository's `docs/assets/`.
//! Encrypted payloads are kept as bytes and never decrypted. Files are
//! read into memory and never changed; parsing then writing an unchanged
//! file gives the same bytes. This crate is not made or endorsed by CELSYS.
//!
//! ```no_run
//! use csp_assets::subtool::SubToolDb;
//!
//! let db = SubToolDb::open("G-pen.sut")?;
//! for entry in db.sub_tools() {
//!     let node = &db.nodes[entry.node];
//!     println!("{}/{} ({:?})", entry.path.join("/"), node.name, node.kind());
//! }
//! # Ok::<(), csp_assets::Error>(())
//! ```
//!
//! ```
//! use csp_assets::colorset::{Color, ColorSet};
//!
//! let set = ColorSet::new("skin", vec![Color::new([250, 220, 200, 255], Some("light"))]);
//! let read = ColorSet::parse(&set.to_bytes())?;
//! assert_eq!(read.name, "skin");
//! assert_eq!(read.colors[0].rgba, [250, 220, 200, 255]);
//! # Ok::<(), csp_assets::Error>(())
//! ```
//!
//! Which module reads a file is told by [`kind::detect`].

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod action;
pub mod c2f;
pub mod colorset;
pub mod error;
pub mod gradient;
pub mod kind;
pub mod material;
pub mod serial;
pub mod shortcut;
pub mod subtool;
pub mod tar;
#[doc(hidden)]
pub mod testing;

pub use error::{Error, Result};
