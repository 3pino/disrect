<script lang="ts">
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import SuggestList from '@3pino/ui-kit-web/SuggestList.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import type { NavEntry } from './PlacesNav.svelte';

  // ブックマークから検索: 名前や場所を打って絞り込み、Enter で開く（Ctrl+Enter は新しいタブ）。↑↓で選ぶ。Esc で閉じる。
  let {
    entries,
    onclose,
  }: {
    /** 検索の対象（左の欄のブックマーク） */
    entries: readonly NavEntry[];
    onclose: () => void;
  } = $props();

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

  function pick(e: NavEntry, newTab = false): void {
    onclose();
    if (newTab) e.openTab();
    else e.open();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    // Ctrl+Enter: 新しいタブで開く
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && hits[index]) {
      ev.preventDefault();
      pick(hits[index], true);
      return;
    }
    list?.keydown(ev);
  }
</script>

<Modal title="ブックマークから検索" {onclose} width={480}>
  <TextInput bind:value={query} placeholder="名前や場所で絞り込み（Enter: 開く、Ctrl+Enter: 新しいタブ）" aria-label="ブックマークを検索" autocomplete="off" spellcheck={false} onkeydown={onKey} />
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
  .bookmark-search-none {
    margin: var(--space-3) 0 0;
  }
</style>
