import { describe, expect, it } from 'vitest';
import { applyMenuLayout, ENTRY_MENU_ITEMS, menuOrder, parseMenuLayouts, reorderMenu, setMenuHidden, SPACE_MENU_ITEMS } from './menuLayout';

const D = ['a', 'b', 'c', 'd'];

describe('右クリックのメニューの並びと表示', () => {
  it('何も決めていなければ、既定の順で全部出す', () => {
    expect(applyMenuLayout(D)).toEqual(D);
    expect(applyMenuLayout(D, {})).toEqual(D);
  });
  it('決めた順が先で、ない項目は既定の順で後ろに続く。知らない ID は捨てる。出さないものは除く', () => {
    expect(menuOrder(D, { order: ['c', 'zzz', 'a', 'c'] })).toEqual(['c', 'a', 'b', 'd']);
    expect(applyMenuLayout(D, { order: ['c', 'a'], hidden: ['b'] })).toEqual(['c', 'a', 'd']);
    expect(applyMenuLayout(D, { hidden: D })).toEqual([]);
  });
  it('動かす: 動かしたあとの位置へ。出す・出さないは、並びと別に覚える', () => {
    expect(menuOrder(D, reorderMenu(D, undefined, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(menuOrder(D, reorderMenu(D, undefined, 'd', 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(menuOrder(D, reorderMenu(D, undefined, 'a', 99))).toEqual(['b', 'c', 'd', 'a']);
    const l = setMenuHidden(reorderMenu(D, undefined, 'a', 2), 'b', true);
    expect(l.hidden).toEqual(['b']);
    expect(applyMenuLayout(D, l)).toEqual(['c', 'a', 'd']);
    expect(setMenuHidden(l, 'b', false).hidden).toEqual([]);
  });
  it('保存した文字を読む。壊れていれば空', () => {
    expect(parseMenuLayouts(null)).toEqual({});
    expect(parseMenuLayouts('{ broken')).toEqual({});
    expect(parseMenuLayouts('{"entry":{"order":["x",1],"hidden":["y"]},"space":5}')).toEqual({ entry: { order: ['x'], hidden: ['y'] }, space: undefined });
  });
  it('項目の ID に重なりが無い', () => {
    for (const list of [ENTRY_MENU_ITEMS, SPACE_MENU_ITEMS]) expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
  });
});
