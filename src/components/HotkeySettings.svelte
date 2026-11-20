<script lang="ts">
  import { isAndroid } from '@3pino/app-kit-web/core/platform';
  import HotkeySettingsView from '@3pino/app-kit-web/settings/HotkeySettings.svelte';
  import { COMMANDS, GROUPS } from '../lib/hotkeys';
  import { hotkeys } from '../lib/hotkeys.svelte';

  // 設定の「ホットキー」: 画面は土台の部品。ここは、このアプリの操作の一覧（lib/hotkeys.ts）と保存（lib/hotkeys.svelte.ts）を渡すだけ。
  // 記録のあいだは、アプリのほかのホットキーを働かせない（hotkeys.recording）。Android には、ウィンドウの操作が無いので出さない。

  const android = isAndroid();
  const shown = COMMANDS.filter((c) => !(android && c.desktopOnly));
  const nameOf = (id: string): string => COMMANDS.find((c) => c.id === id)?.name ?? id;
</script>

<HotkeySettingsView
  commands={shown}
  groups={GROUPS}
  allNames={nameOf}
  keys={(id) => hotkeys.keys(id as never)}
  isCustom={(id) => hotkeys.isCustom(id as never)}
  conflicts={hotkeys.conflicts}
  add={(id, k) => hotkeys.add(id as never, k)}
  remove={(id, k) => hotkeys.remove(id as never, k)}
  reset={(id) => hotkeys.reset(id as never)}
  onrecording={(r) => (hotkeys.recording = r)}
  options={{ sequences: true, search: true }}
/>
