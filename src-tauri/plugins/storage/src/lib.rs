//! Android の「すべてのファイルへのアクセス」（MANAGE_EXTERNAL_STORAGE）と、資格情報の箱（Android Keystore の鍵で包んだファイル）。
//! 確認（check）と、設定画面を開く（request）は、WebView から呼べる（default の権限）。
//! 資格情報（secret_get・secret_set・secret_delete）は Rust（webdav::secret の OsStore）からだけ呼ぶ。権限は WebView へ出さない。
//! 権限を与えたかどうかは、戻ってきたあとに check で確かめる（設定画面の結果は受け取れない）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use std::sync::OnceLock;

/// Kotlin のプラグインを呼ぶ口（Android だけ）。`init` の setup で入る
#[cfg(target_os = "android")]
type Call = Box<dyn Fn(&str, serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>;

#[cfg(target_os = "android")]
static CALL: OnceLock<Call> = OnceLock::new();

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("fixplor-storage")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("dev.fixplor.storage", "StoragePlugin")?;
                let _ = CALL.set(Box::new(move |command, payload| {
                    handle.run_mobile_plugin::<serde_json::Value>(command, payload).map_err(|e| e.to_string())
                }));
            }
            Ok(())
        })
        .build()
}

/// 資格情報の箱（Kotlin）を呼ぶ。Android 以外・登録の前は失敗する（呼び出し側は「使えない」にする）
#[cfg(target_os = "android")]
pub fn call_secret(command: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let call = CALL.get().ok_or_else(|| "プラグインが登録されていません".to_string())?;
    call(command, payload)
}
