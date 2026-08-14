import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { findUserById } from "@/db/repositories/user";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { guard } from "../../membership/guard";
import { activate } from "../registration/activate";
import { enroll } from "../registration/enroll";
import { clearTwoFactorEnabled } from "../gateway";
import {
  actorOf,
  countLiveSessions,
  createSessionFor,
  enableMfaFor,
  findTwoFactorRow,
  installSentryRecorder,
  issuedSessionCookieCount,
  secretFromTotpUri,
  sessionTokenFromForwarded,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  totpCode,
  withFailingAuditWrite,
} from "./helpers";

// activate use-case (src/mfa/registration/activate.ts) の DB/Redis 統合テスト。
// 副作用の順序 (前提条件 → revoke → rotate → audit) が守られていることを、rotate 前のトークンが
// revoke 対象から漏れていないか / 前提条件を外れた呼び出しで副作用が 1 つも起きないかで観測する。

const P = "mfa-activate-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

describe("activate", () => {
  beforeEach(async () => {
    await cleanup();
    sentry.reset();
  });

  afterAll(async () => {
    await cleanup();
    sentry.restore();
  });

  test("QA-H-12 mfa_enabled audit 1 + メール 1", async () => {
    const user = await seedUser("h12");
    const session = await createSessionFor(user.id);
    const enrolled = await enroll(actorOf(user), session.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    const result = await activate({
      actor: actorOf(user),
      headers: session.headers,
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 送信そのものは registration application がguard解放後に行うため、use-case 側の契約は「宛先 1 件」。
    expect(result.notifyEmail).toBe(user.email);
    expect(await issuedSessionCookieCount(result.forwardedHeaders)).toBe(1);

    const audits = await auditRowsFor(user.id, "mfa_enabled");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({ ip: TEST_CLIENT_IP, userAgent: TEST_USER_AGENT });

    expect((await findTwoFactorRow(user.id))?.verified).toBe(true);
  });

  test("QA-M-10 他セッション revoke", async () => {
    const user = await seedUser("m10");
    const operating = await createSessionFor(user.id);
    const otherDevice = await createSessionFor(user.id);

    expect(await countLiveSessions([operating.token, otherDevice.token])).toBe(2);
    expect((await guard.requireActor(otherDevice.headers)).ok).toBe(true);

    const enrolled = await enroll(actorOf(user), operating.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    const result = await activate({
      actor: actorOf(user),
      headers: operating.headers,
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // rotate 前のトークン基準で revoke しているので、操作したセッションも rotate で置き換わり
    // 「activate 前に存在した実体」は Redis から 1 つ残らず消える。
    expect(await countLiveSessions([operating.token, otherDevice.token])).toBe(0);
    expect(await guard.requireActor(otherDevice.headers)).toEqual({
      ok: false,
      error: "unauthorized",
      status: 401,
    });

    const rotated = await sessionTokenFromForwarded(result.forwardedHeaders);
    expect(rotated).toBeDefined();
    expect(await countLiveSessions([rotated as string])).toBe(1);
  });

  test("未登録ユーザー → not_found (revoke まで到達しない)", async () => {
    const user = await seedUser("unenrolled");
    const operating = await createSessionFor(user.id);
    const otherDevice = await createSessionFor(user.id);

    const result = await activate({
      actor: actorOf(user),
      headers: operating.headers,
      code: "000000",
    });

    expect(result).toEqual({ ok: false, error: "not_found", status: 404 });
    // 前提条件が revoke の後ろにあると、有効化を 1 つも行わないまま全デバイスが落ちる。
    expect(await countLiveSessions([operating.token, otherDevice.token])).toBe(2);
    expect(await auditRowsFor(user.id, "mfa_enabled")).toEqual([]);
  });

  test("QA-D-02 stale enrollment ID is rejected before session revocation", async () => {
    const user = await seedUser("stale-enrollment");
    const operating = await createSessionFor(user.id);
    const otherDevice = await createSessionFor(user.id);
    const enrolled = await enroll(actorOf(user), operating.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    const result = await activate({
      actor: actorOf(user),
      headers: operating.headers,
      enrollmentId: "a-different-enrollment",
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
    });

    expect(result).toEqual({ ok: false, error: "enrollment_changed", status: 409 });
    expect(await countLiveSessions([operating.token, otherDevice.token])).toBe(2);
    expect((await findTwoFactorRow(user.id))?.verified).toBe(false);
    expect(await auditRowsFor(user.id, "mfa_enabled")).toEqual([]);
  });

  test("有効化済みユーザーの再 activate → already_enabled (audit / 宛先が増えない)", async () => {
    const user = await seedUser("reactivate");
    const enabled = await enableMfaFor(user);
    const otherDevice = await createSessionFor(user.id);

    // 正しいコードでも通さない。コードの正誤ではなく「もう有効」であることが拒否の理由。
    const result = await activate({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
    });

    expect(result).toEqual({ ok: false, error: "already_enabled", status: 409 });
    // 通知メールは registration application が成功結果を受けて送るため、2 通目は失敗を返すことで止まる。
    expect(await auditRowsFor(user.id, "mfa_enabled")).toHaveLength(1);
    expect(await countLiveSessions([otherDevice.token])).toBe(1);
  });

  test("中断した無効化 (フラグのみ false) からの activate → already_enabled", async () => {
    const user = await seedUser("halfdisabled");
    const enabled = await enableMfaFor(user);
    await clearTwoFactorEnabled(user.id);
    const otherDevice = await createSessionFor(user.id);

    const result = await activate({
      actor: actorOf(user),
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
    });

    // 拒否の実効は「409 を返した」ではなく、MFA が実際には掛かっていないのに有効化の通知と
    // audit だけが増える状態を作らないこと。フラグ・audit・他セッションの 3 点で突き合わせる。
    expect(result).toEqual({ ok: false, error: "already_enabled", status: 409 });
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);
    expect(await auditRowsFor(user.id, "mfa_enabled")).toHaveLength(1);
    expect(await countLiveSessions([otherDevice.token])).toBe(1);
  });

  test("audit 記帳が落ちても有効化は完走する", async () => {
    const user = await seedUser("auditdown");
    const session = await createSessionFor(user.id);
    const enrolled = await enroll(actorOf(user), session.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    const code = await totpCode(secretFromTotpUri(enrolled.totpUri));

    const result = await withFailingAuditWrite(() =>
      activate({ actor: actorOf(user), headers: session.headers, code }),
    );

    // 記帳失敗を伝播させると、rotate 済みの Set-Cookie が転送されず操作した本人がログアウトし、
    // 通知メールの宛先も返らない。有効化が済んでいる以上、記帳の失敗は観測へ回すしかない。
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifyEmail).toBe(user.email);
    expect(await issuedSessionCookieCount(result.forwardedHeaders)).toBe(1);
    expect((await findTwoFactorRow(user.id))?.verified).toBe(true);

    expect(await auditRowsFor(user.id, "mfa_enabled")).toEqual([]);
    expect(sentry.exceptions.length).toBe(1);
    expect(sentry.exceptions[0]?.context?.tags).toEqual({
      component: "audit-log",
      event: "mfa_enabled",
    });
  });
});
