//! WebDAV の置き場所への操作（一覧・作成・書き込み・移動・コピー・削除・大きさ・ダウンロード）。
//! Tauri には依らない（`commands.rs` のコマンドが呼ぶ）。失敗は、ローカルの `fs_*` と同じ `FsError.code` に写す。
//!
//! 黙って上書きしない決まり:
//!  - 作成は `If-None-Match: *`（同名があれば 412 → `exists`）
//!  - 上書きは、一覧で読んだ ETag を `If-Match`（変わっていれば 412 → `precondition`）
//!  - 移動・コピーは `Overwrite: F`（既定）。上書きを明示したときだけ `Overwrite: T`
//!
//! 書き込みの原子性（一時の名前へ書いてから付け替える）は、サーバーに任せる（PUT はふつう、そうなっている）。

use super::url::{join, parse_base, rel_of_href};
use super::xml::{parse_multistatus, Resource};
use crate::fs::{FsError, FsResult, Kind};
use bytes::Bytes;
use reqwest::header::{HeaderValue, CONTENT_LENGTH, ETAG, IF_MATCH, IF_NONE_MATCH};
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode, Url};
use serde::Serialize;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// 一覧の 1 行。`path` は、接続先からの相対（区切り `/`・符号化しない）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DavEntry {
    pub name: String,
    pub path: String,
    pub kind: Kind,
    pub size: Option<u64>,
    pub modified: Option<i64>,
    pub hidden: bool,
    pub mime: Option<String>,
    /// サーバーが返した ETag（応答のままの文字。上書きのときに `If-Match` へ使う）
    pub etag: Option<String>,
}

/// 進み具合（送った・受け取ったバイト数, 全体のバイト数）
pub type Progress = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// 何をしていて失敗したか（同じ状態でも、意味が変わる）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ctx {
    Read,
    Mkdir,
    /// 作成（同名があってはいけない）
    Create,
    /// 上書き（ETag が合っているときだけ）
    Replace,
    /// 移動・コピー。overwrite が偽なら、宛先に同名があると 412
    Transfer { overwrite: bool },
    Delete,
}

/// HTTP の状態を、`FsError` にする
pub fn status_error(status: StatusCode, ctx: Ctx) -> FsError {
    let code = match status.as_u16() {
        401 | 407 => "auth",
        403 => "denied",
        404 | 410 => "not_found",
        405 => match ctx {
            Ctx::Mkdir => "exists",
            _ => "unsupported",
        },
        409 => "parent_missing",
        412 => match ctx {
            Ctx::Replace => "precondition",
            _ => "exists",
        },
        413 => "too_large",
        423 => "locked",
        501 => "unsupported",
        507 => "no_space",
        300..=399 => "server",
        _ => "server",
    };
    let message = match (code, status.as_u16()) {
        ("server", 300..=399) => format!("別の場所へ移されています（HTTP {status}）。URL を確かめてください"),
        _ => format!("サーバーが {status} を返しました"),
    };
    FsError::new(code, message)
}

/// 通信の失敗を、`FsError` にする
pub fn net_error(e: &reqwest::Error) -> FsError {
    let chain = {
        let mut s = e.to_string();
        let mut src = std::error::Error::source(e);
        while let Some(x) = src {
            s.push_str(": ");
            s.push_str(&x.to_string());
            src = x.source();
        }
        s
    };
    let lower = chain.to_ascii_lowercase();
    if lower.contains("certificate") || lower.contains("unknownissuer") || lower.contains("invalid peer") {
        return FsError::new("tls", format!("証明書を確認できません: {chain}"));
    }
    if e.is_timeout() || e.is_connect() {
        return FsError::new("offline", format!("接続できません: {chain}"));
    }
    FsError::new("io", format!("通信に失敗しました: {chain}"))
}

/// ETag を `If-Match` に書く形（引用符つき）にする。PROPFIND は引用符なしで返すサーバーがある
pub fn quote_etag(etag: &str) -> String {
    let t = etag.trim();
    if t.starts_with('"') || t.starts_with("W/") {
        t.to_string()
    } else {
        format!("\"{t}\"")
    }
}

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/><getcontenttype/><getetag/></prop></propfind>"#;
const CHUNK: usize = 64 * 1024;
/// 1 回の操作の待ち時間（本文を送り・受け取るもの以外）
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// フォルダの大きさを数えるとき、読むフォルダの数の上限（超えたら、途中までの値で打ち切る）
pub const SIZE_DIR_LIMIT: usize = 500;

/// HTTP の入れ物を作る。リダイレクトは辿らない（URL の確かめを、利用者に任せる）
pub fn build_client() -> Client {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .user_agent(concat!("fixplor/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("HTTP の入れ物を作れませんでした")
}

pub struct Dav {
    client: Client,
    base: Url,
}

impl Dav {
    pub fn new(client: Client, base: &str) -> FsResult<Self> {
        Ok(Self { client, base: parse_base(base)? })
    }

    fn method(name: &str) -> Method {
        Method::from_bytes(name.as_bytes()).expect("メソッド名")
    }

    async fn send(&self, rb: RequestBuilder, ctx: Ctx) -> FsResult<Response> {
        let res = rb.send().await.map_err(|e| net_error(&e))?;
        if res.status().is_success() {
            Ok(res)
        } else {
            Err(status_error(res.status(), ctx))
        }
    }

    async fn propfind(&self, rel: &str, depth: &str) -> FsResult<Vec<Resource>> {
        // 一覧の対象はフォルダ（終わりに `/`）。深さ 0 の確かめは、種類が分からないので、まず `/` なしで聞き、
        // 「別の場所へ移された」（フォルダに `/` を付けさせるサーバー）なら `/` を付けてもう一度聞く
        let mut dir = depth == "1";
        loop {
            let url = join(&self.base, rel, dir)?;
            let rb = self
                .client
                .request(Self::method("PROPFIND"), url)
                .header("Depth", depth)
                .header("Content-Type", "application/xml; charset=utf-8")
                .timeout(REQUEST_TIMEOUT)
                .body(PROPFIND_BODY);
            let res = rb.send().await.map_err(|e| net_error(&e))?;
            if res.status().is_redirection() && !dir && !rel.is_empty() {
                dir = true;
                continue;
            }
            if !res.status().is_success() {
                return Err(status_error(res.status(), Ctx::Read));
            }
            if res.status() != StatusCode::MULTI_STATUS {
                return Err(FsError::new("server", format!("PROPFIND の応答が想定外です（{}）", res.status())));
            }
            let text = res.text().await.map_err(|e| net_error(&e))?;
            return parse_multistatus(&text);
        }
    }

    fn entry(&self, r: &Resource) -> Option<DavEntry> {
        let path = rel_of_href(&self.base, &r.href)?;
        let name = path.rsplit('/').next().unwrap_or("").to_string();
        let dir = r.collection;
        Some(DavEntry {
            hidden: name.starts_with('.'),
            name,
            path,
            kind: if dir { Kind::Dir } else { Kind::File },
            size: if dir { None } else { r.size },
            modified: r.modified,
            mime: if dir { None } else { r.mime.as_ref().map(|m| m.split(';').next().unwrap_or(m).trim().to_string()) },
            etag: r.etag.clone(),
        })
    }

    /// フォルダの中身（並び順は決めない）。フォルダ自身は含めない
    pub async fn list(&self, rel: &str) -> FsResult<Vec<DavEntry>> {
        let resources = self.propfind(rel, "1").await?;
        let mut out = Vec::new();
        let mut saw_self = false;
        for r in &resources {
            let Some(e) = self.entry(r) else { continue };
            if e.path == rel {
                saw_self = true;
                if e.kind == Kind::File {
                    return Err(FsError::new("not_dir", format!("フォルダではありません: {rel}")));
                }
                continue;
            }
            // 直下だけ（深さ 1 を無視して孫まで返すサーバーへの用心）
            let parent = e.path.rsplit_once('/').map_or("", |(p, _)| p);
            if parent == rel {
                out.push(e);
            }
        }
        if !saw_self && out.is_empty() && resources.is_empty() {
            return Err(FsError::new("server", "サーバーの応答が空でした"));
        }
        Ok(out)
    }

    pub async fn stat(&self, rel: &str) -> FsResult<DavEntry> {
        let resources = self.propfind(rel, "0").await?;
        resources
            .iter()
            .filter_map(|r| self.entry(r))
            .find(|e| e.path == rel)
            .ok_or_else(|| FsError::new("server", "サーバーの応答に、対象がありません"))
    }

    pub async fn mkdir(&self, rel: &str) -> FsResult<DavEntry> {
        if rel.is_empty() {
            return Err(FsError::new("invalid", "いちばん上は作れません"));
        }
        let rb = self.client.request(Self::method("MKCOL"), join(&self.base, rel, true)?).timeout(REQUEST_TIMEOUT);
        self.send(rb, Ctx::Mkdir).await?;
        self.stat(rel).await
    }

    /// ファイルを書く。`if_match` が無ければ作成（同名があれば `exists`）、あれば、その ETag のものだけを上書き（変わっていれば `precondition`）
    pub async fn put(&self, rel: &str, body: Bytes, if_match: Option<&str>, progress: Option<Progress>) -> FsResult<DavEntry> {
        if rel.is_empty() {
            return Err(FsError::new("invalid", "いちばん上へは書けません"));
        }
        let total = body.len() as u64;
        let mut rb = self.client.put(join(&self.base, rel, false)?).header(CONTENT_LENGTH, total);
        rb = match if_match {
            Some(tag) => rb.header(IF_MATCH, HeaderValue::from_str(&quote_etag(tag)).map_err(|_| FsError::new("invalid", "ETag に使えない文字があります"))?),
            None => rb.header(IF_NONE_MATCH, "*"),
        };
        let stream = futures_util::stream::unfold((body, 0usize), move |(b, pos)| {
            let progress = progress.clone();
            async move {
                if pos >= b.len() {
                    return None;
                }
                let end = (pos + CHUNK).min(b.len());
                let chunk = b.slice(pos..end);
                if let Some(p) = &progress {
                    p(end as u64, total);
                }
                Some((Ok::<Bytes, Infallible>(chunk), (b, end)))
            }
        });
        let rb = rb.body(reqwest::Body::wrap_stream(stream));
        let ctx = if if_match.is_some() { Ctx::Replace } else { Ctx::Create };
        let res = self.send(rb, ctx).await?;
        let etag = res.headers().get(ETAG).and_then(|v| v.to_str().ok()).map(str::to_string);
        // 書いたあとの姿は、サーバーに聞く。聞けなければ、分かる範囲で返す
        match self.stat(rel).await {
            Ok(e) => Ok(e),
            Err(_) => Ok(DavEntry {
                name: rel.rsplit('/').next().unwrap_or("").to_string(),
                path: rel.to_string(),
                kind: Kind::File,
                size: Some(total),
                modified: None,
                hidden: rel.rsplit('/').next().is_some_and(|n| n.starts_with('.')),
                mime: None,
                etag,
            }),
        }
    }

    async fn transfer(&self, verb: &str, from: &str, to: &str, overwrite: bool) -> FsResult<DavEntry> {
        if from.is_empty() || to.is_empty() {
            return Err(FsError::new("invalid", "いちばん上は動かせません"));
        }
        if from == to {
            return Err(FsError::new("same_path", "元と宛先が同じです"));
        }
        if to.starts_with(&format!("{from}/")) {
            return Err(FsError::new("into_self", "フォルダを、そのフォルダの中へは入れられません"));
        }
        let rb = self
            .client
            .request(Self::method(verb), join(&self.base, from, false)?)
            .header("Destination", join(&self.base, to, false)?.as_str())
            .header("Overwrite", if overwrite { "T" } else { "F" })
            .timeout(REQUEST_TIMEOUT);
        self.send(rb, Ctx::Transfer { overwrite }).await?;
        self.stat(to).await
    }

    pub async fn mv(&self, from: &str, to: &str, overwrite: bool) -> FsResult<DavEntry> {
        self.transfer("MOVE", from, to, overwrite).await
    }

    pub async fn copy(&self, from: &str, to: &str, overwrite: bool) -> FsResult<DavEntry> {
        self.transfer("COPY", from, to, overwrite).await
    }

    /// 完全に削除する（元に戻せない。確認は画面が先に取る）
    pub async fn remove(&self, rel: &str) -> FsResult<()> {
        if rel.is_empty() {
            return Err(FsError::new("invalid", "いちばん上は消せません"));
        }
        let rb = self.client.delete(join(&self.base, rel, false)?).timeout(REQUEST_TIMEOUT);
        let res = self.send(rb, Ctx::Delete).await?;
        // 207: 一部だけ消せた
        if res.status() == StatusCode::MULTI_STATUS {
            return Err(FsError::new("partial", "一部を消せませんでした"));
        }
        Ok(())
    }

    /// フォルダの大きさ（中のファイルの合計）。深さ無限の PROPFIND は断るサーバーがあるので、1 段ずつ読む。
    /// 読むフォルダが `SIZE_DIR_LIMIT` を超えたら、途中までの値で `partial`
    pub async fn size(&self, rel: &str) -> FsResult<(u64, u64, u64, bool)> {
        let (mut size, mut files, mut dirs) = (0u64, 0u64, 0u64);
        let mut queue = vec![rel.to_string()];
        let mut visited = 0usize;
        while let Some(dir) = queue.pop() {
            if visited >= SIZE_DIR_LIMIT {
                return Ok((size, files, dirs, true));
            }
            visited += 1;
            for e in self.list(&dir).await? {
                match e.kind {
                    Kind::Dir => {
                        dirs += 1;
                        queue.push(e.path);
                    }
                    Kind::File => {
                        files += 1;
                        size += e.size.unwrap_or(0);
                    }
                }
            }
        }
        Ok((size, files, dirs, false))
    }

    /// ファイルを、`dest` へ受け取る（`dest.part` へ書き終えてから付け替える。失敗・中止では `.part` を残さない）
    pub async fn download(&self, rel: &str, dest: &Path, progress: Option<Progress>) -> FsResult<()> {
        let rb = self.client.get(join(&self.base, rel, false)?);
        let mut res = self.send(rb, Ctx::Read).await?;
        let total = res.content_length().unwrap_or(0);
        let part = PathBuf::from(format!("{}.part", dest.display()));
        let mut guard = PartGuard(Some(part.clone()));
        let io = |e: std::io::Error| FsError::io(&e, &part);
        let mut file = tokio::fs::File::create(&part).await.map_err(io)?;
        let mut done = 0u64;
        while let Some(chunk) = res.chunk().await.map_err(|e| net_error(&e))? {
            file.write_all(&chunk).await.map_err(io)?;
            done += chunk.len() as u64;
            if let Some(p) = &progress {
                p(done, total.max(done));
            }
        }
        file.flush().await.map_err(io)?;
        drop(file);
        tokio::fs::rename(&part, dest).await.map_err(|e| FsError::io(&e, dest))?;
        guard.0 = None;
        Ok(())
    }
}

/// 途中で失敗・中止したときに、書きかけのファイルを消す
struct PartGuard(Option<PathBuf>);
impl Drop for PartGuard {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let _ = std::fs::remove_file(p);
        }
    }
}
