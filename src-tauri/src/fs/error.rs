use serde::Serialize;
use std::io;
use std::path::Path;

/// ファイル操作の失敗。`code` は画面が分岐に使う固定の短い名前、`message` は診断用（OS の説明）。
///
/// code の一覧:
/// - `invalid`: パスが絶対パスでない・空・NUL を含む
/// - `not_found` / `parent_missing`: 対象・宛先の親が無い
/// - `exists`: 宛先に同名がある（上書きできない組み合わせも含む）
/// - `same_path`: 元と宛先が同じもの
/// - `into_self`: フォルダを自分の中へ入れようとした
/// - `denied` / `not_dir` / `is_dir` / `not_empty`: OS の拒否
/// - `unsupported`: この OS・この種類のファイルでは出来ない
/// - `partial`: 途中まで出来た（移動でコピーは終わったが、元を消せなかった）
/// - `io`: それ以外
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsError {
    pub code: &'static str,
    pub message: String,
}

pub type FsResult<T> = Result<T, FsError>;

impl FsError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    /// OS のエラーを code に直す。どのパスで起きたかを message に入れる
    pub fn io(err: &io::Error, path: &Path) -> Self {
        let code = match err.kind() {
            io::ErrorKind::NotFound => "not_found",
            io::ErrorKind::PermissionDenied => "denied",
            io::ErrorKind::AlreadyExists => "exists",
            io::ErrorKind::NotADirectory => "not_dir",
            io::ErrorKind::IsADirectory => "is_dir",
            io::ErrorKind::DirectoryNotEmpty => "not_empty",
            _ => "io",
        };
        Self::new(code, format!("{}: {err}", path.display()))
    }
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for FsError {}
