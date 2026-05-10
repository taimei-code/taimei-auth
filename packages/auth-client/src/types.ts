// SDK が consumer に公開するセッション表現。IdP 内部表現 (token / userId / provider 種別等) を
// 増やしてはならない。詳細: docs/adr/0006-sdk-encapsulation.md
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
  };
};
