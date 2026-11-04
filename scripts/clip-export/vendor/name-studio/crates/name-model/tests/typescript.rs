//! The name data as TypeScript, from the Rust types (`--features ts`): written
//! to app/src/generated/name-model.ts, which the app's type check compares with
//! its own model.ts (app/src/modelcheck.ts). A type changed here without the
//! generated file fails this test; `UPDATE_TS=1 cargo test -p name-model
//! --features ts --test typescript` writes it again.
#![cfg(feature = "ts")]

use name_model::*;
use std::path::Path;
use ts_rs::{Config, TS};

/// The name data's TypeScript declarations, one file.
fn declarations() -> String {
    let cfg = Config::new().with_large_int("number");
    let decls = [
        Project::decl(&cfg),
        HeldPanel::decl(&cfg),
        Alternatives::decl(&cfg),
        AlternativeOption::decl(&cfg),
        Binding::decl(&cfg),
        PageFormat::decl(&cfg),
        Page::decl(&cfg),
        ReferenceImage::decl(&cfg),
        StoredImage::decl(&cfg),
        Fill::decl(&cfg),
        Sticky::decl(&cfg),
        StickyLink::decl(&cfg),
        Gutters::decl(&cfg),
        LineFonts::decl(&cfg),
        NameStyle::decl(&cfg),
        CspPage::decl(&cfg),
        StoryPosition::decl(&cfg),
        CspStory::decl(&cfg),
        StoryPageNumber::decl(&cfg),
        NombrePlace::decl(&cfg),
        ShownNombre::decl(&cfg),
        KindSizes::decl(&cfg),
        Plan::decl(&cfg),
        StoryShape::decl(&cfg),
        ShapePart::decl(&cfg),
        ShapeBeat::decl(&cfg),
        Panel::decl(&cfg),
        PanelBorder::decl(&cfg),
        PanelFill::decl(&cfg),
        PanelEffect::decl(&cfg),
        Breakout::decl(&cfg),
        LineKind::decl(&cfg),
        LineShapes::decl(&cfg),
        BalloonShape::decl(&cfg),
        TailStyle::decl(&cfg),
        Tail::decl(&cfg),
        Line::decl(&cfg),
        Stroke::decl(&cfg),
        RoughLayer::decl(&cfg),
        BrushKind::decl(&cfg),
        EraseMode::decl(&cfg),
        PressureCurve::decl(&cfg),
        BrushTip::decl(&cfg),
        Brush::decl(&cfg),
        RoughImage::decl(&cfg),
        Character::decl(&cfg),
        Scene::decl(&cfg),
        EmotionPoint::decl(&cfg),
        SourceSheet::decl(&cfg),
        Series::decl(&cfg),
        SeriesEpisode::decl(&cfg),
        SeriesShared::decl(&cfg),
    ];
    let mut text = String::from(
        "// Generated from crates/name-model (cargo test -p name-model --features ts --test typescript). Do not edit.\n\
         // app/src/modelcheck.ts checks it against model.ts.\n\n\
         export type StrokePoint = [number, number, number] | [number, number, number, number, number];\n",
    );
    for decl in decls {
        text.push_str("\nexport ");
        text.push_str(&decl);
        text.push('\n');
    }
    text
}

#[test]
fn the_app_has_the_name_data_as_rust_has_it() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/src/generated/name-model.ts");
    let text = declarations();
    if std::env::var_os("UPDATE_TS").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &text).unwrap();
    }
    let kept = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        kept == text,
        "{} is not what the Rust types say: run `UPDATE_TS=1 cargo test -p name-model --features ts --test typescript`",
        path.display()
    );
}
