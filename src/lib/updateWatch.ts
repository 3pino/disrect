import { getItem, setItem } from '@3pino/app-kit-web/core/storage';
import { canBackgroundCheck, isCheckDue, UPDATE_CHECK_FOCUS_GAP_MS, UPDATE_CHECK_INTERVAL_MS, versionToNotify, type UpdateState } from '@3pino/app-kit-web/updater';

// アプリのアップデートを裏で確認し、新しい版があればトーストで知らせる（対応している環境だけ）。
// 起動時・6 時間おき・フォーカスが戻ったとき（前回から 1 時間たっていれば）に確認する。同じ版は 1 回だけ知らせる。
// 時刻と知らせた版は、各デバイスの保存先（localKeys.ts に登録）に置く。

export const CHECKED_AT_KEY = 'fixplor.updateCheckedAt';
export const NOTIFIED_KEY = 'fixplor.updateNotifiedVersion';
/** 定期の確認の時計の刻み（間隔の判定は isCheckDue で行う） */
export const TICK_MS = 30 * 60 * 1000;

/** 確認する相手（Updater の使う部分）と、知らせる・開く口。試験では偽物を渡す */
export type UpdateWatchDeps = {
  updater: { supported: boolean; state: UpdateState; check(opts?: { quiet?: boolean }): Promise<void> };
  /** 新しい版を知らせる。action を押したら「バージョン情報」を開く */
  notify(text: string, action: { label: string; run: () => void }): void;
  openAbout(): void;
  now?: () => number;
};

function lastCheckedAt(): number | null {
  const raw = getItem(CHECKED_AT_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 確認を始める。戻り値の関数で止める */
export function startUpdateWatch(deps: UpdateWatchDeps): () => void {
  const { updater } = deps;
  if (!updater.supported) return () => {};
  const now = deps.now ?? Date.now;

  async function run(gapMs: number): Promise<void> {
    if (!isCheckDue(now(), lastCheckedAt(), gapMs)) return;
    if (!canBackgroundCheck(updater.state)) return;
    setItem(CHECKED_AT_KEY, String(now()));
    await updater.check({ quiet: true });
    const version = versionToNotify(updater.state, getItem(NOTIFIED_KEY));
    if (version) {
      setItem(NOTIFIED_KEY, version);
      deps.notify(`新しいバージョン v${version} があります`, { label: '更新', run: deps.openAbout });
    }
  }

  // 起動時は必ず確認する
  void run(0);
  const timer = setInterval(() => void run(UPDATE_CHECK_INTERVAL_MS), TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void run(UPDATE_CHECK_FOCUS_GAP_MS);
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
