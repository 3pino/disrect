// タブの決まり（画面に依らない）。タブは「置き場所 + フォルダ」。保存・復元・並べ替え・閉じたあとの選び方・名前の付け方。

/** タブの数の上限（多すぎると、タブの欄に入らない・メモリを食う） */
export const MAX_TABS = 20;

/** 保存するタブ（いま見ている置き場所と、開いているフォルダ。選び・表示・戻る履歴は保存しない） */
export type SavedTab = { place: string; dir: string };
export type SavedTabs = { tabs: SavedTab[]; active: number };

export function serializeTabs(s: SavedTabs): string {
  return JSON.stringify({ v: 1, active: s.active, tabs: s.tabs.map((t) => ({ place: t.place, dir: t.dir })) });
}

/**
 * 保存した文字から読む。壊れた値・形の違う値は null（呼ぶ側は、1 つのタブで始める）。
 * exists は、その置き場所がいま在るか（外した置き場所のタブは、捨てる）。上限を超えた分も捨てる。
 */
export function parseSavedTabs(raw: string | null, exists: (place: string) => boolean): SavedTabs | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const { tabs, active } = v as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(tabs)) return null;
  const kept: SavedTab[] = [];
  let activeKept = -1;
  tabs.forEach((t: unknown, i) => {
    if (typeof t !== 'object' || t === null) return;
    const { place, dir } = t as { place?: unknown; dir?: unknown };
    if (typeof place !== 'string' || typeof dir !== 'string' || !exists(place) || kept.length >= MAX_TABS) return;
    if (i === active) activeKept = kept.length;
    kept.push({ place, dir });
  });
  if (kept.length === 0) return null;
  return { tabs: kept, active: activeKept >= 0 ? activeKept : 0 };
}

/** from の項目を to の位置へ動かした新しい並び（範囲の外・同じ位置は、そのまま） */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** index のタブを閉じたあとに選ぶタブの位置（閉じたあとの並びでの位置。右隣があれば右、なければ左）。閉じる前の個数が length */
export function indexAfterClose(index: number, length: number, activeIndex: number): number {
  if (index < activeIndex) return activeIndex - 1;
  if (index > activeIndex) return activeIndex;
  // いま見ているタブを閉じた: 右隣（閉じたあとは同じ位置）、右が無ければ左
  return Math.min(index, length - 2);
}

/** 次・前のタブの位置（端はつながる） */
export function cycleIndex(index: number, length: number, step: 1 | -1): number {
  return (index + step + length) % length;
}

/** タブの名前: 開いているフォルダの名前。いちばん上なら置き場所の名前 */
export function tabLabel(placeName: string, dir: string): string {
  if (dir === '') return placeName;
  const base = dir.slice(dir.lastIndexOf('/') + 1);
  return base === '' ? placeName : base;
}

/** 設定のタブの「置き場所」の名前（保存・復元で、置き場所のタブと並べて扱う） */
export const SETTINGS_PLACE = 'fixplor:settings';

/**
 * タブのドラッグが、ウィンドウの外へ落ちて終わったか（別のウィンドウで開くかの判定）。
 * どこにも受け取られず（dropEffect が none）、離した位置がウィンドウの外のとき。位置が分からない（0・0）ときは、外とは見なさない
 */
export function endedOutside(ev: { dropEffect: string; clientX: number; clientY: number; screenX: number; screenY: number }, size: { width: number; height: number }): boolean {
  if (ev.dropEffect !== 'none') return false;
  if (ev.clientX === 0 && ev.clientY === 0 && ev.screenX === 0 && ev.screenY === 0) return false;
  return ev.clientX < 0 || ev.clientY < 0 || ev.clientX > size.width || ev.clientY > size.height;
}
