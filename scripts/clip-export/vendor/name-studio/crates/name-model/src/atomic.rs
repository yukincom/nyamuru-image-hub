//! Writing a file whole or not at all: the new contents go to a temporary file
//! beside it, reach the disk (`sync_all`), and only then take the file's name.
//! A crash or a power cut leaves the old file or the new one, never an empty
//! or half-written one, and a failed write leaves the old file as it was.
//!
//! Every file the tool writes over goes through here (names, versions,
//! recovery copies, PDF and script files, CSP pages and works).

use std::io;
use std::path::{Path, PathBuf};

/// The temporary file `path` is written to first: `<name>.tmp` beside it.
pub fn temporary_path(path: &Path) -> PathBuf {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    PathBuf::from(temporary)
}

/// Write `bytes` to `path` whole or not at all.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    replace_with(path, |temporary| std::fs::write(temporary, bytes))
}

/// Let `write_to` write the new contents to a temporary path, then put them in
/// place of `path` once they are on the disk. When `write_to` fails, `path` is
/// left as it was and the temporary file is removed.
pub fn replace_with<E: From<io::Error>>(path: &Path, write_to: impl FnOnce(&Path) -> Result<(), E>) -> Result<(), E> {
    let temporary = temporary_path(path);
    let done = write_to(&temporary)
        .and_then(|()| sync(&temporary).map_err(E::from))
        .and_then(|()| std::fs::rename(&temporary, path).map_err(E::from));
    if done.is_err() {
        let _ = std::fs::remove_file(&temporary);
    } else {
        sync_folder(path);
    }
    done
}

fn sync(path: &Path) -> io::Result<()> {
    std::fs::OpenOptions::new().write(true).open(path)?.sync_all()
}

/// The rename itself reaches the disk once the folder is synced (on Windows
/// the rename is written with the file system's journal and a folder cannot be
/// opened to sync; nothing more is needed there).
fn sync_folder(path: &Path) {
    #[cfg(unix)]
    if let Some(folder) = path.parent().filter(|folder| !folder.as_os_str().is_empty()) {
        let _ = std::fs::File::open(folder).and_then(|folder| folder.sync_all());
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_file_whole_and_leaves_no_temporary_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("a.namestudio");
        std::fs::write(&path, "old").unwrap();
        write(&path, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert!(!temporary_path(&path).exists());
    }

    #[test]
    fn a_failed_write_keeps_the_old_file_and_cleans_up() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("a.namestudio");
        std::fs::write(&path, "old").unwrap();
        let failed = replace_with(&path, |temporary| {
            std::fs::write(temporary, "half")?;
            Err(io::Error::other("disk full"))
        });
        assert_eq!(failed.unwrap_err().to_string(), "disk full");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert!(!temporary_path(&path).exists());
    }

    #[test]
    fn a_new_file_is_made_in_a_folder_that_exists() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("new.pdf");
        write(&path, b"%PDF").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF");
        let missing = folder.path().join("no-such-folder").join("x.pdf");
        assert!(write(&missing, b"x").is_err());
        assert!(!temporary_path(&missing).exists());
    }
}
