import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const manifest = JSON.parse(readFileSync(here('manifest.json'), 'utf8')) as { id: string; version: string };

// Disnans のプラグインの成果物（main.js 1 つ・styles.css 1 つ）を作る。
// Svelte の実行環境・共有の部品（explorer-kit・ui-kit-web）は、全部 main.js の中へ入れる（本体と共有しない・コード分割もしない）。
export default defineConfig({
  root: here('.'),
  // ui-kit-web は、名前でアイコンを引くとき Lucide の全部（約 700 KB）を別チャンクで読み込む。
  // このプラグインはアイコンを Svelte の部品（@lucide/svelte/icons/*）で渡すので、一覧は同梱しない（空の入れ物に差し替える）
  resolve: { alias: { lucide: here('build/lucide-stub.ts') } },
  plugins: [
    svelte({
      configFile: false,
      // 本体や他のプラグインのクラスとぶつからないように、接頭辞を付ける
      compilerOptions: { cssHash: ({ hash, css }) => `fxp-${hash(css)}` },
    }),
  ],
  build: {
    outDir: here(`../../dist-plugin/${manifest.id}-${manifest.version}`),
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    cssCodeSplit: false,
    lib: { entry: here('src/main.ts'), formats: ['es'], fileName: () => 'main.js', cssFileName: 'styles' },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
