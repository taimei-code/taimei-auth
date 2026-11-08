import type { MfaCodeKind } from "@core/mfa/mfa-contract";

const WHITESPACE = /\s+/g;
const HYPHEN_LIKE = /[-‐-―−ー]/g;

export const MFA_CODE_PASTE_TOLERANT_MAX_LENGTH = 32;

export function normalizeMfaCode(raw: string, kind: MfaCodeKind): string {
  const halfWidth = raw.normalize("NFKC").replace(WHITESPACE, "");
  return kind === "totp" ? halfWidth.replace(HYPHEN_LIKE, "") : halfWidth.replace(HYPHEN_LIKE, "-");
}

type MfaCodeTexts = Readonly<{
  label: string;
  toggleLabel: string;
  hint: string;
  placeholder: string;
  inputMode: "numeric" | "text";
}>;

export const MFA_CODE_TEXTS: Readonly<Record<MfaCodeKind, MfaCodeTexts>> = {
  totp: {
    label: "確認コード",
    toggleLabel: "リカバリーコードを使う",
    hint: "認証アプリに表示されている 6 桁の数字を入力してください。",
    placeholder: "123456",
    inputMode: "numeric",
  },
  recovery_code: {
    label: "リカバリーコード",
    toggleLabel: "認証アプリの確認コードを使う",
    hint: "有効化時に控えたリカバリーコードを 1 つ入力してください (1 つにつき 1 回だけ使えます)。",
    placeholder: "xxxxx-xxxxx",
    inputMode: "text",
  },
};

export const otherMfaCodeKind = (kind: MfaCodeKind): MfaCodeKind =>
  kind === "totp" ? "recovery_code" : "totp";
