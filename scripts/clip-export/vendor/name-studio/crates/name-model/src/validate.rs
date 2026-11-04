//! Consistency checks run when a project is loaded or saved.

use std::collections::{BTreeMap, HashSet};

use crate::model::{FORMAT_VERSION, Project};

/// Problems found in a project, in Japanese for the user. Empty when valid.
pub fn validate(project: &Project) -> Vec<String> {
    let mut problems = Vec::new();
    if project.format_version > FORMAT_VERSION {
        problems.push(format!(
            "新しい版のツールで保存されたファイルです（形式 {}、このツールは {} まで）",
            project.format_version, FORMAT_VERSION
        ));
    }
    let mut ids = HashSet::new();
    let mut check_id = |id: &str, problems: &mut Vec<String>| {
        if id.is_empty() {
            problems.push("id が空の要素があります".to_owned());
        } else if !ids.insert(id.to_owned()) {
            problems.push(format!("id {id} が重複しています"));
        }
    };
    let characters: HashSet<&str> = project.characters.iter().map(|c| c.id.as_str()).collect();
    let images: HashSet<&str> = project.images.iter().map(|i| i.id.as_str()).collect();
    // 見開き id → page numbers of its halves.
    let mut spreads: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for character in &project.characters {
        check_id(&character.id, &mut problems);
    }
    for (number, page) in project.pages.iter().enumerate().map(|(i, p)| (i + 1, p)) {
        check_id(&page.id, &mut problems);
        let panels: HashSet<&str> = page.panels.iter().map(|p| p.id.as_str()).collect();
        for panel in &page.panels {
            check_id(&panel.id, &mut problems);
            if panel.shape.len() < 3 {
                problems.push(format!("{number} ページのコマ {} の頂点が足りません", panel.id));
            }
            if !panel.spread.is_empty() {
                spreads.entry(panel.spread.as_str()).or_default().push(number);
            }
            if panel.open_edges.iter().any(|&edge| edge as usize >= panel.shape.len()) {
                problems.push(format!(
                    "{number} ページのコマ {} の開いた辺の番号が範囲外です",
                    panel.id
                ));
            }
        }
        for breakout in &page.breakouts {
            check_id(&breakout.id, &mut problems);
            if breakout.shape.len() < 3 {
                problems.push(format!("{number} ページのはみ出し {} の頂点が足りません", breakout.id));
            }
        }
        let lines: HashSet<&str> = page.lines.iter().map(|l| l.id.as_str()).collect();
        for line in &page.lines {
            check_id(&line.id, &mut problems);
            if let Some(speaker) = &line.speaker
                && !characters.contains(speaker.as_str())
            {
                problems.push(format!(
                    "{number} ページのセリフ {} の話者 {speaker} がいません",
                    line.id
                ));
            }
            if let Some(panel) = &line.panel
                && !panels.contains(panel.as_str())
            {
                problems.push(format!(
                    "{number} ページのセリフ {} のコマ {panel} がありません",
                    line.id
                ));
            }
            if let Some(target) = &line.link_to
                && (target == &line.id || !lines.contains(target.as_str()))
            {
                problems.push(format!(
                    "{number} ページのセリフ {} のつなぎ先 {target} が同じページにありません",
                    line.id
                ));
            }
        }
        for stroke in &page.strokes {
            check_id(&stroke.id, &mut problems);
        }
        for rough in &page.roughs {
            check_id(&rough.id, &mut problems);
        }
        for reference in &page.references {
            check_id(&reference.id, &mut problems);
            if !images.contains(reference.image.as_str()) {
                problems.push(format!(
                    "{number} ページの資料画像 {} の画像 {} がありません",
                    reference.id, reference.image
                ));
            }
        }
    }
    for brush in &project.brushes {
        check_id(&brush.id, &mut problems);
        if !(brush.size_mm.is_finite() && brush.size_mm > 0.0) {
            problems.push(format!("ブラシ「{}」の大きさが正しくありません", brush.name));
        }
    }
    for image in &project.images {
        check_id(&image.id, &mut problems);
    }
    for (spread, pages) in &spreads {
        let facing = pages.len() == 2 && pages[0].abs_diff(pages[1]) == 1;
        if pages.len() > 2 || (pages.len() == 2 && !facing) {
            problems.push(format!("見開きのコマ {spread} が隣り合う 2 ページに分かれていません"));
        }
    }
    for scene in &project.scenes {
        check_id(&scene.id, &mut problems);
        match (
            project.page_number(&scene.first_page),
            project.page_number(&scene.last_page),
        ) {
            (Some(first), Some(last)) if first <= last => {}
            (Some(_), Some(_)) => problems.push(format!("シーン「{}」の最初と最後のページが逆です", scene.title)),
            _ => problems.push(format!("シーン「{}」のページがありません", scene.title)),
        }
    }
    for point in &project.emotions {
        if !characters.contains(point.character.as_str()) {
            problems.push(format!("感情の値の登場人物 {} がいません", point.character));
        }
        if project.page_number(&point.page).is_none() {
            problems.push(format!("感情の値のページ {} がありません", point.page));
        }
        if !(-1.0..=1.0).contains(&point.value) {
            problems.push(format!("感情の値 {} が -1〜1 の範囲外です", point.value));
        }
    }
    if let Some(id) = ids.iter().filter_map(|id| id_number(id)).max()
        && id >= project.next_id
    {
        problems.push(format!(
            "next_id {} が使用済みの id 番号 {id} 以下です",
            project.next_id
        ));
    }
    problems
}

/// Trailing number of an id made by `Project::new_id` ("line40" → 40).
fn id_number(id: &str) -> Option<u64> {
    let digits = id.trim_start_matches(|c: char| !c.is_ascii_digit());
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}
