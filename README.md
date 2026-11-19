# fixplor

ファイルエクスプローラー（Windows のエクスプローラー・Ubuntu の Nautilus にあたるもの）。Tauri 2 + Svelte 5。
アカウントやサーバーは要りません（この端末のファイルだけでも動きます）。

## できること

- **ファイルの操作**: 見る・選ぶ・コピー・切り取り・貼り付け・ドラッグでの移動・名前の変更・新しいフォルダ・プロパティ。一覧とアイコンの表示、並べ替え、隠しファイルの表示の切り替え（フォルダごとの表示方法は、この端末に保存されます）。同じ名前があるときは、上書きする前に必ず確認します。
- **この端末とネットワークの場所（WebDAV）**: 左の「ネットワーク」から WebDAV のドライブを足して、この端末と同じように見られます。
  - Basic 認証が使えます。ユーザー名とパスワードは、OS のキーチェーン（Linux は Secret Service・Windows は資格情報マネージャー。Android は Android Keystore の鍵で包んだファイル）にだけ保管します。使えないときは「キーチェーンが使えません」と出て、保存しません（ほかの場所へは書きません）。
  - 自己署名・私的な認証局の証明書のサーバーは、案内の「証明書を確認する」で、SHA-256 の指紋と有効期限を確かめて、管理者から聞いた指紋と同じときだけ信頼できます（置き場所ごとの固定。違う証明書が示されたら、黙って受け入れず、確認を求めます）。
  - 暗号化されていない `http://` へは、パスワードを送りません（この端末の中の `http://` だけは使えます）。
  - 上書きは、サーバーの ETag で守ります（ほかの人が先に直していたら、止めて知らせます）。
- **タブ**: 複数のフォルダ・置き場所をタブで開けます（追加・閉じる・並べ替え・複製・前回の続きから）。Ctrl+T 新しいタブ・Ctrl+W 閉じる・Ctrl+Tab で切り替え・Ctrl+1〜9 で番号・真ん中のボタンで閉じる。フォルダをタブの欄へドラッグすると新しいタブで開きます。最大 20 個。狭い画面（Android）では、いまのタブの名前を押して一覧から選びます。
- **検索**: 虫めがね（Ctrl+F）。名前の絞り込み（いま開いているフォルダ）と、「サブフォルダも」（結果は、場所つきの一覧）。結果は、押すと開き、「場所を開く」でそのフォルダへ移れます。
  - この端末は、1000 件・調べた項目 30 万・深さ 64・60 秒までで止めます。ネットワークの場所は、サーバー側の検索が無いので、フォルダを 1 つずつ読みます（読むフォルダ 80・深さ 8・1000 件・60 秒まで）。上限で止めたときは、黙って切らず「途中までです」と理由を出します。
- **写真・PDF の拡大表示**: ダブルクリックで開きます（←→・スワイプで前後、Esc で閉じる。この端末もネットワークの場所も）。右上の「保存」は既定のアプリで開きます。
- **ゴミ箱**: デスクトップは OS のゴミ箱へ移します（このアプリからは戻せません。OS のゴミ箱から戻してください）。Android は、アプリの中のゴミ箱（内部ストレージの直下の `.fixplor-trash`）に入り、アプリから戻す・完全に消すができます。ゴミ箱の無い場所（ネットワークの場所など）では、「完全に削除します。元に戻せません」と確認してから消します。
- **Disnans のプラグイン**: [Disnans](https://github.com/3pino/disnans) の共有フォルダを、同じ画面で見られます（下の「Disnans のプラグイン」）。

## 対応

| | 状態 |
|---|---|
| Windows・Linux | 使えます（リリースあり） |
| Android | まもなく。アプリは作ってあり、エミュレーターで確かめた段階です。**最新のリリース（v0.1.2）には、まだ APK がありません**。出るのは、sideload（GitHub から APK を入れる）用で、Google Play には出しません。arm64・Android 7 以上（内部ストレージだけ。SD カードは、まだ見せません）。実機での確認が済むまで、候補です |
| macOS・iOS | 対応していません |

## インストール

[最新のリリース](https://github.com/3pino/fixplor/releases/latest)から、デバイスに合ったファイルをダウンロードします。

| デバイス | ファイル | 入れ方 |
|---|---|---|
| Windows | `fixplor_*_x64-setup.exe` | 実行してインストールする。「Windows によって PC が保護されました」と出たら「詳細情報」→「実行」 |
| Linux（Ubuntu / Debian） | `fixplor_*_amd64.deb` | `sudo apt install ./fixplor_*_amd64.deb` |
| Linux（その他） | `fixplor_*_amd64.AppImage` | `chmod +x` で実行権限を付けて起動する |
| Android（準備中） | `fixplor_*_android-arm64.apk` | 公開されたら: APK を端末に入れる（「不明なアプリのインストール」を許可）。初回に「すべてのファイルへのアクセス」を許可する |

- Windows のインストーラーは、コード署名をしていないので、上のような警告が出ます。
- アンインストール: Windows は「設定」→「アプリ」から。Linux の `.deb` は `sudo apt remove fixplor`。AppImage は、ファイルを消すだけです。

## 更新

- **Windows・Linux**: アプリが自分で更新を確認します（起動時と 6 時間おき。新しい版があればトーストで知らせます）。左下の「fixplor v…」→「バージョン情報」で、手でも確認でき、「ダウンロードして入れ替える」で入れ替わります（署名を確かめてから入れ替えます。設定は残ります）。更新の確認が入ったのは v0.1.1 からです。それより前の版（v0.1.0）は、同じ手順で入れ直してください。Linux の `.deb` は、入れ替えのときに権限を求められることがあります。
- **Android**（公開されたら）: アプリが GitHub の最新のリリースの APK を取り、Android のインストーラーへ渡します。今の版と同じ署名の APK だけが入ります。

## 使い方

- ファイルを開く: ダブルクリック（フォルダは中へ、ファイルは OS の既定のアプリで開きます）。
- 場所の移動: 上のバーの場所の欄に OS のパスを打つか、左の一覧（ホーム・ドキュメント・ダウンロード・ドライブなど）を選びます。戻る・上へ・読み直すも上のバーです。「戻る」は、上のバーの矢印、`Alt` + `←`、マウスの戻るボタン（Android は戻るボタン）。
- ネットワークの場所: 左の「ネットワーク」の ＋ から、名前と URL（`https://…/dav/`）を足します。鉛筆で、直す・一覧から外す（サーバーのファイルは消えません）。認証が要るときは、ユーザー名とパスワードも入れます（パスワードは、保存したあと画面へは戻りません。「パスワードを変更」で入れ直します）。認証が通らないときは、案内の「認証情報を入れ直す」から直せます。
- ネットワークの場所のファイルを既定のアプリで開くときは、この端末の一時のフォルダへ受け取ってから開きます（一時のファイルは、次の起動のときに、1 日より古いものを消します）。

## Disnans のプラグイン

Disnans のアプリには、fixplor のエクスプローラー（このリポジトリの `plugins/fixplor`）が、標準のプラグインとして同梱されています（無効にはできません）。Disnans の共有フォルダを、fixplor と同じ画面で見る・操作できます（開く入口は、ナビバーへ利用者が足します）。
プラグインにはタブはなく、ネットワークの場所もありません。サブフォルダの検索も、今は出しません（Disnans にはメッセージの検索が別にあります）。名前の絞り込みは使えます。
作り方・配り方・本体との口は [plugins/fixplor/README.md](plugins/fixplor/README.md)。

## リリース・更新（開発者向け）

新しい版を出す手順（版の上げ方・タグ・署名・確認・Android の鍵）は [docs/release.md](docs/release.md)。

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
| `src/lib/tabs.ts`・`src/components/TabBar.svelte` | タブ（保存・復元の決まりと、タブの欄） |
| `src/lib/fs/search.ts`・`src-tauri/src/fs/search.rs` | 検索（ネットワークの場所は手元で上限つき、この端末は Rust で流して返す） |
| `src/lib/updateBackend.ts`・`updateWatch.ts`・`stores/updater.svelte.ts` | アプリの更新（土台 `@3pino/app-kit-web` の Updater）。Android は `src-tauri/gen/android` と、アプリの中のプラグイン（Kotlin）で APK を取って渡す |
| `plugins/fixplor/` | Disnans のプラグイン（`plugins/fixplor/README.md`） |
| `src/App.svelte` | 外枠（上のバー・タブの欄・左の場所の一覧）。見た目は仮 |

### リリース

版は `package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml` の 3 か所を同じ値にして、同じ版のタグを打ちます（違うと `Release` が止まります）。
署名（Tauri の更新用）・`latest.json`・確認の仕方まで含めた手順は [docs/release.md](docs/release.md)。
Windows のインストーラー自体はコード署名していません（SmartScreen の警告が出ます）。
