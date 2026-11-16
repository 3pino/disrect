<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import IconButton from '@3pino/explorer-kit/ui/IconButton.svelte';
  import type { HostState } from '../lib/host.svelte';

  // 通知。見た目はグローバルの .toasts / .toast（@3pino/design-system）
  let { host }: { host: HostState } = $props();
</script>

<div class="toasts" aria-live="polite">
  {#each host.toasts as t (t.id)}
    <div class="toast" class:toast-error={t.kind === 'error'}>
      <span class="toast-text">{t.text}</span>
      {#if t.action}
        {@const action = t.action}
        <button
          type="button"
          class="toast-action"
          onclick={() => {
            action.run();
            host.dismiss(t.id);
          }}>{action.label}</button
        >
      {/if}
      <IconButton label="閉じる" onclick={() => host.dismiss(t.id)}><X size={14} /></IconButton>
    </div>
  {/each}
</div>
