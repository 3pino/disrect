// lucide の別名（昔の名前・別の呼び名）から、今の名前への対応を、src/lib/lucideAliases.json に書き出す。
// アイコンの絞り込み（別名でも見つかる）で使う。lucide を上げたときに、`node scripts/gen-lucide-aliases.mjs` で作り直す。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../node_modules/@lucide/svelte/dist/icons/', import.meta.url));
const out = fileURLToPath(new URL('../src/lib/lucideAliases.json', import.meta.url));
const map = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const name = f.slice(0, -3);
  const m = /export \{ default \} from "\.\/([^"]+)\.svelte";/.exec(readFileSync(dir + f, 'utf8'));
  if (m && m[1] !== name) map[name] = m[1];
}
writeFileSync(out, JSON.stringify(map, null, 1) + '\n');
console.log(`${Object.keys(map).length} 件`);
