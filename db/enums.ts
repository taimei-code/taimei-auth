export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ORG_CODES = ["PERSONAL", "CORPORATE"] as const;
export type OrgCode = (typeof ORG_CODES)[number];
