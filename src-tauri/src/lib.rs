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

/// 動いている検索（画面が付けた job の名前 → 中止の旗）
#[derive(Default)]
struct Searches(std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>);

/// フォルダの中（サブフォルダも）から、名前に文字を含む項目を探す。見つけたものは `on_hits` へ少しずつ流す。
/// `job` で `fs_search_cancel` から止められる（止めたら `aborted`）。上限で止めたときは、結果の `partial` に理由が入る
#[tauri::command]
async fn fs_search(
    searches: tauri::State<'_, Searches>,
    dir: String,
    text: String,
    show_hidden: bool,
    job: String,
    on_hits: tauri::ipc::Channel<Vec<Entry>>,
) -> FsResult<fs::Outcome> {
    let root = fs::abs(&dir)?;
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    searches.0.lock().unwrap().insert(job.clone(), cancel.clone());
    let result = blocking("fs_search", move || {
        fs::search(&root, &text, show_hidden, fs::Limits::default(), &cancel, |batch| {
            // 受け手（画面）が閉じても、検索は止めない（止めるのは cancel だけ）
            let _ = on_hits.send(batch);
        })
    })
    .await;
    searches.0.lock().unwrap().remove(&job);
    result
}

/// 検索を止める（動いていなければ false）
#[tauri::command]
fn fs_search_cancel(searches: tauri::State<'_, Searches>, job: String) -> bool {
    match searches.0.lock().unwrap().get(&job) {
        Some(flag) => {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
            true
        }
        None => false,
    }
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

/// 証明書の固定の保存先（設定フォルダ。アプリの識別子の下）。設定フォルダが無い環境では、保存しない（固定の設定は断られる）
fn pins_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("dev.fixplor.app").join("dav-pins.json"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (conns, jobs, puts) = webdav::commands::state(std::sync::Arc::new(webdav::secret::OsStore), webdav::pin::Pins::load(pins_path()));
    // 前の起動で受け取った一時のファイルのうち、古いものを消す（開いている最中のものは、消さない長さ）
    std::thread::spawn(|| {
        webdav::commands::clean_temp(&webdav::commands::temp_root(), std::time::Duration::from_secs(24 * 60 * 60));
    });
    let builder = tauri::Builder::default()
        .manage(conns)
        .manage(jobs)
        .manage(puts)
        .manage(Searches::default())
        .register_asynchronous_uri_scheme_protocol("fixdav", |ctx, request, responder| {
            use tauri::Manager;
            let conns = ctx.app_handle().state::<webdav::commands::Conns>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let range = request.headers().get("range").and_then(|v| v.to_str().ok()).map(str::to_string);
                let r = webdav::proxy::serve(&conns, request.method().as_str(), request.uri().path(), range.as_deref()).await;
                let mut b = tauri::http::Response::builder().status(r.status);
                for (k, v) in r.headers {
                    b = b.header(k, v);
                }
                if let Ok(resp) = b.body(r.body) {
                    responder.respond(resp);
                }
            });
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(platform::plugin());
    // アプリの更新（デスクトップだけ）: 公式の updater（latest.json の署名を、tauri.conf.json の公開鍵で確かめる）と、入れ替えたあとの再起動
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    builder
        .invoke_handler(tauri::generate_handler![
            fs_list,
            fs_stat,
            fs_mkdir,
            fs_write,
            fs_move,
            fs_copy,
            fs_trash,
            fs_size,
            fs_search,
            fs_search_cancel,
            fs_places,
            fs_start_dir,
            fs_open,
            webdav::commands::dav_list,
            webdav::commands::dav_stat,
            webdav::commands::dav_mkdir,
            webdav::commands::dav_put_open,
            webdav::commands::dav_put_chunk,
            webdav::commands::dav_put_finish,
            webdav::commands::dav_move,
            webdav::commands::dav_copy,
            webdav::commands::dav_remove,
            webdav::commands::dav_size,
            webdav::commands::dav_download,
            webdav::commands::dav_cancel,
            webdav::commands::dav_cred_info,
            webdav::commands::dav_cred_set,
            webdav::commands::dav_cred_clear,
            webdav::commands::dav_cert_probe,
            webdav::commands::dav_pin_info,
            webdav::commands::dav_pin_set,
            webdav::commands::dav_pin_clear
        ])
        .run(tauri::generate_context!())
        .expect("fixplor を起動できませんでした");
}
