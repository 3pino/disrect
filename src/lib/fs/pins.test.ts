import { describe, expect, it } from 'vitest';
import { createPins, expiryText, formatFingerprint } from './pins';
import { FsError } from './types';

describe('証明書の固定（Rust のコマンドの呼び方）', () => {
  it('それぞれ、決まったコマンドと引数で呼ぶ', async () => {
    const log: [string, unknown][] = [];
    const pins = createPins(async (cmd, args) => {
      log.push([cmd, args]);
      return (cmd === 'dav_cert_probe' ? { trusted: false, fingerprint: 'ab', not_after: null } : null) as never;
    });
    expect(await pins.info('p1')).toBeNull();
    expect(await pins.probe('https://a/dav/')).toEqual({ trusted: false, fingerprint: 'ab', not_after: null });
    await pins.set('p1', 'https://a/dav/', 'ab');
    await pins.clear('p1');
    expect(log).toEqual([
      ['dav_pin_info', { place: 'p1' }],
      ['dav_cert_probe', { base: 'https://a/dav/' }],
      ['dav_pin_set', { place: 'p1', base: 'https://a/dav/', fingerprint: 'ab' }],
      ['dav_pin_clear', { place: 'p1' }],
    ]);
  });

  it('失敗は FsError にする（cert_changed も知っている code）', async () => {
    const pins = createPins(async () => {
      throw { code: 'cert_changed', message: '変わりました' };
    });
    const e = await pins.probe('https://a/dav/').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FsError);
    expect((e as FsError).code).toBe('cert_changed');
  });
});

describe('指紋・有効期限の表示', () => {
  it('指紋は 2 桁ずつ : で区切って大文字にする（openssl の表示）', () => {
    expect(formatFingerprint('de3cfb11')).toBe('DE:3C:FB:11');
    expect(formatFingerprint('')).toBe('');
  });
  it('有効期限は日付の文。読めなければ null', () => {
    expect(expiryText('2126-10-25T04:58:05Z')).toBe('2126年10月25日');
    expect(expiryText('2026-01-05T00:00:00Z')).toBe('2026年1月5日');
    expect(expiryText(null)).toBeNull();
    expect(expiryText('x')).toBeNull();
  });
});
