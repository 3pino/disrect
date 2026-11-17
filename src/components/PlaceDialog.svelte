<script lang="ts">
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import type { DavPlace } from '../lib/places.svelte';

  // ネットワークの置き場所（WebDAV）を足す・直す・外すダイアログ。名前・URL と、認証（任意。ユーザー名・パスワード）。
  // パスワードは OS のキーチェーンへ保管され、ここへは戻ってこない（保存済みかどうかだけを知る）。
  // onsave は、保存できなければ理由の文を返す（できたら null）。onremove があるのは、直すときだけ。
  let {
    place,
    saved = null,
    savedError = '',
    focusPassword = false,
    onsave,
    onremove,
    onclose,
  }: {
    place?: DavPlace;
    /** 保管している資格情報（ユーザー名）。無ければ null（認証なし） */
    saved?: { user: string } | null;
    /** 保管の様子を読めなかったときの理由（キーチェーンが使えない など） */
    savedError?: string;
    /** 開いたとき、パスワードの入れ直しから始める（認証が通らなかったとき） */
    focusPassword?: boolean;
    onsave: (name: string, url: string, cred: { user: string; password: string | null } | null) => Promise<string | null>;
    onremove?: () => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(place?.name ?? '');
  // svelte-ignore state_referenced_locally
  let url = $state(place?.url ?? '');
  // svelte-ignore state_referenced_locally
  let user = $state(saved?.user ?? '');
  let password = $state('');
  // svelte-ignore state_referenced_locally
  let changing = $state(focusPassword);
  let error = $state('');
  let busy = $state(false);

  // 保管済みのパスワードを使い続けてよいのは、ユーザー名があり、接続先を変えていないとき（別のサーバーへ、保管したパスワードを渡さない）
  const keeps = $derived(saved !== null && place !== undefined && url.trim() === place.url && !changing);
  const askPassword = $derived(user.trim() !== '' && !keeps);

  async function submit(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    const u = user.trim();
    if (u !== '' && askPassword && password === '') {
      error = 'パスワードを入力してください';
      return;
    }
    busy = true;
    try {
      error = (await onsave(name, url, u === '' ? null : { user: u, password: askPassword ? password : null })) ?? '';
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={place ? 'ネットワークの場所を直す' : 'ネットワークの場所を追加'} {onclose}>
  <form class="place-form" onsubmit={submit}>
    <label class="field-label" for="place-url">URL（WebDAV）</label>
    <TextInput id="place-url" bind:value={url} placeholder="https://example.com/dav/" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" required />
    <label class="field-label" for="place-name">名前（省くと、サーバーの名前）</label>
    <TextInput id="place-name" bind:value={name} placeholder="自宅のサーバー" autocomplete="off" />
    <label class="field-label" for="place-user">ユーザー名（認証が要るときだけ）</label>
    <TextInput id="place-user" bind:value={user} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
    {#if user.trim() !== ''}
      {#if keeps}
        <div class="place-saved">
          <span>パスワード: 保存済み（OS のキーチェーン）</span>
          <Button class="place-change" onclick={() => (changing = true)}>パスワードを変更</Button>
        </div>
      {:else}
        <label class="field-label" for="place-password">パスワード（OS のキーチェーンに保管します）</label>
        <!-- svelte-ignore a11y_autofocus -->
        <TextInput id="place-password" type="password" bind:value={password} autocomplete="new-password" autofocus={focusPassword} />
      {/if}
    {:else if saved}
      <p class="place-note">ユーザー名を空にして保存すると、保管した認証情報を消します。</p>
    {/if}
    {#if savedError}<p class="place-error" role="alert">認証情報を読めません: {savedError}</p>{/if}
    {#if error}<p class="place-error" role="alert">{error}</p>{/if}
    <div class="modal-actions">
      {#if onremove}<Button variant="danger" class="place-remove" onclick={onremove}>一覧から外す</Button>{/if}
      <Button onclick={onclose}>キャンセル</Button>
      <Button type="submit" variant="primary" disabled={url.trim() === '' || busy}>{place ? '保存' : '追加'}</Button>
    </div>
  </form>
</Modal>

<style>
  .place-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .place-saved {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--fs-base);
  }
  .place-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-base);
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
