import { read, write } from './settings.svelte';

// ブックマーク（左の欄の上の節）。置き場所（この端末・ネットワークの場所・SD カード）と、その中のフォルダを覚える。各デバイスに保存する。
// 初めて開いたときだけ、この端末のよく使うフォルダ（ホーム・ダウンロードなど）を入れる。そのあとは、追加も削除も利用者が決める（全部消しても、戻さない）。

export type Bookmark = { id: string; place: string; dir: string; name: string };

const KEY = 'fixplor.bookmarks';

/** 保存した文字から読む。壊れた項目は捨てる（同じ場所・フォルダの重なりも、1 つにする） */
export function parseBookmarks(raw: string | null): Bookmark[] {
  if (raw === null) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: Bookmark[] = [];
  for (const x of v) {
    const b = x as Partial<Bookmark> | null;
    if (!b || typeof b.id !== 'string' || typeof b.place !== 'string' || typeof b.dir !== 'string' || typeof b.name !== 'string' || b.name === '') continue;
    if (out.some((o) => o.id === b.id || (o.place === b.place && o.dir === b.dir))) continue;
    out.push({ id: b.id, place: b.place, dir: b.dir, name: b.name });
  }
  return out;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

class Bookmarks {
  /** 保存が一度も無い（初めて開いた）か */
  fresh = read(KEY) === null;
  list = $state.raw<Bookmark[]>(parseBookmarks(read(KEY)));

  private save(next: Bookmark[]): void {
    this.list = next;
    this.fresh = false;
    write(KEY, JSON.stringify(next));
  }

  find(place: string, dir: string): Bookmark | undefined {
    return this.list.find((b) => b.place === place && b.dir === dir);
  }

  /** 追加する（同じ場所・フォルダがあれば、何もしない） */
  add(place: string, dir: string, name: string): void {
    if (this.find(place, dir)) return;
    this.save([...this.list, { id: newId(), place, dir, name }]);
  }

  remove(id: string): void {
    this.save(this.list.filter((b) => b.id !== id));
  }

  /** id のブックマークを、targetId のブックマークがいる位置へ動かす（間にあるものは 1 つずつずれる。並べ替え） */
  moveTo(id: string, targetId: string): void {
    const from = this.list.findIndex((b) => b.id === id);
    const to = this.list.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...this.list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.save(next);
  }

  /** 置き場所を外したとき、その場所のブックマークも外す */
  removePlace(place: string): void {
    if (this.list.some((b) => b.place === place)) this.save(this.list.filter((b) => b.place !== place));
  }

  /** 初めて開いたときだけ、最初の一覧を入れる（保存が既にあれば、何もしない） */
  seed(initial: readonly Omit<Bookmark, 'id'>[]): void {
    if (!this.fresh) return;
    this.save(initial.map((b) => ({ ...b, id: newId() })));
  }

  /** 試験で、保存を差し替えたあと */
  reload(): void {
    this.fresh = read(KEY) === null;
    this.list = parseBookmarks(read(KEY));
  }
}

export const bookmarks = new Bookmarks();
