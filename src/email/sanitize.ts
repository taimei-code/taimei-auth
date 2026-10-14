declare const displayTextBrand: unique symbol;
export type DisplayText = string & { readonly [displayTextBrand]: true };

const SPOOFING_OR_HEADER_INJECTION_CODE_POINTS = {
  c0ControlIncludingCrLf: [0x00, 0x1f],
  delAndC1Control: [0x7f, 0x9f],
  zeroWidthSpaceNonJoinerJoiner: [0x200b, 0x200d],
  zeroWidthNoBreakSpace: [0xfeff, 0xfeff],
  bidiOverride: [0x202a, 0x202e],
  bidiIsolate: [0x2066, 0x2069],
} as const;

const isInvisibleOrDirectional = (cp: number): boolean =>
  Object.values(SPOOFING_OR_HEADER_INJECTION_CODE_POINTS).some(
    ([first, last]) => cp >= first && cp <= last,
  );

export const toDisplayText = (s: string): DisplayText =>
  Array.from(s)
    .filter((ch) => !isInvisibleOrDirectional(ch.codePointAt(0) ?? 0))
    .join("")
    .trim() as DisplayText;
