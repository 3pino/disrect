import { createExplorerView } from './view';
import { hostGlobal, type HostPluginBase } from './sdk';

const disnans = hostGlobal();

/** プラグインの ID（view の type・ナビの項目の id と同じ） */
export const ID = 'fixplor';

/** 共有フォルダのエクスプローラー */
export default class FixplorPlugin extends disnans.Plugin {
  onload(): void {
    // セッションを持たない view（共有フォルダは誰のものでもない。カードも作らない）
    this.registerView(ID, () => createExplorerView({ plugin: this as unknown as HostPluginBase, disnans }));
    // ナビバーの入口（選ぶと、この view をパネルに開く）
    const nav = disnans.ui.navItem({ id: ID, label: 'ファイル', icon: 'folder', view: ID });
    this.register(() => nav.close());
  }
}
