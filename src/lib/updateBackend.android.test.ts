import { beforeEach, describe, expect, it, vi } from 'vitest';

const android = vi.hoisted(() => ({ value: true }));
vi.mock('@3pino/app-kit-web/core/platform', () => ({ isAndroid: () => android.value }));

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage: ((p: unknown) => void) | null }[],
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => core.invoke(...a),
  Channel: class {
    onmessage: ((p: unknown) => void) | null = null;
    constructor() {
      core.channels.push(this);
    }
  },
}));

import { LATEST_API_URL, tauriUpdateBackend } from './updateBackend';

beforeEach(() => {
  core.invoke.mockReset();
  core.channels.length = 0;
  android.value = true;
});

describe('tauriUpdateBackend（Android）', () => {
  it('Android では kind が android（デスクトップではない）', () => {
    expect(tauriUpdateBackend().kind()).toBe('android');
    android.value = false;
    expect(tauriUpdateBackend().kind()).toBe('desktop');
  });

  it('最新のリリースは GitHub の API から（キャッシュを使わない）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v0.2.0', body: 'x', assets: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const rel = await tauriUpdateBackend().fetchLatestAndroid();
    expect(rel.tag_name).toBe('v0.2.0');
    expect(fetchMock).toHaveBeenCalledWith(LATEST_API_URL, expect.objectContaining({ cache: 'no-store' }));
    expect(LATEST_API_URL).toBe('https://api.github.com/repos/3pino/fixplor/releases/latest');
    vi.unstubAllGlobals();
  });

  it('リリースが無い・接続できないときは、理由の文を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(tauriUpdateBackend().fetchLatestAndroid()).rejects.toThrow('リリースが見つかりません');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(tauriUpdateBackend().fetchLatestAndroid()).rejects.toThrow('HTTP 503');
    vi.unstubAllGlobals();
  });

  it('入れる許可・設定画面は、Kotlin のプラグインの名前で呼ぶ', async () => {
    core.invoke.mockResolvedValueOnce({ granted: false });
    expect(await tauriUpdateBackend().canInstallAndroid()).toBe(false);
    expect(core.invoke).toHaveBeenLastCalledWith('plugin:fixplor-updater|can_install');
    await tauriUpdateBackend().openInstallSettings();
    expect(core.invoke).toHaveBeenLastCalledWith('plugin:fixplor-updater|open_install_settings');
  });

  it('取得（Rust）→ インストーラーへ。進みは channel で受ける', async () => {
    const seen: unknown[] = [];
    core.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:fixplor-updater|download_apk') {
        core.channels[0].onmessage?.({ downloaded: 5, total: 10 });
        return '/cache/update/fixplor.apk';
      }
      return undefined;
    });
    await tauriUpdateBackend().downloadAndInstallAndroid('https://github.com/3pino/fixplor/releases/download/v1/a.apk', (p) => seen.push(p));
    expect(core.invoke).toHaveBeenNthCalledWith(1, 'plugin:fixplor-updater|download_apk', expect.objectContaining({ url: 'https://github.com/3pino/fixplor/releases/download/v1/a.apk' }));
    expect(core.invoke).toHaveBeenNthCalledWith(2, 'plugin:fixplor-updater|install_apk', { path: '/cache/update/fixplor.apk' });
    expect(seen).toEqual([{ downloaded: 5, total: 10 }]);
  });
});
