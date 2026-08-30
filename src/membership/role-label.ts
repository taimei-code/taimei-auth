// 相対 import なのは web 側の "@/" alias (web/src/) と誤解決するため。type-only なので web bundle に db は入らない。
import type { Role } from "../../db/repositories/membership";

// role の日本語表記の対応表。招待メール (server) と SPA 画面が同じ表を使い表記の食い違いを防ぐ。
// @core 経由で web からも import されるため runtime 依存 (db / resend 等) を足さないこと。
export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};

// role は DB text の生値が届きうるため Object.hasOwn を挟み prototype 上のキー名も fallback に落とす。
// 未知値の fallback は用途で異なる (メールは「メンバー」、画面は素の値) ので呼び出し側が渡す。
export const roleLabelJa = (role: string, unknownFallback: string = role): string =>
  Object.hasOwn(ROLE_LABELS_JA, role) ? ROLE_LABELS_JA[role as Role] : unknownFallback;
