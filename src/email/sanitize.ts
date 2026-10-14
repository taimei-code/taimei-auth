declare const displayTextBrand: unique symbol;
export type DisplayText = string & { readonly [displayTextBrand]: true };

const isInvisibleOrDirectional = (cp: number): boolean =>
  cp <= 0x1f ||
  (cp >= 0x7f && cp <= 0x9f) ||
  (cp >= 0x200b && cp <= 0x200d) ||
  cp === 0xfeff ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069);

export const toDisplayText = (s: string): DisplayText =>
  Array.from(s)
    .filter((ch) => !isInvisibleOrDirectional(ch.codePointAt(0) ?? 0))
    .join("")
    .trim() as DisplayText;
