import { mount, unmount } from 'svelte';
import FileExplorer from '@3pino/explorer-kit/FileExplorer.svelte';
import { createExplorer, type Explorer } from '@3pino/explorer-kit';
import { createFilesApi } from './files-api';
import { createHost } from './host';
import { createRules } from './rules';
import { createViewStore } from './store.svelte';
import { createUrls } from './urls';
import type { HostGlobal, HostPluginBase, HostView } from './sdk';

/** 開いている画面（エクスプローラー）と、開くフォルダの引き継ぎ（本文のリンクから開くとき） */
export type Shelf = {
  /** いま開いている画面のエクスプローラー（無ければ null） */
  current: Explorer | null;
  /** 次に開く画面が、最初に出すフォルダ（開いたら 1 度だけ使う） */
  pendingDir: string | null;
};

export function createShelf(): Shelf {
  return { current: null, pendingDir: null };
}

export type PluginDeps = { plugin: HostPluginBase; disnans: HostGlobal; shelf?: Shelf };

/**
 * 共有フォルダのエクスプローラー（本体のパネルの中身）。画面と決まりは共有の部品（@3pino/explorer-kit）。
 * ここは、その 2 つの口へ本体の実装（`this.files`・`disnans.ui`）を渡して、`containerEl` に載せるだけ。
 */
export function createExplorerView({ plugin, disnans, shelf = createShelf() }: PluginDeps): HostView & { explorer: Explorer | null } {
  const persisted = createViewStore(plugin, () => plugin.legacyData);
  let component: ReturnType<typeof mount> | null = null;
  /** 載せた入れ物の元の style（片付けるときに戻す） */
  let restore: (() => void) | null = null;
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
        host: createHost(disnans, { platform: plugin.app.platform }),
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
      if (shelf.pendingDir !== null) {
        explorer.nav.dir = shelf.pendingDir;
        shelf.pendingDir = null;
      }
      // 共有フォルダの変更（どの端末の変更でも）は、一覧の写しへ伝える
      const offChange = files.onChange((ev) => explorer.index.invalidate(ev.path));
      view.explorer = explorer;
      shelf.current = explorer;
      // 全画面の view（`layout: 'full'`）には、本体の見出しが無い。上端の安全域（ノッチ・ステータスバー）は、一番上の行（.top-bar）が取る。
      // 残りの高さは、エクスプローラーに渡す（入れ物を縦に並べる）
      const prev = { display: containerEl.style.display, flexDirection: containerEl.style.flexDirection };
      containerEl.style.display = 'flex';
      containerEl.style.flexDirection = 'column';
      const top = document.createElement('div');
      top.className = 'top-bar';
      const stage = document.createElement('div');
      stage.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column';
      containerEl.replaceChildren(top, stage);
      restore = () => {
        containerEl.style.display = prev.display;
        containerEl.style.flexDirection = prev.flexDirection;
        top.remove();
        stage.remove();
      };
      component = mount(FileExplorer, { target: stage, props: { explorer } });
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
      restore?.();
      restore = null;
      if (shelf.current === view.explorer) shelf.current = null;
      view.explorer = null;
      void persisted.flush().catch(() => {});
    },
  };
  return view;
}
