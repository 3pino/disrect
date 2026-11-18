import { invoke } from '@tauri-apps/api/core';
import { FsError, type FsErrorCode } from './types';

// Rust のコマンドを呼ぶ口（この端末の fs_*・ネットワークの dav_*）と、届いた失敗の読み取り。

const CODES: ReadonlySet<string> = new Set<FsErrorCode>([
  'invalid', 'not_found', 'parent_missing', 'exists', 'same_path', 'into_self',
  'denied', 'not_dir', 'is_dir', 'not_empty', 'unsupported', 'partial', 'io',
  'offline', 'tls', 'cert_changed', 'auth', 'precondition', 'locked', 'too_large', 'no_space', 'server', 'aborted', 'keychain',
]);

/** Rust から届いた失敗（{ code, message }）を FsError にする（形が違うものは io） */
export function toFsError(e: unknown): FsError {
  if (e instanceof FsError) return e;
  if (typeof e === 'object' && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && CODES.has(code)) return new FsError(code as FsErrorCode, typeof message === 'string' ? message : code);
  }
  return new FsError('io', e instanceof Error ? e.message : String(e));
}

/** Rust のコマンドを呼ぶ口（試験で差し替える）。body を渡すと、生のバイト列として送る（パスなどは headers） */
export type Call = <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>) => Promise<T>;

export const tauriCall: Call = (cmd, args, headers) => invoke(cmd, args, headers ? { headers } : undefined);

/** call を、失敗を FsError にして返す形にする */
export function runner(call: Call): Call {
  return async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> => {
    try {
      return await call<T>(cmd, args, headers);
    } catch (e) {
      throw toFsError(e);
    }
  };
}
