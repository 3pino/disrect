<script lang="ts">
  import { onMount } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Copy from '@lucide/svelte/icons/copy';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import Section from '@3pino/ui-kit-web/Section.svelte';
  import SettingRow from '@3pino/ui-kit-web/SettingRow.svelte';
  import StatusLine from '@3pino/ui-kit-web/StatusLine.svelte';
  import { bulkInstallCommand, checkDependency, DEPENDENCIES, installCommand, openLink, type Dependency, type DependencyStatus, type OsName } from '../lib/dependencies';

  // 設定の「依存」: 入れておくと便利な外部のコマンドが入っているかのチェックリスト。
  // 入っていないものは、入れるコマンド（この OS 向け）をコピーできる。配布元（GitHub）へのリンクと、入っていないものをまとめて入れるコマンドもある。
  let { os }: { os: OsName } = $props();

  let status = $state<Record<string, DependencyStatus>>({});
  /** 「コピーしました」を出している行（id。まとめては ''） */
  let copied = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let failed = $state<string | null>(null);

  async function check(): Promise<void> {
    status = Object.fromEntries(DEPENDENCIES.map((d) => [d.id, 'checking' as const]));
    await Promise.all(
      DEPENDENCIES.map(async (d) => {
        try {
          status[d.id] = { found: await checkDependency(d) };
        } catch {
          status[d.id] = 'error';
        }
      }),
    );
  }
  onMount(() => {
    void check();
    return () => clearTimeout(copyTimer);
  });

  const isMissing = (d: Dependency): boolean => {
    const s = status[d.id];
    return typeof s === 'object' && s.found === null;
  };
  const missing = $derived(DEPENDENCIES.filter(isMissing));
  const bulk = $derived(bulkInstallCommand(missing, os));
  const checking = $derived(Object.values(status).some((s) => s === 'checking'));

  async function copy(id: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      failed = null;
      copied = id;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = null), 2000);
    } catch {
      failed = 'コピーできませんでした';
    }
  }
  async function open(url: string): Promise<void> {
    try {
      await openLink(url);
      failed = null;
    } catch {
      failed = 'ページを開けませんでした';
    }
  }
</script>

<Section title="チェックリスト" class="deps-list">
  {#each DEPENDENCIES as d (d.id)}
    {@const s = status[d.id]}
    {@const cmd = installCommand(d, os)}
    <div class="dep" data-dependency={d.id}>
      <SettingRow name={d.name} description={d.description} class="dep-row">
        {#snippet control()}
          <span class="dep-status" class:dep-status-ok={typeof s === 'object' && s.found !== null} class:dep-status-missing={isMissing(d)}>
            {#if s === undefined || s === 'checking'}
              確認しています…
            {:else if s === 'error'}
              確認できませんでした
            {:else if s.found}
              <Check size={14} />入っています{s.found.version ? `（${s.found.version}）` : ''}
            {:else}
              <CircleAlert size={14} />入っていません
            {/if}
          </span>
          <IconButton class="dep-link" label={`${d.name}の配布元（GitHub）を開く`} title="GitHub を開く" onclick={() => void open(d.github)}><ExternalLink size={16} /></IconButton>
        {/snippet}
      </SettingRow>
      {#if cmd}
        <div class="dep-install">
          <code class="selectable dep-command">{cmd}</code>
          <IconButton class="dep-copy" label={`${d.name}を入れるコマンドをコピー`} title="コマンドをコピー" onclick={() => void copy(d.id, cmd)}><Copy size={16} /></IconButton>
          {#if copied === d.id}<span class="dep-copied" role="status">コピーしました</span>{/if}
        </div>
      {:else}
        <p class="muted dep-none">この OS 向けの入れ方は、配布元のページを見てください。</p>
      {/if}
      {#if d.note?.[os]}<p class="muted dep-note">{d.note[os]}</p>{/if}
    </div>
  {/each}
</Section>

<Section title="まとめて入れる" class="deps-bulk">
  {#if bulk}
    <p class="muted dep-note">入っていないものを、まとめて入れるコマンドです。ターミナル（{os === 'windows' ? 'PowerShell' : 'シェル'}）に貼り付けて実行します。</p>
    <div class="dep-install">
      <code class="selectable dep-command dep-bulk-command">{bulk}</code>
      <IconButton class="dep-bulk-copy" label="まとめて入れるコマンドをコピー" title="コマンドをコピー" onclick={() => void copy('', bulk)}><Copy size={16} /></IconButton>
      {#if copied === ''}<span class="dep-copied" role="status">コピーしました</span>{/if}
    </div>
  {:else if checking}
    <StatusLine kind="muted" busy>確認しています…</StatusLine>
  {:else}
    <StatusLine kind="ok">入れるものはありません</StatusLine>
  {/if}
  <div class="dep-actions">
    <Button class="dep-recheck" disabled={checking} icon={RefreshCw} onclick={() => void check()}>もう一度確認</Button>
  </div>
  {#if failed}<StatusLine kind="error">{failed}</StatusLine>{/if}
</Section>

<style>
  .dep {
    padding-bottom: var(--space-3);
  }
  .dep-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .dep-status-ok {
    color: var(--accent);
  }
  .dep-status-missing {
    color: var(--danger);
  }
  .dep-install {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .dep-command {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: var(--fs-sm);
    overflow-x: auto;
    white-space: nowrap;
  }
  .dep-copied {
    font-size: var(--fs-sm);
    color: var(--accent);
  }
  .dep-note,
  .dep-none {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
  }
  .dep-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
</style>
