import { isAndroid } from '@3pino/app-kit-web/core/platform';
import { invoke } from '@tauri-apps/api/core';

// デスクトップのウィンドウの操作（自前のタイトルバー: 最小化・最大化・閉じる・ウィンドウを動かす・別のウィンドウで開く）。
// Tauri の API は、使うときに読み込む（ブラウザ・試験では、動かさない）。

/** 自前のタイトルバー（ウィンドウの操作の 3 つのボタン）を出す環境か。Android・ブラウザは出さない */
export function hasWindowControls(): boolean {
  return !isAndroid() && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function current() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export const minimizeWindow = async (): Promise<void> => (await current()).minimize();
export const toggleMaximizeWindow = async (): Promise<void> => (await current()).toggleMaximize();
export const isWindowMaximized = async (): Promise<boolean> => (await current()).isMaximized();

/** ウィンドウの大きさ（最大化）が変わるたびに呼ぶ。止める関数を返す */
export async function onWindowResized(run: () => void): Promise<() => void> {
  return (await current()).onResized(run);
}

/**
 * 最後のタブを閉じたとき: デスクトップはこのウィンドウを閉じる（最後のウィンドウなら、アプリが終わる）。
 * Android は、アプリを終える
 */
export async function quitWindow(): Promise<void> {
  if (isAndroid()) {
    await invoke('exit_app');
    return;
  }
  await (await current()).close();
}

let windowSeq = 0;

/** 別のウィンドウを開き、その置き場所・フォルダのタブ 1 つで始める（x・y は画面の位置） */
export async function openTabInNewWindow(tab: { place: string; dir: string }, at?: { x: number; y: number }): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const query = new URLSearchParams({ place: tab.place, dir: tab.dir });
  new WebviewWindow(`win-${Date.now().toString(36)}-${++windowSeq}`, {
    url: `index.html?${query}`,
    title: 'fixplor',
    width: 1100,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    decorations: false,
    dragDropEnabled: false,
    ...(at ? { x: Math.max(0, Math.round(at.x - 120)), y: Math.max(0, Math.round(at.y - 16)) } : {}),
  });
}

/** このウィンドウを開いたときの指定（別のウィンドウで開いたタブ）。無ければ null */
export function detachedStart(search: string): { place: string; dir: string } | null {
  const q = new URLSearchParams(search);
  const place = q.get('place');
  return place ? { place, dir: q.get('dir') ?? '' } : null;
}
