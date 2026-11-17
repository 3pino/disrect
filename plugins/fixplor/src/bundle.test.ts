// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDisnans, fakeFiles } from './test-support/fakeHost';
import type { HostView } from './sdk';

// 作った成果物（dist-plugin/fixplor-<版>/main.js）そのものを、本体の偽物の上で動かす（ソースではなく、配るもの）。
// 先に `npm run build:plugin` が要る。無ければ飛ばす（CI は REQUIRE_PLUGIN_BUNDLE=1 で、無ければ失敗にする）。
const root = join(__dirname, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8')) as { id: string; version: string };
const dir = join(root, 'dist-plugin', `${manifest.id}-${manifest.version}`);
const built = existsSync(join(dir, 'main.js'));

if (!built && process.env.REQUIRE_PLUGIN_BUNDLE) throw new Error(`成果物がありません: ${dir}（先に npm run build:plugin）`);

afterEach(() => {
  delete (globalThis as { disnans?: unknown }).disnans;
  document.body.innerHTML = '';
});

describe.skipIf(!built)('配る main.js（同梱の Svelte・部品で、本体の口だけを使って動く）', () => {
  it('Plugin を継承した default の class。onload で view を登録し、開くと共有フォルダの一覧が出る。閉じると片付く', async () => {
    const files = fakeFiles({ 'docs/in.txt': 'x', 'a.txt': 'aaaa', 'p.png': 'png' });
    const d = fakeDisnans(files);
    (globalThis as { disnans?: unknown }).disnans = d.global;
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'main.js')).href)) as { default: new () => { onload(): void } };
    const plugin = new mod.default();
    plugin.onload();
    const view = d.views.get('fixplor')!(undefined) as HostView;
    const target = document.createElement('div');
    document.body.append(target);
    await view.onOpen(target, { setTitle: vi.fn(), setIcon: vi.fn() });
    await vi.waitFor(() => expect([...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent)).toEqual(['docs', 'a.txt', 'p.png']));
    // 作った CSS の名前（接頭辞つき）が、画面に付いている
    const css = readFileSync(join(dir, 'styles.css'), 'utf8');
    expect(css).toContain('fxp-');
    expect(files.listeners).toBe(1);
    view.onClose!();
    expect(files.listeners).toBe(0);
    expect(d.serverListeners).toBe(0);
  });
});
