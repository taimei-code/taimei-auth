// 相対 import にするのは、web 側の "@/" alias として誤って解決されるため。
import type { Role } from "../../db/repositories/membership";

export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};

// 古い SPA bundle が server の新しい role を受け取る version skew では型が実態と合わないため、raw の値を返して空欄にしない。
export const roleLabelJa = (role: Role): string => ROLE_LABELS_JA[role] ?? role;
