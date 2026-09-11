// 相対 import なのは web 側の "@/" alias と誤解決するため。
import type { Role } from "../../db/repositories/membership";

export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};

// 古い SPA bundle が server の新しい role を受ける version skew では型が嘘になるため、raw を返して空欄にしない。
export const roleLabelJa = (role: Role): string => ROLE_LABELS_JA[role] ?? role;
