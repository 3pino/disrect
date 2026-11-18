import { runner, tauriCall, type Call } from './call';

// ネットワークの置き場所の証明書の固定（自己署名・私的な認証局の https）。固定は Rust が設定フォルダの JSON に保管する。
// 確認（probe）は、握手だけで止める（要求は送らない）。

export type PinInfo = { base: string; fingerprint: string };
/** 確認の結果。trusted なら（OS が信頼しているので）固定は要らない */
export type Probe = { trusted: boolean; fingerprint: string | null; not_after: string | null };

export type Pins = {
  /** 固定している証明書（接続先・指紋）。無ければ null */
  info(place: string): Promise<PinInfo | null>;
  /** 接続先が示す証明書を確かめる（握手だけ） */
  probe(base: string): Promise<Probe>;
  /** この証明書（指紋）だけを信頼する。前の固定は置き換わる */
  set(place: string, base: string, fingerprint: string): Promise<void>;
  /** 解除する（通常の確かめに戻る） */
  clear(place: string): Promise<void>;
};

export function createPins(call: Call = tauriCall): Pins {
  const run = runner(call);
  return {
    info: (place) => run<PinInfo | null>('dav_pin_info', { place }),
    probe: (base) => run<Probe>('dav_cert_probe', { base }),
    set: (place, base, fingerprint) => run<void>('dav_pin_set', { place, base, fingerprint }),
    clear: (place) => run<void>('dav_pin_clear', { place }),
  };
}

/** 指紋（16 進 64 桁）を、`AB:CD:…` の形にする（openssl の表示と同じ。読み合わせるため） */
export function formatFingerprint(hex: string): string {
  return (hex.match(/.{1,2}/g) ?? []).join(':').toUpperCase();
}

/** 有効期限（`2126-10-25T04:58:05Z`）を、日付の文にする。読めなければ null */
export function expiryText(notAfter: string | null): string | null {
  const m = notAfter?.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : null;
}
