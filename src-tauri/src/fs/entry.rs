use super::error::{FsError, FsResult};
use serde::Serialize;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Dir,
}

/// 一覧の 1 行。`kind` はシンボリックリンクを辿った先の種類（フォルダへのリンクは開ける）。
/// 辿れないリンク（切れている）は file として出し、size・modified はリンクそのものの値にする。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    /// 絶対パス（操作にそのまま渡せる）
    pub path: String,
    pub kind: Kind,
    /// バイト数。フォルダは null（大きさは `size` で数える）
    pub size: Option<u64>,
    /// 更新時刻（UNIX 時刻のミリ秒）
    pub modified: Option<i64>,
    pub hidden: bool,
    pub readonly: bool,
    pub symlink: bool,
}

/// 画面から来たパスを確かめる。絶対パスだけを受ける（相対パスは、アプリの作業フォルダに依ってしまう）
pub fn abs(path: &str) -> FsResult<PathBuf> {
    if path.is_empty() || path.contains('\0') {
        return Err(FsError::new("invalid", "パスが空か、使えない文字を含みます"));
    }
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(FsError::new("invalid", format!("絶対パスではありません: {path}")));
    }
    Ok(p)
}

pub fn entry_of(path: &Path) -> FsResult<Entry> {
    let link = fs::symlink_metadata(path).map_err(|e| FsError::io(&e, path))?;
    let symlink = link.file_type().is_symlink();
    // リンクは先を見る。切れていたらリンクそのもの
    let meta = if symlink { fs::metadata(path).unwrap_or_else(|_| link.clone()) } else { link };
    let name = match path.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        // ルート（/ や C:\）は名前が無いので、パスをそのまま名前にする
        None => path.to_string_lossy().into_owned(),
    };
    let dir = meta.is_dir();
    Ok(Entry {
        hidden: is_hidden(&name, &meta),
        name,
        path: path.to_string_lossy().into_owned(),
        kind: if dir { Kind::Dir } else { Kind::File },
        size: if dir { None } else { Some(meta.len()) },
        modified: modified_ms(&meta),
        readonly: meta.permissions().readonly(),
        symlink,
    })
}

fn modified_ms(meta: &Metadata) -> Option<i64> {
    let t = meta.modified().ok()?;
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_millis()).ok(),
        // 1970 年より前
        Err(e) => i64::try_from(e.duration().as_millis()).ok().map(|ms| -ms),
    }
}

#[cfg(windows)]
fn is_hidden(name: &str, meta: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    name.starts_with('.') || meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &Metadata) -> bool {
    name.starts_with('.')
}

/// フォルダの中身（並び順は決めない。画面が並べる）。読めない項目は飛ばさず、分かる範囲で出す
pub fn list(dir: &Path) -> FsResult<Vec<Entry>> {
    let rd = fs::read_dir(dir).map_err(|e| FsError::io(&e, dir))?;
    let mut out = Vec::new();
    for item in rd {
        let item = item.map_err(|e| FsError::io(&e, dir))?;
        // 一覧を読んでいるあいだに消えた項目は出さない。ほかの失敗は一覧ごと失敗にする（欠けた一覧を正しいものとして見せない）
        match entry_of(&item.path()) {
            Ok(e) => out.push(e),
            Err(e) if e.code == "not_found" => {}
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}
