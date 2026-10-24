# Bubble materials

Comic Image Hub keeps the hand-drawn speech-bubble material catalog in `src/assets/materials/bubbles/`.

```text
src/assets/materials/bubbles/
├── paths.json
├── announce/
├── critical/
├── nomal/
├── tense/
├── toge/
└── toge_natural/
```

The six folders preserve the source layer identifiers. `nomal` is intentionally kept as written in the VectorCraft source. Each SVG contains one tightly cropped white-backed outline. Its `width`, `height`, and `viewBox` describe the artwork bounds; `paths.json` records the source layer, material ID, SVG path, and normalized editable Bezier nodes.

`src/lib/bubblePresetCatalog.ts` loads the JSON records and resolves SVG previews from this directory. `BubbleBezierEditor` presents the 38 materials as thumbnails. The existing panel and page-overlay inspectors both use this editor, so choosing a thumbnail writes the editable outline into the existing bubble model. It leaves the bubble's shape and tail settings intact, and the existing canvas renderer draws the outline.

Focused catalog checks:

```sh
node --test tests/bubblePresetCatalog.test.mjs
```

The original VectorCraft document is not part of the runtime catalog; the files here are the app's bundled materials.
