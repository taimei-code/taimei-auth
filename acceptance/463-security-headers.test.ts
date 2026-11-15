import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";

import { partial } from "../src/__tests__/live-runner";
import { buildApp } from "../src/app";
import { AuthApi } from "../src/auth-service";
import { IdGeneratorLive } from "../src/id-generator";
import { consumeLoginChallenge, openLoginChallenge } from "../src/mfa/totp/login-challenge";
import { TtlStore } from "../src/ttl-store-service";

const ORIGIN = "http://localhost";
const SPA_DOCUMENT = "<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>";

const app = () =>
  buildApp({ mountStatic: (spa) => spa.get("*", (c) => c.html(SPA_DOCUMENT)) });

const documentResponse = () => app().request(`${ORIGIN}/account`);
const apiResponse = () => app().request(`${ORIGIN}/api/auth/ok`);

const directivesOf = (policy: string | null) =>
  (policy ?? "")
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "");

const challengeLayer = Layer.mergeAll(
  IdGeneratorLive,
  Layer.succeed(
    TtlStore,
    partial<TtlStore["Service"]>({
      set: () => Effect.void,
      getAndDelete: () => Effect.succeed("{}"),
    }),
  ),
  Layer.succeed(AuthApi, partial<AuthApi["Service"]>({ secret: Effect.succeed("test-secret") })),
);

describe("SPA の document と API の応答の security の header (#463)", () => {
  test("AC-001: SPA の document の応答は、CSP の frame-ancestors 'none' と X-Frame-Options: DENY を持つ", async () => {
    const response = await documentResponse();
    expect(directivesOf(response.headers.get("Content-Security-Policy"))).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  test.each([
    ["SPA の document", documentResponse],
    ["API", apiResponse],
  ] as const)(
    "AC-002: %s の応答は X-Content-Type-Options: nosniff と Referrer-Policy: strict-origin-when-cross-origin を持つ",
    async (_name, respond) => {
      const response = await respond();
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    },
  );

  test("AC-003: SPA の document の応答は、強制の CSP で script-src 'self'・object-src 'none'・base-uri 'none' を持つ", async () => {
    const directives = directivesOf(
      (await documentResponse()).headers.get("Content-Security-Policy"),
    );
    expect(directives).toEqual(
      expect.arrayContaining(["script-src 'self'", "object-src 'none'", "base-uri 'none'"]),
    );
  });

  test("AC-004: sign-out の応答は Clear-Site-Data を持つ", async () => {
    const response = await app().request(`${ORIGIN}/api/auth/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{}",
    });
    expect(response.headers.get("Clear-Site-Data")).not.toBeNull();
  });

  test("AC-005: MFA の challenge を開く cookie と消す cookie の名前は __Host- で始まる", async () => {
    const opened = await Effect.runPromise(
      openLoginChallenge({
        userId: "user-1",
        redirectUrl: "http://localhost/account",
        method: "magic_link",
      }).pipe(
        Effect.provide(challengeLayer),
      ),
    );
    const cleared = await Effect.runPromise(
      consumeLoginChallenge("challenge-1").pipe(Effect.provide(challengeLayer)),
    );
    expect(opened.name.startsWith("__Host-")).toBe(true);
    expect(cleared.get("set-cookie") ?? "").toMatch(/^__Host-/);
  });
});
