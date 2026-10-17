import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isJustSignedUp, type SessionData } from "@taimei-code/auth-client";
import { createTestingClient, TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { buildApp } from "../../src/app";
import { getTrustedOrigins } from "../../src/env";
import { testingRoutes } from "../routes";
import { dbTest } from "../../src/__tests__/live-runner";
import { testMagicLinkOutbox } from "./test-magic-link-outbox";
import { TestDb } from "../../src/__tests__/test-db";

const { run } = dbTest("signed-in-user-test-");
const [trustedOrigin] = getTrustedOrigins();
if (trustedOrigin === undefined) {
  throw new Error("AUTH_TRUSTED_ORIGINS is empty; the testing API refuses every returnTo");
}
const RETURN_TO = `${trustedOrigin}/after-sign-in`;

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

const openLoginUrl = (loginUrl: string) => {
  const url = new URL(loginUrl);
  return Promise.resolve(app.request(`${url.pathname}${url.search}`));
};

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

describe("試験 API の利用者", () => {
  test("指定した role で事業所に所属し、最初の事業所が現在の事業所になり、ログイン URL を開くと session の cookie が付いて returnTo へ戻り、同じ URL は二度は使えない", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* Effect.promise(() =>
          testing.createSignedInUser({
            companies: [{ role: "OWNER" }, { role: "ADMIN" }],
            returnTo: RETURN_TO,
          }),
        );
        const [first, second] = signedIn.companyIds;
        const db = yield* TestDb;
        const roles = (yield* db.readMemberships(signedIn.userId)).map((m) => [
          m.companyId,
          m.role,
        ]);
        expect(roles.sort()).toEqual(
          [
            [first, "OWNER"],
            [second, "ADMIN"],
          ].sort(),
        );
        expect((yield* db.readUser(signedIn.userId))?.lastUsedCompanyId).toBe(first);

        const opened = yield* Effect.promise(() => openLoginUrl(signedIn.loginUrl));
        expect(opened.status).toBe(302);
        expect(opened.headers.get("location")).toBe(RETURN_TO);
        expect(opened.headers.get("set-cookie")).toContain("session_token=");

        const reopened = yield* Effect.promise(() => openLoginUrl(signedIn.loginUrl));
        expect(reopened.headers.get("location")).not.toBe(RETURN_TO);
      }),
    ));

  test("作った直後の利用者は、SDK の isJustSignedUp で登録の直後と判定される", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* Effect.promise(() =>
          testing.createSignedInUser({ companies: [], returnTo: RETURN_TO }),
        );
        const row = yield* TestDb.use((db) => db.readUser(signedIn.userId));
        if (!row) throw new Error("user not created");
        expect(isJustSignedUp(sessionDataOf(row.createdAt))).toBe(true);
      }),
    ));

  test("現在の事業所を所属する別の事業所に切り替えられ、所属しない事業所には切り替えられない", () =>
    run(
      Effect.gen(function* () {
        const signedIn = yield* Effect.promise(() =>
          testing.createSignedInUser({
            companies: [{ role: "OWNER" }, { role: "MEMBER" }],
            returnTo: RETURN_TO,
          }),
        );
        const outsider = yield* Effect.promise(() =>
          testing.createSignedInUser({ companies: [{ role: "OWNER" }], returnTo: RETURN_TO }),
        );
        yield* Effect.promise(() =>
          testing.setCurrentCompany({
            userId: signedIn.userId,
            companyId: signedIn.companyIds[1] as string,
          }),
        );
        const db = yield* TestDb;
        expect((yield* db.readUser(signedIn.userId))?.lastUsedCompanyId).toBe(
          signedIn.companyIds[1],
        );

        const refused = yield* Effect.promise(() =>
          fetch(new URL(`${TESTING_PATH}/current-company`, `http://localhost:${server.port}`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: signedIn.userId, companyId: outsider.companyIds[0] }),
          }),
        );
        expect(refused.status).toBe(400);
      }),
    ));

  test("returnTo が信頼する origin でない時と、body の形が違う時は 400 を返す", async () => {
    const post = (body: unknown) =>
      app.request(`${TESTING_PATH}/signed-in-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post({ companies: [], returnTo: "https://attacker.example/" })).status).toBe(400);
    expect((await post({ companies: [{ role: "KING" }], returnTo: RETURN_TO })).status).toBe(400);
  });
});
