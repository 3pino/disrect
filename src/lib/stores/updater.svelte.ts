// アプリ自身のアップデートの状態（土台 @3pino/app-kit-web/updater の Updater を、Tauri の仕組みでつないだもの）
import { Updater } from '@3pino/app-kit-web/updater';
import { isTauri } from '@3pino/app-kit-web/core/platform';
import { tauriUpdateBackend } from '../updateBackend';

export { RELEASES_URL } from '../updateBackend';
export type { UpdateState } from '@3pino/app-kit-web/updater';

/** 対応しているのは、Tauri の中（デスクトップ・Android）。ブラウザーの開発では何もしない */
export const updater = new Updater(tauriUpdateBackend(), isTauri());
