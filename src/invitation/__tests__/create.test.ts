import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Hono } from "hono";
import {
  buildTestApp,
  requestApp,
  responseJson,
  TEST_PREFIX,
} from "../../handlers/__tests__/helpers";
import { auditRowsFor, dbTest, drained, expectFailure } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { TestDb } from "../../__tests__/test-db";
import { getAppUrl } from "../../email/client";
import { tryAuthApi } from "../../errors";
import { acceptInvitationPath } from "../accept-path";
import { createInvitation } from "../create";
import { RateLimited } from "../errors";
import { testKvStore } from "../../__tests__/test-ttl-store";

const { run, cleanup } = dbTest(TEST_PREFIX);
const INVITATION_HOURLY_LIMIT_DEFAULT = "50";

const invitationRowsByEmail = (companyId: string, email: string) =>
  TestDb.use((db) => db.readInvitationsByEmail(companyId, email));

const rateCount = (companyId: string) =>
  Effect.sync(() => {
    return testKvStore
      .keys(`invitation_rate:${companyId}:`)
      .reduce((acc, k) => acc + Number(testKvStore.get(k) ?? 0), 0);
  });

const clearRateKey = (companyId: string) =>
  Effect.sync(() => {
    for (const k of testKvStore.keys(`invitation_rate:${companyId}:`)) testKvStore.delete(k);
  });

const presetRate = (companyId: string, value: string) =>
  Effect.sync(() =>
    testKvStore.set(
      `invitation_rate:${companyId}:${new Date().toISOString().slice(0, 13)}`,
      value,
      3600,
    ),
  );

describe("createInvitation (use-case)", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-07 新規 email → 新規 invitation 作成 + rate 1 消費 + invitation_sent audit / reused=false", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h07-owner");
        const co = yield* db.seedCompany("h07");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h07-invitee@example.com`;

        const before = yield* rateCount(co);
        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        const after = yield* rateCount(co);

        expect(result.reused).toBe(false);
        expect(after - before).toBe(1);

        const rows = yield* invitationRowsByEmail(co, email);
        expect(rows.length).toBe(1);
        expect(rows[0]?.status).toBe("PENDING");

        const audits = yield* auditRowsFor(owner.id, "invitation_sent");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          invitation_id: rows[0]?.id,
          company_id: co,
          invited_email: email,
          role: "MEMBER",
          invited_by_user_id: owner.id,
        });
      }),
    ));

  test("QA-M-02 既存 PENDING 再送 → reused=true / rate 消費 0 / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m02-owner");
        const co = yield* db.seedCompany("m02");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}m02-invitee@example.com`;
        const existing = yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        yield* clearRateKey(co);

        const before = yield* rateCount(co);
        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        const after = yield* rateCount(co);

        expect(result.reused).toBe(true);
        expect(result.invitation.id).toBe(existing.id);
        expect(after - before).toBe(0);
        expect((yield* auditRowsFor(owner.id, "invitation_sent")).length).toBe(0);
      }),
    ));

  test("QA-E-02 rate 上限到達 → rate_limited Result / invitation 作成なし / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("e02-owner");
        const co = yield* db.seedCompany("e02");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}e02-invitee@example.com`;

        yield* presetRate(co, INVITATION_HOURLY_LIMIT_DEFAULT);

        const e = yield* Effect.flip(
          createInvitation({ actorUserId: owner.id, companyId: co, email, role: "MEMBER" }),
        );
        expectFailure(e, RateLimited, "rate_limited", 429);
        expect((yield* invitationRowsByEmail(co, email)).length).toBe(0);
        expect((yield* auditRowsFor(owner.id, "invitation_sent")).length).toBe(0);
      }),
    ));

  test("QA-M-02 rate 上限中でも既存 PENDING 宛の再送 → reused=true (idempotency > rate 順序)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m02b-owner");
        const co = yield* db.seedCompany("m02b");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}m02b-invitee@example.com`;
        const existing = yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        yield* clearRateKey(co);
        yield* presetRate(co, "999");

        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        expect(result.reused).toBe(true);
        expect(result.invitation.id).toBe(existing.id);
      }),
    ));

  test("QA-H-13 idempotency は逐次 (先行 commit 後の後続) — 2 回目は既存を拾い rate 消費なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h13-owner");
        const co = yield* db.seedCompany("h13");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h13-invitee@example.com`;

        const before = yield* rateCount(co);
        const first = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        expect(first.reused).toBe(false);
        const afterFirst = yield* rateCount(co);
        expect(afterFirst - before).toBe(1);

        const second = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        expect(second.reused).toBe(true);
        expect(second.invitation.id).toBe(first.invitation.id);
        const afterSecond = yield* rateCount(co);
        expect(afterSecond - afterFirst).toBe(0);
        const rows = yield* invitationRowsByEmail(co, email);
        expect(rows.length).toBe(1);
      }),
    ));

  test("QA-H-12 mutation → audit の発火順 pin (audit の invitation_id が返却 row と一致)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h12-owner");
        const co = yield* db.seedCompany("h12");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h12-invitee@example.com`;

        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "ADMIN",
        });
        const persisted = yield* db.readPendingInvitation(co, email);
        const audit = (yield* auditRowsFor(owner.id, "invitation_sent"))[0];
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.invitation_id).toBe(persisted?.id);
        expect(payload.invitation_id).toBe(result.invitation.id);
      }),
    ));
});

const postInvitation = (
  app: Hono,
  companyId: string,
  email: string,
  extraBody: Record<string, unknown> = {},
) =>
  drained(
    requestApp(app, `http://localhost/api/account/companies/${companyId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role: "MEMBER", ...extraBody }),
    }),
  );

const recordMagicLinks = () => {
  const sentTo: string[] = [];
  const callbackURLs: URL[] = [];
  const signInMagicLink = ({ email, callbackURL }: { email: string; callbackURL: string }) =>
    Effect.sync(() => {
      sentTo.push(email);
      callbackURLs.push(new URL(callbackURL));
    });
  return { sentTo, callbackURLs, signInMagicLink };
};

const REDIRECT_TARGET = {
  service_name: "taimei",
  redirect_url: "https://app.taimei-code.com/dashboard",
} as const;

const seedOwnerCompany = (key: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const owner = yield* db.seedUser(`${key}-owner`);
    const co = yield* db.seedCompany(key);
    yield* db.seedMembership(owner.id, co, "OWNER");
    return { owner, co, email: `${TEST_PREFIX}${key}-invitee@example.com` };
  });

describe("POST /api/account/companies/:companyId/invitations (handler)", () => {
  const captured = recordSentryExceptions();
  beforeEach(cleanup);
  afterAll(cleanup);

  test("magic-link は handler post-commit で reused=false 経路 1 回だけ呼ばれる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("ml-new-owner");
        const co = yield* db.seedCompany("ml-new");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}ml-new-invitee@example.com`;
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
        );

        expect(res.status).toBe(200);
        const body = (yield* responseJson(res)) as { reused: boolean };
        expect(body.reused).toBe(false);
        expect(magicLinks.sentTo).toEqual([email]);
      }),
    ));

  test("AC-038 magic-link の送信失敗は 200 のまま Sentry warning に残る (fail-open)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("ml-fail-owner");
        const co = yield* db.seedCompany("ml-fail");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}ml-fail-invitee@example.com`;
        const cause = new Error("resend down");
        const before = captured.length;

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: () => tryAuthApi(() => Promise.reject(cause)) }),
          co,
          email,
        );

        expect(res.status).toBe(200);
        expect(captured.length).toBe(before + 1);
        expect(captured.at(-1)?.[0]).toBe(cause);
        expect(captured.at(-1)?.[1]).toMatchObject({
          level: "warning",
          tags: { handler: "accountInvitation" },
        });
      }),
    ));

  test("magic-link は reused=true 経路 (既存 PENDING 再送) でも 1 回だけ呼ばれる (両経路で送信)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("ml-reuse-owner");
        const co = yield* db.seedCompany("ml-reuse");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}ml-reuse-invitee@example.com`;
        yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
        );

        expect(res.status).toBe(200);
        const body = (yield* responseJson(res)) as { reused: boolean };
        expect(body.reused).toBe(true);
        expect(magicLinks.sentTo).toEqual([email]);
      }),
    ));

  test("AC-011 redirect_target 付きの招待は callbackURL に token と組を載せる", () =>
    run(
      Effect.gen(function* () {
        const { owner, co, email } = yield* seedOwnerCompany("rt-with");
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
          { redirect_target: REDIRECT_TARGET },
        );

        expect(res.status).toBe(200);
        const [row] = yield* invitationRowsByEmail(co, email);
        const [callbackURL] = magicLinks.callbackURLs;
        expect(callbackURL?.searchParams.get("invitation_token")).toBe(row?.token);
        expect(callbackURL?.searchParams.get("service_name")).toBe(REDIRECT_TARGET.service_name);
        expect(callbackURL?.searchParams.get("redirect_url")).toBe(REDIRECT_TARGET.redirect_url);
      }),
    ));

  test("AC-012 redirect_target なしの招待は従来の callbackURL のまま", () =>
    run(
      Effect.gen(function* () {
        const { owner, co, email } = yield* seedOwnerCompany("rt-without");
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
        );

        expect(res.status).toBe(200);
        const [row] = yield* invitationRowsByEmail(co, email);
        expect(magicLinks.callbackURLs.map(String)).toEqual([
          `${getAppUrl()}${acceptInvitationPath(row?.token ?? "")}`,
        ]);
        expect(magicLinks.callbackURLs[0]?.searchParams.has("service_name")).toBe(false);
      }),
    ));

  test("AC-013 allowlist 外の redirect_target は 400 で、招待もメールも作らない", () =>
    run(
      Effect.gen(function* () {
        const { owner, co, email } = yield* seedOwnerCompany("rt-evil");
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
          { redirect_target: { ...REDIRECT_TARGET, redirect_url: "https://evil.example.com/" } },
        );

        expect(res.status).toBe(400);
        expect(yield* invitationRowsByEmail(co, email)).toEqual([]);
        expect(magicLinks.sentTo).toEqual([]);
      }),
    ));

  test("AC-014 redirect_target の片方だけは 400 で、メールを送らない", () =>
    run(
      Effect.gen(function* () {
        const { owner, co, email } = yield* seedOwnerCompany("rt-half");
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
          { redirect_target: { service_name: "taimei" } },
        );

        expect(res.status).toBe(400);
        expect(magicLinks.sentTo).toEqual([]);
      }),
    ));

  test("AC-015 既存 PENDING への再送は今回の redirect_target を載せる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const { owner, co, email } = yield* seedOwnerCompany("rt-reuse");
        yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
          { redirect_target: REDIRECT_TARGET },
        );

        const body = (yield* responseJson(res)) as { reused: boolean };
        expect(body.reused).toBe(true);
        const [callbackURL] = magicLinks.callbackURLs;
        expect(callbackURL?.searchParams.get("service_name")).toBe(REDIRECT_TARGET.service_name);
        expect(callbackURL?.searchParams.get("redirect_url")).toBe(REDIRECT_TARGET.redirect_url);
      }),
    ));
});
