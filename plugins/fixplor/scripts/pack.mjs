// 成果物をそろえる: dist-plugin/<id>-<version>/{manifest.json,main.js,styles.css,icon.svg} と SHA256SUMS。
// 配るのは、この 4 つだけ（合計 5 MB まで。icon.svg は 64 KB まで）。
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const out = join(root, '..', '..', 'dist-plugin', `${manifest.id}-${manifest.version}`);
if (!existsSync(join(out, 'main.js'))) throw new Error(`${out}/main.js がありません（先に vite build）`);

for (const f of ['manifest.json', 'icon.svg']) copyFileSync(join(root, f), join(out, f));
const files = ['manifest.json', 'main.js', 'styles.css', 'icon.svg'];
for (const f of files) if (!existsSync(join(out, f))) throw new Error(`${f} がありません`);

const total = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
if (total > 5 * 1024 * 1024) throw new Error(`合計が 5 MB を超えています: ${total}`);
if (statSync(join(out, 'icon.svg')).size > 64 * 1024) throw new Error('icon.svg が 64 KB を超えています');

const sums = files.map((f) => `${createHash('sha256').update(readFileSync(join(out, f))).digest('hex')}  ${f}`).join('\n') + '\n';
writeFileSync(join(out, 'SHA256SUMS'), sums);
console.log(sums.trimEnd());
console.log(`→ ${out}`);
