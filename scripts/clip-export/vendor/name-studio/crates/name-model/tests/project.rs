use name_model::{
    BalloonShape, Character, EmotionPoint, LineKind, PanelBorder, PanelEffect, PanelFill, Project, ProjectError, Scene,
    TailStyle, validate,
};

/// A project saved by the editor: three pages, the second with two lines.
fn sample() -> Project {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/editor-project.namestudio");
    Project::load(&path).unwrap()
}

#[test]
fn saves_and_loads_through_json() {
    let mut project = sample();
    project.characters.push(Character {
        id: "chara-saved".into(),
        name: "主人公".into(),
        color: Some("#d04040".into()),
        tone: Some("です・ます。驚くと関西弁".into()),
    });
    project.pages[1].lines[0].speaker = Some("chara-saved".into());
    let first = project.pages[0].id.clone();
    project.emotions.push(EmotionPoint {
        character: "chara-saved".into(),
        page: first.clone(),
        value: 0.5,
        note: String::new(),
    });
    project.scenes.push(Scene {
        id: "scene-saved".into(),
        title: "出会い".into(),
        summary: String::new(),
        first_page: first.clone(),
        last_page: first,
        story_time: None,
        story_order: None,
    });
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("作品.namestudio");
    project.save(&path).unwrap();
    assert_eq!(Project::load(&path).unwrap(), project);
}

#[test]
fn refuses_broken_projects() {
    let mut project = sample();
    project.pages[1].lines[0].speaker = Some("nobody".into());
    project.emotions.push(EmotionPoint {
        character: "nobody".into(),
        page: "page999".into(),
        value: 2.0,
        note: String::new(),
    });
    let problems = validate(&project);
    assert!(problems.len() >= 3, "{problems:?}");
    assert!(matches!(project.to_json(), Err(ProjectError::Invalid(_))));
    assert!(matches!(Project::from_json("{}"), Err(ProjectError::Json(_))));
}

/// A project saved by the editor (app/src/project.ts) reads back and saves unchanged.
#[test]
fn reads_what_the_editor_writes() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/editor-project.namestudio");
    let project = Project::load(&path).expect("editor project");
    assert_eq!(project.pages.len(), 3);
    let page = &project.pages[1];
    assert_eq!(page.panels.len(), 6);
    assert!(
        page.lines
            .iter()
            .all(|line| line.panel.is_some() && line.balloon.is_some())
    );
    assert_eq!(project.characters.len(), 1);
    assert_eq!(project.pages[2].strokes.len(), 1);
    let again = Project::from_json(&project.to_json().unwrap()).unwrap();
    assert_eq!(again, project);
}

/// Pens taken from CSP and the strokes drawn with them survive a save.
#[test]
fn keeps_brushes_and_the_brush_of_each_stroke() {
    let json = r#"{
      "formatVersion": 1, "title": "t", "binding": "right",
      "pageFormat": {"canvasMm": [297, 420], "trimMm": [257, 364], "basicMm": [180, 270], "basicOffsetMm": [0, 0]},
      "pages": [{"id": "page1", "strokes": [
        {"id": "stroke2", "points": [[1, 2, 0.5], [3, 4, 1, 0.3, 0.2]], "widthMm": 0.5, "closed": false, "brush": "brush3", "cut": [false, true]}
      ]}],
      "brushes": [
        {"id": "brush3", "name": "丸ペン", "kind": "pen", "sizeMm": 0.5,
         "sizePressure": {"min": 0, "curve": [[0, 0], [0.66, 0.08], [1, 1]]},
         "sizeTilt": {"min": 0.85, "curve": [[0, 1], [1, 0]]}, "opacityRandom": {"min": 0.3},
         "opacity": 1, "hardness": 1, "stabilization": 6, "taperInMm": 0.8, "taperOutMm": 0.8,
         "thickness": 100, "rotation": 0,
         "tip": {"pngBase64": "iVBORw0KGgo=", "width": 4, "height": 2, "interval": 10, "enabled": false},
         "source": "CSP: ペン / 丸ペン"},
        {"id": "brush4", "name": "硬め", "kind": "eraser", "sizeMm": 2.5, "erase": "intersection"}
      ],
      "nextId": 5
    }"#;
    let project = Project::from_json(json).unwrap();
    assert_eq!(project.brushes.len(), 2);
    assert_eq!(project.pages[0].strokes[0].brush.as_deref(), Some("brush3"));
    assert_eq!(project.pages[0].strokes[0].cut, Some([false, true]));
    let points = &project.pages[0].strokes[0].points;
    assert_eq!(points[0].motion, None);
    assert_eq!(points[1].motion, Some(name_model::Motion { tilt: 0.3, speed: 0.2 }));
    assert_eq!(project.brushes[0].size_tilt.as_ref().map(|c| c.min), Some(0.85));
    assert!(Project::from_json(&json.replace("[1, 2, 0.5]", "[1, 2, 0.5, 0.1]")).is_err());
    assert_eq!(project.brushes[1].erase, Some(name_model::EraseMode::Intersection));
    assert_eq!(project.brushes[1].opacity, 1.0);
    let again = Project::from_json(&project.to_json().unwrap()).unwrap();
    assert_eq!(again, project);
    let mut broken = project.clone();
    broken.brushes[1].id = "brush3".into();
    broken.brushes[0].size_mm = 0.0;
    assert_eq!(validate(&broken).len(), 2);
}

/// The panel and balloon vocabulary (format 2) as the editor writes it.
#[test]
fn keeps_panel_and_balloon_styles() {
    let text = r##"{
      "formatVersion": 2, "title": "t", "author": "", "binding": "right",
      "pageFormat": {"canvasMm": [297, 420], "trimMm": [257, 364], "basicMm": [180, 270], "basicOffsetMm": [0, 0]},
      "pages": [{
        "id": "page1", "memo": "",
        "panels": [
          {"id": "panel2", "shape": [[58, 0], [238, 0], [238, 120], [58, 120]], "order": 1,
           "border": "wavy", "openEdges": [0], "fill": "black", "effect": "focus", "note": "回想", "spread": "spread9"},
          {"id": "panel3", "shape": [[50, 100], [90, 100], [90, 140], [50, 140]], "order": 2, "fill": "white", "z": 1}
        ],
        "lines": [
          {"id": "line4", "text": "待って", "kind": "speech", "box": [100, 150, 110, 180], "fontSizePt": 13, "vertical": true,
           "balloonShape": "spike", "tails": [{"tip": [90, 200]}, {"tip": [130, 200], "style": "line", "bend": -4.5}], "inverted": true, "emphasis": true},
          {"id": "line5", "text": "ねえ", "kind": "aside", "box": [80, 150, 90, 170], "fontSizePt": 9, "vertical": true, "linkTo": "line4"}
        ],
        "strokes": [{"id": "stroke6", "points": [[1, 2, 1], [3, 4, 1]], "widthMm": 0.4, "closed": false, "over": true}],
        "roughs": [],
        "breakouts": [{"id": "breakout7", "shape": [[60, 90], [80, 90], [70, 130]], "note": "全身"}],
        "fills": [{"id": "fill8", "shape": [[10, 10], [20, 10], [15, 20]]}, {"id": "fill9", "shape": [[30, 30], [40, 30], [35, 40]], "tone": "gray"}]
      }],
      "characters": [], "scenes": [], "emotions": [], "nextId": 10,
      "lineShapes": {"thought": "polygon", "speech": "rounded"}
    }"##;
    let project = Project::from_json(text).expect("format 2 project");
    let shapes = project.line_shapes.as_ref().expect("line shapes");
    assert_eq!(shapes.thought, Some(BalloonShape::Polygon));
    assert_eq!(shapes.speech, Some(BalloonShape::Rounded));
    assert_eq!(shapes.narration, None);
    let page = &project.pages[0];
    assert_eq!(page.panels[0].border, PanelBorder::Wavy);
    assert_eq!(page.panels[0].open_edges, vec![0]);
    assert_eq!(page.panels[0].fill, PanelFill::Black);
    assert_eq!(page.panels[0].effect, PanelEffect::Focus);
    assert_eq!(page.panels[1].z, 1);
    assert_eq!(page.panels[0].spread, "spread9");
    assert_eq!(page.lines[0].balloon_shape, BalloonShape::Spike);
    assert_eq!(page.lines[0].tails[1].style, TailStyle::Line);
    assert_eq!(page.lines[0].tails[1].bend, Some(-4.5));
    assert_eq!(page.lines[0].tails[0].bend, None);
    assert_eq!(page.lines[1].kind, LineKind::Aside);
    assert_eq!(page.lines[1].link_to.as_deref(), Some("line4"));
    assert!(page.strokes[0].over);
    assert_eq!(page.breakouts[0].note, "全身");
    assert_eq!(page.fills.len(), 2);
    assert_eq!(page.fills[0].tone, None);
    assert_eq!(page.fills[1].tone.as_deref(), Some("gray"));
    let json = project.to_json().unwrap();
    assert!(
        json.contains("\"openEdges\"") && json.contains("\"balloonShape\":\"spike\""),
        "{json}"
    );
    // Defaults are left out, so panels and lines without styles look as before.
    assert!(!json.contains("\"border\":\"solid\""));
    assert_eq!(Project::from_json(&json).unwrap(), project);

    let mut broken = project.clone();
    broken.pages[0].panels[0].open_edges = vec![9];
    broken.pages[0].lines[1].link_to = Some("line404".into());
    // Both halves of a 見開き on one page.
    broken.pages[0].panels[1].spread = "spread9".into();
    let problems = validate(&broken);
    assert_eq!(problems.len(), 3, "{problems:?}");
}

/// 別案 (other versions of a run of pages) survive a save.
#[test]
fn keeps_alternatives() {
    let json = r#"{
      "formatVersion": 2, "title": "t", "binding": "right",
      "pageFormat": {"canvasMm": [297, 420], "trimMm": [257, 364], "basicMm": [180, 270], "basicOffsetMm": [0, 0]},
      "pages": [{"id": "page1"}, {"id": "page5"}],
      "alternatives": [{"id": "alt2", "pageIds": ["page5"], "active": "option4", "options": [
        {"id": "option3", "name": "案A", "pages": [{"id": "page1-a", "memo": "前の案"}, {"id": "page6"}]},
        {"id": "option4", "name": "案B", "pages": []}
      ]}],
      "nextId": 7
    }"#;
    let project = Project::from_json(json).unwrap();
    assert_eq!(project.alternatives.len(), 1);
    assert_eq!(project.alternatives[0].options[0].pages.len(), 2);
    assert_eq!(project.alternatives[0].options[0].pages[0].memo, "前の案");
    let again = Project::from_json(&project.to_json().unwrap()).unwrap();
    assert_eq!(again, project);
    assert!(validate(&project).is_empty());
}

/// 話の型: an own story shape made in the app survives a save.
#[test]
fn keeps_own_story_shapes() {
    let json = r##"{
      "formatVersion": 2, "title": "t", "binding": "right",
      "pageFormat": {"canvasMm": [297, 420], "trimMm": [257, 364], "basicMm": [180, 270], "basicOffsetMm": [0, 0]},
      "pages": [{"id": "page1"}],
      "plan": {"targetPages": 32, "structure": "shape-ab12", "shapes": [
        {"id": "shape-ab12", "label": "自分の型", "parts": [
          {"name": "はじまり", "share": 0.3, "color": "#4f86d9"}, {"name": "おわり", "share": 0.7}
        ], "beats": [{"name": "転機", "at": 0.5}]}
      ]},
      "nextId": 2
    }"##;
    let project = Project::from_json(json).unwrap();
    let plan = project.plan.as_ref().unwrap();
    assert_eq!(plan.shapes[0].parts[0].color.as_deref(), Some("#4f86d9"));
    assert_eq!(plan.shapes[0].beats[0].at, 0.5);
    let saved = project.to_json().unwrap();
    assert!(saved.contains("\"shapes\""));
    let again = Project::from_json(&saved).unwrap();
    assert_eq!(again, project);
}

/// 付箋の紐づけ, a moved panel memo, a masked balloon and 保留コマ survive saving.
#[test]
fn keeps_links_masks_and_held_panels() {
    let text = r##"{
      "formatVersion": 2, "title": "t", "author": "", "binding": "right",
      "pageFormat": {"canvasMm": [297, 420], "trimMm": [257, 364], "basicMm": [180, 270], "basicOffsetMm": [0, 0]},
      "pages": [{
        "id": "page1", "memo": "",
        "panels": [{"id": "panel2", "shape": [[58, 0], [238, 0], [238, 120], [58, 120]], "order": 1, "note": "間", "noteAt": [-40, 10]}],
        "lines": [{"id": "line3", "text": "待って", "kind": "speech", "box": [100, 50, 110, 80], "fontSizePt": 13, "vertical": true, "panel": "panel2", "mask": true}],
        "strokes": [], "roughs": [],
        "stickies": [{"id": "sticky4", "text": "長く", "at": [10, 200], "link": {"kind": "panel", "id": "panel2", "at": [30, 40]}}]
      }],
      "characters": [], "scenes": [], "emotions": [], "nextId": 10,
      "held": [{
        "id": "held5", "near": "page1", "from": "page1",
        "panel": {"id": "panel6", "shape": [[58, 130], [238, 130], [238, 250], [58, 250]], "order": 2},
        "lines": [{"id": "line7", "text": "いつか", "kind": "speech", "box": [100, 150, 110, 180], "fontSizePt": 13, "vertical": true}],
        "strokes": [{"id": "stroke8", "points": [[1, 2, 1], [3, 4, 1]], "widthMm": 0.4, "closed": false}]
      }]
    }"##;
    let project = Project::from_json(text).expect("project");
    let page = &project.pages[0];
    assert_eq!(page.panels[0].note_at, Some([-40.0, 10.0]));
    assert!(page.lines[0].mask);
    let link = page.stickies[0].link.as_ref().expect("link");
    assert_eq!(
        (link.kind.as_str(), link.id.as_str(), link.at),
        ("panel", "panel2", [30.0, 40.0])
    );
    assert_eq!(project.held.len(), 1);
    assert_eq!(project.held[0].panel.id, "panel6");
    assert_eq!(project.held[0].lines[0].text, "いつか");
    assert_eq!(project.held[0].near.as_deref(), Some("page1"));
    let json = project.to_json().unwrap();
    assert!(
        json.contains("\"noteAt\"") && json.contains("\"mask\":true") && json.contains("\"held\""),
        "{json}"
    );
    assert_eq!(Project::from_json(&json).unwrap(), project);
}

/// 資料画像: the pictures and where they lie survive a save; a reference to a
/// picture that is not kept is refused.
#[test]
fn keeps_reference_images() {
    let text = r##"{
      "formatVersion": 2, "title": "t", "author": "", "binding": "right",
      "pageFormat": {"canvasMm": [297, 420], "trimMm": [257, 364], "basicMm": [180, 270], "basicOffsetMm": [0, 0]},
      "pages": [{
        "id": "page1", "memo": "", "panels": [], "lines": [], "strokes": [], "roughs": [],
        "references": [{"id": "reference3", "image": "image2", "box": [10, 20, 110, 95], "opacity": 0.35}]
      }],
      "characters": [], "scenes": [], "emotions": [], "nextId": 4,
      "images": [{"id": "image2", "name": "駅.jpg", "mime": "image/jpeg", "dataBase64": "/9j/4AAQ", "widthPx": 400, "heightPx": 300}]
    }"##;
    let project = Project::from_json(text).expect("project");
    assert!(validate(&project).is_empty(), "{:?}", validate(&project));
    let reference = &project.pages[0].references[0];
    assert_eq!(
        (reference.image.as_str(), reference.box_mm, reference.opacity),
        ("image2", [10.0, 20.0, 110.0, 95.0], Some(0.35))
    );
    assert_eq!(project.images[0].width_px, 400);
    let json = project.to_json().unwrap();
    assert!(
        json.contains("\"dataBase64\":\"/9j/4AAQ\"") && json.contains("\"box\":[10.0,20.0,110.0,95.0]"),
        "{json}"
    );
    assert_eq!(Project::from_json(&json).unwrap(), project);

    let mut broken = project.clone();
    broken.images.clear();
    let problems = validate(&broken);
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].contains("資料画像"), "{problems:?}");
}

#[test]
fn tells_the_fields_a_newer_version_added() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/editor-project.namestudio");
    let text = std::fs::read_to_string(path).unwrap();
    assert_eq!(Project::unknown_fields(&text).unwrap(), Vec::<String>::new());

    // As a newer version would write it: a field on the project, one on every
    // page and one on a stroke inside a page.
    let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
    value["timeline"] = serde_json::json!({ "beats": [] });
    for page in value["pages"].as_array_mut().unwrap() {
        page["layout"] = serde_json::json!("grid");
    }
    let page = value["pages"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|page| page["strokes"].as_array().is_some_and(|s| !s.is_empty()));
    let stroke = &mut page.expect("a page with strokes")["strokes"][0];
    stroke["wobble"] = serde_json::json!(0.3);
    let newer = value.to_string();
    assert_eq!(
        Project::unknown_fields(&newer).unwrap(),
        ["pages.layout", "pages.strokes.wobble", "timeline"]
    );
    // The rest of it still opens and passes the check.
    assert!(Project::from_json(&newer).is_ok());
}

#[test]
fn a_choice_a_newer_version_added_does_not_open() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/editor-project.namestudio");
    let mut value: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    value["binding"] = serde_json::json!("top");
    let error = Project::from_json(&value.to_string()).unwrap_err();
    assert!(matches!(error, ProjectError::Json(_)));
    assert!(
        error
            .to_string()
            .starts_with("新しい版のツールで足された選択肢があるため開けません"),
        "{error}"
    );
    assert!(Project::unknown_fields(&value.to_string()).is_err());
    // A file that is simply broken says so.
    let broken = Project::from_json("{\"title\": 3}").unwrap_err();
    assert!(
        broken.to_string().starts_with("ファイルの形式が正しくありません"),
        "{broken}"
    );
}

#[test]
fn a_name_that_is_not_there_says_so_in_words() {
    let dir = tempfile::tempdir().unwrap();
    let error = Project::load(dir.path().join("外付け/第4話.namestudio")).unwrap_err();
    assert!(error.to_string().starts_with("ファイルが見つかりません。"), "{error}");
}

#[test]
fn a_name_moved_with_its_sheet_finds_the_sheet_beside_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = sample();
    project.source = Some(name_model::SourceSheet {
        path: r"D:\old place\第4話\ネーム.clip".to_owned(),
        resolution: 350.0,
        cells: vec![],
    });
    let name = dir.path().join("第4話.namestudio");
    project.save(&name).unwrap();
    let source = |text: &str| {
        serde_json::from_str::<serde_json::Value>(text).unwrap()["source"]["path"]
            .as_str()
            .unwrap()
            .to_owned()
    };

    // The sheet is nowhere: the path stays as it was written.
    assert_eq!(
        source(&Project::load_text_finding_source(&name).unwrap()),
        r"D:\old place\第4話\ネーム.clip"
    );

    // Moved together into one folder: the sheet beside the name.
    let sheet = dir.path().join("ネーム.clip");
    std::fs::write(&sheet, b"clip").unwrap();
    let found = Project::load_text_finding_source(&name).unwrap();
    assert_eq!(source(&found), sheet.to_string_lossy());
    assert_eq!(Project::from_json(&found).unwrap().pages.len(), project.pages.len());

    // Where the project says, it is left alone even with another beside the name.
    let elsewhere = tempfile::tempdir().unwrap();
    let there = elsewhere.path().join("ネーム.clip");
    std::fs::write(&there, b"clip").unwrap();
    project.source.as_mut().unwrap().path = there.to_string_lossy().into_owned();
    project.save(&name).unwrap();
    assert_eq!(
        source(&Project::load_text_finding_source(&name).unwrap()),
        there.to_string_lossy()
    );
}
