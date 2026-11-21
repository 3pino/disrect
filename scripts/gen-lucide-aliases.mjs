// lucide の名前の一覧と別名（昔の名前・別の呼び名）を、src/lib/ に書き出す。アイコンの絞り込み（別名でも見つかる）で使う。
//   lucideNames.json   本来の名前の一覧（名前順）
//   lucideAliases.json 別名 → 今の名前
// アイコンそのものは、共通の登録簿（@3pino/ui-kit-web/icons）が、名前から読み込む。
// lucide を上げたときに、`node scripts/gen-lucide-aliases.mjs` で作り直す。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../node_modules/@lucide/svelte/dist/icons/', import.meta.url));
const at = (name) => fileURLToPath(new URL(`../src/lib/${name}`, import.meta.url));
const files = readdirSync(dir);
const names = files.filter((f) => f.endsWith('.svelte')).map((f) => f.slice(0, -'.svelte'.length)).sort();
const aliases = {};
for (const f of files.filter((f) => f.endsWith('.js')).sort()) {
  const name = f.slice(0, -3);
  const m = /export \{ default \} from "\.\/([^"]+)\.svelte";/.exec(readFileSync(dir + f, 'utf8'));
  if (m && m[1] !== name) aliases[name] = m[1];
}
writeFileSync(at('lucideNames.json'), JSON.stringify(names) + '\n');
writeFileSync(at('lucideAliases.json'), JSON.stringify(aliases, null, 1) + '\n');
console.log(`名前 ${names.length} 件、別名 ${Object.keys(aliases).length} 件`);
