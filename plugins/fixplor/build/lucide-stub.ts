// ui-kit-web は、名前でアイコンを引くとき Lucide 全部（約 700 KB）を別チャンクで読み込む。
// プラグインでは、アイコンを Svelte の部品（@lucide/svelte/icons/*）で渡すので、全部の一覧は同梱しない（空にして、名前の引きは本体の ui.icon に任せる）。
export const icons: Record<string, never> = {};
