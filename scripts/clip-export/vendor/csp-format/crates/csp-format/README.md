# csp-format

Read, verify and write CLIP STUDIO PAINT files: canvases (`.clip`) and
multi-page works (`.cmc`).

The format is not published. This crate was written from observing real
files, and every rule in it was checked against them (719 files from CSP
versions of 2017 to 2026, and files made in CLIP STUDIO PAINT EX for each
feature). The specification and the validation records are in the
[repository](https://github.com/nanikasheila/csp-format).

Not made or endorsed by CELSYS. CLIP STUDIO PAINT is a trademark of CELSYS, Inc.

## What it does

- The container, the embedded SQLite database (every table) and its schema
  registry; saving an unchanged file gives the same bytes.
- The layer tree and canvas settings; raster pixels (colour, gray, 1-bit,
  masks, mipmaps) to and from RGBA, compressed exactly as CSP does; vector
  data; text layers; layer effects; tone, gradient, correction and image
  material layers; animation timelines, cels, keyframes and the 2D camera.
- `.cmc` page lists: reading order, adding, removing and moving pages.
- Writing: new canvases and works, adding and removing layers and folders,
  changing pixels, names, opacity, blend mode, visibility and clipping,
  copying layers between files. Files written this way open in CSP.
- Rendering the layers into an image (blend modes, clipping, masks,
  effects, corrections, gradients, vector lines), and a self-check of every
  part of a file.

What is approximate or not drawn (vector line shapes, text CSP did not
render, some effects, 3D) is listed in the
[specification](https://github.com/nanikasheila/csp-format/blob/main/docs/spec/README.md#未解明の項目).
Validation records: [docs/validation/](https://github.com/nanikasheila/csp-format/blob/main/docs/validation/).

## Example

```rust
use csp_format::ClipFile;

let file = ClipFile::open("page0001.clip")?;
for (layer, depth) in file.layers.flatten() {
    println!("{}{} ({})", "  ".repeat(depth), layer.name, layer.kind.name());
    if let Some((image, (x, y))) = file.layer_pixels(layer)? {
        std::fs::write(format!("{}.png", layer.main_id), image.to_png()?)?;
    }
}
file.save("copy.clip")?; // byte-identical while nothing was changed
```

More in the [API documentation](https://docs.rs/csp-format) and in
[`examples/`](https://github.com/nanikasheila/csp-format/blob/main/crates/csp-format/examples/). The `cspf` crate is a command line tool built on
this one; `csp-assets` reads CSP's other files (sub tools, auto actions,
colour and gradient sets, materials).

Building needs a C compiler: SQLite and zlib are compiled in (zlib must be
the reference C library to reproduce CSP's compressed bytes).

`ClipFile::save` replaces the path it is given, even the file that was
opened; keeping the input intact is the caller's job.

## License

MIT (see `LICENSE`)
