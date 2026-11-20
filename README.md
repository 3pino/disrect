# fixplor

ファイルエクスプローラー（Windows のエクスプローラー・Ubuntu の Nautilus にあたるもの）。Tauri 2 + Svelte 5。
アカウントやサーバーは要りません（この端末のファイルだけでも動きます）。

## Features

- WebDAV: 左の「ネットワーク」から WebDAV のドライブを足して、この端末と同じように見られます。Basic 認証が使えます。

## インストール

[最新のリリース](https://github.com/3pino/fixplor/releases/latest)から、デバイスに合ったファイルをダウンロードします。

| デバイス | ファイル | 入れ方 |
|---|---|---|
| Windows | `fixplor_*_x64-setup.exe` | 実行してインストールする。「Windows によって PC が保護されました」と出たら「詳細情報」→「実行」 |
| Linux（Ubuntu / Debian） | `fixplor_*_amd64.deb` | `sudo apt install ./fixplor_*_amd64.deb` |
| Linux（その他） | `fixplor_*_amd64.AppImage` | `chmod +x` で実行権限を付けて起動する |
| Android | `fixplor_*_android-arm64.apk` | APK を端末に入れる（「不明なアプリのインストール」を許可）。初回に「すべてのファイルへのアクセス」を許可する |

- アンインストール: Windows は「設定」→「アプリ」から。Linux の `.deb` は `sudo apt remove fixplor`。AppImage は、ファイルを消すだけです。

## 更新

- **Windows・Linux**: アプリが自分で更新を確認します（起動時と 6 時間おき。新しい版があればトーストで知らせます）。左下の「fixplor v…」→ 設定タブの「バージョン」で、手でも確認でき、「アップデート」でアップデートされます（署名を確かめてから入れ替えます。設定は残ります）。更新の確認が入ったのは v0.1.1 からです。それより前の版（v0.1.0）は、同じ手順で入れ直してください。Linux の `.deb` は、入れ替えのときに権限を求められることがあります。
- **Android**: アプリが GitHub の最新のリリースの APK を取り、Android のインストーラーへ渡します。今の版と同じ署名の APK だけが入ります。

## Disnans のプラグイン

Disnans のアプリには、fixplor のエクスプローラー（このリポジトリの `plugins/fixplor`）が、標準のプラグインとして同梱されています。Disnans の共有フォルダを、fixplor と同じ画面で見たり操作できます。

プラグイン版に無い機能
- タブ機能, ホームフォルダの閲覧

プラグイン版のみの機能
- Disnans の共有フォルダの閲覧

## リリース・更新（開発者向け）

新しい版を出す手順（版の上げ方・タグ・署名・確認・Android の鍵）は [docs/release.md](docs/release.md)。
開発の方法は [docs/development.md](docs/development.md)。

