use serde::Serialize;
use std::path::PathBuf;

/// 左の一覧に出す場所。名前は画面が `kind` から決める（volume だけ `name` を使う）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Place {
    /// home / desktop / documents / downloads / pictures / music / videos / root / volume
    pub kind: &'static str,
    pub path: String,
    /// volume の表示名（マウント先の最後の名前・ドライブ文字）。ほかは空
    pub name: String,
}

pub fn places() -> Vec<Place> {
    #[cfg(target_os = "android")]
    return android_places(std::path::Path::new(ANDROID_STORAGE));
    #[cfg(not(target_os = "android"))]
    {
        let mut out = Vec::new();
        let mut known = |kind: &'static str, path: Option<PathBuf>| {
            // 設定されていても、実際に無いフォルダは出さない
            if let Some(p) = path.filter(|p| p.is_dir()) {
                out.push(Place {
                    kind,
                    path: p.to_string_lossy().into_owned(),
                    name: String::new(),
                });
            }
        };
        known("home", dirs::home_dir());
        known("desktop", dirs::desktop_dir());
        known("documents", dirs::document_dir());
        known("downloads", dirs::download_dir());
        known("pictures", dirs::picture_dir());
        known("music", dirs::audio_dir());
        known("videos", dirs::video_dir());
        out.extend(volumes());
        out
    }
}

/// 最初に開く場所（ホーム。取れなければルート）
pub fn start_dir() -> String {
    #[cfg(target_os = "android")]
    return android_start_dir(std::path::Path::new(ANDROID_STORAGE));
    #[cfg(not(target_os = "android"))]
    {
        dirs::home_dir()
            .filter(|p| p.is_dir())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| root_path().to_string())
    }
}

/// Android の保存領域の根（全ファイルへのアクセスの許可があるとき、ここの下を読める）
#[cfg(target_os = "android")]
const ANDROID_STORAGE: &str = "/storage";

/// Android の場所: 内部ストレージ（`emulated/0`）と、その中の利用者のフォルダ・SD カードなど（`/storage/<id>`）。
/// `/` や `/mnt/...` の内部のマウントは出さない（読めないか、同じものの別の見え方）
#[cfg(any(target_os = "android", test))]
fn android_places(storage: &std::path::Path) -> Vec<Place> {
    let primary = storage.join("emulated").join("0");
    let mut out = Vec::new();
    if primary.is_dir() {
        out.push(Place {
            kind: "volume",
            path: primary.to_string_lossy().into_owned(),
            name: "内部ストレージ".into(),
        });
        for (kind, dir) in [
            ("downloads", "Download"),
            ("pictures", "Pictures"),
            ("music", "Music"),
            ("videos", "Movies"),
            ("documents", "Documents"),
        ] {
            let p = primary.join(dir);
            if p.is_dir() {
                out.push(Place {
                    kind,
                    path: p.to_string_lossy().into_owned(),
                    name: String::new(),
                });
            }
        }
    }
    let mut others: Vec<PathBuf> = std::fs::read_dir(storage)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .is_some_and(|n| n != "emulated" && n != "self")
        })
        .collect();
    others.sort();
    for p in others {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push(Place {
            kind: "volume",
            path: p.to_string_lossy().into_owned(),
            name: format!("SD カード（{name}）"),
        });
    }
    out
}

/// Android の最初に開く場所（内部ストレージ。読めなければ `/storage`）
#[cfg(any(target_os = "android", test))]
fn android_start_dir(storage: &std::path::Path) -> String {
    let primary = storage.join("emulated").join("0");
    if primary.is_dir() {
        primary.to_string_lossy().into_owned()
    } else {
        storage.to_string_lossy().into_owned()
    }
}

#[cfg(windows)]
fn root_path() -> &'static str {
    "C:\\"
}

#[cfg(all(not(windows), not(target_os = "android")))]
fn root_path() -> &'static str {
    "/"
}

#[cfg(windows)]
fn volumes() -> Vec<Place> {
    ('A'..='Z')
        .map(|c| format!("{c}:\\"))
        .filter(|p| std::path::Path::new(p).is_dir())
        .map(|p| Place {
            kind: "volume",
            name: p[..2].to_string(),
            path: p,
        })
        .collect()
}

#[cfg(all(not(windows), not(target_os = "android")))]
fn volumes() -> Vec<Place> {
    let mut out = vec![Place {
        kind: "root",
        path: "/".into(),
        name: String::new(),
    }];
    // Linux: 取り外せるメディアなどのマウント先。読めなければ（ほかの OS など）ルートだけ
    if let Ok(text) = std::fs::read_to_string("/proc/self/mounts") {
        for path in removable_mounts(&text) {
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            out.push(Place {
                kind: "volume",
                path,
                name,
            });
        }
    }
    out
}

/// `/proc/self/mounts` から、利用者が差したメディアなどのマウント先（/media・/run/media・/mnt の下）を取り出す
#[cfg_attr(any(windows, target_os = "android"), allow(dead_code))]
pub fn removable_mounts(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let Some(raw) = line.split(' ').nth(1) else {
            continue;
        };
        let path = unescape_mount(raw);
        let user_mount = ["/media/", "/run/media/", "/mnt/"]
            .iter()
            .any(|p| path.starts_with(p));
        if user_mount && !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

/// mounts の中の `\040`（空白）などの 8 進の書き方を戻す
fn unescape_mount(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && i + 3 < bytes.len()
            && bytes[i + 1..i + 4]
                .iter()
                .all(|b| (b'0'..=b'7').contains(b))
        {
            let v = (bytes[i + 1] - b'0') as u32 * 64
                + (bytes[i + 2] - b'0') as u32 * 8
                + (bytes[i + 3] - b'0') as u32;
            if let Ok(b) = u8::try_from(v) {
                out.push(b);
                i += 4;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_lists_the_internal_storage_folders_and_sd_cards() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("emulated").join("0");
        for d in ["Download", "Pictures", "Movies", "DCIM"] {
            std::fs::create_dir_all(primary.join(d)).unwrap();
        }
        std::fs::create_dir_all(root.path().join("self")).unwrap();
        std::fs::create_dir_all(root.path().join("1A2B-3C4D")).unwrap();
        std::fs::write(root.path().join("file.txt"), b"x").unwrap();
        let got: Vec<(&str, String)> = android_places(root.path())
            .into_iter()
            .map(|p| (p.kind, p.name))
            .collect();
        assert_eq!(
            got,
            vec![
                ("volume", "内部ストレージ".to_string()),
                ("downloads", String::new()),
                ("pictures", String::new()),
                ("videos", String::new()),
                ("volume", "SD カード（1A2B-3C4D）".to_string()),
            ]
        );
        assert_eq!(android_start_dir(root.path()), primary.to_string_lossy());
    }

    #[test]
    fn android_start_falls_back_to_the_storage_root() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            android_start_dir(root.path()),
            root.path().to_string_lossy()
        );
        assert!(android_places(root.path()).is_empty());
    }

    #[test]
    fn picks_user_mounts_and_unescapes_spaces() {
        let text = "\
/dev/nvme0n1p2 / ext4 rw 0 0
proc /proc proc rw 0 0
/dev/sda1 /media/me/USB\\040DISK vfat rw 0 0
/dev/sdb1 /run/media/me/backup ext4 rw 0 0
//nas/share /mnt/nas cifs rw 0 0
/dev/sda1 /media/me/USB\\040DISK vfat rw 0 0
tmpfs /run/user/1000 tmpfs rw 0 0
";
        assert_eq!(
            removable_mounts(text),
            vec!["/media/me/USB DISK", "/run/media/me/backup", "/mnt/nas"]
        );
    }

    #[test]
    fn a_trailing_backslash_is_kept_as_is() {
        assert_eq!(unescape_mount("/mnt/a\\"), "/mnt/a\\");
        assert_eq!(unescape_mount("/mnt/a\\04"), "/mnt/a\\04");
        assert_eq!(unescape_mount("/mnt/a\\134b"), "/mnt/a\\b");
    }
}
