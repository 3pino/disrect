import type { EntryIcon } from '@3pino/explorer-kit';
import { lucideIcon, searchLucide } from './lucideIcons.svelte';

// 見た目のルールで使うアイコン: lucide のすべて（lucideIcons.svelte.ts。名前は lucide のもの）と、アプリのロゴ（`fixplor`）。
// ロゴも、lucide のアイコンと同じように、名前で探して選ぶ。保存するのは名前だけ。

/** アプリのロゴの名前（以前の版は `logo` で保存した。それも読める） */
export const LOGO_ICON = 'fixplor';
const isLogo = (name: string): boolean => name === LOGO_ICON || name === 'logo';

/** 新しく「アイコンを設定する」にしたときの、アイコンの名前 */
export const DEFAULT_ICON = 'file';

/** 保存した名前から、表示するアイコンにする。読み込み中・知らない名前は、undefined（既定のアイコンのまま） */
export function iconOf(name: string | undefined): EntryIcon | undefined {
  if (!name) return undefined;
  if (isLogo(name)) return { src: '/icon.svg' };
  return lucideIcon(name);
}

/** アイコンを、名前で絞り込む（lucide の別名でも探せる。ロゴは `fixplor`。合うロゴは先頭） */
export function searchIcons(query: string): string[] {
  const terms = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const logo = terms.every((t) => LOGO_ICON.includes(t)) ? [LOGO_ICON] : [];
  return [...logo, ...searchLucide(query)];
}
