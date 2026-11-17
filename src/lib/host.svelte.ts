import { isImageName, type ConfirmOptions, type ExplorerHost, type ToastAction, type ToastKind } from '@3pino/explorer-kit';
import { copyText } from '@3pino/app-kit-web/core/clipboard';
import { osName } from '@3pino/app-kit-web/core/platform';
import { Shell } from '@3pino/app-kit-web/shell';
import { errorText } from './labels';
import { pathOfOpenHref, type LocalFs } from './fs/local';
import { FsError } from './fs/types';

// 共有の部品（エクスプローラー）へ貸す、本体の機能: 通知・確認・「戻る」・ファイルを開く・クリップボード・この端末の種類。
// 通知・確認・戻るの状態は、土台の Shell（@3pino/app-kit-web/shell）が持つ。

/**
 * 本体の画面の状態。通知・確認・「戻る」の層は土台の Shell（@3pino/app-kit-web/shell）が持ち、ここはその上の薄い包み。
 * 通知と確認の表示は、土台の Toasts.svelte・ConfirmDialog.svelte が `shell` を読んで出す。
 */
export class HostState {
  readonly shell = new Shell();

  toast(text: string, kind: ToastKind = 'info', action?: ToastAction): number {
    return this.shell.toast(text, kind, action);
  }

  dismiss(id: number): void {
    this.shell.dismiss(id);
  }

  /** 確認を出す。前の確認が出たままなら、それは取り消しとして閉じる（土台は黙って置き換えるので、ここで閉じる） */
  confirm(opts: ConfirmOptions): Promise<boolean> {
    this.shell.confirmReq?.resolve(false);
    return this.shell.confirm(opts);
  }

  addBack(run: () => void): () => void {
    return this.shell.addPluginBack(run);
  }

  get canBack(): boolean {
    return this.shell.backDepth(0) > 0;
  }

  /** 「戻る」。積まれた処理のうち、いちばん新しいものを外してから呼ぶ。無ければ false */
  back(): boolean {
    return this.shell.back(() => false);
  }
}

/** 失敗を、利用者向けの文にする（Rust の code から。ほかはそのままの文） */
export function failureText(e: unknown): string {
  if (e instanceof FsError) return errorText(e.code);
  return e instanceof Error ? e.message : String(e);
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
      // このアプリは常に Tauri の中（試験では WebView の内部オブジェクトが無いので、判定に任せない）
      isTauri: () => true,
      osName,
      // OS からのドロップ（Tauri のネイティブのイベント）は、まだ受けない
      isLinuxDesktop: () => false,
    },
    clipboard: {
      copyText,
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

