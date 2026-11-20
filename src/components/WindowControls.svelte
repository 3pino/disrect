<script lang="ts">
  import { onMount } from 'svelte';
  import Minus from '@lucide/svelte/icons/minus';
  import Square from '@lucide/svelte/icons/square';
  import Copy from '@lucide/svelte/icons/copy';
  import X from '@lucide/svelte/icons/x';
  import { isWindowMaximized, minimizeWindow, onWindowResized, quitWindow, toggleMaximizeWindow } from '../lib/windowControls';

  // デスクトップの自前のタイトルバーの右端: 最小化・最大化（最大化中は元に戻す）・閉じる。タブの欄（TabBar）に置く
  let maximized = $state(false);

  onMount(() => {
    let off: (() => void) | undefined;
    let gone = false;
    const sync = (): void => void isWindowMaximized().then((m) => (maximized = m)).catch(() => {});
    sync();
    void onWindowResized(sync)
      .then((stop) => (gone ? stop() : (off = stop)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  });
</script>

<div class="window-controls">
  <button type="button" aria-label="最小化" title="最小化" onclick={() => void minimizeWindow()}><Minus size={14} /></button>
  <button type="button" aria-label={maximized ? '元のサイズに戻す' : '最大化'} title={maximized ? '元のサイズに戻す' : '最大化'} onclick={() => void toggleMaximizeWindow()}>
    {#if maximized}<Copy size={12} />{:else}<Square size={12} />{/if}
  </button>
  <button class="window-close" type="button" aria-label="閉じる" title="閉じる" onclick={() => void quitWindow()}><X size={15} /></button>
</div>

<style>
  .window-controls {
    display: flex;
    align-self: stretch;
    flex: none;
    /* タブの欄の右の余白を打ち消して、ウィンドウの右端に付ける */
    margin-right: calc(-1 * var(--space-3));
  }
  button {
    display: grid;
    place-items: center;
    width: 46px;
    border: none;
    background: transparent;
    color: var(--text-muted);
  }
  button:hover {
    background: var(--accent-soft);
    color: var(--text);
  }
  .window-close:hover {
    background: var(--danger);
    color: white;
  }
</style>
