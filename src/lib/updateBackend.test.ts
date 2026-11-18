import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tauri のアップデーターへのつなぎ（口の形と、リポジトリ名）を、偽の plugin で確かめる
const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  openUrl: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));

import { RELEASES_URL, REPO, tauriUpdateBackend } from './updateBackend';

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe('tauriUpdateBackend', () => {
  it('リポジトリは 3pino/fixplor。リリースページはその最新', () => {
    expect(REPO).toBe('3pino/fixplor');
    expect(RELEASES_URL).toBe('https://github.com/3pino/fixplor/releases/latest');
  });

  it('デスクトップの仕組み。版・確認（キャッシュを使わない）・起動し直し・リリースページ', async () => {
    const b = tauriUpdateBackend();
    expect(b.kind()).toBe('desktop');
    mocks.getVersion.mockResolvedValue('0.1.0');
    expect(await b.version()).toBe('0.1.0');
    mocks.check.mockResolvedValue(undefined);
    expect(await b.checkDesktop()).toBeNull();
    const update = { version: '0.2.0' };
    mocks.check.mockResolvedValue(update);
    expect(await b.checkDesktop()).toBe(update);
    expect(mocks.check).toHaveBeenLastCalledWith({ headers: { 'Cache-Control': 'no-cache' } });
    await b.relaunch();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    await b.openReleasePage();
    expect(mocks.openUrl).toHaveBeenCalledWith(RELEASES_URL);
  });

  it('Android の口は使えない（断る。呼ばれない前提）', async () => {
    const b = tauriUpdateBackend();
    await expect(b.fetchLatestAndroid()).rejects.toThrow('Android');
    await expect(b.canInstallAndroid()).rejects.toThrow('Android');
    await expect(b.openInstallSettings()).rejects.toThrow('Android');
    await expect(b.downloadAndInstallAndroid('u', () => {})).rejects.toThrow('Android');
  });
});
