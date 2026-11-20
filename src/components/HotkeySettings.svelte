<script lang="ts">
  import { onDestroy } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Divider from '@3pino/ui-kit-web/Divider.svelte';
  import SettingRow from '@3pino/ui-kit-web/SettingRow.svelte';
  import StatusLine from '@3pino/ui-kit-web/StatusLine.svelte';
  import { isAndroid } from '@3pino/app-kit-web/core/platform';
  import { formatHotkey, hotkeyFromEvent, hotkeyFromMouse } from '@3pino/explorer-kit';
  import { COMMANDS, GROUPS, type Command, type CommandId } from '../lib/hotkeys';
  import { hotkeys } from '../lib/hotkeys.svelte';

  // 設定の「ホットキー」: 操作ごとに、キーを複数決められる（追加・外す・既定に戻す）。保存は各デバイス（lib/hotkeys.svelte.ts）。
  // 記録のあいだは、押したキーを、ほかの操作に渡さない（window の捕捉の段で止める）。Esc も、ほかのキーと同じように記録できる。
  // 記録をやめるのは、もう一度「＋」を押す・ほかを押してフォーカスが外れる、とき。マウスの「戻る」「進む」のボタンも記録できる。
  // 節（まとまり）は、見出しを押して、開く・折りたたむ（初めは、折りたたんである）。

  /** キーを記録している操作 */
  let recording = $state<CommandId | null>(null);

  function onRecordKey(e: KeyboardEvent): void {
    const id = recording;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    const text = hotkeyFromEvent(e);
    // 修飾キーだけのときは、続けて押すキーを待つ
    if (!text) return;
    hotkeys.add(id, text);
    recording = null;
  }

  function onRecordMouse(e: MouseEvent): void {
    const id = recording;
    if (!id) return;
    const text = hotkeyFromMouse(e);
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    hotkeys.add(id, text);
    recording = null;
  }

  $effect(() => {
    hotkeys.recording = recording !== null;
    if (recording === null) return;
    window.addEventListener('keydown', onRecordKey, true);
    window.addEventListener('mouseup', onRecordMouse, true);
    return () => {
      window.removeEventListener('keydown', onRecordKey, true);
      window.removeEventListener('mouseup', onRecordMouse, true);
    };
  });

  /** 開いている節 */
  let opened = $state<Record<string, boolean>>({});
  onDestroy(() => (hotkeys.recording = false));

  // Android には、ウィンドウの操作が無い
  const android = isAndroid();
  const shown = (c: Command): boolean => !(android && c.desktopOnly);
  const sections = GROUPS.map((g) => ({ title: g, commands: COMMANDS.filter((c) => c.group === g && shown(c)) })).filter((s) => s.commands.length > 0);
  const nameOf = (id: CommandId): string => COMMANDS.find((c) => c.id === id)!.name;

  /** その操作のキーのうち、ほかの操作とも重なっているもの（警告に出す） */
  function clashes(id: CommandId): string[] {
    const out: string[] = [];
    for (const [key, ids] of hotkeys.conflicts) {
      if (!ids.includes(id)) continue;
      out.push(`${formatHotkey(key)}（${ids.filter((x) => x !== id).map(nameOf).join('・')}）`);
    }
    return out;
  }
</script>

{#each sections as section (section.title)}
  {@const isOpen = opened[section.title] === true}
  <section class="setting-section">
    <Divider class="setting-section-divider" />
    <h2 class="setting-section-title hotkey-group-title">
      <button type="button" class="hotkey-group-toggle" aria-expanded={isOpen} onclick={() => (opened[section.title] = !isOpen)}>
        <ChevronRight size={16} class={isOpen ? 'hotkey-group-chevron hotkey-group-chevron-open' : 'hotkey-group-chevron'} />
        {section.title}
        <span class="muted hotkey-group-count">{section.commands.length}</span>
      </button>
    </h2>
    {#if isOpen}
    {#each section.commands as c (c.id)}
      {@const clash = clashes(c.id)}
      <div class="hotkey-command" data-command={c.id}>
        <SettingRow name={c.name} class="hotkey-row">
          {#snippet control()}
            {#each hotkeys.keys(c.id) as k (k)}
              <kbd class="kbd hotkey-chip">
                {formatHotkey(k)}
                <button type="button" class="hotkey-remove" aria-label={`${c.name}の ${formatHotkey(k)} を外す`} title="外す" onclick={() => hotkeys.remove(c.id, k)}><X size={12} /></button>
              </kbd>
            {:else}
              <span class="muted hotkey-none">なし</span>
            {/each}
            {#if recording === c.id}
              <span class="hotkey-recording" role="status">キーを押してください…</span>
            {/if}
            <IconButton
              class="hotkey-reset"
              label={`${c.name}のキーを既定に戻す`}
              title="既定に戻す"
              iconSize={16}
              disabled={!hotkeys.isCustom(c.id)}
              onclick={() => hotkeys.reset(c.id)}><RotateCcw size={16} /></IconButton
            >
            <IconButton
              class="hotkey-add"
              label={`${c.name}のキーを追加`}
              title={recording === c.id ? '記録をやめる' : 'キーを追加'}
              active={recording === c.id}
              onclick={() => (recording = recording === c.id ? null : c.id)}
              onblur={() => {
                if (recording === c.id) recording = null;
              }}><Plus size={16} /></IconButton
            >
          {/snippet}
        </SettingRow>
        {#if clash.length > 0}
          <StatusLine kind="warn" icon={TriangleAlert} class="hotkey-conflict">同じキーが、ほかの操作にもあります: {clash.join('、')}</StatusLine>
        {/if}
      </div>
    {/each}
    {/if}
  </section>
{/each}

<style>
  .hotkey-group-title {
    margin: 0;
  }
  /* 見出しの全体が、開く・閉じるのボタン */
  .hotkey-group-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .hotkey-group-toggle :global(.hotkey-group-chevron) {
    flex: none;
    transition: transform 0.15s ease;
  }
  .hotkey-group-toggle :global(.hotkey-group-chevron-open) {
    transform: rotate(90deg);
  }
  .hotkey-group-count {
    font-size: var(--fs-sm);
    font-weight: normal;
  }
  .hotkey-command > :global(.hotkey-conflict) {
    margin-top: var(--space-2);
    font-size: var(--fs-sm);
  }
  /* 行の右にキーを並べる。各キーの中の × で外す */
  .hotkey-command :global(.hotkey-row .setting-row-control) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .hotkey-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hotkey-remove {
    display: inline-grid;
    place-items: center;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }
  .hotkey-remove:hover {
    opacity: 1;
  }
  .hotkey-none,
  .hotkey-recording {
    font-size: var(--fs-sm);
  }
  /* 記録中は、キーを待っていることがわかるようにアクセントの色にする */
  .hotkey-recording {
    color: var(--accent);
  }
  /* 押せないときは隠す（位置はそろえたまま） */
  .hotkey-command :global(.hotkey-reset:disabled) {
    visibility: hidden;
  }
</style>
