// 試験用の、本体の偽物（グローバルの `disnans`・`this.files`・`disnans.ui`）。メモリの中の共有フォルダで、サーバーと同じ決まりで動く:
// 同名の作成は exists、親が無ければ parent_missing、move・copy は overwrite が真のときだけファイルを置き換える、ゴミ箱は id で戻す。
import type { HostFiles, HostGlobal, HostUi, HostView, LightboxItem, NavItemOptions, SharedEntry, SharedTrash } from '../sdk';

export class HostError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

type Node = { kind: 'file' | 'dir'; body: string; modified: number; file_id?: string };

export type FakeFiles = HostFiles & {
  /** 呼ばれた口と引数 */
  calls: [string, ...unknown[]][];
  tree: Map<string, Node>;
  /** サーバーの側の変更（ほかの端末）を知らせる */
  external(path: string, change: () => void): void;
  listeners: number;
  /** upload を、解くまで止めておく */
  hold: { upload: ((ok: boolean) => void)[] };
  holdUploads: boolean;
};

const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

export function fakeFiles(initial: Record<string, 'dir' | string> = {}): FakeFiles {
  const tree = new Map<string, Node>();
  const trashed = new Map<string, { entry: SharedTrash; nodes: [string, Node][] }>();
  const changeCbs = new Set<(ev: { path: string }) => void>();
  let clock = 1_700_000_000_000;
  let seq = 0;
  const calls: [string, ...unknown[]][] = [];
  const hold: { upload: ((ok: boolean) => void)[] } = { upload: [] };

  const entryOf = (path: string): SharedEntry => {
    const n = tree.get(path)!;
    return { name: nameOf(path), path, kind: n.kind, size: n.kind === 'dir' ? 0 : n.body.length, modified: n.modified, mime: null, message_id: null, file_id: n.file_id ?? null };
  };
  const emit = (path: string): void => {
    for (const cb of [...changeCbs]) cb({ path });
  };
  const must = (path: string): Node => {
    const n = tree.get(path);
    if (!n) throw new HostError('not_found', `見つかりません: ${path}`);
    return n;
  };
  const mustParent = (path: string): void => {
    const p = parentOf(path);
    if (p !== '' && tree.get(p)?.kind !== 'dir') throw new HostError('parent_missing');
  };
  const put = (path: string, kind: 'file' | 'dir', body = ''): void => {
    tree.set(path, { kind, body, modified: ++clock });
  };
  const subtree = (path: string): string[] => [...tree.keys()].filter((p) => p === path || p.startsWith(path + '/'));

  for (const [p, v] of Object.entries(initial)) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) if (!tree.has(parts.slice(0, i).join('/'))) put(parts.slice(0, i).join('/'), 'dir');
    put(p, v === 'dir' ? 'dir' : 'file', v === 'dir' ? '' : v);
  }

  const relocate = (from: string, to: string, copy: boolean, overwrite: boolean): SharedEntry => {
    const src = must(from);
    mustParent(to);
    const dest = tree.get(to);
    if (dest) {
      if (!overwrite) throw new HostError('exists');
      if (dest.kind === 'dir' || src.kind === 'dir') throw new HostError('forbidden');
    }
    if (src.kind === 'dir' && (to === from || to.startsWith(from + '/'))) throw new HostError('forbidden', '自分の中へは動かせません');
    for (const p of subtree(from)) {
      const n = tree.get(p)!;
      tree.set(to + p.slice(from.length), { ...n, modified: ++clock });
      if (!copy) tree.delete(p);
    }
    emit(to);
    if (!copy) emit(from);
    return entryOf(to);
  };

  const f: FakeFiles = {
    calls,
    tree,
    hold,
    holdUploads: false,
    get listeners() {
      return changeCbs.size;
    },
    external(path, change) {
      change();
      emit(path);
    },
    async list(path = '') {
      calls.push(['list', path]);
      if (path !== '' && must(path).kind !== 'dir') throw new HostError('not_found');
      return [...tree.keys()].filter((p) => parentOf(p) === path && p !== '').map(entryOf);
    },
    async stat(path) {
      return entryOf((must(path), path));
    },
    async read(path) {
      return new Blob([must(path).body]);
    },
    async write(path, data) {
      calls.push(['write', path]);
      mustParent(path);
      put(path, 'file', typeof data === 'string' ? data : '(binary)');
      emit(path);
      return entryOf(path);
    },
    async mkdir(path) {
      calls.push(['mkdir', path]);
      mustParent(path);
      if (tree.has(path)) throw new HostError('exists');
      put(path, 'dir');
      emit(path);
      return entryOf(path);
    },
    async remove(path) {
      calls.push(['remove', path]);
      for (const p of subtree(path)) tree.delete(p);
      emit(path);
    },
    async move(from, to, opts) {
      calls.push(['move', from, to, opts]);
      return relocate(from, to, false, opts?.overwrite === true);
    },
    async copy(from, to, opts) {
      calls.push(['copy', from, to, opts]);
      return relocate(from, to, true, opts?.overwrite === true);
    },
    onChange(cb) {
      changeCbs.add(cb);
      return () => void changeCbs.delete(cb);
    },
    url(entry, opts) {
      return `https://srv.test/${entry.file_id && !entry.trash ? `files/${entry.file_id}` : `shared/${entry.path}`}${opts?.thumb ? '?thumb=1' : ''}`;
    },
    upload(path, data, opts) {
      calls.push(['upload', path, opts?.signal ? 'signal' : 'nosignal']);
      return new Promise<SharedEntry>((resolve, reject) => {
        const finish = (ok: boolean): void => {
          if (opts?.signal?.aborted) return reject(new HostError('aborted', '中止しました'));
          if (!ok) return reject(new HostError('invalid_upload'));
          try {
            mustParent(path);
          } catch (e) {
            return reject(e);
          }
          put(path, 'file', `(${data.size} bytes)`);
          emit(path);
          opts?.onProgress?.(data.size, data.size);
          resolve(entryOf(path));
        };
        opts?.onProgress?.(data.size / 2, data.size);
        opts?.signal?.addEventListener('abort', () => reject(new HostError('aborted', '中止しました')));
        if (f.holdUploads) hold.upload.push(finish);
        else finish(true);
      });
    },
    async size(path = '') {
      calls.push(['size', path]);
      const all = path === '' ? [...tree.keys()] : subtree(path).filter((p) => p !== path);
      let size = 0;
      let files = 0;
      let dirs = 0;
      for (const p of all) {
        const n = tree.get(p)!;
        if (n.kind === 'dir') dirs++;
        else (files++, (size += n.body.length));
      }
      return { size, files, dirs };
    },
    caps: () => ({ trash: true, restore: true, attachmentsDir: 'attachments' }),
    async trash(path) {
      calls.push(['trash', path]);
      const node = must(path);
      const id = `t${++seq}`;
      const entry: SharedTrash = { id, original_path: path, kind: node.kind, size: node.kind === 'dir' ? 0 : node.body.length, deleted_at: ++clock };
      trashed.set(id, { entry, nodes: subtree(path).map((p) => [p, tree.get(p)!]) });
      for (const p of subtree(path)) tree.delete(p);
      emit(path);
      return entry;
    },
    async restore(id) {
      calls.push(['restore', id]);
      const t = trashed.get(id);
      if (!t) throw new HostError('not_found');
      mustParent(t.entry.original_path);
      if (tree.has(t.entry.original_path)) throw new HostError('exists');
      for (const [p, n] of t.nodes) tree.set(p, n);
      trashed.delete(id);
      emit(t.entry.original_path);
      return entryOf(t.entry.original_path);
    },
    async purge(id) {
      calls.push(['purge', id]);
      trashed.delete(id);
    },
  };
  return f;
}

export type FakeUi = HostUi & {
  toasts: { text: string; kind?: string; action?: { label: string; run: () => void } }[];
  confirms: { title: string; body?: string; okLabel?: string; danger?: boolean }[];
  /** 次の confirm の答え */
  answer: boolean;
  backs: (() => void)[];
  /** 拡大表示の呼び出し。gallery は読んだときに並びを作る（本体も、必要になってから読む） */
  lightbox: { item: LightboxItem; items: () => LightboxItem[]; readonly gallery: LightboxItem[] }[];
  thumbs: { el: HTMLElement; url: string; key: string; stopped: boolean }[];
  saved: { name: string; size: number }[];
  searches: (string | undefined)[];
  clipboardText: string[];
  navItems: (NavItemOptions & { closed: boolean })[];
};

export function fakeUi(): FakeUi {
  const ui: FakeUi = {
    toasts: [],
    confirms: [],
    answer: true,
    backs: [],
    lightbox: [],
    thumbs: [],
    saved: [],
    searches: [],
    clipboardText: [],
    navItems: [],
    osDrop: {
      listenNative: async () => () => {},
      listen: async () => () => {},
      entries: async () => ({ entries: [], skipped: [] }),
      release: async () => {},
      rootsOf: () => [],
      entriesFromRoots: async () => [],
    },
    navItem(o) {
      const rec = { ...o, closed: false };
      ui.navItems.push(rec);
      return { setBadge: () => {}, close: () => void (rec.closed = true) };
    },
    toast: (text, kind, action) => void ui.toasts.push({ text, kind, action }),
    confirm: async (o) => (ui.confirms.push(o), ui.answer),
    onBack(handler) {
      ui.backs.push(handler);
      return () => void ui.backs.splice(ui.backs.indexOf(handler), 1);
    },
    openLightbox: (item, gallery) =>
      void ui.lightbox.push({
        item,
        items: () => gallery?.() ?? [],
        get gallery() {
          return this.items();
        },
      }),
    renderPdfThumb(el, source, o) {
      const rec = { el, url: source, key: o?.key ?? '', stopped: false };
      ui.thumbs.push(rec);
      return () => void (rec.stopped = true);
    },
    saveBlob: async (blob, name) => void ui.saved.push({ name, size: blob.size }),
    openSearch: (q) => void ui.searches.push(q),
    clipboard: {
      copyText: async (t) => (ui.clipboardText.push(t), true),
      readText: async () => null,
      readImage: async () => null,
    },
  };
  return ui;
}

export type FakeDisnans = {
  global: HostGlobal;
  ui: FakeUi;
  files: FakeFiles;
  views: Map<string, (session: unknown | null) => HostView>;
  saved: { data: unknown };
  /** サーバーの切り替えを知らせる */
  switchServer(): void;
  serverListeners: number;
  isMobile: boolean;
  /** this.register で渡された後始末（プラグインを外すときに、本体が呼ぶ） */
  registered: (() => void)[];
  /** 外す（登録した後始末を呼ぶ） */
  unload(): void;
};

/** グローバルの `disnans` の偽物。Plugin の基底は、`this.files`・`loadData`・`saveData`・`registerView` だけを持つ */
export function fakeDisnans(files: FakeFiles = fakeFiles(), opts: { data?: unknown; isMobile?: boolean } = {}): FakeDisnans {
  const ui = fakeUi();
  const views = new Map<string, (session: unknown | null) => HostView>();
  const saved: { data: unknown } = { data: opts.data ?? null };
  const serverCbs = new Set<() => void>();
  const registered: (() => void)[] = [];
  class Plugin {
    readonly files = files;
    readonly app = { isMobile: opts.isMobile ?? false };
    async loadData(): Promise<unknown> {
      return saved.data;
    }
    async saveData(data: unknown): Promise<void> {
      saved.data = data;
    }
    registerView(type: string, factory: (session: unknown | null) => HostView): void {
      views.set(type, factory);
    }
    register(cleanup: () => void): void {
      registered.push(cleanup);
      d.registered.push(cleanup);
    }
  }
  const d: FakeDisnans = {
    global: {
      Plugin: Plugin as unknown as HostGlobal['Plugin'],
      ui,
      session: {
        onServerChange(cb) {
          serverCbs.add(cb);
          return () => void serverCbs.delete(cb);
        },
      },
    },
    ui,
    files,
    views,
    saved,
    switchServer: () => serverCbs.forEach((cb) => cb()),
    get serverListeners() {
      return serverCbs.size;
    },
    isMobile: opts.isMobile ?? false,
    registered: [],
    unload: () => registered.splice(0).forEach((f) => f()),
  };
  return d;
}
