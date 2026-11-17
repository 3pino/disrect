// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDisnans, fakeFiles } from './test-support/fakeHost';

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
    expect(d.ui.navItems).toMatchObject([{ id: 'fixplor:files', label: 'ファイル', icon: 'folder', view: 'fixplor', closed: false }]);
    d.unload();
    expect(d.ui.navItems[0].closed).toBe(true);
  });

  it('ナビの項目の id は プラグイン ID: 名前（本体の中で一意）', async () => {
    const { d, Plugin } = await load();
    new (Plugin as unknown as new () => { onload(): void })().onload();
    expect(d.ui.navItems[0].id).toBe('fixplor:files');
  });

  it('本文のファイルリンクは、そのファイルのあるフォルダを開く（フォルダならその中）。無くなっていても親まで。画面を開く', async () => {
    const mod = await load(fakeDisnans(fakeFiles({ 'docs/sub/a.txt': 'x', 'top.txt': 'y' })));
    const { openAt } = await import('./main');
    const { createShelf } = await import('./view');
    const plugin = { files: mod.d.files, openView: (t: string) => void mod.d.opened.push(t) } as never;
    const shelf = createShelf();
    const dirs: string[] = [];
    const where = async (path: string): Promise<string | null> => {
      shelf.pendingDir = null;
      await openAt(plugin, shelf, path);
      dirs.push(shelf.pendingDir ?? '(開いている画面)');
      return shelf.pendingDir;
    };
    expect(await where('docs/sub/a.txt')).toBe('docs/sub');
    expect(await where('docs')).toBe('docs');
    expect(await where('docs/gone.txt')).toBe('docs');
    expect(await where('top.txt')).toBe('');
    expect(mod.d.opened).toEqual(['fixplor', 'fixplor', 'fixplor', 'fixplor']);
    // 開いている画面があれば、そこで開く（覚えない）
    const opened: string[] = [];
    shelf.pendingDir = null;
    shelf.current = { nav: { open: (p: string) => opened.push(p) } } as never;
    await openAt(plugin, shelf, 'docs/sub/a.txt');
    expect(opened).toEqual(['docs/sub']);
    expect(shelf.pendingDir).toBeNull();
  });

  it('リンクの開き手は、本体から呼ばれる口（registerLinkOpener）に登録される', async () => {
    const { d, Plugin } = await load();
    new (Plugin as unknown as new () => { onload(): void })().onload();
    expect(d.linkOpeners).toHaveLength(1);
  });

  it('プラグインを外すと、リンクの開き手も外れる', async () => {
    const { d, Plugin } = await load();
    new (Plugin as unknown as new () => { onload(): void })().onload();
    expect(d.linkOpeners).toHaveLength(1);
    d.unload();
    expect(d.linkOpeners).toHaveLength(0);
  });

  it('本体の口（disnans）が無ければ、分かる言葉で失敗する', async () => {
    vi.resetModules();
    await expect(import('./main')).rejects.toThrow('disnans（本体の口）がありません');
  });
});
