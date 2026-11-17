<script lang="ts">
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import type { HostState } from '../lib/host.svelte';

  // 確認のダイアログ（上書き・ゴミ箱へ移す）。外側を押す・Esc は取り消し
  let { host }: { host: HostState } = $props();
</script>

{#if host.confirming}
  {@const req = host.confirming}
  <Modal title={req.title} onclose={() => host.answer(false)}>
    {#if req.body}<p class="confirm-body">{req.body}</p>{/if}
    <div class="modal-actions">
      <Button onclick={() => host.answer(false)}>{req.ngLabel ?? 'キャンセル'}</Button>
      <Button variant={req.danger ? 'danger' : 'primary'} onclick={() => host.answer(true)}>{req.okLabel}</Button>
    </div>
  </Modal>
{/if}

<style>
  .confirm-body {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-base);
    overflow-wrap: anywhere;
  }
</style>
