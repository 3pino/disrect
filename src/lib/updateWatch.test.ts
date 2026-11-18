// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_CHECK_FOCUS_GAP_MS, UPDATE_CHECK_INTERVAL_MS, type UpdateState } from '@3pino/app-kit-web/updater';
import { CHECKED_AT_KEY, NOTIFIED_KEY, TICK_MS, startUpdateWatch, type UpdateWatchDeps } from './updateWatch';

// 裏の更新の確認（起動時・6 時間おき・フォーカスが戻ったとき）と、新しい版の知らせ（同じ版は 1 回だけ）を、偽の Updater・偽の時計で確かめる

const T0 = 1_800_000_000_000;
let nowMs = T0;
let checks: boolean[];
let toasts: { text: string; action: { label: string; run: () => void } }[];
let opened: number;
let next: UpdateState;
let updater: UpdateWatchDeps['updater'];
let stops: (() => void)[];

function start(over: { supported?: boolean } = {}): () => void {
  updater.supported = over.supported ?? true;
  const stop = startUpdateWatch({
    updater,
    notify: (text, action) => toasts.push({ text, action }),
    openAbout: () => void opened++,
    now: () => nowMs,
  });
  stops.push(stop);
  return stop;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  nowMs = T0;
  checks = [];
  toasts = [];
  opened = 0;
  next = { kind: 'latest' };
  stops = [];
  updater = {
    supported: true,
    state: { kind: 'idle' },
    async check(opts) {
      checks.push(opts?.quiet === true);
      this.state = next;
    },
  };
});
afterEach(() => {
  for (const s of stops) s();
  vi.useRealTimers();
});

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const visible = (): void => {
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('裏の更新の確認', () => {
  it('対応していない環境では、何もしない（確認も、時計も）', async () => {
    start({ supported: false });
    await flush();
    await vi.advanceTimersByTimeAsync(TICK_MS * 4);
    expect(checks).toEqual([]);
    expect(localStorage.getItem(CHECKED_AT_KEY)).toBeNull();
  });

  it('起動時に、静かに（quiet）確認して、確認した時刻を覚える', async () => {
    start();
    await flush();
    expect(checks).toEqual([true]);
    expect(localStorage.getItem(CHECKED_AT_KEY)).toBe(String(T0));
    expect(toasts).toEqual([]);
  });

  it('新しい版があれば、トーストで知らせる（「更新」で、バージョン情報を開く）。同じ版は 1 回だけ', async () => {
    next = { kind: 'available', version: '0.2.0', notes: null };
    start();
    await flush();
    expect(toasts.map((t) => t.text)).toEqual(['新しいバージョン v0.2.0 があります']);
    expect(toasts[0].action.label).toBe('更新');
    toasts[0].action.run();
    expect(opened).toBe(1);
    expect(localStorage.getItem(NOTIFIED_KEY)).toBe('0.2.0');
    // 次の確認（6 時間後）でも、同じ版は知らせない。見つかったままの状態では、そもそも確認しない
    updater.state = { kind: 'latest' };
    nowMs += UPDATE_CHECK_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(checks).toHaveLength(2);
    expect(toasts).toHaveLength(1);
    // もっと新しい版は、また知らせる
    next = { kind: 'available', version: '0.3.0', notes: null };
    updater.state = { kind: 'latest' };
    nowMs += UPDATE_CHECK_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(toasts.map((t) => t.text)).toEqual(['新しいバージョン v0.2.0 があります', '新しいバージョン v0.3.0 があります']);
  });

  it('起動時は、前の確認から間もなくても確認する。定期の確認は 6 時間たってから', async () => {
    localStorage.setItem(CHECKED_AT_KEY, String(T0 - 1000));
    start();
    await flush();
    expect(checks).toHaveLength(1);
    nowMs += UPDATE_CHECK_INTERVAL_MS - 5000;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(checks).toHaveLength(1);
    nowMs += 10_000;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(checks).toHaveLength(2);
  });

  it('フォーカスが戻ったとき（見えるとき）は、前の確認から 1 時間たっていれば確認する。たっていなければ確認しない', async () => {
    start();
    await flush();
    expect(checks).toHaveLength(1);
    nowMs += UPDATE_CHECK_FOCUS_GAP_MS - 1000;
    visible();
    await flush();
    expect(checks).toHaveLength(1);
    nowMs += 2000;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(checks).toHaveLength(2);
  });

  it('確認中・取得中・見つかったままの状態では、確認しない', async () => {
    for (const kind of ['checking', 'downloading', 'installing', 'available'] as const) {
      checks.length = 0;
      localStorage.clear();
      updater.state = { kind, version: '9', notes: null, downloaded: 0, total: null } as UpdateState;
      const stop = start();
      await flush();
      expect(checks, kind).toEqual([]);
      stop();
    }
  });

  it('止めると、時計もフォーカスの確認も止まる', async () => {
    const stop = start();
    await flush();
    stop();
    checks.length = 0;
    nowMs += UPDATE_CHECK_INTERVAL_MS * 2;
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    window.dispatchEvent(new Event('focus'));
    visible();
    await flush();
    expect(checks).toEqual([]);
  });
});
