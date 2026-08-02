// 表示ラベルの窓口。role の表と未知値 fallback ロジックはサーバ (招待メール) と共有の
// @core 実装が正本 (既定 fallback = 素の値、がそのまま SPA の契約)。
export { roleLabelJa } from "@core/membership/role-label";

// 事業形態の日本語表示。role 側 (roleLabelJa) と同じく画面間の三項コピペを 1 箇所に集約する。
// 未知値を「法人」に倒すのは複製元 3 箇所の現行挙動の踏襲。
export const orgCodeLabelJa = (orgCode: string): string =>
  orgCode === "PERSONAL" ? "個人事業主" : "法人";

// 連携 provider の表示名。provider id ("github") と正式表記 ("GitHub") の差を画面側の
// 三項で解決させない。未知 provider は素の id を返す (roleLabelJa の未知値契約と同じ)。
export const providerLabel = (providerId: string): string =>
  providerId === "github" ? "GitHub" : providerId;
