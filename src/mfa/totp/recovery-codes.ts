// リカバリーコード生成。書式 "xxxxx-xxxxx" ×10。
// 0/1/i/l/o を除いた 31 文字 — 手入力時の視認誤りを避ける。剰余バイアスは rejection sampling で回避。
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const HALF_LENGTH = 5;

function randomChars(length: number): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    // 2 倍の余裕を持って引く — 棄却率 ~3%/byte なら 1 回の draw でほぼ確実に充足する。
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
