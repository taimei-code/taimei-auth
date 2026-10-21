import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { isJustSignedUp, type SessionData } from "@taimei-code/auth-client";
import {
  createTestingClient,
  type SignedInUserRequest,
  TESTING_PATH,
} from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { buildApp } from "../../src/app";
import { companySeenByConsumer } from "../../src/__tests__/consumer-company-view";
import { Role as ProtoRole } from "../../src/gen/auth/v1/auth_pb";
import { getTrustedOrigins } from "../../src/env";
import { dbTest } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import { testingRoutes } from "../routes";
import { testMagicLinkOutbox } from "./test-magic-link-outbox";

const P = "signed-in-user-test-";
const { run, cleanup } = dbTest(P);
const [trustedOrigin] = getTrustedOrigins();
if (trustedOrigin === undefined) {
  throw new Error("AUTH_TRUSTED_ORIGINS is empty; the testing API refuses every returnTo");
}
const RETURN_TO = `${trustedOrigin}/after-sign-in`;
const UNTRUSTED_RETURN_TO = "https://attacker.example/";

const app = buildApp({ mountStatic: () => {} });
app.route("/", testingRoutes(testMagicLinkOutbox));
let server: ReturnType<typeof Bun.serve>;
let testing: ReturnType<typeof createTestingClient>;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: app.fetch });
  testing = createTestingClient(`http://localhost:${server.port}`);
});

afterAll(() => {
  server.stop(true);
});

const createSignedInUser = (request: SignedInUserRequest) =>
  Effect.promise(() => testing.createSignedInUser(request));

const openLoginUrl = (loginUrl: string) => {
  const url = new URL(loginUrl);
  return Effect.promise(() => Promise.resolve(app.request(`${url.pathname}${url.search}`)));
};

const postToTestingApi = (path: "/signed-in-users" | "/current-company", body: string) =>
  Promise.resolve(
    app.request(`${TESTING_PATH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );

const switchAuditCount = (userId: string) =>
  TestDb.use((db) => db.readAuditRows(userId, "company_switched")).pipe(
    Effect.map((rows) => rows.length),
  );

const sessionDataOf = (createdAt: Date): SessionData => ({
  user: {
    id: "u",
    name: "n",
    email: "e",
    emailVerified: false,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  },
  session: { id: "s", expiresAt: "", kind: "user" },
});

describe("試験 API で作る利用者と事業所", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("SDK の testing の subpath は試験 API の path の接頭辞を出す", () => {
    expect(TESTING_PATH).toBe("/testing/v1");
  });

  test("指定した role の順に事業所に所属し、最初の事業所が現在の事業所になる", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "OWNER" }, { role: "ADMIN" }],
          returnTo: RETURN_TO,
        });
        const db = yield* TestDb;
        const roleOf = new Map(
          (yield* db.readMemberships(signedIn.userId)).map((m) => [m.companyId, m.role]),
        );
        expect(signedIn.companyIds.map((id) => roleOf.get(id))).toEqual(["OWNER", "ADMIN"]);
        expect((yield* db.readUser(signedIn.userId))?.lastUsedCompanyId).toBe(
          signedIn.companyIds[0],
        );
      }),
    ));

  test("ADMIN と MEMBER の所属は招待と受諾で作り、事業所ごとに招待の送信と受諾の audit を 1 件ずつ残す", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "OWNER" }, { role: "ADMIN" }, { role: "MEMBER" }],
          returnTo: RETURN_TO,
        });
        const db = yield* TestDb;
        const [, adminCompany, memberCompany] = signedIn.companyIds;
        const invitedCompanies = [adminCompany, memberCompany];
        const companyIdsOf = (rows: readonly { payload: unknown }[]) =>
          rows.map((row) => (row.payload as { company_id: string }).company_id).sort();

        const accepted = yield* db.readAuditRows(signedIn.userId, "invitation_accepted");
        expect(companyIdsOf(accepted)).toEqual([...invitedCompanies].sort());
        for (const companyId of invitedCompanies) {
          if (companyId === undefined) throw new Error("no company was created");
          const [owner] = (yield* db.readMembershipsOfCompany(companyId)).filter(
            (m) => m.role === "OWNER",
          );
          if (owner === undefined) throw new Error("the company has no owner");
          expect(companyIdsOf(yield* db.readAuditRows(owner.userId, "invitation_sent"))).toEqual([
            companyId,
          ]);
        }
      }),
    ));

  test("最初の事業所へ戻す切り替えの audit は、直前の事業所を最後に所属した事業所とする", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "OWNER" }, { role: "ADMIN" }],
          returnTo: RETURN_TO,
        });
        const [first, second] = signedIn.companyIds;
        const switched = yield* TestDb.use((db) =>
          db.readAuditRows(signedIn.userId, "company_switched"),
        );
        expect(switched.at(-1)?.payload).toEqual({
          from_company_id: second,
          to_company_id: first,
        });
      }),
    ));

  test("OWNER 以外の role の事業所の OWNER は、作った利用者とは別の user である", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "ADMIN" }],
          returnTo: RETURN_TO,
        });
        const [adminCompany] = signedIn.companyIds;
        if (adminCompany === undefined) throw new Error("no company was created");
        const owners = (yield* TestDb.use((db) => db.readMembershipsOfCompany(adminCompany)))
          .filter((m) => m.role === "OWNER")
          .map((m) => m.userId);
        expect(owners).toHaveLength(1);
        expect(owners).not.toContain(signedIn.userId);
      }),
    ));

  test("companies が空なら、所属も現在の事業所も無い", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({ companies: [], returnTo: RETURN_TO });
        const db = yield* TestDb;
        expect(signedIn.companyIds).toEqual([]);
        expect(yield* db.readMemberships(signedIn.userId)).toEqual([]);
        expect((yield* db.readUser(signedIn.userId))?.lastUsedCompanyId).toBeNull();
      }),
    ));

  test("返す email は試験の利用者の形で、作った user の email と同じ", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({ companies: [], returnTo: RETURN_TO });
        expect(signedIn.email).toMatch(/^test-user-[0-9a-f-]{36}@example\.com$/);
        expect((yield* TestDb.use((db) => db.readUser(signedIn.userId)))?.email).toBe(
          signedIn.email,
        );
      }),
    ));

  test("指定した名前で利用者と事業所を作り、省くと既定の名前になる", () =>
    run(
      Effect.gen(function* () {
        const named = yield* createSignedInUser({
          name: "山田 試験",
          companies: [{ name: "Acme 試験", role: "OWNER" }],
          returnTo: RETURN_TO,
        });
        const unnamed = yield* createSignedInUser({
          companies: [{ role: "OWNER" }],
          returnTo: RETURN_TO,
        });
        const [namedCompany] = named.companyIds;
        const [unnamedCompany] = unnamed.companyIds;
        if (namedCompany === undefined || unnamedCompany === undefined) {
          throw new Error("no company was created");
        }
        const db = yield* TestDb;
        expect((yield* db.readUser(named.userId))?.name).toBe("山田 試験");
        expect((yield* db.readCompany(namedCompany))?.name).toBe("Acme 試験");
        expect((yield* db.readUser(unnamed.userId))?.name).toBe("Test User");
        expect((yield* db.readCompany(unnamedCompany))?.name).toBe("Test Company");
      }),
    ));

  test("ログイン URL を開くと session の cookie が付いて returnTo へ移り、同じ URL は二度は使えない", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({ companies: [], returnTo: RETURN_TO });

        const opened = yield* openLoginUrl(signedIn.loginUrl);
        expect(opened.status).toBe(302);
        expect(opened.headers.get("location")).toBe(RETURN_TO);
        expect(opened.headers.get("set-cookie")).toContain("session_token=");

        const reopened = yield* openLoginUrl(signedIn.loginUrl);
        expect(reopened.headers.get("location")).not.toBe(RETURN_TO);
      }),
    ));

  test("作った直後の利用者は、SDK の isJustSignedUp で登録の直後と判定される", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({ companies: [], returnTo: RETURN_TO });
        const row = yield* TestDb.use((db) => db.readUser(signedIn.userId));
        if (!row) throw new Error("user not created");
        expect(isJustSignedUp(sessionDataOf(row.createdAt))).toBe(true);
      }),
    ));
});

describe("試験 API で試験の利用者の現在の事業所を切り替える", () => {
  test("SDK の setCurrentCompany で切り替えると、VerifySession と GetSession がその事業所と role を現在の事業所として見せ、切り替えを audit に残す", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "OWNER" }, { role: "ADMIN" }],
          returnTo: RETURN_TO,
        });
        const [first, second] = signedIn.companyIds;
        if (first === undefined || second === undefined) throw new Error("no company was created");
        const switchAuditCountBefore = yield* switchAuditCount(signedIn.userId);

        const result = yield* Effect.promise(() =>
          testing.setCurrentCompany({ userId: signedIn.userId, companyId: second }),
        );

        expect(result).toEqual({ ok: true });
        const seen = yield* companySeenByConsumer(P, signedIn.userId);
        expect(seen.verifySession).toEqual({ companyId: second, role: ProtoRole.ADMIN });
        expect(seen.getSession).toEqual(seen.verifySession);
        const switched = yield* TestDb.use((db) =>
          db.readAuditRows(signedIn.userId, "company_switched"),
        );
        expect(switched).toHaveLength(switchAuditCountBefore + 1);
        expect(switched.at(-1)?.payload).toEqual({
          from_company_id: first,
          to_company_id: second,
        });
      }),
    ));

  test("既に現在の事業所である事業所へ切り替えると ok を返し、現在の事業所も audit も変えない", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "OWNER" }, { role: "ADMIN" }],
          returnTo: RETURN_TO,
        });
        const [first] = signedIn.companyIds;
        if (first === undefined) throw new Error("no company was created");
        const switchAuditCountBefore = yield* switchAuditCount(signedIn.userId);

        const result = yield* Effect.promise(() =>
          testing.setCurrentCompany({ userId: signedIn.userId, companyId: first }),
        );

        expect(result).toEqual({ ok: true });
        expect(yield* switchAuditCount(signedIn.userId)).toBe(switchAuditCountBefore);
        expect((yield* TestDb.use((db) => db.readUser(signedIn.userId)))?.lastUsedCompanyId).toBe(
          first,
        );
      }),
    ));

  test("所属しない事業所への SDK の setCurrentCompany は 400 の例外になり、現在の事業所を変えない", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* createSignedInUser({
          companies: [{ role: "OWNER" }],
          returnTo: RETURN_TO,
        });
        const other = yield* createSignedInUser({
          companies: [{ role: "OWNER" }],
          returnTo: RETURN_TO,
        });

        const [otherCompany] = other.companyIds;
        if (otherCompany === undefined) throw new Error("no company was created");
        const rejected = yield* Effect.tryPromise(() =>
          testing.setCurrentCompany({
            userId: signedIn.userId,
            companyId: otherCompany,
          }),
        ).pipe(Effect.flip);

        expect(rejected.cause).toEqual(
          new Error("taimei-auth testing /current-company failed with 400"),
        );
        expect((yield* TestDb.use((db) => db.readUser(signedIn.userId)))?.lastUsedCompanyId).toBe(
          signedIn.companyIds[0],
        );
      }),
    ));

  test.each([
    ["利用者がいなければ 404", JSON.stringify({ userId: `${P}missing-user`, companyId: "c" }), 404],
    ["body が JSON でなければ 400", "{", 400],
    ["companyId が無ければ 400", JSON.stringify({ userId: "u" }), 400],
    ["userId が文字列でなければ 400", JSON.stringify({ userId: 1, companyId: "c" }), 400],
  ])("%s を返す", async (_, body, status) => {
    expect((await postToTestingApi("/current-company", body)).status).toBe(status);
  });
});

describe("試験 API が受け付けない request", () => {
  test("returnTo の origin が信頼する origin でなければ 400 を返し、利用者を作らない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const before = (yield* db.readUserIdsByEmailPrefix("test-user-")).length;
        const response = yield* Effect.promise(() =>
          postToTestingApi(
            "/signed-in-users",
            JSON.stringify({ companies: [], returnTo: UNTRUSTED_RETURN_TO }),
          ),
        );
        expect(response.status).toBe(400);
        expect((yield* db.readUserIdsByEmailPrefix("test-user-")).length).toBe(before);
      }),
    ));

  test.each([
    ["returnTo が URL でない", JSON.stringify({ companies: [], returnTo: "not a url" })],
    [
      "role が決まった値でない",
      JSON.stringify({ companies: [{ role: "KING" }], returnTo: RETURN_TO }),
    ],
    ["body が JSON でない", "{"],
    [
      "事業所の名前が空白だけ",
      JSON.stringify({ companies: [{ name: "   ", role: "OWNER" }], returnTo: RETURN_TO }),
    ],
    ["利用者の名前が空白だけ", JSON.stringify({ name: "   ", companies: [], returnTo: RETURN_TO })],
  ])("%s なら 400 を返す", async (_, body) => {
    expect((await postToTestingApi("/signed-in-users", body)).status).toBe(400);
  });

  test("SDK の client は 2xx でない応答を、path と status を含む例外にする", async () => {
    await expect(
      testing.createSignedInUser({ companies: [], returnTo: UNTRUSTED_RETURN_TO }),
    ).rejects.toThrow("taimei-auth testing /signed-in-users failed with 400");
  });
});
