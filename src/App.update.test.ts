// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// アプリの更新: 外枠の「fixplor vX」の行・新しい版のトースト・「バージョン情報」。土台の Updater は本物、仕組み（Tauri）の口だけ偽物。
const h = vi.hoisted(() => {
  type Ev = { event: 'Started'; data: { contentLength: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' };
  const state = {
    log: [] as string[],
    update: null as null | { version: string; body: string },
    checkError: null as string | null,
    holdDownload: null as null | (() => void),
  };
  const backend = {
    kind: () => 'desktop' as const,
    version: async () => '0.1.0',
    checkDesktop: async () => {
      state.log.push('check');
      if (state.checkError) throw new Error(state.checkError);
      const u = state.update;
      if (!u) return null;
      return {
        version: u.version,
        body: u.body,
        downloadAndInstall: async (on: (ev: Ev) => void) => {
          state.log.push('download');
          on({ event: 'Started', data: { contentLength: 100 } });
          on({ event: 'Progress', data: { chunkLength: 40 } });
          if (state.holdDownload) await new Promise<void>((r) => (state.holdDownload = r));
          on({ event: 'Progress', data: { chunkLength: 60 } });
          on({ event: 'Finished' });
        },
        close: async () => {},
      };
    },
    relaunch: async () => void state.log.push('relaunch'),
    fetchLatestAndroid: async () => {
      throw new Error('x');
    },
    canInstallAndroid: async () => false,
    openInstallSettings: async () => {},
    downloadAndInstallAndroid: async () => {},
    openReleasePage: async () => void state.log.push('release-page'),
  };
  return { state, backend };
});
vi.mock('./lib/stores/updater.svelte', async () => {
  const { Updater } = await import('@3pino/app-kit-web/updater');
  return { updater: new Updater(h.backend, true), RELEASES_URL: 'https://example.invalid/releases/latest' };
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => {
    switch (cmd) {
      case 'fs_start_dir': return '/home/me';
      case 'fs_places': return [{ kind: 'home', path: '/home/me', name: '' }];
      case 'fs_list': return [];
      default: throw { code: 'unsupported', message: cmd };
    }
  },
  convertFileSrc: (p: string) => p,
}));

import App from './App.svelte';
import { updater } from './lib/stores/updater.svelte';
import { CHECKED_AT_KEY, NOTIFIED_KEY } from './lib/updateWatch';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};
let app: ReturnType<typeof mount> | undefined;
let target: HTMLElement;
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label);
  if (!b) throw new Error(`ボタンがありません: ${label}`);
  return b;
};
const aboutRow = (): HTMLElement => target.querySelector<HTMLElement>('.about-row')!;
const dot = (): Element | null => target.querySelector('.update-dot');
/** 設定のタブの中身（ホットキー・バージョン） */
const modalText = (): string => document.querySelector('[aria-label="設定"][role="region"]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  h.state.log.length = 0;
  h.state.update = null;
  h.state.checkError = null;
  h.state.holdDownload = null;
  updater.state = { kind: 'idle' };
  updater.version = null;
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

describe('アプリの更新', () => {
  it('外枠の下に「fixplor v0.1.0」の行。最新なら点は出ない。起動時に、静かに確認する', async () => {
    app = mount(App, { target });
    await settle();
    expect(aboutRow().textContent).toContain('fixplor v0.1.0');
    expect(dot()).toBeNull();
    expect(h.state.log).toEqual(['check']);
    expect(localStorage.getItem(CHECKED_AT_KEY)).not.toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('画面を閉じると、裏の確認も止まる（フォーカスが戻っても確認しない）', async () => {
    app = mount(App, { target });
    await settle();
    void unmount(app);
    app = undefined;
    h.state.log.length = 0;
    localStorage.setItem(CHECKED_AT_KEY, '0');
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(h.state.log).toEqual([]);
  });

  it('新しい版があると、トースト（1 回だけ）と行の点。「更新」で、設定のタブが開く', async () => {
    h.state.update = { version: '0.2.0', body: '直したこと\n- あれ' };
    app = mount(App, { target });
    await settle();
    expect(document.querySelector('.toast')!.textContent).toContain('新しいバージョン v0.2.0 があります');
    expect(localStorage.getItem(NOTIFIED_KEY)).toBe('0.2.0');
    expect(dot()!.getAttribute('aria-label')).toBe('新しいバージョンがあります');
    button('更新').click();
    await settle();
    expect(modalText()).toContain('バージョン');
    expect(modalText()).toContain('fixplor v0.1.0');
    expect(modalText()).toContain('新しいバージョンがあります: v0.2.0');
    expect(modalText()).toContain('あれ');
  });

  it('「アップデート」: 進みを出し、終わったらアプリを起動し直す', async () => {
    h.state.update = { version: '0.2.0', body: '' };
    app = mount(App, { target });
    await settle();
    aboutRow().click();
    await settle();
    // 取得の途中で止めて、進みの表示を見る
    h.state.holdDownload = () => {};
    button('アップデート').click();
    await settle();
    expect(modalText()).toContain('ダウンロード中');
    expect(modalText()).toContain('40%');
    expect(document.querySelector('.about-progress')).not.toBeNull();
    expect(h.state.log).not.toContain('relaunch');
    h.state.holdDownload();
    await settle();
    expect(h.state.log.slice(-2)).toEqual(['download', 'relaunch']);
    expect(modalText()).toContain('アップデートしています');
  });

  it('「アップデートを確認」: 最新なら「最新です」。新しい版が無いときに、押せる（確認中は押せない）', async () => {
    app = mount(App, { target });
    await settle();
    aboutRow().click();
    await settle();
    expect(document.querySelector('.about-install')).toBeNull();
    button('アップデートを確認').click();
    await settle();
    expect(modalText()).toContain('最新です');
    expect(h.state.log.filter((l) => l === 'check')).toHaveLength(2);
    // 設定のタブは、タブの × で閉じる（ダイアログではない）
    button('「設定」のタブを閉じる').click();
    await settle();
    expect(modalText()).toBe('');
  });

  it('確認に失敗すると、理由とリリースページを出す（裏の確認は黙って、手で押したときだけ）', async () => {
    h.state.checkError = 'ネットワークに接続できません';
    app = mount(App, { target });
    await settle();
    expect(document.querySelector('.toast')).toBeNull();
    aboutRow().click();
    await settle();
    button('アップデートを確認').click();
    await settle();
    expect(modalText()).toContain('エラー: ネットワークに接続できません');
    button('リリースページを開く').click();
    await settle();
    expect(h.state.log).toContain('release-page');
  });
});
