# fixplor プラグイン（Disnans 用）

Disnans の共有フォルダを、fixplor と同じエクスプローラーの部品（`@3pino/explorer-kit`）で見る・操作するプラグイン。
Disnans の本体に組み込みのエクスプローラーを置き換えるための土台（`docs/proposals/fixplor-independence.md` の段 5）。

- 画面と決まりは共有の部品。このプラグインは、その 2 つの口へ本体の実装を渡して、パネル（view）の `containerEl` に載せるだけ。
  - 置き場所（`ExplorerApi`）: `this.files`（共有フォルダ）→ `src/files-api.ts`、項目の URL → `src/urls.ts`（作るのは本体の `files.url`）
  - 本体から借りる機能（`ExplorerHost`）: `disnans.ui`（toast・confirm・onBack・openLightbox・clipboard・saveBlob・renderPdfThumb・openSearch）→ `src/host.ts`
  - 添付フォルダの決まり（Disnans だけのもの）: `src/rules.ts`。フォルダごとの表示の保存: `src/store.svelte.ts`（`saveData`）
- Svelte の実行環境・部品は、全部 `main.js` の中へ入れる（本体と共有しない・コード分割しない）。PDF（pdf.js）は本体のものを使う（`ui.renderPdfThumb`・`ui.openLightbox`）ので、同梱しない。
- 本体の内部（`app/src/**`・Tauri）は import しない。検査: `npm run check:plugin`（ソースの import と、作った `main.js`）

## 作る

```sh
npm run build:plugin        # dist-plugin/fixplor-<版>/{manifest.json,main.js,styles.css,icon.svg} と SHA256SUMS
npm run check:plugin -- --dist
npx vitest run plugins     # 本体の偽物（src/test-support/fakeHost.ts）の上での試験。bundle.test.ts は、作った main.js そのものを動かす
```

大きさ: `main.js` 約 174 KB（gzip 50 KB）・`styles.css` 約 11 KB（gzip 2 KB）。

## 配る

`plugin-fixplor-vX.Y.Z` のタグを打つと、`.github/workflows/plugin.yml` が成果物をそのタグのリリースに載せる（タグと `manifest.json` の版は同じに）。
Disnans は、このタグと `SHA256SUMS` の値を `core-plugins.lock.json` に固定して取り込む。

## 本体の口（API 19）

型は `src/sdk.ts`（使う分だけを写してある。Disnans の `packages/plugin-sdk/index.d.ts` の API 19 に合わせてある）。
使う口: セッションのない view（`registerView` の factory に null・`ui.navItem` の `view`）、`files`（`url`・`upload`・`size`・`caps`・`trash`・`restore`・`purge`）、
`ui`（`toast` の action・`openLightbox`・`renderPdfThumb`・`saveBlob`・`openSearch`・`clipboard`・`osDrop`）、`disnans.session.onServerChange`。
未対応: 本文のファイルリンクの開き（`chat.registerLinkOpener`）・添付の選択（`ui.pickSharedFiles`）・チャットからのドラッグ（`ui.dragType`）。本体側が出来てから足す。
