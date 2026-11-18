import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerSearch, matchesName } from './search.svelte';
import { SEARCH_MAX_HITS, type Entry, type ExplorerApi, type SearchOutcome, type SearchQuery } from '../types';
import { fakeApi, file } from '../test-support/fakes';

type Call = { query: SearchQuery; signal: AbortSignal; emit: (e: Entry[]) => void; done: (o: SearchOutcome) => void; fail: (e: unknown) => void };

/** 検索を、手で進められる偽物の置き場所にする */
function searchable(): { api: ExplorerApi; calls: Call[] } {
  const calls: Call[] = [];
  const api = fakeApi([]);
  api.search = (query, on) =>
    new Promise<SearchOutcome>((resolve, reject) => {
      const call: Call = { query, signal: on.signal, emit: on.hits, done: resolve, fail: reject };
      on.signal.addEventListener('abort', () => reject(Object.assign(new Error('中止'), { code: 'aborted' })));
      calls.push(call);
    });
  return { api, calls };
}

const make = (api: ExplorerApi) => new ExplorerSearch(api, (e) => (e instanceof Error ? e.message : String(e)), 100);
const tick = () => vi.advanceTimersByTimeAsync(100);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('名前の一致', () => {
  it('含んでいれば当たる。大文字小文字は区別しない。空（空白だけ）は全部当たる', () => {
    expect(matchesName('Report.PDF', 'port')).toBe(true);
    expect(matchesName('report.pdf', 'PDF')).toBe(true);
    expect(matchesName('写真 2024.png', ' 2024 ')).toBe(true);
    expect(matchesName('a.txt', 'b')).toBe(false);
    expect(matchesName('a.txt', '')).toBe(true);
    expect(matchesName('a.txt', '   ')).toBe(true);
  });
});

describe('ExplorerSearch', () => {
  it('サブフォルダの検索が無い置き場所では、available が偽。サブフォルダも、は効かない（絞り込みになる）', () => {
    const s = make(fakeApi([]));
    expect(s.available).toBe(false);
    s.open = true;
    s.text = 'a';
    s.recursive = true;
    expect(s.showingResults).toBe(false);
    expect(s.filtering).toBe(true);
  });

  it('絞り込み（サブフォルダを探さない）は、置き場所に頼まない。文字が無ければ絞り込まない', async () => {
    const { api, calls } = searchable();
    const s = make(api);
    s.open = true;
    expect(s.filtering).toBe(false);
    s.text = 'a';
    expect(s.filtering).toBe(true);
    s.refresh('');
    await tick();
    expect(calls).toHaveLength(0);
    expect(s.running).toBe(false);
  });

  it('サブフォルダも: 待ってから始め、見つかった順に溜め、終わったら結果（partial）を持つ', async () => {
    const { api, calls } = searchable();
    const s = make(api);
    s.open = true;
    s.recursive = true;
    s.text = ' cat ';
    s.refresh('docs');
    expect(s.running).toBe(true);
    expect(calls).toHaveLength(0);
    await tick();
    expect(calls[0].query).toEqual({ dir: 'docs', text: 'cat' });
    calls[0].emit([file('docs/a/cat.png')]);
    calls[0].emit([file('docs/cat.txt'), file('docs/b/cat2.txt')]);
    expect(s.hits.map((h) => h.path)).toEqual(['docs/a/cat.png', 'docs/cat.txt', 'docs/b/cat2.txt']);
    expect(s.running).toBe(true);
    expect(s.outcome).toBeNull();
    calls[0].done({ partial: 'scan' });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.running).toBe(false);
    expect(s.outcome).toEqual({ partial: 'scan' });
  });

  it('文字を打ち直すと、前の検索は中止して（結果も捨てて）、待ち直してから新しく始める。待つあいだの打ち直しは 1 回にまとまる', async () => {
    const { api, calls } = searchable();
    const s = make(api);
    s.open = true;
    s.recursive = true;
    s.text = 'a';
    s.refresh('');
    await tick();
    calls[0].emit([file('a1')]);
    s.text = 'ab';
    s.refresh('');
    expect(calls[0].signal.aborted).toBe(true);
    expect(s.hits).toEqual([]);
    s.text = 'abc';
    s.refresh('');
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].query.text).toBe('abc');
    // 中止した検索の、遅れて届いた結果は無視する
    calls[0].emit([file('late')]);
    calls[1].emit([file('abc1')]);
    expect(s.hits.map((h) => h.path)).toEqual(['abc1']);
  });

  it('失敗は文にして持つ（中止は失敗にしない）。文字を空にすると止めて、結果も消す', async () => {
    const { api, calls } = searchable();
    const s = make(api);
    s.open = true;
    s.recursive = true;
    s.text = 'a';
    s.refresh('');
    await tick();
    calls[0].fail(new Error('読めません'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.error).toBe('読めません');
    expect(s.running).toBe(false);
    s.refresh('');
    await tick();
    expect(s.error).toBeNull();
    s.text = '';
    s.refresh('');
    expect(calls[1].signal.aborted).toBe(true);
    expect(s.error).toBeNull();
    expect(s.running).toBe(false);
    expect(s.showingResults).toBe(false);
  });

  it(`画面の上限（${SEARCH_MAX_HITS} 件）で止める: 超えて並べず、検索を中止して、件数の上限で止めたと伝える`, async () => {
    const { api, calls } = searchable();
    const s = make(api);
    s.open = true;
    s.recursive = true;
    s.text = 'x';
    s.refresh('');
    await tick();
    calls[0].emit(Array.from({ length: SEARCH_MAX_HITS - 1 }, (_, i) => file(`f${i}`)));
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].emit([file('last'), file('over1'), file('over2')]);
    expect(s.hits).toHaveLength(SEARCH_MAX_HITS);
    expect(calls[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.outcome).toEqual({ partial: 'hits' });
    expect(s.running).toBe(false);
    expect(s.error).toBeNull();
  });

  it('閉じると、止めて、文字・結果を捨てる', async () => {
    const { api, calls } = searchable();
    const s = make(api);
    s.open = true;
    s.recursive = true;
    s.text = 'a';
    s.refresh('');
    await tick();
    calls[0].emit([file('a')]);
    s.close();
    expect(calls[0].signal.aborted).toBe(true);
    expect([s.open, s.text, s.hits, s.running, s.outcome]).toEqual([false, '', [], false, null]);
  });
});
