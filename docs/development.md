
## 開発

画面の本体（一覧・アイコン表示・選択・コピー／切り取り／貼り付け・ドラッグでの移動・名前の変更・ゴミ箱・プロパティ）は、
共有の部品 `@3pino/explorer-kit`（このリポジトリの `packages/explorer-kit`。npm のワークスペース）です。
部品を使うアプリは、置き場所（一覧・書き込み・移動・ゴミ箱など）と、本体から借りる機能（通知・確認・クリップボードなど）を渡します。
fixplor は「この端末」を置き場所として渡しています（ほかのアプリも、同じ部品に自分の置き場所を渡せます）。全体の設計と進め方は [docs/design.md](docs/design.md)。

### 動かす

```sh
npm install            # ワークスペース（packages/explorer-kit）もいっしょに入る
npm run check && npm test   # アプリと部品の両方の型・試験
npm run tauri:dev      # 開発（http://localhost:1420）
npm run tauri:build    # 配布物
```

### 確かめる

```sh
npm run check                                                 # 型（アプリと部品）
npm test                                                      # 画面の側の試験（アプリ・部品。Rust は偽物）
npm run build
(cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings)   # Rust の試験
npm run build:plugin && npm run check:plugin -- --dist        # Disnans のプラグインを作って、本体を import していないか検査
xvfb-run -a npm run check:host                                # 作ったプラグインを、本物の Disnans の画面（Chromium）で動かす（要 Disnans のリポジトリ。plugins/fixplor/README.md）
```

起動して Rust まで届いているかは、`FIXPLOR_TRACE=1` を付けて起動すると、呼ばれたコマンドの名前と結果が標準エラーに出ます（パスや中身は出しません）。

GitHub Actions: `CI`（型・試験・ビルド。Rust は Linux と Windows。Android のデバッグ APK のコンパイルとプラグインの JVM 試験）、`Release`（`v` で始まるタグを打つと、Linux の deb・AppImage・Windows のインストーラー・Android の APK を署名つきで作り、`latest.json` と共に GitHub のリリースに載せる。手で動かすと、作るだけ）、`Plugin`（`plugin-fixplor-v` で始まるタグで、Disnans のプラグインを載せる）。

### 構成

| 場所 | 中身 |
| --- | --- |
| `src-tauri/src/fs/` | ローカルのファイル操作（一覧・作成・書き込み・移動・コピー・ゴミ箱・大きさ・場所）。Tauri に依らない。決まりは `ops.rs` の先頭 |
| `src-tauri/src/lib.rs` | 上を呼ぶコマンド（`fs_*`） |
| `src-tauri/src/webdav/` | WebDAV の操作（PROPFIND の解析・一覧・作成・上書き・移動・コピー・削除・大きさ・ダウンロード・進み具合と中止）。Tauri に依らない。手順と決まりは `client.rs` の先頭 |
| `src/lib/fs/webdav.ts` | ネットワークの場所を、共有の部品の置き場所として見せる |
| `src-tauri/src/webdav/secret.rs`・`proxy.rs` | 資格情報（OS のキーチェーン。偽物に差し替えられる入れ物）と、画像・PDF の中継（`fixdav` スキーム） |
| `src/lib/fs/creds.ts`・`sources.ts` | 資格情報の口（パスワードは Rust へ渡すだけ）・表示の URL から項目のパスをたどる |
| `src/components/Lightbox.svelte` | 拡大表示（土台の `@3pino/viewer-kit-web`）への、本体のつなぎ |
| `src/lib/places.svelte.ts` | 追加したネットワークの場所（名前と URL）の覚え |
| `src/lib/fs/local.ts` | この端末を、共有の部品の置き場所（`ExplorerApi`）として見せる |
| `src/lib/fs/mapping.ts` | 画面のパス（相対・区切り `/`）と OS の絶対パスの対応（POSIX・Windows） |
| `src/lib/host.svelte.ts` | 共有の部品へ貸す本体の機能（通知・確認・戻る・ファイルを開く・クリップボード）。通知・確認・戻るの状態と部品は、共有の土台 `@3pino/app-kit-web`（`/shell`）のもの |
| `src/lib/settings.svelte.ts`・`localKeys.ts` | 設定の保存（土台のストレージを通す。キーは `fixplor.` で、`localKeys.ts` に登録。試験が止める） |
| `src/lib/platformGlobal.ts`・`src-tauri/src/platform.rs` | Rust が `window.__FIXPLOR_PLATFORM__` に入れる OS の事実の名前を、土台（`core/platform`）へ教える |
| `src/lib/fs/pins.ts`・`src-tauri/src/webdav/pin.rs` | 証明書の指紋の固定（Rust の検証器と、確認・信頼の画面 `CertDialog.svelte`）。保管は設定フォルダの `dav-pins.json` |
| `src/lib/tabs.ts`・`src/components/TabBar.svelte`・`WindowControls.svelte`・`src/lib/windowControls.ts` | タブ（保存・復元の決まりと、タブの欄。デスクトップはタイトルバーを兼ねる。別のウィンドウで開く） |
| `src/components/SettingsView.svelte`・`src/lib/hotkeys.ts` | 設定のタブ（ホットキーの一覧・バージョンと更新） |
| `src/lib/fs/search.ts`・`src-tauri/src/fs/search.rs` | 検索（ネットワークの場所は手元で上限つき、この端末は Rust で流して返す） |
| `src/lib/updateBackend.ts`・`updateWatch.ts`・`stores/updater.svelte.ts` | アプリの更新（土台 `@3pino/app-kit-web` の Updater）。Android は `src-tauri/gen/android` と、アプリの中のプラグイン（Kotlin）で APK を取って渡す |
| `plugins/fixplor/` | Disnans のプラグイン（`plugins/fixplor/README.md`） |
| `src/App.svelte` | 外枠（タブの欄（タイトルバーを兼ねる）・左の場所の一覧（幅は、つまみで変えられる。Android の狭い画面は引き出し））。上のバー・場所の欄は無い（戻る・上へは道筋の行、再読み込みは F5、隠しファイルは ≡ のメニュー）。見た目は仮 |

### リリース

版は `package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml` の 3 か所を同じ値にして、同じ版のタグを打ちます（違うと `Release` が止まります）。
署名（Tauri の更新用）・`latest.json`・確認の仕方まで含めた手順は [docs/release.md](docs/release.md)。
Windows のインストーラー自体はコード署名していません（SmartScreen の警告が出ます）。
