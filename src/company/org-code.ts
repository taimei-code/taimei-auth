import type { OrgCode } from "../../db/enums";

export type { OrgCode } from "../../db/enums";

export const orgCodeLabelJa = (orgCode: OrgCode): string =>
  orgCode === "PERSONAL" ? "個人事業主" : "法人";
