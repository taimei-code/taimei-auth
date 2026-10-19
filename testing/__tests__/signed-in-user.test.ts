import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isJustSignedUp, type SessionData } from "@taimei-code/auth-client";
import {
  createTestingClient,
  type SignedInUserRequest,
  TESTING_PATH,
} from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { buildApp } from "../../src/app";
import { getTrustedOrigins } from "../../src/env";
import { dbTest } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import { testingRoutes } from "../routes";
import { testMagicLinkOutbox } from "./test-magic-link-outbox";

const { run } = dbTest("signed-in-user-test-");
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

const postSignedInUsers = (body: string) =>
  Promise.resolve(
    app.request(`${TESTING_PATH}/signed-in-users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
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

describe("試験 API が受け付けない request", () => {
  test("returnTo の origin が信頼する origin でなければ 400 を返し、利用者を作らない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const before = (yield* db.readUserIdsByEmailPrefix("test-user-")).length;
        const response = yield* Effect.promise(() =>
          postSignedInUsers(JSON.stringify({ companies: [], returnTo: UNTRUSTED_RETURN_TO })),
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
    expect((await postSignedInUsers(body)).status).toBe(400);
  });

  test("SDK の client は 2xx でない応答を、path と status を含む例外にする", async () => {
    await expect(
      testing.createSignedInUser({ companies: [], returnTo: UNTRUSTED_RETURN_TO }),
    ).rejects.toThrow("taimei-auth testing /signed-in-users failed with 400");
  });
});
