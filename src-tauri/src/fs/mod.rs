//! ローカルのファイルシステムの操作（一覧・作成・移動・コピー・ゴミ箱・大きさ・場所）。
//! Tauri には依らない（`lib.rs` のコマンドが呼ぶ）。決まりは `ops.rs` の先頭。

mod deps;
mod entry;
mod error;
mod ops;
mod places;
mod search;
pub mod trash;

pub use deps::{which, Found};
pub use entry::{abs, entry_of, list, Entry, Kind};
pub use error::{FsError, FsResult};
pub use ops::{copy, mkdir, os_trash_restore, remove, rename, size, size_within, trash, write_file, Size};
pub use places::{places, start_dir, Place};
pub use search::{search, Limits, Outcome, Partial};

#[cfg(test)]
mod tests;
