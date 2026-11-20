import { beforeEach, describe, expect, it } from 'vitest';
import { ExplorerBuffer } from './buffer.svelte';

const explorerBuffer = new ExplorerBuffer();

beforeEach(() => explorerBuffer.clear());

describe('アプリ内の切り取り・コピーのバッファ', () => {
  it('切り取りは、貼り付けたものを外し、残りがなければ空に戻す', () => {
    explorerBuffer.set('move', [
      { path: 'a.txt', kind: 'file' },
      { path: 'b.txt', kind: 'file' },
    ]);
    expect(explorerBuffer.isCut('a.txt')).toBe(true);
    explorerBuffer.remove(['a.txt']);
    expect(explorerBuffer.items.map((i) => i.path)).toEqual(['b.txt']);
    explorerBuffer.remove(['b.txt']);
    expect(explorerBuffer.empty).toBe(true);
    expect(explorerBuffer.mode).toBeNull();
  });

  it('コピーは切り取りの印を付けない（貼り付けても外さない）', () => {
    explorerBuffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    expect(explorerBuffer.isCut('a.txt')).toBe(false);
    expect(explorerBuffer.empty).toBe(false);
  });

  it('クリップボードの文字との照合は、改行（\\r\\n・末尾の改行）の違いを許す。複数の項目のパスがテキストとして貼られないように', () => {
    explorerBuffer.set('copy', [{ path: 'a/x.txt', kind: 'file' }, { path: 'a/y.txt', kind: 'file' }]);
    expect(explorerBuffer.matchesClip('a/x.txt\na/y.txt')).toBe(false); // まだ結び付けていない
    explorerBuffer.clipText = 'a/x.txt\na/y.txt';
    expect(explorerBuffer.matchesClip('a/x.txt\na/y.txt')).toBe(true);
    expect(explorerBuffer.matchesClip('a/x.txt\r\na/y.txt')).toBe(true);
    expect(explorerBuffer.matchesClip('a/x.txt\na/y.txt\n')).toBe(true);
    expect(explorerBuffer.matchesClip('a/x.txt')).toBe(false);
    expect(explorerBuffer.matchesClip(null)).toBe(false);
  });
});
