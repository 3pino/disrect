import { parentOf } from '../path';
import type { DirIndexLike, DirState } from '../types';

/**
 * いま開いているフォルダ。中身は一覧の写し（DirIndexLike。変わったら読み直される）から引く。
 * 画面を開き直しても、最後に見ていたフォルダに戻る。
 */
export class ExplorerNav {
  dir = $state('');
  /** 前に開いていたフォルダ（古い順）。「戻る」で 1 つずつ戻る（ブラウザーの戻ると同じ） */
  history = $state.raw<string[]>([]);
  /** 「戻る」で戻る前に開いていたフォルダ（新しい順に、後ろへ積む）。「進む」で 1 つずつ戻る。ほかのフォルダを開くと捨てる */
  future = $state.raw<string[]>([]);

  constructor(private readonly index: DirIndexLike) {}

  /** フォルダを開く（一覧が手元になければ読む）。前のフォルダは「戻る」の履歴に積む */
  open(dir: string): void {
    if (dir !== this.dir) {
      this.history = [...this.history, this.dir];
      this.future = [];
    }
    this.dir = dir;
    this.index.ensure(dir);
  }

  /** 前に開いていたフォルダへ戻る。履歴が無ければ false */
  back(): boolean {
    const prev = this.history.at(-1);
    if (prev === undefined) return false;
    this.history = this.history.slice(0, -1);
    this.future = [...this.future, this.dir];
    this.dir = prev;
    this.index.ensure(prev);
    return true;
  }

  /** 「戻る」で戻ったフォルダへ、また進む。無ければ false */
  forward(): boolean {
    const next = this.future.at(-1);
    if (next === undefined) return false;
    this.future = this.future.slice(0, -1);
    this.history = [...this.history, this.dir];
    this.dir = next;
    this.index.ensure(next);
    return true;
  }

  /** 戻るの履歴を捨てる（画面を開き直したとき） */
  forgetHistory(): void {
    this.history = [];
    this.future = [];
  }

  /** 1 つ上のフォルダへ。いちばん上なら false（呼ぶ側で画面を閉じるなどする） */
  up(): boolean {
    if (this.dir === '') return false;
    this.open(parentOf(this.dir));
    return true;
  }

  /** 今のフォルダの一覧の状態（描画の中で読む。無ければ読み始める必要がある） */
  get state(): DirState | undefined {
    return this.index.state(this.dir);
  }

  /** 再読み込みを頼まれた回数（フォルダのサイズの写しを捨てる合図に使う） */
  reloads = $state(0);

  /**
   * 読み直す（失敗の「再読み込み」・F5）。`keepSizes` のときは、数えたフォルダのサイズを捨てない
   * （隠しファイルの表示を切り替えただけのときなど。フォルダの大きさは変わらない）
   */
  reload(keepSizes = false): void {
    if (!keepSizes) this.reloads++;
    this.index.invalidate(this.dir);
    this.index.ensure(this.dir);
  }

  /** いちばん上へ戻し、履歴を捨てる（置き場所が変わったとき） */
  reset(): void {
    this.dir = '';
    this.history = [];
    this.future = [];
  }
}
