//! Access to the SQLite database embedded in .clip files (and .cmc / .sut,
//! which are plain SQLite files).
//!
//! CSP creates tables and columns only when a file first needs them, so
//! readers look columns up by name and treat missing ones as absent.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags, Params};

use crate::error::Result;

pub use rusqlite::types::Value as SqlValue;

/// Open a database image as an in-memory connection (changes stay in memory).
pub fn open_bytes(image: &[u8]) -> Result<Connection> {
    let mut connection = Connection::open_in_memory_with_flags(OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.deserialize_read_exact("main", image, image.len(), false)?;
    Ok(connection)
}

/// The database image of `connection` (what goes into CHNKSQLi).
pub fn serialize(connection: &Connection) -> Result<Vec<u8>> {
    Ok(connection.serialize("main")?.to_vec())
}

/// One row read with `SELECT *`, columns in table order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Row {
    columns: Arc<Vec<String>>,
    index: Arc<HashMap<String, usize>>,
    values: Vec<Value>,
}

impl Row {
    /// A row with these columns and values (same length and order).
    pub fn new(columns: Vec<String>, values: Vec<Value>) -> Self {
        let index = columns.iter().enumerate().map(|(i, name)| (name.clone(), i)).collect();
        Row { columns: Arc::new(columns), index: Arc::new(index), values }
    }

    /// Column names, in table order.
    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    /// Values, in column order.
    pub fn values(&self) -> &[Value] {
        &self.values
    }

    /// (column, value) pairs in table order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.columns.iter().map(String::as_str).zip(self.values.iter())
    }

    /// The value of a column; None when the table has no such column.
    pub fn get(&self, column: &str) -> Option<&Value> {
        self.index.get(column).map(|i| &self.values[*i])
    }

    /// The column exists in this row's table (it may still be NULL).
    pub fn has(&self, column: &str) -> bool {
        self.index.contains_key(column)
    }

    /// Not NULL and present.
    pub fn is_set(&self, column: &str) -> bool {
        !matches!(self.get(column), None | Some(Value::Null))
    }

    /// Integer value; NULL, missing and non-numeric read as 0.
    pub fn int(&self, column: &str) -> i64 {
        self.opt_int(column).unwrap_or(0)
    }

    /// Integer value (reals are truncated); None when NULL, missing or not a number.
    pub fn opt_int(&self, column: &str) -> Option<i64> {
        match self.get(column)? {
            Value::Integer(value) => Some(*value),
            Value::Real(value) => Some(*value as i64),
            _ => None,
        }
    }

    /// Real value; NULL, missing and non-numeric read as 0.0.
    pub fn real(&self, column: &str) -> f64 {
        self.opt_real(column).unwrap_or(0.0)
    }

    /// Real value (integers converted); None when NULL, missing or not a number.
    pub fn opt_real(&self, column: &str) -> Option<f64> {
        match self.get(column)? {
            Value::Integer(value) => Some(*value as f64),
            Value::Real(value) => Some(*value),
            _ => None,
        }
    }

    /// Text value; UTF-8 blobs are decoded too. None when NULL or missing.
    pub fn text(&self, column: &str) -> Option<String> {
        match self.get(column)? {
            Value::Text(value) => Some(value.clone()),
            Value::Blob(value) => Some(String::from_utf8_lossy(value).into_owned()),
            _ => None,
        }
    }

    /// Blob value (text as its UTF-8 bytes); None when NULL or missing.
    pub fn blob(&self, column: &str) -> Option<&[u8]> {
        match self.get(column)? {
            Value::Blob(value) => Some(value),
            Value::Text(value) => Some(value.as_bytes()),
            _ => None,
        }
    }

    /// A value that is not NULL, 0 or empty.
    pub fn truthy(&self, column: &str) -> bool {
        match self.get(column) {
            Some(Value::Integer(value)) => *value != 0,
            Some(Value::Real(value)) => *value != 0.0,
            Some(Value::Text(value)) => !value.is_empty(),
            Some(Value::Blob(value)) => !value.is_empty(),
            _ => false,
        }
    }

    /// Replace a value (the column must exist).
    pub fn set(&mut self, column: &str, value: Value) -> bool {
        match self.index.get(column) {
            Some(i) => {
                self.values[*i] = value;
                true
            }
            None => false,
        }
    }
}

/// Run a query and return its rows with column names.
pub fn select(connection: &Connection, sql: &str, params: impl Params) -> Result<Vec<Row>> {
    let mut statement = connection.prepare(sql)?;
    let columns: Vec<String> = statement.column_names().into_iter().map(str::to_owned).collect();
    let index: Arc<HashMap<String, usize>> =
        Arc::new(columns.iter().enumerate().map(|(i, name)| (name.clone(), i)).collect());
    let columns = Arc::new(columns);
    let count = columns.len();
    let rows = statement.query_map(params, |row| {
        let mut values = Vec::with_capacity(count);
        for i in 0..count {
            values.push(row.get::<_, Value>(i)?);
        }
        Ok(values)
    })?;
    let mut result = Vec::new();
    for values in rows {
        result.push(Row { columns: columns.clone(), index: index.clone(), values: values? });
    }
    Ok(result)
}

/// Every row of a table (empty when the table does not exist).
pub fn select_all(connection: &Connection, table: &str) -> Result<Vec<Row>> {
    if !table_exists(connection, table)? {
        return Ok(Vec::new());
    }
    select(connection, &format!("SELECT * FROM {} ORDER BY rowid", quote(table)), [])
}

/// Whether the database has a table with this name.
pub fn table_exists(connection: &Connection, table: &str) -> Result<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Names of all tables, in creation order.
pub fn tables(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid")?;
    let names = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(names.collect::<std::result::Result<_, _>>()?)
}

/// Column (name, declared type) pairs of a table, in order.
pub fn columns(connection: &Connection, table: &str) -> Result<Vec<(String, String)>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({})", quote(table)))?;
    let names = statement.query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?;
    Ok(names.collect::<std::result::Result<_, _>>()?)
}

/// Whether `table` has a column named `column`.
pub fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    Ok(columns(connection, table)?.iter().any(|(name, _)| name == column))
}

/// Same as [`table_exists`].
pub fn has_table(connection: &Connection, table: &str) -> Result<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Quote an identifier for SQL.
pub fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// Read an id column that CSP stores either as TEXT or as BLOB.
pub fn value_as_text(value: &Value) -> Option<String> {
    match value {
        Value::Text(text) => Some(text.clone()),
        Value::Blob(blob) => Some(String::from_utf8_lossy(blob).into_owned()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_look_up_columns_by_name() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE T(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, A INTEGER, B REAL, C TEXT, D BLOB);
                 INSERT INTO T(A, B, C, D) VALUES (5, 1.5, 'x', x'6869');",
            )
            .unwrap();
        let image = serialize(&connection).unwrap();
        let reopened = open_bytes(&image).unwrap();
        let rows = select_all(&reopened, "T").unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.int("A"), 5);
        assert_eq!(row.real("B"), 1.5);
        assert_eq!(row.text("C").as_deref(), Some("x"));
        assert_eq!(row.text("D").as_deref(), Some("hi"));
        assert!(!row.has("Missing"));
        assert_eq!(row.int("Missing"), 0);
        assert!(select_all(&reopened, "Nope").unwrap().is_empty());
        assert_eq!(columns(&reopened, "T").unwrap()[1], ("A".to_string(), "INTEGER".to_string()));
    }
}
