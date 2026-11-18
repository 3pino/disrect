#!/usr/bin/env bash
# 使い方: scripts/release-latest-json.sh <TAG> <VERSION> <REPO>  → ./latest.json を作る
# リリースの各 .sig（Tauri の署名。ビルドのとき秘密鍵で作る）から、アプリの更新の情報（latest.json）を作る。
# アプリ（tauri-plugin-updater）は https://github.com/<REPO>/releases/latest/download/latest.json を読み、
# 同じ置き場の .sig の署名を、tauri.conf.json の公開鍵で確かめてから入れ替える。
# ビルドは OS ごとに並列なので、各ジョブには latest.json を書かせず、公開の前にここでまとめて作る。
set -euo pipefail
TAG=$1; VERSION=$2; REPO=$3
dir=$(mktemp -d)
gh release download "$TAG" --repo "$REPO" --dir "$dir" --pattern '*.sig'
# URL は、このリリース（タグ）のものに固定する。あとから次の版が公開されても、URL と署名の組は変わらない。
base="https://github.com/$REPO/releases/download/$TAG"
APPIMAGE="fixplor_${VERSION}_amd64.AppImage"
DEB="fixplor_${VERSION}_amd64.deb"
NSIS="fixplor_${VERSION}_x64-setup.exe"
for f in "$APPIMAGE" "$DEB" "$NSIS"; do
  test -s "$dir/$f.sig" || { echo "::error::$f.sig がありません"; exit 1; }
done
jq -n --arg v "$VERSION" --arg date "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  --arg ai "$base/$APPIMAGE" --rawfile ais "$dir/$APPIMAGE.sig" \
  --arg deb "$base/$DEB" --rawfile debs "$dir/$DEB.sig" \
  --arg ns "$base/$NSIS" --rawfile nss "$dir/$NSIS.sig" \
  '{version:$v, notes:"", pub_date:$date, platforms:{
     "linux-x86_64":{signature:$ais,url:$ai},
     "linux-x86_64-appimage":{signature:$ais,url:$ai},
     "linux-x86_64-deb":{signature:$debs,url:$deb},
     "windows-x86_64":{signature:$nss,url:$ns},
     "windows-x86_64-nsis":{signature:$nss,url:$ns}}}' > latest.json
