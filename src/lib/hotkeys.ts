import { EXPLORER_HOTKEYS, normalizeHotkey, type ExplorerHotkeyId, type Keymap } from '@3pino/explorer-kit';

// このアプリのホットキー（操作ごとの既定と、利用者が変えた分の扱い）。画面に依らない。
// 一覧の操作（検索・開く・名前の変更・選びを外す）は、共有の部品が受ける（Keymap で渡す）。それ以外は、App.svelte が受ける。
// 変えた分は、既定と違う操作だけを保存する（既定が変わったとき、変えていない操作は追従する）。

export type AppCommandId =
  | 'tab.new'
  | 'tab.duplicate'
  | 'tab.close'
  | 'tab.next'
  | 'tab.prev'
  | 'tab.goto1'
  | 'tab.goto2'
  | 'tab.goto3'
  | 'tab.goto4'
  | 'tab.goto5'
  | 'tab.goto6'
  | 'tab.goto7'
  | 'tab.goto8'
  | 'tab.last'
  | 'app.settings'
  | 'app.quit'
  | 'nav.back'
  | 'nav.forward'
  | 'nav.up'
  | 'view.reload'
  | 'view.toggleHidden'
  | 'view.showHidden'
  | 'view.hideHidden'
  | 'file.copyPath'
  | 'file.openNewTab'
  | 'file.openNewWindow';

export type CommandId = AppCommandId | ExplorerHotkeyId;

export type Command = {
  id: CommandId;
  name: string;
  /** 設定の節（まとまり） */
  group: string;
  defaults: readonly string[];
  /** デスクトップだけ（Android の設定には出さない） */
  desktopOnly?: true;
};

/** 設定に出す順。節の名前 */
export const GROUPS = ['アプリ', 'タブ', '移動', '選択・編集', '表示'] as const;

const gotoTab = (n: number): Command => ({ id: `tab.goto${n}` as AppCommandId, name: `${n} 番目のタブへ`, group: 'タブ', defaults: [`Ctrl+${n}`] });

export const COMMANDS: readonly Command[] = [
  { id: 'app.settings', name: '設定を開く', group: 'アプリ', defaults: ['Ctrl+,', 'F12'] },
  { id: 'app.quit', name: '完全終了（すべてのウィンドウを閉じる）', group: 'アプリ', defaults: ['Ctrl+Q', 'Ctrl+Shift+W', 'Alt+F4'], desktopOnly: true },
  { id: 'file.openNewWindow', name: 'フォルダを新しいウィンドウで開く', group: 'アプリ', defaults: ['Ctrl+Shift+Enter'], desktopOnly: true },
  { id: 'tab.new', name: '新しいタブ', group: 'タブ', defaults: ['Ctrl+T'] },
  { id: 'tab.duplicate', name: 'タブを複製', group: 'タブ', defaults: [] },
  { id: 'tab.close', name: 'タブを閉じる（最後の 1 つなら、ウィンドウを閉じる）', group: 'タブ', defaults: ['Ctrl+W'] },
  { id: 'tab.next', name: '次のタブ', group: 'タブ', defaults: ['Ctrl+Tab', 'Ctrl+PageDown'] },
  { id: 'tab.prev', name: '前のタブ', group: 'タブ', defaults: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'] },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(gotoTab),
  { id: 'tab.last', name: '最後のタブへ', group: 'タブ', defaults: ['Ctrl+9'] },
  { id: 'file.openNewTab', name: 'フォルダを新しいタブで開く', group: 'タブ', defaults: ['Ctrl+Enter'] },
  { id: 'nav.back', name: '戻る', group: '移動', defaults: ['Alt+ArrowLeft', 'Mouse4'] },
  { id: 'nav.forward', name: '進む', group: '移動', defaults: ['Alt+ArrowRight', 'Mouse5'] },
  { id: 'nav.up', name: '上の階層へ', group: '移動', defaults: ['Ctrl+ArrowUp', 'Alt+ArrowUp'] },
  { id: 'editPath', name: '道筋（パス）を書き換える', group: '移動', defaults: EXPLORER_HOTKEYS.editPath },
  { id: 'open', name: '開く', group: '移動', defaults: EXPLORER_HOTKEYS.open },
  { id: 'search', name: '検索', group: '移動', defaults: EXPLORER_HOTKEYS.search },
  { id: 'moveUp', name: '上の項目へフォーカス', group: '移動', defaults: EXPLORER_HOTKEYS.moveUp },
  { id: 'moveDown', name: '下の項目へフォーカス', group: '移動', defaults: EXPLORER_HOTKEYS.moveDown },
  { id: 'moveLeft', name: '左の項目へフォーカス（アイコン表示）', group: '移動', defaults: EXPLORER_HOTKEYS.moveLeft },
  { id: 'moveRight', name: '右の項目へフォーカス（アイコン表示）', group: '移動', defaults: EXPLORER_HOTKEYS.moveRight },
  { id: 'selectAll', name: 'すべて選ぶ', group: '選択・編集', defaults: EXPLORER_HOTKEYS.selectAll },
  { id: 'clearSelection', name: '選択解除', group: '選択・編集', defaults: EXPLORER_HOTKEYS.clearSelection },
  { id: 'copy', name: 'コピー', group: '選択・編集', defaults: EXPLORER_HOTKEYS.copy },
  { id: 'cut', name: '切り取り', group: '選択・編集', defaults: EXPLORER_HOTKEYS.cut },
  { id: 'paste', name: '貼り付け', group: '選択・編集', defaults: EXPLORER_HOTKEYS.paste },
  { id: 'file.copyPath', name: 'パスをコピー', group: '選択・編集', defaults: ['Ctrl+Shift+C'] },
  { id: 'trash', name: 'ゴミ箱に移動', group: '選択・編集', defaults: EXPLORER_HOTKEYS.trash },
  { id: 'delete', name: '完全に削除', group: '選択・編集', defaults: EXPLORER_HOTKEYS.delete },
  { id: 'rename', name: '名前の変更', group: '選択・編集', defaults: EXPLORER_HOTKEYS.rename },
  { id: 'newFile', name: '新しいファイル', group: '選択・編集', defaults: EXPLORER_HOTKEYS.newFile },
  { id: 'undo', name: '元に戻す', group: '選択・編集', defaults: EXPLORER_HOTKEYS.undo },
  { id: 'redo', name: 'やり直し', group: '選択・編集', defaults: EXPLORER_HOTKEYS.redo },
  { id: 'view.reload', name: '再読み込み', group: '表示', defaults: ['F5'] },
  { id: 'view.toggleHidden', name: '隠しファイルの表示を切り替える', group: '表示', defaults: ['.'] },
  { id: 'view.showHidden', name: '隠しファイルを表示', group: '表示', defaults: [] },
  { id: 'view.hideHidden', name: '隠しファイルを非表示', group: '表示', defaults: [] },
  { id: 'viewGrid', name: 'アイコン表示', group: '表示', defaults: EXPLORER_HOTKEYS.viewGrid },
  { id: 'viewDetails', name: '詳細表示', group: '表示', defaults: EXPLORER_HOTKEYS.viewDetails },
];

/** アプリ側（App.svelte）が受ける操作。それ以外は、共有の部品（一覧）が受ける */
export const APP_COMMANDS: readonly Command[] = COMMANDS.filter((c) => !(c.id in EXPLORER_HOTKEYS));

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
  const map: Keymap = {};
  for (const id of Object.keys(EXPLORER_HOTKEYS) as ExplorerHotkeyId[]) map[id] = effectiveKeys(id, over);
  return map;
}
