<script lang="ts">
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Eye from '@lucide/svelte/icons/eye';
  import FileExplorer from '@3pino/explorer-kit/FileExplorer.svelte';
  import IconButton from '@3pino/explorer-kit/ui/IconButton.svelte';
  import { createExplorer, type Explorer } from '@3pino/explorer-kit';
  import Toasts from './components/Toasts.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import { createLocalFs, type LocalFs } from './lib/fs/local';
  import type { FsPlace } from './lib/fs/types';
  import { HostState, createHost, failureText } from './lib/host.svelte';
  import { placeLabel } from './lib/labels';
  import { settings } from './lib/settings.svelte';

  // 外枠（上のバー・左の場所の一覧）と、エクスプローラーの本体。
  // 本体は共有の部品（@3pino/explorer-kit。Disnans の共有フォルダの画面と同じもの）に、この端末という置き場所を渡したもの。
  // 外枠の見た目は仮（利用者の確認を取っていない）。
  const host = new HostState();
  let local = $state.raw<LocalFs | null>(null);
  let explorer = $state.raw<Explorer | null>(null);
  let places = $state.raw<FsPlace[]>([]);
  let failed = $state('');
  /** 場所の欄に打っている文字（開いているフォルダが変わったら、それに合わせる） */
  let address = $state('');

  onMount(() => {
    void (async () => {
      try {
        const fs = await createLocalFs({ showHidden: () => settings.showHidden });
        const made = createExplorer({
          api: fs.api,
          urls: fs.urls,
          rules: fs.rules,
          host: createHost(host, fs),
          // OS のゴミ箱へ入れたものは、ここからは戻せない
          caps: { restore: false },
          labels: { root: fs.windows ? 'PC' : 'コンピューター', upload: 'ファイルを取り込む' },
          isMissing: fs.isMissing,
          viewStore: { read: () => settings.dirs, write: (map) => (settings.dirs = map) },
        });
        made.nav.dir = fs.start;
        local = fs;
        explorer = made;
        places = await fs.places();
      } catch (e) {
        failed = failureText(e);
      }
    })();
  });

  $effect(() => {
    if (local && explorer) address = local.osPath(explorer.nav.dir);
  });

  function go(path: string): void {
    explorer?.nav.open(path);
  }

  function submitAddress(ev: SubmitEvent): void {
    ev.preventDefault();
    const typed = address.trim();
    if (typed !== '' && local) go(local.fromOsPath(typed));
  }

  function toggleHidden(): void {
    settings.showHidden = !settings.showHidden;
    // 一覧の写しは、隠しファイルを除いたもの。読み直す
    explorer?.nav.reload();
  }

  /** 「戻る」（マウスの戻るボタン・Alt+←）。入力中の欄では、文字の操作を奪わない */
  function onKey(ev: KeyboardEvent): void {
    if (ev.altKey && ev.key === 'ArrowLeft' && host.back()) ev.preventDefault();
  }
  function onMouseUp(ev: MouseEvent): void {
    if (ev.button === 3 && host.back()) ev.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} onmouseup={onMouseUp} />

<div class="app">
  {#if failed}
    <p class="status-line status-line-error start-error" role="alert">起動できませんでした: {failed}</p>
  {:else if local && explorer}
    <header class="bar top-bar">
      <IconButton label="戻る" title="戻る" disabled={!host.canBack} onclick={() => host.back()}><ArrowLeft size={18} /></IconButton>
      <IconButton label="上のフォルダへ" title="上のフォルダへ" disabled={explorer.nav.dir === ''} onclick={() => explorer?.nav.up()}><ArrowUp size={18} /></IconButton>
      <IconButton label="読み直す" title="読み直す" onclick={() => explorer?.nav.reload()}><RotateCw size={18} /></IconButton>
      <form class="address" onsubmit={submitAddress}>
        <input class="input" type="text" aria-label="場所" spellcheck="false" autocomplete="off" bind:value={address} />
      </form>
      <IconButton label="隠しファイルを表示" title="隠しファイルを表示" active={settings.showHidden} aria-pressed={settings.showHidden} onclick={toggleHidden}><Eye size={18} /></IconButton>
    </header>

    <div class="body">
      <nav class="places scroll" aria-label="場所">
        {#each places as p (p.kind + p.path)}
          <button class="menu-item" type="button" aria-current={p.path === explorer.nav.dir ? 'page' : undefined} onclick={() => go(p.path)}>{placeLabel(p)}</button>
        {/each}
      </nav>
      <main class="main">
        <FileExplorer {explorer} />
      </main>
    </div>
  {/if}
</div>

<Toasts {host} />
<ConfirmDialog {host} />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    color: var(--text);
  }
  .start-error {
    padding: var(--space-6);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .address {
    flex: 1;
    min-width: 0;
  }
  .address .input {
    width: 100%;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .places {
    flex: none;
    width: 200px;
    padding: var(--space-3);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .places .menu-item {
    width: 100%;
  }
  .places .menu-item[aria-current='page'] {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  @media (max-width: 767px) {
    .places {
      display: none;
    }
  }
</style>
