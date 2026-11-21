<script lang="ts">
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import Icon from '@3pino/ui-kit-web/Icon.svelte';
  import { lucideAliases } from '../lib/lucideIcons';
  import { DEFAULT_ICON, iconName, searchIcons } from '../lib/ruleIcons';

  // アイコンの選び方: 「アイコンを設定する」にすると、今のアイコン（初めは lucide の file）が出る。それを押すと、
  // lucide（別名でも探せる）とアプリのロゴ（`fixplor`）を、名前で絞り込んで選ぶ一覧が開く。選ぶと閉じる。
  // 一覧は、見えている分だけ読み込む（数が多いので、先頭の MAX 個まで出す。絞り込むと、その中から）。
  let { value, onpick }: { value: string | undefined; onpick: (name: string | undefined) => void } = $props();

  const MAX = 96;
  let open = $state(false);
  let query = $state('');
  const hits = $derived(open ? searchIcons(query) : []);
  const shown = $derived(hits.slice(0, MAX));
  /** 保存した名前を、今の名前にしたもの（昔のロゴの名前・別名は直す） */
  const current = $derived(value === undefined ? undefined : iconName(value));

  function toggleOn(on: boolean): void {
    open = false;
    onpick(on ? DEFAULT_ICON : undefined);
  }
  function pick(name: string): void {
    onpick(name);
    open = false;
    query = '';
  }
</script>

<div class="icon-picker">
  <div class="icon-picker-line">
    <label class="icon-picker-on"><input type="checkbox" checked={value !== undefined} onchange={(ev) => toggleOn(ev.currentTarget.checked)} /> アイコンを設定する</label>
    {#if value !== undefined}
      <button type="button" class="icon-picker-sample" aria-expanded={open} aria-label={`アイコン: ${current}。押して変える`} onclick={() => (open = !open)}>
        <span class="icon-picker-glyph" aria-hidden="true">{#if current}<Icon icon={current} size={20} />{/if}</span>
        <span class="icon-picker-name">{current}</span>
      </button>
    {/if}
  </div>
  {#if open}
    <TextInput class="icon-picker-search" type="search" bind:value={query} placeholder="名前で絞り込み" aria-label="アイコンを絞り込む" autocomplete="off" spellcheck={false} />
    <div class="icon-picker-grid" role="listbox" aria-label="アイコン">
      {#each shown as name (name)}
        {@const aliases = lucideAliases(name)}
        <button type="button" class="icon-picker-item" class:icon-picker-item-on={name === value} role="option" aria-selected={name === value} aria-label={name} title={aliases.length > 0 ? `${name}（別名: ${aliases.join('・')}）` : name} onclick={() => pick(name)}>
          <Icon icon={name} size={20} />
        </button>
      {:else}
        <p class="muted icon-picker-none">「{query}」に合うアイコンはありません</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .icon-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .icon-picker-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .icon-picker-on {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 11em;
  }
  .icon-picker-sample {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon-picker-sample:hover {
    background: var(--surface-2);
  }
  .icon-picker-glyph {
    display: inline-flex;
    min-width: 20px;
    min-height: 20px;
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
</style>
