import type { Result } from "./gen/auth/v1/auth_pb";

// SDK が consumer に公開するセッションの表現。IdP の内部表現をここに増やしてはならない。
// 詳細は docs/adr/0006-sdk-encapsulation.md を参照。
export type SessionData = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
    createdAt: string;
    updatedAt: string;
  };
  session: {
    id: string;
    expiresAt: string;
    // 将来 "admin" | "system" | "assumed" を足すための discriminant (現状は user session だけ)。
    kind: "user";
  };
  // undefined は「事業所未選択」を表す。consumer は事業所作成フロー (/auth/signup/company) へ誘導する。詳細は CONTEXT.md '事業所 / company' を参照
  companyId?: string;
};

export type VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result };
