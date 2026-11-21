import type { Component } from 'svelte';
import Archive from '@lucide/svelte/icons/archive';
import Bell from '@lucide/svelte/icons/bell';
import Book from '@lucide/svelte/icons/book';
import BookOpen from '@lucide/svelte/icons/book-open';
import Bookmark from '@lucide/svelte/icons/bookmark';
import Briefcase from '@lucide/svelte/icons/briefcase';
import Calendar from '@lucide/svelte/icons/calendar';
import Camera from '@lucide/svelte/icons/camera';
import Cloud from '@lucide/svelte/icons/cloud';
import Code from '@lucide/svelte/icons/code';
import Cpu from '@lucide/svelte/icons/cpu';
import Database from '@lucide/svelte/icons/database';
import Download from '@lucide/svelte/icons/download';
import FileArchive from '@lucide/svelte/icons/file-archive';
import FileAudio from '@lucide/svelte/icons/file-audio';
import FileCode from '@lucide/svelte/icons/file-code';
import FileImage from '@lucide/svelte/icons/file-image';
import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
import FileText from '@lucide/svelte/icons/file-text';
import FileVideo from '@lucide/svelte/icons/file-video';
import Film from '@lucide/svelte/icons/film';
import Flag from '@lucide/svelte/icons/flag';
import Folder from '@lucide/svelte/icons/folder';
import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
import Globe from '@lucide/svelte/icons/globe';
import HardDrive from '@lucide/svelte/icons/hard-drive';
import Heart from '@lucide/svelte/icons/heart';
import House from '@lucide/svelte/icons/house';
import ImageIcon from '@lucide/svelte/icons/image';
import Key from '@lucide/svelte/icons/key';
import Lock from '@lucide/svelte/icons/lock';
import Mail from '@lucide/svelte/icons/mail';
import Monitor from '@lucide/svelte/icons/monitor';
import Music from '@lucide/svelte/icons/music';
import Package from '@lucide/svelte/icons/package';
import Palette from '@lucide/svelte/icons/palette';
import Presentation from '@lucide/svelte/icons/presentation';
import Settings from '@lucide/svelte/icons/settings';
import Shield from '@lucide/svelte/icons/shield';
import Star from '@lucide/svelte/icons/star';
import Tag from '@lucide/svelte/icons/tag';
import Terminal from '@lucide/svelte/icons/terminal';
import Trash from '@lucide/svelte/icons/trash-2';
import User from '@lucide/svelte/icons/user';
import Video from '@lucide/svelte/icons/video';
import Wrench from '@lucide/svelte/icons/wrench';
import type { EntryIcon } from '@3pino/explorer-kit';

// 見た目のルールで選べるアイコン（lucide から、よく使うものだけ。全部を入れると大きくなるので、一覧で選ぶ）。
// `logo` は、アプリのロゴ（画像）。名前は、保存する値（変えない）。

export const LOGO_ICON = 'logo';

export type RuleIconDef = { name: string; label: string; icon: Component<{ size?: number | string }> };

export const RULE_ICONS: readonly RuleIconDef[] = [
  { name: 'folder', label: 'フォルダ', icon: Folder as unknown as RuleIconDef['icon'] },
  { name: 'folder-open', label: '開いたフォルダ', icon: FolderOpen as unknown as RuleIconDef['icon'] },
  { name: 'folder-git', label: 'Git のフォルダ', icon: FolderGit2 as unknown as RuleIconDef['icon'] },
  { name: 'monitor', label: 'モニター', icon: Monitor as unknown as RuleIconDef['icon'] },
  { name: 'house', label: 'ホーム', icon: House as unknown as RuleIconDef['icon'] },
  { name: 'download', label: 'ダウンロード', icon: Download as unknown as RuleIconDef['icon'] },
  { name: 'file-text', label: 'テキスト', icon: FileText as unknown as RuleIconDef['icon'] },
  { name: 'file-code', label: 'コード', icon: FileCode as unknown as RuleIconDef['icon'] },
  { name: 'file-image', label: '画像ファイル', icon: FileImage as unknown as RuleIconDef['icon'] },
  { name: 'file-audio', label: '音声ファイル', icon: FileAudio as unknown as RuleIconDef['icon'] },
  { name: 'file-video', label: '動画ファイル', icon: FileVideo as unknown as RuleIconDef['icon'] },
  { name: 'file-archive', label: '圧縮ファイル', icon: FileArchive as unknown as RuleIconDef['icon'] },
  { name: 'file-spreadsheet', label: '表計算', icon: FileSpreadsheet as unknown as RuleIconDef['icon'] },
  { name: 'presentation', label: 'プレゼン', icon: Presentation as unknown as RuleIconDef['icon'] },
  { name: 'image', label: '画像', icon: ImageIcon as unknown as RuleIconDef['icon'] },
  { name: 'music', label: '音楽', icon: Music as unknown as RuleIconDef['icon'] },
  { name: 'video', label: 'ビデオ', icon: Video as unknown as RuleIconDef['icon'] },
  { name: 'film', label: '映画', icon: Film as unknown as RuleIconDef['icon'] },
  { name: 'camera', label: 'カメラ', icon: Camera as unknown as RuleIconDef['icon'] },
  { name: 'book', label: '本', icon: Book as unknown as RuleIconDef['icon'] },
  { name: 'book-open', label: '開いた本', icon: BookOpen as unknown as RuleIconDef['icon'] },
  { name: 'archive', label: 'アーカイブ', icon: Archive as unknown as RuleIconDef['icon'] },
  { name: 'package', label: 'パッケージ', icon: Package as unknown as RuleIconDef['icon'] },
  { name: 'briefcase', label: '仕事', icon: Briefcase as unknown as RuleIconDef['icon'] },
  { name: 'calendar', label: 'カレンダー', icon: Calendar as unknown as RuleIconDef['icon'] },
  { name: 'mail', label: 'メール', icon: Mail as unknown as RuleIconDef['icon'] },
  { name: 'code', label: 'コード（記号）', icon: Code as unknown as RuleIconDef['icon'] },
  { name: 'terminal', label: 'ターミナル', icon: Terminal as unknown as RuleIconDef['icon'] },
  { name: 'cpu', label: 'CPU', icon: Cpu as unknown as RuleIconDef['icon'] },
  { name: 'database', label: 'データベース', icon: Database as unknown as RuleIconDef['icon'] },
  { name: 'hard-drive', label: 'ドライブ', icon: HardDrive as unknown as RuleIconDef['icon'] },
  { name: 'cloud', label: 'クラウド', icon: Cloud as unknown as RuleIconDef['icon'] },
  { name: 'globe', label: '地球', icon: Globe as unknown as RuleIconDef['icon'] },
  { name: 'gamepad', label: 'ゲーム', icon: Gamepad2 as unknown as RuleIconDef['icon'] },
  { name: 'palette', label: 'パレット', icon: Palette as unknown as RuleIconDef['icon'] },
  { name: 'settings', label: '設定', icon: Settings as unknown as RuleIconDef['icon'] },
  { name: 'wrench', label: '工具', icon: Wrench as unknown as RuleIconDef['icon'] },
  { name: 'key', label: '鍵', icon: Key as unknown as RuleIconDef['icon'] },
  { name: 'lock', label: '錠', icon: Lock as unknown as RuleIconDef['icon'] },
  { name: 'shield', label: '盾', icon: Shield as unknown as RuleIconDef['icon'] },
  { name: 'user', label: 'ユーザー', icon: User as unknown as RuleIconDef['icon'] },
  { name: 'star', label: '星', icon: Star as unknown as RuleIconDef['icon'] },
  { name: 'heart', label: 'ハート', icon: Heart as unknown as RuleIconDef['icon'] },
  { name: 'bookmark', label: 'しおり', icon: Bookmark as unknown as RuleIconDef['icon'] },
  { name: 'flag', label: '旗', icon: Flag as unknown as RuleIconDef['icon'] },
  { name: 'tag', label: 'タグ', icon: Tag as unknown as RuleIconDef['icon'] },
  { name: 'bell', label: '通知', icon: Bell as unknown as RuleIconDef['icon'] },
  { name: 'trash', label: 'ごみ箱', icon: Trash as unknown as RuleIconDef['icon'] },
];

/** 保存した名前から、表示するアイコンにする（知らない名前は、既定のアイコンのまま = undefined） */
export function iconOf(name: string | undefined): EntryIcon | undefined {
  if (!name) return undefined;
  if (name === LOGO_ICON) return { src: '/icon.svg' };
  return RULE_ICONS.find((i) => i.name === name)?.icon;
}
