import type { Rules } from '@3pino/explorer-kit';

/** Windows で使えない名前（予約名。拡張子があっても同じ） */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** 添付のフォルダの中の名前の決まり（本文のリンクの書き方と衝突する文字を避ける）。null なら使える */
function attachmentNameError(name: string): string | null {
  const t = name.trim();
  if (t === '') return '名前を入力してください';
  if (/[/\\[\]|\r\n]/.test(t)) return '名前に / \\ [ ] | と改行は使えません';
  return null;
}

/**
 * Disnans の共有フォルダの決まり（サーバーが最後に判定する。ここでは分かりやすい形で先に出す）。
 * specialDir は、本体が教える添付のフォルダ（`files.caps().attachmentsDir`）。
 */
export function createRules(specialDir: string | null): Rules {
  const inSpecial = (dir: string): boolean => specialDir !== null && (dir === specialDir || dir.startsWith(specialDir + '/'));
  return {
    specialDir,
    nameError(dir, name) {
      if (inSpecial(dir)) {
        const a = attachmentNameError(name);
        if (a) return a;
      }
      if (name.trim() === '') return '名前を入力してください';
      if (name === '.' || name === '..') return 'この名前は使えません';
      if (/[\\/:*?"<>|]/.test(name) || /[\u0000-\u001f]/.test(name)) return '名前に \\ / : * ? " < > | と改行は使えません';
      if (name.endsWith('.') || name.endsWith(' ')) return '名前の末尾に . や空白は使えません';
      if (name.startsWith('.disnans-')) return 'この名前は使えません';
      if (RESERVED.test(name)) return 'この名前は Windows で使えません';
      return null;
    },
    // 共有の部品は一般の文しか持たないので、Disnans の言葉（共有フォルダ・添付・本文のリンク）はここで渡す
    texts: {
      root: '共有フォルダ',
      reserved: '添付のフォルダは動かせません',
      crossMove: '共有フォルダと添付の間は移動できません（コピーしてください）',
      noSubfolder: '添付フォルダ内にフォルダは作れません',
      cutSkipped: '添付・ゴミ箱のフォルダは動かせないので除きました',
      trashNote: '添付のものは、本文のリンクが「削除されたファイル」になります',
      overwriteBody: '同じ添付の中身が入れ替わります。本文の表示も新しい中身になります。元に戻せません',
    },
  };
}
