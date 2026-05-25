import type { Result } from "./gen/auth/v1/auth_pb";

// SDK が consumer に公開するセッション表現。IdP 内部表現 (token / userId / provider 種別等) を
// 増やしてはならない。詳細: docs/adr/0006-sdk-encapsulation.md
// kind は現状 "user" 固定。将来 "admin" | "system" | "assumed" に拡張。
// companyId は ADR-009 で追加 (flat shape、未選択時 undefined)。Role は open string で
// VIEWER 等の将来 role 追加を consumer 側 exhaustive switch breaking なしで取り回せるように。
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
  companyId?: string;
};

// VerifySession の戻り値を discriminated union で表現。
// consumer は `result.ok` で分岐し、失敗時は `result.reason` (Result enum) を見る。
export type VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result };
