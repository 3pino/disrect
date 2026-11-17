// Rust が入れるデバイスの事実のグローバルの名前（src-tauri/src/platform.rs の `window.__FIXPLOR_PLATFORM__`）を、土台に教える。
// 起動の最初（main.ts の先頭）と、試験の前処理（vite.config.ts の setupFiles）で読み込む。
import { configurePlatform } from '@3pino/app-kit-web/core/platform';

export const PLATFORM_GLOBAL = '__FIXPLOR_PLATFORM__';

configurePlatform({ globalName: PLATFORM_GLOBAL });
