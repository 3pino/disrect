import type { Component } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

// lucide のアイコン全部（約 2000 個）を、名前で呼べるようにする。
// 全部を先に読み込むと大きいので、使うときに 1 つずつ読む（Vite の import.meta.glob。キーだけを先に持つ）。
// 読み込みが終わるまでは undefined（読み込みが終わると、読んでいた画面が、自動で描き直される）。

type Loader = () => Promise<{ default: Component<{ size?: number | string }> }>;

const LOADERS = import.meta.glob('/node_modules/@lucide/svelte/dist/icons/*.js') as Record<string, Loader>;
// 別名（lucide が名前を変えたもの）も含む。名前は、ファイル名から拡張子を除いたもの
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(js|svelte)$/, '');
const byName = new Map(Object.entries(LOADERS).map(([path, load]) => [nameOf(path), load]));

/** 一覧に出すアイコンの名前（別名を除いた、本来の名前。名前順） */
export const LUCIDE_NAMES: readonly string[] = Object.keys(import.meta.glob('/node_modules/@lucide/svelte/dist/icons/*.svelte'))
  .map(nameOf)
  .sort();

const loaded = new SvelteMap<string, Component<{ size?: number | string }>>();
const pending = new Set<string>();

/** 名前から、アイコンの部品を得る。まだ読み込んでいなければ読み込みを始めて undefined（知らない名前は、ずっと undefined） */
export function lucideIcon(name: string): Component<{ size?: number | string }> | undefined {
  const got = loaded.get(name);
  if (got) return got;
  const load = byName.get(name);
  if (load && !pending.has(name)) {
    pending.add(name);
    void load()
      .then((m) => loaded.set(name, m.default))
      .catch(() => {})
      .finally(() => pending.delete(name));
  }
  return undefined;
}

/** その名前のアイコンがあるか（別名も含む） */
export const hasLucideIcon = (name: string): boolean => byName.has(name);

/**
 * 一覧を、名前で絞り込む（lucide の公式サイトと同じく、名前に含まれる語で）。
 * 語は空白で区切り、すべてを含むもの。`-` はあってもなくてもよい（`arrow up` で `arrow-up` が見つかる）。前方一致の名前を先に並べる
 */
export function searchLucide(query: string): string[] {
  const terms = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (terms.length === 0) return [...LUCIDE_NAMES];
  const hit = LUCIDE_NAMES.filter((n) => terms.every((t) => n.replace(/-/g, '').includes(t) || n.includes(t)));
  const head = terms.join('-');
  return [...hit.filter((n) => n.startsWith(head)), ...hit.filter((n) => !n.startsWith(head))];
}
