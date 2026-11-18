import { describe, expect, it } from 'vitest';
import type { Entry } from '@3pino/explorer-kit';
import { BOUNDED_LIMITS, boundedSearch } from './search';

const f = (path: string): Entry => ({ name: path.split('/').pop()!, path, kind: 'file', size: 1, modified: 0, mime: null });
const d = (path: string): Entry => ({ ...f(path), kind: 'dir', size: 0 });
const parent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** 木から、list を作る（読んだフォルダを覚える） */
function tree(all: Entry[]) {
  const reads: string[] = [];
  const list = async (dir: string): Promise<Entry[]> => {
    reads.push(dir);
    if (dir === 'forbidden') throw new Error('403');
    return all.filter((e) => parent(e.path) === dir);
  };
  return { list, reads };
}
const run = async (list: (dir: string) => Promise<Entry[]>, text: string, over: Partial<typeof BOUNDED_LIMITS> = {}, dir = '', signal = new AbortController().signal) => {
  const got: string[] = [];
  const outcome = await boundedSearch(list, { dir, text }, { hits: (e) => got.push(...e.map((x) => x.path)), signal }, { ...BOUNDED_LIMITS, ...over });
  return { got, outcome };
};

const TREE = [d('a'), d('a/b'), d('c'), f('x-cat.txt'), f('a/Cat.png'), f('a/b/cat2.md'), f('c/dog'), d('forbidden')];

describe('手元の検索（サーバーに検索が無い置き場所）', () => {
  it('浅いフォルダから順に読んで、名前に含む項目を見つける（大文字小文字は区別しない）。最後まで読めば partial なし', async () => {
    const { list, reads } = tree(TREE);
    const { got, outcome } = await run(list, 'CAT');
    expect(got).toEqual(['x-cat.txt', 'a/Cat.png', 'a/b/cat2.md']);
    expect(outcome).toEqual({ partial: null });
    expect(reads).toEqual(['', 'a', 'c', 'forbidden', 'a/b']);
  });

  it('始めたフォルダから下だけ。空の文字は何も読まない', async () => {
    const { list, reads } = tree(TREE);
    expect((await run(list, 'cat', {}, 'a')).got).toEqual(['a/Cat.png', 'a/b/cat2.md']);
    reads.length = 0;
    expect((await run(list, '  ')).outcome).toEqual({ partial: null });
    expect(reads).toEqual([]);
  });

  it('下のフォルダが読めなくても飛ばして続ける。始めたフォルダが読めなければ失敗', async () => {
    const { list } = tree(TREE);
    expect((await run(list, 'cat')).got).toHaveLength(3);
    await expect(run(list, 'cat', {}, 'forbidden')).rejects.toThrow('403');
  });

  it('上限: 読むフォルダの数（scan）・深さ（depth）・件数（hits）・時間（time）。それぞれ理由を返す', async () => {
    const { list, reads } = tree(TREE);
    expect((await run(list, 'cat', { maxDirs: 2 })).outcome).toEqual({ partial: 'scan' });
    expect(reads.length).toBe(2);
    expect((await run(tree(TREE).list, 'cat2', { maxDepth: 1 })).outcome).toEqual({ partial: 'depth' });
    expect((await run(tree(TREE).list, 'cat2', { maxDepth: 2 })).outcome).toEqual({ partial: null });
    const hit = await run(tree(TREE).list, 'cat', { maxHits: 2 });
    expect(hit.got).toHaveLength(2);
    expect(hit.outcome).toEqual({ partial: 'hits' });
    let t = 0;
    const { got, outcome } = await (async () => {
      const g: string[] = [];
      const o = await boundedSearch(tree(TREE).list, { dir: '', text: 'cat' }, { hits: (e) => g.push(...e.map((x) => x.path)), signal: new AbortController().signal }, { ...BOUNDED_LIMITS, maxMs: 10 }, () => (t += 6));
      return { got: g, outcome: o };
    })();
    expect(outcome).toEqual({ partial: 'time' });
    expect(got.length).toBeLessThan(3);
  });

  it('中止したら、すぐ止まる（読み終えたあとの結果も流さない）', async () => {
    const ac = new AbortController();
    const reads: string[] = [];
    const list = async (dir: string): Promise<Entry[]> => {
      reads.push(dir);
      ac.abort();
      return [f('cat')];
    };
    const got: string[] = [];
    const e = await boundedSearch(list, { dir: '', text: 'cat' }, { hits: (x) => got.push(...x.map((y) => y.path)), signal: ac.signal }).catch((x: unknown) => x);
    expect((e as { code: string }).code).toBe('aborted');
    expect(got).toEqual([]);
    expect(reads).toEqual(['']);
    const pre = new AbortController();
    pre.abort();
    await expect(run(tree(TREE).list, 'cat', {}, '', pre.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
});
