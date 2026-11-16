import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { basicNameError, isImageName, type Entry, type EntryUrls, type ExplorerApi, type Rules } from '@3pino/explorer-kit';
import { fromOs, isWindowsPath, toOs } from './mapping';
import { FsError, type FsEntry, type FsErrorCode, type FsPlace, type FsSize } from './types';

// この端末のファイルシステムを、共有の部品（@3pino/explorer-kit）の置き場所（ExplorerApi）として見せる。
// 実体は Rust（src-tauri/src/fs）。画面のパス（相対・区切り `/`）と OS の絶対パスの対応は mapping.ts。

const CODES: ReadonlySet<string> = new Set<FsErrorCode>([
  'invalid', 'not_found', 'parent_missing', 'exists', 'same_path', 'into_self',
  'denied', 'not_dir', 'is_dir', 'not_empty', 'unsupported', 'partial', 'io',
]);

/** Rust から届いた失敗（{ code, message }）を FsError にする（形が違うものは io） */
export function toFsError(e: unknown): FsError {
  if (e instanceof FsError) return e;
  if (typeof e === 'object' && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && CODES.has(code)) return new FsError(code as FsErrorCode, typeof message === 'string' ? message : code);
  }
  return new FsError('io', e instanceof Error ? e.message : String(e));
}

/** Rust のコマンドを呼ぶ口（試験で差し替える）。body を渡すと、生のバイト列として送る（パスなどは headers） */
export type Call = <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>) => Promise<T>;

const tauriCall: Call = (cmd, args, headers) => invoke(cmd, args, headers ? { headers } : undefined);

export type LocalOptions = {
  call?: Call;
  /** 隠しファイル（. で始まるもの・Windows の隠し属性）を一覧に出すか */
  showHidden?: () => boolean;
};

export type LocalFs = {
  api: ExplorerApi;
  urls: EntryUrls;
  rules: Rules;
  /** この端末が Windows のパスを使うか（最初の場所から決める） */
  windows: boolean;
  /** 最初に開く場所（画面のパス） */
  start: string;
  /** 左に出す場所（path は画面のパス） */
  places(): Promise<FsPlace[]>;
  /** 既定のアプリで開く */
  open(path: string): Promise<void>;
  /** 画面のパス → OS の絶対パス（場所の欄に出す）。Windows のいちばん上は空文字 */
  osPath(path: string): string;
  /** OS の絶対パス → 画面のパス（場所の欄に打ったもの） */
  fromOsPath(abs: string): string;
  isMissing(e: unknown): boolean;
};

/** 既定のアプリで開くための、項目の URL（画面の <a href> に入る。押しは本体が受けて、Rust の fs_open を呼ぶ） */
const OPEN_SCHEME = 'disrect-open:';
export function openHref(path: string): string {
  return OPEN_SCHEME + encodeURIComponent(path);
}
/** openHref の逆（違う形なら null） */
export function pathOfOpenHref(url: string): string | null {
  if (!url.startsWith(OPEN_SCHEME)) return null;
  try {
    return decodeURIComponent(url.slice(OPEN_SCHEME.length));
  } catch {
    return null;
  }
}

export async function createLocalFs(options: LocalOptions = {}): Promise<LocalFs> {
  const call = options.call ?? tauriCall;
  const showHidden = options.showHidden ?? (() => false);
  const run = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> => {
    try {
      return await call<T>(cmd, args, headers);
    } catch (e) {
      throw toFsError(e);
    }
  };
  const startOs = await run<string>('fs_start_dir');
  const windows = isWindowsPath(startOs);

  /** OS のパス（無い場所なら、この操作はできない） */
  const os = (path: string): string => {
    const abs = toOs(path, windows);
    if (abs === null) throw new FsError('unsupported', 'ここでは、この操作はできません（ドライブを開いてください）');
    return abs;
  };
  const entry = (raw: FsEntry): Entry => {
    const path = fromOs(raw.path);
    return {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      kind: raw.kind,
      size: raw.size ?? 0,
      modified: raw.modified ?? 0,
      mime: null,
      message_id: null,
      file_id: null,
    };
  };
  const places = async (): Promise<FsPlace[]> => (await run<FsPlace[]>('fs_places')).map((p) => ({ ...p, path: fromOs(p.path) }));

  const api: ExplorerApi = {
    async list(path) {
      const abs = toOs(path, windows);
      // Windows のいちばん上は、ドライブの一覧
      if (abs === null) {
        return (await places()).filter((p) => p.kind === 'volume').map((p) => ({ name: p.path, path: p.path, kind: 'dir', size: 0, modified: 0, mime: null, message_id: null, file_id: null }));
      }
      const all = await run<FsEntry[]>('fs_list', { path: abs });
      return (showHidden() ? all : all.filter((e) => !e.hidden)).map(entry);
    },
    async write(path, body) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body instanceof Blob ? await body.arrayBuffer() : body);
      return entry(await run<FsEntry>('fs_write', bytes, { 'x-path': encodeURIComponent(os(path)) }));
    },
    mkdir: async (path) => entry(await run<FsEntry>('fs_mkdir', { path: os(path) })),
    async trash(path) {
      await run<void>('fs_trash', { path: os(path) });
      // OS のゴミ箱へ入る。この部品からは戻せない（caps.restore: false）ので、id は使わない
      return { id: '', original_path: path, kind: 'file', size: 0, deleted_at: Date.now() };
    },
    restore: async () => Promise.reject(new FsError('unsupported', 'OS のゴミ箱から戻してください')),
    purge: async () => Promise.reject(new FsError('unsupported', 'OS のゴミ箱から消してください')),
    async size(path) {
      const s = await run<FsSize>('fs_size', { path: os(path) });
      return { size: s.size, files: s.files, dirs: s.dirs };
    },
    move: async (from, to, overwrite) => entry(await run<FsEntry>('fs_move', { from: os(from), to: os(to), overwrite: overwrite === true })),
    copy: async (from, to, overwrite) => entry(await run<FsEntry>('fs_copy', { from: os(from), to: os(to), overwrite: overwrite === true })),
    upload(path, file, onProgress) {
      // 端末の中の書き込みなので、途中の進み具合は出さない（終わったら 1）。途中では止められない
      const promise = api.write(path, file).then((e) => {
        onProgress?.(1);
        return e;
      });
      return { promise, abort: () => {} };
    },
  };

  const urls: EntryUrls = {
    href: (e) => openHref(e.path),
    readUrl: (e) => convertFileSrc(os(e.path)),
    // 縮小版は作らず、画像そのものを読む
    thumbUrl: (e) => (e.kind === 'file' && isImageName(e.name, e.mime) ? convertFileSrc(os(e.path)) : null),
    pdfSource: () => null,
  };

  const rules: Rules = {
    attachmentsDir: null,
    nameError(_dir, name) {
      const basic = basicNameError(name);
      if (basic) return basic;
      if (!windows) return null;
      if (/[\\:*?"<>|]/.test(name)) return '名前に \\ : * ? " < > | は使えません';
      if (name.endsWith('.') || name.endsWith(' ')) return '名前の末尾に . や空白は使えません';
      return null;
    },
  };

  return {
    api,
    urls,
    rules,
    windows,
    start: fromOs(startOs),
    places,
    open: (path) => run<void>('fs_open', { path: os(path) }),
    osPath: (path) => toOs(path, windows) ?? '',
    fromOsPath: (abs) => fromOs(abs),
    isMissing: (e) => e instanceof FsError && (e.code === 'not_found' || e.code === 'not_dir'),
  };
}
