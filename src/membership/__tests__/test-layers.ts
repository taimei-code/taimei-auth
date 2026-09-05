import { Effect, Layer } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import type { MembershipRow } from "@/db/repositories/membership";
import type { UserRow } from "@/db/repositories/user";
import { UserRepo } from "../../account/ports";
import type { Session } from "../../auth";
import { AuthApi } from "../../auth-service";
import { AuthApiError, DbError } from "../../errors";
import { InvitationRepo } from "../../invitation/ports";
import { MembershipRepo } from "../ports";
import { partial } from "../../__tests__/live-runner";
import { SentryLive, type SentryService } from "../../sentry";

// guard test 用の test Layer (design §3.14)。deps factory の後継で、Effect.provide で差し替える。
export { partial };

// guard program を SentryLive の下で走らせる。run は失敗を GuardError 相当 (_tag / error / status を持つ
// class) として取り出す (DbError 等は個別 test が instanceof で見る)。
export const run = <A, E>(p: Effect.Effect<A, E, SentryService>) =>
  Effect.runPromise(Effect.flip(Effect.provide(p, SentryLive))) as Promise<
    E & { _tag: string; error?: string; status?: number }
  >;

export const runOk = <A, E>(p: Effect.Effect<A, E, SentryService>) =>
  Effect.runPromise(Effect.provide(p, SentryLive));

export type Membership = { userId: string; companyId: string; role: string };

export const sessionOf = (userId: string): Session =>
  ({ session: { userId }, user: { id: userId } }) as unknown as Session;

export const userOf = (id: string, email: string): UserRow =>
  ({ id, email, lastUsedCompanyId: null }) as unknown as UserRow;

export const authLayer = (
  getSession: () => Effect.Effect<Session | null, AuthApiError> | Session | null,
  signOut: (headers: Headers) => Effect.Effect<void, AuthApiError> = () => Effect.void,
): Layer.Layer<AuthApi> =>
  Layer.succeed(
    AuthApi,
    partial<AuthApi["Service"]>({
      getSession: () => {
        const r = getSession();
        return Effect.isEffect(r) ? r : Effect.succeed(r);
      },
      signOut,
    }),
  );

export const authFailing = (cause: unknown): Layer.Layer<AuthApi> =>
  authLayer(() => Effect.fail(new AuthApiError({ cause })));

export const userRepoLayer = (users: UserRow[]): Layer.Layer<UserRepo> =>
  Layer.succeed(
    UserRepo,
    partial<UserRepo["Service"]>({
      findUserById: (id) => Effect.succeed(users.find((u) => u.id === id)),
    }),
  );

export const userRepoFailing = (cause: unknown): Layer.Layer<UserRepo> =>
  Layer.succeed(
    UserRepo,
    partial<UserRepo["Service"]>({ findUserById: () => Effect.fail(new DbError({ cause })) }),
  );

export const membershipRepoLayer = (rows: Membership[]): Layer.Layer<MembershipRepo> =>
  Layer.succeed(
    MembershipRepo,
    partial<MembershipRepo["Service"]>({
      findMembership: (userId, companyId) =>
        Effect.succeed(
          rows.find((r) => r.userId === userId && r.companyId === companyId) as
            | MembershipRow
            | undefined,
        ),
    }),
  );

export const membershipRepoFailing = (cause: unknown): Layer.Layer<MembershipRepo> =>
  Layer.succeed(
    MembershipRepo,
    partial<MembershipRepo["Service"]>({
      findMembership: () => Effect.fail(new DbError({ cause })),
    }),
  );

export const invitationRepoLayer = (rows: InvitationRow[]): Layer.Layer<InvitationRepo> =>
  Layer.succeed(
    InvitationRepo,
    partial<InvitationRepo["Service"]>({
      findInvitationByToken: (token) => Effect.succeed(rows.find((r) => r.token === token)),
    }),
  );

// 認証済み actor (user "u1", email) を解決する標準 Layer。
export const signedIn = (userId = "u1", email = "u1@example.com") =>
  Layer.mergeAll(
    authLayer(() => sessionOf(userId)),
    userRepoLayer([userOf(userId, email)]),
  );

export const signedOut = () =>
  Layer.mergeAll(
    authLayer(() => null),
    userRepoLayer([]),
  );
