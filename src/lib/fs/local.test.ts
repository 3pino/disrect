import { describe, expect, it, vi } from 'vitest';
import { createLocalFs, openHref, pathOfOpenHref, toFsError, type Call } from './local';
import { FsError, type FsEntry } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => `asset://${p}` }));

const raw = (path: string, over: Partial<FsEntry> = {}): FsEntry => ({
  name: path.split(/[\\/]/).pop()!, path, kind: 'file', size: 3, modified: 5, hidden: false, readonly: false, symlink: false, ...over,
});

/** Rust の代わり。呼ばれたコマンドを覚え、cmd ごとの答えを返す */
function fake(answers: Record<string, unknown>, start = '/home/me') {
  const calls: unknown[][] = [];
  const call: Call = async (cmd, args, headers) => {
    calls.push(headers ? [cmd, args, headers] : [cmd, args]);
    if (cmd === 'fs_start_dir') return start as never;
    const a = answers[cmd];
    if (a instanceof Error || (typeof a === 'object' && a !== null && 'code' in a)) throw a;
    return a as never;
  };
  return { call, calls };
}

describe('この端末の置き場所（POSIX）', () => {
  it('画面のパスを OS のパスに直して呼び、答えを画面のパスに直す', async () => {
    const { call, calls } = fake({ fs_list: [raw('/home/me/a.txt'), raw('/home/me/sub', { kind: 'dir', size: null, modified: null })], fs_move: raw('/home/me/b.txt') });
    const fs = await createLocalFs({ call });
    expect([fs.windows, fs.start]).toEqual([false, 'home/me']);
    expect(await fs.api.list('home/me')).toEqual([
      { name: 'a.txt', path: 'home/me/a.txt', kind: 'file', size: 3, modified: 5, mime: null },
      { name: 'sub', path: 'home/me/sub', kind: 'dir', size: 0, modified: 0, mime: null },
    ]);
    expect((await fs.api.move('home/me/a.txt', 'home/me/b.txt')).path).toBe('home/me/b.txt');
    expect(calls.slice(1)).toEqual([
      ['fs_list', { path: '/home/me' }],
      ['fs_move', { from: '/home/me/a.txt', to: '/home/me/b.txt', overwrite: false }],
    ]);
  });

  it('隠しファイルは、出すと決めたときだけ一覧に入れる', async () => {
    let show = false;
    const { call } = fake({ fs_list: [raw('/a/.env', { hidden: true }), raw('/a/seen')] });
    const fs = await createLocalFs({ call, showHidden: () => show });
    expect((await fs.api.list('a')).map((e) => e.name)).toEqual(['seen']);
    show = true;
    expect((await fs.api.list('a')).map((e) => e.name)).toEqual(['.env', 'seen']);
  });

  it('書き込みは、中身を生のバイト列で、パスをヘッダーで送る', async () => {
    const { call, calls } = fake({ fs_write: raw('/a/メモ.txt') });
    const fs = await createLocalFs({ call });
    await fs.api.write('a/メモ.txt', 'hi');
    const [cmd, body, headers] = calls[1] as [string, Uint8Array, Record<string, string>];
    expect(cmd).toBe('fs_write');
    expect([...body]).toEqual([104, 105]);
    expect(decodeURIComponent(headers['x-path'])).toBe('/a/メモ.txt');
  });

  it('ゴミ箱は OS のもの。この部品からは戻せない', async () => {
    const { call, calls } = fake({ fs_trash: undefined });
    const fs = await createLocalFs({ call });
    expect((await fs.api.trash('a/x')).original_path).toBe('a/x');
    expect(calls[1]).toEqual(['fs_trash', { path: '/a/x' }]);
    await expect(fs.api.restore('')).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('失敗は code を保つ。無いフォルダは「無い」と見分ける', async () => {
    const { call } = fake({ fs_list: { code: 'not_found', message: '/nope' }, fs_mkdir: { code: 'exists', message: 'x' } });
    const fs = await createLocalFs({ call });
    const missing = await fs.api.list('nope').catch((e) => e);
    expect(missing).toBeInstanceOf(FsError);
    expect(fs.isMissing(missing)).toBe(true);
    const exists = await fs.api.mkdir('a').catch((e) => e);
    expect([exists.code, fs.isMissing(exists)]).toEqual(['exists', false]);
    expect(toFsError({ code: 'weird' }).code).toBe('io');
  });

  it('名前の決まり: POSIX では : などを使える。区切りと空は使えない', async () => {
    const fs = await createLocalFs({ call: fake({}).call });
    expect(fs.rules.nameError('', 'a:b?.txt')).toBeNull();
    expect(fs.rules.nameError('', 'a/b')).not.toBeNull();
    expect(fs.rules.nameError('', ' ')).not.toBeNull();
    expect(fs.rules.specialDir).toBeNull();
  });

  it('画像だけ、サムネイルの URL を持つ', async () => {
    const fs = await createLocalFs({ call: fake({}).call });
    const e = { name: 'a.png', path: 'p/a.png', kind: 'file' as const, size: 1, modified: 0, mime: null };
    expect(fs.urls.thumbUrl(e)).toBe('asset:///p/a.png');
    expect(fs.urls.thumbUrl({ ...e, name: 'a.txt' })).toBeNull();
    expect(pathOfOpenHref(fs.urls.href(e))).toBe('p/a.png');
  });
});

describe('この端末の置き場所（Windows）', () => {
  it('いちばん上はドライブの一覧。そこへは書けない', async () => {
    const { call, calls } = fake({ fs_places: [{ kind: 'home', path: 'C:\\Users\\me', name: '' }, { kind: 'volume', path: 'C:\\', name: 'C:' }, { kind: 'volume', path: 'D:\\', name: 'D:' }], fs_list: [raw('C:\\Users')] }, 'C:\\Users\\me');
    const fs = await createLocalFs({ call });
    expect([fs.windows, fs.start]).toEqual([true, 'C:/Users/me']);
    expect((await fs.api.list('')).map((e) => [e.name, e.path, e.kind])).toEqual([['C:', 'C:', 'dir'], ['D:', 'D:', 'dir']]);
    expect((await fs.api.list('C:')).map((e) => e.path)).toEqual(['C:/Users']);
    expect(calls.at(-1)).toEqual(['fs_list', { path: 'C:\\' }]);
    await expect(fs.api.mkdir('')).rejects.toMatchObject({ code: 'unsupported' });
    expect(fs.osPath('C:/Users/me')).toBe('C:\\Users\\me');
    expect(fs.rules.nameError('C:', 'a:b')).not.toBeNull();
  });
});

describe('既定のアプリで開くための URL', () => {
  it('パスを往復できる。ほかの URL は受けない', () => {
    expect(pathOfOpenHref(openHref('home/me/a b#1.txt'))).toBe('home/me/a b#1.txt');
    expect(pathOfOpenHref('https://example.com/')).toBeNull();
  });
});
