# disrect

ファイルエクスプローラー（Windows のエクスプローラー・Ubuntu の Nautilus にあたるもの）。Tauri 2 + Svelte 5。

この端末のファイルを扱う、単体で動くアプリです。Disnans のサーバーは無くても動きます（サーバーの共有フォルダは、あとで「場所」の 1 つとして足します）。

画面の本体（一覧・アイコン表示・選択・コピー／切り取り／貼り付け・ドラッグでの移動・名前の変更・ゴミ箱・プロパティ）は、
共有の部品 [@3pino/explorer-kit](https://github.com/3pino/explorer-kit) です。[disnans](https://github.com/3pino/disnans) の共有フォルダの画面と同じもので、
disnans はそこへ「サーバーの共有フォルダ」を、disrect は「この端末」を、置き場所として渡しています。全体の設計と進め方は [docs/design.md](docs/design.md)。

## 動かす

```sh
npm install
npm run tauri:dev      # 開発（http://localhost:1420）
npm run tauri:build    # 配布物
```

## 確かめる

```sh
npm run check                                                 # 型
npm test                                                      # 画面の側の試験（Rust は偽物）
npm run build
(cd src-tauri && cargo test && cargo clippy --all-targets)    # ファイル操作の試験
```

起動して Rust まで届いているかは、`DISRECT_TRACE=1` を付けて起動すると、呼ばれたコマンドの名前と結果が標準エラーに出ます（パスや中身は出しません）。

GitHub Actions: `CI`（型・試験・ビルド、Rust は Linux と Windows）、`Release`（`v` で始まるタグを打つと、Linux の deb・AppImage と Windows のインストーラーを作って GitHub のリリースに載せる。手で動かすと、作るだけ）。

## 構成

| 場所 | 中身 |
| --- | --- |
| `src-tauri/src/fs/` | ローカルのファイル操作（一覧・作成・書き込み・移動・コピー・ゴミ箱・大きさ・場所）。Tauri に依らない。決まりは `ops.rs` の先頭 |
| `src-tauri/src/lib.rs` | 上を呼ぶコマンド（`fs_*`） |
| `src/lib/fs/local.ts` | この端末を、共有の部品の置き場所（`ExplorerApi`）として見せる |
| `src/lib/fs/mapping.ts` | 画面のパス（相対・区切り `/`）と OS の絶対パスの対応（POSIX・Windows） |
| `src/lib/host.svelte.ts` | 共有の部品へ貸す本体の機能（通知・確認・戻る・ファイルを開く・クリップボード） |
| `src/App.svelte` | 外枠（上のバー・左の場所の一覧）。見た目は仮 |

## リリース

版は `package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml` の 3 か所を同じ値にして、同じ版のタグを打ちます（違うと `Release` が止まります）。

```sh
# 例: 0.1.1 を出す
git commit -am "v0.1.1: ..." && git tag v0.1.1 && git push origin main v0.1.1
```

署名はしていません（Windows は SmartScreen の警告が出ます）。自動更新も未対応です。
