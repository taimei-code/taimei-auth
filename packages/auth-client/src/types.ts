import type { Result } from "./gen/auth/v1/auth_pb";

// IdP の内部表現をここに増やさない。
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
    kind: "user";
  };
  // undefined は事業所未選択。consumer は /auth/signup/company へ誘導する。
  companyId?: string;
};

export type VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result };
