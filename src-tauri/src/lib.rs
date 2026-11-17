pub mod fs;
pub mod platform;
pub mod webdav;

use fs::{Entry, FsError, FsResult, Place, Size};
use tauri_plugin_opener::OpenerExt;

// コマンドは、ファイルの読み書きで画面を止めないよう、別のスレッドで動かす。
// パスは絶対パスだけを受ける（fs::abs）。
// 環境変数 FIXPLOR_TRACE があると、コマンドの名前と結果（ok か、失敗の code）だけを標準エラーに出す
// （パスや中身は出さない。起動の確認・不具合の切り分け用）。

fn trace<T>(name: &str, result: &FsResult<T>) {
    if std::env::var_os("FIXPLOR_TRACE").is_none() {
        return;
    }
    match result {
        Ok(_) => eprintln!("[trace] {name} ok"),
        Err(e) => eprintln!("[trace] {name} {}", e.code),
    }
}

async fn blocking<T, F>(name: &'static str, f: F) -> FsResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> FsResult<T> + Send + 'static,
{
    let result = match tauri::async_runtime::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => Err(FsError::new("io", format!("処理を終えられませんでした: {e}"))),
    };
    trace(name, &result);
    result
}

#[tauri::command]
async fn fs_list(path: String) -> FsResult<Vec<Entry>> {
    blocking("fs_list", move || fs::list(&fs::abs(&path)?)).await
}

#[tauri::command]
async fn fs_stat(path: String) -> FsResult<Entry> {
    blocking("fs_stat", move || fs::entry_of(&fs::abs(&path)?)).await
}

#[tauri::command]
async fn fs_mkdir(path: String) -> FsResult<Entry> {
    blocking("fs_mkdir", move || fs::mkdir(&fs::abs(&path)?)).await
}

/// ファイルを書く。中身は生のバイト列で受ける（JSON にしない）。パスはヘッダー `x-path`（URL の形に符号化）
#[tauri::command]
async fn fs_write(request: tauri::ipc::Request<'_>) -> FsResult<Entry> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(FsError::new("invalid", "中身がバイト列ではありません"));
    };
    let raw = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| FsError::new("invalid", "パスがありません"))?;
    let path = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| FsError::new("invalid", "パスを読めません"))?
        .into_owned();
    let body = body.clone();
    blocking("fs_write", move || fs::write_file(&fs::abs(&path)?, &body)).await
}

#[tauri::command]
async fn fs_move(from: String, to: String, overwrite: Option<bool>) -> FsResult<Entry> {
    blocking("fs_move", move || fs::rename(&fs::abs(&from)?, &fs::abs(&to)?, overwrite.unwrap_or(false))).await
}

#[tauri::command]
async fn fs_copy(from: String, to: String, overwrite: Option<bool>) -> FsResult<Entry> {
    blocking("fs_copy", move || fs::copy(&fs::abs(&from)?, &fs::abs(&to)?, overwrite.unwrap_or(false))).await
}

#[tauri::command]
async fn fs_trash(path: String) -> FsResult<()> {
    blocking("fs_trash", move || fs::trash(&fs::abs(&path)?)).await
}

#[tauri::command]
async fn fs_size(path: String) -> FsResult<Size> {
    blocking("fs_size", move || fs::size(&fs::abs(&path)?)).await
}

#[tauri::command]
async fn fs_places() -> FsResult<Vec<Place>> {
    blocking("fs_places", || Ok(fs::places())).await
}

#[tauri::command]
fn fs_start_dir() -> String {
    fs::start_dir()
}

/// ファイルを、OS の既定のアプリで開く
#[tauri::command]
fn fs_open(app: tauri::AppHandle, path: String) -> FsResult<()> {
    let p = fs::abs(&path)?;
    std::fs::symlink_metadata(&p).map_err(|e| FsError::io(&e, &p))?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| FsError::new("io", format!("開けませんでした: {e}")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (http, jobs) = webdav::commands::state();
    tauri::Builder::default()
        .manage(http)
        .manage(jobs)
        .plugin(tauri_plugin_opener::init())
        .plugin(platform::plugin())
        .invoke_handler(tauri::generate_handler![
            fs_list,
            fs_stat,
            fs_mkdir,
            fs_write,
            fs_move,
            fs_copy,
            fs_trash,
            fs_size,
            fs_places,
            fs_start_dir,
            fs_open,
            webdav::commands::dav_list,
            webdav::commands::dav_stat,
            webdav::commands::dav_mkdir,
            webdav::commands::dav_put,
            webdav::commands::dav_move,
            webdav::commands::dav_copy,
            webdav::commands::dav_remove,
            webdav::commands::dav_size,
            webdav::commands::dav_download,
            webdav::commands::dav_cancel
        ])
        .run(tauri::generate_context!())
        .expect("fixplor を起動できませんでした");
}
