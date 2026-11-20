<script lang="ts" module>
  /** 左の欄の 1 項目（ブックマーク・ドライブ・ネットワークの場所） */
  export type NavEntry = {
    key: string;
    label: string;
    title?: string;
    /** いま見ている場所か */
    current: boolean;
    /** つながらなかった理由（あれば、印を出す） */
    broken?: string | null;
    open: () => void;
    openTab: () => void;
    openWindow?: () => void;
    /** ブックマークから外す（ブックマークだけ） */
    remove?: () => void;
    /** 設定を直す・外す（ネットワークの場所だけ） */
    edit?: () => void;
  };
</script>

<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { tick } from 'svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import Menu from '@3pino/ui-kit-web/Menu.svelte';
  import MenuItem from '@3pino/ui-kit-web/MenuItem.svelte';
  import { EXPLORER_DRAG_DIR_TYPE, EXPLORER_DRAG_TYPE, explorerDragItems } from '@3pino/explorer-kit';

  // 左の欄の中身。上から「ブックマーク」（追加・削除できる。フォルダをドラッグして落としても足せる）、「ドライブ」（この端末のドライブ・SD カード・WSL・ネットワークの場所）。
  // 項目を右クリック（長押し）すると、新しいタブ・新しいウィンドウで開く・ブックマークから外す、のメニュー。

  let {
    bookmarks,
    drives,
    canWindow,
    canAddBookmark,
    onaddbookmark,
    onaddnetwork,
    ondropdirs,
    onmovebookmark,
  }: {
    bookmarks: NavEntry[];
    drives: NavEntry[];
    /** 新しいウィンドウで開けるか（デスクトップだけ） */
    canWindow: boolean;
    /** 「いま見ているフォルダ」を足せるか（設定を見ているとき・すでにあるときは足せない） */
    canAddBookmark: boolean;
    onaddbookmark: () => void;
    onaddnetwork: () => void;
    /** エクスプローラーからフォルダをドラッグして落とした（フォルダのパス） */
    ondropdirs: (paths: string[]) => void;
    /** ブックマークを並べ替えた（key と、動かしたあとの位置。ブックマークの一覧の中での 0 から数えた番号） */
    onmovebookmark: (key: string, toIndex: number) => void;
  } = $props();

  let menu = $state.raw<{ entry: NavEntry; x: number; y: number } | null>(null);
  let dropping = $state(false);

  // ---- ブックマークの並べ替え（ドラッグ・Alt+↑↓・メニューの「上へ」「下へ」） ----
  /** ドラッグしているブックマーク */
  let dragKey = $state<string | null>(null);
  /** 落とす位置の印（その行の、上か下） */
  let slot = $state<{ key: string; after: boolean } | null>(null);
  const BOOKMARK_DRAG = 'application/x-fixplor-bookmark';

  const indexOf = (key: string): number => bookmarks.findIndex((b) => b.key === key);
  function bookmarkDragStart(ev: DragEvent, e: NavEntry): void {
    if (!ev.dataTransfer) return;
    dragKey = e.key;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData(BOOKMARK_DRAG, e.key);
  }
  function bookmarkDragOver(ev: DragEvent, e: NavEntry): void {
    if (dragKey === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    slot = { key: e.key, after: ev.clientY > r.top + r.height / 2 };
  }
  function bookmarkDrop(ev: DragEvent): void {
    if (dragKey === null || slot === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    const from = indexOf(dragKey);
    const at = indexOf(slot.key) + (slot.after ? 1 : 0);
    const key = dragKey;
    bookmarkDragEnd();
    if (from < 0) return;
    // 引き抜いたあとの位置
    const to = from < at ? at - 1 : at;
    if (to !== from) onmovebookmark(key, to);
  }
  function bookmarkDragEnd(): void {
    dragKey = null;
    slot = null;
  }
  /** メニューから（メニューを閉じると項目が消えるので、key を先に受け取っておく） */
  function moveFromMenu(key: string, step: -1 | 1): void {
    menu = null;
    moveBy(key, step);
  }
  function moveBy(key: string, step: -1 | 1): void {
    const to = indexOf(key) + step;
    if (to >= 0 && to < bookmarks.length) onmovebookmark(key, to);
  }
  /** ブックマークのボタンで Alt+↑↓：並べ替え（動かしたあとも、フォーカスを保つ） */
  async function bookmarkKey(ev: KeyboardEvent, e: NavEntry): Promise<void> {
    if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    ev.stopPropagation();
    const btn = ev.currentTarget as HTMLElement;
    moveBy(e.key, ev.key === 'ArrowUp' ? -1 : 1);
    await tick();
    // 並べ替えで行が作り直されても、同じブックマークのボタンにフォーカスを戻す
    if (btn.isConnected && document.activeElement === btn) return;
    [...document.querySelectorAll<HTMLElement>('[data-bookmark]')].find((el) => el.dataset.bookmark === e.key)?.focus();
  }

  function openMenu(ev: MouseEvent, entry: NavEntry): void {
    ev.preventDefault();
    menu = { entry, x: ev.clientX, y: ev.clientY };
  }
  function pick(run: () => void): void {
    menu = null;
    run();
  }

  const isDirDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(EXPLORER_DRAG_TYPE) && !!ev.dataTransfer.types.includes(EXPLORER_DRAG_DIR_TYPE);
  function dragOver(ev: DragEvent): void {
    if (!isDirDrag(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'link';
    dropping = true;
  }
  function dragLeave(ev: DragEvent): void {
    if (ev.relatedTarget instanceof Node && (ev.currentTarget as HTMLElement).contains(ev.relatedTarget)) return;
    dropping = false;
  }
  function drop(ev: DragEvent): void {
    if (!isDirDrag(ev)) return;
    ev.preventDefault();
    dropping = false;
    const dirs = (explorerDragItems() ?? []).filter((i) => i.kind === 'dir').map((i) => i.path);
    if (dirs.length > 0) ondropdirs(dirs);
  }
</script>

{#snippet row(e: NavEntry, sortable = false)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="place-row"
    class:place-row-dragging={sortable && dragKey === e.key}
    class:place-row-slot-before={sortable && slot?.key === e.key && !slot.after && dragKey !== e.key}
    class:place-row-slot-after={sortable && slot?.key === e.key && slot.after && dragKey !== e.key}
    draggable={sortable}
    ondragstart={sortable ? (ev) => bookmarkDragStart(ev, e) : undefined}
    ondragover={sortable ? (ev) => bookmarkDragOver(ev, e) : undefined}
    ondrop={sortable ? bookmarkDrop : undefined}
    ondragend={sortable ? bookmarkDragEnd : undefined}
  >
    <button
      class="menu-item place-open"
      type="button"
      data-bookmark={sortable ? e.key : undefined}
      onkeydown={sortable ? (ev) => void bookmarkKey(ev, e) : undefined}
      aria-current={e.current ? 'page' : undefined}
      title={e.broken ? `つながりません: ${e.broken}` : e.title}
      onclick={e.open}
      oncontextmenu={(ev) => openMenu(ev, e)}
    >
      {e.label}{#if e.broken}<span class="place-broken" role="img" aria-label="つながりません">!</span>{/if}
    </button>
    {#if e.edit}
      <IconButton label={`「${e.label}」を直す`} title="直す・外す" onclick={e.edit}><Pencil size={14} /></IconButton>
    {/if}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section class="places-section" class:places-section-drop={dropping} aria-label="ブックマーク" ondragover={dragOver} ondragleave={dragLeave} ondrop={drop}>
  <div class="places-head places-head-first">
    <span class="places-title">ブックマーク</span>
    <IconButton class="places-add" label="いま開いているフォルダをブックマークに追加" title={canAddBookmark ? 'いま開いているフォルダを追加' : 'ここは追加できません（設定の画面・追加済み）'} iconSize={14} disabled={!canAddBookmark} onclick={onaddbookmark}><Plus size={14} /></IconButton>
  </div>
  {#each bookmarks as e (e.key)}
    {@render row(e, true)}
  {:else}
    <p class="places-empty muted">フォルダをここへドラッグするか、＋で追加します</p>
  {/each}
</section>

<section class="places-section" aria-label="ドライブ">
  <div class="places-head">
    <span class="places-title">ドライブ</span>
    <IconButton class="places-add" label="ネットワークの場所を追加" title="ネットワークの場所を追加" iconSize={14} onclick={onaddnetwork}><Plus size={14} /></IconButton>
  </div>
  {#each drives as e (e.key)}
    {@render row(e)}
  {/each}
</section>

{#if menu}
  {@const entry = menu.entry}
  <div class="places-menu-anchor" style:left="{menu.x}px" style:top="{menu.y}px">
    <Menu class="places-menu" label="場所の操作" onclose={() => (menu = null)}>
      <MenuItem icon={Plus} onclick={() => pick(entry.openTab)}>新しいタブで開く</MenuItem>
      {#if canWindow && entry.openWindow}
        <MenuItem icon={ExternalLink} onclick={() => pick(entry.openWindow!)}>新しいウィンドウで開く</MenuItem>
      {/if}
      {#if entry.edit}
        <MenuItem icon={Pencil} onclick={() => pick(entry.edit!)}>直す・外す</MenuItem>
      {/if}
      {#if entry.remove}
        <MenuItem icon={ArrowUp} disabled={indexOf(entry.key) <= 0} onclick={() => moveFromMenu(entry.key, -1)}>上へ移動</MenuItem>
        <MenuItem icon={ArrowDown} disabled={indexOf(entry.key) < 0 || indexOf(entry.key) >= bookmarks.length - 1} onclick={() => moveFromMenu(entry.key, 1)}>下へ移動</MenuItem>
        <MenuItem icon={Trash} danger onclick={() => pick(entry.remove!)}>ブックマークから削除</MenuItem>
      {/if}
    </Menu>
  </div>
{/if}

<style>
  .places-section {
    display: flex;
    flex-direction: column;
    flex: none;
    border-radius: var(--radius-sm);
  }
  /* ブックマークをドラッグして並べ替えるとき: 動かしている行は薄く、落とす位置は、行の上か下の線で示す */
  .place-row-dragging {
    opacity: 0.4;
  }
  .place-row-slot-before {
    box-shadow: 0 -2px 0 0 var(--accent);
  }
  .place-row-slot-after {
    box-shadow: 0 2px 0 0 var(--accent);
  }
  /* フォルダをドラッグして、ブックマークの上に来たときの印 */
  .places-section-drop {
    outline: 1px dashed var(--accent);
    background: var(--accent-soft);
  }
  .places-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-4);
    padding-inline: var(--space-2);
  }
  .places-head-first {
    margin-top: 0;
  }
  .places-title {
    color: var(--text-muted);
    font-size: var(--fs-sm, 0.85em);
  }
  /* 追加のボタンは小さく（押す範囲は、見出しの高さに収める） */
  .places-head :global(.places-add) {
    width: 22px;
    height: 22px;
    padding: 0;
  }
  .places-empty {
    margin: var(--space-1) var(--space-2);
    font-size: var(--fs-sm, 0.85em);
  }
  .places-section :global(.menu-item) {
    width: 100%;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--fs-base);
  }
  .places-section :global(.menu-item[aria-current='page']) {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .place-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .place-row :global(.place-open) {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .place-broken {
    margin-left: var(--space-2);
    color: var(--danger);
    font-weight: bold;
  }
  .places-menu-anchor {
    position: fixed;
    z-index: var(--z-menu, 50);
  }
  /* .menu は位置を持たない。position が無いと z-index が効かず、外側を押したら閉じる幕（fixed）が、メニューを覆ってしまう */
  .places-menu-anchor :global(.places-menu) {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
  }
</style>
