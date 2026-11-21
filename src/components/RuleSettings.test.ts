// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RuleSettings from './RuleSettings.svelte';
import { settings } from '../lib/settings.svelte';

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
  it('初めはルールが無い。「例を足す」で、例のルールが入る', async () => {
    expect(document.body.textContent).toContain('ルールはまだありません');
    q('.rule-examples').click();
    await settle();
    expect(settings.rules.map((r) => r.name)).toEqual(['Desktop', 'Downloads', 'Markdown', '隠しファイル']);
    expect(settings.rules[0]).toMatchObject({ enabled: true, look: { icon: 'monitor' } });
  });

  it('ルールを足して編集する: 条件（種類・名前など）と、見た目（アイコン・色相・不透明度）。保存される', async () => {
    q('.rule-add').click();
    await settle();
    expect(settings.rules).toHaveLength(1);
    expect(settings.rules[0].conditions).toEqual([{ field: 'kind', op: 'is', value: 'dir' }]);
    // 条件を足して、名前に Desktop と等しい（正規表現ではなく）
    q('.rule-cond-add').click();
    await settle();
    expect(settings.rules[0].conditions[1]).toMatchObject({ field: 'basename', op: 'contains' });
    await change(q<HTMLSelectElement>('[data-condition="1"] .rule-field'), 'stem');
    await change(q<HTMLSelectElement>('[data-condition="1"] .rule-op'), 'is');
    await change(q<HTMLInputElement>('[data-condition="1"] .rule-value'), 'desktop');
    expect(settings.rules[0].conditions[1]).toEqual({ field: 'stem', op: 'is', value: 'desktop' });
    // 「でない」
    q<HTMLInputElement>('[data-condition="1"] .rule-not input').click();
    await settle();
    expect(settings.rules[0].conditions[1].not).toBe(true);
    // 見た目
    await change(q<HTMLSelectElement>('.rule-icon'), 'monitor');
    await change(q<HTMLSelectElement>('.rule-color-mode'), 'hue');
    expect(settings.rules[0].look).toEqual({ icon: 'monitor', hue: 200 });
    q('.rule-opacity-on').click();
    await settle();
    expect(settings.rules[0].look.opacity).toBe(0.6);
    expect(q('.rule-preview').textContent).toContain('名前');
    // 色の決め方を替える・既定のまま
    await change(q<HTMLSelectElement>('.rule-color-mode'), 'color');
    expect(settings.rules[0].look).toMatchObject({ color: '#d9822b' });
    expect(settings.rules[0].look.hue).toBeUndefined();
    await change(q<HTMLSelectElement>('.rule-icon'), '');
    expect(settings.rules[0].look.icon).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('fixplor.rules')!)).toHaveLength(1);
  });

  it('種類にすると、比べ方は「と等しい」で、値はフォルダ・ファイルから選ぶ。条件を消せる。ルールを使わない・消せる', async () => {
    q('.rule-add').click();
    await settle();
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-field'), 'ext');
    expect(settings.rules[0].conditions[0]).toMatchObject({ field: 'ext', value: '' });
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-field'), 'kind');
    expect(settings.rules[0].conditions[0]).toEqual({ field: 'kind', op: 'is', value: 'dir' });
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-value'), 'file');
    expect(settings.rules[0].conditions[0].value).toBe('file');
    q('[data-condition="0"] .rule-cond-remove').click();
    await settle();
    expect(settings.rules[0].conditions).toEqual([]);
    expect(document.body.textContent).toContain('条件がないので、当たりません');
    // 使わない
    q<HTMLElement>('.rules-sortable [role="switch"]').click();
    await settle();
    expect(settings.rules[0].enabled).toBe(false);
    q('.rule-remove').click();
    await settle();
    expect(settings.rules).toEqual([]);
    expect(document.querySelector('.rule-editor')).toBeNull();
  });
});
