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
    /// Windows のショートカット（.lnk）の、リンク先の種類（一覧のアイコンを、その先の種類で出すため）。ショートカットでなければ省く
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_kind: Option<Kind>,
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
        link_kind: if dir { None } else { shortcut_kind(path) },
    })
}

/// ショートカット（.lnk）の、リンク先の種類。Windows だけで調べる（ほかの OS の .lnk は、ふつうのファイル）。読めなければ None
#[cfg(windows)]
fn shortcut_kind(path: &Path) -> Option<Kind> {
    use std::io::Read;
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
        return None;
    }
    let mut head = [0u8; LNK_HEADER_LEN];
    fs::File::open(path).ok()?.read_exact(&mut head).ok()?;
    lnk_target_kind(&head)
}

#[cfg(not(windows))]
fn shortcut_kind(_path: &Path) -> Option<Kind> {
    None
}

/// .lnk の先頭（ShellLinkHeader）の長さ
#[cfg_attr(not(windows), allow(dead_code))]
const LNK_HEADER_LEN: usize = 0x4C;

/// .lnk の先頭から、リンク先の種類を読む。ヘッダーの `FileAttributes`（リンクを作ったときの、リンク先の属性）の
/// フォルダの印（0x10）を見る。ヘッダーの印（長さ 0x4C・ShellLink の CLSID）が合わなければ None。
/// リンク先をあとで差し替えられていると食い違うが、アイコンの見た目だけに使う
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn lnk_target_kind(head: &[u8]) -> Option<Kind> {
    const CLSID: [u8; 16] = [0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46];
    if head.len() < LNK_HEADER_LEN || head[0..4] != [0x4C, 0, 0, 0] || head[4..20] != CLSID {
        return None;
    }
    let attrs = u32::from_le_bytes([head[0x18], head[0x19], head[0x1A], head[0x1B]]);
    Some(if attrs & 0x10 != 0 { Kind::Dir } else { Kind::File })
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

/// 詳細（種類・大きさ・更新日時）を読めなかった項目。名前とパスだけは分かるので、ファイルとして出す
fn unreadable_entry(path: &Path) -> Entry {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    Entry {
        hidden: name.starts_with('.'),
        name,
        path: path.to_string_lossy().into_owned(),
        kind: Kind::File,
        size: None,
        modified: None,
        readonly: false,
        symlink: false,
        link_kind: None,
    }
}

/// フォルダの中身（並び順は決めない。画面が並べる）。読めない項目は飛ばさず、分かる範囲で出す
pub fn list(dir: &Path) -> FsResult<Vec<Entry>> {
    let rd = fs::read_dir(dir).map_err(|e| FsError::io(&e, dir))?;
    let mut out = Vec::new();
    for item in rd {
        let item = item.map_err(|e| FsError::io(&e, dir))?;
        // 一覧を読んでいるあいだに消えた項目は出さない。
        // 詳細を読めない項目（Windows の予約名 `nul` のファイルなど）は、1 つのせいで一覧ごと失敗させず、名前だけで出す
        let path = item.path();
        match entry_of(&path) {
            Ok(e) => out.push(e),
            Err(e) if e.code == "not_found" => {}
            Err(_) => out.push(unreadable_entry(&path)),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod unreadable_tests {
    use super::*;

    #[test]
    fn an_unreadable_item_is_listed_by_name_only() {
        // Windows の予約名（nul など）のように、詳細を読めない項目。一覧ごと失敗にしない
        let e = unreadable_entry(Path::new("/home/u/nul"));
        assert_eq!((e.name.as_str(), e.kind, e.size, e.modified), ("nul", Kind::File, None, None));
        assert!(!e.hidden);
        assert!(unreadable_entry(Path::new("/home/u/.x")).hidden);
    }

    fn lnk_head(attrs: u32) -> Vec<u8> {
        let mut h = vec![0u8; LNK_HEADER_LEN];
        h[0] = 0x4C;
        h[4..20].copy_from_slice(&[0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
        h[0x18..0x1C].copy_from_slice(&attrs.to_le_bytes());
        h
    }

    #[test]
    fn a_shortcut_shows_the_kind_of_its_target() {
        assert_eq!(lnk_target_kind(&lnk_head(0x10)), Some(Kind::Dir));
        assert_eq!(lnk_target_kind(&lnk_head(0x20)), Some(Kind::File));
        // ヘッダーの印が合わないもの・短すぎるものは、ショートカットとして扱わない
        let mut bad = lnk_head(0x10);
        bad[4] = 0;
        assert_eq!(lnk_target_kind(&bad), None);
        assert_eq!(lnk_target_kind(&lnk_head(0x10)[..0x20]), None);
    }
}
