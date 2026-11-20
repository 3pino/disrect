<script lang="ts">
  import { onMount, tick } from 'svelte';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Settings from '@lucide/svelte/icons/settings';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import Menu from '@3pino/ui-kit-web/Menu.svelte';
  import MenuItem from '@3pino/ui-kit-web/MenuItem.svelte';
  import { baseName, EXPLORER_DRAG_DIR_TYPE, EXPLORER_DRAG_TYPE, explorerDragItems } from '@3pino/explorer-kit';
  import WindowControls from './WindowControls.svelte';
  import { endedOutside } from '../lib/tabs';

  // タブの欄。タブは「置き場所 + フォルダ」（中身の状態は App が持つ）。ここは見せて、押された・動かされたことを知らせるだけ。
  //  - 押す: 切り替え。× ボタン: 閉じる（最後の 1 つでも出す。閉じたあとの扱いは App）。右クリック: メニュー（複製・左右へ移す・閉じる・ほかを閉じる）。
  //  - 並べ替え: タブをドラッグして、ほかのタブの上へ落とす。動かしている間、ほかのタブは空きの分だけずれて、落とすと滑って収まる。
  //  - フォルダをドラッグして、この欄へ落とすと、そのフォルダを新しいタブで開く（ondropfolders）。落とす前に、できる場所に点線のタブ（名前つき）を見せる。
  //  - タブをウィンドウの外までドラッグして離すと、別のウィンドウで開く（ondetach）。デスクトップだけ。
  //  - タブが多いときは、欄の中を横にスクロールする（バーは出さず、続きがある側の端に影を出す）。狭い画面も、同じ表示。
  //  - デスクトップは、タイトルバーも兼ねる（左端にアイコン・右端に最小化・最大化・閉じる。空いているところはウィンドウを動かす）。
  let {
    tabs,
    activeId,
    onselect,
    onclose,
    onadd,
    onduplicate,
    onmove,
    oncloseothers,
    ondropfolders,
    ondetach,
    windowControls = false,
  }: {
    tabs: { id: number; label: string; title: string; icon?: 'settings' }[];
    activeId: number;
    onselect: (id: number) => void;
    onclose: (id: number) => void;
    onadd: () => void;
    onduplicate: (id: number) => void;
    /** from 番目のタブを to 番目へ */
    onmove: (from: number, to: number) => void;
    oncloseothers: (id: number) => void;
    /** 落とされたもの（エクスプローラーのドラッグのパス）のうち、フォルダを、at 番目（タブの並びの位置）に新しいタブで開く */
    ondropfolders: (paths: string[], at: number) => void;
    /** タブがウィンドウの外へ落とされた（別のウィンドウで開く。位置は画面の座標） */
    ondetach?: (id: number, at: { x: number; y: number }) => void;
    /** タイトルバーとして使う（アイコン・最小化・最大化・閉じる・ウィンドウを動かす領域） */
    windowControls?: boolean;
  } = $props();

  const TAB_DRAG = 'application/x-fixplor-tab';
  let menu = $state.raw<{ id: number; x: number; y: number } | null>(null);
  let dragging = $state<number | null>(null);
  /** 動かしているタブの元の位置を見せなくする（ドラッグの絵を取ったあとで。ずれた隣のタブと重なって見えるため） */
  let dragHidden = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let over = $state<number | null>(null);
  /** 動かしているタブの幅（+ すき間）。ほかのタブをずらす量 */
  let dragShift = $state(0);
  /** フォルダのドラッグの、新しいタブの位置（見せる点線のタブ）。null は、いまは受けていない */
  let ghostAt = $state<number | null>(null);
  let ghostLabel = $state('');
  /** 落とした直後（並びを入れ替えるまで）は、ずれの動き（transition）を止める */
  let settling = $state(false);

  let bar: HTMLElement | undefined = $state();
  let scroller: HTMLElement | undefined = $state();
  let canLeft = $state(false);
  let canRight = $state(false);

  const only = $derived(tabs.length === 1);
  const indexOf = (id: number): number => tabs.findIndex((t) => t.id === id);

  // ---- 横スクロール（バーは出さない。続きがある側に影） ----
  function measureScroll(): void {
    const el = scroller;
    if (!el) return;
    canLeft = el.scrollLeft > 1;
    canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }
  /** 縦のホイールは、横のスクロールにする（バーが無いので） */
  function onWheel(ev: WheelEvent): void {
    const el = scroller;
    if (!el || el.scrollWidth <= el.clientWidth || Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
    ev.preventDefault();
    el.scrollLeft += ev.deltaY;
  }
  onMount(() => {
    measureScroll();
    window.addEventListener('resize', measureScroll);
    // どこで終わっても、ドラッグが終わったら点線のタブを消す（エクスプローラーの中から始めたドラッグ）
    const onDragEnd = (): void => {
      if (ghostAt !== null) reset();
    };
    window.addEventListener('dragend', onDragEnd, true);
    const ro = typeof ResizeObserver === 'function' && scroller ? new ResizeObserver(measureScroll) : null;
    if (ro && scroller) ro.observe(scroller);
    return () => {
      window.removeEventListener('resize', measureScroll);
      window.removeEventListener('dragend', onDragEnd, true);
      clearGhostTimer();
      ro?.disconnect();
    };
  });

  // タブの並び・名前が変わったら、影を測り直し、見ているタブが隠れていたら見える所まで動かす
  $effect(() => {
    void tabs.map((t) => `${t.id}:${t.label}`).join('|');
    void activeId;
    void tick().then(() => {
      measureScroll();
      scroller?.querySelector<HTMLElement>('.tab-active')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    });
  });

  // ---- 並びが変わったときの動き（FLIP: 変わる前の位置から、新しい位置へ滑らせる） ----
  const tabLefts = (): Map<string, number> => {
    const m = new Map<string, number>();
    scroller?.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((el) => m.set(el.dataset.tabId ?? '', el.getBoundingClientRect().left));
    return m;
  };
  const orderKey = (): string => tabs.map((t) => t.id).join(',');
  /** 並びが変わる前の位置（DOM が変わる直前に測る）。落としたときは、ずれた見た目の位置から滑らせる */
  let before = new Map<string, number>();
  let droppedFrom: Map<string, number> | null = null;
  $effect.pre(() => {
    void orderKey();
    before = droppedFrom ?? tabLefts();
    droppedFrom = null;
  });
  $effect(() => {
    void orderKey();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      scroller?.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((el) => {
        const old = before.get(el.dataset.tabId ?? '');
        if (old === undefined || typeof el.animate !== 'function') return;
        const dx = old - el.getBoundingClientRect().left;
        if (Math.abs(dx) < 1) return;
        el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' });
      });
    }
    settling = false;
  });

  function openMenu(ev: MouseEvent, id: number): void {
    ev.preventDefault();
    menu = { id, x: ev.clientX, y: ev.clientY };
  }
  function pick(run: () => void): void {
    run();
    menu = null;
  }

  // ---- タブの並べ替えのドラッグ ----
  function dragStart(ev: DragEvent, i: number): void {
    dragging = i;
    const el = ev.currentTarget as HTMLElement;
    const gap = scroller ? parseFloat(getComputedStyle(scroller).columnGap) || 0 : 0;
    dragShift = el.getBoundingClientRect().width + gap;
    // ブラウザがドラッグの絵を取るのは、この処理のあと。先に消すと、絵も消えるので、少し待つ
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (dragging !== null) dragHidden = true;
    }, 0);
    ev.dataTransfer?.setData(TAB_DRAG, String(i));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  /** k 番目のタブを、動かしているタブの空きの分だけずらす量（px） */
  function shiftOf(k: number): number {
    if (dragging === null || over === null || dragging === over) return 0;
    if (dragging < over && k > dragging && k <= over) return -dragShift;
    if (dragging > over && k >= over && k < dragging) return dragShift;
    return 0;
  }
  const isTabDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(TAB_DRAG);
  // フォルダを含むドラッグだけを受ける（ファイルだけのドラッグでは、何も見せない。落とされても、タブを作る機能が無いので）
  const isFolderDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(EXPLORER_DRAG_TYPE) && !!ev.dataTransfer.types.includes(EXPLORER_DRAG_DIR_TYPE);

  /** フォルダのドラッグの、見せるタブの名前（ドラッグ中の項目のうち、フォルダの名前。複数なら「ほか n 件」） */
  function draggedFolderLabel(): string {
    const dirs = (explorerDragItems() ?? []).filter((i) => i.kind === 'dir');
    if (dirs.length === 0) return '新しいタブ';
    const first = baseName(dirs[0].path) || dirs[0].path;
    return dirs.length === 1 ? first : `${first} ほか ${dirs.length - 1} 件`;
  }

  function dragOverTab(ev: DragEvent, i: number): void {
    if (isTabDrag(ev)) {
      ev.preventDefault();
      over = i;
    } else if (isFolderDrag(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      // タブの左半分なら、そのタブの前に。右半分なら、後ろに
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      showGhost(ev.clientX < r.left + r.width / 2 ? i : i + 1);
    }
  }
  function showGhost(at: number): void {
    if (ghostAt === null) ghostLabel = draggedFolderLabel();
    ghostAt = at;
    touchGhost();
  }
  // 点線のタブを出したまま、ドラッグが途切れたとき（ウィンドウの外へ出た・どこかで離したなど、dragleave が届かない場合）に備える。
  // dragover は、動かさなくても 0.5 秒ほどごとに届くので、1 秒来なければ消す
  let ghostTimer: ReturnType<typeof setTimeout> | null = null;
  function touchGhost(): void {
    if (ghostTimer) clearTimeout(ghostTimer);
    ghostTimer = setTimeout(() => {
      ghostTimer = null;
      ghostAt = null;
    }, 1000);
  }
  function clearGhostTimer(): void {
    if (ghostTimer) clearTimeout(ghostTimer);
    ghostTimer = null;
  }
  /** 欄の、タブの無いところの上 */
  function dragOverBar(ev: DragEvent): void {
    if (isFolderDrag(ev)) {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      if (ghostAt === null) showGhost(tabs.length);
      else touchGhost();
    } else if (isTabDrag(ev)) {
      ev.preventDefault();
    }
  }
  /** 点線のタブの上。位置は、そのまま */
  function dragOverGhost(ev: DragEvent): void {
    if (!isFolderDrag(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    touchGhost();
  }
  function dragLeaveBar(ev: DragEvent): void {
    // 欄の中の子どもへ動いただけのときは、そのまま（相手が分からない環境もあるので、位置も見る）
    if (ev.relatedTarget instanceof Node && bar?.contains(ev.relatedTarget)) return;
    // ウィンドウの外へ出るときは、相手が無く、位置は (0, 0) で届く（バーは左上の端なので、位置だけでは「中」に見える）
    const leftWindow = ev.relatedTarget === null && ev.clientX === 0 && ev.clientY === 0;
    const r = bar?.getBoundingClientRect();
    if (!leftWindow && r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return;
    ghostAt = null;
    over = null;
  }
  function dropOnTab(ev: DragEvent, i: number): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (isTabDrag(ev)) commitMove(i);
    else dropFolders(ev);
  }
  function dropOnBar(ev: DragEvent): void {
    ev.preventDefault();
    if (isTabDrag(ev)) {
      // タブの無いところ（ずれて空いたところを含む）へ落とした: 見せていた位置へ
      if (over !== null) commitMove(over);
      else reset();
    } else if (isFolderDrag(ev)) dropFolders(ev);
    else reset();
  }
  function commitMove(to: number): void {
    const from = dragging;
    if (from === null || from === to) {
      reset();
      return;
    }
    // ずれた見た目の位置から滑らせるため、いまの位置を覚えてから、動きを止めて並べ替える
    settling = true;
    droppedFrom = tabLefts();
    reset();
    onmove(from, to);
  }
  function dropFolders(ev: DragEvent): void {
    const at = ghostAt ?? tabs.length;
    const raw = ev.dataTransfer?.getData(EXPLORER_DRAG_TYPE) ?? '';
    const paths = raw === '' ? [] : raw.split('|');
    reset();
    if (paths.length > 0) ondropfolders(paths, at);
  }
  function dragEnd(ev: DragEvent, id: number): void {
    const wasDragging = dragging !== null;
    reset();
    // どこにも落ちず、ウィンドウの外で離した: 別のウィンドウで開く（1 つしかないタブは、動かさない）
    if (wasDragging && ondetach && !only && endedOutside({ dropEffect: ev.dataTransfer?.dropEffect ?? 'none', clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY }, { width: window.innerWidth, height: window.innerHeight })) ondetach(id, { x: ev.screenX, y: ev.screenY });
  }
  function dropOnTab_ghost(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    dropFolders(ev);
  }
  function reset(): void {
    dragHidden = false;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    dragging = null;
    over = null;
    ghostAt = null;
    clearGhostTimer();
  }
</script>

<div class="tabbar" class:tabbar-dropping={ghostAt !== null} bind:this={bar} role="presentation" ondragover={dragOverBar} ondragleave={dragLeaveBar} ondrop={dropOnBar}>
  {#if windowControls}
    <img class="app-logo" src="/icon.svg" alt="" width="18" height="18" draggable="false" data-tauri-drag-region />
  {/if}
  <div class="tabs-wrap">
    <div class="tabs" class:tabs-settling={settling} role="tablist" tabindex="-1" aria-label="タブ" bind:this={scroller} onscroll={measureScroll} onwheel={onWheel}>
      {#each tabs as t, i (t.id)}
        {#if ghostAt === i}
          {@render ghost()}
        {/if}
        <div
          class="tab"
          class:tab-active={t.id === activeId}
          class:tab-over={over === i && dragging !== null && dragging !== i}
          class:tab-dragging={dragging === i && dragHidden}
          data-tab-id={t.id}
          style:transform={shiftOf(i) === 0 ? undefined : `translateX(${shiftOf(i)}px)`}
          role="presentation"
          draggable="true"
          ondragstart={(ev) => dragStart(ev, i)}
          ondragover={(ev) => dragOverTab(ev, i)}
          ondrop={(ev) => dropOnTab(ev, i)}
          ondragend={(ev) => dragEnd(ev, t.id)}
          oncontextmenu={(ev) => openMenu(ev, t.id)}
          onauxclick={(ev) => {
            if (ev.button === 1) {
              ev.preventDefault();
              onclose(t.id);
            }
          }}
        >
          <button class="tab-main" type="button" role="tab" aria-selected={t.id === activeId} title={t.title} onclick={() => onselect(t.id)}>
            {#if t.icon === 'settings'}<Settings size={14} />{/if}
            <span class="tab-label">{t.label}</span>
          </button>
          <button class="tab-close" type="button" aria-label={`「${t.label}」のタブを閉じる`} title="タブを閉じる" onclick={() => onclose(t.id)}><X size={12} /></button>
        </div>
      {/each}
      {#if ghostAt !== null && ghostAt >= tabs.length}
        {@render ghost()}
      {/if}
    </div>
    <span class="tabs-shadow tabs-shadow-left" class:tabs-shadow-on={canLeft} aria-hidden="true"></span>
    <span class="tabs-shadow tabs-shadow-right" class:tabs-shadow-on={canRight} aria-hidden="true"></span>
  </div>
  <IconButton class="tab-add" label="新しいタブ" title="新しいタブ（Ctrl+T）" onclick={onadd}><Plus size={16} /></IconButton>
  <div class="bar-space" data-tauri-drag-region></div>
  {#if windowControls}<WindowControls />{/if}
</div>

{#snippet ghost()}
  <div class="tab tab-ghost" role="presentation" aria-hidden="true" ondragover={dragOverGhost} ondrop={dropOnTab_ghost}>
    <span class="tab-main"><span class="tab-label">{ghostLabel}</span></span>
  </div>
{/snippet}

{#if menu}
    {@const id = menu.id}
    {@const i = indexOf(id)}
    <div class="tab-menu-anchor" style:left="{menu.x}px" style:top="{menu.y}px">
      <Menu class="tab-menu" label="タブの操作" onclose={() => (menu = null)}>
        <MenuItem icon={Copy} onclick={() => pick(() => onduplicate(id))}>複製</MenuItem>
        <MenuItem icon={ArrowLeft} disabled={i <= 0} onclick={() => pick(() => onmove(i, i - 1))}>左へ移す</MenuItem>
        <MenuItem icon={ArrowRight} disabled={i < 0 || i >= tabs.length - 1} onclick={() => pick(() => onmove(i, i + 1))}>右へ移す</MenuItem>
        <MenuItem icon={X} onclick={() => pick(() => onclose(id))}>閉じる</MenuItem>
        <MenuItem disabled={only} onclick={() => pick(() => oncloseothers(id))}>ほかのタブを閉じる</MenuItem>
      </Menu>
    </div>
  {/if}


<style>
  .tabbar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3) 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    flex: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .app-logo {
    flex: none;
    margin-right: var(--space-2);
    border-radius: 4px;
  }
  .tabs-wrap {
    position: relative;
    display: flex;
    min-width: 0;
    /* アクティブなタブの上の線（border-top）が、欄の端で切れないように */
    padding-top: 1px;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
    /* 縦には動かさない（アクティブなタブの下の 1px のはみ出しで、縦にスクロールできてしまうので、その分を中に取る） */
    overflow-y: hidden;
    padding-bottom: 1px;
    margin-bottom: -1px;
    align-items: flex-end;
    /* バーは出さない（続きがあることは、端の影で見せる） */
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tabs-shadow {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .tabs-shadow-left {
    left: 0;
    background: linear-gradient(to right, rgb(0 0 0 / 0.5), transparent);
  }
  .tabs-shadow-right {
    right: 0;
    background: linear-gradient(to left, rgb(0 0 0 / 0.5), transparent);
  }
  .tabs-shadow-on {
    opacity: 1;
  }
  /* 空いているところ（デスクトップは、ウィンドウを動かす・ダブルクリックで最大化） */
  .bar-space {
    flex: 1;
    align-self: stretch;
    min-width: 24px;
  }
  .tab {
    display: flex;
    align-items: center;
    max-width: 200px;
    min-width: 80px;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    color: var(--text-muted);
    transition: transform 0.15s ease;
  }
  .tabs-settling .tab {
    transition: none;
  }
  .tab-active {
    background: var(--bg);
    border-color: var(--border);
    color: var(--text);
    margin-bottom: -1px;
  }
  .tab-over {
    outline: 2px solid var(--accent);
  }
  /* 動かしているタブの元の位置: 空きは、隣のタブがずれて埋める（残すと、ずれたタブと重なって見える） */
  .tab-dragging {
    opacity: 0;
  }
  /* フォルダを落とすと、ここに新しいタブができる、という見せ方 */
  .tab-ghost {
    border: 1px dashed var(--accent);
    border-bottom: none;
    background: var(--accent-soft);
    color: var(--accent);
    animation: ghost-in 0.15s ease-out;
  }
  @keyframes ghost-in {
    from {
      opacity: 0;
      min-width: 0;
      max-width: 0;
    }
    to {
      opacity: 1;
      min-width: 80px;
      max-width: 200px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
    .tab-ghost {
      animation: none;
    }
  }
  .tab-main {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
  }
  .tab-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-close {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 20px;
    margin-right: var(--space-1);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
  }
  .tab-menu-anchor {
    position: fixed;
    z-index: var(--z-menu, 50);
  }
  /* .menu は位置を持たない。position が無いと z-index が効かず、外側を押したら閉じる幕（fixed）が、メニューを覆ってしまう */
  .tab-menu-anchor :global(.tab-menu) {
    position: absolute;
    top: 0;
    left: 0;
  }
</style>
