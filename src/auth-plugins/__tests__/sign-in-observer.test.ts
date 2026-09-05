import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import {
  actorOf,
  cleanupIssuedChallenges,
  createSessionFor,
  enableMfaFor,
  issueTestChallenge,
  loginWithMagicLink,
  runObserving,
  secretFromTotpUri,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  totpCode,
  WELCOME_EMAIL_LOG,
} from "../../mfa/__tests__/helpers";
import { runMfaResult } from "../../mfa/__tests__/test-layers";
import { activate, completeLoginChallenge, enroll } from "../../mfa/totp";

// sign-in 観測プラグイン (src/auth-plugins/sign-in-observer.ts) の統合テスト。
// 観測対象は一次認証のみ — チャレンジ通過の sign_in は通過手続 (totp/complete-login-challenge) が
// 記帳する (ADR-0016 §4.6)。1 ログイン = 1 記帳の不変条件をここで固定する。

const P = "mfa-observer-";
const { cleanup, seedUser } = createSeedHelpers(P);

const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

// 「初回サインアップ直後」を判定する閾値 (sign-in-observer の 10 秒) より確実に古くする。
const SETTLED_USER_AGE_MS = 60_000;

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

const ageUser = (userId: string): Promise<unknown> =>
  db
    .update(user)
    .set({ createdAt: new Date(Date.now() - SETTLED_USER_AGE_MS) })
    .where(eq(user.id, userId));

const welcomeEmailsIn = (logs: string[]): string[] =>
  logs.filter((line) => line.includes(WELCOME_EMAIL_LOG));

describe("sign-in 観測プラグイン", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-H-13 magic link → sign_in method:magic_link", async () => {
    const seeded = await seedUser("h13");
    await ageUser(seeded.id);

    const login = await loginWithMagicLink({
      email: seeded.email,
      callbackURL: CONSUMER_CALLBACK,
    });

    expect(login.location?.toString()).toBe(CONSUMER_CALLBACK);
    const audits = await auditRowsFor(seeded.id, "sign_in");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({
      method: "magic_link",
      ip: TEST_CLIENT_IP,
      userAgent: TEST_USER_AGENT,
    });
  });

  test("QA-D-10 sign_in audit 1 件のみ", async () => {
    const seeded = await seedUser("d10");
    await ageUser(seeded.id);
    const enabled = await enableMfaFor(seeded);

    // MFA 有効ユーザーの 1 回のログインは「一次認証 (介入で記帳しない) → チャレンジ通過 (記帳)」の
    // 2 段になる。両段で記帳すると 1 ログインが 2 件になり、逆に写像が外れると 0 件になる。
    const login = await loginWithMagicLink({
      email: seeded.email,
      callbackURL: CONSUMER_CALLBACK,
    });
    expect(login.location?.pathname).toBe("/auth/mfa");
    expect(await auditRowsFor(seeded.id, "sign_in")).toEqual([]);

    const challenge = await issueTestChallenge({
      userId: seeded.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "magic_link",
    });
    const completed = await runMfaResult(
      completeLoginChallenge(challenge.headers, {
        code: await totpCode(enabled.secret),
        kind: "totp",
      }),
    );
    expect(completed.ok).toBe(true);

    const audits = await auditRowsFor(seeded.id, "sign_in");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toMatchObject({ method: "magic_link" });
  });

  test("QA-R-03 welcome メール移設前と同じ", async () => {
    const newcomer = await seedUser("r03-new");
    const returning = await seedUser("r03-old");
    await ageUser(returning.id);

    const firstLogin = await loginWithMagicLink({
      email: newcomer.email,
      callbackURL: CONSUMER_CALLBACK,
    });
    const laterLogin = await loginWithMagicLink({
      email: returning.email,
      callbackURL: CONSUMER_CALLBACK,
    });

    expect(welcomeEmailsIn(firstLogin.logs).length).toBe(1);
    expect(welcomeEmailsIn(firstLogin.logs)[0]).toContain(newcomer.email);
    expect(welcomeEmailsIn(laterLogin.logs)).toEqual([]);
  });

  test("QA-M-28 welcome もサインイン記帳も一次認証経路限定 (登録操作は auth route を通らない)", async () => {
    // 作成直後 (welcome の対象年齢) のまま有効化まで進める。revoke も auth.api を通るため、
    // 観測が path で絞れていないと 2 通目の welcome や偽の sign_in が積まれる。
    const seeded = await seedUser("m28");
    const session = await createSessionFor(seeded.id);
    const enrolled = await runMfaResult(enroll({ actor: actorOf(seeded) }));
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    const code = await totpCode(secretFromTotpUri(enrolled.totpUri), -1);
    const activated = await runObserving(() =>
      runMfaResult(
        activate({
          actor: actorOf(seeded),
          headers: session.headers,
          code,
          enrollmentId: enrolled.enrollmentId,
        }),
      ),
    );

    expect(activated.value.ok).toBe(true);
    expect(welcomeEmailsIn(activated.logs)).toEqual([]);
    expect(await auditRowsFor(seeded.id, "sign_in")).toEqual([]);
  });
});
