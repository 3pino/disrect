import { findRegisteredKey } from '@3pino/app-kit-web/core/localKeys';

// localStorage のキーの一覧（このアプリのコードが使うものすべて）。読み書きは土台のストレージ（@3pino/app-kit-web/core/storage）を通す。
// ここに無いキーを使うと、試験（localKeys.test.ts）が止める。接頭辞は `fixplor.`。
// kind: state = 利用者の状態（消すと困る）／ cache = 再構成できる写し

export type LocalKey = { key: string; prefix?: true; owner: string; purpose: string; kind: 'state' | 'cache' };

export const LOCAL_KEYS: readonly LocalKey[] = [
  { key: 'fixplor.showHidden', owner: 'lib/settings.svelte.ts', purpose: '隠しファイルを出すか', kind: 'state' },
  { key: 'fixplor.dirs', owner: 'lib/settings.svelte.ts', purpose: 'フォルダごとの表示方法と並び順', kind: 'state' },
  { key: 'fixplor.tabs', owner: 'App.svelte', purpose: '開いているタブ（置き場所と開いているフォルダ）と、見ているタブ。起動で戻す', kind: 'state' },
  { key: 'fixplor.places', owner: 'lib/places.svelte.ts', purpose: '追加したネットワークの場所（名前と URL）', kind: 'state' },
  { key: 'fixplor.updateCheckedAt', owner: 'lib/updateWatch.ts', purpose: 'アプリの更新を最後に確認した時刻', kind: 'cache' },
  { key: 'fixplor.updateNotifiedVersion', owner: 'lib/updateWatch.ts', purpose: '新しい版を知らせた版（同じ版は 1 回だけ知らせる）', kind: 'cache' },
];

export const registeredKey = (key: string): LocalKey | undefined => findRegisteredKey(LOCAL_KEYS, key);
