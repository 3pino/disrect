// サーバーのエラーコード → 表示用の文言（本体の errors.ts と同じ文。本体の画面に合わせる）
const MESSAGES: Record<string, string> = {
  unauthorized: '認証できませんでした。Tailscale に接続しているか確かめてください',
  not_found: '見つかりませんでした',
  internal: 'サーバーでエラーが起きました',
  invalid_attachment: '添付ファイルが見つかりません。もう一度アップロードしてください',
  invalid_link: 'リンク先のファイルが見つかりません。削除されたか、名前が変わった可能性があります。リンクを直してから、もう一度送ってください',
  invalid_upload: 'アップロードに失敗しました',
  missing_file: 'ファイルがありません',
  aborted: '中止しました',
  disconnected: 'サーバーに届きませんでした',
  permission_denied: 'このプラグインには、共有フォルダを使う権限がありません',
};

/** 失敗を、利用者向けの文にする（code があれば、その文言。なければ、元の文） */
export function errorText(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  const message = e instanceof Error ? e.message : String(e);
  return MESSAGES[code] ?? message;
}
