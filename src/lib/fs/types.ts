// この端末のファイルシステム（Rust の src-tauri/src/fs）とやりとりする値。パスは OS の絶対パス。
// 画面（共有の部品 @3pino/explorer-kit）が見る形へは local.ts が直す。

export type FsKind = 'file' | 'dir';

/** 一覧の 1 行（Rust の Entry） */
export type FsEntry = {
  name: string;
  /** OS の絶対パス */
  path: string;
  /** リンクは、辿った先の種類 */
  kind: FsKind;
  /** バイト数。フォルダは null */
  size: number | null;
  /** 更新時刻（UNIX 時刻のミリ秒）。分からなければ null */
  modified: number | null;
  hidden: boolean;
  readonly: boolean;
  symlink: boolean;
};

/** ネットワークの置き場所の一覧の 1 行（Rust の DavEntry）。path は、接続先からの相対（区切り `/`） */
export type DavEntry = {
  name: string;
  path: string;
  kind: FsKind;
  size: number | null;
  modified: number | null;
  hidden: boolean;
  mime: string | null;
  /** サーバーが返した ETag（上書きのとき、読んだ時点のものだけを上書きするのに使う） */
  etag: string | null;
};

export type FsSize = { size: number; files: number; dirs: number; partial: boolean };

/** 左の一覧に出す場所 */
export type FsPlace = {
  kind: 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos' | 'root' | 'volume';
  path: string;
  /** volume の表示名。ほかは空（画面が kind から名前を決める） */
  name: string;
};

/** 失敗の種類（画面の分岐に使う。Rust の FsError.code と同じ） */
export type FsErrorCode =
  | 'invalid'
  | 'not_found'
  | 'parent_missing'
  | 'exists'
  | 'same_path'
  | 'into_self'
  | 'denied'
  | 'not_dir'
  | 'is_dir'
  | 'not_empty'
  | 'unsupported'
  | 'partial'
  | 'io'
  // ネットワークの置き場所（WebDAV）
  | 'offline'
  | 'tls'
  | 'cert_changed'
  | 'auth'
  | 'precondition'
  | 'locked'
  | 'too_large'
  | 'no_space'
  | 'server'
  | 'aborted'
  | 'keychain';

export class FsError extends Error {
  constructor(
    readonly code: FsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FsError';
  }
}
