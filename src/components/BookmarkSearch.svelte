<script lang="ts">
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import SuggestList from '@3pino/ui-kit-web/SuggestList.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import type { NavEntry } from './PlacesNav.svelte';
  import { formatHotkey } from '@3pino/app-kit-web/core/hotkeys';
  import { hotkeys } from '../lib/hotkeys.svelte';

  // ブックマークから検索: 名前や場所を打って絞り込む。↑↓で選ぶ。Esc で閉じる。
  // 開き方は、設定のホットキー（開く・新しいタブで開く・新しいタブで開いて移る・新しいウィンドウで開く）のとおり。下に、そのキーを小さく出す。
  let {
    entries,
    canWindow,
    onclose,
  }: {
    /** 検索の対象（左の欄のブックマーク） */
    entries: readonly NavEntry[];
    /** 新しいウィンドウで開けるか（デスクトップだけ） */
    canWindow: boolean;
    onclose: () => void;
  } = $props();

  type How = 'here' | 'tab' | 'stay' | 'window';
  /** 下に出す、開き方とキー（キーの無いものは出さない） */
  const hints = $derived(
    (
      [
        { how: 'here', id: 'open', label: '開く' },
        { how: 'stay', id: 'file.openNewTab', label: '新しいタブで開く' },
        { how: 'tab', id: 'file.openNewTabFocus', label: '新しいタブで開いて移る' },
        ...(canWindow ? [{ how: 'window', id: 'file.openNewWindow', label: '新しいウィンドウで開く' }] : []),
      ] as { how: How; id: 'open' | 'file.openNewTab' | 'file.openNewTabFocus' | 'file.openNewWindow'; label: string }[]
    )
      .map((h) => ({ ...h, keys: hotkeys.keys(h.id) }))
      .filter((h) => h.keys.length > 0),
  );

  let query = $state('');
  let index = $state(0);
  let list: { keydown(e: KeyboardEvent): boolean } | undefined = $state();

  /** 空白で区切った語を、すべて含む（名前・場所の説明。大文字小文字は区別しない） */
  const hits = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => {
      const text = `${e.label}\n${e.title ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  // 絞り込みで選びが範囲の外に出ないように
  $effect(() => {
    if (index >= hits.length) index = 0;
  });

  function pick(e: NavEntry, how: How = 'here'): void {
    onclose();
    if (how === 'tab') e.openTab();
    else if (how === 'stay') (e.openTabStay ?? e.openTab)();
    else if (how === 'window') e.openWindow?.();
    else e.open();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    const hit = hits[index];
    if (hit) {
      // 設定のホットキーのとおりに開く（Enter は、既定の「開く」。↑↓・Esc は、一覧が受ける）
      for (const h of hints) {
        if (hotkeys.matches(ev, h.id)) {
          ev.preventDefault();
          pick(hit, h.how);
          return;
        }
      }
    }
    list?.keydown(ev);
  }
</script>

<Modal title="ブックマークから検索" {onclose} width={480}>
  <TextInput bind:value={query} aria-label="ブックマークを検索" autocomplete="off" spellcheck={false} onkeydown={onKey} />
  {#if hits.length > 0}
    <SuggestList bind:this={list} items={hits} bind:index label="ブックマーク" key={(e) => e.key} class="bookmark-search-list" onpick={(e) => pick(e)} {onclose}>
      {#snippet item(e)}
        <span class="bookmark-search-name">{e.label}</span>
        {#if e.title}<span class="muted bookmark-search-path">{e.title}</span>{/if}
      {/snippet}
    </SuggestList>
  {:else}
    <p class="muted bookmark-search-none">{entries.length === 0 ? 'ブックマークがありません' : '見つかりません'}</p>
  {/if}
  {#if hints.length > 0}
    <p class="muted bookmark-search-hints">
      {#each hints as h (h.how)}
        <span class="bookmark-search-hint">{h.label} <kbd class="kbd">{formatHotkey(h.keys[0])}</kbd></span>
      {/each}
    </p>
  {/if}
</Modal>

<style>
  :global(.bookmark-search-list) {
    position: static;
    max-height: 50vh;
    overflow-y: auto;
    margin-top: var(--space-3);
  }
  .bookmark-search-name {
    display: block;
  }
  .bookmark-search-path {
    display: block;
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bookmark-search-hints {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-3) 0 0;
    font-size: var(--fs-sm);
  }
  .bookmark-search-none {
    margin: var(--space-3) 0 0;
  }
</style>
