export type { OrgCode } from "../../db/repositories/company";

// 未知の値を「法人」にするのは共通画面 SPA との契約。
export const orgCodeLabelJa = (orgCode: string): string =>
  orgCode === "PERSONAL" ? "個人事業主" : "法人";
