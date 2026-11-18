// プラグインの境界の検査（本体の中身へ手を伸ばさない・成果物が 1 つで完結している）。
//  1. ソース（plugins/fixplor/src、試験を除く）の import は、相対・svelte・@lucide/svelte・@3pino/*（共有の部品）だけ
//  2. 成果物の main.js は、import / export … from / 動的 import / require を 1 つも持たない（全部同梱）。Tauri の内部も参照しない
//  3. manifest.json の決まり（id・版・minApiVersion・permissions）
// 使い方: node plugins/fixplor/scripts/check-boundary.mjs [--dist]   （--dist で成果物も見る。先に build:plugin）
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const ALLOWED = [/^\.{1,2}\//, /^svelte$/, /^svelte\//, /^@lucide\/svelte\//, /^@3pino\//];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * ソースの中の import の相手（`import x from 'a'`・`import 'a'`・`export … from 'a'`・`import('a')`・`require('a')`）。型だけの import も同じに見る
 * @param {string} src @returns {string[]}
 */
export function specifiers(src) {
  /** @type {string[]} */
  const out = [];
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const m of text.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/** @param {string} file @param {string} src @returns {string[]} */
export function sourceProblems(file, src) {
  return specifiers(src)
    .filter((s) => !ALLOWED.some((re) => re.test(s)))
    .map((s) => `${file}: 使えない import です: '${s}'（許すのは 相対・svelte・@lucide/svelte・@3pino/*）`);
}

/**
 * 成果物（1 つにまとめた main.js）の検査
 * @param {string} file @param {string} js @returns {string[]}
 */
export function bundleProblems(file, js) {
  /** @type {string[]} */
  const out = [];
  if (/(?:^|[;}\n])\s*import\s*(?:[{*\w$][^;\n"'`]*?from\s*)?["'`]/.test(js)) out.push(`${file}: import 文があります（全部同梱するはず）`);
  if (/\bexport\s*(?:\{[^}]*\}|\*)\s*from\s*["']/.test(js)) out.push(`${file}: export … from があります`);
  if (/\bimport\s*\(/.test(js)) out.push(`${file}: 動的 import があります（コード分割をしない）`);
  if (/\brequire\s*\(/.test(js)) out.push(`${file}: require があります`);
  for (const needle of ['@tauri-apps', '__TAURI']) {
    if (js.includes(needle)) out.push(`${file}: '${needle}' を参照しています（本体の内部には触らない）`);
  }
  return out;
}

/** @param {Record<string, any>} m @returns {string[]} */
export function manifestProblems(m) {
  /** @type {string[]} */
  const out = [];
  if (!/^[a-z0-9-]{2,32}$/.test(m.id ?? '')) out.push('manifest.json: id は英小文字・数字・ハイフン（2〜32 文字）');
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) out.push('manifest.json: version は 1.2.3 の形');
  if (!Number.isInteger(m.minApiVersion) || m.minApiVersion < 20) out.push('manifest.json: minApiVersion は 20 以上（全画面の view・コマンドの入口を使う）');
  if (!Array.isArray(m.permissions) || !m.permissions.includes('files')) out.push('manifest.json: permissions に "files" が要る');
  for (const k of ['name', 'description', 'author']) if (!m[k]) out.push(`manifest.json: ${k} が無い`);
  return out;
}

/** @param {string[]} argv @returns {string[]} */
export function run(argv) {
  /** @type {string[]} */
  const problems = [];
  for (const f of walk(join(root, 'src'))) {
    if (/\.test\.ts$/.test(f) || f.includes('/test-support/') || !/\.(ts|svelte|js)$/.test(f)) continue;
    problems.push(...sourceProblems(relative(root, f), readFileSync(f, 'utf8')));
  }
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  problems.push(...manifestProblems(manifest));
  if (argv.includes('--dist')) {
    const js = join(root, '..', '..', 'dist-plugin', `${manifest.id}-${manifest.version}`, 'main.js');
    if (!existsSync(js)) problems.push(`${js} がありません（先に npm run build:plugin）`);
    else problems.push(...bundleProblems('main.js', readFileSync(js, 'utf8')));
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = run(process.argv.slice(2));
  if (found.length > 0) {
    console.error(found.join('\n'));
    process.exit(1);
  }
  console.log('プラグインの境界: 問題なし');
}
