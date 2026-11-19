// `tauri icon` が作った Android のアイコン（src-tauri/icons/android）を、Android のプロジェクト（src-tauri/gen/android）へ写す。
// gen/android は一度作ったら更新されないので、アイコンを作り直したときに実行する（npm run tauri:icon が呼ぶ）。
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const from = 'src-tauri/icons/android';
const res = 'src-tauri/gen/android/app/src/main/res';
if (!existsSync(from) || !existsSync(res)) {
  console.error(`${from} か ${res} がありません`);
  process.exit(1);
}
for (const dir of readdirSync(from)) {
  // values/ic_launcher_background.xml は、アダプティブアイコン（mipmap-anydpi-v26）が使わないので写さない
  if (dir.startsWith('mipmap-')) cpSync(join(from, dir), join(res, dir), { recursive: true });
}
// プロジェクトを作ったときの、既定のアイコン（ベクター）。使わなくなったので消す
for (const old of ['drawable-v24/ic_launcher_foreground.xml', 'drawable/ic_launcher_background.xml']) rmSync(join(res, old), { force: true });
console.log('Android のアイコンを写しました');
