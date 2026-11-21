import { describe, expect, it } from 'vitest';
import { ExplorerNav } from './nav.svelte';
import type { DirIndexLike } from '../types';

const index = (): DirIndexLike => ({ ensure: () => {}, invalidate: () => {}, state: () => undefined }) as unknown as DirIndexLike;

describe('ExplorerNav（戻る・進む）', () => {
  it('戻ると、戻る前のフォルダへ、進める。別のフォルダを開くと、進む先は消える', () => {
    const nav = new ExplorerNav(index());
    nav.open('a');
    nav.open('a/b');
    nav.open('a/b/c');
    expect(nav.forward()).toBe(false);
    expect(nav.back()).toBe(true);
    expect(nav.back()).toBe(true);
    expect(nav.dir).toBe('a');
    expect(nav.future).toEqual(['a/b/c', 'a/b']);
    expect(nav.forward()).toBe(true);
    expect(nav.dir).toBe('a/b');
    expect(nav.history).toEqual(['', 'a']);
    expect(nav.forward()).toBe(true);
    expect(nav.dir).toBe('a/b/c');
    expect(nav.forward()).toBe(false);
    // 戻ってから別のフォルダへ行くと、進む先は無くなる
    nav.back();
    nav.open('x');
    expect(nav.future).toEqual([]);
    expect(nav.forward()).toBe(false);
  });

  it('同じフォルダを開き直しても、進む先は消えない。画面を開き直す・置き場所が変わったときは捨てる', () => {
    const nav = new ExplorerNav(index());
    nav.open('a');
    nav.back();
    nav.open('');
    expect(nav.future).toEqual(['a']);
    nav.forgetHistory();
    expect(nav.future).toEqual([]);
    nav.open('a');
    nav.back();
    nav.reset();
    expect(nav.future).toEqual([]);
    expect(nav.dir).toBe('');
  });

  it('再読み込みの回数を数える（フォルダのサイズの写しを捨てる合図）', () => {
    const nav = new ExplorerNav(index());
    nav.reload();
    nav.reload();
    expect(nav.reloads).toBe(2);
    // サイズを残す読み直し（隠しファイルの表示の切り替え）は、数えない
    nav.reload(true);
    expect(nav.reloads).toBe(2);
  });
});
