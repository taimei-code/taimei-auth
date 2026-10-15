import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { auditRowsFor, dbTest, drained, expectFailure } from "../../../__tests__/live-runner";
import { TestDb } from "../../../__tests__/test-db";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  findMfaTotpRow,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "../../__tests__/helpers";
import { SessionRejected } from "../../../auth-service";
import { AuthApiError } from "../../../errors";
import { Unauthorized } from "../../../membership/guard/errors";
import {
  auditFailingLayer,
  mfaMailRecorderLayer,
  revokeRecordingLayer,
} from "../../__tests__/test-layers";
import type { MfaCodeKind } from "../../mfa-contract";
import { disableAttemptsKey } from "../../disable-attempt-budget";
import {
  AlreadyEnabled,
  EnrollmentChanged,
  InvalidCode,
  Locked,
  MfaNotFound,
  NotEnabled,
} from "../../errors";
import { activate } from "../activate-mfa";
import { disable } from "../disable-mfa";
import { enroll } from "../enroll-mfa";
import { MfaTotpRepo } from "../ports";
import { readOwnedMfaStatus } from "../read-status";
import { consumeMatchedCode, matchOwnedCode } from "../verify-code";
import { testKvStore } from "../../../__tests__/test-ttl-store";
import { recordSentry } from "../../../__tests__/sentry-recorder";

const P = "mfa-totp-reg-";
const ISSUER = "taimei-test";
const { run, cleanup } = dbTest(P);
const sentry = recordSentry();

function buildOps(overrides?: {
  auditFails?: boolean;
  revoke?: Effect.Effect<Headers, SessionRejected | AuthApiError>;
}) {
  const recorded = { revokes: [] as Headers[], mailed: [] as string[] };
  const layers = Layer.mergeAll(
    revokeRecordingLayer(recorded, overrides?.revoke),
    mfaMailRecorderLayer(recorded.mailed),
    ...(overrides?.auditFails ? [auditFailingLayer(new Error("audit store unavailable"))] : []),
  );
  return {
    ...recorded,
    run: <A, E, R>(program: Effect.Effect<A, E, R>) => drained(Effect.provide(program, layers)),
  };
}

const verifyAndConsumeOwnedCode = (userId: string, input: { code: string; kind: MfaCodeKind }) =>
  Effect.flatMap(matchOwnedCode(userId, input), (matched) => consumeMatchedCode(userId, matched));

const disableAttemptCount = (userId: string) => testKvStore.get(disableAttemptsKey(userId));

const seedUserWithMfaEnabled = (ops: ReturnType<typeof buildOps>, seedName: string) =>
  Effect.gen(function* () {
    const user = yield* (yield* TestDb).seedUser(seedName);
    const actor = { id: user.id, email: user.email };
    const enrolled = yield* ops.run(enroll({ actor }));
    const secret = secretFromTotpUri(enrolled.totpUri);
    yield* ops.run(
      activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: yield* totpCode(secret, -1),
      }),
    );
    return { user, actor, enrolled, secret };
  });

const headers = new Headers({ "user-agent": "totp-reg-test", "x-forwarded-for": "203.0.113.9" });

const sentryAuditFailureEvents = () =>
  sentry.exceptions
    .filter(([, context]) => context?.tags?.component === "audit-log")
    .map(([, context]) => context?.tags?.event);

describe("MFA 登録遷移 (自前 totp)", () => {
  const originalAppName = process.env.APP_NAME;
  beforeAll(() => {
    process.env.APP_NAME = ISSUER;
  });
  beforeEach(() => cleanup().then(() => sentry.reset()));
  afterAll(() => {
    if (originalAppName === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = originalAppName;
    return cleanup();
  });

  test("未登録の user は status がすべて false、activate は 404、disable は 409", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("empty");
        const actor = { id: user.id, email: user.email };
        const ops = buildOps();

        expect(yield* ops.run(readOwnedMfaStatus(actor))).toEqual({
          enabled: false,
          recoveryCodesRemaining: 0,
        });
        const notFound = yield* Effect.flip(
          ops.run(activate({ actor, headers, enrollmentId: "no-enrollment", code: "123456" })),
        );
        expectFailure(notFound, MfaNotFound);
        const notEnabled = yield* Effect.flip(
          ops.run(disable({ actor, headers, code: "123456", kind: "totp" })),
        );
        expectFailure(notEnabled, NotEnabled);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("登録済みで未有効の user の disable は not_enabled を返し、試行枠を消費しない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("pending-disable");
        const actor = { id: user.id, email: user.email };
        const ops = buildOps();
        yield* ops.run(enroll({ actor }));

        const notEnabled = yield* Effect.flip(
          ops.run(disable({ actor, headers, code: "123456", kind: "totp" })),
        );
        expectFailure(notEnabled, NotEnabled);
        expect(disableAttemptCount(user.id)).toBeNull();
      }),
    ));

  test("一巡: enroll → 再表示 → 評決 → activate → disable (ADR-0016 §3.2)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("cycle");
        const actor = { id: user.id, email: user.email };
        const ops = buildOps();

        const enrolled = yield* ops.run(enroll({ actor }));
        expect(enrolled.totpUri.startsWith("otpauth://totp/")).toBe(true);
        expect(enrolled.totpUri).toContain(encodeURIComponent(ISSUER));
        expect(enrolled.recoveryCodes.length).toBe(10);
        expect(new Set(enrolled.recoveryCodes).size).toBe(10);
        for (const code of enrolled.recoveryCodes)
          expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
        expect(yield* ops.run(readOwnedMfaStatus(actor))).toMatchObject({ enabled: false });

        expect(yield* ops.run(enroll({ actor }))).toEqual(enrolled);

        const secret = secretFromTotpUri(enrolled.totpUri);
        const mismatch = yield* Effect.flip(
          ops.run(
            activate({ actor, headers, enrollmentId: "stale-id", code: yield* totpCode(secret) }),
          ),
        );
        expectFailure(mismatch, EnrollmentChanged);

        const wrong = yield* Effect.flip(
          ops.run(
            activate({
              actor,
              headers,
              enrollmentId: enrolled.enrollmentId,
              code: yield* wrongTotpCode(secret),
            }),
          ),
        );
        expectFailure(wrong, InvalidCode);
        expect(ops.revokes.length).toBe(0);
        expect(ops.mailed).toEqual([]);

        const activated = yield* ops.run(
          activate({
            actor,
            headers,
            enrollmentId: enrolled.enrollmentId,
            code: yield* totpCode(secret, -1),
          }),
        );
        expect(activated.sessionChanges.getSetCookie()).toEqual(["revoked=stub"]);
        expect(ops.revokes.length).toBe(1);
        expect(ops.mailed).toEqual([`enabled:${user.email}`]);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
        expect(yield* ops.run(readOwnedMfaStatus(actor))).toEqual({
          enabled: true,
          recoveryCodesRemaining: 10,
        });

        expect((yield* auditRowsFor(user.id, "mfa_enabled")).length).toBe(1);
        expect(sentryAuditFailureEvents()).toEqual([]);

        expectFailure(yield* Effect.flip(ops.run(enroll({ actor }))), AlreadyEnabled);
        expectFailure(
          yield* Effect.flip(
            ops.run(
              activate({
                actor,
                headers,
                enrollmentId: enrolled.enrollmentId,
                code: yield* totpCode(secret),
              }),
            ),
          ),
          AlreadyEnabled,
        );

        const code = yield* totpCode(secret);
        expect(
          Exit.isSuccess(
            yield* Effect.exit(ops.run(verifyAndConsumeOwnedCode(user.id, { code, kind: "totp" }))),
          ),
        ).toBe(true);
        expectFailure(
          yield* Effect.flip(ops.run(verifyAndConsumeOwnedCode(user.id, { code, kind: "totp" }))),
          InvalidCode,
        );

        const disabled = yield* ops.run(
          disable({ actor, headers, code: yield* totpCode(secret, 1), kind: "totp" }),
        );
        expect(disabled.sessionChanges).toBeInstanceOf(Headers);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
        expect(yield* countRecoveryCodeRows(user.id)).toBe(0);
        expect((yield* auditRowsFor(user.id, "mfa_disabled")).length).toBe(1);
        expect(sentryAuditFailureEvents()).toEqual([]);
        expect(ops.mailed).toEqual([`enabled:${user.email}`, `disabled:${user.email}`]);
      }),
    ));

  const activateWhenRevokeReturns = (
    revoke: Effect.Effect<Headers, SessionRejected | AuthApiError>,
    seedName: string,
  ) =>
    Effect.gen(function* () {
      const user = yield* (yield* TestDb).seedUser(seedName);
      const actor = { id: user.id, email: user.email };
      const ops = buildOps({ revoke });
      const enrolled = yield* ops.run(enroll({ actor }));
      const failure = yield* Effect.flip(
        ops.run(
          activate({
            actor,
            headers,
            enrollmentId: enrolled.enrollmentId,
            code: yield* totpCode(secretFromTotpUri(enrolled.totpUri)),
          }),
        ),
      );
      return { user, ops, failure };
    });

  test("activate: better-auth が操作中の session を拒否したら 401 unauthorized で、MFA は有効にならない", () =>
    run(
      Effect.gen(function* () {
        const {
          user,
          ops,
          failure: rejected,
        } = yield* activateWhenRevokeReturns(new SessionRejected(), "activate-rejected");

        expectFailure(rejected, Unauthorized);
        expect(ops.revokes.length).toBe(1);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
        expect((yield* auditRowsFor(user.id, "mfa_enabled")).length).toBe(0);
        expect(ops.mailed).toEqual([]);
        expect(sentry.exceptions).toEqual([]);
        expect(sentry.messages).toEqual([]);
      }),
    ));

  test("disable: better-auth が操作中の session を拒否したら 401 unauthorized で、MFA は有効のまま、送ったリカバリーコードも未使用のまま", () =>
    run(
      Effect.gen(function* () {
        const { user, actor, enrolled } = yield* seedUserWithMfaEnabled(
          buildOps(),
          "disable-rejected",
        );
        const ops = buildOps({ revoke: new SessionRejected() });

        const rejected = yield* Effect.flip(
          ops.run(
            disable({ actor, headers, code: enrolled.recoveryCodes[0], kind: "recovery_code" }),
          ),
        );

        expectFailure(rejected, Unauthorized);
        expect(ops.revokes.length).toBe(1);
        expect(yield* ops.run(readOwnedMfaStatus(actor))).toEqual({
          enabled: true,
          recoveryCodesRemaining: 10,
        });
        expect(yield* countMfaTotpRows(user.id)).toBe(1);
        expect((yield* auditRowsFor(user.id, "mfa_disabled")).length).toBe(0);
        expect(ops.mailed).toEqual([]);
        expect(sentry.exceptions).toEqual([]);
        expect(sentry.messages).toEqual([]);
      }),
    ));

  test("activate: revoke が AuthApiError なら Unauthorized にせずそのまま返す", () =>
    run(
      Effect.gen(function* () {
        const down = new AuthApiError({ cause: new Error("session store unavailable") });
        const { failure } = yield* activateWhenRevokeReturns(down, "activate-revoke-down");
        expect(failure).toBe(down);
      }),
    ));

  test("リカバリーコードは 1 回だけ使え、使うと残数が減る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("recovery");
        const actor = { id: user.id, email: user.email };
        const ops = buildOps();
        const enrolled = yield* ops.run(enroll({ actor }));
        const secret = secretFromTotpUri(enrolled.totpUri);
        yield* ops.run(
          activate({
            actor,
            headers,
            enrollmentId: enrolled.enrollmentId,
            code: yield* totpCode(secret, -1),
          }),
        );

        const [first] = enrolled.recoveryCodes;
        expect(
          Exit.isSuccess(
            yield* Effect.exit(
              ops.run(verifyAndConsumeOwnedCode(user.id, { code: first, kind: "recovery_code" })),
            ),
          ),
        ).toBe(true);
        expectFailure(
          yield* Effect.flip(
            ops.run(verifyAndConsumeOwnedCode(user.id, { code: first, kind: "recovery_code" })),
          ),
          InvalidCode,
        );
        expect(yield* ops.run(readOwnedMfaStatus(actor))).toMatchObject({
          recoveryCodesRemaining: 9,
        });

        const second = enrolled.recoveryCodes[1];
        const consume = ops.run(
          verifyAndConsumeOwnedCode(user.id, { code: second, kind: "recovery_code" }),
        );
        const race = yield* Effect.all([Effect.exit(consume), Effect.exit(consume)], {
          concurrency: "unbounded",
        });
        expect(race.filter(Exit.isSuccess).length).toBe(1);

        expectFailure(
          yield* Effect.flip(
            ops.run(
              verifyAndConsumeOwnedCode(user.id, { code: "zzzzz-zzzzz", kind: "recovery_code" }),
            ),
          ),
          InvalidCode,
        );
      }),
    ));

  test("disable の試行枠は誤コードで消費し、成功すると戻す", () =>
    run(
      Effect.gen(function* () {
        const ops = buildOps();
        const { user, actor, enrolled, secret } = yield* seedUserWithMfaEnabled(ops, "budget");

        const wrong = yield* Effect.flip(
          ops.run(disable({ actor, headers, code: yield* wrongTotpCode(secret), kind: "totp" })),
        );
        expectFailure(wrong, InvalidCode);
        expect(disableAttemptCount(user.id)).toBe("1");
        expect(yield* countMfaTotpRows(user.id)).toBe(1);
        expect(ops.mailed).toEqual([`enabled:${user.email}`]);

        const byRecovery = yield* ops.run(
          disable({ actor, headers, code: enrolled.recoveryCodes[0], kind: "recovery_code" }),
        );
        expect(byRecovery.sessionChanges).toBeInstanceOf(Headers);
        expect(disableAttemptCount(user.id)).toBeNull();
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
        expect(yield* countRecoveryCodeRows(user.id)).toBe(0);
        expect(ops.mailed).toEqual([`enabled:${user.email}`, `disabled:${user.email}`]);
      }),
    ));

  test("disable の試行枠を使い切ると、正しいコードでも locked を返す", () =>
    run(
      Effect.gen(function* () {
        const ops = buildOps();
        const { user, actor, secret } = yield* seedUserWithMfaEnabled(ops, "budget-exhausted");
        yield* Effect.sync(() => testKvStore.set(disableAttemptsKey(user.id), "5", 60));

        expectFailure(
          yield* Effect.flip(
            ops.run(disable({ actor, headers, code: yield* totpCode(secret), kind: "totp" })),
          ),
          Locked,
        );
        expect(yield* countMfaTotpRows(user.id)).toBe(1);
      }),
    ));

  test("disable の試行枠を数えられない時は、正しいコードでも locked を返す (fail-closed)", () =>
    run(
      Effect.gen(function* () {
        const ops = buildOps();
        const { user, actor, secret } = yield* seedUserWithMfaEnabled(ops, "budget-unavailable");
        yield* Effect.sync(() => testKvStore.set(disableAttemptsKey(user.id), "not-a-number", 60));

        expectFailure(
          yield* Effect.flip(
            ops.run(disable({ actor, headers, code: yield* totpCode(secret), kind: "totp" })),
          ),
          Locked,
        );
        expect(yield* countMfaTotpRows(user.id)).toBe(1);
      }),
    ));

  test("audit の書き込みに失敗しても操作は成功し、Sentry に記録する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("audit-fail");
        const actor = { id: user.id, email: user.email };
        const ops = buildOps({ auditFails: true });
        const enrolled = yield* ops.run(enroll({ actor }));
        const secret = secretFromTotpUri(enrolled.totpUri);

        const activated = yield* ops.run(
          activate({
            actor,
            headers,
            enrollmentId: enrolled.enrollmentId,
            code: yield* totpCode(secret, -1),
          }),
        );

        expect(activated.sessionChanges).toBeInstanceOf(Headers);
        expect(sentryAuditFailureEvents()).toEqual(["mfa_enabled"]);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();

        const disabled = yield* ops.run(
          disable({ actor, headers, code: yield* totpCode(secret, 1), kind: "totp" }),
        );
        expect(disabled.sessionChanges).toBeInstanceOf(Headers);
        expect(sentryAuditFailureEvents()).toEqual(["mfa_enabled", "mfa_disabled"]);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("コードの照合の後に別の経路が登録を消すと、本人の無効化は InvalidCode で止まり、mfa_disabled も通知も出さない", () =>
    run(
      Effect.gen(function* () {
        const { user, actor, secret } = yield* seedUserWithMfaEnabled(buildOps(), "disable-raced");
        const mfa = yield* MfaTotpRepo;
        const ops = buildOps({
          revoke: mfa.deleteMfaTotp(user.id).pipe(Effect.as(new Headers()), Effect.orDie),
        });

        expectFailure(
          yield* Effect.flip(
            ops.run(disable({ actor, headers, code: yield* totpCode(secret, 1), kind: "totp" })),
          ),
          InvalidCode,
        );
        expect((yield* auditRowsFor(user.id, "mfa_disabled")).length).toBe(0);
        expect(ops.mailed).toEqual([]);
      }),
    ));

  test("enroll を同時に 2 回呼ぶと、両方の応答が先に書いた方の内容になり、DB の行は 1 つ", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("race-enroll");
        const actor = { id: user.id, email: user.email };
        const ops = buildOps();

        const [a, b] = yield* Effect.all([ops.run(enroll({ actor })), ops.run(enroll({ actor }))], {
          concurrency: "unbounded",
        });

        expect(a).toEqual(b);
        expect(yield* countMfaTotpRows(user.id)).toBe(1);
        expect(yield* countRecoveryCodeRows(user.id)).toBe(10);
      }),
    ));
});
