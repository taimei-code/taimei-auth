declare const displayTextBrand: unique symbol;
export type DisplayText = string & { readonly [displayTextBrand]: true };

// 表示名の偽装 (phishing) と SMTP ヘッダインジェクションを防ぐ。
const isInvisibleOrDirectional = (cp: number): boolean =>
  cp <= 0x1f || // C0 制御文字 (CR の 0x0d と LF の 0x0a を含む)
  (cp >= 0x7f && cp <= 0x9f) || // DEL と C1 制御文字
  (cp >= 0x200b && cp <= 0x200d) || // zero-width space/non-joiner/joiner
  cp === 0xfeff || // zero-width no-break space (BOM)
  (cp >= 0x202a && cp <= 0x202e) || // RTL/LTR override
  (cp >= 0x2066 && cp <= 0x2069); // isolate (LRI/RLI/FSI/PDI)

export const toDisplayText = (s: string): DisplayText =>
  Array.from(s)
    .filter((ch) => !isInvisibleOrDirectional(ch.codePointAt(0) ?? 0))
    .join("")
    .trim() as DisplayText;
