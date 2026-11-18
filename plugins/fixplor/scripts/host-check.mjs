#!/usr/bin/env node
// 作った main.js を、Disnans の本物のプラグインのホスト（app/src/lib/plugins/host.svelte.ts）に読み込ませて、
// 実物の Chromium・本体の実物の画面（ナビバー・パネル・トースト・拡大表示）で動かす検査。
// 本体のコード・スクリプトは変えない（Disnans のリポジトリは読むだけ。vite・cdp.mjs・touch-fixture.mjs を、そこから借りる）。
// 注: fixplor はいまコアのプラグイン（本体が同梱して読む。同じ ID の開発用・配布は読まれない）。同梱の版ではなく、いま作った成果物を確かめるため、
//   同梱のファイルの取得（/core-plugins/fixplor/*）を、CDP の Fetch で、作った成果物に差し替える（本体のコードは変えない）。
//   入口は、プラグインのコマンド（plugin-nav:fixplor:files）。利用者がナビバーに足した状態にして試す。
// 共有フォルダは、この検査が立てる仮のサーバー（メモリ上のフォルダ）。本物のサーバー・Tauri は要らない。
// 見た目の良し悪しは見ない（スクリーンショットなし）。
//
// 使い方（先に npm run build:plugin）:
//   DISNANS_APP=~/repos/disnans/app xvfb-run -a npm run check:host
//   （画面の窓を出さない環境で動かすこと。xvfb-run か、headless の Chromium）
//   （CHROME_BIN で Chromium を指定できる。無ければ puppeteer のキャッシュ）
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..');
const APP_DIR = (process.env.DISNANS_APP ?? join(homedir(), 'repos/disnans/app')).replace(/^~/, homedir());
if (!existsSync(join(APP_DIR, 'scripts/cdp.mjs'))) {
  console.error(`Disnans の app が見つかりません: ${APP_DIR}（DISNANS_APP で指定）`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(pluginRoot, 'manifest.json'), 'utf8'));
const dist = join(pluginRoot, '..', '..', 'dist-plugin', `${manifest.id}-${manifest.version}`);
if (!existsSync(join(dist, 'main.js'))) {
  console.error('成果物がありません（先に npm run build:plugin）');
  process.exit(2);
}
const mainJs = readFileSync(join(dist, 'main.js'), 'utf8');
const stylesCss = readFileSync(join(dist, 'styles.css'), 'utf8');
const manifestText = readFileSync(join(dist, 'manifest.json'), 'utf8');
const iconSvg = readFileSync(join(dist, 'icon.svg'), 'utf8');

const { connectCdp, launchChrome, makeProfile, openPage, stopChrome } = await import(pathToFileURL(join(APP_DIR, 'scripts/cdp.mjs')).href);
const { fixtureScript } = await import(pathToFileURL(join(APP_DIR, 'scripts/touch-fixture.mjs')).href);
const { createServer } = createRequire(join(APP_DIR, 'package.json'))('vite');

// ---- 仮のサーバー（共有フォルダ。/api/shared・/api/shared-trash・/api/shared-size・ファイルの中身・変更の知らせ） ----
const now = Date.now();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n',
);
const entry = (path, kind, size = 0, mime = null, file_id = null) => ({ name: path.split('/').pop(), path, kind, size, modified: now - 6e4, mime, message_id: null, file_id });
const fs = new Map([
  ['docs', entry('docs', 'dir')],
  ['attachments', entry('attachments', 'dir')],
  ['a.txt', entry('a.txt', 'file', 12, 'text/plain')],
  ['pic.png', entry('pic.png', 'file', PNG.length, 'image/png')],
  ['pic2.png', entry('pic2.png', 'file', PNG.length, 'image/png')],
  ['d.pdf', entry('d.pdf', 'file', PDF.length, 'application/pdf')],
  ['docs/memo.md', entry('docs/memo.md', 'file', 5, 'text/markdown')],
  ['attachments/att.txt', entry('attachments/att.txt', 'file', 3, 'text/plain', 'FILEID1')],
]);
const trash = new Map();
const requests = [];
const changedPaths = [];
const changed = (...p) => changedPaths.push(...p);
let seq = 0;
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const childrenOf = (dir) => [...fs.values()].filter((e) => parentOf(e.path) === dir);
const walk = (dir) => [...fs.values()].filter((e) => e.path.startsWith(dir ? dir + '/' : ''));
const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? undefined : JSON.stringify(body));
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);
  const body = (req.headers['content-type'] ?? '').includes('json') && raw.length ? JSON.parse(raw.toString()) : null;
  if (path !== '/__test/events') requests.push({ method: req.method, path, body });
  const rel = (prefix) => path.slice(prefix.length).replace(/^\//, '').replace(/\/$/, '');
  if (path === '/__test/events') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return json(res, 200, { next: changedPaths.length, paths: changedPaths.slice(since) });
  }
  if (req.method === 'GET' && (path === '/api/shared' || path.startsWith('/api/shared/'))) {
    const p = rel('/api/shared');
    if (p === '' || fs.get(p)?.kind === 'dir') return json(res, 200, { path: p, entries: childrenOf(p) });
    const e = fs.get(p);
    if (!e) return json(res, 404, { code: 'not_found', message: 'not found' });
    const data = e.mime === 'image/png' ? PNG : e.mime === 'application/pdf' ? PDF : Buffer.from('text');
    return void res.writeHead(200, { 'content-type': e.mime ?? 'application/octet-stream', 'content-length': data.length }).end(data);
  }
  if (req.method === 'POST' && path === '/api/shared' && body) {
    if (body.op === 'mkdir') {
      if (fs.has(body.path)) return json(res, 409, { code: 'exists', message: 'exists' });
      fs.set(body.path, entry(body.path, 'dir'));
      changed(body.path);
      return json(res, 200, fs.get(body.path));
    }
    if (body.op === 'move' || body.op === 'copy') {
      if (fs.has(body.to) && (!body.overwrite || fs.get(body.to).kind === 'dir')) return json(res, 409, { code: 'exists', message: 'exists' });
      for (const e of [fs.get(body.from), ...walk(body.from)].filter(Boolean)) {
        const np = body.to + e.path.slice(body.from.length);
        fs.set(np, { ...e, path: np, name: np.split('/').pop() });
        if (body.op === 'move') fs.delete(e.path);
      }
      changed(body.to, ...(body.op === 'move' ? [body.from] : []));
      return json(res, 200, fs.get(body.to));
    }
  }
  if (req.method === 'PUT' && path.startsWith('/api/shared/')) {
    const p = rel('/api/shared');
    fs.set(p, entry(p, 'file', raw.length));
    changed(p);
    return json(res, 200, fs.get(p));
  }
  if (req.method === 'POST' && path === '/api/shared-trash' && body) {
    if (body.op === 'trash') {
      const e = fs.get(body.path);
      if (!e) return json(res, 404, { code: 'not_found', message: 'not found' });
      const id = `01J${String(++seq).padStart(23, '0')}`;
      const items = [e, ...walk(body.path)];
      trash.set(id, { id, original_path: body.path, kind: e.kind, size: e.size, deleted_at: Date.now(), items });
      for (const x of items) fs.delete(x.path);
      changed(body.path);
      const { items: _i, ...view } = trash.get(id);
      return json(res, 200, view);
    }
    if (body.op === 'restore') {
      const t = trash.get(body.id);
      if (!t) return json(res, 404, { code: 'not_found', message: 'not found' });
      for (const x of t.items) fs.set(x.path, x);
      trash.delete(body.id);
      changed(t.original_path);
      return json(res, 200, fs.get(t.original_path));
    }
  }
  if (req.method === 'GET' && (path === '/api/shared-size' || path.startsWith('/api/shared-size/'))) {
    const p = rel('/api/shared-size');
    const items = fs.get(p)?.kind === 'file' ? [fs.get(p)] : walk(p);
    return json(res, 200, { size: items.reduce((n, e) => n + e.size, 0), files: items.filter((e) => e.kind === 'file').length, dirs: items.filter((e) => e.kind === 'dir').length });
  }
  json(res, 404, { code: 'not_found', message: `${req.method} ${path}` });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${server.address().port}`;

// ---- 本体（vite の開発サーバー）と Chromium ----
const vite = await createServer({ root: APP_DIR, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const profile = makeProfile('fixplor-host-');
let chrome, ws;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name) => console.log(`ok  ${name}`);
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    failed++;
    console.log(`NG  ${name}\n    ${String(e.message ?? e).split('\n').join('\n    ')}`);
  }
}

try {
  await vite.listen();
  const APP = `http://127.0.0.1:${vite.httpServer.address().port}/`;
  const launched = launchChrome(profile);
  chrome = launched.child;
  ws = await connectCdp(await launched.endpoint);
  const S = await openPage(ws);
  const evaluate = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 5000, label = expression) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await sleep(80);
    }
    throw new Error(`待ち切れませんでした: ${label}`);
  };
  const names = () => evaluate(`[...document.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent)`);
  const rowOf = (name) => `[...document.querySelectorAll('.file-explorer-item')].find((r) => r.querySelector('.file-explorer-name-text')?.textContent === ${JSON.stringify(name)})`;
  const since = (n) => requests.slice(n);

  await S('Page.enable');
  await S('Runtime.enable');
  const errors = [];
  ws.onMessage((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  // 同梱のファイルを、作った成果物へ差し替える
  const served = new Set();
  const core = { 'manifest.json': [manifestText, 'application/json'], 'main.js': [mainJs, 'text/javascript'], 'styles.css': [stylesCss, 'text/css'], 'icon.svg': [iconSvg, 'image/svg+xml'] };
  ws.onMessage((m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    const name = new URL(m.params.request.url).pathname.split('/').pop();
    const hit = core[name];
    const reply = hit
      ? S('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: hit[1] }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(hit[0]).toString('base64') })
      : S('Fetch.continueRequest', { requestId: m.params.requestId });
    if (hit) served.add(name);
    reply.catch(() => {});
  });
  await S('Fetch.enable', { patterns: [{ urlPattern: '*core-plugins/fixplor/*' }] });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: fixtureScript({ server: FAKE, platform: 'linux', navBarItems: ['app:open-chat', 'app:open-settings', 'plugin-nav:fixplor:files'] }) });
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url: APP });
  await waitFor(`document.querySelector('.nav-bar-side')`, 15000, 'ナビバー');
  await sleep(600);

  await evaluate(`(async () => { window.__ph = (await import('/src/lib/plugins/host.svelte.ts')).pluginHost; return true; })()`);

  await check('読み込める（エラーなし）。差し替えた成果物が読まれ、ナビバーに入口のコマンド（plugin-nav:fixplor:files）の「ファイル」が出る', async () => {
    await waitFor(`window.__ph.runtime('fixplor')`, 15000, 'プラグインの読み込み');
    assert.equal(await evaluate(`window.__ph.errors.fixplor ?? null`), null);
    assert(served.has('main.js') && served.has('styles.css'), `成果物に差し替わっていない: ${[...served]}`);
    await waitFor(`[...document.querySelectorAll('.nav-bar-side button')].some((b) => b.textContent.includes('ファイル'))`, 8000, 'ナビの「ファイル」');
    const hasCommand = await evaluate(`(async () => !!(await import('/src/lib/commands.svelte.ts').catch(() => null))?.findCommand?.('plugin-nav:fixplor:files'))()`);
    console.log(`    （コマンド plugin-nav:fixplor:files: ${hasCommand ? 'あり' : '確認できない（ナビの項目で代える）'}）`);
  });

  const navClick = () =>
    evaluate(`(() => { const b = [...document.querySelectorAll('.nav-bar-side button, .nav-bar-side [role=tab], .nav-bar-side a')].filter((x) => x.textContent.includes('ファイル')); b[b.length - 1].click(); return b.length; })()`);

  await check('項目を押すと、パネルに共有フォルダの一覧が出る（this.files → 本物の sharedApi → 仮のサーバー）', async () => {
    const mark = requests.length;
    assert((await navClick()) >= 1);
    await waitFor(`document.querySelector('.file-explorer-crumbs')`, 8000, '一覧の画面');
    await waitFor(`document.querySelectorAll('.file-explorer-name-text').length > 0`);
    assert.deepEqual(await names(), ['attachments', 'docs', 'a.txt', 'd.pdf', 'pic.png', 'pic2.png']);
    assert(since(mark).some((r) => r.method === 'GET' && r.path === '/api/shared'));
    assert.equal(await evaluate(`document.querySelector('.file-explorer-crumbs button').textContent`), '共有フォルダ');
  });

  await check('全画面の view（layout: full）: 本体の見出し（戻る・閉じる）は無く、入れ物の先頭はエクスプローラーそのもの（自分の .top-bar 行は無い。安全域は本体）', async () => {
    assert.equal(await evaluate(`!!document.querySelector('.plugin-panel-header')`), false, '本体の見出しが出ている');
    assert.equal(await evaluate(`!!document.querySelector('.shell-panel-full')`), true, '全画面の枠ではない');
    const first = await evaluate(`document.querySelector('.shell-panel-full .plugin-panel-body')?.firstElementChild?.className`);
    assert(String(first).split(' ').includes('file-explorer'), `先頭がエクスプローラーではない: ${first}`);
    // プラグインは安全域を扱わない（自分の .top-bar の行を持たない）。エクスプローラーの上のバー（PanelBar）の .top-bar は、本体が打ち消す
    assert.equal(await evaluate(`document.querySelectorAll('.shell-panel-full .plugin-panel-body > .top-bar').length`), 0, '入れ物の直下に自分の .top-bar の行がある');
    const fit = await evaluate(`(() => { const b = document.querySelector('.shell-panel-full .plugin-panel-body').getBoundingClientRect(); const e = document.querySelector('.file-explorer').getBoundingClientRect(); return { bodyBottom: b.bottom, bottom: e.bottom, top: e.top }; })()`);
    assert(fit.bottom <= fit.bodyBottom + 1, `エクスプローラーが枠からはみ出している: ${JSON.stringify(fit)}`);
  });

  await check('切り替え: 「ファイル」の項目は 1 つだけ（内蔵は無い）で、選ばれているのがその項目。画面は plugin-panel の中', async () => {
    const items = await evaluate(`[...document.querySelectorAll('.nav-bar-side button')].filter((b) => b.textContent.includes('ファイル')).map((b) => b.getAttribute('aria-current'))`);
    assert.deepEqual(items, ['page'], JSON.stringify(items));
    assert.equal(await evaluate(`!!document.querySelector('#plugin-panel[data-plugin="fixplor"] .file-explorer-crumbs')`), true);
  });

  await check('フォルダを開く（ダブルクリック）と、その中身を読む', async () => {
    await evaluate(`${rowOf('docs')}.querySelector('.file-explorer-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await waitFor(`document.querySelectorAll('.file-explorer-name-text').length === 1`);
    assert.deepEqual(await names(), ['memo.md']);
    assert(requests.some((r) => r.path === '/api/shared/docs'));
    await evaluate(`document.querySelector('.file-explorer-crumbs button').click()`);
    await waitFor(`document.querySelectorAll('.file-explorer-name-text').length === 6`);
  });

  await check('削除: 確認のあとゴミ箱へ（POST /api/shared-trash）。本物のトーストの「取り消す」で restore。一覧に戻る', async () => {
    const mark = requests.length;
    await evaluate(`${rowOf('a.txt')}.querySelector('.file-explorer-row').click()`);
    await evaluate(`document.querySelector('button[aria-label="削除"]').click()`);
    // 本物の確認ダイアログ（本体の ui.confirm）
    await waitFor(`[...document.querySelectorAll('.modal button, .confirm-dialog-actions button')].some((b) => b.textContent.trim() === 'ゴミ箱に移す')`, 5000, '確認ダイアログ');
    await evaluate(`[...document.querySelectorAll('.modal button, .confirm-dialog-actions button')].find((b) => b.textContent.trim() === 'ゴミ箱に移す').click()`);
    await waitFor(`!${rowOf('a.txt')}`);
    assert(since(mark).some((r) => r.method === 'POST' && r.path === '/api/shared-trash' && r.body?.op === 'trash' && r.body.path === 'a.txt'));
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '取り消す')`, 5000, '取り消す');
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取り消す').click()`);
    await waitFor(`${rowOf('a.txt')}`);
    assert(since(mark).some((r) => r.body?.op === 'restore'));
  });

  await check('画像を開く（ダブルクリック）と、本体の拡大表示。画像の URL は files.url（/api/shared/…）。前後へ移れて、Esc で閉じる', async () => {
    await evaluate(`${rowOf('pic.png')}.querySelector('.file-explorer-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await waitFor(`document.querySelector('.lightbox img')`, 5000, '拡大表示');
    const src = await evaluate(`document.querySelector('.lightbox img').getAttribute('src')`);
    assert(src.startsWith(`${FAKE}/api/shared/pic.png`), src);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
    await waitFor(`document.querySelector('.lightbox-file-name')?.textContent === 'pic2.png'`, 5000, '次の画像');
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(`!document.querySelector('.lightbox')`);
  });

  await check('一覧のサムネイルは、画像の URL（縮小版の指定は本体が決める）を <img> に使う', async () => {
    // アイコン表示にして、サムネイルを出す
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'メニュー').click()`);
    await evaluate(`[...document.querySelectorAll('[role=menuitem], .menu-item, button')].find((b) => b.textContent.trim().startsWith('アイコン')).click()`);
    await waitFor(`document.querySelector('.file-explorer-thumb img')`, 5000, 'サムネイル');
    const srcs = await evaluate(`[...document.querySelectorAll('.file-explorer-thumb img')].map((i) => i.getAttribute('src'))`);
    assert(srcs.every((s) => s.startsWith(`${FAKE}/api/shared/`)), JSON.stringify(srcs));
    assert.equal(await evaluate(`document.querySelectorAll('.file-explorer-thumb img').length`), 2);
  });

  await check('PDF の絵: 本体の renderPdfThumb が、箱（.fxp-pdf-thumb）の中に描く（pdf.js・画面に入ってから）', async () => {
    await waitFor(`document.querySelector('.fxp-pdf-thumb')`, 5000, 'PDF の箱');
    // pdf.js が 1 ページ目を描ければ <img>。描けなくてもファイルの絵（svg）が出ている
    await sleep(1500);
    const state = await evaluate(`(() => { const b = document.querySelector('.fxp-pdf-thumb'); return b.querySelector('img') ? 'img' : b.querySelector('svg') ? 'icon' : b.innerHTML.slice(0, 80); })()`);
    console.log(`    PDF の絵: ${state}`);
    assert(['img', 'icon'].includes(state), state);
  });

  await check('ほかの端末の変更（files.changed）で、開いているフォルダを読み直す', async () => {
    fs.set('new.txt', entry('new.txt', 'file', 1, 'text/plain'));
    changed('new.txt');
    await waitFor(`${rowOf('new.txt')}`, 5000, 'new.txt が出る');
  });

  await check('新しいフォルダ: 名前を入れて作る（POST mkdir）', async () => {
    const mark = requests.length;
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'メニュー').click()`);
    await evaluate(`[...document.querySelectorAll('[role=menuitem], .menu-item, button')].find((b) => b.textContent.trim() === '新しいフォルダ').click()`);
    await waitFor(`document.querySelector('.modal input, dialog input, [role=dialog] input')`, 5000, '名前の入力');
    await evaluate(`(() => { const i = document.querySelector('.modal input, dialog input, [role=dialog] input'); i.value = 'made'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(`[...document.querySelectorAll('.modal button, [role=dialog] button')].find((b) => /作成|OK|作る/.test(b.textContent)).click()`);
    await waitFor(`${rowOf('made')}`, 5000, 'made');
    assert(since(mark).some((r) => r.body?.op === 'mkdir' && r.body.path === 'made'));
  });

  await check('本文のファイルリンクの開き手が登録される。呼ぶと、そのフォルダを開く（フォルダならその中）', async () => {
    const opener = await evaluate(`(async () => { const m = await import('/src/lib/linkOpener.svelte.ts'); return typeof m.linkOpener(); })()`);
    assert.equal(opener, 'function');
    // 別の画面へ移ってから、リンクで戻る
    await evaluate(`(async () => { (await import('/src/lib/stores/ui.svelte.ts')).ui.selectTab('chat', true); })()`);
    await sleep(300);
    await evaluate(`(async () => { (await import('/src/lib/linkOpener.svelte.ts')).linkOpener()('docs/memo.md', null); })()`);
    await waitFor(`document.querySelector('.file-explorer-crumbs')`, 5000, '一覧の画面');
    await waitFor(`document.querySelectorAll('.file-explorer-name-text').length === 1 && document.querySelector('.file-explorer-name-text').textContent === 'memo.md'`, 5000, 'docs の中');
  });

  await check('フォルダごとの表示の保存: 表示を変えると、本体のプラグインのデータ（saveData）に入る', async () => {
    const keys = await evaluate(`Object.keys(localStorage).filter((k) => k.includes('fixplor'))`);
    assert(keys.length >= 1, JSON.stringify(keys));
    const text = await evaluate(`Object.entries(localStorage).filter(([k]) => k.includes('fixplor')).map(([, v]) => v).join('')`);
    assert(text.includes('explorerDirs'), text.slice(0, 200));
  });

  // モバイル（狭い画面・タッチ）: ナビバーは下のまま、設定を押せる（全画面の view を開いたまま）
  const navBottom = () => evaluate(`(() => { const nav = document.querySelector('#nav-bar'); if (!nav) return null; const b = nav.getBoundingClientRect(); const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { bottom: b.bottom, vh: window.innerHeight, visible: getComputedStyle(nav).display !== 'none' && b.height > 0, hit: !!at && nav.contains(at) }; })()`);
  const tap = async (word) => {
    const c = await evaluate(`(() => { const el = [...document.querySelectorAll('#nav-bar button')].find((b) => b.textContent.trim().includes(${JSON.stringify(word)})); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    assert(c, `ナビに「${word}」が無い`);
    await S('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    await S('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
  };
  await check('モバイル: ファイルを開いても、ナビバーは画面の下にあり覆われない。パネルはナビの上に収まる。先頭はエクスプローラー（自分の .top-bar 行は無い）', async () => {
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(500);
    await tap('Chat');
    await waitFor(`!document.querySelector('.shell-panel-full')`, 8000, 'チャットへ');
    await tap('ファイル');
    await waitFor(`document.querySelector('.shell-panel-full .file-explorer')`, 8000, 'ファイルの画面');
    await sleep(300);
    const g = await navBottom();
    assert(g.visible && g.hit, `ナビバーが見えない・覆われている: ${JSON.stringify(g)}`);
    assert(Math.abs(g.bottom - g.vh) < 2, `ナビバーが下に無い: ${JSON.stringify(g)}`);
    const over = await evaluate(`(() => document.querySelector('.shell-panel-full').getBoundingClientRect().bottom - document.querySelector('#nav-bar').getBoundingClientRect().top)()`);
    assert(over <= 1, `パネルがナビバーに重なる（${over}px）`);
    assert.equal(await evaluate(`!!document.querySelector('.plugin-panel-header')`), false);
  });

  await check('モバイル: ファイルを開いたまま「Settings」を押すと設定が出て、ナビは下のまま。「ファイル」を押し直すと開く', async () => {
    await tap('Settings');
    await waitFor(`!document.querySelector('.shell-panel-full')`, 8000, 'ファイルが閉じる');
    await waitFor(`document.querySelector('.shell-settings') && document.querySelector('.shell-settings').getBoundingClientRect().height > 0`, 8000, '設定の画面');
    const g = await navBottom();
    assert(g.visible && Math.abs(g.bottom - g.vh) < 2, `設定でナビが下に無い: ${JSON.stringify(g)}`);
    await tap('ファイル');
    await waitFor(`document.querySelector('.shell-panel-full .file-explorer')`, 8000, 'ファイルを押し直す');
    await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await S('Emulation.setTouchEmulationEnabled', { enabled: false });
    await sleep(500);
  });

  await check('コアのプラグインはオフにできない（setEnabled は無視される）', async () => {
    await evaluate(`window.__ph.setEnabled('fixplor', false)`);
    await sleep(500);
    assert.equal(await evaluate(`!!window.__ph.runtime('fixplor')`), true, 'オフになってしまった');
    assert.equal(await evaluate(`window.__ph.isEnabled('fixplor')`), true);
  });

  await check('外す（unload）と、ナビの項目（コマンド）・リンクの開き手が片付く', async () => {
    await evaluate(`window.__ph.unload('fixplor')`);
    await waitFor(`!window.__ph.runtime('fixplor')`);
    await waitFor(`![...document.querySelectorAll('.nav-bar-side button, #nav-bar button')].some((b) => b.textContent.includes('ファイル'))`, 8000, 'ナビの項目が消える');
    const opener = await evaluate(`(async () => (await import('/src/lib/linkOpener.svelte.ts')).linkOpener())()`);
    assert.equal(opener, null);
  });

  await check('ページのエラー（未処理の例外・console.error）が無い', async () => {
    const real = errors.filter((e) => !/favicon|Failed to load resource.*(404|net::)/i.test(e));
    assert.deepEqual(real, []);
  });
} finally {
  try {
    ws?.close();
  } catch {
    /* 終わり */
  }
  if (chrome) stopChrome(chrome, profile);
  server.close();
  await vite.close();
}
console.log(failed === 0 ? '全部通りました' : `${failed} 件が失敗しました`);
process.exit(failed === 0 ? 0 : 1);
