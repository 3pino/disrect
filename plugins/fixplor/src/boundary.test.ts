import { describe, expect, it } from 'vitest';
import { bundleProblems, manifestProblems, run, sourceProblems, specifiers } from '../scripts/check-boundary.mjs';

// 境界の検査そのものの試験（本物のソースは問題なし。悪い例を、ちゃんと見つける）。

describe('ソースの import', () => {
  it('相手を全部の書き方から拾う（import・export from・動的・require）', () => {
    const src = `
      import a from 'svelte';
      import type { T } from "@3pino/explorer-kit";
      import './x';
      export { b } from '../y';
      const m = await import('lodash');
      const r = require('fs');
      // import c from 'commented';
      /* import d from 'blocked'; */
    `;
    expect(specifiers(src)).toEqual(['svelte', '@3pino/explorer-kit', './x', '../y', 'lodash', 'fs']);
  });

  it('許すのは 相対・svelte・@lucide/svelte・@3pino/*。本体の内部・Tauri・node は断る', () => {
    expect(sourceProblems('a.ts', `import x from '@lucide/svelte/icons/search'; import { mount } from 'svelte'; import s from 'svelte/store';`)).toEqual([]);
    const bad = sourceProblems('a.ts', `import a from '@tauri-apps/api/core'; import b from '../../app/src/lib/x'; import c from 'node:fs'; import d from 'sveltekit';`);
    expect(bad).toHaveLength(3);
    expect(bad.join('\n')).toContain('@tauri-apps/api/core');
    expect(bad.join('\n')).toContain('node:fs');
    expect(bad.join('\n')).toContain('sveltekit');
  });

  it('このプラグインの本物のソースは、境界を守っている', () => {
    expect(run([])).toEqual([]);
  });
});

describe('成果物（main.js）', () => {
  it('完結した 1 つのモジュールは問題なし（export default・文字列の中の語は見ない）', () => {
    expect(bundleProblems('main.js', `var a=1;export{a as default};const s="import x from 'y'";`)).toEqual([]);
  });

  it('import 文・export from・動的 import・require・Tauri の参照を見つける', () => {
    expect(bundleProblems('m.js', `import{a}from"svelte";\nexport default a;`)).toHaveLength(1);
    expect(bundleProblems('m.js', `import "x";`)).toHaveLength(1);
    expect(bundleProblems('m.js', `export{a}from"./y";`)).toHaveLength(1);
    expect(bundleProblems('m.js', `const m=await import("./chunk.js");`)).toHaveLength(1);
    expect(bundleProblems('m.js', `const r=require("fs");`)).toHaveLength(1);
    expect(bundleProblems('m.js', `window.__TAURI_INTERNALS__.invoke()`)).toHaveLength(1);
    expect(bundleProblems('m.js', `import("@tauri-apps/api/core")`).length).toBeGreaterThanOrEqual(2);
  });
});

describe('manifest.json', () => {
  const ok = { id: 'fixplor', name: 'n', version: '0.1.0', description: 'd', author: 'a', minApiVersion: 19, permissions: ['files'] };

  it('正しい manifest は問題なし。id・版・API の版・権限・必須の欄の誤りを見つける', () => {
    expect(manifestProblems(ok)).toEqual([]);
    expect(manifestProblems({ ...ok, id: 'Fix_plor' })).toHaveLength(1);
    expect(manifestProblems({ ...ok, version: '1.0' })).toHaveLength(1);
    expect(manifestProblems({ ...ok, minApiVersion: 18 })).toHaveLength(1);
    expect(manifestProblems({ ...ok, permissions: [] })).toHaveLength(1);
    expect(manifestProblems({ ...ok, author: '' })).toHaveLength(1);
  });
});
