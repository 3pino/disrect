//! 証明書の指紋の固定の試験。本物の TLS（tokio-rustls の小さなサーバー）に、固定した・違う・固定の無い入れ物でつなぐ。
//! 試験の証明書は fixtures/ の固定のもの（ec P-256 の自己署名。CA:TRUE・有効期限 2126 年。a と b は別の鍵）。

use super::commands::{Conns, Puts};
use super::pin::{fingerprint_of, not_after, parse_fingerprint, probe, to_hex, Pins};
use super::proxy::serve;
use super::secret::{MemoryStore, SecretStore};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const CERT_A: &[u8] = include_bytes!("fixtures/a.crt.der");
const KEY_A: &[u8] = include_bytes!("fixtures/a.key.der");
const CERT_B: &[u8] = include_bytes!("fixtures/b.crt.der");
const KEY_B: &[u8] = include_bytes!("fixtures/b.key.der");

struct TlsServer {
    port: u16,
    /// 握手が済んで、HTTP の要求を読んだ数
    requests: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl TlsServer {
    fn base(&self) -> String {
        format!("https://127.0.0.1:{}/dav/", self.port)
    }
    fn requests(&self) -> usize {
        self.requests.load(Ordering::SeqCst)
    }
}

impl Drop for TlsServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn multistatus() -> String {
    let item = |href: &str, dir: bool| {
        format!(
            "<D:response><D:href>{href}</D:href><D:propstat><D:prop><D:resourcetype>{}</D:resourcetype>{}<D:getlastmodified>Tue, 17 Nov 2026 07:53:48 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
            if dir { "<D:collection/>" } else { "" },
            if dir { "" } else { "<D:getcontentlength>5</D:getcontentlength>" }
        )
    };
    format!(r#"<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">{}{}</D:multistatus>"#, item("/dav/", true), item("/dav/a.txt", false))
}

/// 証明書 `cert`・鍵 `key` で動く、1 接続 1 要求の最小の HTTPS サーバー（PROPFIND は 207、HEAD・GET は 200）
async fn tls_server(cert: &[u8], key: &[u8]) -> TlsServer {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![CertificateDer::from(cert.to_vec())], PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.to_vec())))
        .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = requests.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else { return };
            let acceptor = acceptor.clone();
            let counter = counter.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else { return };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    match tls.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                }
                counter.fetch_add(1, Ordering::SeqCst);
                let head = String::from_utf8_lossy(&buf).to_string();
                let (status, ctype, body) = if head.starts_with("PROPFIND") {
                    ("207 Multi-Status", "application/xml; charset=utf-8", multistatus())
                } else {
                    ("200 OK", "text/plain", "hello".to_string())
                };
                let body = if head.starts_with("HEAD") { String::new() } else { body };
                let res = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = tls.write_all(res.as_bytes()).await;
                let _ = tls.shutdown().await;
            });
        }
    });
    TlsServer { port, requests, task }
}

fn conns(pins: Pins) -> (Conns, Arc<MemoryStore>) {
    let mem = Arc::new(MemoryStore::default());
    let store: Arc<dyn SecretStore> = mem.clone();
    (Conns::with_pins(store, pins), mem)
}

fn hex_a() -> String {
    to_hex(&fingerprint_of(CERT_A))
}

fn proxy_path(place: &str, base: &str, rel: &str) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    let inner = format!("{}/{}/{}", enc(place), enc(base), rel.split('/').map(enc).collect::<Vec<_>>().join("/"));
    format!("/{}", enc(&inner))
}

// ---- 値の読み書き ----

#[test]
fn fingerprints_parse_in_the_usual_spellings_and_reject_the_wrong_length() {
    let hex = hex_a();
    let colon = hex.as_bytes().chunks(2).map(|c| std::str::from_utf8(c).unwrap().to_uppercase()).collect::<Vec<_>>().join(":");
    assert_eq!(to_hex(&parse_fingerprint(&colon).unwrap()), hex);
    assert_eq!(to_hex(&parse_fingerprint(&format!(" {hex} ")).unwrap()), hex);
    for bad in ["", "abcd", &hex[..62], &format!("{hex}00"), &hex.replace('a', "g"), "ー".repeat(32).as_str()] {
        assert_eq!(parse_fingerprint(bad).unwrap_err().code, "invalid", "{bad}");
    }
    // 検算: 作った fixtures の指紋（openssl x509 -fingerprint -sha256 と同じ値）
    assert_eq!(hex.to_uppercase(), "DE3CFB11D85E90A8E5590F5D14E5657492EC2564F890BCFB1446F2D9E9E6C62B");
}

#[test]
fn the_expiry_is_read_from_the_der_and_garbage_gives_none() {
    assert_eq!(not_after(CERT_A).as_deref(), Some("2126-10-25T04:58:05Z"));
    assert_eq!(not_after(CERT_B).as_deref(), Some("2126-10-25T04:58:05Z"));
    assert_eq!(not_after(&[]), None);
    assert_eq!(not_after(b"not a certificate"), None);
    assert_eq!(not_after(&CERT_A[..60]), None);
}

#[test]
fn pins_persist_atomically_are_bound_to_the_url_and_refuse_plain_http_and_bad_input() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sub").join("dav-pins.json");
    let pins = Pins::load(Some(path.clone()));
    assert_eq!(pins.info("p1"), None);
    pins.set("p1", "https://nas.example/dav", &hex_a()).unwrap();
    let info = pins.info("p1").unwrap();
    assert_eq!((info.base.as_str(), info.fingerprint.as_str()), ("https://nas.example/dav/", hex_a().as_str()));
    // 再起動しても残る（別の入れ物で読み直す）
    let again = Pins::load(Some(path.clone()));
    assert_eq!(again.info("p1"), Some(info));
    assert!(!path.with_extension("json.tmp").exists(), "一時のファイルが残っていない");
    // 固定は、固定した接続先にだけ効く
    let same = reqwest::Url::parse("https://nas.example/dav/").unwrap();
    let other = reqwest::Url::parse("https://other.example/dav/").unwrap();
    assert!(again.for_base("p1", &same).is_some());
    assert!(again.for_base("p1", &other).is_none());
    assert!(again.for_base("p2", &same).is_none());
    // 断る入力は、何も変えない
    assert_eq!(pins.set("p1", "http://nas.example/dav/", &hex_a()).unwrap_err().code, "invalid");
    assert_eq!(pins.set("p1", "https://nas.example/dav/", "zz").unwrap_err().code, "invalid");
    assert_eq!(pins.info("p1").unwrap().fingerprint, hex_a());
    // 置き換え・解除
    pins.set("p1", "https://b.example/dav/", &to_hex(&fingerprint_of(CERT_B))).unwrap();
    assert_eq!(Pins::load(Some(path.clone())).info("p1").unwrap().base, "https://b.example/dav/");
    pins.clear("p1").unwrap();
    pins.clear("p1").unwrap();
    assert_eq!(Pins::load(Some(path)).info("p1"), None);
}

#[test]
fn a_broken_file_starts_empty_and_a_missing_directory_refuses_to_pin() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dav-pins.json");
    std::fs::write(&path, "{ not json").unwrap();
    assert_eq!(Pins::load(Some(path)).info("p1"), None);
    // 保存先が無い環境では、固定したつもりにならない
    assert_eq!(Pins::load(None).set("p1", "https://a.example/dav/", &hex_a()).unwrap_err().code, "io");
    // 保存できなければ、覚えも変えない
    let blocked = dir.path().join("file");
    std::fs::write(&blocked, "x").unwrap();
    let pins = Pins::load(Some(blocked.join("dav-pins.json")));
    assert_eq!(pins.set("p1", "https://a.example/dav/", &hex_a()).unwrap_err().code, "io");
    assert_eq!(pins.info("p1"), None);
}

// ---- 本物の TLS ----

#[tokio::test]
async fn a_self_signed_server_is_refused_without_a_pin() {
    let s = tls_server(CERT_A, KEY_A).await;
    let (c, _m) = conns(Pins::memory());
    let e = c.dav("p1", &s.base()).await.unwrap().list("").await.unwrap_err();
    assert_eq!(e.code, "tls", "{}", e.message);
    assert_eq!(s.requests(), 0);
}

#[tokio::test]
async fn the_pinned_certificate_is_accepted_for_listing_and_for_the_proxy() {
    let s = tls_server(CERT_A, KEY_A).await;
    let pins = Pins::memory();
    pins.set("p1", &s.base(), &hex_a()).unwrap();
    let (c, _m) = conns(pins);
    let entries = c.dav("p1", &s.base()).await.unwrap().list("").await.unwrap();
    assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["a.txt"]);
    // 表示の中継（fixdav）も、同じ入口を通る
    let r = serve(&c, "GET", &proxy_path("p1", &s.base(), "a.txt"), None).await;
    assert_eq!((r.status, r.body.as_slice()), (200, b"hello".as_slice()));
    // 固定は置き場所ごと: 別の置き場所は、同じサーバーでも断られる
    let e = c.dav("p2", &s.base()).await.unwrap().list("").await.unwrap_err();
    assert_eq!(e.code, "tls");
    assert_eq!(serve(&c, "GET", &proxy_path("p2", &s.base(), "a.txt"), None).await.status, 502);
}

#[tokio::test]
async fn a_different_certificate_is_cert_changed_and_nothing_is_sent_not_even_the_password() {
    let s = tls_server(CERT_B, KEY_B).await;
    let pins = Pins::memory();
    pins.set("p1", &s.base(), &hex_a()).unwrap();
    let (c, m) = conns(pins);
    // 資格情報を保管してあっても（パスワードは、握手のあと = 要求に付く）、要求は 1 つも届かない
    c.creds.set("p1", &s.base(), "user", Some("pass")).unwrap();
    assert!(m.map.lock().unwrap().contains_key("p1"));
    let e = c.dav("p1", &s.base()).await.unwrap().list("").await.unwrap_err();
    assert_eq!(e.code, "cert_changed", "{}", e.message);
    assert_eq!(s.requests(), 0);
    assert_eq!(serve(&c, "GET", &proxy_path("p1", &s.base(), "a.txt"), None).await.status, 502);
    assert_eq!(s.requests(), 0);
    // 信頼し直す（新しい指紋）と通る
    c.pins.set("p1", &s.base(), &to_hex(&fingerprint_of(CERT_B))).unwrap();
    assert!(c.dav("p1", &s.base()).await.unwrap().list("").await.is_ok());
    // 解除すると、通常の確かめ（自己署名なので断られる）に戻る
    c.pins.clear("p1").unwrap();
    assert_eq!(c.dav("p1", &s.base()).await.unwrap().list("").await.unwrap_err().code, "tls");
}

#[tokio::test]
async fn the_handshake_signature_is_checked_so_a_copied_certificate_without_its_key_fails() {
    // 固定の証明書（a）を、別の鍵（b）で署名して示す相手。指紋は合うが、鍵を持っていない
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let key = provider.key_provider.load_private_key(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(KEY_B.to_vec()))).unwrap();
    let certified = Arc::new(rustls::sign::CertifiedKey::new(vec![CertificateDer::from(CERT_A.to_vec())], key));
    struct Fixed(Arc<rustls::sign::CertifiedKey>);
    impl std::fmt::Debug for Fixed {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("Fixed")
        }
    }
    impl rustls::server::ResolvesServerCert for Fixed {
        fn resolve(&self, _: rustls::server::ClientHello<'_>) -> Option<Arc<rustls::sign::CertifiedKey>> {
            Some(self.0.clone())
        }
    }
    let config = rustls::ServerConfig::builder_with_provider(provider).with_safe_default_protocol_versions().unwrap().with_no_client_auth().with_cert_resolver(Arc::new(Fixed(certified)));
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("https://127.0.0.1:{}/dav/", listener.local_addr().unwrap().port());
    // 握手を最後までやり遂げた数（相手が受け入れたら増える）
    let completed = Arc::new(AtomicUsize::new(0));
    let done = completed.clone();
    let task = tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let (acceptor, done) = (acceptor.clone(), done.clone());
            tokio::spawn(async move {
                if let Ok(mut tls) = acceptor.accept(tcp).await {
                    done.fetch_add(1, Ordering::SeqCst);
                    let mut b = [0u8; 1];
                    let _ = tls.read(&mut b).await;
                }
            });
        }
    });
    let pins = Pins::memory();
    pins.set("p1", &base, &hex_a()).unwrap();
    let (c, _m) = conns(pins);
    let e = c.dav("p1", &base).await.unwrap().list("").await.unwrap_err();
    task.abort();
    // 握手が成り立たず（署名が合わない）、つながらない。指紋だけでは通さない
    assert_eq!(e.code, "tls", "{}", e.message);
    assert_eq!(completed.load(Ordering::SeqCst), 0, "握手が最後まで通ってしまった");
}

#[tokio::test]
async fn a_pin_for_another_url_does_not_apply() {
    let s = tls_server(CERT_A, KEY_A).await;
    let pins = Pins::memory();
    pins.set("p1", "https://other.example/dav/", &hex_a()).unwrap();
    let (c, _m) = conns(pins);
    assert_eq!(c.dav("p1", &s.base()).await.unwrap().list("").await.unwrap_err().code, "tls");
}

#[tokio::test]
async fn probe_reports_the_presented_fingerprint_and_expiry_without_sending_a_request() {
    let s = tls_server(CERT_A, KEY_A).await;
    let r = probe(&s.base()).await.unwrap();
    assert!(!r.trusted);
    assert_eq!(r.fingerprint.as_deref(), Some(hex_a().as_str()));
    assert_eq!(r.not_after.as_deref(), Some("2126-10-25T04:58:05Z"));
    assert_eq!(s.requests(), 0, "確認は握手だけ（要求を送らない）");
    // 示された指紋で固定すると、そのまま通る（確認 → 信頼の流れ）
    let pins = Pins::memory();
    pins.set("p1", &s.base(), r.fingerprint.as_deref().unwrap()).unwrap();
    let (c, _m) = conns(pins);
    assert!(c.dav("p1", &s.base()).await.unwrap().list("").await.is_ok());
}

#[tokio::test]
async fn probe_refuses_http_and_reports_an_unreachable_server_as_offline() {
    assert_eq!(probe("http://127.0.0.1:1/dav/").await.unwrap_err().code, "invalid");
    assert_eq!(probe("https://127.0.0.1:1/dav/").await.unwrap_err().code, "offline");
}

#[test]
fn puts_state_is_unaffected_by_pins() {
    // 書き込みの登録（Puts）は、入れ物を持たない。固定を足しても、状態の作り方が変わらない
    let _ = Puts::default();
    let (conns, jobs, _puts) = super::commands::state(Arc::new(MemoryStore::default()), Pins::memory());
    assert!(jobs.is_empty());
    assert!(conns.pins.info("x").is_none());
}
