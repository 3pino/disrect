import { isImageName, type ConfirmOptions, type ExplorerHost, type ToastAction, type ToastKind } from '@3pino/explorer-kit';
import { errorText } from './labels';
import { pathOfOpenHref, type LocalFs } from './fs/local';
import { FsError } from './fs/types';

// 共有の部品（エクスプローラー）へ貸す、本体の機能: 通知・確認・「戻る」・ファイルを開く・クリップボード・この端末の種類。
// 通知と確認の表示は Toasts.svelte・ConfirmDialog.svelte が、ここの状態を読んで出す。

export type Toast = { id: number; text: string; kind: ToastKind; action?: ToastAction };
type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

/** 通知を自分で消すまでの時間（ms） */
const TOAST_MS = 5000;

export class HostState {
  toasts = $state<Toast[]>([]);
  confirming = $state.raw<ConfirmRequest | null>(null);
  /** 「戻る」で先に呼ぶ処理（あとから積んだものが先） */
  private backs = $state.raw<{ run: () => void }[]>([]);
  private seq = 0;

  toast(text: string, kind: ToastKind = 'info', action?: ToastAction): number {
    const id = ++this.seq;
    this.toasts.push({ id, text, kind, action });
    setTimeout(() => this.dismiss(id), TOAST_MS);
    return id;
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /** 確認を出す。前の確認が出たままなら、それは取り消しとして閉じる */
  confirm(opts: ConfirmOptions): Promise<boolean> {
    this.confirming?.resolve(false);
    return new Promise((resolve) => {
      this.confirming = { ...opts, resolve };
    });
  }

  answer(ok: boolean): void {
    const req = this.confirming;
    this.confirming = null;
    req?.resolve(ok);
  }

  addBack(run: () => void): () => void {
    const entry = { run };
    this.backs = [...this.backs, entry];
    return () => {
      this.backs = this.backs.filter((e) => e !== entry);
    };
  }

  get canBack(): boolean {
    return this.backs.length > 0;
  }

  /** 「戻る」。積まれた処理のうち、いちばん新しいものを外してから呼ぶ。無ければ false */
  back(): boolean {
    const top = this.backs.at(-1);
    if (!top) return false;
    this.backs = this.backs.slice(0, -1);
    top.run();
    return true;
  }
}

/** 失敗を、利用者向けの文にする（Rust の code から。ほかはそのままの文） */
export function failureText(e: unknown): string {
  if (e instanceof FsError) return errorText(e.code);
  return e instanceof Error ? e.message : String(e);
}

function osName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return '';
}

export function createHost(state: HostState, local: Pick<LocalFs, 'open'>): ExplorerHost {
  /** 項目を、OS の既定のアプリで開く */
  const openExternally = async (req: { url: string; name: string }): Promise<void> => {
    const path = pathOfOpenHref(req.url);
    if (path === null) return;
    try {
      await local.open(path);
    } catch (e) {
      state.toast(`「${req.name}」を開けませんでした: ${failureText(e)}`, 'error');
    }
  };
  return {
    toast: (text, kind, action) => state.toast(text, kind, action),
    confirm: (opts) => state.confirm(opts),
    addBack: (run) => state.addBack(run),
    // 拡大表示は、まだ持たない（viewerKind が null を返すので呼ばれない）。ファイルは OS の既定のアプリで開く
    openViewer: () => {},
    viewerKind: () => null,
    isImage: isImageName,
    errorText: failureText,
    log: (level, text) => console[level](text),
    platform: {
      isTauri: () => true,
      osName,
      // OS からのドロップ（Tauri のネイティブのイベント）は、まだ受けない
      isLinuxDesktop: () => false,
    },
    clipboard: {
      async copyText(text) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
      // 中身は確かめない（読むと、OS が許可を尋ねることがある）。貼り付けは押せるままにする
      peek: async () => 'unknown',
      async readText() {
        try {
          return (await navigator.clipboard.readText()) || null;
        } catch {
          return null;
        }
      },
      readImage: async () => null,
      readNativeImage: async () => null,
      textName: () => `貼り付け ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.txt`,
    },
    download: {
      file: openExternally,
      intercept(ev, req) {
        ev.preventDefault();
        void openExternally(req);
        return true;
      },
    },
    osDrop: {
      listenNative: async () => () => {},
      listen: async () => () => {},
      entries: async () => ({ entries: [], skipped: [] }),
      release: async () => {},
      rootsOf: () => [],
      entriesFromRoots: async () => [],
    },
  };
}

