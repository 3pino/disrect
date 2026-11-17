//! 資格情報（キーチェーン）・Basic 認証・表示の中継・書き込みのストリーム・一時ファイルの掃除の試験。
//! キーチェーンは、メモリの偽物（`MemoryStore`）に差し替える。

use super::commands::{clean_temp, finish_put, start_put, Conns, Jobs, Puts};
use super::proxy::{parse_path, serve, serve_limited};
use super::secret::{may_send_credentials, Creds, MemoryStore, SecretStore};
use super::*;
use bytes::Bytes;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// user:pass の Basic
const BASIC: &str = "Basic dXNlcjpwYXNz";

fn store() -> (Arc<MemoryStore>, Arc<dyn SecretStore>) {
    let m = Arc::new(MemoryStore::default());
    (m.clone(), m)
}

fn conns_with(m: Arc<dyn SecretStore>) -> Conns {
    Conns::new(m)
}

fn base_of(s: &MockServer) -> String {
    format!("{}/dav/", s.uri())
}

// ---- 資格情報 ----

#[test]
fn credentials_round_trip_and_the_password_is_never_returned() {
    let (mem, dynstore) = store();
    let c = Creds::new(dynstore);
    assert_eq!(c.info("p1").unwrap(), None);
    c.set("p1", "https://nas.example/dav", "user", Some("pass")).unwrap();
    let info = c.info("p1").unwrap().unwrap();
    assert_eq!((info.user.as_str(), info.base.as_str()), ("user", "https://nas.example/dav/"));
    let json = serde_json::to_string(&info).unwrap();
    assert!(!json.contains("pass"), "画面へ返す形に、パスワードが入っている: {json}");
    // パスワードがあるのは、キーチェーンの中だけ
    assert!(mem.map.lock().unwrap().get("p1").unwrap().contains("pass"));
}

#[test]
fn changing_the_user_keeps_the_stored_password_unless_a_new_one_is_given_and_a_new_url_needs_one() {
    let (_m, s) = store();
    let c = Creds::new(s);
    assert_eq!(c.set("p1", "https://a.example/dav/", "user", None).unwrap_err().code, "invalid", "元が無いのにパスワード無し");
    c.set("p1", "https://a.example/dav/", "user", Some("pass")).unwrap();
    let url = reqwest::Url::parse("https://a.example/dav/").unwrap();
    c.set("p1", "https://a.example/dav", "other", None).unwrap();
    assert_eq!(c.for_base("p1", &url).unwrap(), Some(("other".into(), "pass".into())));
    // 接続先が変わるなら、保管したパスワードは引き継がない（別のサーバーへ渡さない）
    let e = c.set("p1", "https://b.example/dav/", "other", None).unwrap_err();
    assert_eq!(e.code, "invalid");
    assert_eq!(c.for_base("p1", &url).unwrap(), Some(("other".into(), "pass".into())), "断ったあとも、元のまま");
    c.set("p1", "https://b.example/dav/", "other", Some("new")).unwrap();
    let b = reqwest::Url::parse("https://b.example/dav/").unwrap();
    assert_eq!(c.for_base("p1", &b).unwrap(), Some(("other".into(), "new".into())));
}

#[test]
fn bad_user_names_and_insecure_http_are_refused() {
    let (m, s) = store();
    let c = Creds::new(s);
    assert_eq!(c.set("p", "https://a.example/", "", Some("x")).unwrap_err().code, "invalid");
    assert_eq!(c.set("p", "https://a.example/", "a:b", Some("x")).unwrap_err().code, "invalid");
    let e = c.set("p", "http://nas.example/dav/", "user", Some("x")).unwrap_err();
    assert_eq!(e.code, "invalid");
    assert!(e.message.contains("https"));
    assert!(m.map.lock().unwrap().is_empty(), "断ったものは保管しない");
    // この端末の中の http は使える
    for u in ["http://localhost:8080/dav/", "http://127.0.0.1:1/", "http://[::1]:1/"] {
        c.set("p", u, "user", Some("x")).unwrap_or_else(|e| panic!("{u}: {e}"));
    }
}

#[test]
fn which_urls_may_receive_a_password() {
    let ok = |s: &str| may_send_credentials(&reqwest::Url::parse(s).unwrap());
    assert!(ok("https://nas.example/"));
    assert!(ok("http://localhost/") && ok("http://127.0.0.1/") && ok("http://[::1]/"));
    assert!(!ok("http://nas.example/") && !ok("http://192.168.0.5/") && !ok("http://localhost.example/"));
}

#[test]
fn credentials_are_only_used_for_the_url_they_were_saved_for() {
    let (_m, s) = store();
    let c = Creds::new(s);
    let a = reqwest::Url::parse("https://a.example/dav/").unwrap();
    assert_eq!(c.for_base("p", &a).unwrap(), None, "保管が無ければ、認証なし");
    c.set("p", "https://a.example/dav", "user", Some("pass")).unwrap();
    assert!(c.for_base("p", &a).unwrap().is_some());
    let other = reqwest::Url::parse("https://evil.example/dav/").unwrap();
    assert_eq!(c.for_base("p", &other).unwrap_err().code, "auth");
    // 別の置き場所の id では使えない
    assert_eq!(c.for_base("q", &a).unwrap(), None);
}

#[test]
fn clearing_removes_the_credentials() {
    let (m, s) = store();
    let c = Creds::new(s);
    c.set("p", "https://a.example/", "user", Some("pass")).unwrap();
    c.clear("p").unwrap();
    assert_eq!(c.info("p").unwrap(), None);
    assert!(m.map.lock().unwrap().is_empty());
    c.clear("p").unwrap();
}

#[test]
fn without_a_keychain_it_fails_clearly_and_keeps_nothing_elsewhere() {
    let broken = Arc::new(MemoryStore { fail: true, ..Default::default() });
    let c = Creds::new(broken.clone());
    for e in [
        c.set("p", "https://a.example/", "user", Some("pass")).unwrap_err(),
        c.info("p").unwrap_err(),
        c.clear("p").unwrap_err(),
        c.for_base("p", &reqwest::Url::parse("https://a.example/").unwrap()).unwrap_err(),
    ] {
        assert_eq!(e.code, "keychain");
        assert!(e.message.starts_with("キーチェーンが使えません"), "{}", e.message);
    }
    // 書けなかったものを、覚えの中だけに持たない（あとで、保管したように見えない）
    assert!(c.info("p").is_err());
    assert!(broken.map.lock().unwrap().is_empty());
}

#[test]
fn an_unreadable_stored_value_counts_as_no_credentials() {
    let (m, s) = store();
    m.map.lock().unwrap().insert("p".into(), "これは JSON ではない".into());
    let c = Creds::new(s);
    assert_eq!(c.info("p").unwrap(), None);
}

// ---- Basic 認証 ----

#[tokio::test]
async fn every_kind_of_request_carries_the_basic_header_when_credentials_exist() {
    let s = MockServer::start().await;
    // PROPFIND は、聞かれたパス自身をフォルダとして答える（書いた・動かしたあとの確かめが通るように）
    Mock::given(method("PROPFIND"))
        .and(header("authorization", BASIC))
        .respond_with(|req: &wiremock::Request| {
            let body = format!(
                r#"<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>{}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>"#,
                req.url.path()
            );
            ResponseTemplate::new(207).set_body_raw(body, "application/xml")
        })
        .mount(&s)
        .await;
    for m in ["MKCOL", "PUT", "MOVE", "COPY", "DELETE", "GET"] {
        Mock::given(method(m)).and(header("authorization", BASIC)).respond_with(ResponseTemplate::new(201)).mount(&s).await;
    }
    let d = Dav::new(build_client(), &base_of(&s)).unwrap().with_auth(Some(("user".into(), "pass".into())));
    d.list("d").await.unwrap();
    d.mkdir("d").await.unwrap();
    d.put("d/f", Bytes::from_static(b"x"), None, None).await.unwrap();
    d.mv("d/f", "d/g", false).await.unwrap();
    d.copy("d/g", "d/h", false).await.unwrap();
    d.remove("d/h").await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    d.download("d/g", &dir.path().join("g"), None).await.unwrap();
    // どれも、認証つきの模擬にだけ当たる（当たらなければ 404 になって、上のどれかが失敗する）
    let reqs = s.received_requests().await.unwrap();
    assert!(reqs.len() >= 7);
    assert!(reqs.iter().all(|r| r.headers.get("authorization").is_some_and(|v| v == BASIC)), "認証の無い要求がある");
}

#[tokio::test]
async fn without_credentials_no_authorization_header_is_sent() {
    let s = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(200).set_body_bytes(b"x".to_vec())).mount(&s).await;
    let d = Dav::new(build_client(), &base_of(&s)).unwrap();
    let r = d.get_raw("f", None).await.unwrap();
    assert_eq!(r.status(), 200);
    assert!(s.received_requests().await.unwrap().iter().all(|r| r.headers.get("authorization").is_none()));
}

#[tokio::test]
async fn a_401_is_an_auth_error_that_does_not_echo_the_password() {
    let s = MockServer::start().await;
    Mock::given(method("PROPFIND")).respond_with(ResponseTemplate::new(401).insert_header("WWW-Authenticate", "Basic realm=\"x\"")).mount(&s).await;
    let d = Dav::new(build_client(), &base_of(&s)).unwrap().with_auth(Some(("user".into(), "s3cret-pass".into())));
    let e = d.list("").await.unwrap_err();
    assert_eq!(e.code, "auth");
    assert!(!e.message.contains("s3cret-pass") && !format!("{e:?}").contains("s3cret-pass"));
}

#[tokio::test]
async fn the_place_connection_uses_the_stored_credentials_and_refuses_a_different_server() {
    let s = MockServer::start().await;
    Mock::given(method("GET")).and(header("authorization", BASIC)).respond_with(ResponseTemplate::new(200).set_body_bytes(b"ok".to_vec())).mount(&s).await;
    let (_m, dynstore) = store();
    let conns = conns_with(dynstore);
    conns.creds.set("p1", &base_of(&s), "user", Some("pass")).unwrap();
    let d = conns.dav("p1", &base_of(&s)).await.unwrap();
    assert_eq!(d.get_raw("f", None).await.unwrap().status(), 200);
    // 接続先が違えば、送らずに断る（要求は 1 件のまま）
    let n = s.received_requests().await.unwrap().len();
    let e = conns.dav("p1", "https://evil.example/dav/").await.err().expect("断る");
    assert_eq!(e.code, "auth");
    assert_eq!(s.received_requests().await.unwrap().len(), n);
    // 保管の無い置き場所は、認証なし
    assert!(conns.dav("p2", &base_of(&s)).await.is_ok());
}

// ---- 表示の中継 ----

/// 画面（`davProxyUrl`）が作る形: 各段を符号化して、全体をもう一度符号化する
fn proxy_path(place: &str, base: &str, rel: &str) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    let inner = format!("{}/{}/{}", enc(place), enc(base), rel.split('/').map(enc).collect::<Vec<_>>().join("/"));
    format!("/{}", enc(&inner))
}

#[test]
fn the_proxy_path_is_split_back_into_place_base_and_path() {
    for rel in ["a.png", "写真/猫 と 犬.png", "100%/a#b?c.png", "x/y/z"] {
        let p = proxy_path("id-1", "https://nas.example/dav/", rel);
        assert_eq!(parse_path(&p), Some(("id-1".into(), "https://nas.example/dav/".into(), rel.into())), "{rel}");
    }
    assert_eq!(parse_path("/"), None);
    assert_eq!(parse_path("/only-one"), None);
    assert_eq!(parse_path("/%FF"), None);
}

async fn proxy_fixture() -> (MockServer, Conns) {
    let s = MockServer::start().await;
    let (_m, dynstore) = store();
    let conns = conns_with(dynstore);
    conns.creds.set("p1", &base_of(&s), "user", Some("pass")).unwrap();
    (s, conns)
}

fn hv<'a>(r: &'a super::proxy::ProxyResponse, name: &str) -> Option<&'a str> {
    r.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
}

#[tokio::test]
async fn the_proxy_fetches_with_credentials_and_lets_the_webview_read_it() {
    let (s, conns) = proxy_fixture().await;
    Mock::given(method("GET")).and(path("/dav/img/a%20b.png")).and(header("authorization", BASIC)).respond_with(ResponseTemplate::new(200).set_body_raw(b"PNGDATA".to_vec(), "image/png")).mount(&s).await;
    let r = serve(&conns, "GET", &proxy_path("p1", &base_of(&s), "img/a b.png"), None).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.body, b"PNGDATA");
    assert_eq!(hv(&r, "content-type"), Some("image/png"));
    assert_eq!(hv(&r, "access-control-allow-origin"), Some("*"));
    assert!(hv(&r, "access-control-expose-headers").unwrap().contains("Content-Range"));
    assert!(hv(&r, "cache-control").unwrap().contains("max-age"));
    assert_eq!(hv(&r, "x-content-type-options"), Some("nosniff"));
}

#[tokio::test]
async fn the_proxy_passes_range_requests_through() {
    let (s, conns) = proxy_fixture().await;
    Mock::given(method("GET")).and(header("range", "bytes=2-4")).respond_with(ResponseTemplate::new(206).insert_header("Content-Range", "bytes 2-4/10").insert_header("Accept-Ranges", "bytes").set_body_raw(b"234".to_vec(), "application/pdf")).mount(&s).await;
    let r = serve(&conns, "GET", &proxy_path("p1", &base_of(&s), "a.pdf"), Some("bytes=2-4")).await;
    assert_eq!(r.status, 206);
    assert_eq!(r.body, b"234");
    assert_eq!(hv(&r, "content-range"), Some("bytes 2-4/10"));
    assert_eq!(hv(&r, "accept-ranges"), Some("bytes"));
}

#[tokio::test]
async fn the_proxy_maps_failures_to_http_statuses_and_only_reads() {
    let (s, conns) = proxy_fixture().await;
    Mock::given(method("GET")).and(path("/dav/no")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
    Mock::given(method("GET")).and(path("/dav/locked")).respond_with(ResponseTemplate::new(401)).mount(&s).await;
    assert_eq!(serve(&conns, "GET", &proxy_path("p1", &base_of(&s), "no"), None).await.status, 404);
    assert_eq!(serve(&conns, "GET", &proxy_path("p1", &base_of(&s), "locked"), None).await.status, 401);
    assert_eq!(serve(&conns, "GET", "/zzz", None).await.status, 400);
    assert_eq!(serve(&conns, "GET", &proxy_path("p1", &base_of(&s), "../x"), None).await.status, 400);
    for m in ["POST", "PUT", "DELETE", "PROPFIND"] {
        assert_eq!(serve(&conns, m, &proxy_path("p1", &base_of(&s), "no"), None).await.status, 405, "{m}");
    }
    // 保管と違う接続先へは、パスワードを送らない
    let before = s.received_requests().await.unwrap().len();
    assert_eq!(serve(&conns, "GET", &proxy_path("p1", "https://evil.example/dav/", "a"), None).await.status, 401);
    assert_eq!(s.received_requests().await.unwrap().len(), before);
    let o = serve(&conns, "OPTIONS", "/anything", None).await;
    assert_eq!((o.status, hv(&o, "access-control-allow-origin")), (204, Some("*")));
}

#[tokio::test]
async fn the_proxy_refuses_what_is_too_big_for_memory_and_head_has_no_body() {
    let (s, conns) = proxy_fixture().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(200).set_body_bytes(vec![7u8; 20])).mount(&s).await;
    Mock::given(method("HEAD")).respond_with(ResponseTemplate::new(200).insert_header("Content-Length", "20")).mount(&s).await;
    let p = proxy_path("p1", &base_of(&s), "big.bin");
    assert_eq!(serve_limited(&conns, "GET", &p, None, 10).await.status, 413);
    assert_eq!(serve_limited(&conns, "GET", &p, None, 20).await.body.len(), 20);
    let h = serve(&conns, "HEAD", &p, None).await;
    assert!(h.body.is_empty());
}

// ---- 書き込みのストリーム ----

#[tokio::test]
async fn a_put_streams_the_chunks_as_one_request_with_progress() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).and(header("If-None-Match", "*")).respond_with(ResponseTemplate::new(201).insert_header("ETag", "\"e1\"")).mount(&s).await;
    Mock::given(method("PROPFIND")).respond_with(ResponseTemplate::new(404)).mount(&s).await;
    let jobs = Jobs::default();
    let puts = Puts::default();
    let seen = Arc::new(AtomicU64::new(0));
    let s2 = seen.clone();
    let p: Progress = Arc::new(move |d, t| {
        assert_eq!(t, 9);
        s2.store(d, Ordering::SeqCst);
    });
    let dav = Dav::new(build_client(), &base_of(&s)).unwrap();
    let (tx, task) = start_put(&jobs, dav, "dir/f.bin".into(), 9, None, "j1".into(), Some(p));
    for part in [&b"abc"[..], b"def", b"ghi"] {
        tx.send(Bytes::copy_from_slice(part)).await.unwrap();
    }
    // finish_put を使う形（登録を通す）
    puts_insert(&puts, "j1", tx, task);
    let e = finish_put(&jobs, &puts, "j1").await.unwrap();
    assert_eq!(e.etag.as_deref(), Some("\"e1\""));
    assert_eq!(seen.load(Ordering::SeqCst), 9);
    let put = s.received_requests().await.unwrap().into_iter().find(|r| r.method.as_str() == "PUT").unwrap();
    assert_eq!(put.body, b"abcdefghi");
    assert_eq!(put.headers.get("content-length").unwrap(), "9");
    assert!(jobs.is_empty());
}

/// `Puts` の中へ登録する（コマンドの `dav_put_open` と同じ手順）
fn puts_insert(puts: &Puts, job: &str, tx: tokio::sync::mpsc::Sender<Bytes>, task: tokio::task::JoinHandle<crate::fs::FsResult<DavEntry>>) {
    puts.insert_for_test(job, tx, task);
}

#[tokio::test]
async fn a_rejected_put_reports_the_servers_reason_at_finish() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(412)).mount(&s).await;
    let jobs = Jobs::default();
    let puts = Puts::default();
    let dav = Dav::new(build_client(), &base_of(&s)).unwrap();
    let (tx, task) = start_put(&jobs, dav, "f".into(), 3, None, "j2".into(), None);
    let _ = tx.send(Bytes::from_static(b"abc")).await;
    puts_insert(&puts, "j2", tx, task);
    assert_eq!(finish_put(&jobs, &puts, "j2").await.unwrap_err().code, "exists");
    // 終わったものを、もう一度は終えられない
    assert_eq!(finish_put(&jobs, &puts, "j2").await.unwrap_err().code, "invalid");
}

#[tokio::test]
async fn cancelling_a_streaming_put_stops_it_and_the_sender_notices() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(201).set_delay(std::time::Duration::from_secs(30))).mount(&s).await;
    let jobs = Jobs::default();
    let puts = Puts::default();
    let dav = Dav::new(build_client(), &base_of(&s)).unwrap();
    let (tx, task) = start_put(&jobs, dav, "f".into(), 100, None, "j3".into(), None);
    tx.send(Bytes::from_static(b"abc")).await.unwrap();
    assert!(jobs.cancel("j3"));
    puts_insert(&puts, "j3", tx.clone(), task);
    let r = tokio::time::timeout(std::time::Duration::from_secs(5), finish_put(&jobs, &puts, "j3")).await.expect("中止で止まる");
    assert_eq!(r.unwrap_err().code, "aborted");
    // 受け手が無くなったので、続きは送れない
    assert!(tx.send(Bytes::from_static(b"more")).await.is_err());
}

// ---- 一時ファイルの掃除 ----

#[test]
fn old_downloads_in_the_temp_folder_are_cleaned_and_recent_ones_stay() {
    let root = tempfile::tempdir().unwrap();
    let old = root.path().join("old");
    let fresh = root.path().join("fresh");
    for d in [&old, &fresh] {
        std::fs::create_dir(d).unwrap();
        std::fs::write(d.join("a.txt"), "x").unwrap();
    }
    let two_hours_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 3600);
    std::fs::File::open(&old).unwrap().set_modified(two_hours_ago).unwrap();
    assert_eq!(clean_temp(root.path(), std::time::Duration::from_secs(3600)), 1);
    assert!(!old.exists() && fresh.join("a.txt").exists());
    // 無いフォルダでも落ちない
    assert_eq!(clean_temp(&root.path().join("none"), std::time::Duration::from_secs(1)), 0);
}

// ---- OS のキーチェーン（手で動かす） ----

/// 本物の OS のキーチェーンで、保管・読み・消すを通す。キーチェーン（Linux は Secret Service）が要る。
/// 実行: `cargo test --lib os_keychain -- --ignored --nocapture`。使えない環境では、`keychain` の失敗になることを確かめる
#[test]
#[ignore = "OS のキーチェーンが要る"]
fn os_keychain_round_trip_or_a_clear_error() {
    let c = Creds::new(Arc::new(super::secret::OsStore));
    let place = format!("fixplor-test-{}", std::process::id());
    match c.set(&place, "https://nas.example/dav/", "user", Some("pass")) {
        Ok(()) => {
            let fresh = Creds::new(Arc::new(super::secret::OsStore));
            assert_eq!(fresh.info(&place).unwrap().unwrap().user, "user");
            fresh.clear(&place).unwrap();
            assert_eq!(Creds::new(Arc::new(super::secret::OsStore)).info(&place).unwrap(), None);
            eprintln!("キーチェーンが使えました");
        }
        Err(e) => {
            eprintln!("キーチェーンが使えない環境: {e}");
            assert_eq!(e.code, "keychain");
            assert!(e.message.starts_with("キーチェーンが使えません"));
        }
    }
}

#[test]
fn stored_credentials_for_an_unencrypted_server_are_never_sent() {
    // 保管の中身が（何かの理由で）暗号化されない接続先を指していても、送らない
    let (m, s) = store();
    m.map.lock().unwrap().insert("p".into(), r#"{"base":"http://nas.example/dav/","user":"u","password":"x"}"#.into());
    let c = Creds::new(s);
    let url = reqwest::Url::parse("http://nas.example/dav/").unwrap();
    assert_eq!(c.for_base("p", &url).unwrap_err().code, "auth");
}

#[tokio::test]
async fn finishing_a_put_that_sent_less_than_declared_fails_instead_of_hanging() {
    let s = MockServer::start().await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(201)).mount(&s).await;
    let jobs = Jobs::default();
    let puts = Puts::default();
    let dav = Dav::new(build_client(), &base_of(&s)).unwrap();
    let (tx, task) = start_put(&jobs, dav, "f".into(), 10, None, "j4".into(), None);
    tx.send(Bytes::from_static(b"abc")).await.unwrap();
    puts_insert(&puts, "j4", tx, task);
    let r = tokio::time::timeout(std::time::Duration::from_secs(5), finish_put(&jobs, &puts, "j4")).await.expect("終わりの印で、送信が閉じる");
    assert!(r.is_err());
}
