// コマンドの実体: download_apk は Rust（src/lib.rs）、ほかは Kotlin（android/）。ここでは権限の生成だけをする
const COMMANDS: &[&str] = &["can_install", "open_install_settings", "install_apk", "download_apk"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
