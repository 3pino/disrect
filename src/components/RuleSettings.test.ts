// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RuleSettings from './RuleSettings.svelte';
import { settings } from '../lib/settings.svelte';
import { defaultRules } from '../lib/rules';

let app: ReturnType<typeof mount> | undefined;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};
const q = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const change = async (el: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};

beforeEach(async () => {
  document.body.innerHTML = '';
  localStorage.clear();
  settings.rules = [];
  app = mount(RuleSettings, { target: document.body });
  await settle();
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
});

describe('設定の「見た目のルール」', () => {
  it('ルールが無ければ、空と知らせる。「デフォルトに戻す」は、確認のあと、初めのルールにする（自分で足したルールは消える）', async () => {
    expect(document.body.textContent).toContain('ルールはありません');
    q('.rule-add').click();
    await settle();
    expect(settings.rules).toHaveLength(1);
    q('.rule-done').click();
    await settle();
    q('.rule-reset').click();
    await settle();
    expect(settings.rules).toHaveLength(1); // 確認が先
    q('.rule-reset-no').click();
    await settle();
    expect(document.querySelector('.rule-reset-yes')).toBeNull();
    q('.rule-reset').click();
    await settle();
    q('.rule-reset-yes').click();
    await settle();
    expect(settings.rules).toEqual(defaultRules());
    expect(JSON.parse(localStorage.getItem('fixplor.rules')!)).toEqual(defaultRules());
  });

  it('編集はダイアログ。条件の「調べるもの・比べ方・値」は、横に並ぶ（同じ行）。条件を足して直すと保存される', async () => {
    q('.rule-add').click();
    await settle();
    expect(document.querySelector('.modal[role="dialog"] .rule-editor')).not.toBeNull();
    expect(settings.rules[0].conditions).toEqual([{ field: 'kind', op: 'is', value: 'dir' }]);
    q('.rule-cond-add').click();
    await settle();
    expect(settings.rules[0].conditions[1]).toMatchObject({ field: 'basename', op: 'contains' });
    const row = q('[data-condition="1"]');
    expect([...row.children].slice(0, 3).map((c) => (c.matches('.rule-field') ? 'field' : c.matches('.rule-op') ? 'op' : c.matches('.rule-value') ? 'value' : '?'))).toEqual(['field', 'op', 'value']);
    await change(q<HTMLSelectElement>('[data-condition="1"] .rule-field'), 'stem');
    await change(q<HTMLSelectElement>('[data-condition="1"] .rule-op'), 'is');
    await change(q<HTMLInputElement>('[data-condition="1"] .rule-value'), 'desktop');
    expect(settings.rules[0].conditions[1]).toEqual({ field: 'stem', op: 'is', value: 'desktop' });
    q<HTMLInputElement>('[data-condition="1"] .rule-not input').click();
    await settle();
    expect(settings.rules[0].conditions[1].not).toBe(true);
  });

  it('見た目: アイコンは lucide 全部から絞り込んで選ぶ。色（色相・色の指定）。不透明度のバーは、いつも出る（使わないときは、使えない）', async () => {
    q('.rule-add').click();
    await settle();
    // 不透明度のバーは、切り替えがオフでも出ていて、使えない
    expect(q<HTMLInputElement>('.rule-opacity input[type="range"], input.rule-opacity').disabled).toBe(true);
    q('.rule-opacity-on').click();
    await settle();
    expect(settings.rules[0].look.opacity).toBe(0.6);
    expect(q<HTMLInputElement>('.rule-opacity input[type="range"], input.rule-opacity').disabled).toBe(false);
    q('.rule-opacity-on').click();
    await settle();
    expect(settings.rules[0].look.opacity).toBeUndefined();
    // アイコン: 絞り込む → 選ぶ
    const search = q<HTMLInputElement>('.icon-picker-search');
    search.value = 'monitor';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const names = [...document.querySelectorAll('.icon-picker-item')].map((b) => b.getAttribute('aria-label'));
    expect(names[0]).toBe('monitor');
    expect(names.every((n) => n!.includes('monitor'))).toBe(true);
    q('.icon-picker-item').click();
    await settle();
    expect(settings.rules[0].look.icon).toBe('monitor');
    expect(q('.icon-picker-current').textContent).toContain('monitor');
    q('.icon-picker-logo').click();
    await settle();
    expect(settings.rules[0].look.icon).toBe('logo');
    q('.icon-picker-default').click();
    await settle();
    expect(settings.rules[0].look.icon).toBeUndefined();
    // 色
    await change(q<HTMLSelectElement>('.rule-color-mode'), 'hue');
    expect(settings.rules[0].look).toEqual({ hue: 200 });
    await change(q<HTMLSelectElement>('.rule-color-mode'), 'color');
    expect(settings.rules[0].look).toEqual({ color: '#d9822b' });
    await change(q<HTMLSelectElement>('.rule-color-mode'), 'none');
    expect(settings.rules[0].look).toEqual({});
    expect(q('.rule-preview').textContent).toContain('名前');
  });

  it('種類にすると、比べ方は「と等しい」で動かせず、値はフォルダ・ファイルから選ぶ。条件を消せる。ルールを使わない・消せる', async () => {
    q('.rule-add').click();
    await settle();
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-field'), 'ext');
    expect(settings.rules[0].conditions[0]).toMatchObject({ field: 'ext', value: '' });
    expect(q<HTMLSelectElement>('[data-condition="0"] .rule-op').disabled).toBe(false);
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-field'), 'kind');
    expect(settings.rules[0].conditions[0]).toEqual({ field: 'kind', op: 'is', value: 'dir' });
    expect(q<HTMLSelectElement>('[data-condition="0"] .rule-op').disabled).toBe(true);
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-value'), 'file');
    expect(settings.rules[0].conditions[0].value).toBe('file');
    q('[data-condition="0"] .rule-cond-remove').click();
    await settle();
    expect(settings.rules[0].conditions).toEqual([]);
    q('.rule-done').click();
    await settle();
    expect(document.querySelector('.rule-editor')).toBeNull();
    expect(document.body.textContent).toContain('条件がないので、当たりません');
    q<HTMLElement>('.rules-sortable [role="switch"]').click();
    await settle();
    expect(settings.rules[0].enabled).toBe(false);
    q<HTMLElement>('.rule-edit').click();
    await settle();
    q('.rule-remove').click();
    await settle();
    expect(settings.rules).toEqual([]);
    expect(document.querySelector('.rule-editor')).toBeNull();
  });
});
