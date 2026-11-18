// アプリのアップデートの「仕組み」を、土台の UpdateBackend へつなぐ。
// 土台（@3pino/app-kit-web/updater）は状態の機械だけ持つ。リポジトリ名はここで決める。
//  - デスクトップ: Tauri の updater（latest.json の署名を、tauri.conf.json の公開鍵で確かめる）と、入れ替えたあとの再起動。
//  - Android: GitHub の最新のリリースから APK を取り、Rust（download_apk）で取得 → インストーラーへ渡す（plugins/updater）。
//    APK の署名は、インストーラーが「今の版と同じ署名か」で確かめる（同じ鍵で作った APK しか入らない）。
import type { AndroidRelease, UpdateBackend } from '@3pino/app-kit-web/updater';
import { isAndroid } from '@3pino/app-kit-web/core/platform';

export const REPO = '3pino/fixplor';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
export const LATEST_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

type Progress = { downloaded: number; total: number | null };

// Android の口は、Android 以外では呼ばれない前提（呼ばれたら断る）
const NOT_ANDROID = (): never => {
  throw new Error('Android 以外では、この操作は使えません');
};
const guard = (): void => {
  if (!isAndroid()) NOT_ANDROID();
};

export function tauriUpdateBackend(): UpdateBackend {
  return {
    kind: () => (isAndroid() ? 'android' : 'desktop'),
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
    async fetchLatestAndroid(): Promise<AndroidRelease> {
      guard();
      const res = await fetch(LATEST_API_URL, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (res.status === 404) throw new Error('リリースが見つかりません');
      if (!res.ok) throw new Error(`GitHub に接続できません (HTTP ${res.status})`);
      return (await res.json()) as AndroidRelease;
    },
    async canInstallAndroid() {
      guard();
      const { invoke } = await import('@tauri-apps/api/core');
      const { granted } = await invoke<{ granted: boolean }>('plugin:fixplor-updater|can_install');
      return granted;
    },
    async openInstallSettings() {
      guard();
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:fixplor-updater|open_install_settings');
    },
    async downloadAndInstallAndroid(url: string, onProgress: (p: Progress) => void) {
      guard();
      const { invoke, Channel } = await import('@tauri-apps/api/core');
      const channel = new Channel<Progress>();
      channel.onmessage = (p) => onProgress(p);
      const path = await invoke<string>('plugin:fixplor-updater|download_apk', { url, onProgress: channel });
      await invoke('plugin:fixplor-updater|install_apk', { path });
    },
    async openReleasePage() {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(RELEASES_URL);
    },
  };
}
