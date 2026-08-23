// 連携providerの表示名。未知providerは既存契約どおりraw IDを返す。
export const providerLabel = (providerId: string): string =>
  providerId === "github" ? "GitHub" : providerId;
