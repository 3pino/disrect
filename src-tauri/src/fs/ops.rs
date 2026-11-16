use super::entry::{entry_of, Entry};
use super::error::{FsError, FsResult};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

// 書き込みの決まり（どの操作も同じ）:
// - 黙って上書きしない。同名があれば `exists`。`overwrite` が真のときだけ、ファイルをファイルで置き換える
//   （フォルダは置き換えない・混ぜない）。
// - コピーは、宛先のフォルダの中の一時の名前へ書き終えてから、本当の名前へ付け替える
//   （途中で失敗しても、宛先に書きかけを残さない・置き換える前のファイルを壊さない）。
// - 消すのはゴミ箱だけ（`trash`）。ゴミ箱へ入れられないときに、完全に消す方へ切り替えない。

/// 新しいフォルダを作る。親が無ければ `parent_missing`、同名があれば `exists`
pub fn mkdir(path: &Path) -> FsResult<Entry> {
    require_parent(path)?;
    fs::create_dir(path).map_err(|e| FsError::io(&e, path))?;
    entry_of(path)
}

/// 移動・名前の変更
pub fn rename(from: &Path, to: &Path, overwrite: bool) -> FsResult<Entry> {
    check_target(from, to, overwrite)?;
    match fs::rename(from, to) {
        Ok(()) => {}
        // 別のデバイス（別のドライブ・USB など）へは付け替えられない。コピーしてから元を消す
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
            copy_into_place(from, to)?;
            remove_source(from).map_err(|e| {
                FsError::new("partial", format!("コピーは終わりましたが、元を消せませんでした: {}", e.message))
            })?;
        }
        Err(e) => return Err(FsError::io(&e, from)),
    }
    entry_of(to)
}

/// コピー（フォルダは中身ごと。シンボリックリンクは辿らず、リンクのまま写す）
pub fn copy(from: &Path, to: &Path, overwrite: bool) -> FsResult<Entry> {
    check_target(from, to, overwrite)?;
    copy_into_place(from, to)?;
    entry_of(to)
}

/// ゴミ箱へ入れる（OS のゴミ箱。そこから戻せる）
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn trash(path: &Path) -> FsResult<()> {
    fs::symlink_metadata(path).map_err(|e| FsError::io(&e, path))?;
    trash::delete(path).map_err(|e| FsError::new("io", format!("ゴミ箱へ入れられませんでした: {}: {e}", path.display())))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn trash(_path: &Path) -> FsResult<()> {
    Err(FsError::new("unsupported", "この OS にはゴミ箱がありません"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Size {
    /// 配下のファイルの合計（バイト）
    pub size: u64,
    pub files: u64,
    /// 配下のフォルダの数（自分は数えない）
    pub dirs: u64,
    /// 読めないフォルダがあって、数え切れていない
    pub partial: bool,
}

/// 大きさを数える。シンボリックリンクは辿らない（リンクそのものの大きさだけ）
pub fn size(path: &Path) -> FsResult<Size> {
    let meta = fs::symlink_metadata(path).map_err(|e| FsError::io(&e, path))?;
    let mut total = Size { size: 0, files: 0, dirs: 0, partial: false };
    if !meta.is_dir() {
        total.size = meta.len();
        total.files = 1;
        return Ok(total);
    }
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else {
            total.partial = true;
            continue;
        };
        for item in rd {
            let Ok(item) = item else {
                total.partial = true;
                continue;
            };
            let Ok(meta) = fs::symlink_metadata(item.path()) else {
                total.partial = true;
                continue;
            };
            if meta.is_dir() {
                total.dirs += 1;
                stack.push(item.path());
            } else {
                total.files += 1;
                total.size += meta.len();
            }
        }
    }
    Ok(total)
}

fn require_parent(path: &Path) -> FsResult<PathBuf> {
    let parent = path.parent().ok_or_else(|| FsError::new("invalid", "親のフォルダがありません"))?;
    match fs::metadata(parent) {
        Ok(m) if m.is_dir() => Ok(parent.to_path_buf()),
        Ok(_) => Err(FsError::new("not_dir", format!("フォルダではありません: {}", parent.display()))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            Err(FsError::new("parent_missing", format!("親のフォルダがありません: {}", parent.display())))
        }
        Err(e) => Err(FsError::io(&e, parent)),
    }
}

/// 移動・コピーの前の確かめ。宛先へ書いてよいときだけ Ok
fn check_target(from: &Path, to: &Path, overwrite: bool) -> FsResult<()> {
    let src = fs::symlink_metadata(from).map_err(|e| FsError::io(&e, from))?;
    let to_parent = require_parent(to)?;
    let src_is_dir = src.is_dir();
    if src_is_dir {
        // フォルダを、自分自身・自分の中へは入れられない（リンクを辿った本当の場所で比べる）
        let real_from = fs::canonicalize(from).map_err(|e| FsError::io(&e, from))?;
        let real_parent = fs::canonicalize(&to_parent).map_err(|e| FsError::io(&e, &to_parent))?;
        let real_to = match to.file_name() {
            Some(n) => real_parent.join(n),
            None => real_parent.clone(),
        };
        if real_to != real_from && real_to.starts_with(&real_from) {
            return Err(FsError::new("into_self", "フォルダを、そのフォルダの中へは入れられません"));
        }
    }
    let dst = match fs::symlink_metadata(to) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(FsError::io(&e, to)),
    };
    if same_target(from, to) {
        // 大文字・小文字だけの名前の変更（区別しないファイルシステムでは、宛先が「ある」ように見える）
        if case_only_rename(from, to) && !src.file_type().is_symlink() {
            return Ok(());
        }
        return Err(FsError::new("same_path", "元と宛先が同じです"));
    }
    if !overwrite {
        return Err(FsError::new("exists", format!("同じ名前があります: {}", to.display())));
    }
    // 上書きは、ファイルをファイルで置き換えるときだけ
    if src_is_dir || dst.is_dir() {
        return Err(FsError::new("exists", format!("フォルダは上書きできません: {}", to.display())));
    }
    Ok(())
}

/// 2 つのパスが同じものを指すか（どちらも在るとき）
fn same_target(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn case_only_rename(from: &Path, to: &Path) -> bool {
    if from.parent() != to.parent() {
        return false;
    }
    match (from.file_name(), to.file_name()) {
        (Some(a), Some(b)) => a != b && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase(),
        _ => false,
    }
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 宛先と同じフォルダの中の、一時の名前（同じデバイスなので、付け替えは一瞬で終わる）
fn temp_sibling(to: &Path) -> FsResult<PathBuf> {
    let parent = to.parent().ok_or_else(|| FsError::new("invalid", "親のフォルダがありません"))?;
    let n = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    Ok(parent.join(format!(".fixplor-{}-{n}-{nanos}.part", std::process::id())))
}

/// 一時の名前へ写し終えてから、宛先の名前へ付け替える。失敗したら一時のものを片付ける
fn copy_into_place(from: &Path, to: &Path) -> FsResult<()> {
    let tmp = temp_sibling(to)?;
    if let Err(e) = copy_any(from, &tmp) {
        discard_temp(&tmp);
        return Err(e);
    }
    if let Err(e) = fs::rename(&tmp, to) {
        discard_temp(&tmp);
        return Err(FsError::io(&e, to));
    }
    Ok(())
}

/// 自分で作った一時のものだけを消す（`copy_any` は必ず新しく作るので、前からあったものは消さない）
fn discard_temp(tmp: &Path) {
    let Ok(meta) = fs::symlink_metadata(tmp) else { return };
    let r = if meta.is_dir() { fs::remove_dir_all(tmp) } else { fs::remove_file(tmp) };
    if let Err(e) = r {
        eprintln!("[fs] 一時のファイルを片付けられませんでした: {}: {e}", tmp.display());
    }
}

fn copy_any(from: &Path, dst: &Path) -> FsResult<()> {
    let meta = fs::symlink_metadata(from).map_err(|e| FsError::io(&e, from))?;
    let ft = meta.file_type();
    if ft.is_symlink() {
        return copy_symlink(from, dst);
    }
    if ft.is_dir() {
        fs::create_dir(dst).map_err(|e| FsError::io(&e, dst))?;
        let rd = fs::read_dir(from).map_err(|e| FsError::io(&e, from))?;
        for item in rd {
            let item = item.map_err(|e| FsError::io(&e, from))?;
            copy_any(&item.path(), &dst.join(item.file_name()))?;
        }
        // 中身を書き終えてから、権限を合わせる（読み取り専用のフォルダでも中身を写せるように）
        fs::set_permissions(dst, meta.permissions()).map_err(|e| FsError::io(&e, dst))?;
        return Ok(());
    }
    if ft.is_file() {
        // 新しく作る（すでに在れば失敗）。一時の名前が、たまたま在るものと重なっても上書きしない
        let mut src = fs::File::open(from).map_err(|e| FsError::io(&e, from))?;
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(dst).map_err(|e| FsError::io(&e, dst))?;
        io::copy(&mut src, &mut out).map_err(|e| FsError::io(&e, dst))?;
        // 更新時刻は元と同じにする（出来なければそのまま。コピーは成功）
        if let Ok(t) = meta.modified() {
            let _ = out.set_modified(t);
        }
        out.sync_all().map_err(|e| FsError::io(&e, dst))?;
        drop(out);
        fs::set_permissions(dst, meta.permissions()).map_err(|e| FsError::io(&e, dst))?;
        return Ok(());
    }
    // ソケット・デバイスなど
    Err(FsError::new("unsupported", format!("この種類のファイルはコピーできません: {}", from.display())))
}

#[cfg(unix)]
fn copy_symlink(from: &Path, dst: &Path) -> FsResult<()> {
    let target = fs::read_link(from).map_err(|e| FsError::io(&e, from))?;
    std::os::unix::fs::symlink(target, dst).map_err(|e| FsError::io(&e, dst))
}

#[cfg(windows)]
fn copy_symlink(from: &Path, dst: &Path) -> FsResult<()> {
    let target = fs::read_link(from).map_err(|e| FsError::io(&e, from))?;
    let dir = fs::metadata(from).map(|m| m.is_dir()).unwrap_or(false);
    let r = if dir {
        std::os::windows::fs::symlink_dir(target, dst)
    } else {
        std::os::windows::fs::symlink_file(target, dst)
    };
    r.map_err(|e| FsError::io(&e, dst))
}

#[cfg(not(any(unix, windows)))]
fn copy_symlink(from: &Path, _dst: &Path) -> FsResult<()> {
    Err(FsError::new("unsupported", format!("リンクはコピーできません: {}", from.display())))
}

/// 別のデバイスへの移動で、コピーが終わったあとに元を消す
fn remove_source(from: &Path) -> FsResult<()> {
    let meta = fs::symlink_metadata(from).map_err(|e| FsError::io(&e, from))?;
    let r = if meta.is_dir() { fs::remove_dir_all(from) } else { fs::remove_file(from) };
    r.map_err(|e| FsError::io(&e, from))
}

/// ファイルを書く（作成・上書き）。同名のファイルは置き換える（呼ぶ側が先に確かめる）。フォルダは置き換えない。
/// 一時の名前へ書き終えてから付け替えるので、失敗しても前の中身は残る
pub fn write_file(path: &Path, body: &[u8]) -> FsResult<Entry> {
    require_parent(path)?;
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => return Err(FsError::new("is_dir", format!("同じ名前のフォルダがあります: {}", path.display()))),
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(FsError::io(&e, path)),
    }
    let tmp = temp_sibling(path)?;
    let written = (|| -> io::Result<()> {
        use std::io::Write;
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        out.write_all(body)?;
        out.sync_all()
    })();
    if let Err(e) = written {
        discard_temp(&tmp);
        return Err(FsError::io(&e, path));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        discard_temp(&tmp);
        return Err(FsError::io(&e, path));
    }
    entry_of(path)
}
