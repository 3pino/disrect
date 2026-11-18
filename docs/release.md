# リリースの手順（fixplor v X.Y.Z）

アプリ（デスクトップ）のリリースは、タグ `vX.Y.Z` を push すると `.github/workflows/release.yml` が行う。
Disnans のプラグイン（`plugin-fixplor-vX.Y.Z`）は別のタグ・別の流れ（`plugin.yml`。`plugins/fixplor/README.md`）。

## 1. 出す前に

1. 変更が `main` に入り、CI（`.github/workflows/ci.yml`）が通っている。
2. 版を上げる。**3 か所を同じ値に**する（タグと違うと、ワークフローが止める）:
   - `package.json` の `version`
   - `src-tauri/Cargo.toml` の `version`（上げたら、`cd src-tauri && cargo check` で `Cargo.lock` の fixplor の版も直して、いっしょにコミットする。CI は `--locked`）
   - `src-tauri/tauri.conf.json` の `version`
3. 手元で（できれば）: `npm run check && npm test && npm run build`、`cd src-tauri && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings`。
4. 版を上げたコミットを `main` に push し、CI が通るのを待つ。

## 2. 出す

```sh
git tag vX.Y.Z          # 上げた版と同じ（先頭に v）
git push origin vX.Y.Z  # ← これでリリースが始まる
```

ワークフローがやること（Disnans と同じ形。公開は最後の 1 回だけ）:

1. `version`: タグ・`package.json`・`Cargo.toml`・`tauri.conf.json` の版がそろっているか確かめる。
2. `create-release`: **下書き**のリリースを作る（自動のリリースノート付き）。
3. `bundle`（Linux・Windows 並列）: `createUpdaterArtifacts` を一時的に有効にして、署名つきでビルドし、下書きへ載せる
   （`.deb`・`.AppImage`・`x64-setup.exe` と、それぞれの `.sig`）。署名の鍵は Secrets（下の「鍵」）。
4. `publish`: 各 `.sig` から `latest.json` を作って添付し（`scripts/release-latest-json.sh`）、下書きを外して「最新（latest）」にする。

手動実行（Actions の Run workflow）は、作るだけ（リリースは作らず、署名もしない。成果物はアーティファクトに 14 日残る）。

## 3. 出したあとの確認

- リリースのページに、`fixplor_X.Y.Z_amd64.deb`・`…_amd64.AppImage`・`…_x64-setup.exe`・それぞれの `.sig`・`latest.json` がある。
- 「最新のリリース」がこのリリース（プラグインのリリースではない）。次の 1 行で見られる:
  `curl -sL https://github.com/3pino/fixplor/releases/latest/download/latest.json | jq '.version, (.platforms | keys)'`
  → `"X.Y.Z"` と 5 つの platform が出れば、アプリはこの版を見つけられる。
- 入れ替えの確認（実機。手元では確かめられない）: 1 つ前の版を入れて起動 →（起動時と 6 時間おきに確認。すぐ見るなら左下の「fixplor v…」→「バージョン情報」→「更新を確認」）→
  新しい版が出る → 「ダウンロードして入れ替える」→ 起動し直した版が X.Y.Z。Windows は passive インストール（進みだけ出る）、Linux は AppImage の入れ替え（`.deb` は、権限を求められることがある）。

## 4. 鍵（更新の署名）

- 署名は Tauri の更新用の鍵（minisign）。**公開鍵**は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey`。アプリは、この鍵で `.sig` を確かめてから入れ替える。
- **秘密鍵とそのパスワード**は、リポジトリの Secrets `TAURI_SIGNING_PRIVATE_KEY`・`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（と、リポジトリの外の安全な場所の控え）。リポジトリにも、ログにも出さない。
- **鍵をなくす・変えると**、すでに入れた利用者へ更新を配れなくなる（古い公開鍵では、新しい署名を確かめられない）。変えるなら、新しい公開鍵を入れた版を、**古い鍵で署名して**先に配り、そのあと鍵を切り替える。
- 作り直す（最初の 1 回）: `npm run tauri signer generate -- -w ~/.tauri/fixplor.key`（パスワードを付ける）。
- Windows のインストーラー自体のコード署名は、していない（SmartScreen の警告が出る）。これは更新の署名とは別のもの。

## 5. 注意・つまずきやすいところ

- **最初の更新対応版**: 更新の確認を入れる前の版（v0.1.0）には、更新の仕組みが無い。最初に更新対応の版を入れた利用者から、次の版以降は自動で見つかる（前の版からの確認は、更新対応の版を 2 つ出して初めて実地で確かめられる）。
- **「最新」はアプリのリリースだけ**: `releases/latest/download/latest.json` は「最新のリリース」の添付を指す。プラグインのリリース（`plugin-fixplor-v*`）が最新になると、`latest.json` が見つからず、更新の確認が止まる。
  `plugin.yml` は `--latest=false` で作る。手で作るときも同じにする。直すには: `gh release edit <タグ> --latest=false`、アプリのリリースに `gh release edit vX.Y.Z --latest`。
- `.sig` が無くて止まる: Secrets が無い・パスワードが違う。Actions のログで `bundle` の署名の段を見る。
- 下書きが残る: ワークフローが途中で止まると、下書きのリリースが残る。直して同じタグで再実行するなら、残った下書きとタグを消してから（`gh release delete vX.Y.Z --cleanup-tag`）。
- 更新の確認が失敗しても、アプリは使える（裏の確認は黙って失敗する。「バージョン情報」で手で確認すると、理由が出る）。
