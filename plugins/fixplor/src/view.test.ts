// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createExplorerView } from './view';
import { SAVE_DELAY_MS } from './store.svelte';
import { HostError, fakeDisnans, fakeFiles, type FakeDisnans } from './test-support/fakeHost';
import type { HostPluginBase } from './sdk';

// プラグインが、本体の偽物（メモリの共有フォルダ・ui）の上で、パネルの中に画面を出して動くこと。
// 画面と細かい流れは共有の部品（explorer-kit）の試験にある。ここは、本体の口との継ぎ目（api・urls・host・scope・保存・片付け）を確かめる。

const tick = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

type Booted = Awaited<ReturnType<typeof boot>>;
let booted: Booted | undefined;

async function boot(d: FakeDisnans, legacyData?: unknown) {
  const counter = { saves: 0 };
  const plugin = {
    files: d.files,
    app: { isMobile: d.isMobile },
    loadData: async () => d.saved.data,
    saveData: async (data: unknown) => {
      counter.saves++;
      d.saved.data = data;
    },
    registerView: () => {},
    register: () => {},
  } satisfies HostPluginBase;
  const view = createExplorerView({ plugin, disnans: d.global, legacyData });
  const target = document.createElement('div');
  document.body.append(target);
  const panel = { setTitle: vi.fn(), setIcon: vi.fn() };
  await view.onOpen(target, panel);
  await tick();
  const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
  const b = { d, view, target, names, counter, close: () => view.onClose?.() };
  booted = b;
  return b;
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  booted?.close();
  booted = undefined;
  document.body.innerHTML = '';
});

const tree = { 'docs/inner.txt': 'in', 'a.txt': 'aaaa', 'photo.png': 'png', 'doc.pdf': 'pdf', 'attachments/x.txt': 'att' };

describe('開く', () => {
  it('共有フォルダのいちばん上を this.files で読んで並べる（フォルダが先）。題名とアイコンは view の既定', async () => {
    const d = fakeDisnans(fakeFiles(tree));
    const { names, view, target } = await boot(d);
    expect(names()).toEqual(['attachments', 'docs', 'a.txt', 'doc.pdf', 'photo.png']);
    expect(view.title).toBe('ファイル');
    expect(target.querySelector('.file-explorer-crumbs button')!.textContent).toBe('共有フォルダ');
    expect(d.files.calls).toContainEqual(['list', '']);
  });

  it('フォルダを開くと、その中身を読む', async () => {
    const { d, names, view } = await boot(fakeDisnans(fakeFiles(tree)));
    view.explorer!.nav.open('docs');
    await tick();
    expect(d.files.calls).toContainEqual(['list', 'docs']);
    expect(names()).toEqual(['inner.txt']);
  });

  it('作れなかった・読めなかったときは、本体の失敗の文（code があれば、その文言）を出す', async () => {
    const files = fakeFiles(tree);
    files.list = async () => {
      throw new HostError('internal', 'x');
    };
    const { target, view } = await boot(fakeDisnans(files));
    // 一覧の失敗は、部品が元の文を出す（再読み込みできる）
    expect(target.textContent).toContain('読み込めませんでした: x');
    // 操作の失敗は、本体の code の文言にする
    const text = view.explorer!.host.errorText;
    expect(text(new HostError('invalid_attachment', 'x'))).toContain('添付ファイルが見つかりません');
    expect(text(new HostError('exists', '同名があります'))).toBe('同名があります');
    expect(text('文字だけ')).toBe('文字だけ');
  });
});

describe('操作（共有フォルダの口へ、そのまま届く）', () => {
  it('ゴミ箱へ: 確認のあと files.trash を呼ぶ。トーストの「取り消す」で files.restore（本体のゴミ箱の caps に従う）', async () => {
    const { d, view, target, names } = await boot(fakeDisnans(fakeFiles(tree)));
    view.explorer!.selection.start('a.txt');
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await tick();
    expect(d.files.calls).toContainEqual(['trash', 'a.txt']);
    expect(names()).not.toContain('a.txt');
    const undo = d.ui.toasts.find((t) => t.action)!;
    expect(undo.action!.label).toBe('取り消す');
    undo.action!.run();
    await tick();
    expect(d.files.calls).toContainEqual(['restore', 't1']);
    expect(names()).toContain('a.txt');
  });

  it('アップロード中の中止は、本体の signal（AbortController）で伝わる。進みは 0〜1 の割合', async () => {
    const files = fakeFiles(tree);
    files.holdUploads = true;
    const d = fakeDisnans(files);
    const { view } = await boot(d);
    const seen: number[] = [];
    const h = view.explorer!.api.upload('new.bin', new Blob(['12345678']), (r) => seen.push(r));
    expect(seen).toEqual([0.5]);
    expect(files.calls).toContainEqual(['upload', 'new.bin', 'signal']);
    h.abort();
    await expect(h.promise).rejects.toMatchObject({ code: 'aborted' });
  });

  it('本体が中止を AbortError（code なし）で知らせても、部品が見分ける code「aborted」にそろえる。ほかの失敗はそのまま', async () => {
    const files = fakeFiles(tree);
    const { view } = await boot(fakeDisnans(files));
    files.upload = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    await expect(view.explorer!.api.upload('x', new Blob(['1'])).promise).rejects.toMatchObject({ code: 'aborted' });
    files.upload = () => Promise.reject(new HostError('exists', '同名'));
    await expect(view.explorer!.api.upload('x', new Blob(['1'])).promise).rejects.toMatchObject({ code: 'exists' });
  });

  it('移動・コピーの overwrite は、真のときだけ渡す（省いた引数を足さない）', async () => {
    const { d, view } = await boot(fakeDisnans(fakeFiles(tree)));
    const api = view.explorer!.api;
    await api.copy('a.txt', 'b.txt');
    await api.copy('a.txt', 'b.txt', true);
    await api.move('b.txt', 'c.txt', false);
    expect(d.files.calls.filter((c) => c[0] === 'copy' || c[0] === 'move')).toEqual([
      ['copy', 'a.txt', 'b.txt', undefined],
      ['copy', 'a.txt', 'b.txt', { overwrite: true }],
      ['move', 'b.txt', 'c.txt', undefined],
    ]);
    await expect(api.copy('a.txt', 'c.txt')).rejects.toMatchObject({ code: 'exists' });
  });

  it('大きさは files.size', async () => {
    const { view } = await boot(fakeDisnans(fakeFiles(tree)));
    expect(await view.explorer!.api.size('docs')).toEqual({ size: 2, files: 1, dirs: 0 });
  });
});

describe('添付のフォルダの決まり（本体の caps が教える）', () => {
  it('特別なフォルダは attachments。中の名前は、本文のリンクの書き方と衝突する文字を断る', async () => {
    const { view } = await boot(fakeDisnans(fakeFiles(tree)));
    const r = view.explorer!.rules;
    expect(r.specialDir).toBe('attachments');
    expect(r.nameError('attachments', 'a[1].png')).toContain('使えません');
    expect(r.nameError('docs', 'a[1].png')).toBeNull();
    expect(r.nameError('', 'CON.txt')).toContain('Windows');
    expect(r.texts?.root).toBe('共有フォルダ');
  });

  it('ゴミ箱の caps が偽の本体では、削除は完全な削除の扱い（部品の caps へ反映）', async () => {
    const files = fakeFiles(tree);
    files.caps = () => ({ trash: false, restore: false, attachmentsDir: null });
    const { view } = await boot(fakeDisnans(files));
    expect(view.explorer!.caps).toEqual({ trash: false, restore: false });
    expect(view.explorer!.rules.specialDir).toBeNull();
  });
});

describe('URL・拡大表示・PDF', () => {
  it('画像のサムネイルと読む元の URL は、本体の files.url が作る（縮小版・本物）。画像でなければ無し', async () => {
    const { view } = await boot(fakeDisnans(fakeFiles(tree)));
    const urls = view.explorer!.urls;
    const img = { name: 'photo.png', path: 'photo.png', kind: 'file' as const, size: 3, modified: 1, mime: null };
    expect(urls.thumbUrl(img)).toBe('https://srv.test/shared/photo.png?thumb=1');
    expect(urls.readUrl(img)).toBe('https://srv.test/shared/photo.png');
    expect(urls.href(img)).toBe('https://srv.test/shared/photo.png');
    expect(urls.thumbUrl({ ...img, name: 'a.txt', path: 'a.txt' })).toBeNull();
    // 添付は ID の URL
    expect(urls.thumbUrl({ ...img, file_id: 'F1' })).toBe('https://srv.test/files/F1?thumb=1');
  });

  it('画像を押すと、本体の拡大表示（openLightbox）へ。前後の並びも渡す。PDF の拡大も同じ', async () => {
    const files = fakeFiles({ 'a.png': 'x', 'b.png': 'y', 'c.txt': 'z', 'd.pdf': 'p' });
    const d = fakeDisnans(files);
    const { view, target } = await boot(d);
    const row = [...target.querySelectorAll<HTMLElement>('.file-explorer-item')].find((r) => r.textContent?.includes('b.png'))!;
    // PC の表示（jsdom は linux と見える）では、ダブルクリックで開く
    row.querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    const lb = d.ui.lightbox.at(-1);
    expect(lb?.item.alt).toBe('b.png');
    expect(lb?.item.src).toBe('https://srv.test/shared/b.png');
    expect(lb?.gallery.map((i) => i.alt)).toEqual(['a.png', 'b.png', 'd.pdf']);
    expect(view.explorer!.host.viewerKind('d.pdf')).toBe('pdf');
    expect(view.explorer!.host.viewerKind('c.txt')).toBeNull();
  });

  it('PDF のサムネイルは、本体の ui.renderPdfThumb へ渡す（大きすぎるものは作らない）。外すと片付く', async () => {
    const d = fakeDisnans(fakeFiles({ 'd.pdf': 'p' }));
    const { target, close, view } = await boot(d);
    // PDF の絵は、大きく並べる表示のときに出る
    view.explorer!.view.setView('', 'grid');
    await tick();
    expect(target.querySelector('.fxp-pdf-thumb')).not.toBeNull();
    expect(d.ui.thumbs).toHaveLength(1);
    expect(d.ui.thumbs[0]).toMatchObject({ url: 'https://srv.test/shared/d.pdf', stopped: false });
    expect(d.ui.thumbs[0].key).toMatch(/^d\.pdf:\d+:1$/);
    expect(d.ui.thumbs[0].el).toBe(target.querySelector('.fxp-pdf-thumb'));
    close();
    await tick();
    expect(d.ui.thumbs[0].stopped).toBe(true);
  });
});

describe('変更の知らせ・接続先の切り替え', () => {
  it('ほかの端末の変更（files.onChange）で、開いているフォルダを読み直す', async () => {
    const files = fakeFiles(tree);
    const { names } = await boot(fakeDisnans(files));
    expect(names()).not.toContain('new.txt');
    files.external('new.txt', () => files.tree.set('new.txt', { kind: 'file', body: 'n', modified: 5 }));
    await tick();
    expect(names()).toContain('new.txt');
  });

  it('接続先が変わったら、開いていた場所を捨てて、いちばん上へ戻る', async () => {
    const d = fakeDisnans(fakeFiles(tree));
    const { view, names } = await boot(d);
    view.explorer!.nav.open('docs');
    await tick();
    expect(names()).toEqual(['inner.txt']);
    const before = view.explorer!.scope.key();
    d.switchServer();
    await tick();
    // 見分け（key）も変わる（操作の途中で切り替わったら、新しい方へ書かないため）
    expect(view.explorer!.scope.key()).not.toBe(before);
    expect(view.explorer!.nav.dir).toBe('');
    expect(names()).toContain('a.txt');
  });

  it('閉じたら、購読（files.onChange・接続先の変更）を全部外し、画面を外す', async () => {
    const d = fakeDisnans(fakeFiles(tree));
    const { close, target } = await boot(d);
    expect(d.files.listeners).toBe(1);
    expect(d.serverListeners).toBe(1);
    close();
    expect(d.files.listeners).toBe(0);
    expect(d.serverListeners).toBe(0);
    expect(target.querySelector('.file-explorer-crumbs')).toBeNull();
  });
});

describe('フォルダごとの表示の保存（プラグインのデータ）', () => {
  it('変えた表示は、少し待ってから saveData へ（続けた変更は 1 回にまとめる）。閉じるときは今すぐ。次に開くと戻る', async () => {
    const d = fakeDisnans(fakeFiles(tree));
    const { view, close } = await boot(d);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    view.explorer!.view.setView('', 'grid');
    view.explorer!.view.setView('docs', 'grid');
    expect(d.saved.data).toBeNull();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    const saved = d.saved.data as { explorerDirs: Record<string, unknown> };
    expect(Object.keys(saved.explorerDirs).sort()).toEqual(['', 'docs']);
    view.explorer!.view.setView('', 'details');
    close();
    await vi.advanceTimersByTimeAsync(0);
    expect((d.saved.data as { explorerDirs: Record<string, { view: string }> }).explorerDirs['']?.view).toBe('details');
    vi.useRealTimers();
    booted = undefined;
    const again = await boot(d);
    expect(again.view.explorer!.view.of('docs').view).toBe('grid');
  });

  it('何も変えずに閉じたときは、保存しない（保存済みの表示を、空で上書きしない）', async () => {
    const d = fakeDisnans(fakeFiles(tree), { data: { explorerDirs: { docs: { view: 'grid', sortKey: 'name', sortOrder: 'asc' } } } });
    const { close, counter } = await boot(d);
    close();
    await tick();
    expect(counter.saves).toBe(0);
  });

  it('プラグインの保存が空のときだけ、本体の旧い保存先の中身（legacyData）を使う', async () => {
    const legacy = { docs: { view: 'grid', sortKey: 'name', sortOrder: 'asc' } };
    const first = await boot(fakeDisnans(fakeFiles(tree)), legacy);
    expect(first.view.explorer!.view.of('docs').view).toBe('grid');
    first.close();
    booted = undefined;
    const own = await boot(fakeDisnans(fakeFiles(tree), { data: { explorerDirs: {} } }), legacy);
    expect(own.view.explorer!.view.of('docs').view).not.toBe('grid');
  });
});
