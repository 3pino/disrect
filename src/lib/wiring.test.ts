// @vitest-environment jsdom
// 土台（@3pino/app-kit-web）とのつなぎ目: Rust が入れる名前・設定の保存・Alt+←・通知と確認の部品。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { injectedPlatform, isAndroid, osName } from '@3pino/app-kit-web/core/platform';
import Toasts from '@3pino/app-kit-web/shell/Toasts.svelte';
import ConfirmDialog from '@3pino/app-kit-web/shell/ConfirmDialog.svelte';
import { PLATFORM_GLOBAL } from './platformGlobal';
import { HostState, createHost } from './host.svelte';
import { settings } from './settings.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

const g = window as unknown as Record<string, unknown>;

describe('Rust が入れるデバイスの事実', () => {
  afterEach(() => {
    delete g[PLATFORM_GLOBAL];
  });

  it('名前は __FIXPLOR_PLATFORM__（src-tauri/src/platform.rs と同じ）。入っていればそれを使い、UA は見ない', () => {
    expect(PLATFORM_GLOBAL).toBe('__FIXPLOR_PLATFORM__');
    expect(injectedPlatform()).toBeNull();
    g[PLATFORM_GLOBAL] = { os: 'windows', desktop: true, android: false, capabilities: null };
    expect(injectedPlatform()).toMatchObject({ os: 'windows' });
    expect(osName()).toBe('windows');
    expect(isAndroid()).toBe(false);
    // 既定の名前（__APP_PLATFORM__）は読まない
    delete g[PLATFORM_GLOBAL];
    g.__APP_PLATFORM__ = { os: 'linux', desktop: true, android: false, capabilities: null };
    expect(injectedPlatform()).toBeNull();
    delete g.__APP_PLATFORM__;
  });

  it('共有の部品へ貸す platform は、土台の判定を使う', () => {
    g[PLATFORM_GLOBAL] = { os: 'linux', desktop: true, android: false, capabilities: null };
    const host = createHost(new HostState(), { open: async () => {} });
    expect(host.platform.osName()).toBe('linux');
  });

  it('文字のコピーは、クリップボードへ書く', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const host = createHost(new HostState(), { open: async () => {} });
    expect(await host.clipboard.copyText('abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });
});

describe('設定の保存（土台のストレージ・fixplor. の接頭辞）', () => {
  beforeEach(() => localStorage.clear());

  it('隠しファイルの設定とフォルダごとの表示は、fixplor.* に保存する', () => {
    settings.showHidden = true;
    settings.dirs = { a: 1 };
    expect(localStorage.getItem('fixplor.showHidden')).toBe('1');
    expect(JSON.parse(localStorage.getItem('fixplor.dirs')!)).toEqual({ a: 1 });
    settings.showHidden = false;
    expect(localStorage.getItem('fixplor.showHidden')).toBe('0');
  });
});

describe('通知と確認の部品（土台）は、本体の状態を映す', () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app) void unmount(app);
    app = undefined;
    document.body.innerHTML = '';
  });

  it('通知: 操作ボタンは、実行してから閉じる。閉じるボタンで消える', () => {
    const host = new HostState();
    app = mount(Toasts, { target: document.body, props: { get toasts() { return host.shell.toasts; }, dismiss: (id: number) => host.dismiss(id) } });
    const run = vi.fn();
    host.toast('消しました', 'info', { label: '取り消す', run });
    host.toast('失敗', 'error');
    flushSync();
    expect([...document.querySelectorAll('.toast-text')].map((e) => e.textContent)).toEqual(['消しました', '失敗']);
    expect(document.querySelectorAll('.toast-error')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.toast-action')!.click();
    flushSync();
    expect(run).toHaveBeenCalledOnce();
    expect(host.shell.toasts.map((t) => t.text)).toEqual(['失敗']);
    document.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click();
    flushSync();
    expect(host.shell.toasts).toEqual([]);
  });

  it('確認: OK は true・キャンセルは false で答える。danger は危険の色のボタン', async () => {
    const host = new HostState();
    app = mount(ConfirmDialog, { target: document.body, props: { get request() { return host.shell.confirmReq; } } });
    const ok = host.confirm({ title: '消しますか', body: '元に戻せません', okLabel: '削除', danger: true });
    flushSync();
    expect(document.querySelector('.modal')!.textContent).toContain('元に戻せません');
    expect([...document.querySelectorAll('.modal button')].map((b) => b.textContent?.trim())).toEqual(['キャンセル', '削除']);
    expect(document.querySelector('.confirm-dialog-ok')!.className).toMatch(/danger/);
    document.querySelector<HTMLButtonElement>('.confirm-dialog-ok')!.click();
    expect(await ok).toBe(true);
    flushSync();
    expect(document.querySelector('.modal')).toBeNull();

    const ng = host.confirm({ title: 'もう一度', okLabel: 'OK', ngLabel: 'やめる' });
    flushSync();
    expect(document.querySelector('.confirm-dialog-cancel')!.textContent).toContain('やめる');
    document.querySelector<HTMLButtonElement>('.confirm-dialog-cancel')!.click();
    expect(await ng).toBe(false);
  });
});
