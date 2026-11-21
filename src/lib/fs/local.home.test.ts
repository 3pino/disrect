import { describe, expect, it, vi } from 'vitest';
import { resolveTypedPath } from '@3pino/explorer-kit';
import { createLocalFs, type Call } from './local';

const android = vi.hoisted(() => ({ value: false }));
vi.mock('@3pino/app-kit-web/core/platform', () => ({ isAndroid: () => android.value }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => `asset://${p}` }));

const fake = (start: string): Call => async (cmd) => (cmd === 'fs_start_dir' ? (start as never) : ([] as never));

describe('パス欄の ~（api.home）', () => {
  it('デスクトップは、起動時のホーム。Android は、内部ストレージの根（/storage/emulated/0）', async () => {
    android.value = false;
    const pc = await createLocalFs({ call: fake('/home/me') });
    expect(pc.api.home?.()).toBe('home/me');
    expect(resolveTypedPath('~/docs', 'a/b', pc.api.home?.())).toBe('home/me/docs');
    android.value = true;
    try {
      const phone = await createLocalFs({ call: fake('/storage/emulated/0') });
      expect(phone.api.home?.()).toBe('');
      expect(phone.osPath(resolveTypedPath('~', 'DCIM/Camera', phone.api.home?.()))).toBe('/storage/emulated/0');
      expect(phone.osPath(resolveTypedPath('~/Download', 'DCIM/Camera', phone.api.home?.()))).toBe('/storage/emulated/0/Download');
      expect(phone.osPath(resolveTypedPath('..', 'DCIM/Camera', phone.api.home?.()))).toBe('/storage/emulated/0/DCIM');
    } finally {
      android.value = false;
    }
  });
});
