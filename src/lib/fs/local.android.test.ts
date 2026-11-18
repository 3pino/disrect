import { describe, expect, it, vi } from 'vitest';
import { createLocalFs, type Call } from './local';

// Android: 置き場所のいちばん上は内部ストレージ。ゴミ箱は、その直下の .fixplor-trash（画面の仮想のフォルダ）
vi.mock('@3pino/app-kit-web/core/platform', () => ({ isAndroid: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => `asset://${p}` }));

const ROOT = '/storage/emulated/0';

type Answers = Record<string, unknown>;
function fake(answers: Answers = {}) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const call: Call = async (cmd, args) => {
    calls.push([cmd, args as Record<string, unknown> | undefined]);
    if (cmd === 'fs_start_dir') return ROOT as never;
    if (cmd in answers) return answers[cmd] as never;
    return undefined as never;
  };
  return { call, calls };
}

describe('この端末（Android）', () => {
  it('画面のいちばん上は内部ストレージ。OS のパスはその中の相対', async () => {
    const { call, calls } = fake({ fs_list: [] });
    const fs = await createLocalFs({ call });
    expect(fs.start).toBe('');
    await fs.api.list('Download');
    expect(calls.at(-1)).toEqual(['fs_list', { path: `${ROOT}/Download` }]);
    expect(fs.osPath('Download')).toBe(`${ROOT}/Download`);
    expect(fs.osPath('')).toBe(ROOT);
    expect(fs.fromOsPath(`${ROOT}/Download/a`)).toBe('Download/a');
  });

  it('ゴミ箱の印は、いちばん上の一覧に出る（隠しフォルダでも）', async () => {
    const { call } = fake({ fs_list: [] });
    const fs = await createLocalFs({ call });
    const top = await fs.api.list('');
    expect(top.find((e) => e.name === '.fixplor-trash')?.trash).toEqual({ kind: 'root' });
    expect(fs.rules.trashDir).toBe('.fixplor-trash');
    expect(fs.caps).toEqual({ restore: true, trash: true });
  });

  it('ゴミ箱の中身は fs_trash_list の答えを、画面の形にする', async () => {
    const { call } = fake({
      fs_trash_list: [{ id: '0001-000001', original_path: `${ROOT}/Download/a.txt`, kind: 'file', size: 5, deleted_at: 1000 }],
    });
    const fs = await createLocalFs({ call });
    const items = await fs.api.list('.fixplor-trash');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'a.txt', path: '.fixplor-trash/0001-000001', trash: { kind: 'item', entry: { id: '0001-000001', original_path: 'Download/a.txt' } } });
  });

  it('戻す・完全に消すは Rust の id で呼ぶ（戻したあとは fs_stat の形）', async () => {
    const { call, calls } = fake({ fs_trash_restore: `${ROOT}/Download/a.txt`, fs_stat: { name: 'a.txt', path: `${ROOT}/Download/a.txt`, kind: 'file', size: 5, modified: 1, hidden: false, readonly: false, symlink: false } });
    const fs = await createLocalFs({ call });
    const back = await fs.api.restore('0001-000001');
    expect(back.path).toBe('Download/a.txt');
    expect(calls.find((c) => c[0] === 'fs_trash_restore')?.[1]).toEqual({ volume: ROOT, id: '0001-000001' });
    await fs.api.purge('0001-000001');
    expect(calls.at(-1)).toEqual(['fs_trash_purge', { volume: ROOT, id: '0001-000001' }]);
  });

  it('削除は fs_trash（アプリの中のゴミ箱）。完全な削除は、ゴミ箱の中のものだけ', async () => {
    const { call, calls } = fake();
    const fs = await createLocalFs({ call });
    await fs.api.trash('Download/a.txt');
    expect(calls.at(-1)).toEqual(['fs_trash', { path: `${ROOT}/Download/a.txt` }]);
  });
});
