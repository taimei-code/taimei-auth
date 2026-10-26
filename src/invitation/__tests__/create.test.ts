import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Hono } from "hono";
import {
  buildTestApp,
  requestApp,
  responseJson,
  TEST_PREFIX,
} from "../../handlers/__tests__/helpers";
import {
  auditRowsFor,
  dbTest,
  drained,
  expectFailure,
  type TestServices,
} from "../../__tests__/live-runner";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { authApiWith } from "../../__tests__/test-layers";
import { TestDb } from "../../__tests__/test-db";
import { getAppUrl } from "../../email/client";
import { tryAuthApi } from "../../errors";
import { acceptInvitationPath } from "../accept-path";
import { createInvitation } from "../create";
import { RateLimited } from "../../failures";
import { testKvStore } from "../../__tests__/test-ttl-store";
import { ATTEMPT_BUDGETS, attemptBudgetKey } from "../../attempt-budget";
import { inviteGrantForTest } from "../../membership/__tests__/verified-for-test";

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
      attemptBudgetKey(
        ATTEMPT_BUDGETS.invitationsPerCompanyHour,
        `${companyId}:${new Date().toISOString().slice(0, 13)}`,
      ),
      value,
      3600,
    ),
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

const seedOwnerCompany = (key: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const owner = yield* db.seedUser(`${key}-owner`);
    const co = yield* db.seedCompany(key);
    yield* db.seedMembership(owner.id, co, "OWNER");
    return { owner, co, email: `${TEST_PREFIX}${key}-invitee@example.com` };
  });

const sentLinks = recordMagicLinks();

const runUseCase = <A, E>(program: Effect.Effect<A, E, TestServices>) =>
  run(
    program.pipe(
      Effect.provide(authApiWith(() => ({ signInMagicLink: sentLinks.signInMagicLink }))),
    ),
  );

describe("createInvitation (use-case)", () => {
  beforeEach(() => {
    sentLinks.sentTo.length = 0;
    sentLinks.callbackURLs.length = 0;
    return cleanup();
  });
  afterAll(cleanup);

  const { exceptions: captured } = recordSentry();

  const ownerWithCompany = (key: string) =>
    seedOwnerCompany(key).pipe(Effect.tap(({ co }) => clearRateKey(co)));

  test("新しい招待を作ると、招待した email 宛に、招待の受諾の URL を callbackURL にした Magic Link を 1 回送る", () =>
    runUseCase(
      Effect.gen(function* () {
        const { owner, co, email } = yield* ownerWithCompany("send-new");
        const result = yield* drained(
          createInvitation(
            inviteGrantForTest({
              actorUserId: owner.id,
              companyId: co,
              email,
              role: "MEMBER",
              redirectTarget: REDIRECT_TARGET,
            }),
          ),
        );
        expect(sentLinks.sentTo).toEqual([email]);
        expect(sentLinks.callbackURLs.map(String)).toEqual([
          `${getAppUrl()}${acceptInvitationPath(result.invitation.token, REDIRECT_TARGET)}`,
        ]);
      }),
    ));

  test("未対応の招待がある email へは既存の招待を返し、その招待の token の Magic Link を 1 回送る", () =>
    runUseCase(
      Effect.gen(function* () {
        const { owner, co, email } = yield* ownerWithCompany("send-reused");
        const grant = inviteGrantForTest({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        const first = yield* drained(createInvitation(grant));
        sentLinks.callbackURLs.length = 0;
        const second = yield* drained(createInvitation(grant));
        expect(second.reused).toBe(true);
        expect(
          sentLinks.callbackURLs.map((url) => url.searchParams.get("invitation_token")),
        ).toEqual([first.invitation.token]);
      }),
    ));

  test("Magic Link の送信が失敗しても招待の作成は成功し、Sentry に warning と handler の tag で 1 件残す", () =>
    runUseCase(
      Effect.gen(function* () {
        const { owner, co, email } = yield* ownerWithCompany("send-fail");
        const cause = new Error("resend down");
        const before = captured.length;
        const result = yield* drained(
          createInvitation(
            inviteGrantForTest({ actorUserId: owner.id, companyId: co, email, role: "MEMBER" }),
          ),
        ).pipe(
          Effect.provide(
            authApiWith(() => ({ signInMagicLink: () => tryAuthApi(() => Promise.reject(cause)) })),
          ),
        );
        expect(result.reused).toBe(false);
        expect(captured.length).toBe(before + 1);
        expect(captured.at(-1)?.[0]).toBe(cause);
        expect(captured.at(-1)?.[1]).toMatchObject({
          level: "warning",
          tags: { handler: "accountInvitation" },
        });
      }),
    ));

  test("試行枠の上限で招待の作成が失敗した時は、Magic Link を送らない", () =>
    runUseCase(
      Effect.gen(function* () {
        const { owner, co, email } = yield* ownerWithCompany("send-limited");
        yield* presetRate(co, INVITATION_HOURLY_LIMIT_DEFAULT);
        const e = yield* Effect.flip(
          drained(
            createInvitation(
              inviteGrantForTest({ actorUserId: owner.id, companyId: co, email, role: "MEMBER" }),
            ),
          ),
        );
        expectFailure(e, RateLimited);
        expect(sentLinks.sentTo).toEqual([]);
      }),
    ));

  test("新しい email には invitation を作り、試行枠を 1 消費し、invitation_sent の audit を残して reused=false を返す", () =>
    runUseCase(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h07-owner");
        const co = yield* db.seedCompany("h07");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h07-invitee@example.com`;

        const before = yield* rateCount(co);
        const result = yield* createInvitation(
          inviteGrantForTest({
            actorUserId: owner.id,
            companyId: co,
            email,
            role: "MEMBER",
          }),
        );
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

  test("PENDING の invitation がある email への再送は reused=true を返し、試行枠を消費せず audit も残さない", () =>
    runUseCase(
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
        const result = yield* createInvitation(
          inviteGrantForTest({
            actorUserId: owner.id,
            companyId: co,
            email,
            role: "MEMBER",
          }),
        );
        const after = yield* rateCount(co);

        expect(result.reused).toBe(true);
        expect(result.invitation.id).toBe(existing.id);
        expect(after - before).toBe(0);
        expect((yield* auditRowsFor(owner.id, "invitation_sent")).length).toBe(0);
      }),
    ));

  test("試行枠の上限に達すると rate_limited を返し、invitation も audit も作らない", () =>
    runUseCase(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("e02-owner");
        const co = yield* db.seedCompany("e02");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}e02-invitee@example.com`;

        yield* presetRate(co, INVITATION_HOURLY_LIMIT_DEFAULT);

        const e = yield* Effect.flip(
          createInvitation(
            inviteGrantForTest({ actorUserId: owner.id, companyId: co, email, role: "MEMBER" }),
          ),
        );
        expectFailure(e, RateLimited);
        expect((yield* invitationRowsByEmail(co, email)).length).toBe(0);
        expect((yield* auditRowsFor(owner.id, "invitation_sent")).length).toBe(0);
      }),
    ));

  test("試行枠の上限に達していても、PENDING の invitation がある email への再送は reused=true を返す (再送の判定を試行枠より先に行う)", () =>
    runUseCase(
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

        const result = yield* createInvitation(
          inviteGrantForTest({
            actorUserId: owner.id,
            companyId: co,
            email,
            role: "MEMBER",
          }),
        );
        expect(result.reused).toBe(true);
        expect(result.invitation.id).toBe(existing.id);
      }),
    ));

  test("先の招待が commit した後の 2 回目の招待は、既存の invitation を返して試行枠を消費しない", () =>
    runUseCase(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h13-owner");
        const co = yield* db.seedCompany("h13");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h13-invitee@example.com`;

        const before = yield* rateCount(co);
        const first = yield* createInvitation(
          inviteGrantForTest({
            actorUserId: owner.id,
            companyId: co,
            email,
            role: "MEMBER",
          }),
        );
        expect(first.reused).toBe(false);
        const afterFirst = yield* rateCount(co);
        expect(afterFirst - before).toBe(1);

        const second = yield* createInvitation(
          inviteGrantForTest({
            actorUserId: owner.id,
            companyId: co,
            email,
            role: "MEMBER",
          }),
        );
        expect(second.reused).toBe(true);
        expect(second.invitation.id).toBe(first.invitation.id);
        const afterSecond = yield* rateCount(co);
        expect(afterSecond - afterFirst).toBe(0);
        const rows = yield* invitationRowsByEmail(co, email);
        expect(rows.length).toBe(1);
      }),
    ));

  test("invitation を作った後に audit を残し、audit の invitation_id は返した invitation と一致する", () =>
    runUseCase(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h12-owner");
        const co = yield* db.seedCompany("h12");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h12-invitee@example.com`;

        const result = yield* createInvitation(
          inviteGrantForTest({
            actorUserId: owner.id,
            companyId: co,
            email,
            role: "ADMIN",
          }),
        );
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

const REDIRECT_TARGET = {
  service_name: "taimei",
  redirect_url: "https://app.taimei-code.com/dashboard",
} as const;

describe("POST /api/account/companies/:companyId/invitations (handler)", () => {
  const { exceptions: captured } = recordSentry();
  beforeEach(cleanup);
  afterAll(cleanup);

  test("招待の作成の route は、新しい招待を作った時に Magic Link を 1 回送る", () =>
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

  test("magic-link の送信が失敗しても 200 を返し、Sentry に warning を残す (fail-open)", () =>
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

  test("redirect_target 付きの招待は、callbackURL に token と redirect_target の組を含める", () =>
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

  test("redirect_target に余分な key を足しても、callbackURL の token は招待の token のままで、余分な key は載らない", () =>
    run(
      Effect.gen(function* () {
        const { owner, co, email } = yield* seedOwnerCompany("rt-extra");
        const magicLinks = recordMagicLinks();

        const res = yield* postInvitation(
          buildTestApp(owner, { signInMagicLink: magicLinks.signInMagicLink }),
          co,
          email,
          { redirect_target: { ...REDIRECT_TARGET, invitation_token: "forged", extra: "x" } },
        );

        expect(res.status).toBe(200);
        const [row] = yield* invitationRowsByEmail(co, email);
        const [callbackURL] = magicLinks.callbackURLs;
        expect(callbackURL?.searchParams.getAll("invitation_token")).toEqual([row?.token]);
        expect(callbackURL?.searchParams.has("extra")).toBe(false);
      }),
    ));

  test("redirect_target なしの招待は、従来の callbackURL のまま", () =>
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

  test("allowlist 外の redirect_target は 400 で、招待もメールも作らない", () =>
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

  test("redirect_target の片方だけは 400 で、メールを送らない", () =>
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

  test("PENDING の invitation への再送は、今回の redirect_target をメールに含める", () =>
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
