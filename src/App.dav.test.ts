// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// アプリ全体に、ネットワークの置き場所（WebDAV）を足して動かす。Rust の代わりの偽物の上で、
// この端末の置き場所（ホームだけ）と、追加した WebDAV（メモリの中の木）を同時に持つ。
const fake = vi.hoisted(() => {
  const dav = new Map<string, { kind: 'file' | 'dir'; etag: string }>();
  const calls: [string, unknown, Record<string, string> | undefined][] = [];
  const state = { offline: false, auth: false, credFail: false };
  const creds = new Map<string, { user: string; base: string }>();
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
      case 'dav_cred_info':
        if (state.credFail) throw { code: 'keychain', message: 'キーチェーンが使えません: 試験' };
        return creds.get(args!.place) ?? null;
      case 'dav_cred_set':
        if (state.credFail) throw { code: 'keychain', message: 'キーチェーンが使えません: 試験' };
        creds.set(args!.place, { user: args!.user, base: args!.base });
        return null;
      case 'dav_cred_clear': creds.delete(args!.place); return null;
      case 'dav_list':
        if (state.auth) throw { code: 'auth', message: 'サーバーが 401 を返しました' };
        if (state.offline) throw { code: 'offline', message: '接続できません: connection refused' };
        return [...dav.keys()].filter((p) => parent(p) === args!.path && p !== '').map(rawOf);
      case 'dav_remove': dav.delete(args!.path); return null;
      case 'dav_cancel': return false;
      default: throw { code: 'unsupported', message: cmd };
    }
  };
  return { dav, calls, state, creds, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: fake.invoke, convertFileSrc: (p: string, proto = 'asset') => `${proto}://localhost/${encodeURIComponent(p)}` }));
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
  fake.state.auth = false;
  fake.state.credFail = false;
  fake.creds.clear();
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
    expect(called('dav_list')).toEqual([{ place: places.list[0].id, base: 'https://nas.example/dav/', path: '' }]);
    expect(called('dav_cred_set')).toEqual([]);
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
    expect(called('dav_list')).toEqual([{ place: places.list[0].id, base: 'https://work.example/webdav/', path: '' }]);
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
    expect(called('dav_remove')).toEqual([{ place: places.list[0].id, base: 'https://nas.example/dav/', path: 'a.txt' }]);
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
    expect(called('dav_list').at(-1)).toEqual({ place: expect.any(String), base: 'https://old.example/dav/', path: '' });

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

describe('認証（Basic・OS のキーチェーン）', () => {
  const credSets = (): Record<string, unknown>[] => called('dav_cred_set') as Record<string, unknown>[];

  it('ユーザー名とパスワードを付けて追加すると、パスワードは Rust（キーチェーン）へだけ渡る。この端末の覚えには、名前と URL だけ', async () => {
    app = mount(App, { target });
    await settle();
    button('ネットワークの場所を追加').click();
    await settle();
    type('place-url', 'https://nas.example/dav');
    type('place-name', '自宅');
    type('place-user', 'taro');
    await settle();
    type('place-password', 's3cret');
    await settle();
    submit();
    await settle();
    expect(credSets()).toEqual([{ place: places.list[0].id, base: 'https://nas.example/dav/', user: 'taro', password: 's3cret' }]);
    expect(localStorage.getItem('fixplor.places')).not.toMatch(/s3cret|taro/);
    expect(JSON.stringify(Object.fromEntries(Object.entries(localStorage)))).not.toContain('s3cret');
    expect(sideNames()).toEqual(['ホーム', '自宅']);
    // 入力欄は伏せ字
    button('「自宅」を直す').click();
    await settle();
    expect(document.getElementById('place-password')).toBeNull();
  });

  it('ユーザー名があるのにパスワードが空なら、保存しない', async () => {
    app = mount(App, { target });
    await settle();
    button('ネットワークの場所を追加').click();
    await settle();
    type('place-url', 'https://nas.example/dav');
    type('place-user', 'taro');
    await settle();
    expect((document.getElementById('place-password') as HTMLInputElement).type).toBe('password');
    submit();
    await settle();
    expect(document.querySelector('.place-error')!.textContent).toContain('パスワード');
    expect(places.list).toEqual([]);
    expect(credSets()).toEqual([]);
  });

  it('キーチェーンが使えなければ、理由を出して保存しない（置き場所も覚えない。平文では残さない）', async () => {
    fake.state.credFail = true;
    app = mount(App, { target });
    await settle();
    button('ネットワークの場所を追加').click();
    await settle();
    type('place-url', 'https://nas.example/dav');
    type('place-user', 'taro');
    await settle();
    type('place-password', 'pw');
    await settle();
    submit();
    await settle();
    expect(document.querySelector('.place-error')!.textContent).toContain('キーチェーンが使えません');
    expect(places.list).toEqual([]);
    expect(localStorage.getItem('fixplor.places')).toBe('[]');
    expect(document.querySelector('.modal')).not.toBeNull();
  });

  it('直す: 保存済みならパスワードは見せず、「パスワードを変更」で入れ直す。変えなければ null（保管済みを使い続ける）', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    fake.creds.set(p.place.id, { user: 'taro', base: 'https://nas.example/dav/' });
    app = mount(App, { target });
    await settle();
    button('「自宅」を直す').click();
    await settle();
    expect((document.getElementById('place-user') as HTMLInputElement).value).toBe('taro');
    expect(document.getElementById('place-password')).toBeNull();
    expect(document.querySelector('.place-saved')!.textContent).toContain('保存済み');
    // 名前だけ変える → パスワードは触らない
    type('place-name', '実家');
    submit();
    await settle();
    expect(credSets().at(-1)).toMatchObject({ user: 'taro', password: null });
    // もう一度開いて「パスワードを変更」→ 新しい値を送る
    button('「実家」を直す').click();
    await settle();
    button('パスワードを変更').click();
    await settle();
    type('place-password', 'new-pass');
    await settle();
    submit();
    await settle();
    expect(credSets().at(-1)).toMatchObject({ user: 'taro', password: 'new-pass' });
  });

  it('接続先（URL）を変えるときは、保管したパスワードを引き継がず、入れ直しを求める', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    fake.creds.set(p.place.id, { user: 'taro', base: 'https://nas.example/dav/' });
    app = mount(App, { target });
    await settle();
    button('「自宅」を直す').click();
    await settle();
    type('place-url', 'https://other.example/dav/');
    await settle();
    expect(document.getElementById('place-password')).not.toBeNull();
    submit();
    await settle();
    expect(document.querySelector('.place-error')!.textContent).toContain('パスワード');
    expect(credSets()).toEqual([]);
  });

  it('ユーザー名を空にして保存すると、保管した認証情報を消す。外すときも消す', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    fake.creds.set(p.place.id, { user: 'taro', base: 'https://nas.example/dav/' });
    app = mount(App, { target });
    await settle();
    button('「自宅」を直す').click();
    await settle();
    type('place-user', '');
    submit();
    await settle();
    expect(called('dav_cred_clear')).toEqual([{ place: p.place.id }]);
    expect(fake.creds.size).toBe(0);

    fake.creds.set(p.place.id, { user: 'taro', base: 'https://nas.example/dav/' });
    button('「自宅」を直す').click();
    await settle();
    button('一覧から外す').click();
    await settle();
    button('外す').click();
    await settle();
    expect(called('dav_cred_clear')).toHaveLength(2);
    expect(fake.creds.size).toBe(0);
  });

  it('認証が通らない（401）と、案内を出す。「認証情報を入れ直す」でパスワード欄から始まり、保存すると開き直す', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    fake.creds.set(p.place.id, { user: 'taro', base: 'https://nas.example/dav/' });
    fake.state.auth = true;
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    const banner = document.querySelector('.auth-banner')!;
    expect(banner.textContent).toContain('認証できませんでした');
    expect(target.querySelector('.place-broken')).not.toBeNull();
    button('認証情報を入れ直す').click();
    await settle();
    const pw = document.getElementById('place-password') as HTMLInputElement;
    expect(pw).not.toBeNull();
    type('place-password', 'right');
    fake.state.auth = false;
    await settle();
    submit();
    await settle();
    expect(credSets().at(-1)).toMatchObject({ user: 'taro', password: 'right' });
    expect(document.querySelector('.auth-banner')).toBeNull();
    expect(names()).toEqual(['docs', 'a.txt']);
  });

  it('認証が要らない置き場所では、案内を出さない', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    expect(document.querySelector('.auth-banner')).toBeNull();
  });
});

describe('拡大表示（写真・PDF）', () => {
  it('ネットワークの場所の画像は、Rust の中継（fixdav）の URL で表示する。開くと拡大表示になり、Esc で閉じる', async () => {
    fake.dav.set('p.png', { kind: 'file', etag: 'e' });
    places.add('自宅', 'https://nas.example/dav/');
    app = mount(App, { target });
    await settle();
    button('自宅').click();
    await settle();
    // 開く
    const r = [...target.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === 'p.png')!.closest<HTMLElement>('.file-explorer-item')!;
    r.querySelector<HTMLElement>('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(called('dav_download')).toEqual([]);
    const view = document.querySelector('.lightbox')!;
    expect(view).not.toBeNull();
    const src = view.querySelector('img')!.getAttribute('src')!;
    expect(src).toMatch(/^fixdav:\/\/localhost\//);
    expect(decodeURIComponent(decodeURIComponent(src))).toContain('https://nas.example/dav/');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.lightbox')).toBeNull();
  });
});
