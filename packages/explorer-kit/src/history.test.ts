import { describe, expect, it } from 'vitest';
import { copyEntry, createEntry, ExplorerHistory, moveEntry, trashEntry } from './history';

/** 呼ばれた操作を記録する、偽の置き場所 */
function fakeApi(opts: { failMove?: (from: string, to: string) => boolean } = {}) {
  const log: string[] = [];
  let id = 0;
  return {
    log,
    async move(from: string, to: string) {
      if (opts.failMove?.(from, to)) throw new Error('同じ名前があります');
      log.push(`move ${from} -> ${to}`);
      return {} as never;
    },
    async copy(from: string, to: string) {
      log.push(`copy ${from} -> ${to}`);
      return {} as never;
    },
    async trash(path: string) {
      log.push(`trash ${path}`);
      return { id: `t${++id}`, original_path: path, kind: 'file', size: 0, deleted_at: 0 } as never;
    },
    async restore(tid: string) {
      log.push(`restore ${tid}`);
      return {} as never;
    },
  };
}

describe('ExplorerHistory', () => {
  it('積んだ順に、元に戻す・やり直す。新しい操作を積むと、やり直しは消える', async () => {
    const h = new ExplorerHistory();
    const api = fakeApi();
    h.push(moveEntry(api, [{ from: 'a', to: 'b' }]));
    h.push(moveEntry(api, [{ from: 'c', to: 'd' }]));
    expect(h.undoLabel).toBe('名前の変更: c');
    expect(await h.undo()).toBe('名前の変更: c');
    expect(await h.undo()).toBe('名前の変更: a');
    expect(await h.undo()).toBeNull();
    expect(api.log).toEqual(['move d -> c', 'move b -> a']);
    expect(h.canRedo).toBe(true);
    expect(await h.redo()).toBe('名前の変更: a');
    expect(api.log.at(-1)).toBe('move a -> b');
    h.push(moveEntry(api, [{ from: 'x/e', to: 'y/e' }]));
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('移動: e');
  });

  it('失敗したら、その操作は履歴に残したまま、理由を投げる', async () => {
    const h = new ExplorerHistory();
    const api = fakeApi({ failMove: (from) => from === 'b' });
    h.push(moveEntry(api, [{ from: 'a', to: 'b' }]));
    await expect(h.undo()).rejects.toThrow('同じ名前があります');
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('上限（100 件）を超えたら、古いものから捨てる', async () => {
    const h = new ExplorerHistory();
    const api = fakeApi();
    for (let i = 0; i < 105; i++) h.push(moveEntry(api, [{ from: `a${i}`, to: `b${i}` }]));
    let n = 0;
    while (await h.undo()) n++;
    expect(n).toBe(100);
  });
});

describe('操作ごとの履歴', () => {
  it('複数の移動は、逆の順に戻し、元の順にやり直す。1 件失敗しても、残りは続ける', async () => {
    const api = fakeApi({ failMove: (from) => from === 'b1' });
    const e = moveEntry(api, [
      { from: 'a1', to: 'b1' },
      { from: 'a2', to: 'b2' },
    ]);
    expect(e.label).toBe('移動: 2 件');
    await expect(e.undo()).rejects.toThrow('同じ名前があります');
    expect(api.log).toEqual(['move b2 -> a2']);
    await e.redo();
    expect(api.log.slice(1)).toEqual(['move a1 -> b1', 'move a2 -> b2']);
  });

  it('コピーは、元に戻すとコピーをゴミ箱へ入れ、やり直しは、入れたコピーを戻す', async () => {
    const api = fakeApi();
    const e = copyEntry(api, [{ from: 'a.txt', to: 'b/a.txt' }]);
    expect(e.label).toBe('ペースト: a.txt');
    await e.undo();
    await e.redo();
    expect(api.log).toEqual(['trash b/a.txt', 'restore t1']);
    // 続けて元に戻すと、もう一度ゴミ箱へ
    await e.undo();
    expect(api.log.at(-1)).toBe('trash b/a.txt');
  });

  it('ゴミ箱へ移したものは、元に戻すと戻す。やり直すと、もう一度ゴミ箱へ入れる（番号は新しくなる）', async () => {
    const api = fakeApi();
    const e = trashEntry(api, [{ path: 'a.txt', id: 'old' }]);
    expect(e.label).toBe('ゴミ箱へ移動: a.txt');
    await e.undo();
    await e.redo();
    await e.undo();
    expect(api.log).toEqual(['restore old', 'trash a.txt', 'restore t1']);
  });

  it('新しいファイルは、元に戻すとゴミ箱へ入れ、やり直すと戻す', async () => {
    const api = fakeApi();
    const e = createEntry(api, 'docs/new.txt', 'file');
    expect(e.label).toBe('新しいファイル: new.txt');
    await expect(e.redo()).rejects.toThrow();
    await e.undo();
    await e.redo();
    expect(api.log).toEqual(['trash docs/new.txt', 'restore t1']);
    expect(createEntry(api, 'd/x', 'dir').label).toBe('新しいフォルダ: x');
  });

  it('変わったパスは、知らせる', async () => {
    const api = fakeApi();
    const changed: string[] = [];
    const e = moveEntry(api, [{ from: 'a', to: 'b' }], (p) => changed.push(p));
    await e.undo();
    expect(changed).toEqual(['b', 'a']);
  });
});
