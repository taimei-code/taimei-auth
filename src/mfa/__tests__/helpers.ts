import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { Effect } from "effect";
import { TtlStore } from "../../ttl-store-service";
import { resetDisableAttempts } from "../disable-attempt-budget";
import { activate, enroll } from "../totp";
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from "../totp/totp-parameters";
import {
  attemptsKey,
  challengeKey,
  type ChallengeMethod,
  openLoginChallenge,
} from "../totp/login-challenge";
import { TestDb } from "../../__tests__/test-db";
import type { Actor } from "../../account/actor-contract";
import {
  actorOf,
  createSessionFor,
  requestHeaders,
  type TestSession,
} from "../../__tests__/session-helpers";

export function secretFromTotpUri(totpUri: string): string {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error(`totp uri has no secret: ${totpUri}`);
  return new TextDecoder().decode(base32.decode(encoded));
}

export const totpCode = (secret: string, stepOffset = 0): Effect.Effect<string> =>
  Effect.promise(() => {
    const otp = createOTP(secret, { period: TOTP_PERIOD_SECONDS, digits: TOTP_DIGITS });
    if (stepOffset === 0) return otp.totp();
    const counter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000)) + stepOffset;
    return otp.hotp(counter);
  });

export const wrongTotpCode = (secret: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const rejected = yield* Effect.forEach(
      [-2, -1, 0, 1, 2],
      (offset) => totpCode(secret, offset),
      { concurrency: "unbounded" },
    );
    for (let candidate = 0; candidate < 1000; candidate++) {
      const code = String(candidate).padStart(6, "0");
      if (!rejected.includes(code)) return code;
    }
    return yield* Effect.die(new Error("failed to find a code outside the verification window"));
  });

export const findMfaTotpRow = (userId: string) => TestDb.use((db) => db.readMfaTotp(userId));

export const countMfaTotpRows = (userId: string) =>
  findMfaTotpRow(userId).pipe(Effect.map((row) => (row ? 1 : 0)));

export const countRecoveryCodeRows = (userId: string) =>
  TestDb.use((db) => db.readRecoveryCodes(userId)).pipe(Effect.map((rows) => rows.length));

type EnabledMfaUser = {
  actor: Pick<Actor, "id" | "email">;
  secret: string;
  recoveryCodes: string[];
  enrollmentId: string;
  session: TestSession;
};

const PREVIOUS_TIMESTEP_LEAVES_CURRENT_FOR_LATER_CHECKS = -1;

export const enableMfaFor = (user: { id: string; email: string }) =>
  Effect.gen(function* () {
    const session = yield* createSessionFor(user.id);
    const actor = actorOf(user);
    const enrolled = yield* enroll({ actor });
    const secret = secretFromTotpUri(enrolled.totpUri);
    yield* activate({
      actor,
      headers: session.headers,
      code: yield* totpCode(secret, PREVIOUS_TIMESTEP_LEAVES_CURRENT_FOR_LATER_CHECKS),
      enrollmentId: enrolled.enrollmentId,
    });
    yield* resetDisableAttempts(user.id);
    return {
      actor,
      secret,
      recoveryCodes: enrolled.recoveryCodes,
      enrollmentId: enrolled.enrollmentId,
      session,
    } satisfies EnabledMfaUser;
  });

type IssuedChallenge = {
  challengeId: string;
  cookieName: string;
  headers: Headers;
  signedValue: string;
};

const issuedChallengeIds: string[] = [];

export const issueTestChallenge = (challenge: {
  userId: string;
  redirectUrl: string;
  method: ChallengeMethod;
}) =>
  openLoginChallenge(challenge).pipe(
    Effect.map((cookie): IssuedChallenge => {
      const challengeId = cookie.value.slice(0, cookie.value.lastIndexOf("."));
      issuedChallengeIds.push(challengeId);
      return {
        challengeId,
        cookieName: cookie.name,
        signedValue: cookie.value,
        headers: requestHeaders({ [cookie.name]: encodeURIComponent(cookie.value) }),
      };
    }),
  );

const deleteChallengeState = (challengeIds: readonly string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    yield* Effect.forEach(
      challengeIds.flatMap((id) => [challengeKey(id), attemptsKey(id)]),
      (key) => ttlStore.delete(key),
      { concurrency: "unbounded" },
    );
  });

export const cleanupIssuedChallenges = () =>
  deleteChallengeState(issuedChallengeIds).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        issuedChallengeIds.length = 0;
      }),
    ),
  );
