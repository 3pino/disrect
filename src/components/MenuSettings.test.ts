// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MenuSettings from './MenuSettings.svelte';
import { settings } from '../lib/settings.svelte';

let app: ReturnType<typeof mount> | undefined;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};
const toggle = (which: string, name: string): HTMLElement => document.querySelector<HTMLElement>(`.menu-settings-${which} [role="switch"][aria-label="${name}を出す"]`)!;

beforeEach(async () => {
  document.body.innerHTML = '';
  localStorage.clear();
  settings.menus = {};
  app = mount(MenuSettings, { target: document.body });
  await settle();
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
});

describe('設定の「右クリックのメニュー」', () => {
  it('項目の右クリックと空きの右クリックの 2 つ。初めは、全部を出す（トグルがオン）', () => {
    expect(document.querySelectorAll('[class*="menu-settings-entry"], [class*="menu-settings-space"]').length).toBeGreaterThan(0);
    expect(toggle('entry', 'コピー').getAttribute('aria-checked')).toBe('true');
    expect(toggle('space', '貼り付け').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.menu-settings-entry')!.textContent).toContain('プロパティ');
    expect(document.querySelector('.menu-settings-space')!.textContent).toContain('新しいファイル');
  });

  it('出す・出さないを切り替えると、保存される（もう一方のメニューは変えない）。既定に戻せる', async () => {
    toggle('entry', '切り取り').click();
    await settle();
    expect(settings.menus.entry?.hidden).toEqual(['cut']);
    expect(settings.menus.space).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('fixplor.menus')!).entry.hidden).toEqual(['cut']);
    expect(toggle('entry', '切り取り').getAttribute('aria-checked')).toBe('false');
    (document.querySelector('.menu-settings-entry .menu-settings-reset') as HTMLElement).click();
    await settle();
    expect(settings.menus).toEqual({});
    expect(toggle('entry', '切り取り').getAttribute('aria-checked')).toBe('true');
  });

  it('全部を出さないと、メニューが出ないと知らせる', async () => {
    for (const name of ['貼り付け', '新しいファイル', 'アップロード']) toggle('space', name).click();
    await settle();
    expect(document.querySelector('.menu-settings-space')!.textContent).toContain('メニューは出ません');
    expect(document.querySelector('.menu-settings-entry')!.textContent).not.toContain('メニューは出ません');
  });
});
