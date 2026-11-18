// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import FileExplorer from './FileExplorer.svelte';
import { createExplorer, type Explorer } from './explorer';
import { PLAIN_RULES, dir, fakeApi, fakeHost, fakeUrls, file } from './test-support/fakes';
import type { Entry, ExplorerApi, ExplorerHost, SearchOutcome, SearchQuery } from './types';

// 検索の画面: 名前の絞り込み（フォルダの一覧を、名前で絞る）と、サブフォルダも探す（置き場所の search）。

const tick = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

const TREE = [dir('docs'), dir('docs/sub'), file('a.txt'), file('Cat.png'), file('docs/cat.txt'), file('docs/sub/dog.md'), file('docs/sub/CAT2.txt')];

type Searcher = (q: SearchQuery, on: { hits(e: Entry[]): void; signal: AbortSignal }) => Promise<SearchOutcome>;

function open(opts: { search?: Searcher; host?: Partial<ExplorerHost> } = {}) {
  const api: ExplorerApi & { tree: Map<string, Entry> } = fakeApi(TREE);
  if (opts.search) api.search = opts.search;
  const host = fakeHost(opts.host);
  const explorer: Explorer = createExplorer({
    api, urls: fakeUrls, rules: PLAIN_RULES, host, labels: { root: 'いちばん上', upload: '取り込む' },
    viewStore: { read: () => ({}), write: () => {} }, searchDelayMs: 0,
  });
  explorer.selection.desktop = true;
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(FileExplorer, { target, props: { explorer } });
  cleanup = () => void unmount(app);
  const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
  const hits = (): string[] => [...target.querySelectorAll('.file-explorer-hit-name')].map((n) => n.textContent ?? '');
  const input = (): HTMLInputElement => target.querySelector<HTMLInputElement>('input[aria-label="名前で検索"]')!;
  const type = async (text: string): Promise<void> => {
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
  };
  const status = (): string => target.querySelector('.file-explorer-search-status')?.textContent ?? '';
  const recursive = async (): Promise<void> => {
    const box = target.querySelector<HTMLInputElement>('.file-explorer-search-sub input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  };
  const openBar = async (): Promise<void> => {
    target.querySelector<HTMLButtonElement>('button[aria-label="検索"]')!.click();
    await tick();
  };
  return { api, explorer, host, target, names, hits, input, type, status, recursive, openBar };
}

describe('名前の絞り込み', () => {
  it('虫めがねで検索の欄が開く（入力にフォーカス）。入力で、いまのフォルダの一覧を名前で絞る（大文字小文字は区別しない）。閉じると戻る', async () => {
    const t = open();
    await tick();
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
    await t.openBar();
    expect(document.activeElement).toBe(t.input());
    await t.type('cat');
    expect(t.names()).toEqual(['Cat.png']);
    await t.type('A');
    expect(t.names()).toEqual(['a.txt', 'Cat.png']);
    await t.type('zzz');
    expect(t.names()).toEqual([]);
    expect(t.target.textContent).toContain('「zzz」を含む項目は、このフォルダにありません');
    await t.type('');
    expect(t.names()).toEqual(['docs', 'a.txt', 'Cat.png']);
    await t.type('cat');
    t.target.querySelector<HTMLButtonElement>('button[aria-label="検索を閉じる"]')!.click();
    await tick();
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
    expect(t.names()).toEqual(['docs', 'a.txt', 'Cat.png']);
  });

  it('Ctrl+F で開く（開いていれば入力を選ぶ）。Esc で閉じて、絞り込みも解く', async () => {
    const t = open();
    await tick();
    const ev = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    await tick();
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(t.input());
    await t.type('a.t');
    expect(t.names()).toEqual(['a.txt']);
    t.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
    expect(t.names()).toEqual(['docs', 'a.txt', 'Cat.png']);
    // 開いているときの Ctrl+F は、入力の文字を選ぶ（打ち直せる）。ほかのキーは、何もしない
    await t.openBar();
    await t.type('abc');
    t.input().setSelectionRange(0, 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    expect([t.input().selectionStart, t.input().selectionEnd]).toEqual([0, 3]);
    t.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    const g = new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(g);
    await tick();
    expect(g.defaultPrevented).toBe(false);
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
    // Shift・Alt が付いた F は別の操作
    const other = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('サブフォルダの検索が無い置き場所には、「サブフォルダも」を出さない。ある置き場所には出す', async () => {
    const a = open();
    await tick();
    await a.openBar();
    expect(a.target.querySelector('.file-explorer-search-sub')).toBeNull();
    cleanup?.();
    document.body.innerHTML = '';
    const b = open({ search: async () => ({ partial: null }) });
    await tick();
    await b.openBar();
    expect(b.target.querySelector('.file-explorer-search-sub')).not.toBeNull();
  });

  it('絞り込みは置き場所に頼まない（サブフォルダも、を入れていなければ search を呼ばない）', async () => {
    const search = vi.fn<Searcher>(async () => ({ partial: null }));
    const t = open({ search });
    await tick();
    await t.openBar();
    await t.type('cat');
    expect(search).not.toHaveBeenCalled();
    expect(t.names()).toEqual(['Cat.png']);
  });
});

describe('サブフォルダも探す', () => {
  const finder: Searcher = async (q, on) => {
    const found = TREE.filter((e) => e.path.startsWith(q.dir === '' ? '' : q.dir + '/') && e.name.toLowerCase().includes(q.text.toLowerCase()));
    on.hits(found);
    return { partial: null };
  };

  it('文字を入れると、置き場所に頼んで、一覧が検索結果（名前・場所）に替わる。件数を出す', async () => {
    const search = vi.fn<Searcher>(finder);
    const t = open({ search });
    await tick();
    await t.openBar();
    await t.recursive();
    // 文字が無いうちは、フォルダの一覧のまま
    expect(t.names()).toEqual(['docs', 'a.txt', 'Cat.png']);
    expect(search).not.toHaveBeenCalled();
    await t.type('cat');
    expect(search.mock.calls[0][0]).toEqual({ dir: '', text: 'cat' });
    expect(t.hits().sort()).toEqual(['CAT2.txt', 'Cat.png', 'cat.txt']);
    const places = [...t.target.querySelectorAll('.file-explorer-hit')].map((li) => `${li.querySelector('.file-explorer-hit-name')!.textContent}@${li.querySelector('.file-explorer-hit-place')!.textContent}`);
    expect(places.sort()).toEqual(['CAT2.txt@docs/sub', 'Cat.png@このフォルダ', 'cat.txt@docs']);
    expect(t.status()).toBe('3 件');
    expect(t.names()).toEqual([]);
  });

  it('見つからないときは「見つかりません」。途中で止めたときは、その理由を件数といっしょに出す', async () => {
    const t = open({ search: async () => ({ partial: null }) });
    await tick();
    await t.openBar();
    await t.recursive();
    await t.type('nothing');
    expect(t.target.querySelector('.file-explorer-status')!.textContent).toContain('見つかりません');
    expect(t.status()).toBe('見つかりません');
    cleanup?.();
    document.body.innerHTML = '';
    const p = open({ search: async (_q, on) => (on.hits([file('x1.txt')]), { partial: 'scan' }) });
    await tick();
    await p.openBar();
    await p.recursive();
    await p.type('x');
    expect(p.status()).toBe('1 件（調べる数の上限に達したので、途中までです）');
  });

  it('検索中は「検索しています」。失敗したら理由を出す', async () => {
    let release: (o: SearchOutcome) => void = () => {};
    const t = open({ search: (_q, on) => new Promise((r) => ((release = r), on.hits([file('x.txt')]))) });
    await tick();
    await t.openBar();
    await t.recursive();
    await t.type('x');
    expect(t.status()).toBe('検索しています… 1 件');
    release({ partial: null });
    await tick();
    expect(t.status()).toBe('1 件');
    cleanup?.();
    document.body.innerHTML = '';
    const f = open({ search: async () => Promise.reject(new Error('読めませんでした')) });
    await tick();
    await f.openBar();
    await f.recursive();
    await f.type('x');
    expect(f.status()).toBe('検索できませんでした: 読めませんでした');
  });

  it('フォルダの結果は押すと、そのフォルダを開いて検索を閉じる。ファイルは開く（画像は拡大表示、ほかは保存）', async () => {
    const t = open({ search: finder });
    await tick();
    await t.openBar();
    await t.recursive();
    await t.type('a');
    const rows = (name: string): HTMLButtonElement => [...t.target.querySelectorAll<HTMLButtonElement>('.file-explorer-hit-row')].find((b) => b.textContent!.includes(name))!;
    rows('Cat.png').click();
    await tick();
    expect(t.host.openViewer).toHaveBeenCalledOnce();
    rows('a.txt').click();
    await tick();
    expect(t.host.download.file).toHaveBeenCalledWith({ url: 'fake://a.txt', name: 'a.txt' });
    await t.type('sub');
    rows('sub').click();
    await tick();
    expect(t.explorer.nav.dir).toBe('docs/sub');
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
    expect(t.names()).toEqual(['CAT2.txt', 'dog.md']);
  });

  it('「場所を開く」で、その項目のあるフォルダへ移り、項目を選ぶ。検索は閉じる', async () => {
    const t = open({ search: finder });
    await tick();
    await t.openBar();
    await t.recursive();
    await t.type('dog');
    t.target.querySelector<HTMLButtonElement>('button[aria-label="dog.md のある場所を開く"]')!.click();
    await tick();
    expect(t.explorer.nav.dir).toBe('docs/sub');
    expect(t.explorer.selection.paths()).toEqual(['docs/sub/dog.md']);
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
  });

  it('フォルダを変えると、新しいフォルダで探し直す。文字を打ち直すと、前の検索は中止する', async () => {
    const seen: { q: SearchQuery; signal: AbortSignal }[] = [];
    const t = open({ search: async (q, on) => (seen.push({ q, signal: on.signal }), on.hits([]), { partial: null }) });
    await tick();
    await t.openBar();
    await t.recursive();
    await t.type('c');
    expect(seen.map((s) => s.q)).toEqual([{ dir: '', text: 'c' }]);
    t.explorer.nav.open('docs');
    await tick();
    expect(seen.map((s) => s.q)).toEqual([{ dir: '', text: 'c' }, { dir: 'docs', text: 'c' }]);
    await t.type('ca');
    expect(seen.at(-1)!.q).toEqual({ dir: 'docs', text: 'ca' });
  });

  it('戻る（addBack）は、開いている検索を閉じる', async () => {
    const backs: (() => void)[] = [];
    const t = open({ search: finder, host: { addBack: (run) => (backs.push(run), () => {}) } });
    await tick();
    await t.openBar();
    expect(backs.length).toBeGreaterThan(0);
    backs.at(-1)!();
    await tick();
    expect(t.target.querySelector('.file-explorer-search')).toBeNull();
  });
});
