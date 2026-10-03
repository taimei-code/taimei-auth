import { afterAll, describe, expect, test } from "bun:test";
import { createRouterTransport, type Interceptor } from "@connectrpc/connect";
import {
  createAuthClient,
  createAuthGuard,
  extractSessionTokenFromCookieHeader,
  getRole,
  type Role,
} from "@taimei-code/auth-client";
import { Effect } from "effect";
import { dbTest, inTx } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { applyRemoval, applyRoleChange } from "../../membership/apply-change";
import { createSessionFor } from "../../mfa/__tests__/helpers";
import { registerRoutes } from "../routes";

const P = "pocrole-";
const { run, cleanup } = dbTest(P);
afterAll(cleanup);

let rpcCalls = 0;
const countCalls: Interceptor = (next) => (req) => {
  rpcCalls += 1;
  return next(req);
};
const client = createAuthClient({
  transport: createRouterTransport(registerRoutes, { transport: { interceptors: [countCalls] } }),
});

type Observed = { companyId?: string; role?: Role; rpcCalls: number };

const verified = async (token: string | undefined) => {
  const result = await createAuthGuard({ client, getSessionToken: async () => token }).getSession();
  if (!result.ok) throw new Error(`VerifySession failed: ${result.reason}`);
  return result.data;
};

const viaVerifySession = async (token: string | undefined): Promise<Observed> => {
  rpcCalls = 0;
  const { companyId, role } = await verified(token);
  return { companyId, role, rpcCalls };
};

const viaGetMembership = async (token: string | undefined): Promise<Observed> => {
  rpcCalls = 0;
  const { user, companyId } = await verified(token);
  const role = companyId ? await getRole(client, { userId: user.id, companyId }) : undefined;
  return { companyId, role, rpcCalls };
};

const candidates = { A: viaVerifySession, B: viaGetMembership } as const;

const record = (cell: string, candidate: string, observed: unknown) =>
  console.log(`POC ${JSON.stringify({ cell, candidate, observed })}`);

const seedWorld = (label: string) =>
  run(
    Effect.gen(function* () {
      const db = yield* TestDb;
      const owner = yield* db.seedUser(`${label}-owner`);
      const admin = yield* db.seedUser(`${label}-admin`);
      const member = yield* db.seedUser(`${label}-member`);
      const c1 = yield* db.seedCompany(`${label}-c1`);
      const c2 = yield* db.seedCompany(`${label}-c2`);
      yield* db.seedMembership(owner.id, c1, "OWNER");
      yield* db.seedMembership(admin.id, c1, "ADMIN");
      yield* db.seedMembership(admin.id, c2, "MEMBER");
      yield* db.seedMembership(member.id, c1, "MEMBER");
      for (const u of [owner, admin, member]) yield* db.setLastUsedCompany(u.id, c1);
      const cookieTokenOf = (userId: string) =>
        Effect.map(createSessionFor(userId), ({ headers }) =>
          extractSessionTokenFromCookieHeader(headers.get("cookie") ?? ""),
        );
      const tokens = {
        owner: yield* cookieTokenOf(owner.id),
        admin: yield* cookieTokenOf(admin.id),
        member: yield* cookieTokenOf(member.id),
      };
      return { c1, c2, admin, tokens };
    }),
  );

describe.each(["A", "B"] as const)("candidate %s", (name) => {
  const observe = candidates[name];

  test("M1/P1: 返る role が DB の membership.role と一致する", async () => {
    const w = await seedWorld(`m1${name}`);
    const owner = await observe(w.tokens.owner);
    const member = await observe(w.tokens.member);
    record("M1", name, { owner, member });
    expect([owner.companyId, owner.role]).toEqual([w.c1, "OWNER"]);
    expect([member.companyId, member.role]).toEqual([w.c1, "MEMBER"]);
  });

  test("M2: ADMIN → MEMBER の直後の 1 回目の呼び出しで MEMBER が返る", async () => {
    const w = await seedWorld(`m2${name}`);
    const before = await observe(w.tokens.admin);
    await run(
      inTx((tx) =>
        applyRoleChange(tx, { targetUserId: w.admin.id, companyId: w.c1, nextRole: "MEMBER" }),
      ),
    );
    const after = await observe(w.tokens.admin);
    record("M2", name, { before, after });
    expect(before.role).toBe("ADMIN");
    expect(after.role).toBe("MEMBER");
  });

  test("M3: C1 から除名した直後の 1 回目の呼び出しで C2 の MEMBER になる", async () => {
    const w = await seedWorld(`m3${name}`);
    const before = await observe(w.tokens.admin);
    await run(inTx((tx) => applyRemoval(tx, { targetUserId: w.admin.id, companyId: w.c1 })));
    const after = await observe(w.tokens.admin);
    const roleInRemovedCompany = await getRole(client, { userId: w.admin.id, companyId: w.c1 });
    record("M3", name, { before, after, roleInRemovedCompany });
    expect([before.companyId, before.role]).toEqual([w.c1, "ADMIN"]);
    expect([after.companyId, after.role]).toEqual([w.c2, "MEMBER"]);
    expect(roleInRemovedCompany).toBeUndefined();
  });
});
