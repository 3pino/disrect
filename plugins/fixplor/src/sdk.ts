// プラグインが本体（グローバルの `disnans`）から使う口の型。使う分だけを、ここに写してある。
// 本体の正は packages/plugin-sdk/index.d.ts（Disnans のリポジトリ。API 19 の形に合わせてある）。食い違いが分かったら、本体側へ知らせる。
// この型は import しても実行時には何も残らない（型だけ）。

export type EntryKind = 'file' | 'dir';

/** 共有フォルダの項目（サーバーの SharedEntry と同じ形） */
export type SharedEntry = {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  modified: number;
  mime: string | null;
  message_id: string | null;
  file_id: string | null;
  trash?: unknown;
};

/** ゴミ箱の 1 件（サーバーの SharedTrashEntry と同じ形） */
export type SharedTrash = {
  id: string;
  original_path: string;
  kind: EntryKind;
  size: number;
  deleted_at: number;
  trash_path?: string;
};

import type { ClipboardPeek, ExplorerHost } from '@3pino/explorer-kit';

export type Cleanup = () => void;

/** この端末の環境（`disnans.app.platform`。読み取りのみ） */
export type HostPlatform = { readonly tauri: boolean; readonly os: string; readonly linuxDesktop: boolean };

/** `this.files`（共有フォルダ。permissions に "files" が要る） */
export interface HostFiles {
  list(path?: string): Promise<SharedEntry[]>;
  stat(path: string): Promise<SharedEntry>;
  read(path: string): Promise<Blob>;
  write(path: string, data: Blob | ArrayBuffer | string): Promise<SharedEntry>;
  mkdir(path: string): Promise<SharedEntry>;
  remove(path: string): Promise<void>;
  move(from: string, to: string, opts?: { overwrite?: boolean }): Promise<SharedEntry>;
  copy(from: string, to: string, opts?: { overwrite?: boolean }): Promise<SharedEntry>;
  onChange(cb: (ev: { path: string }) => void): Cleanup;
  // ---- API 19 ----
  /** `<img>`・保存に使う URL（同期。項目を渡す: 添付は ID の URL・ゴミ箱の中身はパスの URL） */
  url(entry: SharedEntry, opts?: { thumb?: boolean }): string;
  upload(path: string, data: Blob, opts?: { onProgress?(sent: number, total: number): void; signal?: AbortSignal }): Promise<SharedEntry>;
  size(path?: string): Promise<{ size: number; files: number; dirs: number }>;
  caps(): { trash: boolean; restore: boolean; attachmentsDir: string | null };
  trash(path: string): Promise<SharedTrash>;
  restore(id: string): Promise<SharedEntry>;
  purge(id: string): Promise<void>;
}

export type LightboxItem = { src: string; alt: string; downloadUrl?: string; kind?: 'image' | 'pdf' | (string & {}) };

export type NavItemOptions = { id: string; label: string; icon: string; view?: string; onOpen?(): void; badge?: number | string | null };

/** `disnans.ui` のうち、このプラグインが使う分 */
export interface HostUi {
  toast(text: string, kind?: 'info' | 'error', action?: { label: string; run: () => void }): void;
  confirm(opts: { title: string; body?: string; okLabel?: string; ngLabel?: string; danger?: boolean }): Promise<boolean>;
  onBack(handler: () => void): Cleanup;
  // ---- API 19 ----
  navItem(opts: NavItemOptions): { setBadge(badge: number | string | null): void; close(): void };
  /** gallery は、呼ぶたびに今の並びを返す */
  openLightbox(item: LightboxItem, gallery?: () => LightboxItem[]): void;
  /** PDF の 1 ページ目のサムネイルを el に描く（本体の部品）。source は URL。戻り値で片付ける */
  renderPdfThumb(el: HTMLElement, source: string, opts?: { key?: string }): Cleanup;
  /** 本体の保存（サーバーの URL）。Tauri は直接保存、ブラウザーは <a download> */
  download(req: { url: string; name: string }): Promise<void>;
  interceptDownload(ev: MouseEvent, req: { url: string; name: string }): boolean;
  openSearch(query?: string): void;
  clipboard: {
    copyText(text: string): Promise<boolean>;
    readText(): Promise<string | null>;
    readImage(): Promise<Blob | null>;
    peek(): Promise<ClipboardPeek>;
    textName(): string;
  };
  /** OS からのドロップ（explorer-kit の osDrop と同じ形） */
  osDrop: ExplorerHost['osDrop'];
}

/** `disnans.chat`（本文のファイルリンクの「開く」を任せる口） */
export interface HostChat {
  registerLinkOpener(handle: (path: string, alias: string | null) => void): Cleanup;
}

export interface HostSession {
  onServerChange(cb: () => void): Cleanup;
}

export type HostView = {
  onOpen(containerEl: HTMLElement, panel: { setTitle(t: string | null): void; setIcon(i: string | null): void }): void | Promise<void>;
  onClose?(): void;
  title?: string;
  icon?: string;
};

/** `Plugin` の基底（本体が渡す）。このプラグインが使う分 */
export interface HostPluginBase {
  readonly files: HostFiles;
  readonly app: { readonly isMobile: boolean; readonly platform: HostPlatform };
  /** 古い保存先の値（最初の saveData まで。対象でなければ null） */
  readonly legacyData: unknown;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  /** セッションのない view（factory には session が null で渡る） */
  registerView(type: string, factory: (session: unknown | null) => HostView, options?: { layout?: 'full' }): void;
  /** セッションのない view をパネルに開く */
  openView(type: string): void;
  register(cleanup: Cleanup): void;
}

export type PluginConstructor = abstract new () => HostPluginBase & { onload(): void | Promise<void>; onunload?(): void };

/** グローバルの `disnans` のうち、このプラグインが使う分 */
export interface HostGlobal {
  Plugin: PluginConstructor;
  ui: HostUi;
  session?: HostSession;
  chat?: HostChat;
}

export function hostGlobal(): HostGlobal {
  const g = (globalThis as { disnans?: HostGlobal }).disnans;
  if (!g) throw new Error('disnans（本体の口）がありません。Disnans のプラグインとして読み込んでください');
  return g;
}
