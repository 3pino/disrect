import { listen } from '@tauri-apps/api/event';
import { basicNameError, isImageName, type Entry, type EntryUrls, type ExplorerApi, type Rules } from '@3pino/explorer-kit';
import { runner, tauriCall, type Call } from './call';
import { openHref } from './local';
import { FsError, type DavEntry } from './types';

// ネットワークの置き場所（WebDAV）を、共有の部品（@3pino/explorer-kit）の置き場所（ExplorerApi）として見せる。
// 実体は Rust（src-tauri/src/webdav）。画面のパスは、接続先からの相対（区切り `/`）で、そのまま Rust へ渡す。
// 資格情報は、まだ持たない（認証の要らない置き場所だけ）。

export type DavProgress = { job: string; done: number; total: number };

export type DavOptions = {
  /** 接続先の URL（`https://host/dav/`） */
  base: string;
  call?: Call;
  /** 隠しファイル（. で始まるもの）を一覧に出すか */
  showHidden?: () => boolean;
  /** 進み具合の知らせを受ける（試験で差し替える） */
  onProgress?: (handler: (p: DavProgress) => void) => Promise<() => void>;
};

export type DavFs = {
  api: ExplorerApi;
  urls: EntryUrls;
  rules: Rules;
  base: string;
  /** ファイルを、この端末の一時のフォルダへ受け取ってから、既定のアプリで開く */
  open(path: string): Promise<void>;
  isMissing(e: unknown): boolean;
};

const tauriProgress: NonNullable<DavOptions['onProgress']> = (handler) => listen<DavProgress>('dav-progress', (ev) => handler(ev.payload));

/** 接続先 + パス（段ごとに符号化）。画像の表示に使う */
export function davUrl(base: string, path: string): string {
  const root = base.endsWith('/') ? base : base + '/';
  return root + path.split('/').filter((s) => s !== '').map(encodeURIComponent).join('/');
}

export function createDavFs(options: DavOptions): DavFs {
  const base = options.base;
  const run = runner(options.call ?? tauriCall);
  const showHidden = options.showHidden ?? (() => false);
  const onProgress = options.onProgress ?? tauriProgress;
  /** 一覧で読んだ ETag（パス → ETag）。上書きは、これと同じときだけ通す（黙って上書きしない） */
  const etags = new Map<string, string>();
  let jobs = 0;
  const newJob = (kind: string): string => `${kind}-${Date.now().toString(36)}-${++jobs}`;

  const entry = (raw: DavEntry): Entry => {
    if (raw.etag) etags.set(raw.path, raw.etag);
    else etags.delete(raw.path);
    return { name: raw.name, path: raw.path, kind: raw.kind, size: raw.size ?? 0, modified: raw.modified ?? 0, mime: raw.mime };
  };
  const forget = (path: string): void => {
    for (const k of [...etags.keys()]) if (k === path || k.startsWith(path + '/')) etags.delete(k);
  };

  const put = (path: string, body: Blob | ArrayBuffer | string, job?: string): Promise<DavEntry> => {
    const make = async (): Promise<Uint8Array> =>
      typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body instanceof Blob ? await body.arrayBuffer() : body);
    return make().then((bytes) => {
      const headers: Record<string, string> = { 'x-base': encodeURIComponent(base), 'x-path': encodeURIComponent(path) };
      // 一覧で読んだ ETag があれば、そのものだけを上書き。無ければ作成（同名があれば exists）
      const tag = etags.get(path);
      if (tag) headers['x-if-match'] = encodeURIComponent(tag);
      if (job) headers['x-job'] = encodeURIComponent(job);
      return run<DavEntry>('dav_put', bytes, headers);
    });
  };

  const api: ExplorerApi = {
    async list(path) {
      const all = await run<DavEntry[]>('dav_list', { base, path });
      return (showHidden() ? all : all.filter((e) => !e.hidden)).map(entry);
    },
    async write(path, body) {
      return entry(await put(path, body));
    },
    mkdir: async (path) => entry(await run<DavEntry>('dav_mkdir', { base, path })),
    // ゴミ箱は無い（caps.trash: false）。部品は remove を呼ぶ
    trash: () => Promise.reject(new FsError('unsupported', 'この置き場所にはゴミ箱がありません')),
    restore: () => Promise.reject(new FsError('unsupported', 'この置き場所にはゴミ箱がありません')),
    purge: () => Promise.reject(new FsError('unsupported', 'この置き場所にはゴミ箱がありません')),
    async remove(path) {
      await run<void>('dav_remove', { base, path });
      forget(path);
    },
    async size(path) {
      const s = await run<{ size: number; files: number; dirs: number; partial: boolean }>('dav_size', { base, path });
      // 途中までの値を、全体の値として見せない
      if (s.partial) throw new FsError('too_large', 'フォルダが大きく、数えきれませんでした');
      return { size: s.size, files: s.files, dirs: s.dirs };
    },
    async move(from, to, overwrite) {
      const e = entry(await run<DavEntry>('dav_move', { base, from, to, overwrite: overwrite === true }));
      forget(from);
      return e;
    },
    copy: async (from, to, overwrite) => entry(await run<DavEntry>('dav_copy', { base, from, to, overwrite: overwrite === true })),
    upload(path, file, onProg) {
      const job = newJob('up');
      let aborted = false;
      const promise = (async () => {
        // 進み具合を受けてから送る（先に届いた知らせを逃さない）
        const stop = await onProgress((p) => {
          if (p.job === job && p.total > 0) onProg?.(Math.min(1, p.done / p.total));
        });
        try {
          // 送り始める前に中止されていたら、送らない
          if (aborted) throw new FsError('aborted', '中止しました');
          return entry(await put(path, file, job));
        } finally {
          stop();
        }
      })();
      return {
        promise,
        abort: () => {
          aborted = true;
          void run<boolean>('dav_cancel', { job }).catch(() => false);
        },
      };
    },
  };

  const urls: EntryUrls = {
    href: (e) => openHref(e.path),
    // <img> に直接渡す。認証の要らない置き場所だけ見られる（資格情報を使う置き場所は、あとで Rust が中継する）
    readUrl: (e) => davUrl(base, e.path),
    thumbUrl: (e) => (e.kind === 'file' && isImageName(e.name, e.mime) ? davUrl(base, e.path) : null),
    pdfSource: () => null,
  };

  const rules: Rules = {
    specialDir: null,
    nameError: (_dir, name) => basicNameError(name),
  };

  return {
    api,
    urls,
    rules,
    base,
    async open(path) {
      const local = await run<string>('dav_download', { base, path, job: newJob('dl') });
      await run<void>('fs_open', { path: local });
    },
    isMissing: (e) => e instanceof FsError && (e.code === 'not_found' || e.code === 'not_dir'),
  };
}
