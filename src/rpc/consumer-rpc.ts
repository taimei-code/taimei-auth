import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client";
import { Effect, Schema } from "effect";
import type { MemberRow } from "@/db/repositories/membership";
import type { UserRow } from "@/db/repositories/user";
import type { Session } from "../auth";
import { Result } from "../gen/auth/v1/auth_pb";
import { MembershipRepo } from "../membership/ports";
import { verifySessionUser } from "./auth-handler";
import type { RpcEffect } from "./run-rpc";

const REASON = {
  [Result.SESSION_NOT_FOUND]: "SESSION_NOT_FOUND",
  [Result.USER_DELETED]: "USER_DELETED",
  [Result.REVISION_OUTDATED]: "REVISION_OUTDATED",
} as const;

const rejected = (reason: Result) => ({
  _tag: "Rejected" as const,
  reason: REASON[reason as keyof typeof REASON] ?? "SESSION_NOT_FOUND",
});

const toUser = (row: UserRow) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  emailVerified: row.emailVerified,
  image: row.image ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toSession = (session: Session["session"]) => ({
  id: session.id,
  expiresAt: session.expiresAt.toISOString(),
});

const toMember = (row: MemberRow) => ({
  userId: row.userId,
  name: row.userName,
  email: row.userEmail,
  role: row.role,
});

const byJoinedAt = (members: readonly MemberRow[]) =>
  members.toSorted(
    (a, b) =>
      a.joinedAt.getTime() - b.joinedAt.getTime() || a.membershipId.localeCompare(b.membershipId),
  );

const checkCookie = (cookieHeader: string, handler: string) => {
  const token = extractSessionTokenFromCookieHeader(cookieHeader);
  return token
    ? verifySessionUser(token, handler)
    : Effect.succeed({ _tag: "Rejected" as const, reason: Result.SESSION_NOT_FOUND });
};

export const verifySessionByCookie = Effect.fnUntraced(function* (cookieHeader: string) {
  const check = yield* checkCookie(cookieHeader, "consumerRpc.verifySession");
  if (check._tag === "Rejected") return rejected(check.reason);
  const companyId = check.user.lastUsedCompanyId;
  const membership = companyId
    ? yield* MembershipRepo.use((repo) => repo.findMembership(check.user.id, companyId))
    : undefined;
  return {
    _tag: "Verified" as const,
    user: toUser(check.user),
    session: toSession(check.session),
    companyId: companyId ?? null,
    role: membership?.role ?? null,
  };
});

export const listMembersByCookie = Effect.fnUntraced(function* (cookieHeader: string) {
  const check = yield* checkCookie(cookieHeader, "consumerRpc.listCurrentCompanyMembers");
  if (check._tag === "Rejected") return rejected(check.reason);
  const companyId = check.user.lastUsedCompanyId;
  if (!companyId) return { _tag: "Listed" as const, companyId: null, members: [] };
  const members = yield* MembershipRepo.use((repo) => repo.findMembersByCompanyId(companyId));
  if (!members.some((m) => m.userId === check.user.id)) {
    return { _tag: "Listed" as const, companyId: null, members: [] };
  }
  return { _tag: "Listed" as const, companyId, members: byJoinedAt(members).map(toMember) };
});

export const getSessionByCookie = Effect.fnUntraced(function* (cookieHeader: string) {
  const check = yield* checkCookie(cookieHeader, "consumerRpc.getSession");
  if (check._tag === "Rejected") return rejected(check.reason);
  const companyId = check.user.lastUsedCompanyId;
  const members = companyId
    ? yield* MembershipRepo.use((repo) => repo.findMembersByCompanyId(companyId))
    : [];
  const me = members.find((m) => m.userId === check.user.id);
  return {
    _tag: "Verified" as const,
    user: toUser(check.user),
    session: toSession(check.session),
    companyId: companyId ?? null,
    role: me?.role ?? null,
    members: me ? byJoinedAt(members).map(toMember) : [],
  };
});

type InvalidInputShape = { readonly _tag: "InvalidInput" };

export const rpc =
  <I, IE, O extends InvalidInputShape | { readonly _tag: string }, OE>(
    input: Schema.Codec<I, IE>,
    output: Schema.Codec<O, OE>,
    program: (value: I) => RpcEffect<O>,
  ) =>
  (raw: unknown): RpcEffect<OE> =>
    Schema.decodeUnknownEffect(input)(raw).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed({ _tag: "InvalidInput" } as O),
        onSuccess: program,
      }),
      Effect.flatMap((value) => Schema.encodeEffect(output)(value)),
      Effect.orDie,
    );
