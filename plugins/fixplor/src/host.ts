import Search from '@lucide/svelte/icons/search';
import { basicViewerKind, isImageName, type ExplorerHost } from '@3pino/explorer-kit';
import { errorText } from './errors';
import PdfThumb from './PdfThumb.svelte';
import { bridge } from './pdfThumbBridge';
import type { HostGlobal, HostPlatform } from './sdk';

/**
 * エクスプローラーの部品が本体から借りる機能（ExplorerHost）を、プラグインの口（`disnans.ui`・`disnans.app.platform`）で作る。
 * 本体の状態は触らない（プレーンな値と関数だけを受け渡す）。
 */
export function createHost(disnans: Pick<HostGlobal, 'ui'>, opts: { platform: HostPlatform }): ExplorerHost {
  const ui = disnans.ui;
  bridge.render = (el, o) => ui.renderPdfThumb(el, o.url, { key: o.key });
  /** 画像（Linux の WebView の代わりの経路も含めて、本体が読む）。部品は File を受ける */
  const readImage = async (): Promise<File | null> => {
    const blob = await ui.clipboard.readImage();
    return blob ? new File([blob], 'image.png', { type: blob.type || 'image/png' }) : null;
  };
  return {
    toast: (text, kind, action) => ui.toast(text, kind, action),
    confirm: (o) => ui.confirm(o),
    addBack: (run) => ui.onBack(run),
    openViewer: (item, gallery) => ui.openLightbox(item, gallery),
    viewerKind: (name, mime) => basicViewerKind(name, mime),
    isImage: (name, mime) => isImageName(name, mime),
    errorText,
    log: (level, text) => console[level](`[fixplor] ${text}`),
    platform: {
      isTauri: () => opts.platform.tauri,
      osName: () => opts.platform.os,
      isLinuxDesktop: () => opts.platform.linuxDesktop,
    },
    clipboard: {
      copyText: async (text) => {
        try {
          return await ui.clipboard.copyText(text);
        } catch {
          return false;
        }
      },
      peek: () => ui.clipboard.peek(),
      readText: () => ui.clipboard.readText(),
      readImage,
      // Linux の代わりの経路は、本体の readImage が先に試す（別の口は要らない）
      readNativeImage: readImage,
      textName: () => ui.clipboard.textName(),
    },
    // 保存（サーバーの URL）は、本体の保存（Tauri は直接保存）
    download: {
      file: (req) => ui.download(req),
      intercept: (ev, req) => ui.interceptDownload(ev, req),
    },
    // OS からのドロップは、本体の口（explorer-kit の osDrop と同じ形）をそのまま使う
    osDrop: ui.osDrop,
    PdfThumb,
    // ファイルのプロパティの「メッセージを検索」: このファイルの名前でメッセージを探す
    fileAction: {
      label: 'メッセージを検索',
      icon: Search,
      run: (_entry, label) => ui.openSearch(label),
    },
  };
}
