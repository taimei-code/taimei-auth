// 不可視 unicode / 方向制御文字を除去し、表示名偽装の phishing と SMTP ヘッダインジェクションを防ぐ。
// regex の制御文字リテラルは lint で弾かれるため codepoint 判定で実装する。
const isInvisibleOrDirectional = (cp: number): boolean =>
  cp <= 0x1f || // C0 制御文字 (CR=0x0d / LF=0x0a を含む)
  (cp >= 0x7f && cp <= 0x9f) || // DEL + C1 制御文字
  (cp >= 0x200b && cp <= 0x200d) || // zero-width space/non-joiner/joiner
  cp === 0xfeff || // zero-width no-break space (BOM)
  (cp >= 0x202a && cp <= 0x202e) || // RTL/LTR override
  (cp >= 0x2066 && cp <= 0x2069); // isolate (LRI/RLI/FSI/PDI)

export const sanitizeDisplayText = (s: string): string =>
  Array.from(s)
    .filter((ch) => !isInvisibleOrDirectional(ch.codePointAt(0) ?? 0))
    .join("")
    .trim();
