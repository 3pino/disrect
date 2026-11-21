<script lang="ts">
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import { LUCIDE_NAMES, lucideIcon, searchLucide } from '../lib/lucideIcons.svelte';
  import { iconOf, LOGO_ICON } from '../lib/ruleIcons';

  // アイコンの選び方: lucide（公式サイトと同じ全部）を、名前で絞り込んで選ぶ。アプリのロゴ・既定のままも選べる。
  // 一覧は、見えている分だけ読み込む（数が多いので、先頭の MAX 個まで出す。絞り込むと、その中から）。
  let { value, onpick }: { value: string | undefined; onpick: (name: string | undefined) => void } = $props();

  const MAX = 96;
  let query = $state('');
  const hits = $derived(searchLucide(query));
  const shown = $derived(hits.slice(0, MAX));
  const current = $derived(iconOf(value));
</script>

<div class="icon-picker">
  <div class="icon-picker-current">
    <span class="icon-picker-sample" aria-hidden="true">
      {#if current && typeof current === 'function'}{@const Icon = current}<Icon size={20} />{:else if current}<img src={current.src} alt="" width="20" height="20" />{/if}
    </span>
    <span class="icon-picker-name">{value === undefined ? '既定のまま' : value === LOGO_ICON ? 'アプリのロゴ' : value}</span>
    <Button class="icon-picker-default" onclick={() => onpick(undefined)} disabled={value === undefined}>既定のまま</Button>
    <Button class="icon-picker-logo" onclick={() => onpick(LOGO_ICON)} disabled={value === LOGO_ICON}>アプリのロゴ</Button>
  </div>
  <TextInput class="icon-picker-search" type="search" bind:value={query} placeholder="lucide のアイコンを名前で絞り込み（例: arrow, folder）" aria-label="アイコンを絞り込む" autocomplete="off" spellcheck={false} />
  <div class="icon-picker-grid" role="listbox" aria-label="アイコン">
    {#each shown as name (name)}
      {@const Icon = lucideIcon(name)}
      <button type="button" class="icon-picker-item" class:icon-picker-item-on={name === value} role="option" aria-selected={name === value} aria-label={name} title={name} onclick={() => onpick(name)}>
        {#if Icon}<Icon size={20} />{/if}
      </button>
    {:else}
      <p class="muted icon-picker-none">「{query}」に合うアイコンはありません</p>
    {/each}
  </div>
  <p class="muted icon-picker-count">{LUCIDE_NAMES.length} 個から、{hits.length} 個が合います{hits.length > MAX ? `（先頭の ${MAX} 個を表示。もっと絞り込んでください）` : ''}</p>
</div>

<style>
  .icon-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .icon-picker-current {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .icon-picker-sample {
    display: inline-flex;
    min-width: 20px;
    min-height: 20px;
  }
  .icon-picker-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: var(--space-2);
    max-height: 220px;
    overflow-y: auto;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 6px);
  }
  .icon-picker-item {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon-picker-item:hover {
    background: var(--surface-2);
  }
  .icon-picker-item-on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .icon-picker-none {
    grid-column: 1 / -1;
    margin: var(--space-3);
    text-align: center;
  }
  .icon-picker-count {
    margin: 0;
    font-size: var(--fs-sm);
  }
</style>
