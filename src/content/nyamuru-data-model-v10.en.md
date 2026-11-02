# Nyamuru Data Model (NDM) v10.33 / Open Manga Name YAML (OMNY) Quick Guide

The **Nyamuru Data Model (NDM)** is a data model that defines the structure of a manga *name* (storyboard): panel layout, characters, speech balloons, and asset references. Its nickname is **Nyamuru🐱**.

**Open Manga Name YAML (OMNY)** is the serialization format for saving and exchanging NDM as YAML.

**Open Manga Artwork YAML (OMAY)** is the artwork-instruction file shown in the UI as “Style OMNY.” It holds the drawing and staging rules shared by every panel (`style_notes`) and the layout specification (`layout_spec`) for drawing Story OMNY as finished manga; its `spec_name` / `spec_version` correspond to the OMNY's `schema_name` / `schema_version`. Set Style OMNY in the image-generation project's instructions, then pass Story OMNY for each work.

## 1. Overall structure

The root is always `manga`. It gathers work metadata, setting, characters, assets, and pages into a single document.

```yaml
manga:
  schema_name: "Nyamuru Data Model"
  schema_version: 10.33
  meta: { ... }
  layout_spec: |
    # Description of the A4 coordinate system
  series_setting: { ... }
  setting: { ... }
  characters: [ ... ]
  materials: [ ... ]
  pages:
    - page: 1
      canvas: { w: 210, h: 297, unit: mm }
      panels: [ ... ]
      page_overlay: { ... } # Optional foreground spanning multiple panels
```

| Field | Rule |
|---|---|
| `schema_name` | NDM's formal identifier, fixed to `"Nyamuru Data Model"`. No emoji |
| `schema_version` | The current NDM schema version, `10.33` |
| `meta.document_type` | `"story"` for an ordinary manga storyboard or `"series-catalog"` for a reusable character/material catalog |
| `meta.series` | Work title (series title, optional); identifies the reusable series-material catalog |
| `meta.series_id` | Stable ID that keeps identifying the same series catalog after a rename (optional) |
| `meta.title` | Subtitle (the title of this episode, optional) |
| `meta.episode_id` | Stable ID that keeps identifying the same episode after title or episode-label edits (optional) |
| `meta.author` | Author name (optional). If set, it is drawn small in the footer at the bottom center of each page; if empty, nothing is drawn |
| `meta.page_count` | Must match the actual length of the `pages` array |
| `meta.format` | Finished-image output format, for example `"カラー漫画"`, `"モノクロ漫画"`, or `"グレースケール漫画"` |
| `meta.reading_direction` | Fixed to `"right-to-left"` |
| `meta.text_orientation` | Fixed to `"vertical"` |
| `meta.font` | Default typeface for the work, for example `"アンチック体"` |
| `meta.bubble_line_width_mm` | Default body and tail line width for newly created balloons, in millimeters |
| `meta.panel_frame_width_mm` | Panel-frame width in millimeters |
| `meta.panel_gutter_row_mm` | Gap between vertically adjacent panels in millimeters |
| `meta.panel_gutter_column_mm` | Gap between horizontally adjacent panels in millimeters |
| `meta.style_notes` | Drawing and staging rules kept in the editor document. Story OMNY omits them; Style OMNY stores them |
| `layout_spec` | Layout rules kept in the editor document. Story OMNY omits them; Style OMNY stores them |
| `series_setting` | Series genre, target audience, adult-content flag, and world context loaded from the series catalog |
| `setting` | Location, time, weather, and synopsis specific to this episode; do not merge it with `series_setting.situation` |

## 2. Pages and panels

- `page.paint_layer_sequence` is the last allocated work-layer number on this page (optional nonnegative integer). New raster and vector work layers are named “レイヤー N”, sharing the page sequence across panels and paint owners. Renaming or deleting layers does not reuse gaps; another page starts at 1.

- `canvas` is A4 portrait as a rule: **210 × 297 mm**.
- `panels` holds at most 10 panels per page.
- Array order and `id` follow reading order, from top right to bottom left.
- `shape.type` is `rect` or `polygon`.
- `bg` is required and is `-1` / `0` / `1` / `2`. At most 2 panels per page may use `2` (`-1` does not count toward this limit).
- `bg: -1` means no background art (a single flat mid-gray fill only, with no contact shadow). Use it only for panels specified in the request; never select it automatically as a staging choice.
- `paintStack.below` refers to the target `layerId` as `layer:<id>` and places work immediately below it. `paintStack.beforePanel` refers to a panel identity in the same format and places work outside, above its bar. Reordering preserves identity; deleting an anchor leaves the work at the root of its current scope.
- Paint layers and user folders can move between page, panel, character, and text owners regardless of their creation location. Preserve layer IDs, names, and page coordinates, and apply the destination folder and clip. An owner whose layers have all moved away retains an empty paint document with `guideInitialized: true`, suppressing guide recreation.
- A layer’s `folderId` and a folder’s `parentFolderId` identify its direct parent in the same paint document. Omit them for root entries. The `layers` array stores bottom-to-top drawing order. A folder’s `position` records the index of its first descendant layer or the insertion boundary for an empty folder. Sibling folders at the same position follow the order of the `folders` array.
- A generation mask is an ordinary raster `PaintLayer` with `generationMask: true` and no children. Its `strokes`, visibility, opacity, lock, order, folder membership, movement and persistence use the same paths as other paint layers; its eye toggles only that layer. Normal artwork exports omit it. Generation bounds use the actual alpha extent of visible mask layers, and explicitly selected correction references include the chosen mask. Generated images are added at the top of the target folder and can move independently of native text visibility and locks.
- `background_description` is optional. It describes location, composition, perspective, light, and emotional effects for the background layer only, without characters. Do not use it with `bg: -1`.
- `bleed` declares full-bleed (edge-to-edge) panel edges (optional; an array of `left` / `right` / `top` / `bottom`). Declared edges must also reach the paper edge in coordinates (left = `x: 0`, right = `x + w = 210`, top = `y: 0`, bottom = `y + h = 297`). Rect panels only. A panel declaring `top` is drawn behind the header band, and the header text is layered on top of the panel art.
- `no_figures: true` declares an intentionally figure-less panel (optional). Attach it to panels that draw no characters at all; do not combine it with `figures`.
- `screen_text` is an array of non-balloon text on screens, signs, and paper surfaces (optional). Each entry has `text` (required), `bbox` (optional), and `orientation` (`horizontal` by default / `vertical`).
- `layer` is optional editor layer state. `hidden` controls panel content visibility, `frameHidden` controls the frame stroke, `locked` prevents moving or reshaping the panel frame on the canvas, and `artOrder` stores the artwork stack. Locking never deletes content or coordinates.

- Text numbering and reading order follow the `bubbles` array. The initial layer list uses ascending numbers; later moves are saved bottom-to-top as `bubble:<layerId>` entries in `layer.artOrder`. Page foreground uses `page.layer.artOrder`. Text moves stay within the same associated-figure and `lettering_depth` group, preserving its position relative to the figure.

### Page foreground spanning multiple panels

Place figures, objects, and balloons that do not belong to one panel in the optional page-level `page_overlay` field.

```yaml
page_overlay:
  frame: false
  layer: above_panel_frames
  figures:
    - name: "Character name"
      action: "Spreads both arms and looks toward screen-right"
      bbox: { x: 45, y: 35, w: 120, h: 220 }
      size: full
  bubbles:
    - text: "Dialogue spanning multiple panels"
      speaker: "Character name"
      shape: normal
      bbox: { x: 160, y: 20, w: 35, h: 60 }
```

- `frame` is fixed to `false`; `layer` is fixed to `above_panel_frames`.
- Do not count `page_overlay` as a panel and do not draw an enclosing frame.
- Clip panel artwork and text to the panel shape, then draw the frame. Draw the page foreground once above panel frames. Work layers follow their saved insertion positions: layers below a frame cover panel text; layers above a panel bar sit above frames and behind the page foreground. Within a text folder, `aboveNative` places paint in front of or behind the native text, with folder values applying to their children.
- Bboxes are absolute page coordinates. Do not use panel-relative `anchor` fields here.
- Ordinary panel-local content remains in `panels[].figures` / `panels[].bubbles`.

### Panel shapes

```yaml
# Rectangular panel
shape: { type: rect, x: 10, y: 10, w: 190, h: 80 }

# Polygon / diagonal cut
shape:
  type: polygon
  points: [[200, 95], [200, 170], [105, 170], [115, 95]]
```

## 3. Absolute A4 coordinates

- The origin `(0, 0)` is the top-left corner of the paper.
- x runs rightward, y runs downward, and the unit is mm.
- `figures[].bbox` and `bubbles[].bbox` are also **absolute coordinates on the whole page**, not panel-local coordinates.
- Bboxes inside `page_overlay` use the same absolute page coordinates and do not take an `anchor`.
- `anchor` expresses a position relative to the panel and takes precedence over bbox.
- Speech balloons must not intersect the face zone — the top third of a character's bbox.
- Composition precedence is `panels[].action` > `anchor` > speaking order = standing position > `size` > `bbox` (a transcription of the precedence table in the OMAY's `layout_spec`). `figures[].action` applies only to the named person's expression, pose, gaze, and movement.

## 4. Characters and character placement

`characters` can hold per-character settings used for series matching and generation as well as the names used in panels.

```yaml
characters:
  - name: "Character name"
    role: "Persona or story role"
    gender: neutral
    visual_prompt: "Appearance and drawing instructions for image generation"
    scope: series
    catalog_id: "character-..."
    aliases: ["Short name used in rough storyboards"]
    default_proportion: { head_count: 4 }
    primary_material_catalog_id: "material-..."
    recognition:
      hair: { observed: ["short bob"], inferred: [] }
      face: { observed: [], inferred: [] }
      silhouette: { observed: ["flared dress silhouette"], inferred: [] }
      outfit: { observed: ["high-neck long sleeves under a sleeveless dress"], inferred: [] }
      accessories: { observed: ["wide headband"], inferred: [] }
      ambiguous_design: { observed: [], inferred: ["the collar shape is unclear in the side view"] }
```

- `scope` is `episode` (this episode only) or `series` (shared across the series). Omission is treated as `episode`.
- `catalog_id` is the stable ID of a series character and remains unchanged when the display name changes.
- `aliases` lists rough-storyboard abbreviations and other names that may identify the same character.
- `role` describes personality and story role. It is excluded from the character image-generation prompt.
- `gender` is an optional human-specified attribute: `female`, `male`, or `neutral`. Preserve an omitted value as unset; do not infer it from a name or appearance. English pronouns and verbs follow this value, with singular they used only during generation when it is unset. Do not rewrite character settings or visual instructions, or duplicate the attribute in `figures`.
- `visual_prompt` preserves human-authored appearance and drawing instructions. Character image generation translates it into English together with the work's art style and the selected figure's performance instructions.
- `default_proportion.head_count` is a human-set per-character proportion of at least 1, with no upper limit; image analysis does not decide it.
- `recognition` separates `observed` image facts from `inferred` items that need confirmation. Do not store expressions, temporary poses, or drawing style as fixed character traits.
- `primary_material_catalog_id` identifies the representative character material.

Panel-specific coverage and performance go in `figures`.

```yaml
figures:
  - name: "Character name"
    action: "Shrugs and looks away from the other character"
    bbox: { x: 30, y: 22, w: 55, h: 62 }
    anchor: left
    size: waist-up
```

- `name` must match a `characters[].name` (a person) or a `materials[].key` (an object).
- **`figures` is not person-only** — props and other objects can also be placed with coordinates via figures. Objects declare `object: true`, take no `size` / `role`, and are placed with `bbox` / `anchor`. The face zone and the centering default apply only to person figures (those without `object`).
- `size` is `long` / `full` / `knee-up` / `waist-up` / `bust-up` / `shoulder-up` / `face` / `face-detail` / `hand` / `foot` / `part`. long includes the surroundings; full shows the entire body; knee-up/waist-up/bust-up/shoulder-up show from the head to the knees/waist/chest/shoulders; face shows the face; face-detail shows a detail of the face. The hand/foot/part values draw only a body part (and carry no face zone).
- `role` is `main` (default) / `sub`. It declares the figure's role and does not prescribe placement — a `sub` figure is a supporting character exempt from the centering default, and its placement follows the `bbox` / `anchor` declarations. Figure placement follows the placement-intent priority order: 1. declared staging intent (`anchor` / `bbox`) > 2. declared role and coverage (`role` / `size` / `no_figures`) > 3. the centering default (`main` figures placed large at panel center).
- `action` is the image-generation instruction for that person alone. It may describe expression, pose, gaze, body direction, limb movement, and contact, but not background, camera, or art style. Do not attach it to an object (`object: true`).
- A voice from outside the panel does not go into `figures`; instead its balloon gets `offscreen: true`.

## 5. Speech balloons

Dialogue always goes into the `bubbles` array. `text` is required.

`bubbles[].line_width_mm` sets an individual balloon body and tail width in millimeters (a finite number greater than zero). When omitted, `meta.bubble_line_width_mm` supplies the default. Changing the default in the editor preserves the appearance of existing balloons by assigning their inherited width explicitly. The pen width palette edits only the selected balloon and converts pixels using the document DPI.

```yaml
bubbles:
  - text: "Dialogue"
    speaker: "Character name"
    shape: normal
    bbox: { x: 145, y: 20, w: 35, h: 35 }
    tail: { x: 0.5, y: 0.35 }
```

The following 15 `shape` values are available.

| shape | Use |
|---|---|
| `normal` | Standard oval for initial dialogue and monologue placement. Default when omitted |
| `thought` | Explicit cloud-shaped treatment for inner voices, imagination, or dreams |
| `square` | Rectangle for initial narration placement; also available as an explicit stylistic choice |
| `caption` | Narration, time, and place descriptions |
| `flash` | Shouting, strong surprise |
| `uniflash` | Maximum-intensity screams and shocks |
| `wobbly` | Weak voice, fear, exhaustion |
| `whisper` | Whispering |
| `handwritten` | Sound effects, hand-drawn text |
| `typeset` | Typeset text without an outline; original images and painted layers retain the same owner |
| `critical` / `tense` / `toge` / `announce` / `toge_natural` | Author-defined material classes. Select by comparing the samples with the scene, dialogue, and expression |

The material class `nomal` maps to `shape: normal`. Selecting a material saves its class as `shape` and its editable outline as `bezier`. For the five author-defined classes above, omitting `bezier` uses the first material in that class.

Initial placement from a text plot stores dialogue and monologue as `shape: normal` with an editable ellipse in `bezier`, and narration as `shape: square` with a rectangle in `bezier` and `tail: false`. Inner voices also retain `monologue: true`. Relinking source text preserves edited outlines and tails.

- Inner voices get `monologue: true`, and parentheses "（）" are removed from `text`.
- Voices from outside the panel get `offscreen: true` (the speaker is off-panel: their figure is not drawn and the balloon gets no tail; still spell out `speaker`).
- `tail: { x, y }` locates the tail tip relative to the speaker figure's `bbox` (top-left 0, bottom-right 1; values outside 0–1 are allowed). Use an appropriate short length pointing toward the mouth; the tip need not reach the mouth. Omission targets the figure center for ordinary shapes; `tail: false` draws no tail. `square`, `caption`, `flash`, `uniflash`, `handwritten`, and `typeset` omit tails by default.
- `tail_root: { x, y }` locates the root direction relative to the bubble `bbox` (top-left 0, bottom-right 1; finite values outside this range are allowed). When omitted, the root follows the tip direction. Root and tip can be moved independently on the canvas.
- An ordinary tail remains a separate white surface with two open side outlines; only its opening masks the body outline. The body `bezier`, root `tail_root`, and tip `tail` are stored independently and are never permanently united into one body path.
- A tailed `shape: thought` balloon uses two or three vertically elongated beads that shrink away from the balloon body.
- `speaker` identifies the character associated with the text. For dialogue, include the speaker on every balloon. Handwritten lettering may optionally associate its meaning or nuance with a character; this does not imply speech, a tail, or speaking order. Omit it when no character is associated.
- `lettering_depth` sets handwritten lettering in `front` of or `behind` its associated character; omission means `front`. Place the lettering group immediately above or below a unique character placement in the same panel or page foreground. The layer list displays the same rendering order; dragging the lettering group or its associated character above or below the other updates this value. Behind lettering, its painted additions, and linked original are occluded by the character without changing text, coordinates, or reading order. If the character placement is absent or ambiguous, retain the setting and keep the front display. Clearing the character association also clears the depth setting.
- `join_to` is the 1-based number of an earlier balloon in the same `bubbles` array to join. It is independent from the speaker; point multiple balloons to the same number for a chain of three or more.
- `shape: typeset` retains text and `text_position` without drawing an outline, tail, or connector. Its `analogTextImport` original reference and `paint_overlay` retain the same owner. T creates entries in `screen_text`; category changes use `normal`, `handwritten`, or `typeset` on the same `bubbles` entry, preserving text, formatting, position, and original images. Optional `text_style.lineHeight` retains line advance relative to font size (0.5–3); omission uses the renderer default.
- Optional `lettering_pen` selects one pen ID from `src/content/handwritten-styles.json`; optional `lettering_expressions` lists expression IDs without duplicates. While the text tool is active and handwritten text is selected, the controls appear below the associated character: a single pen selection and multiple expression selections. Unspecified options add no generation instructions. Fixed English is passed to individual, correction, panel and page generation; combined generation retains each panel/foreground and text number.
- `shape: handwritten` is editable and generatable as hand-drawn lettering in the panel inspector. `text` is the literal text to draw; optional `lettering_description` describes its shapes, strokes, energy, and texture. Individual balloon generation is available only for handwritten lettering, never for balloon outlines. Generated images are added as new layers of the same owner, preserving the original text, guides, layers, and visibility. Optional `lettering_guide_hidden: true` hides only the editable text guide, independently of painted results; omission shows the guide. Individual generation receives the literal lettering text, its drawing description, text direction, lettering rules, and output bounds. Character names, gender, expressions, relative character placement, depth, and general character styling are excluded.
- `text_position: { x, y }` locates the center of the balloon text in finite coordinates relative to its `bbox`, with 0 at the top-left and 1 at the bottom-right. Values below 0 or above 1 are allowed; expanding the Bézier outline does not change this reference frame. It defaults to `{ x: 0.5, y: 0.5 }`. Clicking the text edits it; dragging its blue selection frame moves only the text, independently of the outline.
- Separate multiple emphasized phrases in `emphasis` with ASCII commas.
- `bezier: { nodes: [...] }` defines an editable closed cubic outline. List 3–128 nodes in contour order, each as `{ x, y, handleIn?: { x, y }, handleOut?: { x, y } }`. Anchor coordinates use the balloon `bbox` as a 0–100 reference; handles are vectors relative to their anchor. Anchors and absolute handle endpoints may use finite coordinates outside this range. Outline edits do not automatically move or resize the reference frame, source artwork, or text. The final node connects back to the first. A valid `bezier` supplies the contour, while `shape` supplies text padding, line style, and tail defaults. Text, speaker, and placement remain in their usual fields.
- A panel-owned balloon always clips its outline, painted additions, tail, and text to the owning panel shape. The balloon itself may be moved beyond the panel, but only the part inside the panel is visible; the text is not automatically recentered inside the visible fragment. Use `text_position` to move only the text when needed. Page-overlay balloons are not panel-clipped.
- `clip_to_panel` remains accepted as a boolean only for loading older saved data and no longer controls presentation. Omit it in new data.
- `caption` and `handwritten` may also carry an associated character. Omit `speaker` for narration or sound effects that belong to no particular character.

## 6. Asset references

Register characters, backgrounds, and props in `materials`, then reference their `key` from each panel's `assets`.

```yaml
materials:
  - key: "Character asset"
    type: character
    scope: series
    catalog_id: "material-..."
    character_catalog_id: "character-..."
    view: turnaround
    origin: { episode_id: "e2f4...", episode_title: "Episode title", episode_number: "Episode 1" }
    keywords: ["Character name", "standing art"]
    note: "Key points of the look"

pages:
  - panels:
      - id: 1
        assets: ["Character asset"]
```

`type` is one of `character` / `background` / `prop`. `scope` is either `episode` (episode-only) or `series` (shared across the series). `keywords` is an array of strings used to search for asset files. A series material's `catalog_id` tracks the same item across name changes. For character materials, `character_catalog_id` identifies the corresponding series character, and `view` is one of `turnaround` / `front` / `three-quarter` / `side` / `back` / `expression` / `costume` / `other`. `origin` records the internal episode ID, title, and episode number where the material was first registered.

A Series Catalog OMNY uses `meta.document_type: "series-catalog"`, `meta.page_count: 0`, and `pages: []`, and stores the series classification, world context, series-scoped characters, and series-scoped materials. `series_setting` contains genre, target audience, the adult-content flag, and world context; `setting` contains the setting and situation of the current episode. When a legacy series reference explicitly provides a location, time, or weather, new creation uses it only as the initial value of an empty episode field; every episode can still edit those values. `meta.format` independently retains the finished-image output format. A local character-reference image is retained only in the series catalog in the following form and is omitted from ordinary Story OMNY output.

```yaml
source_image:
  schema_version: 1
  asset_id: "image-<sha256>"
  file_name: "characters/character-.../image-<sha256>.png"
  original_name: "character-reference.jpeg"
  media_type: "image/png"
  byte_size: 123456
  width_px: 1946
  height_px: 1807
  sha256: "64-character hexadecimal SHA-256"
```

`file_name` is relative to the series storage directory, while `original_name` is the selected file name displayed in the UI. Absolute paths, `..`, and backslashes are not permitted. Selecting an image does not analyze it. An explicit local-analysis action compares all registered references for the same character and proposes traits supported across images, plus stable traits visible only from a complementary view. It also classifies each image's `view` from that comparison, and the user can correct it afterward.

Before registering a character reference, check the selected image’s width and height. If either exceeds its limit, reject the image and let the user resize the source and select it again. A dimension equal to its limit is allowed. Nyamuru does not automatically resize or overwrite the source file. `width_px` and `height_px` describe the registered PNG’s actual pixel dimensions, independently of its display size.

## 7. Full panel example

```yaml
- id: 1
  shape: { type: rect, x: 10, y: 10, w: 190, h: 80 }
  bg: 1
  figures:
    - name: "Character name"
      bbox: { x: 30, y: 22, w: 55, h: 62 }
      anchor: left
      size: waist-up
  assets: ["Character asset"]
  bubbles:
    - text: "Dialogue"
      speaker: "Character name"
      shape: normal
      bbox: { x: 145, y: 20, w: 35, h: 35 }
      anchor: top-right
  action: "Turns around with a smile"
```

## 8. Commented empty template for 2 pages

Below is an empty OMNY template for two pages. You can add the work metadata and panels you need. Lines starting with `#` are explanatory comments; the file still loads as OMNY with them left in.

```yaml
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 sa-san10
# Nyamuru Data Model (NDM) v10.33 serialized as Open Manga Name YAML (OMNY)
# Nickname: Nyamuru🐱

# Root of an OMNY document. All information about the work goes inside
manga:
  # NDM's formal identifier. No emoji; never change this value
  schema_name: "Nyamuru Data Model"

  # Version of the NDM schema in use
  schema_version: 10.33

  # Basic information about the whole work
  meta:
    # Document kind. Ordinary manga storyboards use story
    document_type: "story"
    # Work title (optional)
    title: "Work title"
    # Series name and stable internal ID (optional)
    series: ""
    series_id: ""
    # Episode label and stable internal ID (optional)
    episode_number: ""
    episode_id: ""
    # Author name (optional). Drawn in the footer at the bottom center of each page; hidden if empty
    author: ""
    # Output format of the manga
    format: "Color manga"
    # Must match the actual number of pages. This template has 2 pages
    page_count: 2
    # Reading direction for right-bound manga. Fixed value
    reading_direction: "right-to-left"
    # Text direction for dialogue. Fixed value
    text_orientation: "vertical"
    # Typeface shared by all manga text in this work
    font: "アンチック体"
    # Balloon width, panel-frame width, and vertical/horizontal panel gaps (mm)
    bubble_line_width_mm: 0.5
    panel_frame_width_mm: 1
    panel_gutter_row_mm: 5
    panel_gutter_column_mm: 3
    # Style OMNY drawing and staging rules retained inside the editor document
    style_notes: []

  # Style OMNY layout rules retained inside the editor document
  # For multiple lines, replace the empty string with | and indent from the next line
  layout_spec: ""

  # Series classification and world context
  series_setting:
    genre: ""             # Example: science fiction and fantasy
    target_audience: ""   # Example: shonen and shojo
    adult_content: false  # true for adult-rated content
    situation: ""

  # Setting and situation for this episode
  setting:
    # Main location
    location: ""
    # Time of day or era
    time: ""
    # Weather
    weather: ""
    # Summary of what happens in this work
    situation: ""

  # Cast. scope is episode/series; a series character may retain a catalog ID, aliases, base proportion, and matching traits
  characters: []

  # Reference assets. Each entry has key, type, scope, keywords, and an optional note
  # type is one of character / background / prop
  # scope is either episode (episode-only) or series (shared across the series)
  # A series entry may use catalog_id and origin to track the same material and its source episode
  # Character materials link through character_catalog_id; image references are stored only in Series Catalog OMNY
  materials: []

  # Array of manga pages. Order must match the page numbers
  pages:
    # Page 1
    - page: 1
      # Paper size: A4 portrait width, height, and unit
      canvas: { w: 210, h: 297, unit: mm }
      # Add panels in reading order from top right to bottom left. At most 10 panels per page
      # Each panel gets id, shape, bg, bubbles, action, and so on
      panels: []

    # Page 2
    - page: 2
      # All pages use the same absolute A4 coordinate system
      canvas: { w: 210, h: 297, unit: mm }
      # An empty page with no panels or content yet
      panels: []
```
