use super::*;
use std::fs as stdfs;
use std::path::Path;
use tempfile::tempdir;

fn write(path: &Path, body: &str) {
    stdfs::write(path, body).unwrap();
}

fn read(path: &Path) -> String {
    stdfs::read_to_string(path).unwrap()
}

/// 一時のファイル（.fixplor-*.part）が残っていないこと
fn no_leftovers(dir: &Path) {
    let left: Vec<_> = stdfs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(".fixplor-"))
        .collect();
    assert!(left.is_empty(), "一時のファイルが残っています: {left:?}");
}

#[test]
fn abs_rejects_relative_empty_and_nul() {
    assert_eq!(abs("").unwrap_err().code, "invalid");
    assert_eq!(abs("a/b").unwrap_err().code, "invalid");
    assert_eq!(abs("/a\0b").unwrap_err().code, "invalid");
    let d = tempdir().unwrap();
    assert!(abs(&d.path().to_string_lossy()).is_ok());
}

#[test]
fn list_reports_kind_size_hidden() {
    let d = tempdir().unwrap();
    write(&d.path().join("a.txt"), "hello");
    write(&d.path().join(".secret"), "");
    stdfs::create_dir(d.path().join("sub")).unwrap();
    let mut got = list(d.path()).unwrap();
    got.sort_by(|a, b| a.name.cmp(&b.name));
    let names: Vec<_> = got.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, [".secret", "a.txt", "sub"]);
    assert!(got[0].hidden);
    assert_eq!((got[1].kind, got[1].size, got[1].hidden), (Kind::File, Some(5), false));
    assert_eq!((got[2].kind, got[2].size), (Kind::Dir, None));
    assert!(got[1].modified.is_some());
    assert_eq!(got[1].path, d.path().join("a.txt").to_string_lossy());
}

#[test]
fn list_of_missing_or_file_fails_with_code() {
    let d = tempdir().unwrap();
    write(&d.path().join("f"), "x");
    assert_eq!(list(&d.path().join("nope")).unwrap_err().code, "not_found");
    assert_eq!(list(&d.path().join("f")).unwrap_err().code, "not_dir");
}

#[cfg(unix)]
#[test]
fn symlinks_show_the_target_kind_and_broken_ones_are_files() {
    let d = tempdir().unwrap();
    stdfs::create_dir(d.path().join("real")).unwrap();
    std::os::unix::fs::symlink(d.path().join("real"), d.path().join("to-dir")).unwrap();
    std::os::unix::fs::symlink(d.path().join("gone"), d.path().join("broken")).unwrap();
    let dir = entry_of(&d.path().join("to-dir")).unwrap();
    assert_eq!((dir.kind, dir.symlink), (Kind::Dir, true));
    let broken = entry_of(&d.path().join("broken")).unwrap();
    assert_eq!((broken.kind, broken.symlink), (Kind::File, true));
    // 切れたリンクがあっても、一覧は出る
    assert_eq!(list(d.path()).unwrap().len(), 3);
}

#[test]
fn mkdir_needs_a_parent_and_does_not_replace() {
    let d = tempdir().unwrap();
    assert_eq!(mkdir(&d.path().join("new")).unwrap().kind, Kind::Dir);
    assert_eq!(mkdir(&d.path().join("new")).unwrap_err().code, "exists");
    assert_eq!(mkdir(&d.path().join("no/child")).unwrap_err().code, "parent_missing");
    write(&d.path().join("f"), "x");
    assert_eq!(mkdir(&d.path().join("f/child")).unwrap_err().code, "not_dir");
}

#[test]
fn rename_moves_and_never_replaces_silently() {
    let d = tempdir().unwrap();
    let (a, b) = (d.path().join("a"), d.path().join("b"));
    write(&a, "A");
    write(&b, "B");
    assert_eq!(rename(&a, &b, false).unwrap_err().code, "exists");
    assert_eq!((read(&a), read(&b)), ("A".into(), "B".into()));
    // 上書きを明示したときだけ置き換える
    assert_eq!(rename(&a, &b, true).unwrap().name, "b");
    assert!(!a.exists());
    assert_eq!(read(&b), "A");
    assert_eq!(rename(&d.path().join("nope"), &d.path().join("x"), false).unwrap_err().code, "not_found");
    assert_eq!(rename(&b, &d.path().join("no/x"), false).unwrap_err().code, "parent_missing");
}

#[test]
fn overwrite_never_replaces_or_merges_folders() {
    let d = tempdir().unwrap();
    let (dir, other, file) = (d.path().join("dir"), d.path().join("other"), d.path().join("file"));
    stdfs::create_dir(&dir).unwrap();
    stdfs::create_dir(&other).unwrap();
    write(&other.join("keep"), "K");
    write(&file, "F");
    for (from, to) in [(&dir, &other), (&file, &other), (&dir, &file)] {
        assert_eq!(rename(from, to, true).unwrap_err().code, "exists");
        assert_eq!(copy(from, to, true).unwrap_err().code, "exists");
    }
    assert_eq!(read(&other.join("keep")), "K");
    assert_eq!(read(&file), "F");
    assert!(dir.is_dir());
    no_leftovers(d.path());
}

#[test]
fn a_folder_cannot_go_into_itself() {
    let d = tempdir().unwrap();
    let dir = d.path().join("dir");
    stdfs::create_dir_all(dir.join("inner")).unwrap();
    assert_eq!(rename(&dir, &dir.join("inner/dir"), false).unwrap_err().code, "into_self");
    assert_eq!(copy(&dir, &dir.join("copy"), false).unwrap_err().code, "into_self");
    assert_eq!(copy(&dir, &dir, true).unwrap_err().code, "same_path");
    assert!(dir.join("inner").is_dir());
    no_leftovers(&dir);
}

#[test]
fn copying_a_file_onto_itself_is_refused_and_keeps_the_body() {
    let d = tempdir().unwrap();
    let a = d.path().join("a");
    write(&a, "body");
    assert_eq!(copy(&a, &a, true).unwrap_err().code, "same_path");
    assert_eq!(rename(&a, &a, true).unwrap_err().code, "same_path");
    assert_eq!(read(&a), "body");
}

#[cfg(unix)]
#[test]
fn a_link_to_a_file_does_not_count_as_the_same_and_cannot_clobber_it() {
    let d = tempdir().unwrap();
    let (real, link) = (d.path().join("real"), d.path().join("link"));
    write(&real, "body");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    // リンクを本体の名前へ動かすと、本体が消えてしまう。上書きを明示しても通さない
    assert_eq!(rename(&link, &real, true).unwrap_err().code, "same_path");
    assert_eq!(read(&real), "body");
}

#[test]
fn copy_copies_trees_and_keeps_the_source() {
    let d = tempdir().unwrap();
    let src = d.path().join("src");
    stdfs::create_dir_all(src.join("deep/er")).unwrap();
    write(&src.join("top.txt"), "top");
    write(&src.join("deep/er/leaf.txt"), "leaf");
    let got = copy(&src, &d.path().join("dst"), false).unwrap();
    assert_eq!((got.name.as_str(), got.kind), ("dst", Kind::Dir));
    assert_eq!(read(&d.path().join("dst/top.txt")), "top");
    assert_eq!(read(&d.path().join("dst/deep/er/leaf.txt")), "leaf");
    assert_eq!(read(&src.join("deep/er/leaf.txt")), "leaf");
    no_leftovers(d.path());
}

#[test]
fn copy_keeps_the_modified_time_and_replaces_only_when_asked() {
    let d = tempdir().unwrap();
    let (a, b) = (d.path().join("a"), d.path().join("b"));
    write(&a, "new");
    write(&b, "old");
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
    stdfs::File::options().write(true).open(&a).unwrap().set_modified(old).unwrap();
    assert_eq!(copy(&a, &b, false).unwrap_err().code, "exists");
    assert_eq!(read(&b), "old");
    let got = copy(&a, &b, true).unwrap();
    assert_eq!(read(&b), "new");
    assert_eq!(got.modified, Some(1_000_000_000_000));
    no_leftovers(d.path());
}

#[cfg(unix)]
#[test]
fn copy_keeps_links_as_links_and_does_not_follow_them() {
    let d = tempdir().unwrap();
    let outside = d.path().join("outside");
    stdfs::create_dir(&outside).unwrap();
    write(&outside.join("big"), "do not copy me");
    let src = d.path().join("src");
    stdfs::create_dir(&src).unwrap();
    std::os::unix::fs::symlink(&outside, src.join("link")).unwrap();
    copy(&src, &d.path().join("dst"), false).unwrap();
    let copied = d.path().join("dst/link");
    assert!(stdfs::symlink_metadata(&copied).unwrap().file_type().is_symlink());
    assert_eq!(stdfs::read_link(&copied).unwrap(), outside);
}

#[cfg(unix)]
#[test]
fn a_failed_copy_leaves_nothing_at_the_destination() {
    use std::os::unix::fs::PermissionsExt;
    let d = tempdir().unwrap();
    let src = d.path().join("src");
    stdfs::create_dir(&src).unwrap();
    write(&src.join("ok"), "ok");
    write(&src.join("locked"), "secret");
    stdfs::set_permissions(src.join("locked"), stdfs::Permissions::from_mode(0o000)).unwrap();
    // root で動かすと権限で止まらない（そのときは、この確かめは意味を持たない）
    if stdfs::read(src.join("locked")).is_ok() {
        return;
    }
    let dst = d.path().join("dst");
    assert_eq!(copy(&src, &dst, false).unwrap_err().code, "denied");
    assert!(!dst.exists());
    no_leftovers(d.path());
}

#[test]
fn size_counts_files_and_folders_below() {
    let d = tempdir().unwrap();
    let root = d.path().join("root");
    stdfs::create_dir_all(root.join("a/b")).unwrap();
    write(&root.join("one"), "12345");
    write(&root.join("a/b/two"), "123");
    assert_eq!(size(&root).unwrap(), Size { size: 8, files: 2, dirs: 2, partial: false });
    assert_eq!(size(&root.join("one")).unwrap(), Size { size: 5, files: 1, dirs: 0, partial: false });
    assert_eq!(size(&root.join("nope")).unwrap_err().code, "not_found");
    // 調べる項目に上限があると、そこで止めて partial にする
    let limited = size_within(&root, 1).unwrap();
    assert!(limited.partial);
    assert!(!size_within(&root, 100).unwrap().partial);
}

#[test]
fn trash_of_a_missing_path_is_not_found() {
    let d = tempdir().unwrap();
    assert_eq!(trash(&d.path().join("nope")).unwrap_err().code, "not_found");
}

#[test]
fn errors_serialize_as_code_and_message() {
    let v = serde_json::to_value(FsError::new("exists", "m")).unwrap();
    assert_eq!(v, serde_json::json!({ "code": "exists", "message": "m" }));
    let d = tempdir().unwrap();
    write(&d.path().join("f"), "x");
    let e = serde_json::to_value(entry_of(&d.path().join("f")).unwrap()).unwrap();
    assert_eq!(e["kind"], "file");
    assert!(e.get("modified").is_some() && e.get("readonly").is_some() && e.get("symlink").is_some());
}

#[test]
fn write_file_creates_replaces_files_and_never_folders() {
    let d = tempdir().unwrap();
    let f = d.path().join("f.txt");
    assert_eq!(write_file(&f, b"one").unwrap().size, Some(3));
    assert_eq!(write_file(&f, b"second").unwrap().size, Some(6));
    assert_eq!(read(&f), "second");
    stdfs::create_dir(d.path().join("dir")).unwrap();
    assert_eq!(write_file(&d.path().join("dir"), b"x").unwrap_err().code, "is_dir");
    assert!(d.path().join("dir").is_dir());
    assert_eq!(write_file(&d.path().join("no/f"), b"x").unwrap_err().code, "parent_missing");
    no_leftovers(d.path());
}

// ---- 検索 ----

mod search_tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    fn mk(root: &Path, rel: &str, body: Option<&str>) {
        let p = root.join(rel);
        match body {
            Some(b) => {
                stdfs::create_dir_all(p.parent().unwrap()).unwrap();
                stdfs::write(&p, b).unwrap();
            }
            None => stdfs::create_dir_all(&p).unwrap(),
        }
    }

    fn run(root: &Path, text: &str, hidden: bool, limits: Limits) -> (Vec<String>, Outcome) {
        let cancel = AtomicBool::new(false);
        let mut got: Vec<String> = Vec::new();
        let out = search(root, text, hidden, limits, &cancel, |b| got.extend(b.into_iter().map(|e| e.path))).unwrap();
        got.sort();
        (got, out)
    }

    fn rel(root: &Path, got: &[String]) -> Vec<String> {
        got.iter().map(|p| Path::new(p).strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/")).collect()
    }

    #[test]
    fn finds_by_name_substring_ignoring_case_in_subfolders() {
        let d = tempdir().unwrap();
        mk(d.path(), "a/Cat.png", Some("x"));
        mk(d.path(), "a/b/concat.txt", Some("x"));
        mk(d.path(), "a/b/dog.md", Some("x"));
        mk(d.path(), "CATALOG/readme", Some("x"));
        mk(d.path(), "写真/ネコ.jpg", Some("x"));
        let (got, out) = run(d.path(), " CAT ", false, Limits::default());
        assert_eq!(rel(d.path(), &got), ["CATALOG", "a/Cat.png", "a/b/concat.txt"]);
        assert_eq!(out, Outcome { partial: None });
        // 日本語・空の文字
        assert_eq!(rel(d.path(), &run(d.path(), "ネコ", false, Limits::default()).0), ["写真/ネコ.jpg"]);
        let (none, out) = run(d.path(), "  ", false, Limits::default());
        assert!(none.is_empty());
        assert_eq!(out.partial, None);
    }

    #[test]
    fn hits_are_the_same_shape_as_a_listing_entry() {
        let d = tempdir().unwrap();
        mk(d.path(), "x/hello.txt", Some("12345"));
        mk(d.path(), "x/hello-dir", None);
        let cancel = AtomicBool::new(false);
        let mut got = Vec::new();
        search(d.path(), "hello", false, Limits::default(), &cancel, |b| got.extend(b)).unwrap();
        got.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!((got[0].kind, got[0].size), (Kind::Dir, None));
        assert_eq!((got[1].kind, got[1].size, got[1].hidden), (Kind::File, Some(5), false));
        assert!(Path::new(&got[1].path).is_absolute());
    }

    #[test]
    fn hidden_items_are_skipped_and_not_entered_unless_asked() {
        let d = tempdir().unwrap();
        mk(d.path(), ".git/needle-in-git", Some("x"));
        mk(d.path(), "src/.needle", Some("x"));
        mk(d.path(), "src/needle.rs", Some("x"));
        assert_eq!(rel(d.path(), &run(d.path(), "needle", false, Limits::default()).0), ["src/needle.rs"]);
        assert_eq!(rel(d.path(), &run(d.path(), "needle", true, Limits::default()).0), [".git/needle-in-git", "src/.needle", "src/needle.rs"]);
    }

    #[test]
    fn limits_stop_the_search_and_say_why() {
        let d = tempdir().unwrap();
        for i in 0..30 {
            mk(d.path(), &format!("d{}/hit{i}.txt", i % 3), Some("x"));
        }
        // 件数
        let (got, out) = run(d.path(), "hit", false, Limits { max_hits: 7, ..Limits::default() });
        assert_eq!((got.len(), out.partial), (7, Some(Partial::Hits)));
        // 調べる数
        let (_, out) = run(d.path(), "hit", false, Limits { max_scanned: 10, ..Limits::default() });
        assert_eq!(out.partial, Some(Partial::Scan));
        // 深さ（根の直下までしか下りない）
        mk(d.path(), "deep/er/est/hit-deep.txt", Some("x"));
        let (got, out) = run(d.path(), "hit-deep", false, Limits { max_depth: 1, ..Limits::default() });
        assert!(got.is_empty());
        assert_eq!(out.partial, Some(Partial::Depth));
        let (got, out) = run(d.path(), "hit-deep", false, Limits { max_depth: 3, ..Limits::default() });
        assert_eq!((got.len(), out.partial), (1, None));
        // 時間
        let (_, out) = run(d.path(), "hit", false, Limits { max_time: Duration::ZERO, ..Limits::default() });
        assert_eq!(out.partial, Some(Partial::Time));
    }

    #[test]
    fn cancelling_stops_with_aborted_even_in_the_middle() {
        let d = tempdir().unwrap();
        for i in 0..200 {
            mk(d.path(), &format!("f{i:03}.txt"), Some("x"));
        }
        // 始める前から中止
        let cancel = AtomicBool::new(true);
        assert_eq!(search(d.path(), "f", false, Limits::default(), &cancel, |_| {}).unwrap_err().code, "aborted");
        // 途中（1 回目の結果を受け取ったところ）で中止: 続きは探さない
        let cancel = AtomicBool::new(false);
        let mut delivered = 0;
        let e = search(d.path(), "f", false, Limits::default(), &cancel, |b| {
            delivered += b.len();
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap_err();
        assert_eq!(e.code, "aborted");
        assert_eq!(delivered, 50);
    }

    #[test]
    fn a_missing_root_or_a_file_as_root_fails() {
        let d = tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let e = search(&d.path().join("nope"), "x", false, Limits::default(), &cancel, |_| {}).unwrap_err();
        assert_eq!(e.code, "not_found");
        // ファイルを根にすると読めない
        mk(d.path(), "file.txt", Some("x"));
        assert!(search(&d.path().join("file.txt"), "x", false, Limits::default(), &cancel, |_| {}).is_err());
    }

    #[test]
    fn hits_are_delivered_in_batches_and_the_last_partial_batch_is_not_lost() {
        let d = tempdir().unwrap();
        for i in 0..120 {
            mk(d.path(), &format!("m{i:03}.txt"), Some("x"));
        }
        let cancel = AtomicBool::new(false);
        let mut sizes = Vec::new();
        search(d.path(), "m", false, Limits::default(), &cancel, |b| sizes.push(b.len())).unwrap();
        assert_eq!(sizes.iter().sum::<usize>(), 120);
        assert_eq!(sizes, [50, 50, 20]);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_is_listed_when_it_matches_but_never_entered() {
        let d = tempdir().unwrap();
        mk(d.path(), "real/inner-needle.txt", Some("x"));
        std::os::unix::fs::symlink(d.path().join("real"), d.path().join("link-needle")).unwrap();
        // 輪になるリンク
        std::os::unix::fs::symlink(d.path(), d.path().join("real/loop")).unwrap();
        let (got, out) = run(d.path(), "needle", false, Limits::default());
        assert_eq!(rel(d.path(), &got), ["link-needle", "real/inner-needle.txt"]);
        assert_eq!(out.partial, None);
    }
}
