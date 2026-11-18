//! アプリの中のゴミ箱（Android。OS のゴミ箱が無いので、同じ保存領域の `.fixplor-trash/` へ移す）。
//!
//! 形: `<保存領域の根>/.fixplor-trash/<id>` が中身（ファイル・フォルダ）、`<id>.json` が元の場所・種類・大きさ・消した時刻。
//! 移すのは `rename` だけ（同じ保存領域の中でしか動かない・中身はコピーしない）。
//! 戻す・完全に消すは、この中の id だけを使う（外のパスは受け取らない）。
//! 決まり: 元の場所に同名があれば戻さない（`exists`）。親が無ければ `parent_missing`。

use super::error::{FsError, FsResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const TRASH_DIR: &str = ".fixplor-trash";

/// ゴミ箱の 1 件（画面へ渡す形。`id` は戻す・消すに渡す）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrashItem {
    pub id: String,
    /// 消したときの絶対パス
    pub original_path: String,
    /// "file" | "dir"
    pub kind: String,
    /// バイト数（フォルダは 0）
    pub size: u64,
    /// 消した時刻（UNIX のミリ秒）
    pub deleted_at: u64,
}

/// パスが属する保存領域の根（Android の `/storage/emulated/0` や `/storage/<id>`）。それ以外は None
pub fn volume_root(path: &Path) -> Option<PathBuf> {
    let mut parts = path.components().filter_map(|c| match c {
        std::path::Component::Normal(s) => s.to_str(),
        _ => None,
    });
    if parts.next()? != "storage" {
        return None;
    }
    let first = parts.next()?;
    if first == "emulated" {
        let zero = parts.next()?;
        return Some(Path::new("/storage/emulated").join(zero));
    }
    if first == "self" {
        return None;
    }
    Some(Path::new("/storage").join(first))
}

fn trash_dir(root: &Path) -> PathBuf {
    root.join(TRASH_DIR)
}

fn meta_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// id を作る（時刻とカウンタ。同じ時刻でも重ならない）
fn new_id(now_ms: u64, seq: u64) -> String {
    format!("{now_ms:013}-{seq:06}")
}

/// 保存領域の中の項目を、その領域のゴミ箱へ移す（時刻と連番は、ここで決める）。保存領域が分からなければ `unsupported`
// 段階 B（画面の接続）まで、Android の削除はこれを使わない（ゴミ箱の画面が無いあいだは、隠れたゴミ箱を作らない）
#[allow(dead_code)]
pub fn trash_path(path: &Path) -> FsResult<TrashItem> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let root = volume_root(path).ok_or_else(|| FsError::new("unsupported", "この場所にはゴミ箱がありません（内部ストレージと SD カードの中だけ）"))?;
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    trash_into(path, &root, now_ms, SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

/// `path` をゴミ箱へ移す。`root` は、path と同じ保存領域の根
pub fn trash_into(path: &Path, root: &Path, now_ms: u64, seq: u64) -> FsResult<TrashItem> {
    let meta = fs::symlink_metadata(path).map_err(|e| FsError::io(&e, path))?;
    if !path.starts_with(root) {
        return Err(FsError::new("invalid", format!("保存領域の外です: {}", path.display())));
    }
    let dir = trash_dir(root);
    fs::create_dir_all(&dir).map_err(|e| FsError::io(&e, &dir))?;
    let id = new_id(now_ms, seq);
    let kind = if meta.is_dir() { "dir" } else { "file" };
    let size = if meta.is_file() { meta.len() } else { 0 };
    let item = TrashItem { id: id.clone(), original_path: path.to_string_lossy().into_owned(), kind: kind.into(), size, deleted_at: now_ms };
    // 先に印（json）を書き、次に移す。移せなければ印を消す（中身の無い印だけを残さない）
    let json = serde_json::to_vec(&item).map_err(|e| FsError::new("io", e.to_string()))?;
    let meta_file = meta_path(&dir, &id);
    fs::write(&meta_file, json).map_err(|e| FsError::io(&e, &meta_file))?;
    let target = dir.join(&id);
    if let Err(e) = fs::rename(path, &target) {
        let _ = fs::remove_file(&meta_file);
        return Err(FsError::io(&e, path));
    }
    Ok(item)
}

/// ゴミ箱の中身（新しい順）。壊れた印は飛ばす
pub fn trash_list(root: &Path) -> FsResult<Vec<TrashItem>> {
    let dir = trash_dir(root);
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(FsError::io(&e, &dir)),
    };
    let mut out: Vec<TrashItem> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| fs::read(e.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<TrashItem>(&bytes).ok())
        .filter(|item| dir.join(&item.id).symlink_metadata().is_ok())
        .collect();
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(b.id.cmp(&a.id)));
    Ok(out)
}

fn load(root: &Path, id: &str) -> FsResult<TrashItem> {
    if id.is_empty() || id.contains(['/', '\\', '\0']) || id.starts_with('.') {
        return Err(FsError::new("invalid", "ゴミ箱の項目の番号が正しくありません"));
    }
    let dir = trash_dir(root);
    let file = meta_path(&dir, id);
    let bytes = fs::read(&file).map_err(|e| FsError::io(&e, &file))?;
    serde_json::from_slice(&bytes).map_err(|e| FsError::new("io", format!("ゴミ箱の印を読めません: {e}")))
}

/// ゴミ箱から元の場所へ戻す。元の場所に同名があれば戻さない（`exists`）。戻した元のパスを返す
pub fn trash_restore(root: &Path, id: &str) -> FsResult<String> {
    let item = load(root, id)?;
    let dir = trash_dir(root);
    let from = dir.join(&item.id);
    let to = PathBuf::from(&item.original_path);
    if to.symlink_metadata().is_ok() {
        return Err(FsError::new("exists", format!("元の場所に同じ名前があります: {}", to.display())));
    }
    match to.parent() {
        Some(p) if p.is_dir() => {}
        _ => return Err(FsError::new("parent_missing", format!("元のフォルダがありません: {}", to.display()))),
    }
    fs::rename(&from, &to).map_err(|e| FsError::io(&e, &to))?;
    let _ = fs::remove_file(meta_path(&dir, id));
    Ok(item.original_path)
}

/// ゴミ箱の中身を完全に消す（元に戻せない）
pub fn trash_purge(root: &Path, id: &str) -> FsResult<()> {
    let item = load(root, id)?;
    let dir = trash_dir(root);
    let target = dir.join(&item.id);
    let meta = target.symlink_metadata().map_err(|e| FsError::io(&e, &target))?;
    if meta.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| FsError::io(&e, &target))?;
    } else {
        fs::remove_file(&target).map_err(|e| FsError::io(&e, &target))?;
    }
    let _ = fs::remove_file(meta_path(&dir, id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn volume_root_of_android_paths() {
        assert_eq!(volume_root(Path::new("/storage/emulated/0/Download/a.txt")), Some(PathBuf::from("/storage/emulated/0")));
        assert_eq!(volume_root(Path::new("/storage/1A2B-3C4D/x")), Some(PathBuf::from("/storage/1A2B-3C4D")));
        assert_eq!(volume_root(Path::new("/storage/self/primary/x")), None);
        assert_eq!(volume_root(Path::new("/home/me/x")), None);
    }

    #[test]
    fn trash_moves_the_item_and_restore_puts_it_back() {
        let root = tmp();
        let file = root.path().join("a.txt");
        fs::write(&file, b"hello").unwrap();
        let item = trash_into(&file, root.path(), 1000, 1).unwrap();
        assert!(!file.exists());
        assert_eq!((item.kind.as_str(), item.size, item.deleted_at), ("file", 5, 1000));
        let listed = trash_list(root.path()).unwrap();
        assert_eq!(listed, vec![item.clone()]);
        assert_eq!(trash_restore(root.path(), &item.id).unwrap(), file.to_string_lossy());
        assert_eq!(fs::read(&file).unwrap(), b"hello");
        assert!(trash_list(root.path()).unwrap().is_empty());
    }

    #[test]
    fn folders_go_to_trash_whole_and_purge_removes_them() {
        let root = tmp();
        let dir = root.path().join("d");
        fs::create_dir_all(dir.join("inner")).unwrap();
        fs::write(dir.join("inner/x"), b"1").unwrap();
        let item = trash_into(&dir, root.path(), 5, 1).unwrap();
        assert_eq!(item.kind, "dir");
        assert!(root.path().join(TRASH_DIR).join(&item.id).join("inner/x").is_file());
        trash_purge(root.path(), &item.id).unwrap();
        assert!(trash_list(root.path()).unwrap().is_empty());
        assert!(!root.path().join(TRASH_DIR).join(&item.id).exists());
    }

    #[test]
    fn restore_never_overwrites_and_needs_the_parent() {
        let root = tmp();
        let file = root.path().join("a.txt");
        fs::write(&file, b"old").unwrap();
        let item = trash_into(&file, root.path(), 1, 1).unwrap();
        fs::write(&file, b"new").unwrap();
        assert_eq!(trash_restore(root.path(), &item.id).unwrap_err().code, "exists");
        assert_eq!(fs::read(&file).unwrap(), b"new");
        // 元のフォルダが無くなっていたら、作らずに失敗する
        fs::remove_file(&file).unwrap();
        let gone = root.path().join("sub");
        fs::create_dir_all(&gone).unwrap();
        let f2 = gone.join("b.txt");
        fs::write(&f2, b"x").unwrap();
        let i2 = trash_into(&f2, root.path(), 2, 2).unwrap();
        fs::remove_dir_all(&gone).unwrap();
        assert_eq!(trash_restore(root.path(), &i2.id).unwrap_err().code, "parent_missing");
        assert!(!gone.exists());
    }

    #[test]
    fn ids_from_outside_are_refused_and_broken_marks_are_skipped() {
        let root = tmp();
        assert_eq!(trash_purge(root.path(), "../x").unwrap_err().code, "invalid");
        assert_eq!(trash_restore(root.path(), ".hidden").unwrap_err().code, "invalid");
        let dir = root.path().join(TRASH_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("bad.json"), b"{not json").unwrap();
        assert!(trash_list(root.path()).unwrap().is_empty());
    }

    #[test]
    fn trash_refuses_paths_outside_the_volume() {
        let root = tmp();
        let other = tmp();
        let file = other.path().join("a");
        fs::write(&file, b"x").unwrap();
        assert_eq!(trash_into(&file, root.path(), 1, 1).unwrap_err().code, "invalid");
        assert!(file.exists());
    }
}
