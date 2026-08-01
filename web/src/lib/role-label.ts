import { ROLE_LABELS_JA } from "@core/membership/role-label";

// 事業所内 role の日本語表示。OWNER/ADMIN/MEMBER 以外 (将来 role) は素の値を返す。
// Object.hasOwn を挟むのは、DB text 生値の role が "constructor" 等 prototype 上のキー名でも
// 素の値 fallback に落とすため。
export const roleLabelJa = (role: string): string =>
  Object.hasOwn(ROLE_LABELS_JA, role) ? ROLE_LABELS_JA[role as keyof typeof ROLE_LABELS_JA] : role;

// 事業形態の日本語表示。role 側 (roleLabelJa) と同じく画面間の三項コピペを 1 箇所に集約する。
// 未知値を「法人」に倒すのは複製元 3 箇所の現行挙動の踏襲。
export const orgCodeLabelJa = (orgCode: string): string =>
  orgCode === "PERSONAL" ? "個人事業主" : "法人";
