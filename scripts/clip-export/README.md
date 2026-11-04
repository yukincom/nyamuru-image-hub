# CLIP export adapter

The encoder is copied from these MIT-licensed versions:

- Name Studio: `9ff110d7b8ee9a6e1113769a8c64eb0353ab9801`
  <https://github.com/nanikasheila/name-studio/tree/9ff110d7b8ee9a6e1113769a8c64eb0353ab9801>
- csp-format: `aaa4e3a0cf6080d780a652a40d236d28e5df59a9`
  <https://github.com/nanikasheila/csp-format/tree/aaa4e3a0cf6080d780a652a40d236d28e5df59a9>

The source, manifests, tests, licenses, and built-in CSP templates are kept under
`vendor/`. `UPSTREAM.json` records every original SHA-256. The later GPL release
of Name Studio is not included.

Only five visibility declarations in clip-core differ: `write::layers`,
`set_layer_mask`, `prepare_for`, `add_text_layer`, and `add_vector_layer` change
from `pub(crate)` to `pub`. Their bodies, names, and all other source are
unchanged. This lets the adapter place local raster images and layer properties
directly, without inflating every raster to a whole-page input or rewriting the
text/vector encoders. `tests/clipExport.test.mjs` verifies the complete copy.

`src/main.rs` receives a `nyamuru-clip-v1` JSON page on stdin and returns a CLIP
file on stdout. It calls the original text/vector/mask writers and csp-format's
layer APIs. Source files, fonts and input paths are not opened by the adapter.
Raster and mask input is embedded PNG; mask coverage is its alpha channel.
The optional `--inspect` mode reads a CLIP file from stdin for verification.

Build with `npm run setup:clip` from the project root (Rust 1.88+ and a C
compiler). Set `NYAMURU_CARGO` if cargo is not on PATH. The executable and build
cache stay in the project's ignored `.local-clip-export/`; the running bridge
does not invoke a compiler or need a Rust installation.

The built-in templates' provenance is retained in
`vendor/name-studio/docs/builtin-template.md`. The generated file has a separate
white paper layer; hiding that layer exposes the authored alpha. Unsupported
typography/brush appearance is handled by the frontend's visible raster plus
hidden editable source, with the original data included in the export package.
