//! Error type shared by every reader and writer in this crate.

use std::fmt;

/// A file that does not follow the CLIP STUDIO PAINT layout this crate understands.
#[derive(Debug)]
pub enum CspError {
    /// The file is not a .clip / .cmc, or its structure is broken.
    Format(String),
    /// Reading the file from disk failed.
    Io(std::io::Error),
    /// The embedded SQLite database could not be read.
    Sqlite(rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, CspError>;

impl CspError {
    pub fn format(message: impl Into<String>) -> Self {
        CspError::Format(message.into())
    }
}

impl fmt::Display for CspError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CspError::Format(message) => write!(f, "{message}"),
            CspError::Io(error) => write!(f, "{error}"),
            CspError::Sqlite(error) => write!(f, "SQLite: {error}"),
        }
    }
}

impl std::error::Error for CspError {}

impl From<std::io::Error> for CspError {
    fn from(error: std::io::Error) -> Self {
        CspError::Io(error)
    }
}

impl From<csp_format::Error> for CspError {
    fn from(error: csp_format::Error) -> Self {
        CspError::Format(error.to_string())
    }
}

impl From<rusqlite::Error> for CspError {
    fn from(error: rusqlite::Error) -> Self {
        CspError::Sqlite(error)
    }
}
