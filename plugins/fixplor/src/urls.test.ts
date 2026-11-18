import { describe, expect, it } from 'vitest';
import { PDF_THUMB_MAX_BYTES as KIT_MAX } from '@3pino/viewer-kit-web/viewers/pdfThumb';
import { PDF_THUMB_MAX_BYTES, createUrls } from './urls';
import { fakeFiles } from './test-support/fakeHost';
import type { Entry } from '@3pino/explorer-kit';

// 本体の項目は部品の知らない欄（file_id など）を持つ。そのまま渡す
const e = (over: Partial<Entry> & { file_id?: string }): Entry => ({ name: 'a.png', path: 'x/a.png', kind: 'file', size: 10, modified: 5, mime: null, ...over });

describe('項目の URL', () => {
  const urls = createUrls(fakeFiles());

  it('PDF の絵を作る上限は、viewer-kit-web の値と同じ（数字だけ写してある）', () => {
    expect(PDF_THUMB_MAX_BYTES).toBe(KIT_MAX);
  });

  it('PDF の元: 上限までは url と key（更新で変わる）。上限を超える・PDF でない・フォルダは無し', () => {
    expect(urls.pdfSource(e({ name: 'a.pdf', path: 'a.pdf' }))).toEqual({ url: 'https://srv.test/shared/a.pdf', key: 'a.pdf:5:10' });
    expect(urls.pdfSource(e({ name: 'a.pdf', size: PDF_THUMB_MAX_BYTES }))).not.toBeNull();
    expect(urls.pdfSource(e({ name: 'a.pdf', size: PDF_THUMB_MAX_BYTES + 1 }))).toBeNull();
    expect(urls.pdfSource(e({}))).toBeNull();
    expect(urls.pdfSource(e({ name: 'd.pdf', kind: 'dir' }))).toBeNull();
    expect(urls.pdfSource(e({ name: 'noext', mime: 'application/pdf' }))).not.toBeNull();
  });

  it('ゴミ箱の中の項目は、ID の URL ではなくパスの URL（本体が決める。ここは項目をそのまま渡す）', () => {
    expect(urls.readUrl(e({ file_id: 'F1', trash: { kind: 'item' } as never }))).toBe('https://srv.test/shared/x/a.png');
    expect(urls.readUrl(e({ file_id: 'F1' }))).toBe('https://srv.test/files/F1');
  });
});
