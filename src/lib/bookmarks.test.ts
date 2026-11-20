// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { bookmarks, parseBookmarks } from './bookmarks.svelte';

describe('parseBookmarks', () => {
  it('壊れた値・壊れた項目は捨て、同じ場所とフォルダの重なりは 1 つにする', () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks('{')).toEqual([]);
    expect(parseBookmarks('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([
      { id: '1', place: 'local', dir: 'home/me', name: 'ホーム' },
      { id: '2', place: 'local', dir: 'home/me', name: '重なり' },
      { id: '3', place: 'local', dir: 5, name: 'x' },
      { id: '4', place: 'local', dir: '', name: '' },
      { id: '5', place: 'p1', dir: '', name: 'NAS' },
    ]);
    expect(parseBookmarks(raw).map((b) => b.id)).toEqual(['1', '5']);
  });
});

describe('bookmarks', () => {
  beforeEach(() => {
    localStorage.clear();
    bookmarks.reload();
  });

  it('初めて開いたときだけ、最初の一覧を入れる。全部消しても、入れ直さない', () => {
    expect(bookmarks.fresh).toBe(true);
    bookmarks.seed([{ place: 'local', dir: 'home/me', name: 'ホーム' }, { place: 'local', dir: 'home/me/Downloads', name: 'ダウンロード' }]);
    expect(bookmarks.list.map((b) => b.name)).toEqual(['ホーム', 'ダウンロード']);
    for (const b of [...bookmarks.list]) bookmarks.remove(b.id);
    expect(bookmarks.list).toEqual([]);
    bookmarks.seed([{ place: 'local', dir: 'x', name: 'x' }]);
    expect(bookmarks.list).toEqual([]);
    // 保存に残り、読み直しても同じ
    bookmarks.reload();
    expect(bookmarks.fresh).toBe(false);
    expect(bookmarks.list).toEqual([]);
  });

  it('追加（同じ場所・フォルダは 1 つだけ）・探す・外す。置き場所を外すと、その場所のものも外れる', () => {
    bookmarks.add('local', 'a', 'A');
    bookmarks.add('local', 'a', 'A2');
    bookmarks.add('dav1', '', 'NAS');
    bookmarks.add('dav1', 'movies', 'movies');
    expect(bookmarks.list.map((b) => b.name)).toEqual(['A', 'NAS', 'movies']);
    expect(bookmarks.find('dav1', 'movies')?.name).toBe('movies');
    bookmarks.removePlace('dav1');
    expect(bookmarks.list.map((b) => b.name)).toEqual(['A']);
    bookmarks.remove(bookmarks.find('local', 'a')!.id);
    expect(bookmarks.list).toEqual([]);
  });
});
