<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import StatusLine from '@3pino/ui-kit-web/StatusLine.svelte';
  import type { UpdateState } from '@3pino/app-kit-web/updater';

  // 「バージョン情報」: いまの版と、アプリの更新の確認・入れ替え。更新は、取得して入れ替えたあと、アプリを起動し直す。
  // updater は土台の Updater（試験では偽物）。開いたときに版を読む。確認は、押したときだけ（裏の確認は updateWatch が行う）。
  let {
    updater,
    onclose,
  }: {
    updater: {
      supported: boolean;
      version: string | null;
      state: UpdateState;
      loadVersion(): Promise<void>;
      check(opts?: { quiet?: boolean }): Promise<void>;
      install(): Promise<void>;
      openReleasePage(): Promise<void>;
    };
    onclose: () => void;
  } = $props();

  const st = $derived(updater.state);
  const busy = $derived(st.kind === 'checking' || st.kind === 'downloading' || st.kind === 'installing');
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

  onMount(() => void updater.loadVersion());
</script>

<Modal title="バージョン情報" {onclose}>
  <div class="about">
    <p class="about-version">fixplor {updater.supported ? (updater.version ? `v${updater.version}` : '…') : '（開発版）'}</p>
    {#if !updater.supported}
      <p class="about-note">この環境では、アプリの更新を確認できません。</p>
    {:else if st.kind === 'checking'}
      <StatusLine kind="muted" busy>確認しています…</StatusLine>
    {:else if st.kind === 'latest'}
      <StatusLine kind="ok">最新です</StatusLine>
    {:else if st.kind === 'available'}
      <StatusLine kind="accent">新しいバージョンがあります: v{st.version}</StatusLine>
      {#if st.notes}<pre class="about-notes">{st.notes}</pre>{/if}
    {:else if st.kind === 'downloading'}
      <StatusLine kind="muted" busy>
        ダウンロード中…
        {#if st.total}{Math.floor((st.downloaded / st.total) * 100)}%{:else}{mb(st.downloaded)} MB{/if}
      </StatusLine>
      <progress class="about-progress" max={st.total ?? undefined} value={st.total ? st.downloaded : undefined}></progress>
    {:else if st.kind === 'installing'}
      <StatusLine kind="muted" busy>入れ替えています…（このあと、アプリを起動し直します）</StatusLine>
    {:else if st.kind === 'error'}
      <StatusLine kind="error">エラー: {st.message}</StatusLine>
      <p class="about-note">うまくいかないときは、リリースページから直接ダウンロードできます。</p>
    {/if}
    <div class="modal-actions">
      {#if st.kind === 'error'}<Button class="about-release" onclick={() => void updater.openReleasePage()}>リリースページを開く</Button>{/if}
      <Button onclick={onclose}>閉じる</Button>
      {#if updater.supported}
        {#if st.kind === 'available'}
          <Button class="about-install" variant="primary" onclick={() => void updater.install()}>ダウンロードして入れ替える</Button>
        {:else}
          <Button class="about-check" disabled={busy} onclick={() => void updater.check()}>更新を確認</Button>
        {/if}
      {/if}
    </div>
  </div>
</Modal>

<style>
  .about {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .about p {
    margin: 0;
  }
  .about-version {
    font-weight: var(--fw-semibold);
  }
  .about-note {
    color: var(--text-muted);
    font-size: var(--fs-base);
  }
  .about-notes {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: inherit;
    font-size: var(--fs-base);
    color: var(--text-muted);
  }
  .about-progress {
    width: 100%;
  }
</style>
