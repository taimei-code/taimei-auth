// 0 1 i l o を除いた 31 文字 (手入力の見間違い対策)。
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const HALF_LENGTH = 5;

function randomChars(length: number): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from(
    { length: count },
    () => `${randomChars(HALF_LENGTH)}-${randomChars(HALF_LENGTH)}`,
  );
}
