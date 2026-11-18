//! フォルダの中（サブフォルダも）から、名前に文字を含む項目を探す。Tauri には依らない（`lib.rs` のコマンドが呼ぶ）。
//!
//! - 幅優先（浅いフォルダから）。見つけた項目は少しずつ（`on_hits`）渡す。止められる（`cancel`）。
//! - 上限（`Limits`）で止めたときは、黙って打ち切らず、理由（`Partial`）を返す: 件数・調べた数・深さ・時間。
//! - シンボリックリンクのフォルダは辿らない（輪になるのを避ける）。名前が当たれば、項目としては出す。
//! - 隠し項目は、`show_hidden` が偽なら、出さず・中へも入らない。読めないフォルダは飛ばして続ける（根が読めなければ失敗）。
//! - 名前の一致は、大文字小文字を区別しない部分一致（Unicode の小文字にそろえる）。

use super::entry::{entry_of, Entry};
use super::error::{FsError, FsResult};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// 検索の上限
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// 見つける件数
    pub max_hits: usize,
    /// 調べる項目の数（フォルダの中の 1 項目ずつ数える）
    pub max_scanned: usize,
    /// 下りる深さ（根が 0）
    pub max_depth: usize,
    /// かける時間
    pub max_time: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_hits: 1000, max_scanned: 300_000, max_depth: 64, max_time: Duration::from_secs(60) }
    }
}

/// 途中で止めた理由
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Partial {
    Hits,
    Scan,
    Depth,
    Time,
}

/// 検索の結果。`partial` が無ければ、最後まで調べた
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Outcome {
    pub partial: Option<Partial>,
}

/// まとめて渡す件数（これだけ溜まったら渡す。終わりにも渡す）
const BATCH: usize = 50;

#[cfg(windows)]
fn hidden_attr(item: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    item.metadata().map(|m| m.file_attributes() & 0x2 != 0).unwrap_or(false)
}

#[cfg(not(windows))]
fn hidden_attr(_item: &fs::DirEntry) -> bool {
    false
}

/// `root` の下から、名前に `text` を含む項目を探す。`text` が空なら何も探さない（空の結果）。
/// `cancel` が真になったら、`aborted` で止まる。
pub fn search(root: &Path, text: &str, show_hidden: bool, limits: Limits, cancel: &AtomicBool, mut on_hits: impl FnMut(Vec<Entry>)) -> FsResult<Outcome> {
    let needle = text.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Outcome { partial: None });
    }
    // 根が読めなければ、失敗（利用者に理由を見せる）
    fs::read_dir(root).map_err(|e| FsError::io(&e, root))?;
    let started = Instant::now();
    let aborted = || FsError::new("aborted", "中止しました");
    let mut queue: VecDeque<(std::path::PathBuf, usize)> = VecDeque::from([(root.to_path_buf(), 0)]);
    let (mut hits, mut scanned) = (0usize, 0usize);
    let mut batch: Vec<Entry> = Vec::new();
    let mut partial: Option<Partial> = None;
    // 深さの上限で下りなかったフォルダがあるか（あれば、最後に depth を伝える）
    let mut skipped_depth = false;

    'walk: while let Some((dir, depth)) = queue.pop_front() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for item in rd {
            if cancel.load(Ordering::Relaxed) {
                return Err(aborted());
            }
            if started.elapsed() > limits.max_time {
                partial = Some(Partial::Time);
                break 'walk;
            }
            let Ok(item) = item else { continue };
            scanned += 1;
            if scanned > limits.max_scanned {
                partial = Some(Partial::Scan);
                break 'walk;
            }
            let name = item.file_name().to_string_lossy().into_owned();
            if !show_hidden && (name.starts_with('.') || hidden_attr(&item)) {
                continue;
            }
            let Ok(ft) = item.file_type() else { continue };
            if name.to_lowercase().contains(&needle) {
                // 消えた・読めない項目は出さない
                if let Ok(e) = entry_of(&item.path()) {
                    batch.push(e);
                    hits += 1;
                    if batch.len() >= BATCH {
                        on_hits(std::mem::take(&mut batch));
                    }
                    if hits >= limits.max_hits {
                        partial = Some(Partial::Hits);
                        break 'walk;
                    }
                }
            }
            // リンクは辿らない（フォルダへのリンクも、中へは入らない）
            if ft.is_dir() {
                if depth >= limits.max_depth {
                    skipped_depth = true;
                } else {
                    queue.push_back((item.path(), depth + 1));
                }
            }
        }
    }
    if !batch.is_empty() {
        on_hits(batch);
    }
    if partial.is_none() && skipped_depth {
        partial = Some(Partial::Depth);
    }
    Ok(Outcome { partial })
}
