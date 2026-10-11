import { afterAll, beforeAll, expect, test } from "bun:test";
import { buildApp } from "../../app";

const previous = process.env.APP_ENV;
beforeAll(() => {
  process.env.APP_ENV = "production";
});
afterAll(() => {
  process.env.APP_ENV = previous;
});

test("Hono の IP 単位の rate limit は、HttpApi に載せた MFA チャレンジの verify にも先に掛かる", async () => {
  const app = buildApp({ mountStatic: () => {} });
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const res = await app.request("/api/mfa/challenge/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
      body: JSON.stringify({ code: "000000", kind: "totp" }),
    });
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
  expect(statuses[10]).toBe(429);
});
