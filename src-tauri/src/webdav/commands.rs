//! WebDAV の Tauri コマンド（`dav_*`）。画面（`src/lib/fs/webdav.ts`）が呼ぶ。
//! 置き場所は、呼ぶたびに `base`（接続先の URL）で受ける（接続の状態は持たない）。

use super::{build_client, Dav, DavEntry, Progress};
use crate::fs::{FsError, FsResult};
use bytes::Bytes;
use futures_util::future::{abortable, AbortHandle};
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

/// 進み具合や中止の対象になる、動いている操作（画面が付けた job の名前）
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, AbortHandle>>);

impl Jobs {
    fn add(&self, id: &str, h: AbortHandle) {
        self.0.lock().unwrap().insert(id.to_string(), h);
    }
    fn done(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
    /// 中止する。動いていなければ false
    pub fn cancel(&self, id: &str) -> bool {
        match self.0.lock().unwrap().remove(id) {
            Some(h) => {
                h.abort();
                true
            }
            None => false,
        }
    }
    /// 動いている操作の数（試験用）
    pub fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// job の名前があれば、中止できる形で動かす。中止されたら `aborted`（部品の約束と同じ名前）
pub async fn run_job<T>(jobs: &Jobs, job: Option<&str>, fut: impl Future<Output = FsResult<T>>) -> FsResult<T> {
    let Some(id) = job else { return fut.await };
    let (fut, handle) = abortable(fut);
    jobs.add(id, handle);
    let r = fut.await;
    jobs.done(id);
    r.unwrap_or_else(|_| Err(FsError::new("aborted", "中止しました")))
}

/// 通信の入れ物（アプリで 1 つ）
pub struct Http(pub reqwest::Client);

pub fn state() -> (Http, Jobs) {
    (Http(build_client()), Jobs::default())
}

#[derive(Serialize, Clone)]
struct ProgressEvent<'a> {
    job: &'a str,
    done: u64,
    total: u64,
}

fn reporter(app: tauri::AppHandle, job: Option<String>) -> Option<Progress> {
    let job = job?;
    // 1% 進むごと（と、最後）に知らせる
    let last = Arc::new(Mutex::new(u64::MAX));
    Some(Arc::new(move |done, total| {
        let step = (done * 100).checked_div(total).unwrap_or(0);
        let mut l = last.lock().unwrap();
        if *l != step || done == total {
            *l = step;
            let _ = app.emit("dav-progress", ProgressEvent { job: &job, done, total });
        }
    }))
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    let raw = request.headers().get(name)?.to_str().ok()?;
    percent_encoding::percent_decode_str(raw).decode_utf8().ok().map(|s| s.into_owned())
}

#[tauri::command]
pub async fn dav_list(http: State<'_, Http>, base: String, path: String) -> FsResult<Vec<DavEntry>> {
    Dav::new(http.0.clone(), &base)?.list(&path).await
}

#[tauri::command]
pub async fn dav_stat(http: State<'_, Http>, base: String, path: String) -> FsResult<DavEntry> {
    Dav::new(http.0.clone(), &base)?.stat(&path).await
}

#[tauri::command]
pub async fn dav_mkdir(http: State<'_, Http>, base: String, path: String) -> FsResult<DavEntry> {
    Dav::new(http.0.clone(), &base)?.mkdir(&path).await
}

/// ファイルを書く。中身は生のバイト列。ヘッダー: `x-base`・`x-path`（URL の形に符号化）・
/// `x-if-match`（上書きのとき、一覧で読んだ ETag。無ければ作成）・`x-job`（進み具合・中止の名前。省ける）
#[tauri::command]
pub async fn dav_put(app: tauri::AppHandle, http: State<'_, Http>, jobs: State<'_, Jobs>, request: tauri::ipc::Request<'_>) -> FsResult<DavEntry> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(FsError::new("invalid", "中身がバイト列ではありません"));
    };
    let base = header(&request, "x-base").ok_or_else(|| FsError::new("invalid", "接続先がありません"))?;
    let path = header(&request, "x-path").ok_or_else(|| FsError::new("invalid", "パスがありません"))?;
    let if_match = header(&request, "x-if-match");
    let job = header(&request, "x-job");
    let body = Bytes::copy_from_slice(body);
    let dav = Dav::new(http.0.clone(), &base)?;
    let progress = reporter(app, job.clone());
    run_job(&jobs, job.as_deref(), async move { dav.put(&path, body, if_match.as_deref(), progress).await }).await
}

#[tauri::command]
pub async fn dav_move(http: State<'_, Http>, base: String, from: String, to: String, overwrite: Option<bool>) -> FsResult<DavEntry> {
    Dav::new(http.0.clone(), &base)?.mv(&from, &to, overwrite.unwrap_or(false)).await
}

#[tauri::command]
pub async fn dav_copy(http: State<'_, Http>, base: String, from: String, to: String, overwrite: Option<bool>) -> FsResult<DavEntry> {
    Dav::new(http.0.clone(), &base)?.copy(&from, &to, overwrite.unwrap_or(false)).await
}

/// 完全に削除する（元に戻せない）
#[tauri::command]
pub async fn dav_remove(http: State<'_, Http>, base: String, path: String) -> FsResult<()> {
    Dav::new(http.0.clone(), &base)?.remove(&path).await
}

#[derive(Serialize)]
pub struct DavSize {
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub partial: bool,
}

#[tauri::command]
pub async fn dav_size(http: State<'_, Http>, base: String, path: String) -> FsResult<DavSize> {
    let (size, files, dirs, partial) = Dav::new(http.0.clone(), &base)?.size(&path).await?;
    Ok(DavSize { size, files, dirs, partial })
}

/// ファイルを、この端末の一時のフォルダへ受け取って、その絶対パスを返す（開くため）
#[tauri::command]
pub async fn dav_download(app: tauri::AppHandle, http: State<'_, Http>, jobs: State<'_, Jobs>, base: String, path: String, job: Option<String>) -> FsResult<String> {
    let dav = Dav::new(http.0.clone(), &base)?;
    let name = path.rsplit('/').next().filter(|n| !n.is_empty()).ok_or_else(|| FsError::new("invalid", "ファイルを指していません"))?.to_string();
    let dest = temp_dest(&name)?;
    let progress = reporter(app, job.clone());
    let out = dest.clone();
    run_job(&jobs, job.as_deref(), async move { dav.download(&path, &out, progress).await }).await?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 受け取り先（一時のフォルダの下に、受け取りごとの新しいフォルダ）
fn temp_dest(name: &str) -> FsResult<PathBuf> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join("fixplor-dav").join(format!("{nanos:x}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| FsError::io(&e, &dir))?;
    // 名前は、もう 1 段のフォルダを作れない文字を除いてから使う
    let safe: String = name.chars().map(|c| if matches!(c, '/' | '\\' | '\0') { '_' } else { c }).collect();
    Ok(dir.join(safe))
}

/// 動いている操作を中止する。動いていなければ false
#[tauri::command]
pub fn dav_cancel(jobs: State<'_, Jobs>, job: String) -> bool {
    jobs.cancel(&job)
}
