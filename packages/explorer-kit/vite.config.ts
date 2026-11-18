/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// 配布はソースのまま（取り込む側の Vite が Svelte を変換する）。ここは試験と型の確認のためだけの設定
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser'] },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 共有の小さな部品（Svelte のソース）と Lucide の Svelte 部品は、Vite で変換する（Node にそのまま読ませない）
    server: { deps: { inline: [/@3pino\/ui-kit-web/, /@lucide\/svelte/] } },
  },
});
