<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import Menu from '@3pino/ui-kit-web/Menu.svelte';
  import MenuItem from '@3pino/ui-kit-web/MenuItem.svelte';
  import { EXPLORER_DRAG_TYPE } from '@3pino/explorer-kit';

  // タブの欄。タブは「置き場所 + フォルダ」（中身の状態は App が持つ）。ここは見せて、押された・動かされたことを知らせるだけ。
  //  - 押す: 切り替え。真ん中のボタン: 閉じる。右クリック: メニュー（複製・左右へ移す・閉じる・ほかを閉じる）。
  //  - 並べ替え: タブをドラッグして、ほかのタブの上へ落とす。
  //  - フォルダをドラッグして、この欄（タブの上・＋・空き）へ落とすと、そのフォルダを新しいタブで開く（ondropfolders）。
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
  }: {
    tabs: { id: number; label: string; title: string }[];
    activeId: number;
    onselect: (id: number) => void;
    onclose: (id: number) => void;
    onadd: () => void;
    onduplicate: (id: number) => void;
    /** from 番目のタブを to 番目へ */
    onmove: (from: number, to: number) => void;
    oncloseothers: (id: number) => void;
    /** 落とされたもの（エクスプローラーのドラッグのパス）のうち、フォルダを新しいタブで開く */
    ondropfolders: (paths: string[]) => void;
  } = $props();

  const TAB_DRAG = 'application/x-fixplor-tab';
  let menu = $state.raw<{ id: number; x: number; y: number } | null>(null);
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);
  let dropping = $state(false);

  const only = $derived(tabs.length === 1);
  const indexOf = (id: number): number => tabs.findIndex((t) => t.id === id);

  function openMenu(ev: MouseEvent, id: number): void {
    ev.preventDefault();
    menu = { id, x: ev.clientX, y: ev.clientY };
  }
  function pick(run: () => void): void {
    run();
    menu = null;
  }

  function dragStart(ev: DragEvent, i: number): void {
    dragging = i;
    ev.dataTransfer?.setData(TAB_DRAG, String(i));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  const isTabDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(TAB_DRAG);
  const isFolderDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(EXPLORER_DRAG_TYPE);

  function dragOverTab(ev: DragEvent, i: number): void {
    if (isTabDrag(ev)) {
      ev.preventDefault();
      over = i;
    } else if (isFolderDrag(ev)) {
      ev.preventDefault();
      dropping = true;
    }
  }
  function dropOnTab(ev: DragEvent, i: number): void {
    ev.preventDefault();
    ev.stopPropagation();
    const from = Number(ev.dataTransfer?.getData(TAB_DRAG));
    if (isTabDrag(ev) && Number.isInteger(from)) onmove(from, i);
    else dropFolders(ev);
    reset();
  }
  function dropOnBar(ev: DragEvent): void {
    if (isFolderDrag(ev)) {
      ev.preventDefault();
      dropFolders(ev);
    }
    reset();
  }
  function dropFolders(ev: DragEvent): void {
    const raw = ev.dataTransfer?.getData(EXPLORER_DRAG_TYPE) ?? '';
    const paths = raw === '' ? [] : raw.split('|');
    if (paths.length > 0) ondropfolders(paths);
  }
  function reset(): void {
    dragging = null;
    over = null;
    dropping = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tabs"
  class:tabs-dropping={dropping}
  role="tablist"
  tabindex="-1"
  aria-label="タブ"
  ondragover={(ev) => isFolderDrag(ev) && (ev.preventDefault(), (dropping = true))}
  ondragleave={() => (dropping = false)}
  ondrop={dropOnBar}
>
  {#each tabs as t, i (t.id)}
    <div
      class="tab"
      class:tab-active={t.id === activeId}
      class:tab-over={over === i && dragging !== i}
      role="presentation"
      draggable="true"
      ondragstart={(ev) => dragStart(ev, i)}
      ondragover={(ev) => dragOverTab(ev, i)}
      ondrop={(ev) => dropOnTab(ev, i)}
      ondragend={reset}
      oncontextmenu={(ev) => openMenu(ev, t.id)}
      onauxclick={(ev) => {
        if (ev.button === 1) {
          ev.preventDefault();
          if (!only) onclose(t.id);
        }
      }}
    >
      <button class="tab-main" type="button" role="tab" aria-selected={t.id === activeId} title={t.title} onclick={() => onselect(t.id)}>
        <span class="tab-label">{t.label}</span>
      </button>
      {#if !only}
        <button class="tab-close" type="button" aria-label={`「${t.label}」のタブを閉じる`} title="タブを閉じる" onclick={() => onclose(t.id)}><X size={12} /></button>
      {/if}
    </div>
  {/each}
  <IconButton class="tab-add" label="新しいタブ" title="新しいタブ（Ctrl+T）" onclick={onadd}><Plus size={16} /></IconButton>

  {#if menu}
    {@const id = menu.id}
    {@const i = indexOf(id)}
    <div class="tab-menu-anchor" style:left="{menu.x}px" style:top="{menu.y}px">
      <Menu class="tab-menu" label="タブの操作" onclose={() => (menu = null)}>
        <MenuItem icon={Copy} onclick={() => pick(() => onduplicate(id))}>複製</MenuItem>
        <MenuItem icon={ArrowLeft} disabled={i <= 0} onclick={() => pick(() => onmove(i, i - 1))}>左へ移す</MenuItem>
        <MenuItem icon={ArrowRight} disabled={i < 0 || i >= tabs.length - 1} onclick={() => pick(() => onmove(i, i + 1))}>右へ移す</MenuItem>
        <MenuItem icon={X} disabled={only} onclick={() => pick(() => onclose(id))}>閉じる</MenuItem>
        <MenuItem disabled={only} onclick={() => pick(() => oncloseothers(id))}>ほかのタブを閉じる</MenuItem>
      </Menu>
    </div>
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3) 0;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex: none;
  }
  .tabs-dropping {
    background: var(--accent-soft);
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
  .tab-main {
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
  .tab-menu-anchor :global(.tab-menu) {
    top: 0;
    left: 0;
  }
</style>
