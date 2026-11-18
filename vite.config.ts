/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    // ほかの開発サーバー（既定の 5173）と同時に動かせるよう、別の番号にする
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // 共有の部品（エクスプローラー）は TypeScript と Svelte のソースのまま配られる。開発サーバーの依存の事前バンドルには載せない
  optimizeDeps: { exclude: ['@3pino/explorer-kit', '@3pino/ui-kit-web', '@3pino/app-kit-web', '@3pino/viewer-kit-web'] },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
    environment: 'node',
    // 土台の名前の指定（configurePlatform）を、どの試験より先に読む
    setupFiles: ['./src/lib/platformGlobal.ts'],
    server: { deps: { inline: [/@3pino\/(app-kit-web|viewer-kit-web)/] } },
  },
});
