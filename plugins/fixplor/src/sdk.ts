// プラグインが本体（グローバルの `disnans`）から使う口の型。使う分だけを、ここに写してある。
// 本体の正は packages/plugin-sdk/index.d.ts（Disnans のリポジトリ）。API 19 の追加分（`files` の url・upload など、`ui` の openLightbox など）の
// 形が確定したら、ここを正に合わせる（合わせ方の食い違いは、本体側へ知らせる）。
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

export type Cleanup = () => void;

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
  // ---- API 19 で足す（段 5） ----
  /** `<img>`・保存に使う URL（同期。項目を渡す: 添付は ID の URL・ゴミ箱の中身はパスの URL） */
  url(entry: SharedEntry, opts?: { thumb?: boolean }): string;
  upload(path: string, data: Blob, opts?: { onProgress?(sent: number, total: number): void; signal?: AbortSignal }): Promise<SharedEntry>;
  size(path?: string): Promise<{ size: number; files: number; dirs: number }>;
  caps(): { trash: boolean; restore: boolean; attachmentsDir: string | null };
  trash(path: string): Promise<SharedTrash>;
  restore(id: string): Promise<SharedEntry>;
  purge(id: string): Promise<void>;
}

export type LightboxItem = { src: string; alt: string; downloadUrl?: string; kind?: string };

/** `disnans.ui` のうち、このプラグインが使う分 */
export interface HostUi {
  toast(text: string, kind?: 'info' | 'error', action?: { label: string; run: () => void }): void;
  confirm(opts: { title: string; body?: string; okLabel?: string; ngLabel?: string; danger?: boolean }): Promise<boolean>;
  onBack(handler: () => void): Cleanup;
  // ---- API 19 で足す（段 5） ----
  openLightbox(item: LightboxItem, gallery?: { items(): LightboxItem[] }): void;
  /** PDF の 1 ページ目のサムネイルを el に描く（画面に入ってから作る）。戻り値で片付ける */
  renderPdfThumb(el: HTMLElement, opts: { url: string; key: string }): Cleanup;
  saveBlob(blob: Blob, name: string): Promise<void>;
  openSearch(query?: string): void;
  clipboard: { copyText(text: string): Promise<void>; readText(): Promise<string | null>; readImage(): Promise<Blob | null> };
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
  readonly app: { readonly isMobile: boolean };
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  registerView(type: string, factory: (session: unknown) => HostView): void;
  register(cleanup: Cleanup): void;
}

export type PluginConstructor = abstract new () => HostPluginBase & { onload(): void | Promise<void>; onunload?(): void };

/** グローバルの `disnans` のうち、このプラグインが使う分 */
export interface HostGlobal {
  Plugin: PluginConstructor;
  ui: HostUi;
  session?: HostSession;
}

export function hostGlobal(): HostGlobal {
  const g = (globalThis as { disnans?: HostGlobal }).disnans;
  if (!g) throw new Error('disnans（本体の口）がありません。Disnans のプラグインとして読み込んでください');
  return g;
}
