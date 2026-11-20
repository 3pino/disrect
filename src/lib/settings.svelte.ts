import { getItem, setItem } from '@3pino/app-kit-web/core/storage';
import type { ColumnWidths } from '@3pino/explorer-kit';

// 各デバイスに保存する設定（localStorage）。隠しファイルを出すか・フォルダごとの表示方法と並び順。
// 使うキーは localKeys.ts に登録する（試験が止める）。

const KEYS = { showHidden: 'fixplor.showHidden', dirs: 'fixplor.dirs', columns: 'fixplor.columns' } as const;

/** 読む・書く（localStorage を直接は使わず、土台のストレージを通す。使えない環境や容量不足でも落ちない） */
export const read = (key: string): string | null => getItem(key);
export const write = (key: string, value: string): void => setItem(key, value);

function parse(raw: string | null): unknown {
  if (raw === null) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** 保存した列の幅を読む（知らない列・数でない値・範囲の外は捨てる） */
export function parseColumns(raw: string | null): ColumnWidths {
  const v = parse(raw);
  const out: ColumnWidths = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const k of ['kind', 'size', 'modified', 'created'] as const) {
    const w = (v as Record<string, unknown>)[k];
    if (typeof w === 'number' && Number.isFinite(w) && w >= 24 && w <= 1000) out[k] = Math.round(w);
  }
  return out;
}

class Settings {
  #showHidden = $state(read(KEYS.showHidden) === '1');
  /** フォルダごとの表示（形は共有の部品が確かめる。壊れた値は既定になる） */
  #dirs = $state.raw<unknown>(parse(read(KEYS.dirs)));

  #columns = $state.raw<ColumnWidths>(parseColumns(read(KEYS.columns)));

  get showHidden(): boolean {
    return this.#showHidden;
  }
  set showHidden(on: boolean) {
    this.#showHidden = on;
    write(KEYS.showHidden, on ? '1' : '0');
  }

  /** 詳細の列の幅（px。見出しの境目をつまんで変えた分だけ） */
  get columns(): ColumnWidths {
    return this.#columns;
  }
  set columns(widths: ColumnWidths) {
    this.#columns = widths;
    write(KEYS.columns, JSON.stringify(widths));
  }

  get dirs(): unknown {
    return this.#dirs;
  }
  set dirs(map: unknown) {
    this.#dirs = map;
    write(KEYS.dirs, JSON.stringify(map));
  }
}

export const settings = new Settings();
