# fixplor

ファイルエクスプローラー（Windows のエクスプローラー・Ubuntu の Nautilus にあたるもの）。Tauri 2 + Svelte 5。

- ファイルを見る・選ぶ・コピー・移動・名前の変更・削除（この端末では OS のゴミ箱へ）。
- この端末のほか、WebDAV のネットワークドライブも、左の「ネットワーク」から足して見られます（Basic 認証も使えます。ユーザー名とパスワードは OS のキーチェーンに保管します）。
- アカウントやサーバーは要りません（この端末のファイルだけでも動きます）。
- 対応: Windows / Linux（Android は未対応）

- 写真・PDF は、拡大表示で見られます（この端末も、ネットワークの場所も）。

ネットワークの場所の資格情報は、OS のキーチェーン（Linux は Secret Service・Windows は資格情報マネージャー）にだけ保管します。キーチェーンが使えない環境では、「キーチェーンが使えません」と出て、保存しません（ほかの場所へは書きません）。

## インストール

[最新のリリース](https://github.com/3pino/fixplor/releases/latest)から、デバイスに合ったファイルをダウンロードします。

| デバイス | ファイル | 入れ方 |
|---|---|---|
| Windows | `fixplor_*_x64-setup.exe` | 実行してインストールする。「Windows によって PC が保護されました」と出たら「詳細情報」→「実行」 |
| Linux（Ubuntu / Debian） | `fixplor_*_amd64.deb` | `sudo apt install ./fixplor_*_amd64.deb` |
| Linux（その他） | `fixplor_*_amd64.AppImage` | `chmod +x` で実行権限を付けて起動する |

- 署名していないので、Windows では上のような警告が出ます。
- 自動更新はありません。新しい版が出たら、同じ手順で入れ直してください（設定は残ります）。
- アンインストール: Windows は「設定」→「アプリ」から。Linux の `.deb` は `sudo apt remove fixplor`。AppImage は、ファイルを消すだけです。
- 隠しファイルの表示や、フォルダごとの表示方法は、この端末に保存されます。

## 使い方

- ファイルを開く: ダブルクリック（フォルダは中へ、ファイルは OS の既定のアプリで開きます）。
- 場所の移動: 上のバーの場所の欄に OS のパスを打つか、左の一覧（ホーム・ドキュメント・ダウンロード・ドライブなど）を選びます。戻る・上へ・読み直すも上のバーです。
- 「戻る」: 上のバーの矢印、`Alt` + `←`、マウスの戻るボタン。
- 消す: この端末では、OS のゴミ箱へ移します（このアプリからは戻せないので、OS のゴミ箱から戻してください）。ゴミ箱の無い場所（ネットワークの場所など）では、「完全に削除します。元に戻せません」と確認してから消します。
- ネットワークの場所: 左の「ネットワーク」の ＋ から、名前と URL（`https://…/dav/`）を足します。鉛筆で、直す・一覧から外す（サーバーのファイルは消えません）。認証が要るときは、ユーザー名とパスワードも入れます（パスワードは、保存したあと画面へは戻りません。「パスワードを変更」で入れ直します）。暗号化されていない `http://` へは、パスワードを送りません（この端末の中の `http://` だけは使えます）。認証が通らないときは、案内の「認証情報を入れ直す」から直せます。
- 写真・PDF: ダブルクリックで拡大表示（←→・スワイプで前後、Esc で閉じる）。右上の「保存」は、既定のアプリで開きます。ほかのファイルは、既定のアプリで開きます（ネットワークの場所のものは、この端末の一時のフォルダへ受け取ってから。一時のファイルは、次の起動のときに、1 日より古いものを消します）。
- 同じ名前があるときは、上書きする前に必ず確認します。

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
npm run check                                                 # 型
npm test                                                      # 画面の側の試験（Rust は偽物）
npm run build
(cd src-tauri && cargo test && cargo clippy --all-targets)    # ファイル操作の試験
```

起動して Rust まで届いているかは、`FIXPLOR_TRACE=1` を付けて起動すると、呼ばれたコマンドの名前と結果が標準エラーに出ます（パスや中身は出しません）。

GitHub Actions: `CI`（型・試験・ビルド、Rust は Linux と Windows）、`Release`（`v` で始まるタグを打つと、Linux の deb・AppImage と Windows のインストーラーを作って GitHub のリリースに載せる。手で動かすと、作るだけ）。

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
| `src/App.svelte` | 外枠（上のバー・左の場所の一覧）。見た目は仮 |

### リリース

版は `package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml` の 3 か所を同じ値にして、同じ版のタグを打ちます（違うと `Release` が止まります）。

```sh
# 例: 0.1.1 を出す
git commit -am "v0.1.1: ..." && git tag v0.1.1 && git push origin main v0.1.1
```

署名はしていません（Windows は SmartScreen の警告が出ます）。自動更新も未対応です。
