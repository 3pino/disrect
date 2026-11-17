//! デバイスの事実（OS の種類）を WebView に渡す。
//!
//! 値は `window.__FIXPLOR_PLATFORM__` に、ページの読込より前に同期で入る（`js_init_script`）。
//! TS 側は `@3pino/app-kit-web/core/platform` がこれを読む（名前は `src/lib/platformGlobal.ts` で教える）。
//! 判定は cfg! で決まり、UA 文字列は使わない。値が無い・壊れているときは、TS が UA から推測する。
//! 形は土台の `InjectedPlatform`（os・desktop・android・capabilities）。fixplor はアプリごとの方針を持たないので capabilities は null。

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlatformInfo {
    /// "windows" | "linux" | "android" | "other"
    pub os: &'static str,
    pub desktop: bool,
    pub android: bool,
    pub capabilities: Option<serde_json::Value>,
}

/// 今のビルドのデバイスの事実
pub fn info() -> PlatformInfo {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    };
    PlatformInfo {
        os,
        desktop: cfg!(desktop),
        android: cfg!(target_os = "android"),
        capabilities: None,
    }
}

/// main frame の読込より前に入れる一行。値が直列化できないときは null（TS は推測する）
pub fn init_script(info: &PlatformInfo) -> String {
    let json = serde_json::to_string(info).unwrap_or_else(|_| "null".to_owned());
    format!("window.__FIXPLOR_PLATFORM__ = {json};")
}

/// `window.__FIXPLOR_PLATFORM__` を入れるプラグイン（コマンドは持たない。権限も要らない）
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("fixplor-platform").js_init_script(init_script(&info())).build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_name_matches_the_build_target() {
        #[cfg(target_os = "windows")]
        assert_eq!(info().os, "windows");
        #[cfg(target_os = "linux")]
        assert_eq!(info().os, "linux");
        #[cfg(target_os = "android")]
        assert_eq!(info().os, "android");
    }

    #[test]
    fn desktop_and_android_are_exclusive() {
        let i = info();
        assert!(!(i.desktop && i.android), "{i:?}");
        if i.android {
            assert_eq!(i.os, "android");
        }
    }

    /// TS（土台の injectedPlatform）が読む形: os（文字列）・desktop・android（真偽値）・capabilities（null か表）。名前は platformGlobal.ts と同じ
    #[test]
    fn script_assigns_the_global_the_app_kit_reads() {
        let script = init_script(&info());
        let json = script
            .strip_prefix("window.__FIXPLOR_PLATFORM__ = ")
            .and_then(|s| s.strip_suffix(';'))
            .expect("名前と形");
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        assert!(v["os"].is_string());
        assert!(v["desktop"].is_boolean());
        assert!(v["android"].is_boolean());
        assert!(v["capabilities"].is_null());
    }
}
