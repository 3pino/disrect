import { getItem, setItem } from '@3pino/app-kit-web/core/storage';

// 各デバイスに保存する設定（localStorage）。隠しファイルを出すか・フォルダごとの表示方法と並び順。
// 使うキーは localKeys.ts に登録する（試験が止める）。

const KEYS = { showHidden: 'fixplor.showHidden', dirs: 'fixplor.dirs' } as const;

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

class Settings {
  #showHidden = $state(read(KEYS.showHidden) === '1');
  /** フォルダごとの表示（形は共有の部品が確かめる。壊れた値は既定になる） */
  #dirs = $state.raw<unknown>(parse(read(KEYS.dirs)));

  get showHidden(): boolean {
    return this.#showHidden;
  }
  set showHidden(on: boolean) {
    this.#showHidden = on;
    write(KEYS.showHidden, on ? '1' : '0');
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
