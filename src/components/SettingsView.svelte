<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import Section from '@3pino/ui-kit-web/Section.svelte';
  import StatusLine from '@3pino/ui-kit-web/StatusLine.svelte';
  import type { UpdateState } from '@3pino/app-kit-web/updater';
  import HotkeySettings from './HotkeySettings.svelte';

  // 設定（タブの 1 つ）: ホットキー（操作ごとに、キーを変えられる）と、バージョン（いまの版と、アプリの更新の確認・入れ替え）。
  // 更新は、取得して入れ替えたあと、アプリを起動し直す。updater は土台の Updater（試験では偽物）。開いたときに版を読む。
  // 確認は、押したときだけ（裏の確認は updateWatch が行う）。
  let {
    updater,
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
  } = $props();

  const st = $derived(updater.state);
  const busy = $derived(st.kind === 'checking' || st.kind === 'downloading' || st.kind === 'installing');
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

  onMount(() => void updater.loadVersion());
</script>

<div class="settings" role="region" aria-label="設定">
  <div class="settings-inner">
    <Section title="ホットキー">
      <HotkeySettings />
    </Section>

    <Section title="バージョン">
      <div class="about selectable">
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
          <StatusLine kind="muted" busy>アップデートしています…（このあと、アプリを起動し直します）</StatusLine>
        {:else if st.kind === 'error'}
          <StatusLine kind="error">エラー: {st.message}</StatusLine>
          <p class="about-note">うまくいかないときは、リリースページから直接ダウンロードできます。</p>
        {/if}
        <div class="about-actions">
          {#if st.kind === 'error'}<Button class="about-release" onclick={() => void updater.openReleasePage()}>リリースページを開く</Button>{/if}
          {#if updater.supported}
            {#if st.kind === 'available'}
              <Button class="about-install" variant="primary" onclick={() => void updater.install()}>アップデート</Button>
            {:else}
              <Button class="about-check" disabled={busy} onclick={() => void updater.check()}>アップデートを確認</Button>
            {/if}
          {/if}
        </div>
      </div>
    </Section>
  </div>
</div>

<style>
  .settings {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .settings-inner {
    max-width: 640px;
    margin: 0 auto;
    padding: var(--space-4);
  }
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
  .about-actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
