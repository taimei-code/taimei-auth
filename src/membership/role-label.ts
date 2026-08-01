// 相対 import なのは、web が @core alias 経由で本 file を読む際に "@/db/..." だと web 側の
// "@/" alias (web/src/) で誤解決するため。type-only import は build で消え web bundle に db は入らない。
import type { Role } from "../../db/repositories/membership";

// role の日本語表記の対応表。招待メール (server) と SPA 画面の両方がこの表と roleLabelJa を使い、
// 片方だけ直して表記や未知値の扱いが食い違うのを防ぐ。@core 経由で web からも import されるため、
// この file に runtime 依存 (db / resend 等) を足さないこと。
export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};

// role は DB text の生値が届きうる。Object.hasOwn を挟むのは "constructor" 等 prototype 上の
// キー名でも fallback に落とすため。未知値の fallback は用途で異なる (メールは「メンバー」、
// 画面は素の値) ので呼び出し側が渡す。
export const roleLabelJa = (role: string, unknownFallback: string = role): string =>
  Object.hasOwn(ROLE_LABELS_JA, role) ? ROLE_LABELS_JA[role as Role] : unknownFallback;
