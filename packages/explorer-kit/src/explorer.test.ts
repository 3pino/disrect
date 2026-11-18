import { describe, expect, it } from 'vitest';
import { createExplorer, ExplorerBuffer, type ExplorerOptions } from './index';
import { PLAIN_RULES, dir, fakeApi, fakeHost, fakeUrls, file } from './test-support/fakes';

// createExplorer の組み立て（共有できるもの・置き場所が変わったときの片付け）

function make(over: Partial<ExplorerOptions> = {}) {
  return createExplorer({
    api: fakeApi([dir('docs'), file('a.txt')]),
    urls: fakeUrls,
    rules: PLAIN_RULES,
    host: fakeHost(),
    labels: { root: 'いちばん上', upload: '取り込む' },
    viewStore: { read: () => ({}), write: () => {} },
    ...over,
  });
}

describe('切り取り・コピーのバッファ', () => {
  it('渡さなければ、エクスプローラーごとに別（ほかへ貼り付けられない）', () => {
    const a = make();
    const b = make();
    a.buffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    expect(b.buffer.empty).toBe(true);
    expect(a.buffer).not.toBe(b.buffer);
  });

  it('同じものを渡すと共有する（同じ置き場所のタブ同士で、コピーしたものを貼り付けられる）', () => {
    const shared = new ExplorerBuffer();
    const a = make({ buffer: shared });
    const b = make({ buffer: shared });
    a.buffer.set('move', [{ path: 'a.txt', kind: 'file' }]);
    expect(b.buffer.mode).toBe('move');
    expect(b.buffer.items.map((i) => i.path)).toEqual(['a.txt']);
    expect(b.buffer.isCut('a.txt')).toBe(true);
    b.buffer.remove(['a.txt']);
    expect(a.buffer.empty).toBe(true);
  });

  it('置き場所が変わったら、渡されたバッファも空にする', () => {
    let cb: () => void = () => {};
    const shared = new ExplorerBuffer();
    const e = make({ buffer: shared, scope: { key: () => 'x', onChange: (f) => ((cb = f), () => {}) } });
    shared.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    e.nav.open('docs');
    cb();
    expect(shared.empty).toBe(true);
    expect(e.nav.dir).toBe('');
  });
});
