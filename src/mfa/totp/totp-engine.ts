import { generateRandomString } from "better-auth/crypto";
import * as OTPAuth from "otpauth";

// otpauth の薄いラッパ (I/O なし)。period 30 / digits 6 / window ±1 は旧プラグイン構成と同値で、
// 既存登録ユーザーの認証アプリ再登録を要求しない (D2 でデータは破棄するが方式互換は保つ)。

const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1;

const SECRET_LENGTH = 32;
const TOTP_CODE = /^[0-9]{6}$/;

// ASCII 英数 32 字 (約 190bit) をバイト列にする。生バイト乱数にしないのは base32 → 文字列 → バイトの
// 往復で UTF-8 破損するため (ADR-0016)。バイアス無しの乱数列は better-auth の公開 export に任せる。
export function generateTotpSecret(): Uint8Array {
  return new TextEncoder().encode(generateRandomString(SECRET_LENGTH, "a-z", "A-Z", "0-9"));
}

function asTotp(secret: Uint8Array, input: { issuer?: string; label?: string } = {}): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    ...input,
    secret: new OTPAuth.Secret({ buffer: new Uint8Array(secret).buffer }),
    digits: DIGITS,
    period: PERIOD,
  });
}

export function buildTotpUri(input: {
  issuer: string;
  accountLabel: string;
  secret: Uint8Array;
}): string {
  return asTotp(input.secret, { issuer: input.issuer, label: input.accountLabel }).toString();
}

// 受理した timestep (counter + delta) を返す。呼び出し側はこの値の単調消費でリプレイを拒む。
export function matchTotpCode(
  secret: Uint8Array,
  code: string,
  timestamp: number = Date.now(),
): number | null {
  if (!TOTP_CODE.test(code)) return null;
  const delta = asTotp(secret).validate({ token: code, timestamp, window: WINDOW });
  if (delta === null) return null;
  return OTPAuth.TOTP.counter({ period: PERIOD, timestamp }) + delta;
}
