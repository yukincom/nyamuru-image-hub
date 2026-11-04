//! JSON summary of .clip / .cmc files, field for field the same as the
//! Python `inspect` command, so the two implementations can be compared.

use std::path::Path;

use serde_json::{Map, Value, json};

use crate::clip::{ClipDocument, ClipLayer, LayerKind};
use crate::cmc::CmcProject;
use crate::error::{CspError, Result};
use crate::vector::BBox;

const TEXT_PREVIEW_LENGTH: usize = 40;

pub fn inspect_file(path: impl AsRef<Path>, include_pixels: bool) -> Result<Value> {
    let path = path.as_ref();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    match extension.as_str() {
        "clip" => inspect_clip(&ClipDocument::read(path)?, include_pixels),
        "cmc" => Ok(inspect_cmc(&CmcProject::read(path)?)),
        _ => Err(CspError::format(format!("Unsupported file type: .{extension}"))),
    }
}

pub fn inspect_cmc(project: &CmcProject) -> Value {
    let page = &project.default_page;
    json!({
        "path": project.path.display().to_string(),
        "internal_version": project.internal_version,
        "story_name": project.story_name,
        "author_name": project.author_name,
        "binding_position": project.binding_position,
        "start_page": project.start_page,
        "has_cover": project.has_cover,
        "max_canvas_file_index": project.max_canvas_file_index,
        "default_page": {
            "unit": page.unit,
            "width": page.width,
            "height": page.height,
            "resolution": page.resolution,
            "is_double_page": page.is_double_page,
            "template_name": page.template_name,
        },
        "pages": project.pages.iter().map(|page| json!({
            "order": page.order,
            "main_id": page.main_id,
            "link_path": page.link_path,
            "file_name": page.file_name,
            "page_flag": page.page_flag,
            "memo": page.memo,
        })).collect::<Vec<_>>(),
        "format": "cmc",
        "page_count": project.pages.len(),
    })
}

pub fn inspect_clip(document: &ClipDocument, include_pixels: bool) -> Result<Value> {
    let canvas = &document.canvas;
    let pair = |value: Option<(i64, i64)>| value.map(|(a, b)| json!([a, b]));
    Ok(json!({
        "format": "clip",
        "path": document.path.display().to_string(),
        "canvas": {
            "width": canvas.width,
            "height": canvas.height,
            "unit": canvas.unit,
            "resolution": canvas.resolution,
            "width_px": canvas.width_px,
            "height_px": canvas.height_px,
            "is_double_page": canvas.is_double_page,
            "crop_size_px": pair(canvas.crop_size_px),
            "basic_size_px": pair(canvas.basic_size_px),
            "basic_offset_px": [canvas.basic_offset_px.0, canvas.basic_offset_px.1],
        },
        "has_preview": document.preview_png.is_some(),
        "layers": document.root.children.iter()
            .map(|layer| layer_summary(document, layer, include_pixels))
            .collect::<Result<Vec<_>>>()?,
    }))
}

fn layer_summary(document: &ClipDocument, layer: &ClipLayer, include_pixels: bool) -> Result<Value> {
    let mut summary = Map::new();
    summary.insert("id".into(), json!(layer.main_id));
    summary.insert("name".into(), json!(layer.name));
    summary.insert("kind".into(), json!(layer.kind.as_str()));
    summary.insert("visible".into(), json!(layer.visible));
    summary.insert(
        "opacity".into(),
        json!((layer.opacity * 10000.0).round_ties_even() / 10000.0),
    );
    summary.insert("composite".into(), json!(layer.composite));
    summary.insert("offset".into(), json!([layer.offset_x, layer.offset_y]));
    summary.insert("clipping".into(), json!(layer.clipping));
    summary.insert("has_mask".into(), json!(layer.has_mask));
    if let Some(text) = &layer.text {
        summary.insert(
            "text".into(),
            json!(text.chars().take(TEXT_PREVIEW_LENGTH).collect::<String>()),
        );
    }
    if layer.kind == LayerKind::Vector {
        let objects = document.vector_objects(layer)?;
        let bbox = union(objects.iter().map(|object| object.bbox));
        summary.insert(
            "vector".into(),
            json!({
                "objects": objects.len(),
                "closed": objects.iter().filter(|object| object.closed()).count(),
                "bbox": shift(bbox, layer),
            }),
        );
    }
    let blocks = document.text_blocks(layer)?;
    if !blocks.is_empty() {
        let blocks: Vec<Value> = blocks
            .iter()
            .map(|block| json!({"bbox": shift(block.bbox, layer), "font_size_pt": block.font_size_pt, "font_name": block.font_name}))
            .collect();
        summary.insert("text_blocks".into(), Value::Array(blocks));
    }
    if include_pixels && !layer.kind.is_folder() {
        let pixels = document.render_layer_pixels(layer)?.map(|image| {
            let bbox = image
                .alpha_bbox()
                .map(|(x0, y0, x1, y1)| vec![x0, y0, x1, y1])
                .unwrap_or_default();
            json!({"size": [image.width, image.height], "bbox": bbox})
        });
        summary.insert("stored_pixels".into(), pixels.unwrap_or(Value::Null));
    }
    if !layer.children.is_empty() {
        let children = layer
            .children
            .iter()
            .map(|child| layer_summary(document, child, include_pixels))
            .collect::<Result<Vec<_>>>()?;
        summary.insert("children".into(), Value::Array(children));
    }
    Ok(Value::Object(summary))
}

fn union(boxes: impl Iterator<Item = BBox>) -> Option<BBox> {
    boxes.reduce(|a, b| (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)))
}

/// Layer-local box to canvas pixels (adds the layer offset).
fn shift(bbox: Option<BBox>, layer: &ClipLayer) -> Option<[i64; 4]> {
    bbox.map(|(x0, y0, x1, y1)| {
        [
            x0 as i64 + layer.offset_x,
            y0 as i64 + layer.offset_y,
            x1 as i64 + layer.offset_x,
            y1 as i64 + layer.offset_y,
        ]
    })
}
