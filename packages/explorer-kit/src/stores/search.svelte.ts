import type { Entry, ExplorerApi, SearchOutcome } from '../types';
import { SEARCH_MAX_HITS } from '../types';

/** 名前に text を含むか（大文字小文字・全角半角の大文字小文字は区別しない。空の text は、すべて当たる） */
export function matchesName(name: string, text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '' || name.toLowerCase().includes(t);
}

/**
 * エクスプローラー 1 つ分の検索。
 *  - 名前の絞り込み（recursive が偽。「サブフォルダも」を外したとき・置き場所が探せないとき）: 開いているフォルダの一覧を、名前で絞る（置き場所には頼まない。ここは文字を持つだけ）。
 *  - サブフォルダも（既定。recursive が真・api.search がある置き場所だけ）: 置き場所に頼んで、見つかった順に hits へ溜める。
 *    文字・フォルダが変わるたび、前の検索は中止して、少し待ってから（delayMs）新しく始める。件数は SEARCH_MAX_HITS まで。
 */
export class ExplorerSearch {
  open = $state(false);
  text = $state('');
  recursive = $state(true);
  hits = $state.raw<Entry[]>([]);
  running = $state(false);
  /** 最後まで調べたか・途中で止めたか（検索が終わったら入る） */
  outcome = $state.raw<SearchOutcome | null>(null);
  /** 失敗の文（画面に出す） */
  error = $state<string | null>(null);

  #ctl: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: ExplorerApi,
    private readonly errorText: (e: unknown) => string,
    private readonly delayMs = 250,
  ) {}

  /** サブフォルダも探せる置き場所か */
  get available(): boolean {
    return this.api.search !== undefined;
  }

  /** 結果の一覧（サブフォルダも探している）を出すか。文字が無いうちは、フォルダの一覧のまま */
  get showingResults(): boolean {
    return this.open && this.recursive && this.available && this.text.trim() !== '';
  }

  /** 名前の絞り込みをするか（サブフォルダは探さない） */
  get filtering(): boolean {
    return this.open && !this.showingResults && this.text.trim() !== '';
  }

  /** 検索を（予約して）やり直す。文字・サブフォルダの切り替え・フォルダの変更のたびに呼ぶ */
  refresh(dir: string): void {
    this.#cancelRun();
    this.hits = [];
    this.outcome = null;
    this.error = null;
    if (!this.showingResults) return;
    this.running = true;
    this.#timer = setTimeout(() => void this.#run(dir), this.delayMs);
  }

  #cancelRun(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#ctl?.abort();
    this.#ctl = null;
    this.running = false;
  }

  async #run(dir: string): Promise<void> {
    this.#timer = null;
    const search = this.api.search;
    if (!search) return;
    const ctl = new AbortController();
    this.#ctl = ctl;
    try {
      const outcome = await search.call(
        this.api,
        { dir, text: this.text.trim() },
        {
          signal: ctl.signal,
          hits: (entries) => {
            if (ctl.signal.aborted) return;
            const room = SEARCH_MAX_HITS - this.hits.length;
            if (room <= 0) return;
            this.hits = [...this.hits, ...entries.slice(0, room)];
            // 画面の上限に達したら、止める（置き場所の上限より先に）
            if (this.hits.length >= SEARCH_MAX_HITS) {
              this.outcome = { partial: 'hits' };
              ctl.abort();
            }
          },
        },
      );
      if (!ctl.signal.aborted) this.outcome = outcome;
    } catch (e) {
      if (!ctl.signal.aborted) this.error = this.errorText(e);
    } finally {
      if (this.#ctl === ctl) {
        this.#ctl = null;
        this.running = false;
      }
    }
  }

  /** 閉じる（検索を止めて、文字も捨てる） */
  close(): void {
    this.#cancelRun();
    this.open = false;
    this.text = '';
    this.hits = [];
    this.outcome = null;
    this.error = null;
  }
}
