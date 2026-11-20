import { describe, expect, it } from 'vitest';
import { formatHotkey, hotkeyFromEvent, isPlainHotkey, matchesHotkey, normalizeHotkey } from './hotkeys';

const ev = (key: string, init: Partial<Parameters<typeof hotkeyFromEvent>[0]> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });

describe('hotkeyFromEvent', () => {
  it('修飾キーは Ctrl・Alt・Shift の順。Cmd（Meta）は Ctrl として扱う', () => {
    expect(hotkeyFromEvent(ev('t', { ctrlKey: true }))).toBe('Ctrl+T');
    expect(hotkeyFromEvent(ev('t', { metaKey: true }))).toBe('Ctrl+T');
    expect(hotkeyFromEvent(ev('Tab', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+Tab');
    expect(hotkeyFromEvent(ev('ArrowLeft', { altKey: true }))).toBe('Alt+ArrowLeft');
    expect(hotkeyFromEvent(ev('F5'))).toBe('F5');
    expect(hotkeyFromEvent(ev(' '))).toBe('Space');
  });
  it('英数字は、Shift・配列に依らず、キーの位置（code）で決める', () => {
    expect(hotkeyFromEvent(ev('!', { code: 'Digit1', shiftKey: true }))).toBe('Shift+1');
    expect(hotkeyFromEvent(ev('ü', { code: 'KeyY', ctrlKey: true }))).toBe('Ctrl+Y');
  });
  it('修飾キーだけ・変換中は null', () => {
    expect(hotkeyFromEvent(ev('Control', { ctrlKey: true }))).toBeNull();
    expect(hotkeyFromEvent(ev('Shift', { shiftKey: true }))).toBeNull();
    expect(hotkeyFromEvent(ev('a', { isComposing: true }))).toBeNull();
  });
});

describe('normalizeHotkey・matchesHotkey', () => {
  it('書き方の違いをそろえる。読めないものは null', () => {
    expect(normalizeHotkey('shift+ctrl+tab')).toBe('Ctrl+Shift+Tab');
    expect(normalizeHotkey('Cmd+t')).toBe('Ctrl+T');
    expect(normalizeHotkey('esc')).toBe('Escape');
    expect(normalizeHotkey('Ctrl++')).toBe('Ctrl++');
    expect(normalizeHotkey('')).toBeNull();
    expect(normalizeHotkey('Hyper+X')).toBeNull();
    expect(normalizeHotkey('Ctrl')).toBeNull();
  });
  it('どれかに当たれば真。修飾キーが違えば偽', () => {
    expect(matchesHotkey(ev('w', { ctrlKey: true }), ['Ctrl+W'])).toBe(true);
    expect(matchesHotkey(ev('w', { ctrlKey: true, shiftKey: true }), ['Ctrl+W'])).toBe(false);
    expect(matchesHotkey(ev('PageDown', { ctrlKey: true }), ['Ctrl+Tab', 'ctrl+pagedown'])).toBe(true);
    expect(matchesHotkey(ev('x'), [])).toBe(false);
  });
});

describe('formatHotkey・isPlainHotkey', () => {
  it('画面に出す形と、修飾キーなしの判定', () => {
    expect(formatHotkey('Alt+ArrowLeft')).toBe('Alt+←');
    expect(formatHotkey('Escape')).toBe('Esc');
    expect(isPlainHotkey('F2')).toBe(true);
    expect(isPlainHotkey('Shift+A')).toBe(true);
    expect(isPlainHotkey('Ctrl+F')).toBe(false);
    expect(isPlainHotkey('Alt+ArrowLeft')).toBe(false);
  });
});

describe('matchesIgnoringShift', () => {
  it('Shift を押していても、押していないキーとして当てる。Ctrl・Alt は区別する', async () => {
    const { matchesIgnoringShift } = await import('./hotkeys');
    expect(matchesIgnoringShift(ev('ArrowUp', { shiftKey: true }), ['ArrowUp'])).toBe(true);
    expect(matchesIgnoringShift(ev('ArrowUp'), ['ArrowUp'])).toBe(true);
    expect(matchesIgnoringShift(ev('ArrowUp', { ctrlKey: true }), ['ArrowUp'])).toBe(false);
  });
});
