import { runner, tauriCall, type Call } from './call';

// ネットワークの置き場所の資格情報（ユーザー名・パスワード）。保管は Rust が OS のキーチェーンへ行う。
// パスワードは、ここから Rust へ渡すだけで、返ってこない（画面は、ユーザー名と「保存済みか」だけを知る）。

export type CredInfo = { user: string; base: string };

export type Creds = {
  /** 保管している資格情報の様子。無ければ null（キーチェーンが使えなければ、失敗） */
  info(place: string): Promise<CredInfo | null>;
  /** 保管する。password が null なら、保管済みのパスワードを使い続ける（接続先を変えるときは Rust が断る） */
  set(place: string, base: string, user: string, password: string | null): Promise<void>;
  clear(place: string): Promise<void>;
};

export function createCreds(call: Call = tauriCall): Creds {
  const run = runner(call);
  return {
    info: (place) => run<CredInfo | null>('dav_cred_info', { place }),
    set: (place, base, user, password) => run<void>('dav_cred_set', { place, base, user, password }),
    clear: (place) => run<void>('dav_cred_clear', { place }),
  };
}
