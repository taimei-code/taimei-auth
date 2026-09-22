import { generateRandomString } from "better-auth/crypto";
import * as OTPAuth from "otpauth";

// period 30、digits 6、window ±1 は旧構成と同じ値にし、既存ユーザーに認証アプリの再登録を求めない。

const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1;

const SECRET_LENGTH = 32;
const TOTP_CODE = /^[0-9]{6}$/;

// 生のバイト乱数にしないのは、base32 から文字列、文字列からバイトへの往復で UTF-8 として壊れるため。
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

// 返す timestep は、呼び出し側が単調に消費してリプレイを拒否するための値。
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
