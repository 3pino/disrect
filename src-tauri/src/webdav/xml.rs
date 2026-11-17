//! PROPFIND の応答（207 Multi-Status）の解析。名前空間の接頭辞（`D:`・`d:`・なし）は気にせず、要素の名前だけで読む。

use crate::fs::{FsError, FsResult};
use quick_xml::events::Event;
use quick_xml::Reader;

/// 応答の 1 件（1 つの資源）。href は応答に書かれたままの文字（符号化されている）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Resource {
    pub href: String,
    pub collection: bool,
    pub size: Option<u64>,
    /// 更新時刻（UNIX 時刻のミリ秒）
    pub modified: Option<i64>,
    pub mime: Option<String>,
    /// 応答に書かれたままの ETag（引用符が付いているとは限らない）
    pub etag: Option<String>,
}

#[derive(Default)]
struct Props {
    collection: bool,
    size: Option<u64>,
    modified: Option<i64>,
    mime: Option<String>,
    etag: Option<String>,
}

fn bad(why: impl std::fmt::Display) -> FsError {
    FsError::new("server", format!("サーバーの応答を読めませんでした: {why}"))
}

/// 応答の本文から、資源の一覧を取り出す。成功（2xx）の propstat の値だけ使う
pub fn parse_multistatus(xml: &str) -> FsResult<Vec<Resource>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut out = Vec::new();
    let mut resource: Option<Resource> = None;
    let mut props: Option<Props> = None;
    let mut status_ok = true;
    // 今、文字を集めている要素
    let mut field: Option<String> = None;
    let mut text = String::new();
    let mut saw_root = false;
    loop {
        match reader.read_event().map_err(bad)? {
            Event::Start(e) => {
                let name = local(e.local_name().into_inner());
                match name.as_str() {
                    "multistatus" => saw_root = true,
                    "response" => resource = Some(Resource::default()),
                    "propstat" => {
                        props = Some(Props::default());
                        status_ok = true;
                    }
                    "href" | "status" | "getcontentlength" | "getlastmodified" | "getcontenttype" | "getetag" => {
                        field = Some(name);
                        text.clear();
                    }
                    "collection" => {
                        if let Some(p) = props.as_mut() {
                            p.collection = true;
                        }
                    }
                    _ => {}
                }
            }
            Event::Empty(e) => {
                if local(e.local_name().into_inner()) == "collection" {
                    if let Some(p) = props.as_mut() {
                        p.collection = true;
                    }
                }
            }
            Event::Text(t) => {
                if field.is_some() {
                    text.push_str(&t.xml10_content());
                }
            }
            Event::CData(t) => {
                if field.is_some() {
                    text.push_str(&t.xml10_content());
                }
            }
            Event::GeneralRef(r) => {
                if field.is_some() {
                    match r.resolve_char_ref().map_err(bad)? {
                        Some(c) => text.push(c),
                        None => match r.as_ref() {
                            "amp" => text.push('&'),
                            "lt" => text.push('<'),
                            "gt" => text.push('>'),
                            "quot" => text.push('"'),
                            "apos" => text.push('\''),
                            // 知らない実体は、そのまま残す
                            other => {
                                text.push('&');
                                text.push_str(other);
                                text.push(';');
                            }
                        },
                    }
                }
            }
            Event::End(e) => {
                let name = local(e.local_name().into_inner());
                if field.as_deref() == Some(name.as_str()) {
                    let value = text.trim().to_string();
                    match name.as_str() {
                        "href" => {
                            if let Some(r) = resource.as_mut() {
                                r.href = value;
                            }
                        }
                        "status" => status_ok = status_is_ok(&value),
                        _ => {
                            if let Some(p) = props.as_mut() {
                                match name.as_str() {
                                    "getcontentlength" => p.size = value.parse().ok(),
                                    "getlastmodified" => p.modified = parse_http_date(&value),
                                    "getcontenttype" => p.mime = Some(value).filter(|v| !v.is_empty()),
                                    "getetag" => p.etag = Some(value).filter(|v| !v.is_empty()),
                                    _ => {}
                                }
                            }
                        }
                    }
                    field = None;
                }
                match name.as_str() {
                    "propstat" => {
                        if let (Some(p), Some(r)) = (props.take(), resource.as_mut()) {
                            if status_ok {
                                r.collection |= p.collection;
                                r.size = r.size.or(p.size);
                                r.modified = r.modified.or(p.modified);
                                r.mime = r.mime.take().or(p.mime);
                                r.etag = r.etag.take().or(p.etag);
                            }
                        }
                    }
                    "response" => {
                        if let Some(r) = resource.take() {
                            if !r.href.is_empty() {
                                out.push(r);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_root {
        return Err(bad("multistatus がありません"));
    }
    Ok(out)
}

fn local(raw: &str) -> String {
    raw.to_ascii_lowercase()
}

/// `HTTP/1.1 200 OK` の形の状態の行が、成功か
fn status_is_ok(line: &str) -> bool {
    line.split_whitespace().nth(1).and_then(|c| c.parse::<u16>().ok()).is_some_and(|c| (200..300).contains(&c))
}

/// `Tue, 17 Nov 2026 07:53:48 GMT`（RFC 9110 の IMF-fixdate）を、UNIX 時刻のミリ秒にする。読めなければ None
pub fn parse_http_date(s: &str) -> Option<i64> {
    let s = s.trim();
    let rest = s.split_once(',').map_or(s, |(_, r)| r).trim();
    let mut it = rest.split_whitespace();
    let day: i64 = it.next()?.parse().ok()?;
    let month = match it.next()?.to_ascii_lowercase().as_str() {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    };
    let year: i64 = it.next()?.parse().ok()?;
    let mut hms = it.next()?.split(':');
    let h: i64 = hms.next()?.parse().ok()?;
    let m: i64 = hms.next()?.parse().ok()?;
    let sec: i64 = hms.next().unwrap_or("0").parse().ok()?;
    if !(1..=31).contains(&day) || h > 23 || m > 59 || sec > 60 {
        return None;
    }
    Some((days_from_civil(year, month, day) * 86400 + h * 3600 + m * 60 + sec) * 1000)
}

/// 年月日 → 1970-01-01 からの日数（グレゴリオ暦）
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = r#"<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/docs/</D:href><D:propstat><D:prop><D:getcontenttype>httpd/unix-directory</D:getcontenttype><D:getetag>6607431d0eb22</D:getetag><D:getlastmodified>Tue, 17 Nov 2026 07:53:48 GMT</D:getlastmodified><D:resourcetype><D:collection></D:collection></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>/dav/docs/a%20b.txt</D:href><D:propstat><D:prop><D:getcontentlength>5</D:getcontentlength><D:getetag>5-6607431d0eb22</D:getetag><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>"#;

    #[test]
    fn reads_the_shape_a_real_server_sends() {
        let r = parse_multistatus(REAL).unwrap();
        assert_eq!(r.len(), 2);
        assert!(r[0].collection);
        assert_eq!(r[0].href, "/dav/docs/");
        assert_eq!(r[0].etag.as_deref(), Some("6607431d0eb22"));
        assert_eq!(r[0].modified, Some(1_794_902_028_000));
        assert!(!r[1].collection);
        assert_eq!(r[1].size, Some(5));
        assert_eq!(r[1].href, "/dav/docs/a%20b.txt");
    }

    #[test]
    fn ignores_the_prefix_and_unknown_elements_and_uses_only_successful_propstats() {
        let xml = r#"<multistatus xmlns="DAV:"><response><href>/x/f.txt</href>
            <propstat><prop><getcontentlength>7</getcontentlength><getcontenttype>text/plain; charset=utf-8</getcontenttype><foo>bar</foo></prop><status>HTTP/1.1 200 OK</status></propstat>
            <propstat><prop><getetag/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response></multistatus>"#;
        let r = parse_multistatus(xml).unwrap();
        assert_eq!(r[0].size, Some(7));
        assert_eq!(r[0].mime.as_deref(), Some("text/plain; charset=utf-8"));
        assert_eq!(r[0].etag, None);
    }

    #[test]
    fn a_404_propstat_never_leaks_into_the_values() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/f</d:href>
            <d:propstat><d:prop><d:getcontentlength>99</d:getcontentlength></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>"#;
        assert_eq!(parse_multistatus(xml).unwrap()[0].size, None);
    }

    #[test]
    fn resolves_entities_in_href_and_etag() {
        let xml = r#"<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a&amp;b%26c/</D:href><D:propstat><D:prop><D:getetag>&quot;x&quot;</D:getetag><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>"#;
        let r = parse_multistatus(xml).unwrap();
        assert_eq!(r[0].href, "/a&b%26c/");
        assert_eq!(r[0].etag.as_deref(), Some("\"x\""));
        assert!(r[0].collection);
    }

    #[test]
    fn rejects_things_that_are_not_a_multistatus() {
        assert_eq!(parse_multistatus("<html>hi</html>").unwrap_err().code, "server");
        assert_eq!(parse_multistatus("<D:multistatus><D:response>").map(|v| v.len()).unwrap_or(0), 0);
    }

    #[test]
    fn dates() {
        assert_eq!(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"), Some(784_111_777_000));
        assert_eq!(parse_http_date("Mon, 29 Feb 2016 12:00:00 GMT"), Some(1_456_747_200_000));
        assert_eq!(parse_http_date("nonsense"), None);
        assert_eq!(parse_http_date("Sun, 32 Nov 1994 08:49:37 GMT"), None);
    }
}
