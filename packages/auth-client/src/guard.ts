import { Code, ConnectError } from "@connectrpc/connect";
import type { createAuthClient } from "./server";
import type { ListMembersResult, Member, Role, SessionData, VerifyResult } from "./types";
import {
  type CompanyMember,
  type GetSessionResponse,
  type ListCurrentCompanyMembersResponse,
  Role as ProtoRole,
  Result,
  type VerifySessionOk,
  type VerifySessionResponse,
} from "./gen/auth/v1/auth_pb";

type AuthClient = ReturnType<typeof createAuthClient>;

const ROLE_BY_PROTO: Partial<Record<ProtoRole, Role>> = {
  [ProtoRole.OWNER]: "OWNER",
  [ProtoRole.ADMIN]: "ADMIN",
  [ProtoRole.MEMBER]: "MEMBER",
} satisfies Record<Exclude<ProtoRole, ProtoRole.UNSPECIFIED>, Role>;

// React.cache をそのまま渡せる形 (react は import しない)。
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  getSessionToken: () => Promise<string | undefined>;
  // 1 request 内の重複呼び出しをまとめる (Next.js では React.cache)。省略時は毎回 RPC。
  cache?: CacheFn;
};

// declare const の unique symbol は dist/guard.d.ts に出ず consumer に漏れない。
declare const externalTokenBrand: unique symbol;
declare const internalSessionBrand: unique symbol;

type ExternalToken = { readonly raw: string; readonly [externalTokenBrand]: true };
type InternalSession = SessionData & { readonly [internalSessionBrand]: true };

const identity: CacheFn = (fn) => fn;

const asExternalToken = (raw: string): ExternalToken => ({ raw }) as ExternalToken;
const asInternalSession = (data: SessionData): InternalSession => data as InternalSession;

const failure = (reason: Result): { ok: false; reason: Result } => ({ ok: false, reason });

const toSessionResult = ({
  user,
  session,
  currentRole,
}: Pick<VerifySessionOk, "user" | "session" | "currentRole">): VerifyResult => {
  if (!user || !session) {
    return failure(Result.UNSPECIFIED);
  }
  const internal: InternalSession = asInternalSession({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
      kind: "user",
    },
    companyId: session.companyId ?? user.defaultCompanyId,
    role: currentRole === undefined ? undefined : ROLE_BY_PROTO[currentRole],
  });
  return { ok: true, data: internal };
};

const toMembers = (protoMembers: readonly CompanyMember[]): Member[] =>
  protoMembers.map(({ userId, name, email, role }) => ({
    userId,
    name,
    email,
    role: ROLE_BY_PROTO[role],
  }));

const toVerifyResult = (response: VerifySessionResponse): VerifyResult => {
  switch (response.outcome.case) {
    case "error":
      return failure(response.outcome.value.reason);
    case "ok":
      return toSessionResult(response.outcome.value);
    default:
      return failure(Result.UNSPECIFIED);
  }
};

const toListMembersResult = (response: ListCurrentCompanyMembersResponse): ListMembersResult => {
  switch (response.outcome.case) {
    case "error":
      return failure(response.outcome.value.reason);
    case "ok": {
      const { companyId, members } = response.outcome.value;
      return { ok: true, data: { companyId, members: toMembers(members) } };
    }
    default:
      return failure(Result.UNSPECIFIED);
  }
};

type SessionAndMembers = { session: VerifyResult; members: ListMembersResult };

const failedSessionAndMembers = (reason: Result): SessionAndMembers => ({
  session: failure(reason),
  members: failure(reason),
});

const fromGetSession = (response: GetSessionResponse): SessionAndMembers => {
  switch (response.outcome.case) {
    case "error":
      return failedSessionAndMembers(response.outcome.value.reason);
    case "ok": {
      const session = toSessionResult(response.outcome.value);
      if (!session.ok) return failedSessionAndMembers(session.reason);
      const { currentRole, members } = response.outcome.value;
      return {
        session,
        members: {
          ok: true,
          data: {
            companyId: currentRole === undefined ? undefined : session.data.companyId,
            members: toMembers(members),
          },
        },
      };
    }
    default:
      return failedSessionAndMembers(Result.UNSPECIFIED);
  }
};

export function createAuthGuard(options: GuardOptions) {
  const { client, getSessionToken, cache = identity } = options;

  const fromVerifyThenList = async (request: {
    sessionToken: string;
  }): Promise<SessionAndMembers> => {
    const session = await client.authService
      .verifySession(request)
      .then(toVerifyResult, () => failure(Result.UNSPECIFIED));
    if (!session.ok) return failedSessionAndMembers(session.reason);
    const list = await client.authService
      .listCurrentCompanyMembers(request)
      .then(toListMembersResult, () => failure(Result.UNSPECIFIED));
    return {
      session,
      members:
        list.ok && list.data.companyId !== session.data.companyId
          ? failure(Result.UNSPECIFIED)
          : list,
    };
  };

  const loadSession = cache(async (): Promise<SessionAndMembers> => {
    const raw = await getSessionToken();
    if (!raw) {
      return failedSessionAndMembers(Result.SESSION_NOT_FOUND);
    }
    const token: ExternalToken = asExternalToken(raw);
    const request = { sessionToken: token.raw };

    return client.authService
      .getSession(request)
      .then(fromGetSession, (error) =>
        ConnectError.from(error).code === Code.Unimplemented
          ? fromVerifyThenList(request)
          : failedSessionAndMembers(Result.UNSPECIFIED),
      );
  });

  const getSession = async (): Promise<VerifyResult> => (await loadSession()).session;

  const listMembers = async (): Promise<ListMembersResult> => (await loadSession()).members;

  return { getSession, listMembers };
}
