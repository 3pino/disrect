import { matchesName, SEARCH_MAX_HITS, type Entry, type SearchOutcome, type SearchQuery } from '@3pino/explorer-kit';
import { FsError } from './types';

// サーバー側の検索が一般には無い置き場所（WebDAV）のための、手元（クライアント側）の検索。
// フォルダを 1 つずつ読んで（浅いほうから）名前を見る。読む回数が多いほど遅く、サーバーに負担なので、上限をはっきり決める。
// 上限で止めたときは、黙って打ち切らず、理由（partial）を返す。

export type BoundedLimits = {
  /** 読むフォルダの数（1 つ読むごとに、サーバーへ 1 回聞く） */
  maxDirs: number;
  /** 下りる深さ（検索を始めたフォルダが 0） */
  maxDepth: number;
  /** 見つける件数 */
  maxHits: number;
  /** かける時間（ms） */
  maxMs: number;
};

export const BOUNDED_LIMITS: BoundedLimits = { maxDirs: 80, maxDepth: 8, maxHits: SEARCH_MAX_HITS, maxMs: 60_000 };

const aborted = (): FsError => new FsError('aborted', '中止しました');

/**
 * `list` で 1 フォルダずつ読んで、名前に text を含む項目を集める（大文字小文字は区別しない）。
 * 検索を始めたフォルダが読めなければ失敗（理由を見せる）。下のフォルダが読めなければ、飛ばして続ける。
 */
export async function boundedSearch(
  list: (dir: string) => Promise<Entry[]>,
  query: SearchQuery,
  on: { hits(entries: Entry[]): void; signal: AbortSignal },
  limits: BoundedLimits = BOUNDED_LIMITS,
  now: () => number = Date.now,
): Promise<SearchOutcome> {
  const text = query.text.trim();
  if (text === '') return { partial: null };
  const started = now();
  const queue: { dir: string; depth: number }[] = [{ dir: query.dir, depth: 0 }];
  let read = 0;
  let hits = 0;
  let skippedDepth = false;
  while (queue.length > 0) {
    if (on.signal.aborted) throw aborted();
    if (now() - started > limits.maxMs) return { partial: 'time' };
    if (read >= limits.maxDirs) return { partial: 'scan' };
    const { dir, depth } = queue.shift()!;
    read++;
    let entries: Entry[];
    try {
      entries = await list(dir);
    } catch (e) {
      if (on.signal.aborted) throw aborted();
      if (depth === 0) throw e;
      continue;
    }
    if (on.signal.aborted) throw aborted();
    const found = entries.filter((e) => matchesName(e.name, text));
    if (found.length > 0) {
      const room = limits.maxHits - hits;
      on.hits(found.slice(0, room));
      hits += Math.min(found.length, room);
      if (hits >= limits.maxHits) return { partial: 'hits' };
    }
    for (const e of entries) {
      if (e.kind !== 'dir') continue;
      if (depth >= limits.maxDepth) skippedDepth = true;
      else queue.push({ dir: e.path, depth: depth + 1 });
    }
  }
  return { partial: skippedDepth ? 'depth' : null };
}
