// 表示のために作った URL（画像・PDF の読む元）から、元のパスをたどる。
// 拡大表示の「保存」は、既定のアプリで開く操作なので、URL ではなく項目のパスが要る。

/** 覚えておく数（古いものから捨てる。一覧を見て回っても、増え続けない） */
const MAX = 5000;

export type Sources = {
  /** url を覚えて、そのまま返す */
  note(url: string, path: string): string;
  pathOf(url: string): string | null;
};

export function createSources(): Sources {
  const map = new Map<string, string>();
  return {
    note(url, path) {
      map.delete(url);
      map.set(url, path);
      if (map.size > MAX) map.delete(map.keys().next().value!);
      return url;
    },
    pathOf: (url) => map.get(url) ?? null,
  };
}
