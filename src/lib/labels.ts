import type { FsErrorCode, FsPlace } from './fs/types';

// 利用者に見せる文（場所の名前・失敗の説明）。

/** 左の一覧の名前 */
export function placeLabel(p: FsPlace): string {
  switch (p.kind) {
    case 'home': return 'ホーム';
    case 'desktop': return 'デスクトップ';
    case 'documents': return 'ドキュメント';
    case 'downloads': return 'ダウンロード';
    case 'pictures': return 'ピクチャ';
    case 'music': return 'ミュージック';
    case 'videos': return 'ビデオ';
    case 'root': return 'コンピューター';
    case 'volume': return p.name || p.path;
  }
}

const ERROR_TEXT: Record<FsErrorCode, string> = {
  invalid: 'パスが正しくありません',
  not_found: '見つかりません',
  parent_missing: '親のフォルダがありません',
  exists: '同じ名前があります',
  same_path: '元と宛先が同じです',
  into_self: 'フォルダを、そのフォルダの中へは入れられません',
  denied: '権限がありません',
  not_dir: 'フォルダではありません',
  is_dir: 'フォルダです',
  not_empty: 'フォルダが空ではありません',
  unsupported: 'この操作はできません',
  partial: '途中までしかできませんでした',
  io: '読み書きに失敗しました',
  offline: '接続できません',
  tls: '証明書を確認できません',
  cert_changed: '証明書が、前に信頼したものと変わりました',
  auth: '認証が必要です（ユーザー名とパスワードを確かめてください）',
  precondition: '読んだあとに相手のファイルが変わっていたので、上書きしませんでした。再読み込みしてください',
  locked: '別の人が使っているので、変えられません',
  too_large: '大きすぎます',
  no_space: '置き場所に空きがありません',
  server: 'サーバーがうまく答えませんでした',
  aborted: '中止しました',
  keychain: 'キーチェーンが使えません',
};

/** 失敗の、利用者向けの短い説明 */
export function errorText(code: FsErrorCode): string {
  return ERROR_TEXT[code];
}
