//! Error type shared by every reader and writer in this crate.

use std::fmt;

/// Why a file could not be read or written.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// The data does not follow the layout this crate understands.
    Format(String),
    /// Reading or writing a file failed.
    Io(std::io::Error),
    /// The embedded SQLite database could not be read or written.
    Sqlite(rusqlite::Error),
}

/// Result with this crate's [`Error`].
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// An [`Error::Format`] with this message.
    pub fn format(message: impl Into<String>) -> Self {
        Error::Format(message.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Format(message) => write!(f, "{message}"),
            Error::Io(error) => write!(f, "{error}"),
            Error::Sqlite(error) => write!(f, "SQLite: {error}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Format(_) => None,
            Error::Io(error) => Some(error),
            Error::Sqlite(error) => Some(error),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Error::Io(error)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Error::Sqlite(error)
    }
}

/// Shorthand for `Err(Error::Format(...))` with `format!` arguments.
macro_rules! bail {
    ($($arg:tt)*) => {
        return Err($crate::error::Error::Format(format!($($arg)*)))
    };
}
pub(crate) use bail;
