<script lang="ts">
  import { onDestroy } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import SettingRow from '@3pino/ui-kit-web/SettingRow.svelte';
  import { formatHotkey, hotkeyFromEvent } from '@3pino/explorer-kit';
  import { COMMANDS, FIXED_HOTKEYS, type CommandId } from '../lib/hotkeys';
  import { hotkeys } from '../lib/hotkeys.svelte';

  // 設定の「ホットキー」: 操作ごとに、キーを複数決められる（追加・外す・既定に戻す）。保存は各デバイス（lib/hotkeys.svelte.ts）。
  // 記録のあいだは、押したキーを、ほかの操作に渡さない（window の捕捉の段で止める）。修飾キーなしの Esc は、記録を取り消す。

  /** キーを記録している操作 */
  let recording = $state<CommandId | null>(null);

  function onRecordKey(e: KeyboardEvent): void {
    const id = recording;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      recording = null;
      return;
    }
    const text = hotkeyFromEvent(e);
    // 修飾キーだけのときは、続けて押すキーを待つ
    if (!text) return;
    hotkeys.add(id, text);
    recording = null;
  }

  $effect(() => {
    hotkeys.recording = recording !== null;
    if (recording === null) return;
    window.addEventListener('keydown', onRecordKey, true);
    return () => window.removeEventListener('keydown', onRecordKey, true);
  });
  onDestroy(() => (hotkeys.recording = false));

  const groups = ['タブ', '一覧'] as const;
  const nameOf = (id: CommandId): string => COMMANDS.find((c) => c.id === id)!.name;

  /** その操作のキーのうち、ほかの操作とも重なっているもの（警告に出す） */
  function clashes(id: CommandId): string[] {
    const out: string[] = [];
    for (const [key, ids] of hotkeys.conflicts) {
      if (!ids.includes(id)) continue;
      out.push(`${formatHotkey(key)}（${ids.filter((x) => x !== id).map(nameOf).join('・')}）`);
    }
    return out;
  }
</script>

{#each groups as group (group)}
  <p class="hotkey-group">{group}</p>
  {#each COMMANDS.filter((c) => c.group === group) as c (c.id)}
    {@const clash = clashes(c.id)}
    <SettingRow name={c.name}>
      {#snippet control()}
        <div class="hotkey-keys" data-command={c.id}>
          {#if clash.length > 0}
            <span class="hotkey-warn" role="img" aria-label={`同じキーが、ほかの操作にもあります: ${clash.join('、')}`} title={`同じキーが、ほかの操作にもあります: ${clash.join('、')}`}><TriangleAlert size={16} /></span>
          {/if}
          {#each hotkeys.keys(c.id) as k (k)}
            <span class="hotkey-chip">
              <kbd>{formatHotkey(k)}</kbd>
              <button class="hotkey-remove" type="button" aria-label={`${c.name}の ${formatHotkey(k)} を外す`} title="外す" onclick={() => hotkeys.remove(c.id, k)}><X size={12} /></button>
            </span>
          {/each}
          {#if recording === c.id}
            <span class="hotkey-recording" role="status">キーを押してください（Esc で取り消し）</span>
          {:else}
            <IconButton label={`${c.name}のキーを追加`} title="キーを追加" onclick={() => (recording = c.id)}><Plus size={16} /></IconButton>
          {/if}
          {#if hotkeys.isCustom(c.id)}
            <IconButton label={`${c.name}のキーを既定に戻す`} title="既定に戻す" onclick={() => hotkeys.reset(c.id)}><RotateCcw size={16} /></IconButton>
          {/if}
        </div>
      {/snippet}
    </SettingRow>
  {/each}
{/each}

<p class="hotkey-group">変えられないもの</p>
{#each FIXED_HOTKEYS as f (f.name)}
  <SettingRow name={f.name}>
    {#snippet control()}<kbd class="hotkey-fixed">{f.keys}</kbd>{/snippet}
  </SettingRow>
{/each}

<style>
  .hotkey-group {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .hotkey-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  .hotkey-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  kbd {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: var(--fs-sm);
    white-space: nowrap;
  }
  .hotkey-remove {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
  }
  .hotkey-remove:hover {
    background: var(--accent-soft);
    color: var(--text);
  }
  .hotkey-recording {
    color: var(--accent);
    font-size: var(--fs-sm);
  }
  .hotkey-warn {
    display: inline-grid;
    color: var(--danger);
  }
</style>
