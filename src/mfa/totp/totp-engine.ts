import { generateRandomString } from "better-auth/crypto";
import * as OTPAuth from "otpauth";

// 変えると既存ユーザーは認証アプリの再登録が要る。

const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1;

const SECRET_LENGTH = 32;
const TOTP_CODE = /^[0-9]{6}$/;

// 生のバイト乱数だと base32 と文字列の往復で UTF-8 として壊れる。
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
