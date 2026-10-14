import type { Role } from "../../db/repositories/membership";

export const ROLE_LABELS_JA: Record<Role, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
};

export const roleLabelJa = (role: Role): string => ROLE_LABELS_JA[role] ?? role;
