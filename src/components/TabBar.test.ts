// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TabBar from './TabBar.svelte';

// 狭い画面: タブは「いまのタブの名前」1 つと、押すと開く一覧になる。広い画面: これまでどおり一列
function setWidth(narrow: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: narrow && q === '(max-width: 600px)',
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const tabs = [
  { id: 1, label: '内部', title: '内部ストレージ' },
  { id: 2, label: 'Download', title: '/storage/emulated/0/Download' },
];

function render(props: Partial<{ onselect: (id: number) => void; onclose: (id: number) => void }> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onselect = props.onselect ?? vi.fn();
  const onclose = props.onclose ?? vi.fn();
  const component = mount(TabBar, {
    target,
    props: { tabs, activeId: 2, onselect, onclose, onadd: vi.fn(), onduplicate: vi.fn(), onmove: vi.fn(), oncloseothers: vi.fn() },
  });
  flushSync();
  return { target, component, onselect, onclose };
}

describe('TabBar（狭い画面）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('いまのタブの名前と位置だけを出し、一覧は押すまで出さない', () => {
    setWidth(true);
    const { target, component } = render();
    expect(target.querySelector('.tab-current')?.textContent).toContain('Download');
    expect(target.querySelector('.tab-count')?.textContent).toBe('2/2');
    expect(target.querySelector('.tab-list')).toBeNull();
    (target.querySelector('.tab-current') as HTMLButtonElement).click();
    flushSync();
    expect(target.querySelectorAll('.tab-row').length).toBe(2);
    unmount(component);
  });

  it('一覧から選ぶと onselect を呼び、一覧を閉じる', () => {
    setWidth(true);
    const { target, component, onselect } = render();
    (target.querySelector('.tab-current') as HTMLButtonElement).click();
    flushSync();
    (target.querySelectorAll('.tab-row-main')[0] as HTMLButtonElement).click();
    flushSync();
    expect(onselect).toHaveBeenCalledWith(1);
    expect(target.querySelector('.tab-list')).toBeNull();
    unmount(component);
  });

  it('一覧の × は、そのタブを閉じる（最後の 1 つは閉じられない）', () => {
    setWidth(true);
    const { target, component, onclose } = render();
    (target.querySelector('.tab-current') as HTMLButtonElement).click();
    flushSync();
    (target.querySelectorAll('.tab-row .tab-close')[1] as HTMLButtonElement).click();
    expect(onclose).toHaveBeenCalledWith(2);
    unmount(component);
  });

  it('広い画面では、これまでどおり一列のタブ（一覧のボタンは無い）', () => {
    setWidth(false);
    const { target, component } = render();
    expect(target.querySelector('.tab-current')).toBeNull();
    expect(target.querySelectorAll('.tab').length).toBe(2);
    unmount(component);
  });
});
