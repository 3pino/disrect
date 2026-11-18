// アプリ自身のアップデートの状態（土台 @3pino/app-kit-web/updater の Updater を、Tauri の仕組みでつないだもの）
import { Updater } from '@3pino/app-kit-web/updater';
import { isAndroid, isTauri } from '@3pino/app-kit-web/core/platform';
import { tauriUpdateBackend } from '../updateBackend';

export { RELEASES_URL } from '../updateBackend';
export type { UpdateState } from '@3pino/app-kit-web/updater';

/** 対応しているのは、デスクトップの Tauri だけ（ブラウザーの開発・Android では何もしない） */
export const updater = new Updater(tauriUpdateBackend(), isTauri() && !isAndroid());
