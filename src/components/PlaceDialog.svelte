<script lang="ts">
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import type { DavPlace } from '../lib/places.svelte';

  // ネットワークの置き場所（WebDAV）を足す・直す・外すダイアログ。名前と URL だけ（資格情報は、まだ扱わない）。
  // onsave は、保存できなければ理由の文を返す（できたら null）。onremove があるのは、直すときだけ。
  let {
    place,
    onsave,
    onremove,
    onclose,
  }: {
    place?: DavPlace;
    onsave: (name: string, url: string) => string | null;
    onremove?: () => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(place?.name ?? '');
  // svelte-ignore state_referenced_locally
  let url = $state(place?.url ?? '');
  let error = $state('');

  function submit(ev: SubmitEvent): void {
    ev.preventDefault();
    error = onsave(name, url) ?? '';
  }
</script>

<Modal title={place ? 'ネットワークの場所を直す' : 'ネットワークの場所を追加'} {onclose}>
  <form class="place-form" onsubmit={submit}>
    <label class="field-label" for="place-url">URL（WebDAV）</label>
    <TextInput id="place-url" bind:value={url} placeholder="https://example.com/dav/" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" required />
    <label class="field-label" for="place-name">名前（省くと、サーバーの名前）</label>
    <TextInput id="place-name" bind:value={name} placeholder="自宅のサーバー" autocomplete="off" />
    {#if error}<p class="place-error" role="alert">{error}</p>{/if}
    <div class="modal-actions">
      {#if onremove}<Button variant="danger" class="place-remove" onclick={onremove}>一覧から外す</Button>{/if}
      <Button onclick={onclose}>キャンセル</Button>
      <Button type="submit" variant="primary" disabled={url.trim() === ''}>{place ? '保存' : '追加'}</Button>
    </div>
  </form>
</Modal>

<style>
  .place-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .place-error {
    margin: 0;
    color: var(--danger, var(--text));
    font-size: var(--fs-base);
    overflow-wrap: anywhere;
  }
  .place-form :global(.place-remove) {
    margin-right: auto;
  }
</style>
