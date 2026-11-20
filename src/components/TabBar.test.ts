// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TabBar from './TabBar.svelte';

// タブの欄: 狭い画面も、広い画面と同じ表示（一覧の切り替えは無い）。最後の 1 つにも × を出す
const tabs = [
  { id: 1, label: '内部', title: '内部ストレージ' },
  { id: 2, label: 'Download', title: '/storage/emulated/0/Download' },
];

function render(props: Partial<{ tabs: typeof tabs; onselect: (id: number) => void; onclose: (id: number) => void; windowControls: boolean }> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onselect = props.onselect ?? vi.fn();
  const onclose = props.onclose ?? vi.fn();
  const component = mount(TabBar, {
    target,
    props: { tabs: props.tabs ?? tabs, activeId: 2, onselect, onclose, onadd: vi.fn(), onduplicate: vi.fn(), onmove: vi.fn(), oncloseothers: vi.fn(), ondropfolders: vi.fn(), windowControls: props.windowControls },
  });
  flushSync();
  return { target, component, onselect, onclose };
}

describe('TabBar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('狭い画面でも、普通のタブを一列に並べる（一覧のボタンは無い）。バーは出さない', () => {
    window.matchMedia = ((q: string) => ({ matches: q === '(max-width: 600px)', media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const { target, component } = render();
    expect(target.querySelector('.tab-current')).toBeNull();
    expect(target.querySelector('.tab-list')).toBeNull();
    expect(target.querySelectorAll('.tab').length).toBe(2);
    expect(target.querySelector('[role="tablist"]')).not.toBeNull();
    unmount(component);
  });

  it('タブを押すと onselect。× で onclose。最後の 1 つにも × がある', () => {
    const { target, component, onselect, onclose } = render();
    (target.querySelectorAll('.tab-main')[0] as HTMLButtonElement).click();
    expect(onselect).toHaveBeenCalledWith(1);
    (target.querySelectorAll('.tab-close')[1] as HTMLButtonElement).click();
    expect(onclose).toHaveBeenCalledWith(2);
    unmount(component);
    const one = render({ tabs: [tabs[0]] });
    expect(one.target.querySelectorAll('.tab-close').length).toBe(1);
    unmount(one.component);
  });

  it('続きがある側の端に影を出す（横にスクロールできるときだけ）', () => {
    const { target, component } = render();
    const scroller = target.querySelector<HTMLElement>('.tabs')!;
    const set = (v: Record<string, number>) => Object.entries(v).forEach(([k, n]) => Object.defineProperty(scroller, k, { value: n, configurable: true }));
    const shadow = (side: 'left' | 'right') => target.querySelector(`.tabs-shadow-${side}`)!.classList.contains('tabs-shadow-on');
    expect([shadow('left'), shadow('right')]).toEqual([false, false]);
    set({ scrollLeft: 0, clientWidth: 100, scrollWidth: 300 });
    scroller.dispatchEvent(new Event('scroll'));
    flushSync();
    expect([shadow('left'), shadow('right')]).toEqual([false, true]);
    set({ scrollLeft: 100 });
    scroller.dispatchEvent(new Event('scroll'));
    flushSync();
    expect([shadow('left'), shadow('right')]).toEqual([true, true]);
    set({ scrollLeft: 200 });
    scroller.dispatchEvent(new Event('scroll'));
    flushSync();
    expect([shadow('left'), shadow('right')]).toEqual([true, false]);
    unmount(component);
  });

  it('縦のホイールは、横のスクロールにする（バーが無いので）', () => {
    const { target, component } = render();
    const scroller = target.querySelector<HTMLElement>('.tabs')!;
    Object.defineProperty(scroller, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(scroller, 'scrollWidth', { value: 300, configurable: true });
    const ev = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    scroller.dispatchEvent(ev);
    expect(scroller.scrollLeft).toBe(40);
    expect(ev.defaultPrevented).toBe(true);
    unmount(component);
  });

  it('タイトルバーとして使うときだけ、アイコンとウィンドウの操作を出す', () => {
    const plain = render();
    expect(plain.target.querySelector('.window-controls')).toBeNull();
    expect(plain.target.querySelector('.app-logo')).toBeNull();
    unmount(plain.component);
    const bar = render({ windowControls: true });
    expect(bar.target.querySelector('.app-logo')).not.toBeNull();
    expect([...bar.target.querySelectorAll('.window-controls button')].map((b) => b.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '閉じる']);
    expect(bar.target.querySelectorAll('[data-tauri-drag-region]').length).toBeGreaterThan(0);
    unmount(bar.component);
  });

  /** jsdom には DataTransfer が無いので、使う口だけの偽物を持たせたドラッグのイベント */
  const folderDrag = (type: string, extra: MouseEventInit = {}): Event => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...extra });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir'], getData: () => '', setData: () => {}, dropEffect: '' } });
    return ev;
  };

  it('フォルダのドラッグで出した点線のタブは、ウィンドウの外へ出たとき（相手なし・位置 (0, 0)）に消える', () => {
    const { target, component } = render();
    const bar = target.querySelector('.tabbar')!;
    bar.dispatchEvent(folderDrag('dragover'));
    flushSync();
    expect(target.querySelector('.tab-ghost')).not.toBeNull();
    // タブの欄の中の子へ動いただけなら、消えない
    bar.dispatchEvent(folderDrag('dragleave', { relatedTarget: target.querySelector('.tab') }));
    flushSync();
    expect(target.querySelector('.tab-ghost')).not.toBeNull();
    // ウィンドウの外へ出た（欄は画面の左上の端にあるので、位置 (0, 0) だけでは「中」に見える）
    bar.dispatchEvent(folderDrag('dragleave', { relatedTarget: null, clientX: 0, clientY: 0 }));
    flushSync();
    expect(target.querySelector('.tab-ghost')).toBeNull();
    unmount(component);
  });

  it('点線のタブは、ドラッグが途切れて 1 秒たてば消える（dragover が届き続けるあいだは、出したまま）', async () => {
    vi.useFakeTimers();
    try {
      const { target, component } = render();
      const bar = target.querySelector('.tabbar')!;
      bar.dispatchEvent(folderDrag('dragover'));
      flushSync();
      await vi.advanceTimersByTimeAsync(700);
      bar.dispatchEvent(folderDrag('dragover'));
      await vi.advanceTimersByTimeAsync(700);
      flushSync();
      expect(target.querySelector('.tab-ghost')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(400);
      flushSync();
      expect(target.querySelector('.tab-ghost')).toBeNull();
      unmount(component);
    } finally {
      vi.useRealTimers();
    }
  });

  it('どこで離しても（dragend）、点線のタブは消える', () => {
    const { target, component } = render();
    target.querySelector('.tabbar')!.dispatchEvent(folderDrag('dragover'));
    flushSync();
    expect(target.querySelector('.tab-ghost')).not.toBeNull();
    window.dispatchEvent(new Event('dragend'));
    flushSync();
    expect(target.querySelector('.tab-ghost')).toBeNull();
    unmount(component);
  });
});
