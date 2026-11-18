// アプリのアップデートの「仕組み」（Tauri のアップデーター）を、土台の UpdateBackend へつなぐ。
// 土台（@3pino/app-kit-web/updater）は状態の機械だけ持つ。リポジトリ名はここで決める。
// 対応はデスクトップ（Windows・Linux）だけ。Android のビルドは無いので、その口は呼ばれない（呼ばれたら断る）。
import type { UpdateBackend } from '@3pino/app-kit-web/updater';

export const REPO = '3pino/fixplor';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

const NO_ANDROID = 'Android では、アプリの更新に対応していません';

export function tauriUpdateBackend(): UpdateBackend {
  return {
    kind: () => 'desktop',
    async version() {
      const { getVersion } = await import('@tauri-apps/api/app');
      return getVersion();
    },
    async checkDesktop() {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ headers: { 'Cache-Control': 'no-cache' } });
      return update ?? null;
    },
    async relaunch() {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
    fetchLatestAndroid: () => Promise.reject(new Error(NO_ANDROID)),
    canInstallAndroid: () => Promise.reject(new Error(NO_ANDROID)),
    openInstallSettings: () => Promise.reject(new Error(NO_ANDROID)),
    downloadAndInstallAndroid: () => Promise.reject(new Error(NO_ANDROID)),
    async openReleasePage() {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(RELEASES_URL);
    },
  };
}
