//! Android のアプリの更新。Tauri の updater は Android に対応していないので、自前で行う。
//! - `download_apk`（Rust）: GitHub のリリースの APK を、キャッシュの中へ、進みを知らせながら取る。
//!   取れたら、ファイルの先頭が zip（APK）かを確かめる。署名は、インストーラーが「今の版と同じ署名か」で確かめる。
//! - `can_install` / `open_install_settings` / `install_apk`（Kotlin）: 「不明なアプリのインストール」の許可、設定画面、インストーラーを開く。
//!
//! Disnans の apk-updater（plugins/apk-updater）と同じ考え。Disnans のものとは共有せず、fixplor の名前で書き直した（重複あり）。

use serde::Serialize;
use tauri::{
    command,
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

/// 取得の進み（downloaded・total は、サーバーが大きさを言わなければ null）
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// 取ってよい APK の置き場所（GitHub のリリース）。https だけ
pub fn allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    matches!(host, "github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com")
}

/// zip（APK）の先頭の印
pub fn looks_like_apk(head: &[u8]) -> bool {
    head.len() >= 4 && &head[..4] == b"PK\x03\x04"
}

const UPDATE_DIR: &str = "update";
const FILE_NAME: &str = "fixplor.apk";

#[command]
async fn download_apk<R: Runtime>(app: AppHandle<R>, url: String, on_progress: Channel<Progress>) -> Result<String, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    if !allowed_url(&url) {
        return Err("取得先が、GitHub のリリースではありません".into());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(UPDATE_DIR);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let part = dir.join(format!("{FILE_NAME}.part"));
    let done = dir.join(FILE_NAME);

    let client = reqwest::Client::builder().user_agent("fixplor-updater").build().map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|_| "GitHub に接続できません".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub に接続できません (HTTP {})", resp.status().as_u16()));
    }
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut head: Vec<u8> = Vec::with_capacity(4);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "取得の途中で通信が切れました".to_string())?;
        if head.len() < 4 {
            head.extend_from_slice(&chunk[..chunk.len().min(4 - head.len())]);
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = on_progress.send(Progress { downloaded, total });
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if !looks_like_apk(&head) || total.is_some_and(|t| t != downloaded) {
        let _ = tokio::fs::remove_file(&part).await;
        return Err("取った APK が壊れています".into());
    }
    tokio::fs::rename(&part, &done).await.map_err(|e| e.to_string())?;
    Ok(done.to_string_lossy().into_owned())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("fixplor-updater")
        .invoke_handler(tauri::generate_handler![download_apk])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle: PluginHandle<R> = _api.register_android_plugin("dev.fixplor.updater", "UpdaterPlugin")?;
                _app.manage(UpdaterHandle(handle));
            }
            Ok(())
        })
        .build()
}

/// Kotlin のプラグインへの受け口（Android だけ）
#[cfg(target_os = "android")]
pub struct UpdaterHandle<R: Runtime>(pub PluginHandle<R>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_github_release_hosts_over_https() {
        assert!(allowed_url("https://github.com/3pino/fixplor/releases/download/v1/fixplor.apk"));
        assert!(allowed_url("https://objects.githubusercontent.com/x/y.apk?sig=1"));
        assert!(!allowed_url("http://github.com/3pino/fixplor/releases/download/v1/fixplor.apk"));
        assert!(!allowed_url("https://github.com.evil.example/x.apk"));
        assert!(!allowed_url("https://evil.example/github.com/x.apk"));
        assert!(!allowed_url("file:///etc/passwd"));
    }

    #[test]
    fn a_zip_head_is_an_apk() {
        assert!(looks_like_apk(b"PK\x03\x04rest"));
        assert!(!looks_like_apk(b"<html>"));
        assert!(!looks_like_apk(b"PK"));
    }
}
