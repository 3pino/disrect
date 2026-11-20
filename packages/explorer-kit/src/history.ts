import type { ExplorerApi, TrashEntry } from './types';

// 元に戻す・やり直す（Ctrl+Z・Ctrl+Y）の履歴。画面に依らない。アプリ全体で 1 つ（タブ・置き場所をまたぐ）。
// 対象: 名前の変更・移動・ペースト（コピーしたものの貼り付け）・ゴミ箱へ移す・新しいファイル（フォルダ）。上書きを伴うもの・完全な削除・取り込み（アップロード）は、元に戻せないので積まない。
// 1 つの項目は、操作した置き場所（api）を持つので、別の置き場所を見ていても、同じ置き場所へ戻す。

export type HistoryEntry = {
  /** 画面に出す名前（例: 「名前の変更: a.txt → b.txt」） */
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
};

const LIMIT = 100;

export class ExplorerHistory {
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  /** 実行中（二重に走らせない） */
  #busy = false;

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }
  /** 次に元に戻す操作の名前 */
  get undoLabel(): string | null {
    return this.#undo.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.#redo.at(-1)?.label ?? null;
  }

  /** 操作を積む（やり直しの履歴は捨てる） */
  push(e: HistoryEntry): void {
    this.#undo.push(e);
    if (this.#undo.length > LIMIT) this.#undo.shift();
    this.#redo = [];
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /**
   * 元に戻す。戻した操作の名前を返す（履歴が無ければ null）。失敗したら、その操作は履歴に残したまま、reject する。
   * 実行中に呼ばれたときは何もしない（null）
   */
  async undo(): Promise<string | null> {
    return this.#run(this.#undo, this.#redo, 'undo');
  }
  async redo(): Promise<string | null> {
    return this.#run(this.#redo, this.#undo, 'redo');
  }

  async #run(from: HistoryEntry[], to: HistoryEntry[], way: 'undo' | 'redo'): Promise<string | null> {
    if (this.#busy) return null;
    const e = from.at(-1);
    if (!e) return null;
    this.#busy = true;
    try {
      await e[way]();
      from.pop();
      to.push(e);
      return e.label;
    } finally {
      this.#busy = false;
    }
  }
}

export const explorerHistory = new ExplorerHistory();

// ---- 操作ごとの履歴の作り方 ----

/** 複数の項目を、順に（元に戻すときは逆順に）扱う。1 件でも失敗したら、その文を持って reject する（成功した分は戻っている） */
async function each<T>(items: readonly T[], run: (item: T) => Promise<void>, reverse: boolean): Promise<void> {
  const list = reverse ? [...items].reverse() : [...items];
  const failed: string[] = [];
  for (const item of list) {
    try {
      await run(item);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (failed.length > 0) throw new Error(failed.length === 1 ? failed[0] : `${failed.length} 件で失敗しました（${failed[0]}）`);
}

type Api = Pick<ExplorerApi, 'move' | 'copy' | 'trash' | 'restore'>;

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** 名前の変更・移動（from → to）。上書きしていないものだけ */
export function moveEntry(api: Pick<Api, 'move'>, moves: readonly { from: string; to: string }[], onChange: (path: string) => void = () => {}): HistoryEntry {
  const parent = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
  const label = moves.length === 1 ? `${parent(moves[0].from) === parent(moves[0].to) ? '名前の変更' : '移動'}: ${nameOf(moves[0].from)}` : `移動: ${moves.length} 件`;
  const step = (a: string, b: string) => async () => {
    await api.move(a, b);
    onChange(a);
    onChange(b);
  };
  return {
    label,
    undo: () => each(moves, (m) => step(m.to, m.from)(), true),
    redo: () => each(moves, (m) => step(m.from, m.to)(), false),
  };
}

/** コピー（from → to）。元に戻すと、できたコピーをゴミ箱へ入れる（やり直しは、もう一度コピーする） */
export function copyEntry(api: Pick<Api, 'copy' | 'trash' | 'restore'>, copies: readonly { from: string; to: string }[], onChange: (path: string) => void = () => {}): HistoryEntry {
  const trashed = new Map<string, TrashEntry>();
  return {
    label: copies.length === 1 ? `ペースト: ${nameOf(copies[0].from)}` : `ペースト: ${copies.length} 件`,
    undo: () =>
      each(
        copies,
        async (c) => {
          trashed.set(c.to, await api.trash(c.to));
          onChange(c.to);
        },
        true,
      ),
    redo: () =>
      each(
        copies,
        async (c) => {
          const t = trashed.get(c.to);
          // 入れたコピーを戻せるなら戻す（中身が同じ）。無ければ、もう一度コピーする
          if (t) await api.restore(t.id);
          else await api.copy(c.from, c.to);
          trashed.delete(c.to);
          onChange(c.to);
        },
        false,
      ),
  };
}

/**
 * ゴミ箱へ移した項目（path と、入ったときの id）。元に戻すと、元の場所へ戻す。やり直しは、もう一度ゴミ箱へ（id は新しくなる）
 */
export function trashEntry(api: Pick<Api, 'trash' | 'restore'>, items: { path: string; id: string }[], onChange: (path: string) => void = () => {}): HistoryEntry {
  const state = items.map((i) => ({ ...i }));
  return {
    label: state.length === 1 ? `ゴミ箱へ移動: ${nameOf(state[0].path)}` : `ゴミ箱へ移動: ${state.length} 件`,
    undo: () =>
      each(
        state,
        async (i) => {
          await api.restore(i.id);
          onChange(i.path);
        },
        true,
      ),
    redo: () =>
      each(
        state,
        async (i) => {
          i.id = (await api.trash(i.path)).id;
          onChange(i.path);
        },
        false,
      ),
  };
}

/** 新しいファイル・フォルダ。元に戻すと、ゴミ箱へ入れる（やり直しは、そこから戻す） */
export function createEntry(api: Pick<Api, 'trash' | 'restore'>, path: string, kind: 'file' | 'dir', onChange: (path: string) => void = () => {}): HistoryEntry {
  let id: string | null = null;
  return {
    label: `新しい${kind === 'dir' ? 'フォルダ' : 'ファイル'}: ${nameOf(path)}`,
    async undo() {
      id = (await api.trash(path)).id;
      onChange(path);
    },
    async redo() {
      if (id === null) throw new Error('やり直せません');
      await api.restore(id);
      id = null;
      onChange(path);
    },
  };
}
