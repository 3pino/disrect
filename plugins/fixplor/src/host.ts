import Search from '@lucide/svelte/icons/search';
import { basicViewerKind, isImageName, type ExplorerHost } from '@3pino/explorer-kit';
import { errorText } from './errors';
import PdfThumb from './PdfThumb.svelte';
import { bridge } from './pdfThumbBridge';
import type { HostGlobal } from './sdk';

/** 貼り付けた文字で作るファイルの名前（`clipboard-20250101-123456.txt`） */
export function clipboardTextName(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `clipboard-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.txt`;
}

/** この端末の種類（本体が教えるまでは、見た目から推す） */
function osName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return '';
}

/**
 * エクスプローラーの部品が本体から借りる機能（ExplorerHost）を、プラグインの口（`disnans.ui`）で作る。
 * 本体の状態は触らない（プレーンな値と関数だけを受け渡す）。
 */
export function createHost(disnans: Pick<HostGlobal, 'ui'>, opts: { isMobile: boolean }): ExplorerHost {
  const ui = disnans.ui;
  bridge.render = (el, o) => ui.renderPdfThumb(el, o);
  const saveFrom = async (req: { url: string; name: string }): Promise<void> => {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await ui.saveBlob(await res.blob(), req.name);
  };
  return {
    toast: (text, kind, action) => ui.toast(text, kind, action),
    confirm: (o) => ui.confirm(o),
    addBack: (run) => ui.onBack(run),
    openViewer: (item, gallery) => ui.openLightbox(item, { items: gallery }),
    viewerKind: (name, mime) => basicViewerKind(name, mime),
    isImage: (name, mime) => isImageName(name, mime),
    errorText,
    log: (level, text) => console[level](`[fixplor] ${text}`),
    platform: {
      // 本体のアプリは Tauri（デスクトップ・Android）か、ブラウザー。見分ける口が来るまでは、モバイルでなければ PC とみなす
      isTauri: () => !opts.isMobile,
      osName,
      isLinuxDesktop: () => !opts.isMobile && osName() === 'linux',
    },
    clipboard: {
      copyText: async (text) => {
        try {
          await ui.clipboard.copyText(text);
          return true;
        } catch {
          return false;
        }
      },
      // 中身は確かめない（読むと、OS が許可を尋ねることがある）。貼り付けは押せるままにする
      peek: async () => 'unknown',
      readText: () => ui.clipboard.readText(),
      readImage: async () => {
        const blob = await ui.clipboard.readImage();
        return blob ? new File([blob], 'image.png', { type: blob.type || 'image/png' }) : null;
      },
      readNativeImage: async () => null,
      textName: () => clipboardTextName(),
    },
    download: {
      file: saveFrom,
      intercept(ev, req) {
        ev.preventDefault();
        void saveFrom(req).catch((e) => ui.toast(`保存できませんでした: ${errorText(e)}`, 'error'));
        return true;
      },
    },
    // OS からのドロップ（段 5 の H。本体の口が出来るまでは受けない）
    osDrop: {
      listenNative: async () => () => {},
      listen: async () => () => {},
      entries: async () => ({ entries: [], skipped: [] }),
      release: async () => {},
      rootsOf: () => [],
      entriesFromRoots: async () => [],
    },
    PdfThumb,
    // ファイルのプロパティの「メッセージを検索」: このファイルの名前でメッセージを探す
    fileAction: {
      label: 'メッセージを検索',
      icon: Search,
      run: (_entry, label) => ui.openSearch(label),
    },
  };
}
