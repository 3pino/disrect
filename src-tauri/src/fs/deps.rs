//! 外部のコマンド（依存。`fd` など）が入っているかを調べる。Tauri には依らない（`lib.rs` のコマンドが呼ぶ）。
//!
//! 名前の候補を順に `--version` で起動して、最初に答えたものを返す（Debian 系の `fdfind` のように、名前が違うことがあるため）。
//! 候補の名前は、英数字・`-`・`_`・`.` だけ（パスや引数を渡せない）。3 秒以内に答えなければ、入っていない扱い。

use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc::channel;
use std::time::Duration;

/// 見つかったコマンド
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Found {
    /// 呼べた名前（候補のうちの 1 つ）
    pub command: String,
    /// `--version` の最初の行（読めなければ空）
    pub version: String,
}

const WAIT: Duration = Duration::from_secs(3);

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn version_of(name: &str) -> Option<String> {
    let mut cmd = Command::new(name);
    cmd.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        // コンソールの窓を出さない
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().ok()?;
    let mut out = child.stdout.take()?;
    // 出力は別のスレッドで読む（答えないコマンドを、時間で打ち切れるように）
    let (tx, rx) = channel::<String>();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = out.by_ref().take(4096).read_to_string(&mut text);
        let _ = tx.send(text);
    });
    match rx.recv_timeout(WAIT) {
        Ok(text) => {
            let ok = child.wait().map(|s| s.success()).unwrap_or(false);
            ok.then(|| text.lines().next().unwrap_or("").trim().to_string())
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// 候補のうち、最初に呼べたもの。どれも呼べなければ None
pub fn which(candidates: &[String]) -> Option<Found> {
    candidates
        .iter()
        .filter(|c| valid_name(c))
        .find_map(|c| version_of(c).map(|version| Found { command: c.clone(), version }))
}
