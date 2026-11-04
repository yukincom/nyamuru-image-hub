//! Shared by the tests that read name data the front end wrote.

use serde_json::Value;

/// Where `written` differs from `read` (numbers compared as numbers: 1 and 1.0 are the same).
pub fn differences(path: &str, read: &Value, written: &Value, found: &mut Vec<String>) {
    match (read, written) {
        (Value::Object(a), Value::Object(b)) => {
            for (key, value) in a {
                match b.get(key) {
                    Some(other) => differences(&format!("{path}.{key}"), value, other, found),
                    None => found.push(format!("{path}.{key}: dropped by Rust")),
                }
            }
            for key in b.keys().filter(|key| !a.contains_key(*key)) {
                found.push(format!("{path}.{key}: added by Rust"));
            }
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            for (index, (value, other)) in a.iter().zip(b).enumerate() {
                differences(&format!("{path}[{index}]"), value, other, found);
            }
        }
        (Value::Number(a), Value::Number(b)) if a.as_f64() == b.as_f64() => {}
        _ if read == written => {}
        _ => found.push(format!("{path}: {read} became {written}")),
    }
}
