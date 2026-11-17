import { createExplorerView } from './view';
import { hostGlobal, type HostPluginBase } from './sdk';

const disnans = hostGlobal();

/** 共有フォルダのエクスプローラー。本体の画面から開く入口は、本体が出す（ナビの項目など。段 5 の A） */
export default class FixplorPlugin extends disnans.Plugin {
  onload(): void {
    // type はプラグイン ID と同じ。セッションを持たない view（共有フォルダは誰のものでもない）
    this.registerView('fixplor', () => createExplorerView({ plugin: this as unknown as HostPluginBase, disnans }));
  }
}
