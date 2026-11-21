import type { Entry, EntryStyle } from '@3pino/explorer-kit';
import { hueColor, lookOf, type AppearanceRule } from './rules';
import { iconOf } from './ruleIcons';

/** 一覧の項目に与える見た目（ルールが当たらなければ null）。ゴミ箱の仮想の項目には与えない */
export function entryStyleOf(e: Entry, rules: readonly AppearanceRule[]): EntryStyle | null {
  if (rules.length === 0 || e.trash) return null;
  const look = lookOf(e, rules);
  if (!look) return null;
  const icon = iconOf(look.icon);
  const color = look.color ?? (look.hue !== undefined ? hueColor(look.hue) : undefined);
  if (icon === undefined && color === undefined && look.opacity === undefined) return null;
  return { icon, color, opacity: look.opacity };
}
