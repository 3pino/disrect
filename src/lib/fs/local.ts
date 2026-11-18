import { convertFileSrc } from '@tauri-apps/api/core';
import { PDF_THUMB_MAX_BYTES } from '@3pino/viewer-kit-web/viewers/pdfThumb';
import { basicNameError, isImageName, isPdfName, type Entry, type EntryUrls, type ExplorerApi, type Rules } from '@3pino/explorer-kit';
import { fromOs, isWindowsPath, toOs } from './mapping';
import { runner, tauriCall, toFsError, type Call } from './call';
import { createSources, type Sources } from './sources';
import { FsError, type FsEntry, type FsPlace, type FsSize } from './types';
import type { SearchOutcome } from '@3pino/explorer-kit';

// この端末のファイルシステムを、共有の部品（@3pino/explorer-kit）の置き場所（ExplorerApi）として見せる。
// 実体は Rust（src-tauri/src/fs）。画面のパス（相対・区切り `/`）と OS の絶対パスの対応は mapping.ts。

export { toFsError, type Call };

export type LocalOptions = {
  call?: Call;
  /** Rust から結果を少しずつ受ける入れ物（試験で差し替える）。既定は Tauri の Channel */
  newChannel?: () => Promise<{ onmessage: (batch: FsEntry[]) => void }>;
  /** 隠しファイル（. で始まるもの・Windows の隠し属性）を一覧に出すか */
  showHidden?: () => boolean;
};

export type LocalFs = {
  api: ExplorerApi;
  urls: EntryUrls;
  rules: Rules;
  /** 表示の URL → 項目のパス（拡大表示の「保存」で、既定のアプリで開くため） */
  sources: Sources;
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
const OPEN_SCHEME = 'fixplor-open:';
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
  const newChannel =
    options.newChannel ??
    (async () => {
      const { Channel } = await import('@tauri-apps/api/core');
      return new Channel<FsEntry[]>();
    });
  let searchSeq = 0;
  const run = runner(call);
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
    };
  };
  const places = async (): Promise<FsPlace[]> => (await run<FsPlace[]>('fs_places')).map((p) => ({ ...p, path: fromOs(p.path) }));

  /** 1 つの根の下を探す（Rust。見つけたものは batch ごとに届く）。中止されたら、Rust の検索も止める */
  const searchRoot = async (root: string, text: string, on: { hits(entries: Entry[]): void; signal: AbortSignal }): Promise<SearchOutcome> => {
    if (on.signal.aborted) throw new FsError('aborted', '中止しました');
    const job = `search-${++searchSeq}`;
    const channel = await newChannel();
    channel.onmessage = (batch) => {
      if (!on.signal.aborted) on.hits(batch.map(entry));
    };
    const stop = (): void => void run<boolean>('fs_search_cancel', { job }).catch(() => {});
    on.signal.addEventListener('abort', stop, { once: true });
    try {
      return await run<SearchOutcome>('fs_search', { dir: root, text, showHidden: showHidden(), job, onHits: channel });
    } finally {
      on.signal.removeEventListener('abort', stop);
    }
  };

  const api: ExplorerApi = {
    /** サブフォルダも探す（Rust が、浅いほうから。上限で止めたら partial に理由）。Windows のいちばん上は、ドライブを 1 つずつ */
    async search(query, on) {
      const abs = toOs(query.dir, windows);
      const roots = abs === null ? (await run<FsPlace[]>('fs_places')).filter((p) => p.kind === 'volume').map((p) => p.path) : [abs];
      let partial: SearchOutcome['partial'] = null;
      for (const root of roots) {
        const out = await searchRoot(root, query.text, on);
        partial ??= out.partial;
        // 件数の上限は、ドライブをまたいで数えない（画面が上限で止める）。時間・数の上限は、残りのドライブも同じ条件で探す
        if (out.partial === 'hits') break;
      }
      return { partial };
    },
    async list(path) {
      const abs = toOs(path, windows);
      // Windows のいちばん上は、ドライブの一覧
      if (abs === null) {
        return (await places()).filter((p) => p.kind === 'volume').map((p) => ({ name: p.path, path: p.path, kind: 'dir', size: 0, modified: 0, mime: null }));
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

  const sources = createSources();
  const asset = (e: Entry): string => sources.note(convertFileSrc(os(e.path)), e.path);
  const urls: EntryUrls = {
    href: (e) => openHref(e.path),
    readUrl: (e) => asset(e),
    // 縮小版は作らず、画像そのものを読む
    thumbUrl: (e) => (e.kind === 'file' && isImageName(e.name, e.mime) ? asset(e) : null),
    // PDF の 1 ページ目（大きすぎるものは作らない）
    pdfSource: (e) => (e.kind === 'file' && isPdfName(e.name, e.mime) && e.size <= PDF_THUMB_MAX_BYTES ? { url: asset(e), key: `${e.path}:${e.modified}:${e.size}` } : null),
  };

  const rules: Rules = {
    specialDir: null,
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
    sources,
    windows,
    start: fromOs(startOs),
    places,
    open: (path) => run<void>('fs_open', { path: os(path) }),
    osPath: (path) => toOs(path, windows) ?? '',
    fromOsPath: (abs) => fromOs(abs),
    isMissing: (e) => e instanceof FsError && (e.code === 'not_found' || e.code === 'not_dir'),
  };
}
