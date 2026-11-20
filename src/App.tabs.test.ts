// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FsEntry } from './lib/fs/types';
import { hotkeys } from './lib/hotkeys.svelte';

// ウィンドウの操作（最後のタブを閉じる・別のウィンドウで開く）は、呼んだことだけを覚える偽物にする
const win = vi.hoisted(() => ({ quit: vi.fn(async () => {}), open: vi.fn(async (_tab: { place: string; dir: string }, _at?: { x: number; y: number }) => {}) }));
vi.mock('./lib/windowControls', async (orig) => ({ ...(await orig<typeof import('./lib/windowControls')>()), hasWindowControls: () => false, quitWindow: win.quit, openTabInNewWindow: win.open }));

// タブ: この端末（メモリの中の木）と、追加したネットワークの場所（WebDAV の偽物）を、複数のタブで開く。
const fake = vi.hoisted(() => {
  const tree = new Map<string, 'file' | 'dir'>();
  const dav = new Map<string, 'file' | 'dir'>();
  const calls: [string, unknown][] = [];
  const parent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '');
  const entry = (path: string): FsEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1), path, kind: tree.get(path)!, size: tree.get(path) === 'dir' ? null : 4, modified: 1_700_000_000_000,
    hidden: false, readonly: false, symlink: false,
  });
  const davRaw = (path: string) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: dav.get(path)!, size: dav.get(path) === 'dir' ? null : 4, modified: 1_700_000_000_000, hidden: false, mime: null, etag: `e-${path}` });
  const invoke = async (cmd: string, args?: Record<string, string>): Promise<unknown> => {
    calls.push([cmd, args]);
    switch (cmd) {
      case 'fs_start_dir': return '/home/me';
      case 'fs_places': return [{ kind: 'home', path: '/home/me', name: '' }];
      case 'fs_list': return [...tree.keys()].filter((p) => p !== '/' && parent(p) === args!.path).map(entry);
      case 'dav_cred_info': return null;
      case 'dav_pin_info': return null;
      case 'dav_list': return [...dav.keys()].filter((p) => parent(p) === args!.path && p !== '').map(davRaw);
      case 'dav_cancel': return false;
      default: throw { code: 'unsupported', message: cmd };
    }
  };
  return { tree, dav, calls, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: fake.invoke, convertFileSrc: (p: string, proto = 'asset') => `${proto}://localhost/${encodeURIComponent(p)}` }));
// 作ったエクスプローラーが受け取ったバッファを覚える（タブのあいだで共有されるかを見る）
const made = vi.hoisted(() => ({ buffers: [] as { place: string; buffer: unknown }[] }));
vi.mock('@3pino/explorer-kit', async (orig) => {
  const real = await orig<typeof import('@3pino/explorer-kit')>();
  return { ...real, createExplorer: (o: Parameters<typeof real.createExplorer>[0]) => (made.buffers.push({ place: o.labels.root, buffer: o.buffer }), real.createExplorer(o)) };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

import App from './App.svelte';
import { places } from './lib/places.svelte';
import { settings } from './lib/settings.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

let app: ReturnType<typeof mount> | undefined;
let target: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  for (const p of [...places.list]) places.remove(p.id);
  settings.showHidden = false;
  settings.dirs = {};
  localStorage.clear();
  hotkeys.reload();
  fake.calls.length = 0;
  made.buffers.length = 0;
  fake.tree.clear();
  for (const [p, k] of [['/', 'dir'], ['/home', 'dir'], ['/home/me', 'dir'], ['/home/me/docs', 'dir'], ['/home/me/docs/in.txt', 'file'], ['/home/me/pics', 'dir'], ['/home/me/a.txt', 'file']] as const) fake.tree.set(p, k);
  fake.dav.clear();
  fake.dav.set('movies', 'dir');
  fake.dav.set('b.txt', 'file');
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

const start = async (): Promise<void> => {
  app = mount(App, { target });
  await settle();
};
const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
const tabEls = (): HTMLElement[] => [...target.querySelectorAll<HTMLElement>('.tabs .tab:not(.tab-ghost)')];
const tabLabels = (): string[] => tabEls().map((t) => t.querySelector('.tab-label')!.textContent!);
const activeLabel = (): string => target.querySelector('.tab-active .tab-label')!.textContent!;
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label);
  if (!b) throw new Error(`ボタンがありません: ${label}`);
  return b;
};
const key = async (k: string, init: KeyboardEventInit = { ctrlKey: true }): Promise<KeyboardEvent> => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(ev);
  await settle();
  return ev;
};
/** 道筋（パンくず）のいちばん上から、フォルダを順に開いて行く（場所の欄は無い） */
const goTo = async (path: string): Promise<void> => {
  target.querySelector<HTMLElement>('.file-explorer-crumb')!.click();
  await settle();
  for (const seg of path.split('/').filter(Boolean)) {
    const name = [...target.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === seg);
    // PC では、押すと選ぶので、ダブルクリックで開く
    name!.closest('.file-explorer-item')!.querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
  }
};
const click = async (el: Element): Promise<void> => {
  (el as HTMLElement).click();
  await settle();
};
const savedTabs = (): { v: number; tabs: { place: string; dir: string }[]; active: number } => JSON.parse(localStorage.getItem('fixplor.tabs')!);
/** jsdom には DataTransfer が無いので、使う口だけの偽物を持たせたドラッグのイベント */
function drag(type: string, types: string[], data: Record<string, string> = {}): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types, getData: (t: string) => data[t] ?? '', setData: () => {}, effectAllowed: '' } });
  return ev;
}

describe('タブ', () => {
  it('起動は 1 つのタブ（この端末のホーム）。1 つだけでも閉じるボタンを出す', async () => {
    await start();
    expect(tabLabels()).toEqual(['me']);
    expect(target.querySelectorAll('.tab-close')).toHaveLength(1);
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
  });

  it('＋と Ctrl+T で、新しいタブ（いま見ている置き場所のいちばん上。この端末はホーム）を右隣に作って見る', async () => {
    await start();
    await goTo('/home/me/docs');
    expect(activeLabel()).toBe('docs');
    await click(button('新しいタブ'));
    expect(tabLabels()).toEqual(['docs', 'me']);
    expect(activeLabel()).toBe('me');
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
    const ev = await key('t');
    expect(ev.defaultPrevented).toBe(true);
    expect(tabLabels()).toEqual(['docs', 'me', 'me']);
    expect(tabEls().map((t) => t.classList.contains('tab-active'))).toEqual([false, false, true]);
  });

  it('タブごとにフォルダ・戻る履歴を持つ。切り替えても、それぞれのまま', async () => {
    await start();
    await click(button('新しいタブ'));
    await goTo('/home/me/pics');
    expect(names()).toEqual([]);
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(activeLabel()).toBe('me');
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
    await click(tabEls()[1].querySelector('.tab-main')!);
    expect(activeLabel()).toBe('pics');
    // 2 つめのタブで「上へ」しても、1 つめは動かない
    await click(button('上のフォルダへ'));
    expect(activeLabel()).toBe('me');
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
  });

  it('閉じる: ×・Ctrl+W・真ん中のボタン。見ているタブを閉じたら右隣（なければ左）。最後の 1 つを閉じると、ウィンドウを閉じる', async () => {
    await start();
    await key('t');
    await key('t');
    await goTo('/home/me/pics'); // 3 つめ
    expect(tabLabels()).toEqual(['me', 'me', 'pics']);
    await key('w'); // 見ている 3 つめを閉じる → 左
    expect(tabLabels()).toEqual(['me', 'me']);
    expect(tabEls()[1].classList.contains('tab-active')).toBe(true);
    await click(tabEls()[0].querySelector('.tab-close')!); // 見ていない 1 つめを閉じる → 見ているタブはそのまま
    expect(tabLabels()).toEqual(['me']);
    expect(win.quit).not.toHaveBeenCalled();
    // 最後の 1 つ: Ctrl+W でも、ウィンドウを閉じる（タブの保存は、そのまま残る）
    const ev = await key('w');
    expect(win.quit).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(tabLabels()).toEqual(['me']);
    await click(tabEls()[0].querySelector('.tab-close')!);
    expect(win.quit).toHaveBeenCalledTimes(2);
    // 真ん中のボタン
    await key('t');
    const mid = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
    tabEls()[1].dispatchEvent(mid);
    await settle();
    expect(tabLabels()).toEqual(['me']);
  });

  it('Ctrl+Tab・Ctrl+Shift+Tab・Ctrl+PageDown/PageUp・Ctrl+数字で切り替える（端はつながる。9 は最後）', async () => {
    await start();
    await key('t');
    await key('t');
    await goTo('/home/me/pics');
    await key('t'); // 4 つ: me me pics me → 4 つめを見る
    expect(tabLabels()).toEqual(['me', 'me', 'pics', 'me']);
    const at = (): number => tabEls().findIndex((t) => t.classList.contains('tab-active'));
    expect(at()).toBe(3);
    await key('Tab');
    expect(at()).toBe(0);
    await key('Tab', { ctrlKey: true, shiftKey: true });
    expect(at()).toBe(3);
    await key('PageUp');
    expect(at()).toBe(2);
    await key('PageDown');
    expect(at()).toBe(3);
    await key('1');
    expect(at()).toBe(0);
    await key('3');
    expect(at()).toBe(2);
    await key('9');
    expect(at()).toBe(3);
    // Ctrl の無い T は、何もしない
    await key('t', {});
    expect(tabLabels()).toHaveLength(4);
  });

  it('右クリックのメニュー: 複製（同じフォルダ）・左右へ移す・ほかを閉じる・閉じる', async () => {
    await start();
    await goTo('/home/me/docs');
    await key('t');
    await goTo('/home/me/pics');
    expect(tabLabels()).toEqual(['docs', 'pics']);
    tabEls()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await settle();
    await click(button('複製'));
    expect(tabLabels()).toEqual(['docs', 'docs', 'pics']);
    expect(activeLabel()).toBe('docs');
    expect(names()).toEqual(['in.txt']);
    // 複製のタブ（2 つめ）を左へ
    tabEls()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector<HTMLButtonElement>('[role=menu] button[disabled]')).toBeNull();
    await click(button('右へ移す'));
    expect(tabLabels()).toEqual(['docs', 'pics', 'docs']);
    // 端のタブは、その向きへは移せない
    tabEls()[2].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(button('右へ移す').disabled).toBe(true);
    await click(button('ほかのタブを閉じる'));
    expect(tabLabels()).toEqual(['docs']);
    expect(activeLabel()).toBe('docs');
  });

  it('ドラッグで並べ替える（タブを、ほかのタブへ落とす）', async () => {
    await start();
    await goTo('/home/me/docs');
    await key('t');
    await goTo('/home/me/pics');
    await key('t');
    expect(tabLabels()).toEqual(['docs', 'pics', 'me']);
    tabEls()[2].dispatchEvent(drag('dragstart', ['application/x-fixplor-tab']));
    tabEls()[0].dispatchEvent(drag('drop', ['application/x-fixplor-tab'], { 'application/x-fixplor-tab': '2' }));
    await settle();
    expect(tabLabels()).toEqual(['me', 'docs', 'pics']);
    // 見ているタブは、並べ替えても同じタブ（「me」のまま）
    expect(activeLabel()).toBe('me');
  });

  it('フォルダをタブの欄へドラッグして落とすと、新しいタブで開く（見ているタブは変えない）。ファイル・知らない項目は開かない。落とす前に、点線のタブで位置（隙間）を見せる', async () => {
    await start();
    // フォルダを含むドラッグには、フォルダの印も付く（ファイルだけのドラッグには付かない）
    const types = ['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir'];
    const ghost = (): HTMLElement | null => target.querySelector('.tab-ghost');
    // ファイルだけのドラッグは、受けない（何も見せない）
    const over = drag('dragover', [types[0]]);
    target.querySelector('.tabs')!.dispatchEvent(over);
    await settle();
    expect(over.defaultPrevented).toBe(false);
    expect(ghost()).toBeNull();
    const overDir = drag('dragover', types);
    target.querySelector('.tabs')!.dispatchEvent(overDir);
    await settle();
    expect(overDir.defaultPrevented).toBe(true);
    // タブの無いところの上: いちばん後ろに、点線のタブ
    expect(ghost()).not.toBeNull();
    expect(tabEls()).toHaveLength(1);
    target.querySelector('.tabs')!.dispatchEvent(drag('drop', types, { [types[0]]: 'home/me/docs|home/me/a.txt|home/me/nowhere' }));
    await settle();
    expect(ghost()).toBeNull();
    expect(tabLabels()).toEqual(['me', 'docs']);
    // 見ているタブは、そのまま
    expect(activeLabel()).toBe('me');
    // 「＋」の上でも同じ（欄の中）。いま見ているフォルダの一覧で、見つかるものだけ
    target.querySelector('.tab-add')!.dispatchEvent(drag('drop', types, { [types[0]]: 'home/me/pics' }));
    await settle();
    expect(tabLabels()).toEqual(['me', 'docs', 'pics']);
    expect(activeLabel()).toBe('me');
  });

  it('タブの上へ落とすと、そのタブの隣（右半分なら後ろ）に作る。タブの欄を出ると、点線のタブは消える', async () => {
    await start();
    await key('t');
    await click(tabEls()[0].querySelector('.tab-main')!);
    const types = ['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir'];
    tabEls()[0].dispatchEvent(drag('dragover', types));
    await settle();
    const all = [...target.querySelectorAll('.tabs .tab')];
    expect(all.map((t) => t.classList.contains('tab-ghost'))).toEqual([false, true, false]);
    target.querySelector('.tabbar')!.dispatchEvent(new Event('dragleave', { bubbles: true }));
    await settle();
    expect(target.querySelector('.tab-ghost')).toBeNull();
    tabEls()[0].dispatchEvent(drag('dragover', types));
    await settle();
    tabEls()[0].dispatchEvent(drag('drop', types, { [types[0]]: 'home/me/docs' }));
    await settle();
    expect(tabLabels()).toEqual(['me', 'docs', 'me']);
  });

  it('タブをウィンドウの外へドラッグして離すと、別のウィンドウで開き、このウィンドウのタブは閉じる（1 つだけのタブは動かさない・ウィンドウの中なら動かさない）', async () => {
    await start();
    // dragstart してから dragend（ドラッグ中でなければ、何もしない）
    const end = (el: Element, init: { dropEffect: string; x: number; y: number }): void => {
      el.dispatchEvent(drag('dragstart', []));
      const ev = new Event('dragend', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { dropEffect: init.dropEffect } });
      for (const [k, v] of Object.entries({ clientX: init.x, clientY: init.y, screenX: init.x + 300, screenY: init.y + 200 })) Object.defineProperty(ev, k, { value: v });
      el.dispatchEvent(ev);
    };
    // 1 つだけのタブ
    end(tabEls()[0], { dropEffect: 'none', x: -40, y: 10 });
    await settle();
    expect(win.open).not.toHaveBeenCalled();
    await key('t');
    await goTo('/home/me/docs');
    // ウィンドウの中で離した（取り消し）
    end(tabEls()[1], { dropEffect: 'none', x: 100, y: 10 });
    await settle();
    expect(win.open).not.toHaveBeenCalled();
    // 受け取られた（ほかのタブの上など）
    end(tabEls()[1], { dropEffect: 'move', x: -40, y: 10 });
    await settle();
    expect(win.open).not.toHaveBeenCalled();
    // ウィンドウの外
    end(tabEls()[1], { dropEffect: 'none', x: -40, y: 10 });
    await settle();
    expect(win.open).toHaveBeenCalledWith({ place: 'local', dir: 'home/me/docs' }, { x: 260, y: 210 });
    expect(tabLabels()).toEqual(['me']);
  });

  it('別のウィンドウで開いたとき（?place=…&dir=…）は、そのタブ 1 つで始める。タブの保存は、元のウィンドウのものを上書きしない', async () => {
    localStorage.setItem('fixplor.tabs', JSON.stringify({ v: 1, active: 0, tabs: [{ place: 'local', dir: '/home/me' }, { place: 'local', dir: '/home/me/pics' }] }));
    const before = localStorage.getItem('fixplor.tabs');
    history.replaceState(null, '', '/?place=local&dir=%2Fhome%2Fme%2Fdocs');
    try {
      await start();
      expect(tabLabels()).toEqual(['docs']);
      await key('t');
      expect(tabLabels()).toEqual(['docs', 'me']);
      expect(localStorage.getItem('fixplor.tabs')).toBe(before);
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('設定のタブ: 左下の行で開く（1 つだけ）。タブとして保存・復元される。場所の欄の操作は、新しいタブで開く', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    expect(tabLabels()).toEqual(['me', '設定']);
    expect(activeLabel()).toBe('設定');
    expect(target.querySelector('[role="region"][aria-label="設定"]')).not.toBeNull();
    expect(target.querySelector('.file-explorer')).toBeNull();
    expect(target.textContent).toContain('ホットキー');
    expect(target.textContent).toContain('バージョン');
    expect(savedTabs().tabs.map((t) => t.place)).toEqual(['local', 'fixplor:settings']);
    // もう一度押しても、増やさない（見ているタブへ移るだけ）
    await click(tabEls()[0].querySelector('.tab-main')!);
    await click(target.querySelector('.about-row')!);
    expect(tabLabels()).toEqual(['me', '設定']);
    expect(activeLabel()).toBe('設定');
    // 場所の欄の「コンピューター」: 設定を残して、新しいタブで開く
    await click(target.querySelector('.places .menu-item')!);
    expect(tabLabels()).toEqual(['me', '設定', 'me']);
    expect(activeLabel()).toBe('me');
    // 起動し直すと、設定のタブも戻る
    void unmount(app!);
    app = undefined;
    document.body.innerHTML = '';
    target = document.createElement('div');
    document.body.append(target);
    await start();
    expect(tabLabels()).toEqual(['me', '設定', 'me']);
  });

  it('ネットワークの場所もタブで開く。タブの中で置き場所を切り替えても、その置き場所のフォルダ・選びは保つ', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await click(button('自宅'));
    expect(activeLabel()).toBe('自宅');
    expect(names()).toEqual(['movies', 'b.txt']);
    await key('t'); // 自宅のいちばん上
    expect(tabLabels()).toEqual(['自宅', '自宅']);
    await click(target.querySelector('.places .menu-item')!); // この端末（ホーム）へ戻る: このタブだけ
    expect(tabLabels()).toEqual(['自宅', 'me']);
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(names()).toEqual(['movies', 'b.txt']);
  });

  it('切り取り・コピーのバッファは、同じ置き場所のタブで共有する。別の置き場所とは共有しない（パスが別のものになる）', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await key('t');
    await click(button('自宅'));
    await key('t');
    const byPlace = (root: string): unknown[] => made.buffers.filter((b) => b.place === root).map((b) => b.buffer);
    const local = byPlace('コンピューター');
    const dav = byPlace('自宅');
    expect(local).toHaveLength(2);
    expect(local[0]).toBeDefined();
    expect(local[0]).toBe(local[1]);
    expect(dav.length).toBeGreaterThanOrEqual(1);
    expect(dav[0]).not.toBe(local[0]);
  });

  it('置き場所を外すと、その置き場所を見ていたタブは、この端末へ戻る', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await click(button('自宅'));
    await key('t');
    expect(tabLabels()).toEqual(['自宅', '自宅']);
    await click(button('「自宅」を直す'));
    await click(button('一覧から外す'));
    await click(button('外す'));
    expect(places.list).toEqual([]);
    expect(tabLabels()).toEqual(['me', 'me']);
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
  });

  it('タブ（置き場所・フォルダ・見ているタブ）を保存し、次の起動で戻す', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await goTo('/home/me/docs');
    await click(button('新しいタブ'));
    await click(button('自宅'));
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(savedTabs()).toEqual({ v: 1, tabs: [{ place: 'local', dir: 'home/me/docs' }, { place: p.place.id, dir: '' }], active: 0 });
    void unmount(app!);
    app = undefined;
    document.body.innerHTML = '';
    target = document.createElement('div');
    document.body.append(target);
    fake.calls.length = 0;
    await start();
    expect(tabLabels()).toEqual(['docs', '自宅']);
    expect(activeLabel()).toBe('docs');
    expect(names()).toEqual(['in.txt']);
    // ネットワークの場所のタブは、見るまでつながない
    expect(fake.calls.filter((c) => c[0] === 'dav_list')).toEqual([]);
    await click(tabEls()[1].querySelector('.tab-main')!);
    expect(names()).toEqual(['movies', 'b.txt']);
  });

  it('保存が壊れている・外した置き場所だけなら、ホームの 1 つで始める。外した置き場所のタブは捨てる', async () => {
    localStorage.setItem('fixplor.tabs', '{ broken');
    await start();
    expect(tabLabels()).toEqual(['me']);
    void unmount(app!);
    app = undefined;
    document.body.innerHTML = '';
    target = document.createElement('div');
    document.body.append(target);
    localStorage.setItem('fixplor.tabs', JSON.stringify({ v: 1, active: 1, tabs: [{ place: 'local', dir: 'home/me/pics' }, { place: 'gone-place', dir: 'x' }] }));
    await start();
    expect(tabLabels()).toEqual(['pics']);
  });

  it('タブは 20 個まで（超えたら知らせて、作らない）', async () => {
    await start();
    for (let i = 0; i < 25; i++) await key('t');
    expect(tabLabels()).toHaveLength(20);
    expect(document.querySelector('.toast')!.textContent).toContain('タブは 20 個まで');
  });

  it('ホットキーは、設定で変えられる。変えると、前のキーは効かなくなり、新しいキーが効く。保存され、既定に戻せる', async () => {
    await start();
    await click(target.querySelector('.about-row')!); // 設定のタブ
    const row = (id: string): HTMLElement => target.querySelector<HTMLElement>(`[data-command="${id}"]`)!;
    // 新しいタブに、Ctrl+Y を足す（記録）
    (row('tab.new').querySelector('button[aria-label="新しいタブのキーを追加"]') as HTMLElement).click();
    await settle();
    expect(row('tab.new').textContent).toContain('キーを押してください');
    // 記録の間は、ほかの操作は働かない（Ctrl+T も、タブを作らずに記録される）
    const before = tabLabels().length;
    await key('Control', { ctrlKey: true }); // 修飾キーだけは、続きを待つ
    expect(row('tab.new').textContent).toContain('キーを押してください');
    await key('y');
    expect(tabLabels()).toHaveLength(before);
    expect(row('tab.new').textContent).toContain('Ctrl+Y');
    expect(JSON.parse(localStorage.getItem('fixplor.hotkeys')!)).toEqual({ 'tab.new': ['Ctrl+T', 'Ctrl+Y'] });
    await key('y');
    expect(tabLabels()).toHaveLength(before + 1);
    await click(tabEls()[1].querySelector('.tab-main')!); // 設定のタブへ戻る
    // Ctrl+T を外す → 効かない
    (row('tab.new').querySelector('button[aria-label="新しいタブの Ctrl+T を外す"]') as HTMLElement).click();
    await settle();
    await key('t');
    expect(tabLabels()).toHaveLength(before + 1);
    // 既定に戻す → Ctrl+T が効く。保存も消える
    (row('tab.new').querySelector('button[aria-label="新しいタブのキーを既定に戻す"]') as HTMLElement).click();
    await settle();
    expect(localStorage.getItem('fixplor.hotkeys')).toBe('{}');
    await key('t');
    expect(tabLabels()).toHaveLength(before + 2);
  });

  it('記録は、修飾キーなしの Esc で取り消す。ほかの操作と同じキーを足すと、警告を出す', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    const row = (id: string): HTMLElement => target.querySelector<HTMLElement>(`[data-command="${id}"]`)!;
    (row('tab.prev').querySelector('button[aria-label="前のタブのキーを追加"]') as HTMLElement).click();
    await settle();
    await key('Escape', {});
    expect(row('tab.prev').textContent).not.toContain('キーを押してください');
    expect(localStorage.getItem('fixplor.hotkeys')).toBeNull();
    expect(row('tab.prev').querySelector('[role="img"]')).toBeNull();
    (row('tab.prev').querySelector('button[aria-label="前のタブのキーを追加"]') as HTMLElement).click();
    await settle();
    await key('t'); // 「新しいタブ」と同じ
    expect(row('tab.prev').querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('新しいタブ');
    expect(row('tab.new').querySelector('[role="img"]')).not.toBeNull();
  });

  it('一覧の操作（名前の変更・検索など）のホットキーも、設定のとおりになる', async () => {
    localStorage.setItem('fixplor.hotkeys', JSON.stringify({ rename: ['F3'], search: [] }));
    hotkeys.reload();
    await start();
    const row = target.querySelector<HTMLElement>('.file-explorer-item[data-path="home/me/docs"] .file-explorer-row')!;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('.file-explorer-rename')).toBeNull();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('.file-explorer-rename')).not.toBeNull();
  });
});
