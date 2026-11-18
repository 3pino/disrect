import { describe, expect, it, vi } from 'vitest';
import { createLocalFs, type Call } from './local';

// Android: ゴミ箱の画面が入るまで、削除は「完全に削除」だけ（隠れたゴミ箱を作らない）
vi.mock('@3pino/app-kit-web/core/platform', () => ({ isAndroid: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => `asset://${p}` }));

function fake() {
  const calls: unknown[][] = [];
  const call: Call = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'fs_start_dir') return '/storage/emulated/0' as never;
    return undefined as never;
  };
  return { call, calls };
}

describe('この端末（Android）', () => {
  it('ゴミ箱は無い扱い（caps.trash が偽）。戻す・消すは無い', async () => {
    const { call } = fake();
    const fs = await createLocalFs({ call });
    expect(fs.caps).toEqual({ restore: false, trash: false });
  });

  it('remove は fs_remove を、OS のパスで呼ぶ', async () => {
    const { call, calls } = fake();
    const fs = await createLocalFs({ call });
    await fs.api.remove!('storage/emulated/0/Download/a.txt');
    expect(calls.at(-1)).toEqual(['fs_remove', { path: '/storage/emulated/0/Download/a.txt' }]);
  });
});
