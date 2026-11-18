//! Android の「すべてのファイルへのアクセス」（MANAGE_EXTERNAL_STORAGE）。
//! 確認（check）と、設定画面を開く（request）。コマンドは Kotlin が持つ（Rust 側は受け口だけ）。
//! 権限を与えたかどうかは、戻ってきたあとに check で確かめる（設定画面の結果は受け取れない）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("fixplor-storage")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin("dev.fixplor.storage", "StoragePlugin")?;
                _app.manage(StorageHandle(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

/// Kotlin のプラグインへの受け口（Android だけ）
#[cfg(target_os = "android")]
pub struct StorageHandle<R: Runtime>(pub PluginHandle<R>);
