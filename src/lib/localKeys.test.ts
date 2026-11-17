// localStorage の規則を止める（このアプリのソースだけを読む。試験は除く）。
// 1. 直接の localStorage / sessionStorage は使わない（土台の @3pino/app-kit-web/core/storage を通す）。
// 2. 使う fixplor.* のキーは、すべて localKeys.ts に登録してある。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCAL_KEYS, registeredKey } from './localKeys';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if ((name.endsWith('.ts') || name.endsWith('.svelte')) && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** コメントだけの行は、コードとして数えない */
const codeLines = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));

const FILES = sourceFiles(SRC).map((p) => ({ rel: relative(SRC, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

describe('localStorage の使い方', () => {
  it('走査は本体のソースを読めている（空振りで通らないように）', () => {
    expect(FILES.some((f) => f.rel === 'lib/settings.svelte.ts')).toBe(true);
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('直接の localStorage・sessionStorage のコードは無い（土台のストレージを通す）', () => {
    const bad = FILES.flatMap((f) => codeLines(f.text).filter((l) => /\b(localStorage|sessionStorage)\b/.test(l)).map((l) => `${f.rel}: ${l.trim()}`));
    expect(bad).toEqual([]);
  });

  it('コードにある fixplor.* のキーは、すべて登録してある（接頭辞は fixplor.）', () => {
    const used = new Set<string>();
    for (const f of FILES) for (const line of codeLines(f.text)) for (const m of line.matchAll(/'(fixplor\.[A-Za-z0-9_.-]*)'/g)) used.add(m[1]);
    expect([...used].length).toBeGreaterThan(0);
    expect([...used].filter((k) => !registeredKey(k))).toEqual([]);
    for (const rule of LOCAL_KEYS) expect(rule.key.startsWith('fixplor.')).toBe(true);
  });

  it('登録に無いキーは当たらない', () => {
    expect(registeredKey('fixplor.dirs')?.owner).toContain('settings');
    expect(registeredKey('fixplor.other')).toBeUndefined();
    expect(registeredKey('disnans.dirs')).toBeUndefined();
  });
});
