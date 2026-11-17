// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDisnans } from './test-support/fakeHost';

// 入口（main.ts）は、読み込むときにグローバルの `disnans` を使う。本体の偽物を立ててから読み込む。
async function load(d = fakeDisnans()) {
  vi.resetModules();
  (globalThis as { disnans?: unknown }).disnans = d.global;
  const mod = await import('./main');
  return { d, Plugin: mod.default };
}

afterEach(() => {
  delete (globalThis as { disnans?: unknown }).disnans;
});

describe('プラグインの入口', () => {
  it('Plugin を継承したクラスを default で出し、onload で view「fixplor」（プラグイン ID と同じ）を 1 つ登録する', async () => {
    const { d, Plugin } = await load();
    const p = new (Plugin as unknown as new () => { onload(): void })();
    p.onload();
    expect([...d.views.keys()]).toEqual(['fixplor']);
  });

  it('view の工場は、セッションを使わない（共有フォルダに、セッションは無い）。開くたびに別の view を作る', async () => {
    const { d, Plugin } = await load();
    const p = new (Plugin as unknown as new () => { onload(): void })();
    p.onload();
    const factory = d.views.get('fixplor')!;
    const a = factory(undefined);
    const b = factory(null);
    expect(a).not.toBe(b);
    expect(a.title).toBe('ファイル');
    expect(typeof a.onOpen).toBe('function');
    expect(typeof a.onClose).toBe('function');
  });

  it('ナビバーの項目を足す（選ぶと、この view を開く）。プラグインを外すと、項目も外れる', async () => {
    const { d, Plugin } = await load();
    const p = new (Plugin as unknown as new () => { onload(): void })();
    p.onload();
    expect(d.ui.navItems).toMatchObject([{ id: 'fixplor', label: 'ファイル', icon: 'folder', view: 'fixplor', closed: false }]);
    d.unload();
    expect(d.ui.navItems[0].closed).toBe(true);
  });

  it('本体の口（disnans）が無ければ、分かる言葉で失敗する', async () => {
    vi.resetModules();
    await expect(import('./main')).rejects.toThrow('disnans（本体の口）がありません');
  });
});
