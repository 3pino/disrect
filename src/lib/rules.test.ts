import { describe, expect, it } from 'vitest';
import type { Entry } from '@3pino/explorer-kit';
import { fieldValue, hueColor, lookOf, matchesCondition, matchesRule, newRule, parseRules, type AppearanceRule } from './rules';
import { entryStyleOf } from './ruleStyle';
import { iconOf, RULE_ICONS } from './ruleIcons';

const e = (name: string, kind: 'file' | 'dir' = 'file', path = `home/me/${name}`): Entry => ({ name, path, kind, size: 1, modified: 0, mime: null }) as Entry;
const rule = (id: string, conditions: AppearanceRule['conditions'], look: AppearanceRule['look'], enabled = true): AppearanceRule => ({ id, name: id, enabled, conditions, look });

describe('条件で比べる値', () => {
  it('名前・拡張子（ドットなし）・拡張子を除いた名前・種類・パス。.env は拡張子なし。フォルダは拡張子なし', () => {
    expect(['basename', 'stem', 'ext', 'kind', 'path'].map((f) => fieldValue(e('a.tar.gz'), f as never))).toEqual(['a.tar.gz', 'a.tar', 'gz', 'file', 'home/me/a.tar.gz']);
    expect([fieldValue(e('.env'), 'stem'), fieldValue(e('.env'), 'ext')]).toEqual(['.env', '']);
    expect([fieldValue(e('noext'), 'stem'), fieldValue(e('noext'), 'ext')]).toEqual(['noext', '']);
    expect([fieldValue(e('my.folder', 'dir'), 'stem'), fieldValue(e('my.folder', 'dir'), 'ext'), fieldValue(e('my.folder', 'dir'), 'kind')]).toEqual(['my.folder', '', 'dir']);
  });
});

describe('条件・ルール', () => {
  it('等しい・含む・始まる・終わる（大文字小文字は区別しない）・正規表現。「でない」で逆。壊れた正規表現は、いつも合わない', () => {
    const c = (op: never, value: string, not = false) => matchesCondition(e('Report-2024.PDF'), { field: 'basename', op, value, not });
    expect([c('is' as never, 'report-2024.pdf'), c('contains' as never, 'PORT'), c('startsWith' as never, 'rep'), c('endsWith' as never, '.pdf'), c('regex' as never, '^report-\\d+')]).toEqual([true, true, true, true, true]);
    expect([c('is' as never, 'x'), c('contains' as never, 'x'), c('contains' as never, 'x', true)]).toEqual([false, false, true]);
    expect([c('regex' as never, '(['), c('regex' as never, '([', true)]).toEqual([false, false]);
  });
  it('ルールは、条件のすべてに合うとき当たる（AND）。使っていない・条件が空は当たらない', () => {
    const r = rule('d', [{ field: 'kind', op: 'is', value: 'dir' }, { field: 'stem', op: 'is', value: 'desktop' }], { icon: 'monitor' });
    expect([matchesRule(e('Desktop', 'dir'), r), matchesRule(e('Desktop', 'file'), r), matchesRule(e('Documents', 'dir'), r)]).toEqual([true, false, false]);
    expect(matchesRule(e('Desktop', 'dir'), { ...r, enabled: false })).toBe(false);
    expect(matchesRule(e('Desktop', 'dir'), { ...r, conditions: [] })).toBe(false);
  });
});

describe('見た目を重ねる', () => {
  it('上のルールが優先。見た目の項目ごとに、最初に決まったものを使う。色は、色があれば色相より優先', () => {
    const rules = [
      rule('a', [{ field: 'ext', op: 'is', value: 'md' }], { icon: 'book', hue: 30 }),
      rule('b', [{ field: 'ext', op: 'is', value: 'md' }], { icon: 'star', color: 'red', opacity: 0.5 }),
      rule('c', [{ field: 'kind', op: 'is', value: 'file' }], { opacity: 0.9 }),
    ];
    expect(lookOf(e('x.md'), rules)).toEqual({ icon: 'book', hue: 30, opacity: 0.5 });
    expect(lookOf(e('x.txt'), rules)).toEqual({ opacity: 0.9 });
    expect(lookOf(e('x', 'dir'), rules)).toBeNull();
    expect(lookOf(e('x.md'), [rule('z', [{ field: 'ext', op: 'is', value: 'md' }], { color: 'red', hue: 10 })])).toEqual({ color: 'red' });
  });
  it('一覧に渡す見た目: アイコンは名前から、色相は色に。何も無ければ null。ゴミ箱の項目には与えない。ロゴは画像', () => {
    const rules = [rule('a', [{ field: 'stem', op: 'is', value: 'desktop' }], { icon: 'monitor', hue: 200, opacity: 0.8 }), rule('l', [{ field: 'stem', op: 'is', value: 'app' }], { icon: 'logo' }), rule('u', [{ field: 'stem', op: 'is', value: 'u' }], { icon: 'no-such-icon' })];
    const s = entryStyleOf(e('Desktop', 'dir'), rules)!;
    expect(s.icon).toBe(iconOf('monitor'));
    expect(s.color).toBe(hueColor(200));
    expect(s.opacity).toBe(0.8);
    expect(entryStyleOf(e('app', 'dir'), rules)!.icon).toEqual({ src: '/icon.svg' });
    expect(entryStyleOf(e('u'), rules)).toBeNull(); // 知らないアイコンだけ: 見た目は変えない
    expect(entryStyleOf(e('zzz'), rules)).toBeNull();
    expect(entryStyleOf({ ...e('Desktop', 'dir'), trash: { kind: 'root' } } as Entry, rules)).toBeNull();
    expect(entryStyleOf(e('Desktop', 'dir'), [])).toBeNull();
  });
  it('アイコンの名前は重ならない', () => {
    expect(new Set(RULE_ICONS.map((i) => i.name)).size).toBe(RULE_ICONS.length);
  });
});

describe('保存した値を読む', () => {
  it('壊れた項目・条件は捨て、値は範囲に収める。新しいルールは、フォルダの条件だけ', () => {
    expect(parseRules(null)).toEqual([]);
    expect(parseRules('{ broken')).toEqual([]);
    expect(parseRules('{}')).toEqual([]);
    const list = parseRules(JSON.stringify([
      { id: 'a', name: 'n', enabled: false, conditions: [{ field: 'ext', op: 'is', value: 'md' }, { field: 'zzz', op: 'is', value: '' }], look: { icon: 'star', hue: 999, opacity: 5, color: ' red ' } },
      { id: 1 },
      'x',
    ]));
    expect(list).toEqual([{ id: 'a', name: 'n', enabled: false, conditions: [{ field: 'ext', op: 'is', value: 'md' }], look: { icon: 'star', hue: 360, opacity: 1, color: 'red' } }]);
    expect(newRule('n1')).toMatchObject({ id: 'n1', enabled: true, conditions: [{ field: 'kind', op: 'is', value: 'dir' }], look: {} });
  });
});
