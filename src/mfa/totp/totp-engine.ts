import { generateRandomString } from "better-auth/crypto";
import * as OTPAuth from "otpauth";

import { TOTP_DIGITS, TOTP_PERIOD_SECONDS, TOTP_WINDOW_STEPS } from "./totp-parameters";

const SECRET_LENGTH = 32;
const TOTP_CODE = new RegExp(`^[0-9]{${TOTP_DIGITS}}$`);

export function generateTotpSecret(): Uint8Array {
  return new TextEncoder().encode(generateRandomString(SECRET_LENGTH, "a-z", "A-Z", "0-9"));
}

function asTotp(secret: Uint8Array, input: { issuer?: string; label?: string } = {}): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    ...input,
    secret: new OTPAuth.Secret({ buffer: new Uint8Array(secret).buffer }),
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
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
  const delta = asTotp(secret).validate({ token: code, timestamp, window: TOTP_WINDOW_STEPS });
  if (delta === null) return null;
  return OTPAuth.TOTP.counter({ period: TOTP_PERIOD_SECONDS, timestamp }) + delta;
}
