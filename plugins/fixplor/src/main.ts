import { parentOf } from '@3pino/explorer-kit';
import { createExplorerView, createShelf } from './view';
import { hostGlobal, type HostPluginBase } from './sdk';

const disnans = hostGlobal();

/** プラグインの ID（view の type） */
export const ID = 'fixplor';
/** ナビの項目の id（本体の中で一意にするため、プラグイン ID を前に付ける） */
export const NAV_ID = `${ID}:files`;

/** 共有フォルダのエクスプローラー */
export default class FixplorPlugin extends disnans.Plugin {
  onload(): void {
    const shelf = createShelf();
    const self = this as unknown as HostPluginBase;
    // セッションを持たない view（共有フォルダは誰のものでもない。カードも作らない）。全画面で開く（本体の見出しは無い。上端の安全域は本体が空ける。view は安全域を扱わない）
    this.registerView(ID, () => createExplorerView({ plugin: self, disnans, shelf }), { layout: 'full' });
    // ナビバーの入口（選ぶと、この view をパネルに開く）
    const nav = disnans.ui.navItem({ id: NAV_ID, label: 'ファイル', icon: 'folder', view: ID });
    this.register(() => nav.close());
    // 本文のファイルのリンクを押したら、そのファイルのあるフォルダ（リンクがフォルダならその中）を開く
    const off = disnans.chat?.registerLinkOpener((path) => void openAt(self, shelf, path));
    if (off) this.register(off);
  }
}

/** パスのフォルダを、画面に出す（開いている画面があれば、そこで開く。無ければ、開く画面が最初に出す） */
export async function openAt(plugin: HostPluginBase, shelf: ReturnType<typeof createShelf>, path: string): Promise<void> {
  let dir = parentOf(path);
  try {
    if ((await plugin.files.stat(path)).kind === 'dir') dir = path;
  } catch {
    // 無くなっていても、親のフォルダまでは開く
  }
  if (shelf.current) shelf.current.nav.open(dir);
  else shelf.pendingDir = dir;
  plugin.openView(ID);
}
