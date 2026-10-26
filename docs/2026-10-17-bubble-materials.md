# Bubble materials

Comic Image Hub keeps the hand-drawn speech-bubble material catalog in `src/assets/materials/bubbles/`.

```text
src/assets/materials/bubbles/
├── paths.json
├── kumo/
├── announce/
├── critical/
├── nomal/
├── tense/
├── toge/
└── toge_natural/
```

The six VectorCraft folders preserve the source layer identifiers. `nomal` is intentionally kept as written in the VectorCraft source. `kumo/` contains the author's seven recovered cloud outlines (`kumo_01`–`kumo_07`) as byte-identical SVG copies. Each SVG contains one white-backed outline. Its `width`, `height`, and `viewBox` describe the artwork bounds; `paths.json` records all 45 materials, their source layer, material ID, SVG path, and normalized editable Bezier nodes.

The complete chooser presents the seven `kumo` materials in the 「雲形」category before the other 38 VectorCraft materials. The unrelated assistant-made `thought/thought_01.svg` is not part of the catalog.

`src/lib/bubblePresetCatalog.ts` resolves the exact SVG contours. Choosing a thumbnail writes a normalized editable outline into the existing bubble model. It leaves the bubble text, size, position, tail, and join settings intact, and the existing canvas renderer draws the outline. The material chooser uses each SVG as a shape mask over a gray tile and selection frame, with white bubble fill, emphasized black bubble outline, and white labels so silhouettes remain visible at thumbnail size; those display-only styles do not modify the SVG originals or inherit a source-only fill color.

Focused catalog checks:

```sh
node --test tests/bubblePresetCatalog.test.mjs
```

The original VectorCraft document is not part of the runtime catalog; the files here are the app's bundled materials.
