//! The name data is defined twice: in [`name_model::model`] and in the front
//! end (app/src/model.ts). The fixtures here are written by the front end's
//! `contract.test.ts` and hold every field it knows and every value of each
//! choice; nothing may be lost or changed when Rust reads and writes them.

use name_model::{
    BalloonShape, Binding, BrushKind, EraseMode, LineKind, NombrePlace, PanelBorder, PanelEffect, PanelFill, Project,
    StoryPosition, TailStyle,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

mod common;
use common::differences;

const FULL_PROJECT: &str = include_str!("fixtures/full-project.json");
const FULL_SERIES: &str = include_str!("fixtures/full-series.json");
const CHOICES: &str = include_str!("fixtures/choices.json");

#[test]
fn every_field_of_the_front_end_survives_rust() {
    let read: Value = serde_json::from_str(FULL_PROJECT).unwrap();
    let project: Project = serde_json::from_value(read.clone())
        .unwrap_or_else(|error| panic!("model.rs cannot read the front end's project: {error}"));
    let written = serde_json::to_value(&project).unwrap();
    let mut found = Vec::new();
    differences("project", &read, &written, &mut found);
    assert!(
        found.is_empty(),
        "model.rs and app/src/model.ts differ:\n{}",
        found.join("\n")
    );
}

#[test]
fn every_field_of_a_series_survives_rust() {
    let read: Value = serde_json::from_str(FULL_SERIES).unwrap();
    let series = name_model::Series::from_json(FULL_SERIES)
        .unwrap_or_else(|error| panic!("series.rs cannot read the front end's series: {error}"));
    let written = serde_json::to_value(&series).unwrap();
    let mut found = Vec::new();
    differences("series", &read, &written, &mut found);
    assert!(
        found.is_empty(),
        "series.rs and app/src/model.ts differ:\n{}",
        found.join("\n")
    );
}

fn check_choice<T: DeserializeOwned + Serialize>(name: &str, values: &Value, found: &mut Vec<String>) {
    for value in values[name]
        .as_array()
        .unwrap_or_else(|| panic!("no {name} in choices.json"))
    {
        match serde_json::from_value::<T>(value.clone()) {
            Ok(read) if serde_json::to_value(&read).unwrap() == *value => {}
            Ok(read) => found.push(format!(
                "{name}: {value} became {}",
                serde_json::to_value(&read).unwrap()
            )),
            Err(error) => found.push(format!("{name}: {value} is unknown to Rust ({error})")),
        }
    }
}

#[test]
fn every_choice_of_the_front_end_is_known_to_rust() {
    let values: Value = serde_json::from_str(CHOICES).unwrap();
    let mut found = Vec::new();
    check_choice::<Binding>("binding", &values, &mut found);
    check_choice::<LineKind>("lineKind", &values, &mut found);
    check_choice::<PanelBorder>("panelBorder", &values, &mut found);
    check_choice::<PanelFill>("panelFill", &values, &mut found);
    check_choice::<PanelEffect>("panelEffect", &values, &mut found);
    check_choice::<BalloonShape>("balloonShape", &values, &mut found);
    check_choice::<TailStyle>("tailStyle", &values, &mut found);
    check_choice::<BrushKind>("brushKind", &values, &mut found);
    check_choice::<EraseMode>("eraseMode", &values, &mut found);
    check_choice::<StoryPosition>("storyPosition", &values, &mut found);
    check_choice::<NombrePlace>("nombrePlace", &values, &mut found);
    let checked = 11;
    assert_eq!(
        values.as_object().map(|choices| choices.len()),
        Some(checked),
        "a choice in choices.json is not checked here"
    );
    assert!(found.is_empty(), "{}", found.join("\n"));
}
