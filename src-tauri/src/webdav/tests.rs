//! WebDAV の試験。模擬のサーバー（wiremock）に、送った要求の形（メソッド・ヘッダー・本文）と、応答の写し方を確かめる。
//! 本物のサーバーへの結合試験は、最後（`#[ignore]`）。

use super::commands::{run_job, Jobs};
use super::*;
use crate::fs::Kind;
use bytes::Bytes;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn dav(server: &MockServer) -> Dav {
    Dav::new(build_client(), &format!("{}/dav", server.uri())).unwrap()
}

fn multistatus(items: &[(&str, bool, Option<u64>, Option<&str>)]) -> String {
    let mut s = String::from(r#"<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">"#);
    for (href, dir, size, etag) in items {
        s.push_str(&format!("<D:response><D:href>{href}</D:href><D:propstat><D:prop>"));
        if *dir {
            s.push_str("<D:resourcetype><D:collection/></D:resourcetype>");
        } else {
            s.push_str("<D:resourcetype/>");
        }
        if let Some(n) = size {
            s.push_str(&format!("<D:getcontentlength>{n}</D:getcontentlength>"));
        }
        if let Some(e) = etag {
            s.push_str(&format!("<D:getetag>{e}</D:getetag>"));
        }
        s.push_str("<D:getlastmodified>Tue, 17 Nov 2026 07:53:48 GMT</D:getlastmodified><D:getcontenttype>text/plain; charset=utf-8</D:getcontenttype>");
        s.push_str("</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>");
    }
    s.push_str("</D:multistatus>");
    s
}

fn xml(body: String) -> ResponseTemplate {
    ResponseTemplate::new(207).set_body_raw(body, "application/xml; charset=utf-8")
}

async fn requests(server: &MockServer) -> Vec<Request> {
    server.received_requests().await.unwrap()
}

fn hdr(r: &Request, name: &str) -> Option<String> {
    r.headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

// ---- 一覧 ----

#[tokio::test]
async fn list_returns_the_children_without_the_folder_itself() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND"))
        .and(path("/dav/docs/"))
        .and(header("Depth", "1"))
        .respond_with(xml(multistatus(&[
            ("/dav/docs/", true, None, Some("1")),
            ("/dav/docs/a%20b.txt", false, Some(12), Some("12-abc")),
            ("/dav/docs/sub/", true, None, None),
            ("/dav/docs/.hidden", false, Some(1), None),
        ])))
        .mount(&s)
        .await;
    let mut list = dav(&s).list("docs").await.unwrap();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(list.len(), 3);
    let file = list.iter().find(|e| e.name == "a b.txt").unwrap();
    assert_eq!((file.path.as_str(), file.kind, file.size, file.etag.as_deref()), ("docs/a b.txt", Kind::File, Some(12), Some("12-abc")));
    assert_eq!(file.mime.as_deref(), Some("text/plain"));
    assert_eq!(file.modified, Some(1_794_902_028_000));
    let sub = list.iter().find(|e| e.name == "sub").unwrap();
    assert_eq!((sub.kind, sub.size, sub.mime.clone()), (Kind::Dir, None, None));
    assert!(list.iter().find(|e| e.name == ".hidden").unwrap().hidden);
    assert!(!file.hidden);
}

#[tokio::test]
async fn list_of_the_top_works_and_ignores_grandchildren_a_server_may_add() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND"))
        .and(path("/dav/"))
        .respond_with(xml(multistatus(&[("/dav/", true, None, None), ("/dav/x/", true, None, None), ("/dav/x/deep.txt", false, Some(1), None)])))
        .mount(&s)
        .await;
    let list = dav(&s).list("").await.unwrap();
    assert_eq!(list.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["x"]);
}

#[tokio::test]
async fn list_of_a_file_is_not_dir() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND"))
        .respond_with(xml(multistatus(&[("/dav/f.txt", false, Some(1), None)])))
        .mount(&s)
        .await;
    assert_eq!(dav(&s).list("f.txt").await.unwrap_err().code, "not_dir");
}

#[tokio::test]
async fn stat_retries_with_a_trailing_slash_when_the_server_redirects() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND")).and(path("/dav/docs")).respond_with(ResponseTemplate::new(301).insert_header("Location", "/dav/docs/")).mount(&s).await;
    Mock::given(method("PROPFIND")).and(path("/dav/docs/")).respond_with(xml(multistatus(&[("/dav/docs/", true, None, None)]))).mount(&s).await;
    let e = dav(&s).stat("docs").await.unwrap();
    assert_eq!((e.kind, e.path.as_str()), (Kind::Dir, "docs"));
}

#[tokio::test]
async fn a_redirect_elsewhere_is_reported_not_followed() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND")).respond_with(ResponseTemplate::new(302).insert_header("Location", "http://elsewhere.invalid/")).mount(&s).await;
    let e = dav(&s).list("").await.unwrap_err();
    assert_eq!(e.code, "server");
    assert!(e.message.contains("302"), "{}", e.message);
}

// ---- 失敗の写し ----

#[test]
fn status_codes_map_to_fs_error_codes() {
    use reqwest::StatusCode as S;
    let code = |s: u16, c: Ctx| status_error(S::from_u16(s).unwrap(), c).code;
    assert_eq!(code(401, Ctx::Read), "auth");
    assert_eq!(code(403, Ctx::Read), "denied");
    assert_eq!(code(404, Ctx::Read), "not_found");
    assert_eq!(code(405, Ctx::Mkdir), "exists");
    assert_eq!(code(405, Ctx::Delete), "unsupported");
    assert_eq!(code(409, Ctx::Create), "parent_missing");
    assert_eq!(code(412, Ctx::Create), "exists");
    assert_eq!(code(412, Ctx::Transfer { overwrite: false }), "exists");
    assert_eq!(code(412, Ctx::Replace), "precondition");
    assert_eq!(code(413, Ctx::Create), "too_large");
    assert_eq!(code(423, Ctx::Delete), "locked");
    assert_eq!(code(507, Ctx::Create), "no_space");
    assert_eq!(code(500, Ctx::Read), "server");
    assert_eq!(code(503, Ctx::Read), "server");
}

#[tokio::test]
async fn an_unreachable_server_is_offline() {
    // 使われていないポート
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    let d = Dav::new(build_client(), &format!("http://127.0.0.1:{port}/dav/")).unwrap();
    assert_eq!(d.list("").await.unwrap_err().code, "offline");
}

#[tokio::test]
async fn not_a_dav_server_is_a_server_error_not_a_crash() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND")).respond_with(ResponseTemplate::new(200).set_body_string("<html>hi</html>")).mount(&s).await;
    assert_eq!(dav(&s).list("").await.unwrap_err().code, "server");
}

// ---- 黙って上書きしない ----

#[test]
fn etags_are_quoted_for_if_match() {
    assert_eq!(quote_etag("5-abc"), "\"5-abc\"");
    assert_eq!(quote_etag("\"5-abc\""), "\"5-abc\"");
    assert_eq!(quote_etag("W/\"x\""), "W/\"x\"");
    assert_eq!(quote_etag(" 7 "), "\"7\"");
}

async fn mount_stat(s: &MockServer, p: &str, size: u64) {
    Mock::given(method("PROPFIND")).and(path(p)).and(header("Depth", "0")).respond_with(xml(multistatus(&[(p, false, Some(size), Some("new-etag"))]))).mount(s).await;
}

#[tokio::test]
async fn create_sends_if_none_match_and_no_if_match() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).and(path("/dav/docs/a.txt")).respond_with(ResponseTemplate::new(201)).mount(&s).await;
    mount_stat(&s, "/dav/docs/a.txt", 5).await;
    let e = dav(&s).put("docs/a.txt", Bytes::from_static(b"hello"), None, None).await.unwrap();
    assert_eq!((e.size, e.etag.as_deref()), (Some(5), Some("new-etag")));
    let put = requests(&s).await.into_iter().find(|r| r.method.as_str() == "PUT").unwrap();
    assert_eq!(hdr(&put, "if-none-match").as_deref(), Some("*"));
    assert_eq!(hdr(&put, "if-match"), None);
    assert_eq!(hdr(&put, "content-length").as_deref(), Some("5"));
    assert_eq!(put.body, b"hello");
}

#[tokio::test]
async fn create_over_an_existing_file_is_exists() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(412)).mount(&s).await;
    assert_eq!(dav(&s).put("a.txt", Bytes::from_static(b"x"), None, None).await.unwrap_err().code, "exists");
}

#[tokio::test]
async fn replace_sends_the_quoted_etag_and_a_changed_file_is_precondition() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).and(header("If-Match", "\"old-1\"")).respond_with(ResponseTemplate::new(204)).mount(&s).await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(412)).mount(&s).await;
    mount_stat(&s, "/dav/a.txt", 3).await;
    let d = dav(&s);
    d.put("a.txt", Bytes::from_static(b"abc"), Some("old-1"), None).await.unwrap();
    let put = requests(&s).await.into_iter().find(|r| r.method.as_str() == "PUT").unwrap();
    assert_eq!(hdr(&put, "if-none-match"), None, "上書きに If-None-Match は付けない");
    // 古い ETag
    assert_eq!(d.put("a.txt", Bytes::from_static(b"abc"), Some("stale"), None).await.unwrap_err().code, "precondition");
}

#[tokio::test]
async fn put_reports_progress_up_to_the_total() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(201)).mount(&s).await;
    mount_stat(&s, "/dav/big.bin", 200_000).await;
    let last = Arc::new(AtomicU64::new(0));
    let l2 = last.clone();
    let p: Progress = Arc::new(move |done, total| {
        assert_eq!(total, 200_000);
        assert!(done > l2.load(Ordering::SeqCst), "進みは増えていく");
        l2.store(done, Ordering::SeqCst);
    });
    dav(&s).put("big.bin", Bytes::from(vec![7u8; 200_000]), None, Some(p)).await.unwrap();
    assert_eq!(last.load(Ordering::SeqCst), 200_000);
    let put = requests(&s).await.into_iter().find(|r| r.method.as_str() == "PUT").unwrap();
    assert_eq!(put.body.len(), 200_000);
}

#[tokio::test]
async fn move_and_copy_say_overwrite_false_by_default_and_true_only_when_asked() {
    let s = MockServer::start().await;
    for m in ["MOVE", "COPY"] {
        Mock::given(method(m)).respond_with(ResponseTemplate::new(201)).mount(&s).await;
    }
    mount_stat(&s, "/dav/b%20x.txt", 1).await;
    Mock::given(method("PROPFIND")).and(path("/dav/b%20x.txt")).respond_with(xml(multistatus(&[("/dav/b%20x.txt", false, Some(1), None)]))).mount(&s).await;
    let d = dav(&s);
    d.mv("a.txt", "b x.txt", false).await.unwrap();
    d.copy("a.txt", "b x.txt", true).await.unwrap();
    let reqs = requests(&s).await;
    let mv = reqs.iter().find(|r| r.method.as_str() == "MOVE").unwrap();
    let cp = reqs.iter().find(|r| r.method.as_str() == "COPY").unwrap();
    assert_eq!(hdr(mv, "overwrite").as_deref(), Some("F"));
    assert_eq!(hdr(cp, "overwrite").as_deref(), Some("T"));
    assert_eq!(hdr(mv, "destination").unwrap(), format!("{}/dav/b%20x.txt", s.uri()));
}

#[tokio::test]
async fn move_onto_an_existing_name_without_overwrite_is_exists() {
    let s = MockServer::start().await;
    Mock::given(method("MOVE")).respond_with(ResponseTemplate::new(412)).mount(&s).await;
    assert_eq!(dav(&s).mv("a", "b", false).await.unwrap_err().code, "exists");
}

#[tokio::test]
async fn move_and_copy_check_obvious_mistakes_before_sending() {
    let s = MockServer::start().await;
    let d = dav(&s);
    assert_eq!(d.mv("a", "a", false).await.unwrap_err().code, "same_path");
    assert_eq!(d.copy("a", "a/b", false).await.unwrap_err().code, "into_self");
    assert_eq!(d.mv("", "x", false).await.unwrap_err().code, "invalid");
    assert!(requests(&s).await.is_empty(), "何も送っていない");
}

#[tokio::test]
async fn mkdir_maps_exists_and_missing_parent() {
    let s = MockServer::start().await;
    Mock::given(method("MKCOL")).and(path("/dav/dup/")).respond_with(ResponseTemplate::new(405)).mount(&s).await;
    Mock::given(method("MKCOL")).and(path("/dav/no/child/")).respond_with(ResponseTemplate::new(409)).mount(&s).await;
    Mock::given(method("MKCOL")).and(path("/dav/new/")).respond_with(ResponseTemplate::new(201)).mount(&s).await;
    Mock::given(method("PROPFIND")).and(path("/dav/new")).respond_with(xml(multistatus(&[("/dav/new/", true, None, None)]))).mount(&s).await;
    let d = dav(&s);
    assert_eq!(d.mkdir("dup").await.unwrap_err().code, "exists");
    assert_eq!(d.mkdir("no/child").await.unwrap_err().code, "parent_missing");
    assert_eq!(d.mkdir("new").await.unwrap().kind, Kind::Dir);
}

#[tokio::test]
async fn remove_deletes_and_a_partial_207_is_partial() {
    let s = MockServer::start().await;
    Mock::given(method("DELETE")).and(path("/dav/a.txt")).respond_with(ResponseTemplate::new(204)).mount(&s).await;
    Mock::given(method("DELETE")).and(path("/dav/dir")).respond_with(ResponseTemplate::new(207).set_body_raw("<D:multistatus xmlns:D=\"DAV:\"/>", "application/xml")).mount(&s).await;
    Mock::given(method("DELETE")).and(path("/dav/locked")).respond_with(ResponseTemplate::new(423)).mount(&s).await;
    let d = dav(&s);
    d.remove("a.txt").await.unwrap();
    assert_eq!(d.remove("dir").await.unwrap_err().code, "partial");
    assert_eq!(d.remove("locked").await.unwrap_err().code, "locked");
    assert_eq!(d.remove("").await.unwrap_err().code, "invalid");
}

// ---- 大きさ ----

#[tokio::test]
async fn size_walks_one_level_at_a_time() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND")).and(path("/dav/top/")).respond_with(xml(multistatus(&[
        ("/dav/top/", true, None, None),
        ("/dav/top/a", false, Some(10), None),
        ("/dav/top/sub/", true, None, None),
    ]))).mount(&s).await;
    Mock::given(method("PROPFIND")).and(path("/dav/top/sub/")).respond_with(xml(multistatus(&[
        ("/dav/top/sub/", true, None, None),
        ("/dav/top/sub/b", false, Some(5), None),
        ("/dav/top/sub/c", false, Some(1), None),
    ]))).mount(&s).await;
    assert_eq!(dav(&s).size("top").await.unwrap(), (16, 3, 1, false));
    assert!(requests(&s).await.iter().all(|r| hdr(r, "depth").as_deref() == Some("1")), "深さ無限は使わない");
}

#[tokio::test]
async fn size_stops_at_the_limit_and_says_partial() {
    let s = MockServer::start().await;
    // どのフォルダも、自分と同じ名前の子フォルダを 1 つ持つ（際限なく深い）
    Mock::given(method("PROPFIND"))
        .respond_with(|r: &Request| {
            let p = r.url.path().to_string();
            xml(multistatus(&[(&p, true, None, None), (&format!("{p}d/"), true, None, None)]))
        })
        .mount(&s)
        .await;
    let (_, _, dirs, partial) = dav(&s).size("").await.unwrap();
    assert!(partial);
    assert_eq!(dirs as usize, SIZE_DIR_LIMIT);
}

// ---- ダウンロード ----

#[tokio::test]
async fn download_writes_a_part_file_then_renames_and_failure_leaves_nothing() {
    let s = MockServer::start().await;
    Mock::given(method("GET")).and(path("/dav/f.bin")).respond_with(ResponseTemplate::new(200).set_body_bytes(vec![1u8; 100_000])).mount(&s).await;
    Mock::given(method("GET")).and(path("/dav/gone.bin")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("f.bin");
    let seen = Arc::new(AtomicU64::new(0));
    let s2 = seen.clone();
    let p: Progress = Arc::new(move |d, _| s2.store(d, Ordering::SeqCst));
    dav(&s).download("f.bin", &dest, Some(p)).await.unwrap();
    assert_eq!(std::fs::read(&dest).unwrap().len(), 100_000);
    assert_eq!(seen.load(Ordering::SeqCst), 100_000);
    assert!(!dir.path().join("f.bin.part").exists());

    let dest2 = dir.path().join("gone.bin");
    assert_eq!(dav(&s).download("gone.bin", &dest2, None).await.unwrap_err().code, "not_found");
    assert!(!dest2.exists() && !dir.path().join("gone.bin.part").exists());
}

// ---- 中止 ----

#[tokio::test]
async fn a_running_job_can_be_cancelled_and_leaves_no_part_file() {
    let s = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0u8; 10]).set_delay(std::time::Duration::from_secs(30))).mount(&s).await;
    let jobs = Arc::new(Jobs::default());
    let d = dav(&s);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("slow.bin");
    let j2 = jobs.clone();
    let task = tokio::spawn(async move { run_job(&j2, Some("job-1"), async move { d.download("slow.bin", &dest, None).await }).await });
    // 動き出すのを待つ
    for _ in 0..100 {
        if jobs.len() == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(jobs.cancel("job-1"));
    let r = tokio::time::timeout(std::time::Duration::from_secs(5), task).await.expect("中止で止まる").unwrap();
    assert_eq!(r.unwrap_err().code, "aborted");
    assert!(jobs.is_empty());
    assert!(!jobs.cancel("job-1"), "終わったものは中止できない");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn a_job_without_a_name_just_runs() {
    let jobs = Jobs::default();
    let v = run_job(&jobs, None, async { Ok::<_, crate::fs::FsError>(7) }).await.unwrap();
    assert_eq!(v, 7);
    assert!(jobs.is_empty());
}

// ---- 本物のサーバー（結合。手で動かす: 下の説明） ----

/// 本物の WebDAV サーバーに対する一通りの流れ。環境変数 `FIXPLOR_DAV_URL`（例 `http://127.0.0.1:8080/dav/`）があるときだけ動く。
/// 一時のフォルダを作って、その中だけで操作し、最後に消す。本番のサーバー・データには向けないこと。
/// 実行: `FIXPLOR_DAV_URL=... cargo test --lib real_server -- --ignored --nocapture`
/// 開発モードの disnans-server（`DISNANS_DEV=1`・一時のデータフォルダ）で確かめた。
#[tokio::test]
#[ignore = "本物のサーバーが要る（FIXPLOR_DAV_URL）"]
async fn real_server_round_trip() {
    let Ok(url) = std::env::var("FIXPLOR_DAV_URL") else {
        eprintln!("FIXPLOR_DAV_URL が無いので、飛ばします");
        return;
    };
    let d = Dav::new(build_client(), &url).unwrap();
    let root = format!("fixplor-it-{}", std::process::id());
    d.mkdir(&root).await.unwrap();
    assert_eq!(d.mkdir(&root).await.unwrap_err().code, "exists");
    let a = format!("{root}/a b.txt");
    // 作成 → 同名の作成は exists
    let e = d.put(&a, Bytes::from_static(b"one"), None, None).await.unwrap();
    assert_eq!(e.size, Some(3));
    let etag = e.etag.clone().expect("ETag が返る");
    assert_eq!(d.put(&a, Bytes::from_static(b"x"), None, None).await.unwrap_err().code, "exists");
    // 上書き: 正しい ETag は通り、古い ETag は precondition
    let e2 = d.put(&a, Bytes::from_static(b"two!"), Some(&etag), None).await.unwrap();
    assert_eq!(e2.size, Some(4));
    assert_eq!(d.put(&a, Bytes::from_static(b"zzz"), Some(&etag), None).await.unwrap_err().code, "precondition");
    // 一覧・コピー・移動
    let list = d.list(&root).await.unwrap();
    assert_eq!(list.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["a b.txt"]);
    let c = format!("{root}/c.txt");
    d.copy(&a, &c, false).await.unwrap();
    assert_eq!(d.copy(&a, &c, false).await.unwrap_err().code, "exists");
    d.copy(&a, &c, true).await.unwrap();
    let m = format!("{root}/m.txt");
    d.mv(&c, &m, false).await.unwrap();
    assert_eq!(d.stat(&c).await.unwrap_err().code, "not_found");
    // 大きさ・ダウンロード
    let sub = format!("{root}/sub");
    d.mkdir(&sub).await.unwrap();
    d.put(&format!("{sub}/z"), Bytes::from(vec![1u8; 1000]), None, None).await.unwrap();
    let (size, files, dirs, partial) = d.size(&root).await.unwrap();
    assert_eq!((size, files, dirs, partial), (4 + 4 + 1000, 3, 1, false));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("a.txt");
    d.download(&a, &dest, None).await.unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), b"two!");
    // 後始末（完全削除）
    d.remove(&root).await.unwrap();
    assert_eq!(d.stat(&root).await.unwrap_err().code, "not_found");
}
