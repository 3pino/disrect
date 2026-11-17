// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createHost } from './host';
import { fakeUi } from './test-support/fakeHost';
import { errorText } from './errors';

// プラグインの口（disnans.ui）が、エクスプローラーの部品が借りる機能（ExplorerHost）になること。

function make() {
  const ui = fakeUi();
  const host = createHost({ ui }, { platform: { tauri: true, os: 'linux', linuxDesktop: true } });
  return { ui, host };
}

describe('通知・確認・戻る', () => {
  it('toast は action つきでそのまま渡る（削除の「取り消す」）。confirm・戻るも本体の口へ', async () => {
    const { ui, host } = make();
    const run = vi.fn();
    host.toast('1 件を消しました', 'info', { label: '取り消す', run });
    expect(ui.toasts).toEqual([{ text: '1 件を消しました', kind: 'info', action: { label: '取り消す', run } }]);
    expect(await host.confirm({ title: 't', okLabel: 'OK' })).toBe(true);
    expect(ui.confirms).toEqual([{ title: 't', okLabel: 'OK' }]);
    const off = host.addBack(() => {});
    expect(ui.backs).toHaveLength(1);
    off();
    expect(ui.backs).toHaveLength(0);
  });
});

describe('拡大表示・種類', () => {
  it('openViewer は、並びを遅れて読めるようにして本体の openLightbox へ。見られる種類は image・pdf だけ', () => {
    const { ui, host } = make();
    let calls = 0;
    host.openViewer({ src: 'a', alt: 'a.png', downloadUrl: 'a' }, () => (calls++, [{ src: 'a', alt: 'a.png', downloadUrl: 'a' }]));
    expect(calls).toBe(0);
    expect(ui.lightbox[0].gallery.map((i) => i.alt)).toEqual(['a.png']);
    expect(host.viewerKind('a.PNG')).toBe('image');
    expect(host.viewerKind('a.pdf')).toBe('pdf');
    expect(host.viewerKind('a.docx')).toBeNull();
    expect(host.viewerKind('noext', 'application/pdf')).toBe('pdf');
    expect(host.isImage('a.webp')).toBe(true);
    expect(host.isImage('a.txt')).toBe(false);
  });

  it('OS からのドロップは、本体の口をそのまま使う', () => {
    const { ui, host } = make();
    expect(host.osDrop).toBe(ui.osDrop);
  });

  it('「メッセージを検索」は、そのファイルの名前で本体の検索を開く', () => {
    const { ui, host } = make();
    host.fileAction!.run({ name: 'a.txt', path: 'a.txt', kind: 'file', size: 1, modified: 0, mime: null }, 'a.txt');
    expect(ui.searches).toEqual(['a.txt']);
    expect(host.fileAction!.label).toBe('メッセージを検索');
  });
});

describe('クリップボード・保存', () => {
  it('文字のコピーは成否を返す。中身の種類・ファイル名は本体の口。画像は File にする（kit の 2 つの口とも、本体の readImage）', async () => {
    const { ui, host } = make();
    expect(await host.clipboard.copyText('x')).toBe(true);
    expect(ui.clipboardText).toEqual(['x']);
    ui.clipboard.copyText = async () => {
      throw new Error('denied');
    };
    expect(await host.clipboard.copyText('y')).toBe(false);
    expect(await host.clipboard.peek()).toEqual({ text: true, image: false });
    expect(host.clipboard.textName()).toBe('clipboard-fake.txt');
    ui.clipboard.readImage = async () => new Blob(['i'], { type: 'image/png' });
    for (const read of [host.clipboard.readImage, host.clipboard.readNativeImage]) {
      const f = await read();
      expect(f).toBeInstanceOf(File);
      expect(f!.type).toBe('image/png');
    }
    ui.clipboard.readImage = async () => null;
    expect(await host.clipboard.readImage()).toBeNull();
    expect(await host.clipboard.readNativeImage()).toBeNull();
  });

  it('保存・押しの差し替えは、本体の保存（ui.download・ui.interceptDownload）へそのまま渡す', async () => {
    const { ui, host } = make();
    await host.download.file({ url: 'https://srv/shared/a.txt', name: 'a.txt' });
    const ev = new MouseEvent('click', { cancelable: true });
    expect(host.download.intercept(ev, { url: 'https://srv/shared/b.txt', name: 'b.txt' })).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(ui.downloads).toEqual([
      { url: 'https://srv/shared/a.txt', name: 'a.txt' },
      { url: 'https://srv/shared/b.txt', name: 'b.txt' },
    ]);
  });
});

describe('この端末の種類', () => {
  it('本体が教える値（app.platform）をそのまま返す', () => {
    const ui = fakeUi();
    const pc = createHost({ ui }, { platform: { tauri: true, os: 'linux', linuxDesktop: true } });
    expect([pc.platform.isTauri(), pc.platform.osName(), pc.platform.isLinuxDesktop()]).toEqual([true, 'linux', true]);
    const phone = createHost({ ui }, { platform: { tauri: true, os: 'android', linuxDesktop: false } });
    expect([phone.platform.isTauri(), phone.platform.osName(), phone.platform.isLinuxDesktop()]).toEqual([true, 'android', false]);
    const browser = createHost({ ui }, { platform: { tauri: false, os: '', linuxDesktop: false } });
    expect([browser.platform.isTauri(), browser.platform.osName(), browser.platform.isLinuxDesktop()]).toEqual([false, '', false]);
  });
});

describe('失敗の文', () => {
  it('code があれば本体の文言、なければ元の文。文字だけでも使える', () => {
    expect(errorText({ code: 'unauthorized', message: 'x' })).toContain('Tailscale');
    expect(errorText(Object.assign(new Error('同名があります'), { code: 'exists' }))).toBe('同名があります');
    expect(errorText('plain')).toBe('plain');
  });
});
