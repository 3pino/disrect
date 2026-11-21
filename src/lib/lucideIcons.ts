import ALIASES from './lucideAliases.json';
import NAMES from './lucideNames.json';

// lucide のアイコンの名前の一覧と、絞り込み。アイコンそのものは、共通の登録簿（@3pino/ui-kit-web/icons の Icon）が、名前から読み込む。
// 一覧（lucideNames.json）と別名（lucideAliases.json）は、`node scripts/gen-lucide-aliases.mjs` で作る。

/** 一覧に出すアイコンの名前（別名を除いた、本来の名前。名前順） */
export const LUCIDE_NAMES: readonly string[] = NAMES;

/** 名前と別名（昔の名前・別の呼び名）のどちらでも、その語がすべて含まれるか */
const matchesAll = (name: string, terms: string[]): boolean => terms.every((t) => name.includes(t) || name.replace(/-/g, '').includes(t));

/** 今の名前 → その別名の一覧 */
const aliasesOf = new Map<string, string[]>();
for (const [alias, canonical] of Object.entries(ALIASES)) aliasesOf.set(canonical, [...(aliasesOf.get(canonical) ?? []), alias]);

/**
 * 一覧を、名前で絞り込む（lucide の公式サイトと同じく、別名でも見つかる。カテゴリ・タグでの検索はしない）。
 * 語は空白で区切り、すべてを含むもの。`-` はあってもなくてもよい（`arrow up` で `arrow-up` が見つかる）。
 * 見つかるのは、いつも今の名前（別名で探しても、今の名前のアイコンが出る）。名前が前方一致するものを先に並べる
 */
export function searchLucide(query: string): string[] {
  const terms = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (terms.length === 0) return [...LUCIDE_NAMES];
  const byName = LUCIDE_NAMES.filter((n) => matchesAll(n, terms));
  const named = new Set(byName);
  const byAlias = LUCIDE_NAMES.filter((n) => !named.has(n) && (aliasesOf.get(n) ?? []).some((a) => matchesAll(a, terms)));
  const head = terms.join('-');
  return [...byName.filter((n) => n.startsWith(head)), ...byName.filter((n) => !n.startsWith(head)), ...byAlias];
}

/** そのアイコンの別名（昔の名前・別の呼び名） */
export const lucideAliases = (name: string): readonly string[] => aliasesOf.get(name) ?? [];

/** 別名なら今の名前に直す（今の名前・知らない名前は、そのまま） */
export const lucideCanonical = (name: string): string => (ALIASES as Record<string, string>)[name] ?? name;

/** その名前は、lucide のアイコン（今の名前か別名）か */
export const isLucideName = (name: string): boolean => (ALIASES as Record<string, string>)[name] !== undefined || LUCIDE_NAMES.includes(name);
