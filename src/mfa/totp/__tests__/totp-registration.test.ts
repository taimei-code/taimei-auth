import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { auditRowsFor, dbTest, expectFailure } from "../../../__tests__/live-runner";
import { TestDb } from "../../../__tests__/test-db";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  findMfaTotpRow,
  installSentryRecorder,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "../../__tests__/helpers";
import {
  auditFailingLayer,
  disableBudgetLayer,
  issuerLayer,
  notifierLayer,
  sessionsLayer,
} from "../../__tests__/test-layers";
import {
  AlreadyEnabled,
  EnrollmentChanged,
  InvalidCode,
  Locked,
  MfaNotFound,
  NotEnabled,
} from "../../error-mapping";
import { activate } from "../activate-mfa";
import { disable } from "../disable-mfa";
import { enroll } from "../enroll-mfa";
import { readOwnedMfaStatus } from "../read-status";
import { verifyAndConsumeOwnedCode } from "../verify-code";

const P = "mfa-totp-reg-";
const { run, cleanup } = dbTest(P);
const sentry = installSentryRecorder();

const ISSUER = "taimei-test";

type Recorded = {
  revokes: Headers[];
  notified: string[];
  spends: string[];
  resets: string[];
};

function buildOps(overrides?: { locked?: boolean; auditFails?: boolean }) {
  const recorded: Recorded = { revokes: [], notified: [], spends: [], resets: [] };
  const layers = Layer.mergeAll(
    issuerLayer(ISSUER),
    sessionsLayer(recorded),
    notifierLayer(recorded.notified),
    disableBudgetLayer(recorded, overrides?.locked ?? false),
    ...(overrides?.auditFails ? [auditFailingLayer(new Error("audit store unavailable"))] : []),
  );
  return {
    ...recorded,
    run: <A, E, R>(program: Effect.Effect<A, E, R>) => Effect.provide(program, layers),
  };
}

const headers = new Headers({ "user-agent": "totp-reg-test", "x-forwarded-for": "203.0.113.9" });

const sentryAuditFailureEvents = () =>
  sentry.exceptions
    .filter((e) => e.context?.tags?.component === "audit-log")
    .map((e) => e.context?.tags?.event);

describe("MFA 登録遷移 (自前 totp)", () => {
  beforeEach(() => cleanup().then(() => sentry.reset()));
  afterAll(() => cleanup().then(() => sentry.restore()));

  test("AC-102/103/104 未登録: status 全 false・activate 404・disable 409", () =>
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
        expectFailure(notFound, MfaNotFound, "not_found", 404);
        const notEnabled = yield* Effect.flip(
          ops.run(disable({ actor, headers, code: "123456", kind: "totp" })),
        );
        expectFailure(notEnabled, NotEnabled, "not_enabled", 409);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("AC-023 登録済み未有効: disable は not_enabled で、試行枠を消費しない", () =>
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
        expectFailure(notEnabled, NotEnabled, "not_enabled", 409);
        expect(ops.spends).toEqual([]);
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
        expectFailure(mismatch, EnrollmentChanged, "enrollment_changed", 409);

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
        expectFailure(wrong, InvalidCode, "invalid_code", 400);
        expect(ops.revokes.length).toBe(0);

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
        expect(ops.notified).toEqual([`enabled:${user.email}`]);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
        expect(yield* ops.run(readOwnedMfaStatus(actor))).toEqual({
          enabled: true,
          recoveryCodesRemaining: 10,
        });

        expect((yield* auditRowsFor(user.id, "mfa_enabled")).length).toBe(1);
        expect(sentryAuditFailureEvents()).toEqual([]);

        expectFailure(
          yield* Effect.flip(ops.run(enroll({ actor }))),
          AlreadyEnabled,
          "already_enabled",
          409,
        );
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
          "already_enabled",
          409,
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
          "invalid_code",
          400,
        );

        const disabled = yield* ops.run(
          disable({ actor, headers, code: yield* totpCode(secret, 1), kind: "totp" }),
        );
        expect(disabled.sessionChanges).toBeInstanceOf(Headers);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
        expect(yield* countRecoveryCodeRows(user.id)).toBe(0);
        expect((yield* auditRowsFor(user.id, "mfa_disabled")).length).toBe(1);
        expect(sentryAuditFailureEvents()).toEqual([]);
        expect(ops.notified).toEqual([`enabled:${user.email}`, `disabled:${user.email}`]);
        expect(ops.resets).toEqual([user.id]);
      }),
    ));

  test("AC-121/122 リカバリーコードの消費と残数", () =>
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
          "invalid_code",
          400,
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
          "invalid_code",
          400,
        );
      }),
    ));

  test("AC-116/117 disable の試行枠: 誤コードで budget 消費、枯渇で locked", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("budget");
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

        const wrong = yield* Effect.flip(
          ops.run(disable({ actor, headers, code: yield* wrongTotpCode(secret), kind: "totp" })),
        );
        expectFailure(wrong, InvalidCode, "invalid_code", 400);
        expect(ops.spends).toEqual([user.id]);
        expect(yield* countMfaTotpRows(user.id)).toBe(1);

        const locked = buildOps({ locked: true });
        expectFailure(
          yield* Effect.flip(
            locked.run(disable({ actor, headers, code: yield* totpCode(secret), kind: "totp" })),
          ),
          Locked,
          "locked",
          429,
        );
        expect(yield* countMfaTotpRows(user.id)).toBe(1);

        const byRecovery = yield* ops.run(
          disable({ actor, headers, code: enrolled.recoveryCodes[0], kind: "recovery_code" }),
        );
        expect(byRecovery.sessionChanges).toBeInstanceOf(Headers);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("AC-157 audit 書込失敗でも操作は成功し Sentry で観測", () =>
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

  test("AC-156 並行 enroll ×2 → 両応答が勝者の内容へ収束、DB は 1 行", () =>
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
