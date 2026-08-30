import type { Result } from "./gen/auth/v1/auth_pb";

// SDK が consumer に公開するセッション表現。IdP 内部表現を増やしてはならない。
// 詳細: docs/adr/0006-sdk-encapsulation.md
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
    // 将来 "admin" | "system" | "assumed" を足すための discriminant (現状は user session のみ)。
    kind: "user";
  };
  // undefined = 「事業所未選択」。consumer は事業所作成フロー (/auth/signup/company) へ誘導する。詳細: CONTEXT.md '事業所 / company'
  companyId?: string;
};

export type VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result };
