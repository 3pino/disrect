// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FsEntry } from './lib/fs/types';

// アプリ全体（外枠 + 共有の部品 + この端末の置き場所）を、Rust の代わりの偽物の上で動かす。
// 偽物は、OS のパスをキーにしたメモリの中の木。呼ばれたコマンドを覚える。
const fake = vi.hoisted(() => {
  const tree = new Map<string, 'file' | 'dir'>();
  const calls: [string, unknown][] = [];
  const parent = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';
  const entry = (path: string): FsEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1), path, kind: tree.get(path)!, size: tree.get(path) === 'dir' ? null : 4, modified: 1_700_000_000_000,
    hidden: path.slice(path.lastIndexOf('/') + 1).startsWith('.'), readonly: false, symlink: false,
  });
  const invoke = async (cmd: string, args?: Record<string, string>): Promise<unknown> => {
    calls.push([cmd, args]);
    switch (cmd) {
      case 'fs_start_dir': return '/home/me';
      case 'fs_places': return [{ kind: 'home', path: '/home/me', name: '' }, { kind: 'root', path: '/', name: '' }];
      case 'fs_list': {
        if (tree.get(args!.path) !== 'dir') throw { code: 'not_found', message: args!.path };
        return [...tree.keys()].filter((p) => p !== '/' && parent(p) === args!.path).map(entry);
      }
      case 'fs_mkdir': tree.set(args!.path, 'dir'); return entry(args!.path);
      case 'fs_trash': tree.delete(args!.path); return null;
      case 'fs_move': tree.set(args!.to, tree.get(args!.from)!); tree.delete(args!.from); return entry(args!.to);
      case 'fs_open': return null;
      default: throw { code: 'unsupported', message: cmd };
    }
  };
  return { tree, calls, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: fake.invoke, convertFileSrc: (p: string, proto = 'asset') => `${proto}://localhost/${encodeURIComponent(p)}` }));

import App from './App.svelte';
import { settings } from './lib/settings.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

let app: ReturnType<typeof mount> | undefined;
let target: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  settings.showHidden = false;
  settings.dirs = {};
  localStorage.clear();
  fake.calls.length = 0;
  fake.tree.clear();
  for (const [p, k] of [['/', 'dir'], ['/home', 'dir'], ['/home/me', 'dir'], ['/home/me/docs', 'dir'], ['/home/me/docs/in.txt', 'file'], ['/home/me/a.txt', 'file'], ['/home/me/.env', 'file']] as const) fake.tree.set(p, k);
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
const called = (cmd: string): unknown[] => fake.calls.filter((c) => c[0] === cmd).map((c) => c[1]);
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label);
  if (!b) throw new Error(`ボタンがありません: ${label}`);
  return b;
};
const row = (name: string): HTMLElement => {
  const el = [...target.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === name)?.closest<HTMLElement>('.file-explorer-item');
  if (!el) throw new Error(`項目がありません: ${name}`);
  return el;
};

describe('fixplor の画面（この端末のファイル）', () => {
  it('ホームを開いて並べる。隠しファイルは出さない。場所の欄は OS のパス', async () => {
    app = mount(App, { target });
    await settle();
    expect(called('fs_list')).toEqual([{ path: '/home/me' }]);
    expect(names()).toEqual(['docs', 'a.txt']);
    expect(target.querySelector<HTMLInputElement>('input[aria-label="場所"]')!.value).toBe('/home/me');
    expect([...target.querySelectorAll('.places .menu-item')].map((b) => b.textContent)).toEqual(['ホーム', 'コンピューター']);
  });

  it('隠しファイルの切り替えは、読み直して反映し、次に開いたときも覚えている', async () => {
    app = mount(App, { target });
    await settle();
    button('隠しファイルを表示').click();
    await settle();
    expect(names()).toEqual(['docs', '.env', 'a.txt']);
    expect(localStorage.getItem('fixplor.showHidden')).toBe('1');
  });

  it('上のフォルダへ・戻る・場所の欄に打って開く', async () => {
    app = mount(App, { target });
    await settle();
    button('上のフォルダへ').click();
    await settle();
    expect(names()).toEqual(['me']);
    button('戻る').click();
    await settle();
    expect(names()).toEqual(['docs', 'a.txt']);
    const input = target.querySelector<HTMLInputElement>('input[aria-label="場所"]')!;
    input.value = '/home/me/docs/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(names()).toEqual(['in.txt']);
    expect(input.value).toBe('/home/me/docs');
  });

  it('Alt+← で戻る（Ctrl・Shift を一緒に押したときは、別の操作なので戻らない）', async () => {
    app = mount(App, { target });
    await settle();
    button('上のフォルダへ').click();
    await settle();
    expect(names()).toEqual(['me']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, ctrlKey: true, bubbles: true }));
    await settle();
    expect(names()).toEqual(['me']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    await settle();
    expect(names()).toEqual(['docs', 'a.txt']);
  });

  it('画像は拡大表示で開く（前後の画像へ移れる）。「保存」は既定のアプリで開く。Esc で閉じる。画像でないファイルは、拡大表示にしない', async () => {
    fake.tree.set('/home/me/p.png', 'file');
    fake.tree.set('/home/me/q.png', 'file');
    app = mount(App, { target });
    await settle();
    const open = (name: string): void => {
      row(name).querySelector('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    };
    open('a.txt');
    await settle();
    expect(document.querySelector('.lightbox')).toBeNull();
    expect(called('fs_open')).toEqual([{ path: '/home/me/a.txt' }]);
    open('p.png');
    await settle();
    const view = document.querySelector('.lightbox')!;
    expect(view.querySelector('img')!.getAttribute('src')).toBe('asset://localhost/' + encodeURIComponent('/home/me/p.png'));
    expect(view.querySelector('.lightbox-file-name')!.textContent).toBe('p.png');
    // 次の画像へ
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // 切り替えのアニメーションのあとで、次の画像になる
    await vi.waitFor(() => expect(document.querySelector('.lightbox-file-name')!.textContent).toBe('q.png'));
    // 保存 = 既定のアプリで開く
    document.querySelector<HTMLElement>('.lightbox-download')!.click();
    await settle();
    expect(called('fs_open').at(-1)).toEqual({ path: '/home/me/q.png' });
    expect(document.querySelector('.lightbox')).toBeNull();
    open('p.png');
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.lightbox')).toBeNull();
  });

  it('無いフォルダは、無いと出す（落ちない）', async () => {
    app = mount(App, { target });
    await settle();
    const input = target.querySelector<HTMLInputElement>('input[aria-label="場所"]')!;
    input.value = '/nope';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(names()).toEqual([]);
    expect(target.querySelector('.file-explorer')!.textContent).toMatch(/見つかりません|ありません/);
  });

  it('ダブルクリック: フォルダは中へ、ファイルは OS の既定のアプリで開く', async () => {
    app = mount(App, { target });
    await settle();
    row('a.txt').querySelector('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(called('fs_open')).toEqual([{ path: '/home/me/a.txt' }]);
    row('docs').querySelector('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(names()).toEqual(['in.txt']);
  });

  it('選んで削除: 確認のあと OS のゴミ箱へ。「取り消す」は出さない（ここからは戻せない）', async () => {
    app = mount(App, { target });
    await settle();
    row('a.txt').querySelector<HTMLElement>('.file-explorer-row, a, button')!.click();
    await settle();
    button('削除').click();
    await settle();
    expect(document.querySelector('.modal')!.textContent).toContain('OS のゴミ箱から元に戻せます');
    expect(called('fs_trash')).toEqual([]);
    button('ゴミ箱に移す').click();
    await settle();
    expect(called('fs_trash')).toEqual([{ path: '/home/me/a.txt' }]);
    expect(names()).toEqual(['docs']);
    const toast = document.querySelector('.toast')!;
    expect(toast.textContent).toContain('1 件をゴミ箱に移しました');
    expect(toast.querySelector('.toast-action')).toBeNull();
    // 閉じるボタンで消える（本体の状態を、土台の部品へつないである）
    toast.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click();
    await settle();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('確認を取り消すと、何も消さない', async () => {
    app = mount(App, { target });
    await settle();
    row('a.txt').querySelector<HTMLElement>('.file-explorer-row, a, button')!.click();
    await settle();
    button('削除').click();
    await settle();
    button('キャンセル').click();
    await settle();
    expect(called('fs_trash')).toEqual([]);
    expect(names()).toEqual(['docs', 'a.txt']);
  });
});
