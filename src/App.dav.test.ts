// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// アプリ全体に、ネットワークの置き場所（WebDAV）を足して動かす。Rust の代わりの偽物の上で、
// この端末の置き場所（ホームだけ）と、追加した WebDAV（メモリの中の木）を同時に持つ。
const fake = vi.hoisted(() => {
  const dav = new Map<string, { kind: 'file' | 'dir'; etag: string }>();
  const calls: [string, unknown, Record<string, string> | undefined][] = [];
  const state = { offline: false };
  const rawOf = (path: string) => ({
    name: path.slice(path.lastIndexOf('/') + 1), path, kind: dav.get(path)!.kind, size: dav.get(path)!.kind === 'dir' ? null : 4,
    modified: 1_700_000_000_000, hidden: false, mime: null, etag: dav.get(path)!.etag,
  });
  const parent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const invoke = async (cmd: string, args?: Record<string, string>, opt?: { headers?: Record<string, string> }): Promise<unknown> => {
    calls.push([cmd, args, opt?.headers]);
    switch (cmd) {
      case 'fs_start_dir': return '/home/me';
      case 'fs_places': return [{ kind: 'home', path: '/home/me', name: '' }];
      case 'fs_list': return [{ name: 'local.txt', path: '/home/me/local.txt', kind: 'file', size: 1, modified: 0, hidden: false, readonly: false, symlink: false }];
      case 'dav_list':
        if (state.offline) throw { code: 'offline', message: '接続できません: connection refused' };
        return [...dav.keys()].filter((p) => parent(p) === args!.path && p !== '').map(rawOf);
      case 'dav_remove': dav.delete(args!.path); return null;
      case 'dav_cancel': return false;
      default: throw { code: 'unsupported', message: cmd };
    }
  };
  return { dav, calls, state, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: fake.invoke, convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

import App from './App.svelte';
import { places } from './lib/places.svelte';
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
  for (const p of [...places.list]) places.remove(p.id);
  settings.showHidden = false;
  settings.dirs = {};
  localStorage.clear();
  fake.calls.length = 0;
  fake.state.offline = false;
  fake.dav.clear();
  for (const [p, k] of [['docs', 'dir'], ['docs/in.txt', 'file'], ['a.txt', 'file']] as const) fake.dav.set(p, { kind: k, etag: `e-${p}` });
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

const called = (cmd: string): unknown[] => fake.calls.filter((c) => c[0] === cmd).map((c) => c[1]);
const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label);
  if (!b) throw new Error(`ボタンがありません: ${label}`);
  return b;
};
const type = (id: string, value: string): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (): void => {
  document.querySelector<HTMLFormElement>('.modal form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  flushSync();
};
const sideNames = (): string[] => [...target.querySelectorAll('.places .menu-item')].map((b) => b.textContent?.replace('!', '').trim() ?? '');

async function addPlace(name = '自宅', url = 'https://nas.example/dav'): Promise<void> {
  button('ネットワークの場所を追加').click();
  await settle();
  type('place-url', url);
  type('place-name', name);
  await settle();
  submit();
  await settle();
}

describe('ネットワークの場所（WebDAV）', () => {
  it('追加すると、左の一覧に出て、すぐ開く。一覧は Rust の dav_list から。場所の欄は URL（読むだけ）', async () => {
    app = mount(App, { target });
    await settle();
    await addPlace();
    expect(sideNames()).toEqual(['ホーム', '自宅']);
    expect(called('dav_list')).toEqual([{ base: 'https://nas.example/dav/', path: '' }]);
    expect(names()).toEqual(['docs', 'a.txt']);
    const addr = target.querySelector<HTMLInputElement>('input[aria-label="場所"]')!;
    expect(addr.value).toBe('https://nas.example/dav/');
    expect(addr.readOnly).toBe(true);
    // 覚えには名前と URL だけ
    expect(JSON.parse(localStorage.getItem('fixplor.places')!)).toEqual([{ id: places.list[0].id, name: '自宅', url: 'https://nas.example/dav/' }]);
  });

  it('正しくない URL は、理由を出して、覚えない', async () => {
    app = mount(App, { target });
    await settle();
    button('ネットワークの場所を追加').click();
    await settle();
    type('place-url', 'ftp://nas.example/');
    submit();
    await settle();
    expect(document.querySelector('.place-error')!.textContent).toContain('http://');
    expect(places.list).toEqual([]);
    expect(document.querySelector('.modal')).not.toBeNull();
  });

  it('次に開いたとき、覚えた場所が一覧に出る（開くまでは、つながない）', async () => {
    places.add('職場', 'https://work.example/webdav/');
    app = mount(App, { target });
    await settle();
    expect(sideNames()).toEqual(['ホーム', '職場']);
    expect(called('dav_list')).toEqual([]);
    button('職場').click();
    await settle();
    expect(called('dav_list')).toEqual([{ base: 'https://work.example/webdav/', path: '' }]);
  });

  it('フォルダを開く・この端末へ戻っても、それぞれ開いていた場所のまま', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    target.querySelector<HTMLElement>('.file-explorer-row')!.click();
    await settle();
    target.querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(names()).toEqual(['in.txt']);
    button('ホーム').click();
    await settle();
    expect(names()).toEqual(['local.txt']);
    button('自宅').click();
    await settle();
    expect(names()).toEqual(['in.txt']);
  });

  it('削除は、ゴミ箱ではなく完全な削除。件数つきで確認し（1 件でも）、答えるまで消さない', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    const row = [...target.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === 'a.txt')!.closest<HTMLElement>('.file-explorer-item')!;
    row.querySelector<HTMLElement>('.file-explorer-row, a, button')!.click();
    await settle();
    button('削除').click();
    await settle();
    const modal = document.querySelector('.modal')!;
    expect(modal.textContent).toContain('1 件を完全に削除しますか');
    expect(modal.textContent).toContain('完全に削除します。元に戻せません');
    expect(called('dav_remove')).toEqual([]);
    button('完全に削除').click();
    await settle();
    expect(called('dav_remove')).toEqual([{ base: 'https://nas.example/dav/', path: 'a.txt' }]);
    expect(called('fs_trash')).toEqual([]);
    expect(names()).toEqual(['docs']);
    const toast = document.querySelector('.toast')!;
    expect(toast.textContent).toContain('1 件を完全に削除しました');
    expect(toast.querySelector('.toast-action')).toBeNull();
  });

  it('つながらないときは、左の一覧に印と、理由・再読み込みを出す', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    fake.state.offline = true;
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    expect(target.querySelector('.place-broken')).not.toBeNull();
    expect(target.querySelector('.places .place-open')!.getAttribute('title')).toContain('connection refused');
    expect(target.querySelector('.file-explorer-error')!.textContent).toContain('接続できません');
    fake.state.offline = false;
    button('再読み込み').click();
    await settle();
    expect(names()).toEqual(['docs', 'a.txt']);
    expect(target.querySelector('.place-broken')).toBeNull();
  });

  it('直す: 名前と URL を変えると、新しい接続先で開き直す。外す: 確認のあと覚えを消すだけで、サーバーには何も送らない', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    button('「自宅」を直す').click();
    await settle();
    type('place-name', '実家');
    type('place-url', 'https://old.example/dav');
    submit();
    await settle();
    expect(sideNames()).toEqual(['ホーム', '実家']);
    expect(called('dav_list').at(-1)).toEqual({ base: 'https://old.example/dav/', path: '' });

    button('「実家」を直す').click();
    await settle();
    button('一覧から外す').click();
    await settle();
    expect(document.querySelector('.modal')!.textContent).toContain('サーバーのファイルは消えません');
    button('外す').click();
    await settle();
    expect(sideNames()).toEqual(['ホーム']);
    expect(places.list).toEqual([]);
    expect(names()).toEqual(['local.txt']);
    expect(called('dav_remove')).toEqual([]);
  });

  it('外すのを取り消せば、そのまま残る', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    app = mount(App, { target });
    await settle();
    button('「自宅」を直す').click();
    await settle();
    button('一覧から外す').click();
    await settle();
    button('キャンセル').click();
    await settle();
    expect(places.list).toHaveLength(1);
  });
});
