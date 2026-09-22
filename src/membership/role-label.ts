// 相対 import ("@/" は web 側の alias として解決される)。
import type { Role } from "../../db/repositories/membership";

export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};

// 古い SPA bundle が新しい role を受け取る version skew では型が実態と合わない。raw を返して空欄にしない。
export const roleLabelJa = (role: Role): string => ROLE_LABELS_JA[role] ?? role;
