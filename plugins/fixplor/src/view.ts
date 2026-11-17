import { mount, unmount } from 'svelte';
import FileExplorer from '@3pino/explorer-kit/FileExplorer.svelte';
import { createExplorer, type Explorer } from '@3pino/explorer-kit';
import { createFilesApi } from './files-api';
import { createHost } from './host';
import { createRules } from './rules';
import { createViewStore } from './store.svelte';
import { createUrls } from './urls';
import type { HostGlobal, HostPluginBase, HostView } from './sdk';

/** 本体の旧い保存先の中身（段 5 の F）。プラグインが初めて開くときだけ、本体が渡す */
export type PluginDeps = { plugin: HostPluginBase; disnans: HostGlobal; legacyData?: unknown };

/**
 * 共有フォルダのエクスプローラー（本体のパネルの中身）。画面と決まりは共有の部品（@3pino/explorer-kit）。
 * ここは、その 2 つの口へ本体の実装（`this.files`・`disnans.ui`）を渡して、`containerEl` に載せるだけ。
 */
export function createExplorerView({ plugin, disnans, legacyData }: PluginDeps): HostView & { explorer: Explorer | null } {
  const persisted = createViewStore(plugin, legacyData);
  let component: ReturnType<typeof mount> | null = null;
  let off: (() => void) | null = null;
  let generation = 0;
  const view: HostView & { explorer: Explorer | null } = {
    title: 'ファイル',
    icon: 'folder',
    explorer: null,
    async onOpen(containerEl) {
      await persisted.load();
      const files = plugin.files;
      const caps = files.caps();
      const listeners = new Set<() => void>();
      // 接続先が変わったら、旧サーバーの場所を開いたままにしない（key を変えて、部品へ知らせる）
      const offServer = disnans.session?.onServerChange(() => {
        generation++;
        for (const cb of [...listeners]) cb();
      });
      const explorer = createExplorer({
        api: createFilesApi(files),
        urls: createUrls(files),
        rules: createRules(caps.attachmentsDir),
        labels: { root: '共有フォルダ', upload: 'アップロード', scope: 'サーバー' },
        host: createHost(disnans, { isMobile: plugin.app.isMobile }),
        caps: { trash: caps.trash, restore: caps.restore },
        scope: {
          key: () => String(generation),
          onChange(cb) {
            listeners.add(cb);
            return () => listeners.delete(cb);
          },
        },
        viewStore: persisted.store,
      });
      // 共有フォルダの変更（どの端末の変更でも）は、一覧の写しへ伝える
      const offChange = files.onChange((ev) => explorer.index.invalidate(ev.path));
      view.explorer = explorer;
      component = mount(FileExplorer, { target: containerEl, props: { explorer } });
      off = () => {
        offChange();
        offServer?.();
      };
    },
    onClose() {
      off?.();
      off = null;
      if (component) void unmount(component);
      component = null;
      view.explorer = null;
      void persisted.flush().catch(() => {});
    },
  };
  return view;
}
