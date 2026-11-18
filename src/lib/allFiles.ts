// Android の「すべてのファイルへのアクセス」（tauri-plugin-fixplor-storage）。Android 以外では、常に許可されている扱い。
import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '@3pino/app-kit-web/core/platform';

/** 許可されているか。Android 以外は true（確かめる必要が無い） */
export async function allFilesGranted(): Promise<boolean> {
  if (!isAndroid()) return true;
  try {
    const r = await invoke<{ granted: boolean }>('plugin:fixplor-storage|check');
    return r.granted;
  } catch {
    return false;
  }
}

/** 設定画面を開く（許可の結果は受け取れない。戻ったあとに allFilesGranted で確かめる） */
export async function openAllFilesSettings(): Promise<void> {
  await invoke('plugin:fixplor-storage|request');
}
