import type { Entry, ExplorerApi, TrashEntry } from '@3pino/explorer-kit';
import type { HostFiles } from './sdk';

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as { name?: unknown }).name === 'AbortError' || (e as { code?: unknown }).code === 'aborted');
}

function abortedError(): Error {
  return Object.assign(new Error('中止しました'), { code: 'aborted' });
}

/**
 * 共有フォルダ（`this.files`）を、エクスプローラーの置き場所の口（ExplorerApi）にする。
 * 引数は渡されたとおりに送る（省いた引数を足さない）。同名の決まりは本体（サーバー）が決める:
 * 作成・上書きは write（呼ぶ側が先に確かめる）、move・copy は overwrite が真のときだけ上書き。
 */
export function createFilesApi(files: HostFiles): ExplorerApi {
  return {
    list: (path) => files.list(path) as Promise<Entry[]>,
    write: (path, body) => files.write(path, body) as Promise<Entry>,
    mkdir: (path) => files.mkdir(path) as Promise<Entry>,
    trash: (path) => files.trash(path) as Promise<TrashEntry>,
    restore: (id) => files.restore(id) as Promise<Entry>,
    purge: (id) => files.purge(id),
    size: (path) => files.size(path),
    move: (from, to, overwrite) => (overwrite === true ? files.move(from, to, { overwrite: true }) : files.move(from, to)) as Promise<Entry>,
    copy: (from, to, overwrite) => (overwrite === true ? files.copy(from, to, { overwrite: true }) : files.copy(from, to)) as Promise<Entry>,
    upload(path, file, onProgress) {
      const ac = new AbortController();
      const promise = files.upload(path, file, {
        // 本体は送った量・全体の量で知らせる。部品は 0〜1 の割合
        onProgress: onProgress ? (sent, total) => onProgress(total > 0 ? sent / total : 0) : undefined,
        signal: ac.signal,
      });
      // 中止は、部品が見分ける code「aborted」にそろえる（本体は AbortError で知らせる）
      return { promise: promise.catch((e: unknown) => Promise.reject(ac.signal.aborted || isAbort(e) ? abortedError() : e)), abort: () => ac.abort() };
    },
  };
}
