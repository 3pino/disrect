// この端末の設定（localStorage）。隠しファイルを出すか・フォルダごとの表示方法と並び順。

const KEYS = { showHidden: 'disrect.showHidden', dirs: 'disrect.dirs' } as const;

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても、開いているあいだは使える（次に開いたときは既定に戻る）
  }
}

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
