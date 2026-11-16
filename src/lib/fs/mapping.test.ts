import { describe, expect, it } from 'vitest';
import { fromOs, isWindowsPath, toOs } from './mapping';

describe('画面のパスと OS のパス（POSIX）', () => {
  it('いちばん上は /', () => {
    expect(toOs('', false)).toBe('/');
    expect(toOs('home/me/a b.txt', false)).toBe('/home/me/a b.txt');
    expect(fromOs('/')).toBe('');
    expect(fromOs('/home/me/')).toBe('home/me');
    expect(fromOs('/home//me')).toBe('home/me');
  });

  it('\\ は名前の一部（区切りにしない）', () => {
    expect(fromOs('/home/a\\b')).toBe('home/a\\b');
    expect(toOs('home/a\\b', false)).toBe('/home/a\\b');
    expect(isWindowsPath('/home/a\\b')).toBe(false);
  });

  it('往復しても変わらない', () => {
    for (const p of ['', 'home', 'home/me/写真/a.png', 'mnt/USB DISK']) expect(fromOs(toOs(p, false)!)).toBe(p);
  });
});

describe('画面のパスと OS のパス（Windows）', () => {
  it('いちばん上はドライブの一覧（OS のパスは無い）', () => {
    expect(toOs('', true)).toBeNull();
  });

  it('ドライブ', () => {
    expect(toOs('C:', true)).toBe('C:\\');
    expect(toOs('C:/Users/me', true)).toBe('C:\\Users\\me');
    expect(fromOs('C:\\')).toBe('C:');
    expect(fromOs('C:\\Users\\me\\')).toBe('C:/Users/me');
    expect(fromOs('C:/Users/me')).toBe('C:/Users/me');
  });

  it('ネットワークの場所は、\\\\server\\share を最初の 1 段にする', () => {
    expect(fromOs('\\\\nas\\share')).toBe('\\\\nas\\share');
    expect(fromOs('\\\\nas\\share\\a\\b')).toBe('\\\\nas\\share/a/b');
    expect(toOs('\\\\nas\\share', true)).toBe('\\\\nas\\share\\');
    expect(toOs('\\\\nas\\share/a/b', true)).toBe('\\\\nas\\share\\a\\b');
  });

  it('往復しても変わらない', () => {
    for (const p of ['C:', 'D:/a', 'C:/Users/me/a b.txt', '\\\\nas\\share/a']) expect(fromOs(toOs(p, true)!)).toBe(p);
  });
});
