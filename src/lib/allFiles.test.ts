import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const android = { value: false };
vi.mock('@3pino/app-kit-web/core/platform', () => ({ isAndroid: () => android.value }));

import { allFilesGranted, openAllFilesSettings } from './allFiles';

describe('allFiles', () => {
  beforeEach(() => {
    invoke.mockReset();
    android.value = false;
  });

  it('Android 以外は、確かめずに許可されている扱い', async () => {
    expect(await allFilesGranted()).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('Android では、プラグインの check の結果を返す', async () => {
    android.value = true;
    invoke.mockResolvedValue({ granted: false });
    expect(await allFilesGranted()).toBe(false);
    expect(invoke).toHaveBeenCalledWith('plugin:fixplor-storage|check');
  });

  it('確かめられないときは、許可されていないものとして扱う', async () => {
    android.value = true;
    invoke.mockRejectedValue(new Error('x'));
    expect(await allFilesGranted()).toBe(false);
  });

  it('設定画面を開く（request）', async () => {
    invoke.mockResolvedValue(undefined);
    await openAllFilesSettings();
    expect(invoke).toHaveBeenCalledWith('plugin:fixplor-storage|request');
  });
});
