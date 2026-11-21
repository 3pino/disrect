// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RuleSettings from './RuleSettings.svelte';
import { settings } from '../lib/settings.svelte';
import { defaultRules } from '../lib/rules';
import { defineBrandIcons } from '@3pino/ui-kit-web/brandIcons';

// 共通の独自アイコン（ロゴ）は、アプリの起動時（main.ts）に定義する
defineBrandIcons();

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
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
  it('ルールが無ければ、空と知らせる。「デフォルトに戻す」は、ポップアップで確認してから、初めのルールにする', async () => {
    expect(document.body.textContent).toContain('ルールはありません');
    q('.rule-add').click();
    await settle();
    q('.rule-save').click();
    await settle();
    expect(settings.rules).toHaveLength(1);
    q('.rule-reset').click();
    await settle();
    expect(document.querySelector('.modal[role="dialog"][aria-label="デフォルトに戻す"]')).not.toBeNull(); // ポップアップ
    expect(settings.rules).toHaveLength(1); // 確認が先
    q('.rule-reset-no').click();
    await settle();
    expect(document.querySelector('.rule-reset-yes')).toBeNull();
    expect(settings.rules).toHaveLength(1);
    q('.rule-reset').click();
    await settle();
    q('.rule-reset-yes').click();
    await settle();
    expect(settings.rules).toEqual(defaultRules());
    expect(JSON.parse(localStorage.getItem('fixplor.rules')!)).toEqual(defaultRules());
  });

  it('編集は写しに対して行い、「保存」で反映する。「キャンセル」・Esc では捨てる。新しいルールは、保存するまで足されない', async () => {
    q('.rule-add').click();
    await settle();
    expect(document.querySelector('.modal[role="dialog"] .rule-editor')).not.toBeNull();
    expect(settings.rules).toEqual([]);
    q('.rule-cancel').click();
    await settle();
    expect(document.querySelector('.rule-editor')).toBeNull();
    expect(settings.rules).toEqual([]);
    // 足して保存
    q('.rule-add').click();
    await settle();
    await change(q<HTMLInputElement>('.rule-name'), 'メモ');
    expect(settings.rules).toEqual([]);
    q('.rule-save').click();
    await settle();
    expect(settings.rules).toHaveLength(1);
    expect(settings.rules[0]).toMatchObject({ name: 'メモ', conditions: [{ field: 'kind', op: 'is', value: 'dir' }], look: {} });
    expect(JSON.parse(localStorage.getItem('fixplor.rules')!)).toHaveLength(1);
    // 直してキャンセル: 変わらない
    q<HTMLElement>('.rule-edit').click();
    await settle();
    await change(q<HTMLInputElement>('.rule-name'), '別の名前');
    q('.rule-cancel').click();
    await settle();
    expect(settings.rules[0].name).toBe('メモ');
    // 直して Esc: 変わらない
    q<HTMLElement>('.rule-edit').click();
    await settle();
    await change(q<HTMLInputElement>('.rule-name'), '別の名前');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.rule-editor')).toBeNull();
    expect(settings.rules[0].name).toBe('メモ');
    // 新しいルールには「消す」が無く、既存のルールにはある
    q('.rule-add').click();
    await settle();
    expect(document.querySelector('.rule-remove')).toBeNull();
    q('.rule-cancel').click();
    await settle();
    q<HTMLElement>('.rule-edit').click();
    await settle();
    q('.rule-remove').click();
    await settle();
    expect(settings.rules).toEqual([]);
    expect(document.querySelector('.rule-editor')).toBeNull();
  });

  it('条件の「調べるもの・比べ方・値」は、横に並ぶ（同じ行）。条件を足して直して保存すると反映される。種類は「と等しい」で、値はフォルダ・ファイル', async () => {
    q('.rule-add').click();
    await settle();
    q('.rule-cond-add').click();
    await settle();
    const row = q('[data-condition="1"]');
    expect([...row.children].slice(0, 3).map((c) => (c.matches('.rule-field') ? 'field' : c.matches('.rule-op') ? 'op' : c.matches('.rule-value') ? 'value' : '?'))).toEqual(['field', 'op', 'value']);
    await change(q<HTMLSelectElement>('[data-condition="1"] .rule-field'), 'stem');
    await change(q<HTMLSelectElement>('[data-condition="1"] .rule-op'), 'is');
    await change(q<HTMLInputElement>('[data-condition="1"] .rule-value'), 'desktop');
    q<HTMLInputElement>('[data-condition="1"] .rule-not input').click();
    await settle();
    // 種類にすると、比べ方は動かせず、値はフォルダ・ファイルから選ぶ
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-field'), 'ext');
    expect(q<HTMLSelectElement>('[data-condition="0"] .rule-op').disabled).toBe(false);
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-field'), 'kind');
    expect(q<HTMLSelectElement>('[data-condition="0"] .rule-op').disabled).toBe(true);
    await change(q<HTMLSelectElement>('[data-condition="0"] .rule-value'), 'file');
    expect(settings.rules).toEqual([]);
    q('.rule-save').click();
    await settle();
    expect(settings.rules[0].conditions).toEqual([
      { field: 'kind', op: 'is', value: 'file' },
      { field: 'stem', op: 'is', value: 'desktop', not: true },
    ]);
    // 条件を消せる。ルールを使わない
    q<HTMLElement>('.rule-edit').click();
    await settle();
    q('[data-condition="0"] .rule-cond-remove').click();
    await settle();
    q('.rule-cond-remove').click();
    await settle();
    q('.rule-save').click();
    await settle();
    expect(settings.rules[0].conditions).toEqual([]);
    expect(document.body.textContent).toContain('条件がないので、当たりません');
    q<HTMLElement>('.rules-sortable [role="switch"]').click();
    await settle();
    expect(settings.rules[0].enabled).toBe(false);
  });

  it('見た目: 「設定する」のチェックと設定は横に並ぶ。アイコンは、押すと一覧が開き（初めは lucide の file）、別名・ロゴ（fixplor）でも探せる', async () => {
    q('.rule-add').click();
    await settle();
    // アイコン: 設定していなければ、押す部分も一覧も出ない
    expect(document.querySelector('.icon-picker-sample')).toBeNull();
    expect(document.querySelector('.icon-picker-search')).toBeNull();
    q<HTMLInputElement>('.icon-picker-on input').click();
    await settle();
    expect(q('.icon-picker-sample').textContent).toContain('file'); // 初めは file
    expect(document.querySelector('.icon-picker-search')).toBeNull(); // 押すまでは一覧を出さない
    expect(document.querySelector('.icon-picker-count')).toBeNull();
    q('.icon-picker-sample').click();
    await settle();
    const search = q<HTMLInputElement>('.icon-picker-search');
    const names = (): (string | null)[] => [...document.querySelectorAll('.icon-picker-item')].map((b) => b.getAttribute('aria-label'));
    search.value = 'music'; // eighth-notes の別名
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(names()).toContain('eighth-notes');
    search.value = 'fixplor'; // ロゴも、名前で探せる
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(names()[0]).toBe('fixplor-logo');
    q('.icon-picker-item').click();
    await settle();
    expect(document.querySelector('.icon-picker-search')).toBeNull(); // 選ぶと閉じる
    expect(q('.icon-picker-sample').textContent).toContain('fixplor-logo');
    q<HTMLInputElement>('.icon-picker-on input').click();
    await settle();
    expect(document.querySelector('.icon-picker-sample')).toBeNull();
    // 色・不透明度: チェックとバーは同じ行
    expect(q('.rule-line-color').contains(q('.rule-color-on'))).toBe(true);
    expect(q('.rule-line-color').contains(q('.rule-color-mode'))).toBe(true);
    expect(q('.rule-line-color').contains(q('.rule-hue'))).toBe(true);
    expect(q('.rule-line-opacity').contains(q('.rule-opacity-on'))).toBe(true);
    expect(q('.rule-line-opacity').contains(q('.rule-opacity'))).toBe(true);
    expect(q<HTMLSelectElement>('.rule-color-mode').disabled).toBe(true); // 設定していないときは、使えない（出してはおく）
    expect(q<HTMLInputElement>('.rule-opacity input[type="range"]').disabled).toBe(true);
    // 色: 初めは色相 0、色の指定は #777777
    q<HTMLInputElement>('.rule-color-on').click();
    await settle();
    expect(q<HTMLInputElement>('.rule-hue input[type="range"]').value).toBe('0');
    await change(q<HTMLSelectElement>('.rule-color-mode'), 'color');
    expect(q<HTMLInputElement>('input.rule-color').value).toBe('#777777');
    expect(q<HTMLInputElement>('input.rule-color').placeholder).toContain('#777777');
    q<HTMLInputElement>('.rule-opacity-on').click();
    await settle();
    expect(q<HTMLInputElement>('.rule-opacity input[type="range"]').disabled).toBe(false);
    q('.rule-save').click();
    await settle();
    expect(settings.rules[0].look).toEqual({ color: '#777777', opacity: 0.6 });
    // 設定を切ると、持たなくなる
    q<HTMLElement>('.rule-edit').click();
    await settle();
    q<HTMLInputElement>('.rule-color-on').click();
    q<HTMLInputElement>('.rule-opacity-on').click();
    await settle();
    q('.rule-save').click();
    await settle();
    expect(settings.rules[0].look).toEqual({});
  });
});
