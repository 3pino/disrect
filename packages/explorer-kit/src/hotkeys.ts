// 一覧（エクスプローラーの部品）の操作のホットキー。キーの文字・イベントとの照合は、土台の `@3pino/app-kit-web/core/hotkeys`（ここからも、そのまま出す）。

export {
  formatHotkey,
  hotkeyFromEvent,
  hotkeyFromMouse,
  isPlainHotkey,
  matchesHotkey,
  matchesIgnoringShift,
  matchesMouse,
  normalizeHotkey,
  type KeyEventLike,
  type MouseEventLike,
} from '@3pino/app-kit-web/core/hotkeys';

export type ExplorerHotkeyId =
  | 'search'
  | 'editPath'
  | 'open'
  | 'rename'
  | 'clearSelection'
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'extendUp'
  | 'extendDown'
  | 'extendLeft'
  | 'extendRight'
  | 'selectFirst'
  | 'selectLast'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'trash'
  | 'delete'
  | 'newFile'
  | 'viewDetails'
  | 'viewGrid'
  | 'undo'
  | 'redo';
export type Keymap = Partial<Record<ExplorerHotkeyId, readonly string[]>>;

/** 既定のホットキー。部品の利用者は、`keymap` で置き換えられる（空の一覧は、キーを割り当てない） */
export const EXPLORER_HOTKEYS: Record<ExplorerHotkeyId, readonly string[]> = {
  search: ['Ctrl+F'],
  editPath: ['Ctrl+L'],
  open: ['Enter'],
  rename: ['F2'],
  clearSelection: ['Escape'],
  moveUp: ['ArrowUp'],
  moveDown: ['ArrowDown'],
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  extendUp: ['Shift+ArrowUp'],
  extendDown: ['Shift+ArrowDown'],
  extendLeft: ['Shift+ArrowLeft'],
  extendRight: ['Shift+ArrowRight'],
  selectFirst: ['Home'],
  selectLast: ['End'],
  selectAll: ['Ctrl+A'],
  copy: ['Ctrl+C'],
  cut: ['Ctrl+X'],
  paste: ['Ctrl+V'],
  trash: ['Delete'],
  delete: ['Shift+Delete'],
  newFile: [],
  viewDetails: [],
  viewGrid: [],
  undo: ['Ctrl+Z'],
  redo: ['Ctrl+Y', 'Ctrl+Shift+Z'],
};
