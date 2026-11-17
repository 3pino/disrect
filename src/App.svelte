<script lang="ts">
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Eye from '@lucide/svelte/icons/eye';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import FileExplorer from '@3pino/explorer-kit/FileExplorer.svelte';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import { createExplorer, type Explorer, type ExplorerApi, type EntryUrls, type Rules } from '@3pino/explorer-kit';
  import Toasts from '@3pino/app-kit-web/shell/Toasts.svelte';
  import ConfirmDialog from '@3pino/app-kit-web/shell/ConfirmDialog.svelte';
  import { isBackKey } from '@3pino/app-kit-web/core/backNav';
  import PlaceDialog from './components/PlaceDialog.svelte';
  import { createLocalFs, type LocalFs } from './lib/fs/local';
  import { createDavFs } from './lib/fs/webdav';
  import type { FsPlace } from './lib/fs/types';
  import { HostState, createHost, failureText } from './lib/host.svelte';
  import { placeLabel } from './lib/labels';
  import { places as saved, type DavPlace } from './lib/places.svelte';
  import { settings } from './lib/settings.svelte';

  // 外枠（上のバー・左の場所の一覧）と、エクスプローラーの本体。
  // 本体は共有の部品（@3pino/explorer-kit）に、置き場所（この端末、または追加したネットワークの場所）を渡したもの。
  // 外枠の見た目は仮（利用者の確認を取っていない）。
  const host = new HostState();
  /** 開いている（または開いたことのある）置き場所。切り替えても、開いていたフォルダ・選びを保つ */
  type Bundle = { id: string; explorer: Explorer; local?: LocalFs; dav?: { base: string } };
  const LOCAL = 'local';
  const bundles = new Map<string, Bundle>();
  let current = $state.raw<Bundle | null>(null);
  /** 状態の表示のために、作った置き場所の写し（bundles は反応しない入れ物なので） */
  let known = $state.raw<Record<string, Bundle>>({});
  let places = $state.raw<FsPlace[]>([]);
  let failed = $state('');
  /** 場所の欄に打っている文字（開いているフォルダが変わったら、それに合わせる） */
  let address = $state('');
  let dialog = $state.raw<{ place?: DavPlace } | null>(null);

  const explorer = $derived(current?.explorer ?? null);
  const viewStore = { read: () => settings.dirs, write: (map: unknown) => (settings.dirs = map) };

  function makeBundle(id: string, parts: { api: ExplorerApi; urls: EntryUrls; rules: Rules; open: (path: string) => Promise<void>; isMissing: (e: unknown) => boolean }, extra: Pick<Parameters<typeof createExplorer>[0], 'caps' | 'labels'>): Explorer {
    return createExplorer({
      api: parts.api,
      urls: parts.urls,
      rules: parts.rules,
      host: createHost(host, parts),
      isMissing: parts.isMissing,
      viewStore,
      ...extra,
    });
  }

  function remember(b: Bundle): Bundle {
    bundles.set(b.id, b);
    known = { ...known, [b.id]: b };
    return b;
  }

  onMount(() => {
    void (async () => {
      try {
        const fs = await createLocalFs({ showHidden: () => settings.showHidden });
        const made = makeBundle(LOCAL, fs, {
          // OS のゴミ箱へ入れたものは、ここからは戻せない
          caps: { restore: false },
          labels: { root: fs.windows ? 'PC' : 'コンピューター', upload: 'ファイルを取り込む' },
        });
        made.nav.dir = fs.start;
        current = remember({ id: LOCAL, explorer: made, local: fs });
        places = await fs.places();
      } catch (e) {
        failed = failureText(e);
      }
    })();
  });

  $effect(() => {
    if (!current || !explorer) return;
    address = current.local ? current.local.osPath(explorer.nav.dir) : (current.dav?.base ?? '') + explorer.nav.dir;
  });

  /** 追加したネットワークの場所を開く（初めてなら、置き場所を作る） */
  function openDav(p: DavPlace): void {
    let b = bundles.get(p.id);
    if (!b) {
      const fs = createDavFs({ base: p.url, showHidden: () => settings.showHidden });
      // ゴミ箱は無い。削除は、確認のうえ完全に削除する
      const made = makeBundle(p.id, fs, { caps: { restore: false, trash: false }, labels: { root: p.name, upload: 'ファイルを取り込む' } });
      b = remember({ id: p.id, explorer: made, dav: { base: p.url } });
    }
    current = b;
  }

  /** この端末の場所を開く（ネットワークの場所を見ていたら、この端末へ戻る） */
  function go(path: string): void {
    const b = bundles.get(LOCAL);
    if (!b) return;
    current = b;
    b.explorer.nav.open(path);
  }

  /** 置き場所の覚えを変えたとき、作ってあった置き場所を捨てる（URL・名前が変わったので、作り直す） */
  function forget(id: string): void {
    bundles.delete(id);
    const { [id]: _gone, ...rest } = known;
    known = rest;
    if (current?.id === id) current = bundles.get(LOCAL) ?? null;
  }

  function saveDialog(name: string, url: string): string | null {
    const editing = dialog?.place;
    const r = editing ? saved.update(editing.id, name, url) : saved.add(name, url);
    if (!r.ok) return r.reason;
    dialog = null;
    if (editing) {
      const wasCurrent = current?.id === editing.id;
      forget(editing.id);
      if (wasCurrent) openDav(r.place);
    } else {
      openDav(r.place);
    }
    return null;
  }

  async function removeDialog(): Promise<void> {
    const p = dialog?.place;
    dialog = null;
    if (!p) return;
    const ok = await host.confirm({
      title: `「${p.name}」を一覧から外しますか`,
      body: 'この端末の覚えを消すだけです。サーバーのファイルは消えません',
      okLabel: '外す',
      danger: true,
    });
    if (!ok) return;
    saved.remove(p.id);
    forget(p.id);
  }

  /** 左の一覧の項目に出す、つながらなかった印（開いた置き場所の、いちばん上の一覧が読めなかったとき） */
  function broken(id: string): string | null {
    const st = known[id]?.explorer.index.state('');
    return st?.kind === 'error' ? st.message : null;
  }

  function submitAddress(ev: SubmitEvent): void {
    ev.preventDefault();
    const typed = address.trim();
    if (typed !== '' && current?.local) explorer?.nav.open(current.local.fromOsPath(typed));
  }

  function toggleHidden(): void {
    settings.showHidden = !settings.showHidden;
    // 一覧の写しは、隠しファイルを除いたもの。読み直す
    explorer?.nav.reload();
  }

  /** 「戻る」（マウスの戻るボタン・Alt+←）。入力中の欄では、文字の操作を奪わない */
  function onKey(ev: KeyboardEvent): void {
    if (isBackKey(ev) && host.back()) ev.preventDefault();
  }
  function onMouseUp(ev: MouseEvent): void {
    if (ev.button === 3 && host.back()) ev.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} onmouseup={onMouseUp} />

<div class="app">
  {#if failed}
    <p class="status-line status-line-error start-error" role="alert">起動できませんでした: {failed}</p>
  {:else if current && explorer}
    <header class="bar top-bar">
      <IconButton label="戻る" title="戻る" disabled={!host.canBack} onclick={() => host.back()}><ArrowLeft size={18} /></IconButton>
      <IconButton label="上のフォルダへ" title="上のフォルダへ" disabled={explorer.nav.dir === ''} onclick={() => explorer?.nav.up()}><ArrowUp size={18} /></IconButton>
      <IconButton label="読み直す" title="読み直す" onclick={() => explorer?.nav.reload()}><RotateCw size={18} /></IconButton>
      <form class="address" onsubmit={submitAddress}>
        <input class="input" type="text" aria-label="場所" spellcheck="false" autocomplete="off" readonly={!current.local} bind:value={address} />
      </form>
      <IconButton label="隠しファイルを表示" title="隠しファイルを表示" active={settings.showHidden} aria-pressed={settings.showHidden} onclick={toggleHidden}><Eye size={18} /></IconButton>
    </header>

    <div class="body">
      <nav class="places scroll" aria-label="場所">
        {#each places as p (p.kind + p.path)}
          <button class="menu-item" type="button" aria-current={current.local && p.path === explorer.nav.dir ? 'page' : undefined} onclick={() => go(p.path)}>{placeLabel(p)}</button>
        {/each}
        <div class="places-head">
          <span class="places-title">ネットワーク</span>
          <IconButton label="ネットワークの場所を追加" title="ネットワークの場所を追加" onclick={() => (dialog = {})}><Plus size={16} /></IconButton>
        </div>
        {#each saved.list as p (p.id)}
          {@const why = broken(p.id)}
          <div class="place-row">
            <button class="menu-item place-open" type="button" aria-current={current.id === p.id ? 'page' : undefined} title={why ? `つながりません: ${why}` : p.url} onclick={() => openDav(p)}>
              {p.name}{#if why}<span class="place-broken" role="img" aria-label="つながりません">!</span>{/if}
            </button>
            <IconButton label={`「${p.name}」を直す`} title="直す・外す" onclick={() => (dialog = { place: p })}><Pencil size={14} /></IconButton>
          </div>
        {/each}
      </nav>
      <main class="main">
        {#key current}
          <FileExplorer {explorer} />
        {/key}
      </main>
    </div>
  {/if}
</div>

<Toasts toasts={host.shell.toasts} dismiss={(id) => host.dismiss(id)} />
<ConfirmDialog request={host.shell.confirmReq} />
{#if dialog}
  <PlaceDialog place={dialog.place} onsave={saveDialog} onremove={dialog.place ? () => void removeDialog() : undefined} onclose={() => (dialog = null)} />
{/if}

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
  .places-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-4);
    padding-inline: var(--space-2);
  }
  .places-title {
    color: var(--text-muted);
    font-size: var(--fs-sm, 0.85em);
  }
  .place-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .places .place-row .place-open {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .place-broken {
    margin-left: var(--space-2);
    color: var(--danger);
    font-weight: bold;
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
