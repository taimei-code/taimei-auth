import type { Role } from "../../db/repositories/membership";

// role の日本語表記の対応表。招待メール (src/email/send-invitation.ts) と SPA 画面
// (web/src/lib/role-label.ts) の両方がこの表を使い、片方だけ直してメールと画面の表記が
// 食い違うのを防ぐ。@core 経由で web からも import されるため、この file に runtime 依存
// (db / resend 等) を足さないこと (上の type import は build で消える)。
// 未知 role の扱いは用途で異なる (メールは「メンバー」、画面は素の値) ため fallback は呼び出し側が持つ。
export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};
