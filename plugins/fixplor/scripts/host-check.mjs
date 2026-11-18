#!/usr/bin/env node
// 作った main.js を、Disnans の本物のプラグインのホスト（app/src/lib/plugins/host.svelte.ts）に読み込ませて、
// 実物の Chromium・本体の実物の画面（ナビバー・パネル・トースト・拡大表示）で動かす検査。
// 本体のコード・スクリプトは変えない（Disnans のリポジトリは読むだけ。vite・cdp.mjs・touch-fixture.mjs を、そこから借りる）。
// 注: fixplor はいまコアのプラグイン（本体が同梱して読む。同じ ID の開発用・配布は読まれない）。ここで入れる DevPlugin は無視され、読まれるのは本体が同梱した版。
//   （同梱版と作った main.js が同じかは、本体側の検査で cmp する）
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
  await S('Page.addScriptToEvaluateOnNewDocument', { source: fixtureScript({ server: FAKE, platform: 'linux' }) });
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url: APP });
  await waitFor(`document.querySelector('.nav-bar-side')`, 15000, 'ナビバー');
  await sleep(600);

  // 配るファイルそのものを、本体の本物のプラグインのホストへ入れる（開発用フォルダの経路と同じ DevPlugin の形）
  await evaluate(`(async () => {
    const { pluginHost } = await import('/src/lib/plugins/host.svelte.ts');
    window.__ph = pluginHost;
    pluginHost.dev = [{ folder: 'fixplor', stamp: '1', manifest: ${manifestText}, kind: 'plugin', manifestText: ${JSON.stringify(manifestText)}, main: ${JSON.stringify(mainJs)}, styles: ${JSON.stringify(stylesCss)}, theme: null, icon: null, error: null }];
    await pluginHost.reconcile();
    return true;
  })()`);

  await check('読み込める（エラーなし）。ナビバーに「ファイル」の項目が足される（本体の項目とは別の ID）', async () => {
    assert.equal(await evaluate(`window.__ph.errors.fixplor ?? null`), null);
    await waitFor(`window.__ph.runtime('fixplor')`);
    await waitFor(`document.querySelector('.nav-bar-side')`);
    const id = await evaluate(`(async () => (await import('/src/lib/pluginNav.svelte.ts')).pluginNav.entries.map((e) => e.id))()`);
    assert.deepEqual(id, ['ui-nav:fixplor:files']);
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

  await check('切り替え: 内蔵の「ファイル」の項目は出ず（「ファイル」はプラグインの 1 つだけ）、選ばれているのがその項目で、画面は plugin-panel の中', async () => {
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

  await check('コアのプラグインはオフにできない（setEnabled は無視される）', async () => {
    await evaluate(`window.__ph.setEnabled('fixplor', false)`);
    await sleep(500);
    assert.equal(await evaluate(`!!window.__ph.runtime('fixplor')`), true, 'オフになってしまった');
    assert.equal(await evaluate(`window.__ph.isEnabled('fixplor')`), true);
  });

  await check('外す（unload）と、ナビの項目・リンクの開き手・画面の購読が片付く', async () => {
    await evaluate(`window.__ph.unload('fixplor')`);
    await waitFor(`!window.__ph.runtime('fixplor')`);
    const left = await evaluate(`(async () => (await import('/src/lib/pluginNav.svelte.ts')).pluginNav.entries.length)()`);
    assert.equal(left, 0, 'ナビの項目が残っている');
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
