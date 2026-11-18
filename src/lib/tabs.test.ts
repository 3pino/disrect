import { describe, expect, it } from 'vitest';
import { MAX_TABS, cycleIndex, indexAfterClose, moveItem, parseSavedTabs, serializeTabs, tabLabel } from './tabs';

const all = (): boolean => true;

describe('タブの保存・復元', () => {
  it('保存して読むと、同じ（置き場所・フォルダ・見ているタブ）', () => {
    const s = { tabs: [{ place: 'local', dir: '/home/me' }, { place: 'p1', dir: 'docs/a' }], active: 1 };
    expect(parseSavedTabs(serializeTabs(s), all)).toEqual(s);
  });

  it('壊れた値・形の違う値は null（1 つのタブで始める）', () => {
    for (const raw of [null, '', '{', 'null', '5', '{}', '{"tabs":"x"}', '{"tabs":[]}', '{"tabs":[1,null,"x"]}', '{"tabs":[{"place":1,"dir":"x"}]}']) {
      expect(parseSavedTabs(raw, all), String(raw)).toBeNull();
    }
  });

  it('外した置き場所のタブは捨てる。見ていたタブが捨てられたら、先頭を見る。見ていたタブの位置は詰める', () => {
    const raw = serializeTabs({ tabs: [{ place: 'gone', dir: '' }, { place: 'local', dir: 'a' }, { place: 'p1', dir: 'b' }], active: 2 });
    expect(parseSavedTabs(raw, (p) => p !== 'gone')).toEqual({ tabs: [{ place: 'local', dir: 'a' }, { place: 'p1', dir: 'b' }], active: 1 });
    const lost = serializeTabs({ tabs: [{ place: 'gone', dir: '' }, { place: 'local', dir: 'a' }], active: 0 });
    expect(parseSavedTabs(lost, (p) => p !== 'gone')).toEqual({ tabs: [{ place: 'local', dir: 'a' }], active: 0 });
    expect(parseSavedTabs(serializeTabs({ tabs: [{ place: 'gone', dir: '' }], active: 0 }), (p) => p !== 'gone')).toBeNull();
  });

  it('見ているタブの位置が範囲の外なら、先頭。上限を超えた分は捨てる', () => {
    expect(parseSavedTabs('{"tabs":[{"place":"local","dir":""}],"active":9}', all)!.active).toBe(0);
    const many = { tabs: Array.from({ length: MAX_TABS + 5 }, (_, i) => ({ place: 'local', dir: String(i) })), active: 0 };
    expect(parseSavedTabs(serializeTabs(many), all)!.tabs).toHaveLength(MAX_TABS);
  });

  it('余計な欄は保存しない', () => {
    const s = serializeTabs({ tabs: [{ place: 'local', dir: 'a', extra: 1 } as never], active: 0 });
    expect(s).not.toContain('extra');
  });
});

describe('並べ替え・選び方・名前', () => {
  it('moveItem: 動かす。範囲の外・同じ位置は何もしない。元の配列は変えない', () => {
    const l = ['a', 'b', 'c', 'd'];
    expect(moveItem(l, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(l, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(l, 1, 1)).toEqual(l);
    expect(moveItem(l, -1, 2)).toEqual(l);
    expect(moveItem(l, 1, 9)).toEqual(l);
    expect(l).toEqual(['a', 'b', 'c', 'd']);
  });

  it('indexAfterClose: 見ているタブを閉じたら右隣（なければ左）。手前を閉じたら 1 つ詰める。後ろを閉じたら同じ', () => {
    // 4 つのうち
    expect(indexAfterClose(1, 4, 1)).toBe(1); // 真ん中を閉じる → 右隣（閉じたあとの 1）
    expect(indexAfterClose(3, 4, 3)).toBe(2); // 右端を閉じる → 左
    expect(indexAfterClose(0, 4, 2)).toBe(1); // 手前を閉じる → 見ているタブは 1 つ左へ
    expect(indexAfterClose(3, 4, 1)).toBe(1); // 後ろを閉じる → そのまま
    expect(indexAfterClose(0, 2, 0)).toBe(0);
  });

  it('cycleIndex: 端でつながる', () => {
    expect(cycleIndex(0, 3, 1)).toBe(1);
    expect(cycleIndex(2, 3, 1)).toBe(0);
    expect(cycleIndex(0, 3, -1)).toBe(2);
    expect(cycleIndex(0, 1, 1)).toBe(0);
  });

  it('tabLabel: フォルダの名前。いちばん上は置き場所の名前', () => {
    expect(tabLabel('自宅', '')).toBe('自宅');
    expect(tabLabel('自宅', 'docs')).toBe('docs');
    expect(tabLabel('コンピューター', '/home/me/写真')).toBe('写真');
    expect(tabLabel('PC', '/')).toBe('PC');
  });
});
