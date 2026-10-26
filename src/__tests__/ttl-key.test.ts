import { describe, expect, test } from "bun:test";
import { MemoryKvStore } from "../kv-store.memory";
import { challengeKey } from "../mfa/totp/login-challenge";
import type { TtlStoreBackend } from "../ttl-store";
import { TtlStore } from "../ttl-store-service";
import {
  betterAuthKey,
  HEALTH_PING_KEY,
  OWN_KEY_PREFIXES,
  ownKey,
  SESSION_INDEX_PREFIX,
  VERIFICATION_PREFIX,
} from "../ttl-key";

const SESSION_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

const familyPrefixes = [
  ...OWN_KEY_PREFIXES.map((prefix) => `${prefix}:`),
  SESSION_INDEX_PREFIX,
  VERIFICATION_PREFIX,
];

describe("TTL store の key の接頭辞", () => {
  test("自前の key と better-auth の key の接頭辞は、どの 2 つも片方がもう片方で始まらない", () => {
    const overlaps = familyPrefixes.flatMap((a) =>
      familyPrefixes.filter((b) => a !== b && a.startsWith(b)).map((b) => `${a} ⊃ ${b}`),
    );
    expect(overlaps).toEqual([]);
  });

  test("自前の接頭辞で作った key は、better-auth が使う key の形に当たらない", () => {
    const ownKeys = OWN_KEY_PREFIXES.map((prefix) => ownKey(prefix, "x".repeat(32)));
    expect(ownKeys.filter((key) => betterAuthKey(key) !== null)).toEqual([]);
  });

  test("better-auth の key は、session token・利用者ごとの session の一覧・verification の 3 つの形だけを受ける", () => {
    expect(betterAuthKey(SESSION_TOKEN)).toBe(SESSION_TOKEN as never);
    expect(betterAuthKey("active-sessions-user-1")).toBe("active-sessions-user-1" as never);
    expect(betterAuthKey("verification:abc-_123")).toBe("verification:abc-_123" as never);

    expect(betterAuthKey(SESSION_TOKEN.slice(1))).toBeNull();
    expect(betterAuthKey(`${SESSION_TOKEN}a`)).toBeNull();
    expect(betterAuthKey(`${SESSION_TOKEN.slice(1)}:`)).toBeNull();
    expect(betterAuthKey("rate-limit:magic-link:ip:1.2.3.4")).toBeNull();
    expect(betterAuthKey("active-sessions-")).toBeNull();
    expect(betterAuthKey("verification:")).toBeNull();
  });

  test("deploy の前後で MFA チャレンジと /health の確認が続くよう、key の文字列は変えない (試行枠の key は attempt-budget.test.ts が固定する)", () => {
    expect(String(challengeKey("x"))).toBe("mfa:login-challenge:x");
    expect(String(HEALTH_PING_KEY)).toBe("health:ping");
  });

  test("TTL store に素の文字列は渡せない (typecheck が固定する)", () => {
    const passRawStrings = (backend: TtlStoreBackend, store: MemoryKvStore) => [
      // @ts-expect-error
      backend.get("rate-limit:anything"),
      // @ts-expect-error
      store.get("rate-limit:anything"),
      TtlStore.use((ttlStore) =>
        // @ts-expect-error
        ttlStore.get("rate-limit:anything"),
      ),
    ];
    expect(passRawStrings).toBeFunction();
  });
});
