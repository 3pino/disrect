import type { Component } from 'svelte';
import type { EntryIcon } from '@3pino/explorer-kit';
import { lucideIcon } from './lucideIcons.svelte';

// 見た目のルールで使うアイコン: lucide のすべて（lucideIcons.svelte.ts。名前は lucide のもの）と、アプリのロゴ（`logo`）。
// 保存するのは名前だけ。

export const LOGO_ICON = 'logo';

/** 以前の版で選べた名前（lucide の名前に直す） */
const ALIAS: Record<string, string> = { 'folder-git': 'folder-git-2', gamepad: 'gamepad-2', trash: 'trash-2' };

/** 保存した名前から、表示するアイコンにする。読み込み中・知らない名前は、undefined（既定のアイコンのまま） */
export function iconOf(name: string | undefined): EntryIcon | undefined {
  if (!name) return undefined;
  if (name === LOGO_ICON) return { src: '/icon.svg' };
  return lucideIcon(ALIAS[name] ?? name) as Component<{ size?: number | string }> | undefined;
}
