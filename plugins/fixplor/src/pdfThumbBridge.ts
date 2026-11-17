import type { Cleanup } from './sdk';

/** PdfThumb.svelte が呼ぶ描き手（本体の ui.renderPdfThumb）。プラグインを読み込むとき、host.ts が入れる */
export const bridge: { render: ((el: HTMLElement, opts: { url: string; key: string }) => Cleanup) | null } = { render: null };
