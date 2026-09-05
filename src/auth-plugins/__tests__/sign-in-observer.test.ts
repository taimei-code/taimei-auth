import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  actorOf,
  cleanupIssuedChallenges,
  createSessionFor,
  enableMfaFor,
  issueTestChallenge,
  loginWithMagicLink,
  secretFromTotpUri,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  totpCode,
  WELCOME_EMAIL_LOG,
} from "../../mfa/__tests__/helpers";
import { activate, completeLoginChallenge, enroll } from "../../mfa/totp";
import { runTest, observing, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";

// sign-in 観測プラグイン (src/auth-plugins/sign-in-observer.ts) の統合テスト。
// 観測対象は一次認証のみ — チャレンジ通過の sign_in は通過手続 (totp/complete-login-challenge) が
// 記帳する (ADR-0016 §4.6)。1 ログイン = 1 記帳の不変条件をここで固定する。

const P = "mfa-observer-";
const run = runTest(P);

const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

// 「初回サインアップ直後」を判定する閾値 (sign-in-observer の 10 秒) より確実に古くする。
const SETTLED_USER_AGE_MS = 60_000;

const cleanupAll = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
    }),
  );

const ageUser = (userId: string) =>
  TestDb.use((db) => db.setUserCreatedAt(userId, new Date(Date.now() - SETTLED_USER_AGE_MS)));

const welcomeEmailsIn = (logs: string[]): string[] =>
  logs.filter((line) => line.includes(WELCOME_EMAIL_LOG));

describe("sign-in 観測プラグイン", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-H-13 magic link → sign_in method:magic_link", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const seeded = yield* db.seedUser("h13");
        yield* ageUser(seeded.id);

        const login = yield* loginWithMagicLink({
          email: seeded.email,
          callbackURL: CONSUMER_CALLBACK,
        });

        expect(login.location?.toString()).toBe(CONSUMER_CALLBACK);
        const audits = yield* auditRowsFor(seeded.id, "sign_in");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          method: "magic_link",
          ip: TEST_CLIENT_IP,
          userAgent: TEST_USER_AGENT,
        });
      }),
    ));

  test("QA-D-10 sign_in audit 1 件のみ", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const seeded = yield* db.seedUser("d10");
        yield* ageUser(seeded.id);
        const enabled = yield* enableMfaFor(seeded);

        // MFA 有効ユーザーの 1 回のログインは「一次認証 (介入で記帳しない) → チャレンジ通過 (記帳)」の
        // 2 段になる。両段で記帳すると 1 ログインが 2 件になり、逆に写像が外れると 0 件になる。
        const login = yield* loginWithMagicLink({
          email: seeded.email,
          callbackURL: CONSUMER_CALLBACK,
        });
        expect(login.location?.pathname).toBe("/auth/mfa");
        expect(yield* auditRowsFor(seeded.id, "sign_in")).toEqual([]);

        const challenge = yield* issueTestChallenge({
          userId: seeded.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        const completed = yield* completeLoginChallenge(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });
        expect(completed.forwardedHeaders).toBeInstanceOf(Headers);

        const audits = yield* auditRowsFor(seeded.id, "sign_in");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toMatchObject({ method: "magic_link" });
      }),
    ));

  test("QA-R-03 welcome メール移設前と同じ", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const newcomer = yield* db.seedUser("r03-new");
        const returning = yield* db.seedUser("r03-old");
        yield* ageUser(returning.id);

        const firstLogin = yield* loginWithMagicLink({
          email: newcomer.email,
          callbackURL: CONSUMER_CALLBACK,
        });
        const laterLogin = yield* loginWithMagicLink({
          email: returning.email,
          callbackURL: CONSUMER_CALLBACK,
        });

        expect(welcomeEmailsIn(firstLogin.logs).length).toBe(1);
        expect(welcomeEmailsIn(firstLogin.logs)[0]).toContain(newcomer.email);
        expect(welcomeEmailsIn(laterLogin.logs)).toEqual([]);
      }),
    ));

  test("QA-M-28 welcome もサインイン記帳も一次認証経路限定 (登録操作は auth route を通らない)", () =>
    run(
      Effect.gen(function* () {
        // 作成直後 (welcome の対象年齢) のまま有効化まで進める。revoke も auth.api を通るため、
        // 観測が path で絞れていないと 2 通目の welcome や偽の sign_in が積まれる。
        const db = yield* TestDb;
        const seeded = yield* db.seedUser("m28");
        const session = yield* createSessionFor(seeded.id);
        const enrolled = yield* enroll({ actor: actorOf(seeded) });

        const code = yield* totpCode(secretFromTotpUri(enrolled.totpUri), -1);
        const activated = yield* observing(
          activate({
            actor: actorOf(seeded),
            headers: session.headers,
            code,
            enrollmentId: enrolled.enrollmentId,
          }),
        );

        expect(activated.value.sessionChanges).toBeInstanceOf(Headers);
        expect(welcomeEmailsIn(activated.logs)).toEqual([]);
        expect(yield* auditRowsFor(seeded.id, "sign_in")).toEqual([]);
      }),
    ));
});
