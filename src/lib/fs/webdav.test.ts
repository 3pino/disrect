import { describe, expect, it, vi } from 'vitest';
import { createDavFs, davUrl, type DavProgress } from './webdav';
import { FsError, type DavEntry } from './types';
import type { Call } from './call';

const BASE = 'https://h.example/dav/';

const raw = (name: string, over: Partial<DavEntry> = {}): DavEntry => ({
  name,
  path: name,
  kind: 'file',
  size: 3,
  modified: 1000,
  hidden: false,
  mime: 'text/plain',
  etag: `e-${name}`,
  ...over,
});

type Rec = { cmd: string; args: unknown; headers?: Record<string, string> };

/** Rust の代わり。呼ばれた順に記録し、reply で返事を決める */
function fake(reply: (cmd: string, args: unknown, headers?: Record<string, string>) => unknown = () => undefined) {
  const calls: Rec[] = [];
  const call: Call = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>) => {
    calls.push({ cmd, args, headers });
    const r = reply(cmd, args, headers);
    if (r instanceof Error) throw r;
    return r as T;
  };
  return { calls, call };
}

function make(reply?: Parameters<typeof fake>[0], extra: Partial<Parameters<typeof createDavFs>[0]> = {}) {
  const f = fake(reply);
  const fs = createDavFs({ base: BASE, call: f.call, onProgress: async () => () => {}, ...extra });
  return { ...f, fs };
}

describe('一覧', () => {
  it('Rust の項目を、画面の形に直す（種類・大きさ・更新日時・MIME）', async () => {
    const { fs } = make(() => [raw('a.txt'), raw('d', { kind: 'dir', size: null, modified: null, mime: null, etag: null })]);
    expect(await fs.api.list('docs')).toEqual([
      { name: 'a.txt', path: 'a.txt', kind: 'file', size: 3, modified: 1000, mime: 'text/plain' },
      { name: 'd', path: 'd', kind: 'dir', size: 0, modified: 0, mime: null },
    ]);
  });

  it('接続先とパスをそのまま Rust へ渡す。隠しファイルは、設定に従う', async () => {
    let show = false;
    const { fs, calls } = make(() => [raw('a'), raw('.h', { hidden: true })], { showHidden: () => show });
    expect((await fs.api.list('x/y')).map((e) => e.name)).toEqual(['a']);
    expect(calls[0]).toMatchObject({ cmd: 'dav_list', args: { base: BASE, path: 'x/y' } });
    show = true;
    expect((await fs.api.list('x/y')).map((e) => e.name)).toEqual(['a', '.h']);
  });

  it('Rust の失敗は FsError（code つき）になる。形の違うものは io', async () => {
    const { fs } = make(() => Object.assign(new Error('x'), { code: 'offline', message: '接続できません: x' }));
    await expect(fs.api.list('')).rejects.toMatchObject({ name: 'FsError', code: 'offline' });
    const odd = make(() => new Error('boom'));
    await expect(odd.fs.api.list('')).rejects.toMatchObject({ code: 'io' });
    const plain = make(() => {
      throw { code: 'auth', message: '認証' };
    });
    await expect(plain.fs.api.list('')).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('書き込み（黙って上書きしない）', () => {
  it('一覧に無かったパスへの書き込みは「作成」（If-Match を付けない）。中身はバイト列で、パスは符号化して送る', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_put' ? raw('新 規.txt', { path: '新 規.txt' }) : undefined));
    await fs.api.write('新 規.txt', 'abc');
    const put = calls.find((c) => c.cmd === 'dav_put')!;
    expect(put.args).toEqual(new TextEncoder().encode('abc'));
    expect(put.headers).toEqual({ 'x-base': encodeURIComponent(BASE), 'x-path': encodeURIComponent('新 規.txt') });
  });

  it('一覧で読んだ ETag があるパスへの書き込みは、その ETag を If-Match に付ける（上書き）', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_list' ? [raw('a.txt', { etag: '5-abc' })] : raw('a.txt', { etag: '6-def' })));
    await fs.api.list('');
    await fs.api.write('a.txt', new Blob(['hello']));
    expect(calls.find((c) => c.cmd === 'dav_put')!.headers).toMatchObject({ 'x-if-match': encodeURIComponent('5-abc') });
    // 書いた結果の ETag を覚える（続けて上書きできる）
    await fs.api.write('a.txt', 'again');
    expect(calls.filter((c) => c.cmd === 'dav_put')[1].headers).toMatchObject({ 'x-if-match': encodeURIComponent('6-def') });
  });

  it('ETag を返さないサーバーのファイルは、一覧のあとでも「作成」になる（上書きは通さない）', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_list' ? [raw('a.txt', { etag: null })] : raw('a.txt', { etag: null })));
    await fs.api.list('');
    await fs.api.write('a.txt', 'x');
    expect(calls.find((c) => c.cmd === 'dav_put')!.headers).not.toHaveProperty('x-if-match');
  });

  it('消した・移したパスの ETag は忘れる（同じ名前の新しいファイルを、古い ETag で上書きしない）', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_list' ? [raw('a.txt'), raw('dir/b.txt', { path: 'dir/b.txt' })] : cmd === 'dav_move' ? raw('c.txt') : raw('x')));
    await fs.api.list('');
    await fs.api.move('a.txt', 'c.txt');
    await fs.api.remove!('dir');
    await fs.api.write('a.txt', '1');
    await fs.api.write('dir/b.txt', '2');
    const puts = calls.filter((c) => c.cmd === 'dav_put');
    expect(puts[0].headers).not.toHaveProperty('x-if-match');
    expect(puts[1].headers).not.toHaveProperty('x-if-match');
  });

  it('読んだあとに相手が変わっていた（precondition）は、そのまま失敗として返る', async () => {
    const { fs } = make((cmd) => (cmd === 'dav_put' ? Object.assign(new Error('412'), { code: 'precondition' }) : undefined));
    await expect(fs.api.write('a', 'x')).rejects.toMatchObject({ code: 'precondition' });
  });
});

describe('操作', () => {
  it('作成・移動・コピーは Rust の dav_* に、overwrite を明示して渡す（既定は false）', async () => {
    const { fs, calls } = make(() => raw('x'));
    await fs.api.mkdir('d');
    await fs.api.move('a', 'b');
    await fs.api.move('a', 'b', true);
    await fs.api.copy('a', 'b');
    await fs.api.copy('a', 'b', true);
    expect(calls.map((c) => [c.cmd, c.args])).toEqual([
      ['dav_mkdir', { base: BASE, path: 'd' }],
      ['dav_move', { base: BASE, from: 'a', to: 'b', overwrite: false }],
      ['dav_move', { base: BASE, from: 'a', to: 'b', overwrite: true }],
      ['dav_copy', { base: BASE, from: 'a', to: 'b', overwrite: false }],
      ['dav_copy', { base: BASE, from: 'a', to: 'b', overwrite: true }],
    ]);
  });

  it('削除は完全な削除（dav_remove）。ゴミ箱の口は使えない', async () => {
    const { fs, calls } = make();
    await fs.api.remove!('a');
    expect(calls[0]).toMatchObject({ cmd: 'dav_remove', args: { base: BASE, path: 'a' } });
    for (const f of [() => fs.api.trash('a'), () => fs.api.restore('x'), () => fs.api.purge('x')]) {
      await expect(f()).rejects.toMatchObject({ code: 'unsupported' });
    }
    expect(calls).toHaveLength(1);
  });

  it('大きさ: 数え終わった値を返す。途中で打ち切られたら、全体の値として見せず失敗にする', async () => {
    const ok = make(() => ({ size: 10, files: 2, dirs: 1, partial: false }));
    expect(await ok.fs.api.size('d')).toEqual({ size: 10, files: 2, dirs: 1 });
    const part = make(() => ({ size: 10, files: 2, dirs: 1, partial: true }));
    await expect(part.fs.api.size('d')).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('送る（進み具合・中止）', () => {
  function withProgress() {
    let handler: ((p: DavProgress) => void) | null = null;
    let stopped = 0;
    return {
      onProgress: async (h: (p: DavProgress) => void) => {
        handler = h;
        return () => void stopped++;
      },
      emit: (p: DavProgress) => handler?.(p),
      stopped: () => stopped,
    };
  }

  it('自分の job の進みだけを割合にして知らせ、終わったら受け取りをやめる', async () => {
    const pr = withProgress();
    let job = '';
    const { fs } = make((cmd, _a, h) => {
      if (cmd !== 'dav_put') return undefined;
      job = decodeURIComponent(h!['x-job']);
      pr.emit({ job: 'someone-else', done: 99, total: 100 });
      pr.emit({ job, done: 25, total: 100 });
      pr.emit({ job, done: 100, total: 100 });
      return raw('f.bin');
    }, { onProgress: pr.onProgress });
    const seen: number[] = [];
    await fs.api.upload('f.bin', new Blob(['x']), (r) => seen.push(r)).promise;
    expect(seen).toEqual([0.25, 1]);
    expect(pr.stopped()).toBe(1);
  });

  it('失敗しても、進みの受け取りはやめる', async () => {
    const pr = withProgress();
    const { fs } = make(() => Object.assign(new Error('x'), { code: 'offline' }), { onProgress: pr.onProgress });
    await expect(fs.api.upload('a', new Blob(['x'])).promise).rejects.toMatchObject({ code: 'offline' });
    expect(pr.stopped()).toBe(1);
  });

  it('abort は、送っている job を中止する（dav_cancel）', async () => {
    let release: (v: DavEntry) => void = () => {};
    const { fs, calls } = make((cmd) => (cmd === 'dav_put' ? new Promise((r) => (release = r)) : true));
    const h = fs.api.upload('a', new Blob(['x']));
    await vi.waitFor(() => expect(calls.some((c) => c.cmd === 'dav_put')).toBe(true));
    h.abort();
    const put = calls.find((c) => c.cmd === 'dav_put')!;
    const cancel = calls.find((c) => c.cmd === 'dav_cancel')!;
    expect((cancel.args as { job: string }).job).toBe(decodeURIComponent(put.headers!['x-job']));
    release(raw('a'));
    await h.promise;
  });

  it('送り始める前に中止したら、送らない', async () => {
    const { fs, calls } = make(() => raw('a'));
    const h = fs.api.upload('a', new Blob(['x']));
    h.abort();
    await expect(h.promise).rejects.toMatchObject({ code: 'aborted' });
    expect(calls.some((c) => c.cmd === 'dav_put')).toBe(false);
  });
});

describe('見る・開く', () => {
  it('画像は、接続先の URL（段ごとに符号化）を直接渡す。画像でないものの縮小版は無い', () => {
    const { fs } = make();
    const img = { name: 'p q.png', path: 'a b/p q.png', kind: 'file' as const, size: 1, modified: 0, mime: 'image/png' };
    expect(fs.urls.thumbUrl(img)).toBe('https://h.example/dav/a%20b/p%20q.png');
    expect(fs.urls.readUrl(img)).toBe('https://h.example/dav/a%20b/p%20q.png');
    expect(fs.urls.thumbUrl({ ...img, name: 'a.txt', path: 'a.txt', mime: 'text/plain' })).toBeNull();
    expect(fs.urls.thumbUrl({ ...img, kind: 'dir' })).toBeNull();
    expect(fs.urls.pdfSource(img)).toBeNull();
  });

  it('davUrl は、接続先の末尾の / の有無に依らず、日本語・記号も符号化する', () => {
    expect(davUrl('https://h/dav', '日本/a#b')).toBe('https://h/dav/%E6%97%A5%E6%9C%AC/a%23b');
    expect(davUrl('https://h/dav/', '')).toBe('https://h/dav/');
  });

  it('開く: 一時のフォルダへ受け取ってから、その場所を既定のアプリで開く', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_download' ? '/tmp/fixplor-dav/x/a.pdf' : undefined));
    await fs.open('docs/a.pdf');
    expect(calls[0]).toMatchObject({ cmd: 'dav_download', args: { base: BASE, path: 'docs/a.pdf' } });
    expect(calls[1]).toMatchObject({ cmd: 'fs_open', args: { path: '/tmp/fixplor-dav/x/a.pdf' } });
  });

  it('名前の決まり: 空・/ を含む名前は使えない。特別なフォルダは無い', () => {
    const { fs } = make();
    expect(fs.rules.specialDir).toBeNull();
    expect(fs.rules.nameError('', '')).not.toBeNull();
    expect(fs.rules.nameError('', 'a/b')).not.toBeNull();
    expect(fs.rules.nameError('', 'ok.txt')).toBeNull();
  });

  it('「無い」の判定は not_found・not_dir だけ', () => {
    const { fs } = make();
    expect(fs.isMissing(new FsError('not_found', ''))).toBe(true);
    expect(fs.isMissing(new FsError('offline', ''))).toBe(false);
    expect(fs.isMissing(new Error('x'))).toBe(false);
  });
});
