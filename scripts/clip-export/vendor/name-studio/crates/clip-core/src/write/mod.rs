//! Writing .clip pages and .cmc works (stages 3 and 4 of the Python reference).
//!
//! Pages are written by editing a CSP-made empty page (the template), so
//! everything this crate does not model is kept as CSP wrote it. The file
//! itself (container, database, pixels, copying layers, the work's page
//! list) is csp-format's `ClipFile` and `CmcFile`; what is here is how the
//! name tool lays its pages out. Inputs are only read; outputs go to new files.

pub mod blank;
pub mod cmc;
pub mod layers;
pub mod manifest;
pub mod page;
pub mod raster_page;
pub mod split;
pub mod spread;
pub mod update;
pub mod verify;

use rusqlite::types::Value;

/// One row as (column, value) pairs, in the table's column order.
pub type Values = Vec<(String, Value)>;

pub(crate) fn value_of<'a>(values: &'a Values, column: &str) -> Option<&'a Value> {
    values.iter().find(|(name, _)| name == column).map(|(_, value)| value)
}

/// Set `column` (added at the end when the row does not have it yet).
pub(crate) fn set_value(values: &mut Values, column: &str, value: Value) {
    match values.iter_mut().find(|(name, _)| name == column) {
        Some(entry) => entry.1 = value,
        None => values.push((column.to_owned(), value)),
    }
}

pub(crate) fn int_value(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Integer(number)) => *number,
        Some(Value::Real(number)) => *number as i64,
        _ => 0,
    }
}
