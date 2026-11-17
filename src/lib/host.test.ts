import { describe, expect, it, vi } from 'vitest';
import { HostState, createHost, failureText } from './host.svelte';
import { openHref } from './fs/local';
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
    const host = createHost(s, { open });
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
