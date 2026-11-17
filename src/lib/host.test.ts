import { describe, expect, it, vi } from 'vitest';
import { HostState, createHost, failureText } from './host.svelte';
import { openHref } from './fs/local';
import { createSources } from './fs/sources';
import { FsError } from './fs/types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

describe('本体の機能（通知・確認・戻る）', () => {
  it('戻るは、あとから積んだものを外してから呼ぶ。外したものは呼ばない', () => {
    const s = new HostState();
    const ran: string[] = [];
    s.addBack(() => ran.push('a'));
    const off = s.addBack(() => ran.push('b'));
    s.addBack(() => ran.push('c'));
    off();
    expect(s.back()).toBe(true);
    expect(s.back()).toBe(true);
    expect([s.back(), s.canBack]).toEqual([false, false]);
    expect(ran).toEqual(['c', 'a']);
  });

  it('確認は、答えるまで待つ。次の確認が来たら、前のものは取り消しになる', async () => {
    const s = new HostState();
    const first = s.confirm({ title: '1', okLabel: 'OK' });
    const second = s.confirm({ title: '2', okLabel: 'OK' });
    expect(await first).toBe(false);
    expect(s.shell.confirmReq?.title).toBe('2');
    s.shell.confirmReq!.resolve(true);
    expect(await second).toBe(true);
    expect(s.shell.confirmReq).toBeNull();
  });

  it('通知は、消すと無くなる', () => {
    vi.useFakeTimers();
    const s = new HostState();
    const id = s.toast('a', 'error');
    s.toast('b');
    s.dismiss(id);
    expect(s.shell.toasts.map((t) => t.text)).toEqual(['b']);
    vi.advanceTimersByTime(6000);
    expect(s.shell.toasts).toEqual([]);
    vi.useRealTimers();
  });
});

describe('ファイルを開く（OS の既定のアプリ）', () => {
  it('項目の URL からパスを取り出して開く。開けなければ知らせる', async () => {
    const s = new HostState();
    const open = vi.fn(async (path: string) => {
      if (path === 'bad') throw new FsError('denied', 'x');
    });
    const host = createHost(s, { open, sources: createSources() });
    await host.download.file({ url: openHref('home/a.txt'), name: 'a.txt' });
    expect(open).toHaveBeenCalledWith('home/a.txt');
    await host.download.file({ url: openHref('bad'), name: 'bad' });
    expect(s.shell.toasts.at(-1)).toMatchObject({ kind: 'error', text: '「bad」を開けませんでした: 権限がありません' });
    // ほかの URL（部品の外から来たもの）は開かない
    await host.download.file({ url: 'https://example.com/', name: 'x' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('失敗の文は、種類（code）から決める', () => {
    expect(failureText(new FsError('exists', 'raw os text'))).toBe('同じ名前があります');
    expect(failureText(new Error('boom'))).toBe('boom');
  });
});

describe('拡大表示（写真・PDF）', () => {
  it('見られる種類は image・pdf だけ。それ以外は null（既定のアプリで開く）', () => {
    const host = createHost(new HostState(), { open: vi.fn(), sources: createSources() });
    expect(host.viewerKind('a.png')).toBe('image');
    expect(host.viewerKind('a.PDF')).toBe('pdf');
    expect(host.viewerKind('a.txt')).toBeNull();
    expect(host.viewerKind('noext', 'application/pdf')).toBe('pdf');
  });

  it('開くと本体の状態に載る。「保存」の URL は、元のパスの open の URL になる（表示の URL が分かるものだけ）。前後の一覧も同じ', () => {
    const s = new HostState();
    const sources = createSources();
    sources.note('asset://a', 'home/a.png');
    sources.note('asset://b', 'home/b.png');
    const host = createHost(s, { open: vi.fn(), sources });
    host.openViewer({ src: 'asset://a', alt: 'a.png', downloadUrl: 'asset://a', kind: 'image' }, () => [
      { src: 'asset://a', alt: 'a.png', downloadUrl: 'asset://a' },
      { src: 'asset://b', alt: 'b.png', downloadUrl: 'asset://b' },
      { src: 'asset://zzz', alt: 'z', downloadUrl: 'asset://zzz' },
    ]);
    expect(s.shell.lightbox).toMatchObject({ src: 'asset://a', downloadUrl: openHref('home/a.png'), kind: 'image' });
    expect(s.shell.lightboxGallery!().map((i) => i.downloadUrl)).toEqual([openHref('home/a.png'), openHref('home/b.png'), 'asset://zzz']);
  });

  it('「戻る」は、拡大表示を先に閉じる', () => {
    const s = new HostState();
    const host = createHost(s, { open: vi.fn(), sources: createSources() });
    host.openViewer({ src: 'a', alt: 'a', downloadUrl: 'a' }, () => []);
    expect([s.canBack, s.back(), s.shell.lightbox, s.canBack]).toEqual([true, true, null, false]);
  });
});
