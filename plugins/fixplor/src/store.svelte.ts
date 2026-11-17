import type { ViewStore } from '@3pino/explorer-kit';

/** プラグインのデータ（`saveData`。この端末だけ） */
type Saved = { explorerDirs?: unknown };

export type Persist = {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
};

/** 保存を、続けて来たときにまとめる時間（ms） */
export const SAVE_DELAY_MS = 400;

/**
 * フォルダごとの表示（並び・見せ方）を保存する先。部品は同期で読み書きするので、開くときに一度だけ読み（load）、
 * 書きは手元を先に更新して、あとでまとめて保存する（flush で今すぐ）。
 * legacy は、本体の旧い保存先の中身（段 5 の F。プラグインの保存が空のときだけ使う）。
 */
export function createViewStore(persist: Persist, legacy?: unknown) {
  // 画面が読むので、リアクティブにする（書いたら、表示がすぐ変わる）
  let value = $state.raw<unknown>(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  async function flush(): Promise<void> {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    await persist.saveData({ explorerDirs: value } satisfies Saved);
  }

  const store: ViewStore = {
    read: () => value,
    write(map) {
      value = map;
      dirty = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void flush().catch(() => {}), SAVE_DELAY_MS);
    },
  };

  async function load(): Promise<void> {
    const data = (await persist.loadData()) as Saved | null | undefined;
    value = data?.explorerDirs ?? legacy;
  }

  return { store, load, flush };
}
