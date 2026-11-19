# fixplor プラグイン（Disnans 用）

Disnans の共有フォルダを、fixplor と同じエクスプローラーの部品（`@3pino/explorer-kit`）で見る・操作するプラグイン。
Disnans の標準のプラグイン（コアプラグイン）で、Disnans のアプリが、固定した版を同梱している（利用者は無効にできない。入口は、ナビバーへ利用者が足す）。

提供するもの: 共有フォルダの一覧・アイコン表示・並べ替え・コピー／切り取り／貼り付け・ドラッグでの移動・名前の変更・新しいフォルダ・プロパティ・ゴミ箱（Disnans の `.trash`。戻す・完全に消す）・アップロード・写真と PDF の拡大表示・名前の絞り込み・チャットのファイルリンクからフォルダを開く。
アプリ（fixplor）にあるタブ・ネットワークの場所（WebDAV）・サブフォルダの検索は、このプラグインにはない（Disnans にはメッセージの検索が別にある）。

- 画面と決まりは共有の部品。このプラグインは、その 2 つの口へ本体の実装を渡して、パネル（view）の `containerEl` に載せるだけ。
  - 置き場所（`ExplorerApi`）: `this.files`（共有フォルダ）→ `src/files-api.ts`、項目の URL → `src/urls.ts`（作るのは本体の `files.url`）
  - 本体から借りる機能（`ExplorerHost`）: `disnans.ui`（toast・confirm・onBack・openLightbox・clipboard・download・renderPdfThumb・openSearch・osDrop）→ `src/host.ts`
  - 添付フォルダの決まり（Disnans だけのもの）: `src/rules.ts`。フォルダごとの表示の保存: `src/store.svelte.ts`（`saveData`）
- Svelte の実行環境・部品は、全部 `main.js` の中へ入れる（本体と共有しない・コード分割しない）。PDF（pdf.js）は本体のものを使う（`ui.renderPdfThumb`・`ui.openLightbox`）ので、同梱しない。
- 本体の内部（`app/src/**`・Tauri）は import しない。検査: `npm run check:plugin`（ソースの import と、作った `main.js`）

## 作る

```sh
npm run build:plugin        # dist-plugin/fixplor-<版>/{manifest.json,main.js,styles.css,icon.svg} と SHA256SUMS
npm run check:plugin -- --dist
npx vitest run plugins     # 本体の偽物（src/test-support/fakeHost.ts）の上での試験。bundle.test.ts は、作った main.js そのものを動かす
DISNANS_APP=~/repos/disnans/app xvfb-run -a npm run check:host
                           # 作った main.js を、Disnans の本物のプラグインのホスト・本物の画面（Chromium）で動かす。
                           # 仮の共有フォルダのサーバーを立てる（Disnans のリポジトリは読むだけ。CI には入れない）
```

大きさ: `main.js` 約 183 KB（gzip 53 KB）・`styles.css` 約 12 KB（gzip 2 KB）。

## 配る

`plugin-fixplor-vX.Y.Z` のタグを打つと、`.github/workflows/plugin.yml` が成果物をそのタグのリリースに載せる（タグと `manifest.json` の版は同じに）。
Disnans は、このタグと `SHA256SUMS` の値を `core-plugins.lock.json` に固定して取り込む。

## 本体の口（API 20）

型は `src/sdk.ts`（使う分だけを写してある。Disnans の `packages/plugin-sdk/index.d.ts` の API 20 に合わせてある。`minApiVersion` は 20）。
使う口: `disnans.app.platform`、全画面でセッションのない view（`registerView(type, factory, { layout: 'full' })`。factory に null。本体の見出しは無い。**上端の安全域（ノッチ）は、本体が空ける。全画面の view は安全域を扱わない**＝自分の `.top-bar` の行を足さない）、入口のコマンド（`ui.navItem` の `view`。コマンド `plugin-nav:fixplor:files`。ナビバーへは利用者が足す）、`files`（`url`・`upload`・`size`・`caps`・`trash`・`restore`・`purge`）、
`ui`（`toast` の action・`openLightbox`・`renderPdfThumb`・`download`・`interceptDownload`・`openSearch`・`clipboard`・`osDrop`・`navItem`）、`chat.registerLinkOpener`、`legacyData`、`disnans.session.onServerChange`。
使わない口: 添付の選択（`ui.pickSharedFiles`。本体の画面が受け持つ）・チャットからのドラッグ（`ui.dragType`。部品の既定の型を本体が見分ける）・`saveBlob`（Blob の保存。Tauri は未対応のため）。
本文のファイルリンクは、そのファイルのあるフォルダを開く（フォルダならその中）。
