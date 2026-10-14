const ALPHABET_WITHOUT_LOOKALIKES = "abcdefghjkmnpqrstuvwxyz23456789";
const HALF_LENGTH = 5;

function randomChars(length: number): string {
  const limit = 256 - (256 % ALPHABET_WITHOUT_LOOKALIKES.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += ALPHABET_WITHOUT_LOOKALIKES[byte % ALPHABET_WITHOUT_LOOKALIKES.length];
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
