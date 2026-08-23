export type { OrgCode } from "../../db/repositories/company";

// 事業形態の日本語表示。未知値を「法人」に倒すのは共通画面 SPA の既存契約。
export const orgCodeLabelJa = (orgCode: string): string =>
  orgCode === "PERSONAL" ? "個人事業主" : "法人";
