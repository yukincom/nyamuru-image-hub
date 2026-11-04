//! Nyamuru's data adapter. The vendored CSP encoders retain their upstream bodies.
use std::{collections::HashSet, io::{Read, Write}, path::Path};
use base64::{Engine, engine::general_purpose::STANDARD};
use clip_core::{ClipDocument, text::{FontName, NewText}, vector::NewVectorLine,
    write::{layers::set_layer_mask, raster_page::{PartDonors, prepare_for, add_text_layer, add_vector_layer}}};
use csp_format::{ClipFile, RgbaImage, blank::{PageSetup, StoryLayout, blank_page, blank_parts},
    database::select, edit::NewLayer, render::BlendMode, vector::VectorData};
use rusqlite::types::Value;
use serde::Deserialize;
use serde_json::json;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const MAX_PIXELS: u64 = 100_000_000;
const MAX_INPUT: u64 = 96 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    profile: String, width: u32, height: u32, dpi: f64, title: String,
    page: u32, layers: Vec<Layer>, preview: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layer {
    id: String, name: String, visible: bool, locked: bool, opacity: f64,
    blend: Blend, mask: Option<Mask>,
    #[serde(default)] pass_through: bool,
    #[serde(flatten)] content: Content,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Blend { Normal, Multiply }
#[derive(Deserialize)]
struct Mask { png: String, x: i64, y: i64 }
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Content {
    Folder { children: Vec<Layer> },
    Raster { png: String, x: i64, y: i64 },
    Text {
        text: String, frame: [i32; 4],
        #[serde(rename = "fontSizePt")] font_size_pt: f64,
        vertical: bool, color: [u8; 3], font: Option<Font>,
        #[serde(rename = "lineSpacing")] line_spacing: Option<f64>,
        #[serde(rename = "fontWeight", default)] font_weight: u32,
        #[serde(default)] italic: bool,
        #[serde(rename = "textAlign", default)] text_align: Option<String>,
    },
    Vector { lines: Vec<Line> },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Font { name: String, postscript: String, synthetic_bold: Option<bool>, synthetic_italic: Option<bool> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line { points: Vec<(f64, f64, f64)>, closed: bool, width_px: f64, color: [u8; 3] }

fn png(value: &str) -> Result<RgbaImage> {
    let encoded = value.strip_prefix("data:image/png;base64,").ok_or("PNGデータが必要です")?;
    let data = STANDARD.decode(encoded)?;
    if data.len() < 24 || &data[..8] != b"\x89PNG\r\n\x1a\n" || &data[12..16] != b"IHDR" { return Err("PNGの形式が不正です".into()); }
    let width = u32::from_be_bytes(data[16..20].try_into()?);
    let height = u32::from_be_bytes(data[20..24].try_into()?);
    if width == 0 || height == 0 || width > 30_000 || height > 30_000 || u64::from(width)*u64::from(height)>MAX_PIXELS { return Err("画像サイズが上限を超えています".into()); }
    Ok(RgbaImage::from_png(&data)?)
}

fn validate_layers(layers: &[Layer], depth: usize, ids: &mut HashSet<String>) -> Result<()> {
    if depth > 64 { return Err("フォルダーの階層が深すぎます".into()); }
    for layer in layers {
        if layer.id.is_empty() || !ids.insert(layer.id.clone()) || ids.len()>10_000 { return Err("レイヤーIDまたは件数が不正です".into()); }
        if layer.name.len()>4096 || !layer.opacity.is_finite() || !(0.0..=1.0).contains(&layer.opacity) { return Err("レイヤー名または透明度が不正です".into()); }
        match &layer.content {
            Content::Folder { children } => validate_layers(children, depth+1, ids)?,
            Content::Text {text, frame, font_size_pt, line_spacing, ..} => {
                if text.len()>1_000_000 || frame[2]<=frame[0] || frame[3]<=frame[1] || frame.iter().any(|v| v.unsigned_abs()>1_000_000)
                    || !font_size_pt.is_finite() || !(0.1..=2000.0).contains(font_size_pt)
                    || line_spacing.is_some_and(|v| !v.is_finite() || !(1.0..=2000.0).contains(&v)) { return Err("文字の位置・サイズが不正です".into()); }
            },
            Content::Vector { lines } => {
                if lines.len()>100_000 || lines.iter().any(|line| line.points.len()<2 || line.points.len()>1_000_000 || !line.width_px.is_finite() || !(0.0..=30_000.0).contains(&line.width_px)
                    || line.points.iter().any(|&(x,y,p)| !x.is_finite() || !y.is_finite() || x.abs()>1_000_000.0 || y.abs()>1_000_000.0 || !p.is_finite() || !(0.0..=1.0).contains(&p))) { return Err("ベクター線の座標が不正です".into()); }
            },
            Content::Raster { x, y, .. } => if x.unsigned_abs()>1_000_000 || y.unsigned_abs()>1_000_000 { return Err("画像の位置が不正です".into()); },
        }
    }
    Ok(())
}

// The public vector object exposes its documented RGB header. The upstream line
// builder makes black lines; colour is a layer-adapter concern, not an encoder fork.
fn vector_colors(file: &mut ClipFile, id: i64, lines: &[Line]) -> Result<()> {
    for row in select(file.database(), "SELECT VectorData FROM VectorObjectList WHERE LayerId = ?1", [id])? {
        let external = row.text("VectorData").ok_or("ベクターデータの参照がありません")?;
        let bytes = file.external(&external).ok_or("ベクターデータがありません")?;
        let mut data = VectorData::parse(bytes)?;
        if data.objects.len()!=lines.len() { return Err("ベクター線の件数が一致しません".into()); }
        for (object, line) in data.objects.iter_mut().zip(lines) {
            for (channel, value) in line.color.iter().enumerate() {
                object.header[40+channel*4..44+channel*4].copy_from_slice(&(u32::from(*value)*0x01010101).to_be_bytes());
            }
        }
        file.set_external(&external, data.to_bytes());
    }
    Ok(())
}

// Plain blocks inherit their point size from the block, not the donor's
// character-level size override. Main and additional runs have different layouts.
// 0x2c is the donor's pixel/point conversion (dpi/72*1000): keeping 8333 from
// its 600dpi canvas made 24pt render at 200px on a 150dpi target in real CSP.
fn text_style(file: &mut ClipFile, id: i64, bold: bool, italic: bool, align: Option<&str>) -> Result<()> {
    use csp_format::text::{Attributes, split_array, join_array};
    let style=u32::from(bold) | (u32::from(italic)<<1);
    let pixels_per_point=(file.canvas.resolution/72.0*1000.0).round() as u32;
    let alignment=match align {Some("right")=>1u32,Some("center")=>2u32,_=>0u32};
    let patch=|bytes: &[u8], counted: bool| -> Result<Vec<u8>> {
        let mut attr=Attributes::parse(bytes)?;
        let flags=attr.get(0x21).filter(|b|b.len()==4).map(|b|u32::from_le_bytes(b.try_into().unwrap())).unwrap_or(0);
        attr.set(0x21,((flags & !3) | style).to_le_bytes().to_vec());
        attr.set(0x23,alignment.to_le_bytes().to_vec());
        attr.set(0x2c,pixels_per_point.to_le_bytes().to_vec());
        let offset=if counted {16}else{8};
        for record in &mut attr.records {
            if record.id==0x0b && record.data.len()>=offset+2 {
                record.data[offset]=(record.data[offset]&!3) | style as u8;
                record.data[offset+1]&=!2;
                if counted && record.data.len()>=offset+16 {record.data[offset+8..offset+16].copy_from_slice(&0f64.to_le_bytes());}
            }
            if record.id==0x0c && record.data.len()>=offset+2 {record.data[offset..offset+2].copy_from_slice(&(alignment as u16).to_le_bytes());}
        }
        Ok(attr.to_bytes())
    };
    let row=select(file.database(),"SELECT TextLayerAttributes, TextLayerAddAttributesV01 FROM Layer WHERE MainId = ?1",[id])?.remove(0);
    if let Some(blob)=row.blob("TextLayerAttributes") {file.set_layer_value(id,"TextLayerAttributes",Value::Blob(patch(blob,true)?))?;}
    if let Some(blob)=row.blob("TextLayerAddAttributesV01") {
        let parts=split_array(blob)?.into_iter().map(|part|patch(part,false)).collect::<Result<Vec<_>>>()?;
        file.set_layer_value(id,"TextLayerAddAttributesV01",Value::Blob(join_array(&parts)))?;
    }
    Ok(())
}

fn add(file: &mut ClipFile, parent: i64, layers: &[Layer], donor: &PartDonors) -> Result<()> {
    for layer in layers {
        let id = match &layer.content {
            Content::Folder { children } => {
                let id = file.add_layer(parent, NewLayer::Folder, &layer.name)?;
                add(file, id, children, donor)?;
                id
            },
            Content::Raster { png: image, x, y } => {
                let image = png(image)?;
                let id = file.add_layer(parent, NewLayer::Raster, &layer.name)?;
                file.set_layer_pixels(id, &image, (*x,*y))?;
                id
            },
            Content::Text { text, frame, font_size_pt, vertical, color, font, line_spacing, font_weight, italic, text_align } => {
                let text = NewText { text:text.clone(), frame:*frame, font_size_pt:*font_size_pt, vertical:*vertical,
                    color:Some(*color), font:font.as_ref().map(|f| FontName{name:f.name.clone(),postscript:f.postscript.clone()}), line_spacing:*line_spacing };
                let id = add_text_layer(file, donor, &text, parent)?;
                text_style(file,id,font.as_ref().and_then(|f|f.synthetic_bold).unwrap_or(*font_weight>=600),
                    font.as_ref().and_then(|f|f.synthetic_italic).unwrap_or(*italic),text_align.as_deref())?;
                file.set_layer_name(id, &layer.name)?;
                id
            },
            Content::Vector { lines } => {
                let native = lines.iter().map(|line| NewVectorLine{points:line.points.clone(),closed:line.closed,width_px:line.width_px}).collect::<Vec<_>>();
                let id = add_vector_layer(file, donor, &layer.name, &native, parent)?;
                vector_colors(file, id, lines)?;
                id
            },
        };
        if let Some(mask) = &layer.mask {
            let image = png(&mask.png)?;
            let mut full = RgbaImage::new(file.canvas.width_px, file.canvas.height_px);
            full.paste(&image,mask.x,mask.y);
            set_layer_mask(file,id,&clip_core::RgbaImage{width:full.width,height:full.height,pixels:full.pixels})?;
        }
        file.set_layer_opacity(id,layer.opacity)?;
        file.set_layer_visible(id,layer.visible)?;
        file.set_layer_blend(id,if layer.pass_through && matches!(layer.content,Content::Folder{..}) {BlendMode::PassThrough} else {match layer.blend {Blend::Normal=>BlendMode::Normal,Blend::Multiply=>BlendMode::Multiply}})?;
        file.set_layer_value(id,"LayerLock",Value::Integer(i64::from(layer.locked)))?;
    }
    Ok(())
}

fn encode(page: &Page) -> Result<Vec<u8>> {
    if page.profile!="nyamuru-clip-v1" || page.width==0 || page.height==0 || page.width>30_000 || page.height>30_000
        || u64::from(page.width)*u64::from(page.height)>MAX_PIXELS || !page.dpi.is_finite() || !(72.0..=1200.0).contains(&page.dpi)
        || page.title.len()>4096 || page.page==0 { return Err("CLIP書き出しの用紙設定が不正です".into()); }
    validate_layers(&page.layers,0,&mut HashSet::new())?;
    let mm=[f64::from(page.width)*25.4/page.dpi,f64::from(page.height)*25.4/page.dpi];
    let setup=PageSetup {canvas_mm:mm,resolution:page.dpi,trim_mm:mm,bleed_mm:0.0,basic_mm:mm,basic_offset_mm:[0.0;2],
        right_binding:true,first_page_left:true,title:page.title.clone(),story_index:None,author:String::new(),nombre_start:1,font:None,story:StoryLayout::default()};
    let mut file=blank_page(&setup)?;
    let root=file.canvas.root_folder;
    // The app supplies every authored layer. Keep only a separate white paper,
    // which CSP can hide to reveal the actual alpha in each layer.
    for id in file.layer_children(root)? { file.remove_layer(id)?; }
    file.add_layer(root,NewLayer::Paper([255;3]),"用紙")?;
    let donor=PartDonors::find(ClipDocument::from_file(blank_parts()?,Path::new("(built-in parts)"))?)?;
    prepare_for(&mut file,&donor)?;
    add(&mut file,root,&page.layers,&donor)?;
    if let Some(preview)=&page.preview {
        let image=png(preview)?;
        let image=if image.width.max(image.height)>2048 {
            let factor=2048.0/f64::from(image.width.max(image.height));
            image.resize_area((f64::from(image.width)*factor).round().max(1.0) as u32,(f64::from(image.height)*factor).round().max(1.0) as u32)
        }else{image};
        file.database().execute("UPDATE CanvasPreview SET ImageData = ?1, ImageWidth = ?2, ImageHeight = ?3",(image.to_png()?,image.width,image.height))?;
    } else { file.update_preview()?; }
    Ok(file.to_bytes()?)
}

fn inspect(data: Vec<u8>) -> Result<serde_json::Value> {
    let file=ClipFile::from_bytes(data)?;
    let layers=file.layers.flatten().into_iter().map(|(layer,depth)| {
        let texts=csp_format::text::read_blocks(&layer.row).unwrap_or_default().into_iter().map(|block| {
            json!({"text":block.text,"fontSizePt":block.attributes.font_size(),"frame":block.attributes.bbox(),"font":block.attributes.font()})
        }).collect::<Vec<_>>();
        json!({"id":layer.main_id,"depth":depth,"name":layer.name,"kind":layer.kind.name(),"opacity":layer.opacity,"visible":layer.visible,"locked":layer.locked,"blend":layer.blend,"mask":layer.mask_enabled,"texts":texts})
    }).collect::<Vec<_>>();
    Ok(json!({"width":file.canvas.width_px,"height":file.canvas.height_px,"dpi":file.canvas.resolution,"layers":layers}))
}

fn run() -> Result<()> {
    let mut bytes=Vec::new();std::io::stdin().take(MAX_INPUT+1).read_to_end(&mut bytes)?;
    if bytes.len() as u64>MAX_INPUT {return Err("入力サイズが上限を超えています".into());}
    if std::env::args().nth(1).as_deref()==Some("--inspect") {
        serde_json::to_writer(std::io::stdout(),&inspect(bytes)?)?;
    } else {
        let page:Page=serde_json::from_slice(&bytes)?;
        std::io::stdout().write_all(&encode(&page)?)?;
    }
    Ok(())
}
fn main(){if let Err(error)=run(){eprintln!("{error}");std::process::exit(1);}}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Page {
        let mut image=RgbaImage::new(2,2);
        image.pixels=vec![255,0,0,128,0,0,0,0,0,255,0,255,0,0,255,64];
        let png=format!("data:image/png;base64,{}",STANDARD.encode(image.to_png().unwrap()));
        serde_json::from_value(json!({"profile":"nyamuru-clip-v1","width":128,"height":160,"dpi":300,"title":"確認","page":1,
            "layers":[{"kind":"folder","id":"group","name":"作画","visible":true,"locked":false,"opacity":1.0,"blend":"normal","passThrough":true,
                "children":[{"kind":"raster","id":"image","name":"透過画像","visible":false,"locked":true,"opacity":0.5,"blend":"multiply","png":png,"x":10,"y":20},
                    {"kind":"text","id":"text","name":"セリフ","visible":true,"locked":false,"opacity":1.0,"blend":"normal","text":"こんにちは\n新しい文字です😀","frame":[30,20,100,140],"fontSizePt":15,"vertical":true,"color":[17,17,17],"lineSpacing":105,"font":{"name":"ヒラギノ角ゴシック W3","postscript":"HiraginoSans-W3"}},
                    {"kind":"vector","id":"line","name":"編集線","visible":true,"locked":false,"opacity":1.0,"blend":"normal","lines":[{"points":[[1,2,1],[20,30,0.5]],"closed":false,"widthPx":3,"color":[50,100,200]}]}]}]})).unwrap()
    }
    // 見込み: 同梱writerで符号化すれば文字と線を画像化せず構造を保持できる。
    // 合格: 実CLIP再読込で本文・座標・文字種・階層/順序・線色・透過画素が一致。CSP画面は別確認。
    #[test]
    fn clip_roundtrip_keeps_editable_content_and_alpha() {
        let page=fixture();let bytes=encode(&page).unwrap();let file=ClipFile::from_bytes(bytes.clone()).unwrap();
        assert_eq!((file.canvas.width_px,file.canvas.height_px,file.canvas.resolution),(128,160,300.0));
        let group=file.layers.flatten().into_iter().find(|(l,_)|l.name=="作画").unwrap().0;
        assert_eq!(group.blend,30);
        let ids=file.layer_children(group.main_id).unwrap();
        assert_eq!(ids.iter().map(|id|file.layers.get(*id).unwrap().name.as_str()).collect::<Vec<_>>(),["透過画像","セリフ","編集線"]);
        let raster=file.layers.get(ids[0]).unwrap();assert!(!raster.visible);assert!(raster.locked);assert_eq!(raster.opacity,128);assert_eq!(raster.blend,2);
        let pixels=file.layer_pixels_in_box(raster,(10,20,12,22)).unwrap();assert_eq!(pixels.pixels,[255,0,0,128,0,0,0,0,0,255,0,255,0,0,255,64]);
        let text=file.layers.get(ids[1]).unwrap();let blocks=csp_format::text::read_blocks(&text.row).unwrap();assert_eq!(blocks.len(),1);
        assert_eq!(blocks[0].text,"こんにちは\r\n新しい文字です😀");assert_eq!(blocks[0].attributes.font_size(),Some(15.0));assert_eq!(blocks[0].attributes.bbox(),Some([30,20,100,140]));
        let layer=file.layers.get(ids[2]).unwrap();
        let reference=select(file.database(),"SELECT VectorData FROM VectorObjectList WHERE LayerId = ?1",[layer.main_id]).unwrap()[0].text("VectorData").unwrap();
        let data=VectorData::parse(file.external(&reference).unwrap()).unwrap();assert_eq!(data.objects.len(),1);assert_eq!(data.objects[0].main_color(),[50,100,200]);assert_eq!(data.objects[0].coordinates(),[(1.0,2.0),(20.0,30.0)]);
        let report=csp_format::verify::check_clip(bytes,csp_format::verify::CheckOptions::default());
        assert!(report.ok(),"{}",serde_json::to_string_pretty(&report).unwrap());
    }
    // 見込み: マスクは画素へ焼かず別面に保持し、透明度0の層も残る。
    // 合格: 実CLIP再読込でmask alphaと層opacity=0が一致。CSPでの手操作は別確認。
    #[test]
    fn mask_and_zero_opacity_survive() {
        let mut page=fixture();let mut image=RgbaImage::new(2,2);image.pixels=vec![255,255,255,0,255,255,255,128,255,255,255,255,255,255,255,64];
        page.layers[0].mask=Some(Mask{png:format!("data:image/png;base64,{}",STANDARD.encode(image.to_png().unwrap())),x:10,y:20});page.layers[0].opacity=0.0;
        let file=ClipFile::from_bytes(encode(&page).unwrap()).unwrap();
        let group=file.layers.flatten().into_iter().find(|(l,_)|l.name=="作画").unwrap().0;
        assert_eq!(group.opacity,0);assert!(group.mask_enabled);
        let (mask,origin)=file.layer_mask(group).unwrap().unwrap();
        let x=(10-origin.0) as usize;let y=(20-origin.1) as usize;let width=mask.width as usize;
        assert_eq!([mask.pixels[y*width+x],mask.pixels[y*width+x+1],mask.pixels[(y+1)*width+x],mask.pixels[(y+1)*width+x+1]],[0,128,255,64]);
    }
    // 見込み: donorの600dpi・書体・書式に引きずられず出力指定を採用する。
    // 合格: main/add属性にページdpi換算、指定font、太字/斜体/揃えが残る。
    // 範囲: 実ファイル読戻し。150dpiの24ptが約50pxになることは実CSPでも確認。
    #[test]
    fn text_uses_target_dpi_font_and_style() {
        use csp_format::text::{Attributes,split_array};
        for (dpi,expected) in [(150.0,2083u32),(300.0,4167),(600.0,8333)] {
            let mut page=fixture();page.dpi=dpi;
            if let Content::Folder{children}=&mut page.layers[0].content {
                if let Content::Text{font_weight,italic,text_align,..}=&mut children[1].content {*font_weight=700;*italic=true;*text_align=Some("center".into());}
            }
            let file=ClipFile::from_bytes(encode(&page).unwrap()).unwrap();
            let text=file.layers.flatten().into_iter().find(|(l,_)|l.name=="セリフ").unwrap().0;
            let main=Attributes::parse(text.row.blob("TextLayerAttributes").unwrap()).unwrap();
            let add=Attributes::parse(split_array(text.row.blob("TextLayerAddAttributesV01").unwrap()).unwrap()[0]).unwrap();
            for attr in [&main,&add] {assert_eq!(attr.get(0x2c),Some(expected.to_le_bytes().as_slice()));assert_eq!(attr.get(0x21).unwrap()[0]&3,3);assert_eq!(attr.get(0x23).unwrap()[0],2);}
            assert_eq!(main.font().unwrap().postscript_name,"HiraginoSans-W3");
            assert_eq!(main.get(0x0b).unwrap()[17]&2,0);
            assert_eq!(f64::from_le_bytes(main.get(0x0b).unwrap()[24..32].try_into().unwrap()),0.0);
        }
    }
    // 見込み: 実太字・斜体faceを選んだときは擬似書式を重ねない。
    // 合格: 指定faceを保持し、main/addの擬似style bitが0。範囲: 実バイナリ属性。
    #[test]
    fn real_font_faces_do_not_receive_synthetic_style() {
        use csp_format::text::{Attributes,split_array};
        let mut page=fixture();
        if let Content::Folder{children}=&mut page.layers[0].content {
            if let Content::Text{font,font_weight,italic,..}=&mut children[1].content {
                *font_weight=700;*italic=true;
                *font=Some(Font{name:"Test Bold Italic".into(),postscript:"Test-BoldItalic".into(),synthetic_bold:Some(false),synthetic_italic:Some(false)});
            }
        }
        let file=ClipFile::from_bytes(encode(&page).unwrap()).unwrap();
        let text=file.layers.flatten().into_iter().find(|(l,_)|l.name=="セリフ").unwrap().0;
        let main=Attributes::parse(text.row.blob("TextLayerAttributes").unwrap()).unwrap();
        let add=Attributes::parse(split_array(text.row.blob("TextLayerAddAttributesV01").unwrap()).unwrap()[0]).unwrap();
        for attr in [&main,&add] {assert_eq!(attr.get(0x21).unwrap()[0]&3,0);}
        assert_eq!(main.font().unwrap().postscript_name,"Test-BoldItalic");
    }
    // 見込み: 無効な寸法・ID重複・壊れた画像は完成ファイルとして返さない。
    // 合格: encoderがErrを返す。外部サービスやUIは通さない。
    #[test]
    fn invalid_input_is_rejected_before_output() {
        let mut page=fixture();page.width=30_001;assert!(encode(&page).is_err());
        let mut page=fixture();if let Content::Folder{children}= &mut page.layers[0].content {children[0].id="group".into();}assert!(encode(&page).is_err());
        assert!(png("data:image/png;base64,aGVsbG8=").is_err());
    }
}
