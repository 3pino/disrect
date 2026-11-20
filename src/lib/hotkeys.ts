import { EXPLORER_HOTKEYS, normalizeHotkey, type ExplorerHotkeyId, type Keymap } from '@3pino/explorer-kit';

// このアプリのホットキー（操作ごとの既定と、利用者が変えた分の扱い）。画面に依らない。
// 一覧の操作（検索・開く・名前の変更・選びを外す）は、共有の部品が受ける（Keymap で渡す）。それ以外は、App.svelte が受ける。
// 変えた分は、既定と違う操作だけを保存する（既定が変わったとき、変えていない操作は追従する）。

export type CommandId = 'tab.new' | 'tab.close' | 'tab.next' | 'tab.prev' | 'view.reload' | 'nav.back' | ExplorerHotkeyId;

export type Command = { id: CommandId; name: string; group: 'タブ' | '一覧'; defaults: readonly string[] };

export const COMMANDS: readonly Command[] = [
  { id: 'tab.new', name: '新しいタブ', group: 'タブ', defaults: ['Ctrl+T'] },
  { id: 'tab.close', name: 'タブを閉じる（最後の 1 つなら、ウィンドウを閉じる）', group: 'タブ', defaults: ['Ctrl+W'] },
  { id: 'tab.next', name: '次のタブ', group: 'タブ', defaults: ['Ctrl+Tab', 'Ctrl+PageDown'] },
  { id: 'tab.prev', name: '前のタブ', group: 'タブ', defaults: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'] },
  { id: 'view.reload', name: '再読み込み', group: '一覧', defaults: ['F5'] },
  { id: 'nav.back', name: '戻る', group: '一覧', defaults: ['Alt+ArrowLeft'] },
  { id: 'search', name: '検索', group: '一覧', defaults: EXPLORER_HOTKEYS.search },
  { id: 'open', name: '開く', group: '一覧', defaults: EXPLORER_HOTKEYS.open },
  { id: 'rename', name: '名前の変更', group: '一覧', defaults: EXPLORER_HOTKEYS.rename },
  { id: 'clearSelection', name: '選びを外す', group: '一覧', defaults: EXPLORER_HOTKEYS.clearSelection },
];

/** 変えられない（固定の）ホットキー。設定の一覧には、見るだけで出す */
export const FIXED_HOTKEYS: readonly { name: string; keys: string }[] = [
  { name: '番号のタブへ', keys: 'Ctrl+1 〜 8' },
  { name: '最後のタブへ', keys: 'Ctrl+9' },
];

export type Overrides = Partial<Record<CommandId, string[]>>;

const IDS = new Set<string>(COMMANDS.map((c) => c.id));

/** 保存した文字から読む。壊れた値・知らない操作・読めないキーは捨てる（読めるものだけを残す） */
export function parseOverrides(raw: string | null): Overrides {
  if (raw === null) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Overrides = {};
  for (const [id, list] of Object.entries(v)) {
    if (!IDS.has(id) || !Array.isArray(list)) continue;
    const keys: string[] = [];
    for (const k of list) {
      const n = typeof k === 'string' ? normalizeHotkey(k) : null;
      if (n !== null && !keys.includes(n)) keys.push(n);
    }
    out[id as CommandId] = keys;
  }
  return out;
}

export const defaultsOf = (id: CommandId): readonly string[] => COMMANDS.find((c) => c.id === id)!.defaults;

/** いま効いているホットキー（変えていなければ既定。全部外した操作は、空） */
export function effectiveKeys(id: CommandId, over: Overrides): readonly string[] {
  return over[id] ?? defaultsOf(id);
}

/** 一覧の最後に足す（すでに在れば、そのまま）。読めないキーは、そのまま返す */
export function addKey(list: readonly string[], key: string): string[] {
  const n = normalizeHotkey(key);
  return n === null || list.includes(n) ? [...list] : [...list, n];
}

export const removeKey = (list: readonly string[], key: string): string[] => list.filter((k) => k !== key);

/** 一覧が既定と同じなら、保存しない（null） */
export function overrideOf(id: CommandId, list: readonly string[]): string[] | null {
  const d = defaultsOf(id).map((k) => normalizeHotkey(k) ?? k);
  return list.length === d.length && list.every((k, i) => k === d[i]) ? null : [...list];
}

/** 同じキーを持つ操作（キー → 操作の ID の並び。2 つ以上のものだけ） */
export function findConflicts(over: Overrides): Map<string, CommandId[]> {
  const by = new Map<string, CommandId[]>();
  for (const c of COMMANDS) {
    for (const k of effectiveKeys(c.id, over)) {
      const n = normalizeHotkey(k) ?? k;
      by.set(n, [...(by.get(n) ?? []), c.id]);
    }
  }
  for (const [k, ids] of [...by]) if (ids.length < 2) by.delete(k);
  return by;
}

/** 共有の部品に渡す、一覧の操作のホットキー */
export function explorerKeymap(over: Overrides): Keymap {
  return { search: effectiveKeys('search', over), open: effectiveKeys('open', over), rename: effectiveKeys('rename', over), clearSelection: effectiveKeys('clearSelection', over) };
}
