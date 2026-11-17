import { isImageName, isPdfName, type Entry, type EntryUrls } from '@3pino/explorer-kit';
import type { HostFiles, SharedEntry } from './sdk';

/**
 * PDF のサムネイルを作る上限（viewer-kit-web の PDF_THUMB_MAX_BYTES と同じ値。あちらの入口は pdf.js を引き込むので、数字だけ写す。試験で一致を確かめる）
 */
export const PDF_THUMB_MAX_BYTES = 50 * 1024 * 1024;

/** 項目の URL。作るのは本体（`files.url`）。ここは、どの項目にどの形で頼むかだけを決める */
export function createUrls(files: HostFiles): EntryUrls {
  const url = (e: Entry, thumb?: boolean): string => files.url(e as SharedEntry, thumb ? { thumb: true } : undefined);
  return {
    // 開く・保存するときの URL（縮小版ではなく本物）
    href: (e) => url(e),
    readUrl: (e, thumb) => url(e, thumb),
    // 並べ目の小さい画像。画像でなければ無し
    thumbUrl: (e) => (e.kind === 'dir' || !isImageName(e.name, e.mime) ? null : url(e, true)),
    // PDF のサムネイルの元（1 ページ目を描く）。大きすぎる PDF・PDF でなければ無し
    pdfSource: (e) => (e.kind === 'dir' || !isPdfName(e.name, e.mime) || e.size > PDF_THUMB_MAX_BYTES ? null : { url: url(e), key: `${e.path}:${e.modified}:${e.size}` }),
  };
}
