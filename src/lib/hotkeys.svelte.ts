import { matchesHotkey, matchesMouse } from '@3pino/explorer-kit';
import { read, write } from './settings.svelte';
import { addKey, effectiveKeys, explorerKeymap, findConflicts, overrideOf, parseOverrides, removeKey, type CommandId, type Overrides } from './hotkeys';

// ホットキーの設定（各デバイスに保存する）。変えた分だけを保存する（lib/hotkeys.ts）。

const KEY = 'fixplor.hotkeys';

class Hotkeys {
  #over = $state.raw<Overrides>(parseOverrides(read(KEY)));
  /** 設定で、新しいホットキーを記録しているあいだは、ほかの操作を働かせない */
  recording = $state(false);

  /** 保存した値を読み直す（試験で、保存を差し替えたあと） */
  reload(): void {
    this.#over = parseOverrides(read(KEY));
  }
  keys(id: CommandId): readonly string[] {
    return effectiveKeys(id, this.#over);
  }
  isCustom(id: CommandId): boolean {
    return this.#over[id] !== undefined;
  }
  /** イベントが、その操作のホットキーに当たるか */
  matches(ev: KeyboardEvent, id: CommandId): boolean {
    return matchesHotkey(ev, this.keys(id));
  }
  /** マウスの戻る・進むのボタンが、その操作のホットキーに当たるか */
  matchesMouse(ev: MouseEvent, id: CommandId): boolean {
    return matchesMouse(ev, this.keys(id));
  }
  /** 共有の部品に渡す、一覧の操作のホットキー */
  get keymap() {
    return explorerKeymap(this.#over);
  }
  get conflicts() {
    return findConflicts(this.#over);
  }

  set(id: CommandId, list: readonly string[]): void {
    const { [id]: _old, ...rest } = this.#over;
    const o = overrideOf(id, list);
    this.#over = o === null ? rest : { ...rest, [id]: o };
    write(KEY, JSON.stringify(this.#over));
  }
  add(id: CommandId, key: string): void {
    this.set(id, addKey(this.keys(id), key));
  }
  remove(id: CommandId, key: string): void {
    this.set(id, removeKey(this.keys(id), key));
  }
  reset(id: CommandId): void {
    const { [id]: _old, ...rest } = this.#over;
    this.#over = rest;
    write(KEY, JSON.stringify(this.#over));
  }
}

export const hotkeys = new Hotkeys();
